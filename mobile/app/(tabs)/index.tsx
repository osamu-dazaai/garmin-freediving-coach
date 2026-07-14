import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ScrollView, View, Text, StyleSheet,
  TouchableOpacity, ActivityIndicator, Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import type { ReadinessScore } from '../../src/api/health';
import type { PlateauStatus, TrainingPhase } from '../../src/api/analytics';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue, withTiming, withDelay, useAnimatedStyle, Easing,
} from 'react-native-reanimated';
import { Colors } from '../../src/constants/colors';
import { useReadiness, useHealthMetrics } from '../../src/api/health';
import { useSessions } from '../../src/api/sessions';
import { useTrainingPhase, usePlateauStatus, usePersonalBests, useDepthProgression, useWorkingDepth } from '../../src/api/analytics';
import { ReadinessGauge } from '../../src/components/ReadinessGauge';
import { DiveCard } from '../../src/components/DiveCard';
import { useTriggerSync } from '../../src/api/protocols';
import { useAppStore } from '../../src/store/appStore';
import { fmtDepth } from '../../src/utils/formatters';

function FadeSlide({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);
  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) }));
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: translateY.value }] } as any));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function getDiveBrief(
  readiness: ReadinessScore | undefined,
  plateau: PlateauStatus | undefined,
  phase: TrainingPhase | undefined,
): { directive: string; detail: string; color: string; action: string; route: string } | null {
  if (!readiness) return null;

  const score = readiness.score;
  const isOpenWater = phase?.current_phase === 'open_water';

  // Low readiness → rest
  if (readiness.level === 'LOW' || score < 38) {
    const reasons: string[] = [];
    if (readiness.hrv_avg && readiness.hrv_avg < 45) reasons.push(`HRV ${Math.round(readiness.hrv_avg)}ms`);
    if (readiness.sleep_score && readiness.sleep_score < 60) reasons.push(`sleep ${Math.round(readiness.sleep_score)}%`);
    if (readiness.body_battery && readiness.body_battery < 30) reasons.push(`battery ${Math.round(readiness.body_battery)}%`);
    return {
      directive: 'REST DAY',
      detail: reasons.length ? `Recovery needed — ${reasons.join(', ')}. Stretching or breath awareness only.` : 'Body needs recovery. Skip the water today.',
      color: Colors.error,
      action: 'View Routines',
      route: '/(tabs)/protocol',
    };
  }

  // Plateau → technique focus
  if (plateau?.plateau && score >= 38) {
    return {
      directive: 'TECHNIQUE DAY',
      detail: `Depth plateau (${plateau.days_since_improvement}d). ${plateau.suggestion ?? 'Focus on equalization drills, not depth.'}`,
      color: Colors.orange,
      action: 'Open Routines',
      route: '/(tabs)/protocol',
    };
  }

  // Optimal + open water → push depth
  if (readiness.level === 'OPTIMAL' && score > 72 && isOpenWater) {
    return {
      directive: 'DEPTH DAY',
      detail: `Readiness ${score}/100 — ideal conditions to push your working depth. Warm up at −5m then attempt target depth.`,
      color: Colors.cyan,
      action: 'Start Session',
      route: '/(tabs)/log',
    };
  }

  // Optimal + pool → CO2 table
  if (readiness.level === 'OPTIMAL' && score > 72) {
    return {
      directive: 'TABLE DAY',
      detail: `Strong recovery (${score}/100). Good day for a CO₂ table — push the hold duration.`,
      color: Colors.cyan,
      action: 'Start CO₂ Table',
      route: '/(tabs)/protocol',
    };
  }

  // Moderate
  return {
    directive: 'EASY SESSION',
    detail: `Moderate readiness (${score}/100). Stick to comfortable depths, focus on relaxation and breath control.`,
    color: Colors.tertiary,
    action: 'Start Session',
    route: '/(tabs)/protocol',
  };
}

const QUICK_ACTIONS = [
  { label: 'NEW LOG',    sub: 'Record Session', icon: 'add-circle-outline' as const, color: Colors.cyan,     route: '/(tabs)/log' },
  { label: 'O2 TABLES', sub: 'Start Static Prep', icon: 'timer' as const,            color: Colors.tertiary,  route: '/(tabs)/protocol' },
  { label: 'REPORTS',   sub: 'Full Analysis',   icon: 'analytics' as const,           color: Colors.outline,   route: '/analytics' },
  { label: 'SYNC',      sub: 'Garmin Connect',  icon: 'sync' as const,               color: Colors.primaryDim, route: null },
];

export default function DashboardScreen() {
  const router = useRouter();
  const { data: readiness, isLoading: loadingR } = useReadiness();
  const { data: healthMetrics } = useHealthMetrics(30);
  const { data: sessions } = useSessions(3);
  const { data: phase } = useTrainingPhase();
  const { data: plateau } = usePlateauStatus();
  const { data: pbs } = usePersonalBests();
  const { data: progression } = useDepthProgression(90);
  const { data: workingDepth } = useWorkingDepth();
  const syncMutation = useTriggerSync();
  const { userSettings } = useAppStore();

  // Personalized HRV baseline from 30-day rolling average
  const personalHrvBaseline = useMemo(() => {
    if (!healthMetrics || healthMetrics.length < 5) return null;
    const vals = healthMetrics.map((m) => m.hrv_avg).filter((v): v is number => v != null && v > 0);
    if (vals.length < 5) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [healthMetrics]);

  const showHrvAlert = readiness?.hrv_avg != null && (
    personalHrvBaseline
      ? readiness.hrv_avg < personalHrvBaseline * 0.85
      : readiness.hrv_avg < 50
  );

  const maxProg = progression ? Math.max(...progression.map((p) => p.max_depth_m), 1) : 1;
  const [selectedMiniIdx, setSelectedMiniIdx] = useState<number | null>(null);

  // ── Pre-dive safety checklist ───────────────────────────────────────────────
  const SAFETY_ITEMS = [
    { key: 'buddy',     icon: 'group' as const,          label: 'Buddy confirmed' },
    { key: 'gear',      icon: 'verified' as const,       label: 'Equipment checked' },
    { key: 'hydration', icon: 'water-drop' as const,     label: 'Well hydrated' },
    { key: 'rested',    icon: 'nightlight' as const,     label: 'Well rested, no alcohol 24h' },
    { key: 'health',    icon: 'health-and-safety' as const, label: 'No cold or congestion' },
    { key: 'plan',      icon: 'assignment' as const,     label: 'Dive plan communicated' },
  ];
  const safetyKey = `@safety_checklist_${new Date().toISOString().slice(0, 10)}`;
  const [safetyChecks, setSafetyChecks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    AsyncStorage.getItem(safetyKey).then((v) => {
      if (v) setSafetyChecks(JSON.parse(v));
    });
  }, [safetyKey]);

  const toggleSafetyItem = useCallback((key: string) => {
    setSafetyChecks((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      AsyncStorage.setItem(safetyKey, JSON.stringify(next));
      return next;
    });
  }, [safetyKey]);

  const safetyCompleted = SAFETY_ITEMS.every((item) => safetyChecks[item.key]);
  const safetyCount = SAFETY_ITEMS.filter((item) => safetyChecks[item.key]).length;
  const miniSlice = progression ? progression.slice(-30) : [];
  const brief = getDiveBrief(readiness, plateau ?? undefined, phase ?? undefined);

  // ── Session blueprint (warm-up plan + target depth) ─────────────────────────
  const blueprint = useMemo(() => {
    if (!readiness || !workingDepth || !brief) return null;
    // Only show for dive-able days
    if (brief.directive === 'REST DAY') return null;
    const wd = workingDepth.working_depth_m;
    const pb = workingDepth.pb_depth_m;
    if (wd < 5 || pb < 5) return null;

    // Target depth based on readiness + directive
    let targetM: number;
    let intensity: 'push' | 'work' | 'easy';
    if (brief.directive === 'DEPTH DAY') {
      // Aim 1-2m above working depth, toward PB
      targetM = Math.min(pb + 2, wd + Math.max(2, (pb - wd) * 0.5));
      intensity = 'push';
    } else if (brief.directive === 'TECHNIQUE DAY') {
      // Stay at or below working depth
      targetM = wd * 0.85;
      intensity = 'easy';
    } else {
      // Easy session / table day — work at comfortable depths
      targetM = wd * 0.9;
      intensity = 'work';
    }
    targetM = Math.round(targetM);

    // Build 4-step warm-up: ~30%, ~50%, ~65%, ~80% of target
    const steps = [0.3, 0.5, 0.65, 0.8].map((pct) => Math.round(targetM * pct));

    // Estimated session: 4 warm-ups + 2-3 working dives + SIs (~3min each)
    const estDives = steps.length + (intensity === 'push' ? 3 : 4);
    const estMinutes = estDives * 3 + steps.length * 2; // ~3min SI per dive, 2min extra for warmups

    // Surface interval recommendations based on depth zones
    // Rule: SI >= 2× estimated bottom time; minimum 90s for 10m+; 3× for max attempts
    const warmupSI = 90;  // 90s for warmup dives (shallow, short BT)
    const workingSI = targetM >= 20
      ? Math.max(120, Math.round(targetM * 2.5))  // deeper = longer SI
      : Math.max(90, Math.round(targetM * 2));
    const maxAttemptSI = Math.max(150, Math.round(targetM * 3));

    // Post-session recovery estimate (matches recovery card logic)
    let recoveryH: number;
    if (targetM >= 35 || estDives >= 10) recoveryH = 48;
    else if (targetM >= 25) recoveryH = 36;
    else if (targetM >= 15) recoveryH = 24;
    else recoveryH = 16;

    return {
      targetM, steps, intensity, estDives, estMinutes, wd, pb,
      warmupSI, workingSI, maxAttemptSI, recoveryH,
    };
  }, [readiness, workingDepth, brief]);

  // ── Recovery status ────────────────────────────────────────────────────────
  const recovery = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    const last = sessions[0];
    const hoursSince = (Date.now() - new Date(last.start_time).getTime()) / 3_600_000;
    if (hoursSince > 72) return null; // too long ago to show recovery card

    const depth = last.dive.max_depth_m;
    const diveCount = last.dive.dive_count ?? 1;

    // Recovery recommendation based on session intensity:
    // Shallow/light (<15m, few dives) → 12-18h
    // Moderate (15-25m) → 24h
    // Deep (25-35m) → 36h
    // Very deep (35m+) or high volume (10+ dives) → 48h
    let recommendedH: number;
    if (depth >= 35 || diveCount >= 10) recommendedH = 48;
    else if (depth >= 25) recommendedH = 36;
    else if (depth >= 15) recommendedH = 24;
    else recommendedH = 16;

    const progress = Math.min(1, hoursSince / recommendedH);
    const ready = progress >= 1;
    const remainingH = Math.max(0, recommendedH - hoursSince);

    // Format time since
    let sinceLabel: string;
    if (hoursSince < 1) sinceLabel = `${Math.round(hoursSince * 60)}min ago`;
    else if (hoursSince < 24) sinceLabel = `${Math.round(hoursSince)}h ago`;
    else sinceLabel = `${(hoursSince / 24).toFixed(1)}d ago`;

    // Format remaining
    let remainLabel: string;
    if (remainingH < 1) remainLabel = 'Ready';
    else if (remainingH < 24) remainLabel = `~${Math.round(remainingH)}h`;
    else remainLabel = `~${(remainingH / 24).toFixed(1)}d`;

    // "Ready for what?" — tiered training readiness based on recovery %
    type ReadyTier = { label: string; icon: string; color: string; detail: string };
    let readyFor: ReadyTier;
    if (progress >= 1.0) {
      readyFor = {
        label: 'FULL INTENSITY',
        icon: 'bolt',
        color: '#4ade80',
        detail: 'Depth push, max attempts, or demanding O₂ tables',
      };
    } else if (progress >= 0.75) {
      readyFor = {
        label: 'MODERATE SESSION',
        icon: 'directions-walk',
        color: Colors.cyan,
        detail: 'Working depth dives, CO₂ tables, or technique drills',
      };
    } else if (progress >= 0.5) {
      readyFor = {
        label: 'LIGHT TRAINING',
        icon: 'self-improvement',
        color: Colors.orange,
        detail: 'Easy pool session, shallow warm-ups, or dry breath work',
      };
    } else {
      readyFor = {
        label: 'REST ONLY',
        icon: 'hotel',
        color: Colors.error,
        detail: 'Stretching, visualization, or complete rest. No water.',
      };
    }

    return {
      depth, diveCount, hoursSince, recommendedH, progress, ready,
      sinceLabel, remainLabel, locationName: last.dive.location_name,
      readyFor,
    };
  }, [sessions]);

  // ── Weekly training pulse ─────────────────────────────────────────────────
  const weekPulse = useMemo(() => {
    if (!progression || progression.length < 1) return null;

    const now = new Date();
    // Monday of this week (ISO weeks start on Monday)
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() + mondayOffset);

    // Sessions this week
    const thisWeek = progression.filter((p) => new Date(p.date) >= monday);
    const thisWeekDepth = thisWeek.reduce((s, p) => s + p.max_depth_m, 0);
    const thisWeekBest = thisWeek.length > 0 ? Math.max(...thisWeek.map((p) => p.max_depth_m)) : 0;

    // Weekly average (over last 8 weeks)
    const eightWeeksAgo = new Date(monday);
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
    const priorSessions = progression.filter((p) => {
      const d = new Date(p.date);
      return d >= eightWeeksAgo && d < monday;
    });
    const weekSpan = Math.max(1, Math.round((monday.getTime() - eightWeeksAgo.getTime()) / (7 * 86400000)));
    const avgPerWeek = priorSessions.length / weekSpan;
    const avgDepthPerWeek = priorSessions.reduce((s, p) => s + p.max_depth_m, 0) / weekSpan;

    // Days since last session
    const lastDate = progression.length > 0 ? new Date(progression[progression.length - 1].date) : null;
    const daysSinceLast = lastDate ? Math.floor((now.getTime() - lastDate.getTime()) / 86400000) : null;

    // 7-day activity dots (Mon=0 through Sun=6)
    const weekDates = new Set(thisWeek.map((p) => p.date));
    const dots: boolean[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      dots.push(weekDates.has(key));
    }

    return { thisWeek, thisWeekDepth, thisWeekBest, avgPerWeek, avgDepthPerWeek, daysSinceLast, dots };
  }, [progression]);

  return (
    <View style={styles.root}>
      {/* ── Top app bar ── */}
      <View style={styles.appBar}>
        <View style={styles.appBarLeft}>
          <MaterialIcons name="terminal" size={18} color={Colors.cyan} />
          <Text style={styles.appBarTitle}>NAVIGATOR</Text>
        </View>
        <TouchableOpacity onPress={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          {syncMutation.isPending
            ? <ActivityIndicator size="small" color={Colors.cyan} />
            : <MaterialIcons name="sync" size={22} color={Colors.cyan} />}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Training phase ── */}
        {phase && (
          <FadeSlide delay={0}>
            <View style={styles.phaseCard}>
              <View style={styles.phaseInner}>
                <MaterialIcons name="explore" size={14} color={Colors.cyan} />
                <Text style={styles.phaseText}>
                  CURRENT PHASE: {phase.current_phase === 'open_water' ? 'OPEN WATER' : 'POOL'}
                  {phase.session_count > 0 ? ` · ${phase.streak_days}d streak` : ''}
                </Text>
              </View>
            </View>
          </FadeSlide>
        )}

        {/* ── HRV Gate alert ── */}
        {showHrvAlert && (
          <FadeSlide delay={60}>
            <View style={styles.alertCard}>
              <MaterialIcons name="warning" size={20} color={Colors.error} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.alertTitle}>HRV GATE ALERT</Text>
                <Text style={styles.alertSub}>
                  {Math.round(readiness!.hrv_avg!)}ms
                  {personalHrvBaseline
                    ? ` (your avg: ${Math.round(personalHrvBaseline)}ms · ${Math.round((1 - readiness!.hrv_avg! / personalHrvBaseline) * 100)}% below baseline)`
                    : ' — below threshold'}
                  {' — pool-only session recommended'}
                </Text>
              </View>
            </View>
          </FadeSlide>
        )}

        {/* ── Readiness ring ── */}
        <FadeSlide delay={120}>
          <View style={styles.readinessCard}>
            <Text style={styles.sectionMicro}>DAILY READINESS</Text>
            {loadingR
              ? <ActivityIndicator color={Colors.cyan} style={{ marginVertical: 24 }} />
              : readiness
                ? (
                  <>
                    <ReadinessGauge score={readiness.score} level={readiness.level} size={180} />
                    <View style={styles.readinessStats}>
                      <View style={styles.readinessStat}>
                        <Text style={styles.readinessStatLabel}>HRV</Text>
                        <Text style={styles.readinessStatValue}>
                          {readiness.hrv_avg ? `${Math.round(readiness.hrv_avg)}` : '—'}
                          <Text style={styles.readinessStatUnit}> ms</Text>
                        </Text>
                      </View>
                      <View style={styles.readinessDivider} />
                      <View style={styles.readinessStat}>
                        <Text style={styles.readinessStatLabel}>SLEEP QUALITY</Text>
                        <Text style={styles.readinessStatValue}>
                          {readiness.sleep_score ? Math.round(readiness.sleep_score) : '—'}
                          <Text style={styles.readinessStatUnit}>%</Text>
                        </Text>
                      </View>
                      <View style={styles.readinessDivider} />
                      <View style={styles.readinessStat}>
                        <Text style={styles.readinessStatLabel}>BODY BAT.</Text>
                        <Text style={styles.readinessStatValue}>
                          {readiness.body_battery ? Math.round(readiness.body_battery) : '—'}
                          <Text style={styles.readinessStatUnit}>%</Text>
                        </Text>
                      </View>
                    </View>
                    {/* 7-day HRV trend sparkline */}
                    {healthMetrics && healthMetrics.length > 1 && (() => {
                      const sorted = [...healthMetrics].sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
                      const values = sorted.map((m) => m.hrv_avg ?? 0).filter((v) => v > 0);
                      if (values.length < 2) return null;
                      const maxV = Math.max(...values);
                      const minV = Math.min(...values);
                      const range = maxV - minV || 1;
                      const todayHrv = readiness.hrv_avg ?? 0;
                      const trend = values[values.length - 1] - values[0];
                      return (
                        <View style={styles.hrvTrendWrap}>
                          <View style={styles.hrvTrendHeader}>
                            <Text style={styles.hrvTrendLabel}>7-DAY HRV TREND</Text>
                            <Text style={[styles.hrvTrendDelta, { color: trend >= 0 ? '#4ade80' : Colors.error }]}>
                              {trend >= 0 ? '↑' : '↓'}{Math.abs(Math.round(trend))}ms
                            </Text>
                          </View>
                          <View style={styles.hrvBars}>
                            {sorted.map((m, i) => {
                              const v = m.hrv_avg ?? 0;
                              if (!v) return <View key={m.date} style={[styles.hrvBar, { height: 4, backgroundColor: Colors.surfaceHighest }]} />;
                              const h = 8 + ((v - minV) / range) * 28;
                              const isToday = i === sorted.length - 1;
                              const isAboveAvg = v >= (todayHrv || maxV);
                              return (
                                <View key={m.date} style={[styles.hrvBar, { height: h,
                                  backgroundColor: isToday ? Colors.cyan : isAboveAvg ? Colors.primaryDim + '80' : Colors.primaryDim + '40',
                                }]} />
                              );
                            })}
                          </View>
                          <View style={styles.hrvTrendAxis}>
                            <Text style={styles.hrvAxisLabel}>7 DAYS AGO</Text>
                            <Text style={[styles.hrvAxisLabel, { color: Colors.primaryDim }]}>TODAY {todayHrv ? `${Math.round(todayHrv)}ms` : ''}</Text>
                          </View>
                        </View>
                      );
                    })()}
                  </>
                )
                : null}
          </View>
        </FadeSlide>

        {/* ── Recovery trends (resting HR, body battery, stress) ── */}
        {healthMetrics && healthMetrics.length > 2 && (
          <FadeSlide delay={140}>
            <View style={styles.recoveryCard}>
              <Text style={styles.recoveryHeader}>RECOVERY TRENDS</Text>
              <Text style={styles.recoverySub}>7-day body metrics from Garmin</Text>
              <View style={styles.recoveryGrid}>
                {([
                  { key: 'resting_hr' as const, label: 'RESTING HR', unit: 'bpm', color: Colors.error, invert: true },
                  { key: 'body_battery_charged' as const, label: 'BODY BATTERY', unit: '%', color: '#4ade80', invert: false },
                  { key: 'stress_avg' as const, label: 'STRESS', unit: '', color: Colors.orange, invert: true },
                ] as const).map((metric) => {
                  const sorted = [...healthMetrics].sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
                  const vals = sorted.map((m) => m[metric.key]).filter((v): v is number => v != null && v > 0);
                  if (vals.length < 2) return null;
                  const current = vals[vals.length - 1];
                  const prev = vals[0];
                  const delta = current - prev;
                  const minVal = Math.min(...vals);
                  const maxVal = Math.max(...vals);
                  const range = maxVal - minVal || 1;
                  // For inverted metrics (HR, stress), negative delta is good
                  const isGood = metric.invert ? delta <= 0 : delta >= 0;
                  return (
                    <View key={metric.key} style={styles.recoveryMetric}>
                      <View style={styles.recoveryMetricHeader}>
                        <Text style={styles.recoveryMetricLabel}>{metric.label}</Text>
                        <Text style={[styles.recoveryDelta, { color: isGood ? '#4ade80' : Colors.error }]}>
                          {delta >= 0 ? '+' : ''}{Math.round(delta)}{metric.unit ? ` ${metric.unit}` : ''}
                        </Text>
                      </View>
                      <View style={styles.recoveryMetricRow}>
                        <Text style={[styles.recoveryValue, { color: metric.color }]}>
                          {Math.round(current)}
                          <Text style={styles.recoveryUnit}> {metric.unit}</Text>
                        </Text>
                        <View style={styles.recoverySparkline}>
                          {sorted.map((m, i) => {
                            const v = m[metric.key];
                            if (v == null || v <= 0) return <View key={m.date} style={[styles.recoverySpark, { height: 3, backgroundColor: Colors.surfaceHighest }]} />;
                            const h = 4 + ((v - minVal) / range) * 20;
                            const isLast = i === sorted.length - 1;
                            return (
                              <View key={m.date} style={[styles.recoverySpark, {
                                height: h,
                                backgroundColor: isLast ? metric.color : metric.color + '50',
                              }]} />
                            );
                          })}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </FadeSlide>
        )}

        {/* ── Dive Brief (coaching recommendation) ── */}
        {brief && (
          <FadeSlide delay={160}>
            <View style={[styles.briefCard, { borderLeftColor: brief.color }]}>
              <View style={styles.briefHeader}>
                <View style={[styles.briefBadge, { backgroundColor: brief.color + '20' }]}>
                  <Text style={[styles.briefDirective, { color: brief.color }]}>{brief.directive}</Text>
                </View>
                <Text style={styles.briefLabel}>TODAY'S BRIEF</Text>
              </View>
              <Text style={styles.briefDetail}>{brief.detail}</Text>
              <TouchableOpacity
                onPress={() => router.push(brief.route as any)}
                style={[styles.briefAction, { borderColor: brief.color + '50' }]}
              >
                <Text style={[styles.briefActionText, { color: brief.color }]}>{brief.action}</Text>
                <MaterialIcons name="arrow-forward" size={14} color={brief.color} />
              </TouchableOpacity>
            </View>
          </FadeSlide>
        )}

        {/* ── Session Blueprint ── */}
        {blueprint && (
          <FadeSlide delay={170}>
            <View style={bpStyles.card}>
              <View style={bpStyles.header}>
                <MaterialIcons name="map" size={13} color={Colors.cyan} />
                <Text style={bpStyles.title}>SESSION BLUEPRINT</Text>
                <View style={[bpStyles.intensityBadge, {
                  backgroundColor: blueprint.intensity === 'push' ? Colors.cyan + '20'
                    : blueprint.intensity === 'work' ? Colors.tertiary + '20'
                    : Colors.outline + '20',
                }]}>
                  <Text style={[bpStyles.intensityText, {
                    color: blueprint.intensity === 'push' ? Colors.cyan
                      : blueprint.intensity === 'work' ? Colors.tertiary
                      : Colors.outline,
                  }]}>
                    {blueprint.intensity === 'push' ? 'PUSH' : blueprint.intensity === 'work' ? 'WORK' : 'TECHNIQUE'}
                  </Text>
                </View>
              </View>

              {/* Target depth hero */}
              <View style={bpStyles.targetRow}>
                <View>
                  <Text style={bpStyles.targetLabel}>TARGET MAX</Text>
                  <Text style={bpStyles.targetValue}>
                    {blueprint.targetM}<Text style={bpStyles.targetUnit}>m</Text>
                  </Text>
                </View>
                <View style={bpStyles.targetMeta}>
                  <Text style={bpStyles.metaLine}>Working: {fmtDepth(blueprint.wd)}</Text>
                  <Text style={bpStyles.metaLine}>PB: {fmtDepth(blueprint.pb)}</Text>
                  <Text style={bpStyles.metaLine}>~{blueprint.estDives} dives · ~{blueprint.estMinutes}min</Text>
                </View>
              </View>

              {/* Warm-up plan visual */}
              <Text style={bpStyles.warmupLabel}>WARM-UP PLAN</Text>
              <View style={bpStyles.stepsRow}>
                {blueprint.steps.map((depth, i) => (
                  <React.Fragment key={i}>
                    <View style={bpStyles.stepCol}>
                      <View style={bpStyles.stepCircle}>
                        <Text style={bpStyles.stepNum}>{i + 1}</Text>
                      </View>
                      <Text style={bpStyles.stepDepth}>{depth}m</Text>
                      <Text style={bpStyles.stepPct}>{Math.round((depth / blueprint.targetM) * 100)}%</Text>
                    </View>
                    {i < blueprint.steps.length - 1 && (
                      <View style={bpStyles.stepArrow}>
                        <MaterialIcons name="chevron-right" size={12} color={Colors.outline} />
                      </View>
                    )}
                  </React.Fragment>
                ))}
                {/* Max attempt */}
                <View style={bpStyles.stepArrow}>
                  <MaterialIcons name="chevron-right" size={12} color={Colors.cyan} />
                </View>
                <View style={bpStyles.stepCol}>
                  <View style={[bpStyles.stepCircle, { backgroundColor: Colors.cyan + '20', borderColor: Colors.cyan + '60' }]}>
                    <MaterialIcons name="flag" size={10} color={Colors.cyan} />
                  </View>
                  <Text style={[bpStyles.stepDepth, { color: Colors.cyan, fontWeight: '700' }]}>{blueprint.targetM}m</Text>
                  <Text style={bpStyles.stepPct}>MAX</Text>
                </View>
              </View>

              {/* Surface interval targets */}
              <View style={bpStyles.siSection}>
                <View style={bpStyles.siHeader}>
                  <MaterialIcons name="timer" size={11} color={Colors.orange} />
                  <Text style={bpStyles.siTitle}>SURFACE INTERVALS</Text>
                </View>
                <View style={bpStyles.siGrid}>
                  <View style={bpStyles.siItem}>
                    <Text style={bpStyles.siPhase}>Warm-ups</Text>
                    <Text style={bpStyles.siValue}>{Math.floor(blueprint.warmupSI / 60)}:{String(blueprint.warmupSI % 60).padStart(2, '0')}</Text>
                    <Text style={bpStyles.siNote}>min</Text>
                  </View>
                  <View style={[bpStyles.siItem, { borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.outlineVariant + '25' }]}>
                    <Text style={bpStyles.siPhase}>Working</Text>
                    <Text style={[bpStyles.siValue, { color: Colors.tertiary }]}>{Math.floor(blueprint.workingSI / 60)}:{String(blueprint.workingSI % 60).padStart(2, '0')}</Text>
                    <Text style={bpStyles.siNote}>min</Text>
                  </View>
                  <View style={bpStyles.siItem}>
                    <Text style={bpStyles.siPhase}>Max attempt</Text>
                    <Text style={[bpStyles.siValue, { color: Colors.cyan }]}>{Math.floor(blueprint.maxAttemptSI / 60)}:{String(blueprint.maxAttemptSI % 60).padStart(2, '0')}</Text>
                    <Text style={bpStyles.siNote}>min</Text>
                  </View>
                </View>
                <View style={bpStyles.siSafetyRow}>
                  <MaterialIcons name="info-outline" size={10} color={Colors.outline} />
                  <Text style={bpStyles.siSafetyText}>
                    Recovery: {blueprint.recoveryH}h before next deep session · Always dive with a buddy
                  </Text>
                </View>
              </View>
            </View>
          </FadeSlide>
        )}

        {/* ── Pre-Dive Safety Check ── */}
        {brief && brief.directive !== 'REST DAY' && (
          <FadeSlide delay={175}>
            <View style={[scStyles.card, safetyCompleted && scStyles.cardCleared]}>
              <View style={scStyles.header}>
                <View style={scStyles.headerLeft}>
                  <MaterialIcons
                    name={safetyCompleted ? 'verified-user' : 'shield'}
                    size={14}
                    color={safetyCompleted ? '#4ade80' : Colors.orange}
                  />
                  <Text style={[scStyles.title, safetyCompleted && { color: '#4ade80' }]}>
                    {safetyCompleted ? 'SAFETY CLEARED' : 'PRE-DIVE SAFETY CHECK'}
                  </Text>
                </View>
                <Text style={scStyles.progress}>{safetyCount}/{SAFETY_ITEMS.length}</Text>
              </View>

              {!safetyCompleted && (
                <Text style={scStyles.subtitle}>Complete before entering the water</Text>
              )}

              <View style={scStyles.items}>
                {SAFETY_ITEMS.map((item) => {
                  const checked = !!safetyChecks[item.key];
                  return (
                    <Pressable
                      key={item.key}
                      style={[scStyles.item, checked && scStyles.itemChecked]}
                      onPress={() => toggleSafetyItem(item.key)}
                    >
                      <MaterialIcons
                        name={checked ? 'check-circle' : item.icon}
                        size={14}
                        color={checked ? '#4ade80' : Colors.outline}
                      />
                      <Text style={[scStyles.itemLabel, checked && scStyles.itemLabelChecked]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {safetyCompleted && (
                <View style={scStyles.clearedRow}>
                  <MaterialIcons name="check" size={11} color="#4ade80" />
                  <Text style={scStyles.clearedText}>All checks passed — dive safe, dive smart</Text>
                </View>
              )}
            </View>
          </FadeSlide>
        )}

        {/* ── Recovery status ── */}
        {recovery && (
          <FadeSlide delay={180}>
            <View style={[rcStyles.card, { borderLeftColor: recovery.ready ? '#4ade80' : Colors.orange }]}>
              <View style={rcStyles.header}>
                <View style={rcStyles.headerLeft}>
                  <MaterialIcons
                    name={recovery.ready ? 'check-circle' : 'hourglass-top'}
                    size={14}
                    color={recovery.ready ? '#4ade80' : Colors.orange}
                  />
                  <Text style={[rcStyles.status, { color: recovery.ready ? '#4ade80' : Colors.orange }]}>
                    {recovery.ready ? 'RECOVERED' : 'RECOVERING'}
                  </Text>
                </View>
                <Text style={rcStyles.since}>{recovery.sinceLabel}</Text>
              </View>

              {/* Progress bar */}
              <View style={rcStyles.track}>
                <View style={[rcStyles.fill, {
                  width: `${Math.round(recovery.progress * 100)}%` as any,
                  backgroundColor: recovery.ready ? '#4ade80' : Colors.orange,
                }]} />
              </View>

              <View style={rcStyles.details}>
                <View style={rcStyles.detail}>
                  <Text style={rcStyles.detailLabel}>LAST SESSION</Text>
                  <Text style={rcStyles.detailValue}>
                    {fmtDepth(recovery.depth)}
                    <Text style={rcStyles.detailSub}> · {recovery.diveCount} dive{recovery.diveCount !== 1 ? 's' : ''}</Text>
                  </Text>
                </View>
                <View style={rcStyles.detail}>
                  <Text style={rcStyles.detailLabel}>
                    {recovery.ready ? 'RECOVERY' : 'EST. REMAINING'}
                  </Text>
                  <Text style={[rcStyles.detailValue, { color: recovery.ready ? '#4ade80' : Colors.orange }]}>
                    {recovery.ready ? 'Complete' : recovery.remainLabel}
                  </Text>
                </View>
              </View>

              {/* Ready-for zone indicator */}
              <View style={[rcStyles.readyForCard, { borderColor: recovery.readyFor.color + '30', backgroundColor: recovery.readyFor.color + '08' }]}>
                <View style={rcStyles.readyForHeader}>
                  <MaterialIcons name={recovery.readyFor.icon as any} size={14} color={recovery.readyFor.color} />
                  <Text style={[rcStyles.readyForLabel, { color: recovery.readyFor.color }]}>
                    {recovery.readyFor.label}
                  </Text>
                </View>
                <Text style={rcStyles.readyForDetail}>{recovery.readyFor.detail}</Text>
              </View>

              {!recovery.ready && (
                <Text style={rcStyles.hint}>
                  {recovery.recommendedH}h recommended recovery for {fmtDepth(recovery.depth)} sessions
                </Text>
              )}
            </View>
          </FadeSlide>
        )}

        {/* ── Weekly training pulse ── */}
        {weekPulse && (
          <FadeSlide delay={195}>
            <View style={styles.weekCard}>
              <View style={styles.weekHeader}>
                <View style={styles.weekHeaderLeft}>
                  <MaterialIcons name="date-range" size={12} color={Colors.cyan} />
                  <Text style={styles.weekMicro}>THIS WEEK</Text>
                </View>
                {weekPulse.daysSinceLast != null && weekPulse.daysSinceLast >= 3 && (
                  <View style={styles.weekNudge}>
                    <Text style={styles.weekNudgeText}>
                      {weekPulse.daysSinceLast}d since last dive
                    </Text>
                  </View>
                )}
              </View>

              {/* 7-day activity dots */}
              <View style={styles.weekDots}>
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => {
                  const active = weekPulse.dots[i];
                  const isToday = i === ((new Date().getDay() + 6) % 7);
                  return (
                    <View key={i} style={styles.weekDotCol}>
                      <View style={[
                        styles.weekDot,
                        active && { backgroundColor: Colors.cyan },
                        isToday && !active && { borderColor: Colors.cyan + '80' },
                      ]} />
                      <Text style={[styles.weekDotLabel, isToday && { color: Colors.cyan }]}>{label}</Text>
                    </View>
                  );
                })}
              </View>

              {/* Stats row */}
              <View style={styles.weekStatsRow}>
                <View style={styles.weekStat}>
                  <Text style={styles.weekStatValue}>
                    {weekPulse.thisWeek.length}
                    <Text style={styles.weekStatUnit}>
                      {weekPulse.avgPerWeek > 0 ? ` / ${weekPulse.avgPerWeek.toFixed(1)}` : ''}
                    </Text>
                  </Text>
                  <Text style={styles.weekStatLabel}>SESSIONS{weekPulse.avgPerWeek > 0 ? ' vs AVG' : ''}</Text>
                </View>
                <View style={[styles.weekStat, styles.weekStatBorder]}>
                  <Text style={styles.weekStatValue}>
                    {Math.round(weekPulse.thisWeekDepth)}
                    <Text style={styles.weekStatUnit}>m</Text>
                  </Text>
                  <Text style={styles.weekStatLabel}>DEPTH</Text>
                </View>
                {weekPulse.thisWeekBest > 0 && (
                  <View style={[styles.weekStat, styles.weekStatBorder]}>
                    <Text style={[styles.weekStatValue, { color: Colors.cyan }]}>
                      {weekPulse.thisWeekBest.toFixed(1)}
                      <Text style={styles.weekStatUnit}>m</Text>
                    </Text>
                    <Text style={styles.weekStatLabel}>BEST</Text>
                  </View>
                )}
              </View>
            </View>
          </FadeSlide>
        )}

        {/* ── Depth goal progress ── */}
        {userSettings.depthGoalM != null && pbs && (
          <FadeSlide delay={210}>
            <View style={styles.goalCard}>
              <View style={styles.goalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.goalLabel}>DEPTH GOAL</Text>
                  <Text style={styles.goalNumbers}>
                    <Text style={{ color: Colors.cyan }}>{pbs.max_depth_m.toFixed(1)}m</Text>
                    <Text style={{ color: Colors.outline }}> / {userSettings.depthGoalM}m</Text>
                  </Text>
                </View>
                <Text style={styles.goalPct}>
                  {Math.round(Math.min(1, pbs.max_depth_m / userSettings.depthGoalM) * 100)}%
                </Text>
              </View>
              <View style={styles.goalTrack}>
                <View style={[styles.goalFill, {
                  width: `${Math.round(Math.min(1, pbs.max_depth_m / userSettings.depthGoalM) * 100)}%` as any,
                }]} />
              </View>
            </View>
          </FadeSlide>
        )}

        {/* ── Lifetime volume ── */}
        {pbs && (
          <FadeSlide delay={220}>
            <View style={styles.volumeCard}>
              <View style={styles.volumeLeft}>
                <Text style={styles.sectionMicro}>LIFETIME VOLUME</Text>
                <Text style={styles.volumeNumber}>
                  {Math.round(pbs.total_depth_descended_m).toLocaleString()}
                  <Text style={styles.volumeUnit}>m</Text>
                </Text>
                <Text style={styles.volumeSub}>
                  {pbs.total_sessions} sessions · PB {fmtDepth(pbs.max_depth_m)}
                </Text>
              </View>
              <MaterialIcons name="water" size={44} color={Colors.tertiary} style={{ opacity: 0.3 }} />
            </View>
          </FadeSlide>
        )}

        {/* ── Depth progression mini-chart ── */}
        {plateau && (
          <FadeSlide delay={200}>
            <View style={[styles.glassCard, plateau.plateau ? styles.plateauActive : null]}>
              <View style={styles.plateauHeader}>
                <MaterialIcons
                  name={plateau.plateau ? 'warning' : 'trending-up'}
                  size={14}
                  color={plateau.plateau ? Colors.orange : '#4ade80'}
                />
                <Text style={[styles.plateauTitle, { color: plateau.plateau ? Colors.orange : '#4ade80' }]}>
                  {plateau.plateau ? 'PLATEAU DETECTED' : 'PROGRESSING'}
                </Text>
                <Text style={styles.plateauDays}>{plateau.days_since_improvement}d</Text>
              </View>
              {plateau.suggestion && (
                <Text style={styles.plateauSuggestion}>{plateau.suggestion}</Text>
              )}
              {/* Mini bar chart */}
              {progression && progression.length > 0 && (
                <View style={styles.miniChart}>
                  {miniSlice.map((p, i) => {
                    const h = Math.max(3, (p.max_depth_m / maxProg) * 48);
                    const isMax = p.max_depth_m === pbs?.max_depth_m;
                    const isSelected = selectedMiniIdx === i;
                    return (
                      <Pressable
                        key={p.session_id}
                        style={[styles.miniBar, { height: h }]}
                        onPress={() => setSelectedMiniIdx(isSelected ? null : i)}
                      >
                        <View style={{
                          flex: 1,
                          borderRadius: 2,
                          backgroundColor: isSelected ? Colors.cyan : isMax ? Colors.cyan + 'cc' : Colors.primaryDim + '60',
                        }} />
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {selectedMiniIdx !== null && miniSlice[selectedMiniIdx] ? (
                <Pressable
                  style={styles.chartAxisRow}
                  onPress={() => router.push(`/session/${miniSlice[selectedMiniIdx!].session_id}` as any)}
                >
                  <Text style={styles.chartAxisLabel}>{miniSlice[selectedMiniIdx].date}</Text>
                  <Text style={[styles.chartAxisLabel, { color: Colors.cyan }]}>
                    {miniSlice[selectedMiniIdx].max_depth_m.toFixed(1)}m
                  </Text>
                  <Text style={[styles.chartAxisLabel, { color: Colors.primaryDim }]}>VIEW →</Text>
                </Pressable>
              ) : (
                <View style={styles.chartAxisRow}>
                  <Text style={styles.chartAxisLabel}>30 SESSIONS AGO</Text>
                  <Text style={[styles.chartAxisLabel, { color: Colors.primaryDim }]}>
                    PB: {pbs ? fmtDepth(pbs.max_depth_m) : '—'}
                  </Text>
                  <Text style={styles.chartAxisLabel}>TODAY</Text>
                </View>
              )}
            </View>
          </FadeSlide>
        )}

        {/* ── Quick actions ── */}
        <FadeSlide delay={240}>
          <View style={styles.quickGrid}>
            {QUICK_ACTIONS.map((action) => (
              <Pressable
                key={action.label}
                style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.75 }]}
                onPress={() => {
                  if (action.route) router.push(action.route as any);
                  else syncMutation.mutate();
                }}
              >
                <View style={[styles.quickIcon, { backgroundColor: action.color + '18' }]}>
                  <MaterialIcons name={action.icon} size={20} color={action.color} />
                </View>
                <Text style={[styles.quickLabel, { color: action.color !== Colors.outline ? action.color : Colors.onSurface }]}>
                  {action.label}
                </Text>
                <Text style={styles.quickSub}>{action.sub}</Text>
              </Pressable>
            ))}
          </View>
        </FadeSlide>

        {/* ── Recent sessions ── */}
        <FadeSlide delay={300}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>RECENT SESSIONS</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/log')}>
              <Text style={styles.seeAll}>View All →</Text>
            </TouchableOpacity>
          </View>
          {sessions?.map((s) => (
            <DiveCard key={s.id} session={s} pbDepthM={pbs?.max_depth_m} onPress={() => router.push(`/session/${s.id}` as any)} />
          ))}
        </FadeSlide>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  appBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)',
    backgroundColor: Colors.bg,
  },
  appBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  appBarTitle: { fontSize: 14, fontWeight: '700', color: Colors.cyan, letterSpacing: 4 },

  scroll: { padding: 20, paddingBottom: 100 },

  // Phase card
  phaseCard: {
    borderLeftWidth: 2, borderLeftColor: Colors.cyan,
    backgroundColor: Colors.surfaceHigh,
    paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 12,
  },
  phaseInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  phaseText: { fontSize: 11, color: Colors.onSurface, fontWeight: '700', letterSpacing: 1.5 },

  // HRV alert
  alertCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: Colors.errorContainerBg,
    borderLeftWidth: 3, borderLeftColor: Colors.error,
    borderRadius: 8, padding: 14, marginBottom: 12,
  },
  alertTitle: { fontSize: 10, color: Colors.error, fontWeight: '700', letterSpacing: 2, marginBottom: 2 },
  alertSub: { fontSize: 12, color: Colors.onSurfaceVariant },

  // Readiness
  readinessCard: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 20, alignItems: 'center', marginBottom: 12,
  },
  sectionMicro: { fontSize: 9, color: Colors.primaryDim, letterSpacing: 3, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
  readinessStats: { flexDirection: 'row', marginTop: 16, width: '100%', borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '40', paddingTop: 16 },
  readinessStat: { flex: 1, alignItems: 'center' },
  readinessDivider: { width: 1, backgroundColor: Colors.outlineVariant + '40', height: '100%' },
  readinessStatLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  readinessStatValue: { fontSize: 18, color: Colors.onSurface, fontWeight: '700' },
  readinessStatUnit: { fontSize: 11, fontWeight: '400', color: Colors.onSurfaceVariant },

  // HRV sparkline
  hrvTrendWrap: {
    width: '100%', marginTop: 16,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '40', paddingTop: 14,
  },
  hrvTrendHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  hrvTrendLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 2, fontWeight: '700', textTransform: 'uppercase' },
  hrvTrendDelta: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  hrvBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 40 },
  hrvBar: { flex: 1, borderRadius: 2 },
  hrvTrendAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  hrvAxisLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 1 },

  // Recovery trends
  recoveryCard: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 16, marginBottom: 12,
  },
  recoveryHeader: { fontSize: 9, color: Colors.primaryDim, letterSpacing: 3, fontWeight: '700', marginBottom: 2 },
  recoverySub: { fontSize: 10, color: Colors.outline, marginBottom: 14 },
  recoveryGrid: { gap: 12 },
  recoveryMetric: {},
  recoveryMetricHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  recoveryMetricLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700' },
  recoveryDelta: { fontSize: 9, fontWeight: '700' },
  recoveryMetricRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  recoveryValue: { fontSize: 20, fontWeight: '700' },
  recoveryUnit: { fontSize: 11, fontWeight: '400', color: Colors.outline },
  recoverySparkline: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 24, flex: 1, marginLeft: 16 },
  recoverySpark: { flex: 1, borderRadius: 1.5 },

  // Dive brief
  briefCard: {
    borderLeftWidth: 3,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 8, padding: 14, marginBottom: 12,
  },
  briefHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  briefBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  briefDirective: { fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  briefLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 3, fontWeight: '600' },
  briefDetail: { fontSize: 12, color: Colors.onSurfaceVariant, lineHeight: 18, marginBottom: 12 },
  briefAction: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  briefActionText: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },

  // Weekly training pulse
  weekCard: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14, marginBottom: 12,
  },
  weekHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  weekHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  weekMicro: { fontSize: 9, color: Colors.cyan, letterSpacing: 2.5, fontWeight: '700' },
  weekNudge: { backgroundColor: Colors.orange + '20', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  weekNudgeText: { fontSize: 8, color: Colors.orange, fontWeight: '700', letterSpacing: 0.5 },
  weekDots: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 8 },
  weekDotCol: { alignItems: 'center', gap: 4 },
  weekDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: Colors.surfaceHighest,
    borderWidth: 1, borderColor: Colors.outlineVariant + '40',
  },
  weekDotLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 0.5, fontWeight: '600' },
  weekStatsRow: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30', paddingTop: 10,
  },
  weekStat: { flex: 1, alignItems: 'center' },
  weekStatBorder: { borderLeftWidth: 1, borderLeftColor: Colors.outlineVariant + '30' },
  weekStatValue: { fontSize: 18, fontWeight: '700', color: Colors.onSurface },
  weekStatUnit: { fontSize: 11, fontWeight: '400', color: Colors.outline },
  weekStatLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginTop: 2 },

  // Depth goal
  goalCard: {
    backgroundColor: Colors.surfaceLowest, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.cyan + '25',
    padding: 14, marginBottom: 12,
  },
  goalRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  goalLabel: { fontSize: 8, color: Colors.primaryDim, letterSpacing: 3, fontWeight: '700', marginBottom: 4 },
  goalNumbers: { fontSize: 20, fontWeight: '700' },
  goalPct: { fontSize: 22, fontWeight: '700', color: Colors.cyan },
  goalTrack: { height: 3, backgroundColor: Colors.surfaceHighest, borderRadius: 2, overflow: 'hidden' },
  goalFill: { height: '100%', backgroundColor: Colors.cyan, borderRadius: 2 },

  // Lifetime volume
  volumeCard: {
    backgroundColor: Colors.surfaceLowest, borderLeftWidth: 2,
    borderLeftColor: Colors.tertiary, borderRadius: 8,
    padding: 18, marginBottom: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  volumeLeft: { flex: 1 },
  volumeNumber: { fontSize: 36, fontWeight: '700', color: Colors.tertiary, marginTop: 6, letterSpacing: -1 },
  volumeUnit: { fontSize: 16, fontWeight: '400', color: Colors.onSurfaceVariant },
  volumeSub: { fontSize: 11, color: Colors.outline, marginTop: 4 },

  // Plateau + mini chart
  glassCard: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 16, marginBottom: 12,
  },
  plateauActive: { borderColor: Colors.orange + '50' },
  plateauHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  plateauTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 2, flex: 1 },
  plateauDays: { fontSize: 10, color: Colors.outline },
  plateauSuggestion: { fontSize: 12, color: Colors.onSurfaceVariant, lineHeight: 18, marginBottom: 14 },
  miniChart: { flexDirection: 'row', alignItems: 'flex-end', height: 52, gap: 2, marginBottom: 6 },
  miniBar: { flex: 1, borderRadius: 2 },
  chartAxisRow: { flexDirection: 'row', justifyContent: 'space-between' },
  chartAxisLabel: { fontSize: 9, color: Colors.outline, letterSpacing: 1 },

  // Quick actions
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  quickCard: {
    width: '47.5%', backgroundColor: Colors.glass,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14,
  },
  quickIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  quickLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 },
  quickSub: { fontSize: 10, color: Colors.outline, letterSpacing: 0.5 },

  // Recent sessions
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 10, color: Colors.outline, letterSpacing: 2, fontWeight: '600' },
  seeAll: { fontSize: 12, color: Colors.cyan },
});

const rcStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.glassBorder,
    borderLeftWidth: 3,
    padding: 14, marginBottom: 12,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  since: { fontSize: 11, color: Colors.outline },
  track: {
    height: 4, backgroundColor: Colors.surfaceHighest,
    borderRadius: 2, overflow: 'hidden', marginBottom: 10,
  },
  fill: { height: '100%', borderRadius: 2 },
  details: { flexDirection: 'row', gap: 16 },
  detail: { flex: 1 },
  detailLabel: {
    fontSize: 8, color: Colors.outline, letterSpacing: 1.5,
    fontWeight: '700', marginBottom: 3,
  },
  detailValue: { fontSize: 14, fontWeight: '600', color: Colors.onSurface },
  detailSub: { fontSize: 11, fontWeight: '400', color: Colors.outline },
  hint: {
    fontSize: 10, color: Colors.outline, marginTop: 8,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30',
    paddingTop: 8,
  },
  readyForCard: {
    borderWidth: 1, borderRadius: 8,
    padding: 10, marginTop: 10,
  },
  readyForHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4,
  },
  readyForLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  readyForDetail: { fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16 },
});

const bpStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cyan + '15',
    padding: 16, marginHorizontal: 16, marginBottom: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14,
  },
  title: {
    fontSize: 9, color: Colors.cyan, letterSpacing: 2.5, fontWeight: '700', flex: 1,
  },
  intensityBadge: {
    borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3,
  },
  intensityText: {
    fontSize: 8, fontWeight: '700', letterSpacing: 1,
  },
  targetRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 14,
  },
  targetLabel: {
    fontSize: 8, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginBottom: 2,
  },
  targetValue: {
    fontSize: 40, fontWeight: '700', color: Colors.onSurface, letterSpacing: -2,
  },
  targetUnit: {
    fontSize: 18, fontWeight: '400', color: Colors.onSurfaceVariant,
  },
  targetMeta: { alignItems: 'flex-end', gap: 2 },
  metaLine: { fontSize: 10, color: Colors.outline },
  warmupLabel: {
    fontSize: 8, color: Colors.outline, letterSpacing: 2, fontWeight: '700', marginBottom: 10,
  },
  stepsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  stepCol: { alignItems: 'center', minWidth: 36 },
  stepCircle: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.surfaceHighest, borderWidth: 1,
    borderColor: Colors.outlineVariant + '50',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  stepNum: { fontSize: 10, fontWeight: '700', color: Colors.onSurfaceVariant },
  stepDepth: { fontSize: 11, fontWeight: '600', color: Colors.onSurface },
  stepPct: { fontSize: 8, color: Colors.outline, marginTop: 1 },
  stepArrow: {
    paddingHorizontal: 2, paddingTop: 0, marginTop: -12,
  },
  siSection: {
    marginTop: 14, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '25',
  },
  siHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10,
  },
  siTitle: {
    fontSize: 8, color: Colors.orange, letterSpacing: 2, fontWeight: '700',
  },
  siGrid: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceLow, borderRadius: 8,
    marginBottom: 8,
  },
  siItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  siPhase: { fontSize: 8, color: Colors.outline, letterSpacing: 1, fontWeight: '600', marginBottom: 3 },
  siValue: { fontSize: 16, fontWeight: '700', color: Colors.onSurface },
  siNote: { fontSize: 8, color: Colors.outline, marginTop: -1 },
  siSafetyRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
  },
  siSafetyText: { fontSize: 10, color: Colors.outline, lineHeight: 15, flex: 1 },
});

// ── Safety Checklist styles ───────────────────────────────────────────────────
const scStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.orange + '30',
    padding: 14, marginBottom: 12,
  },
  cardCleared: {
    borderColor: '#4ade8030',
    backgroundColor: 'rgba(74,222,128,0.04)',
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 10, fontWeight: '700', color: Colors.orange, letterSpacing: 2 },
  progress: { fontSize: 11, color: Colors.outline, fontWeight: '600' },
  subtitle: { fontSize: 10, color: Colors.outline, marginTop: 2, marginBottom: 6 },
  items: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10,
  },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surfaceLow,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: 'transparent',
  },
  itemChecked: {
    backgroundColor: 'rgba(74,222,128,0.08)',
    borderColor: '#4ade8025',
  },
  itemLabel: { fontSize: 11, color: Colors.outline },
  itemLabelChecked: { color: '#4ade80', textDecorationLine: 'line-through' },
  clearedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 10, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: '#4ade8015',
  },
  clearedText: { fontSize: 11, color: '#4ade80', fontWeight: '500' },
});
