import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue, withTiming, withDelay, useAnimatedStyle, Easing,
} from 'react-native-reanimated';
import { Colors } from '../../src/constants/colors';
import {
  useDepthProgression, useWorkingDepth, useMonthlyStats,
  useLocationPerformance, usePlateauStatus,
  type DepthPoint,
} from '../../src/api/analytics';
import { useSessions } from '../../src/api/sessions';
import { useAppStore } from '../../src/store/appStore';
import { fmtDepth, fmtMonth, fmtTimer } from '../../src/utils/formatters';
import { loadTableHistory, type TableSessionRecord, type ContractionData } from '../../src/utils/tableHistory';

function FadeSlide({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const opacity = useSharedValue(0);
  const ty = useSharedValue(14);
  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) }));
    ty.value = withDelay(delay, withTiming(0, { duration: 380, easing: Easing.out(Easing.quad) }));
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: ty.value }] } as any));
  return <Animated.View style={style}>{children}</Animated.View>;
}

const CHART_H = 100; // px — matches styles.bigChart height

// ── Training Calendar Heatmap ─────────────────────────────────────────────────
const DAY_LABELS = ['M', '', 'W', '', 'F', '', 'S'];

function TrainingCalendar({ progression }: { progression: DepthPoint[] }) {
  // Build a lookup: date string → max depth
  const sessionMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of progression) {
      const existing = map.get(p.date);
      if (!existing || p.max_depth_m > existing) {
        map.set(p.date, p.max_depth_m);
      }
    }
    return map;
  }, [progression]);

  // Generate 16 weeks of calendar data (most recent Sunday-aligned)
  const { weeks, monthLabels, stats } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find the most recent Monday
    const dayOfWeek = today.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const thisMon = new Date(today);
    thisMon.setDate(thisMon.getDate() + mondayOffset);

    const NUM_WEEKS = 16;
    const startMon = new Date(thisMon);
    startMon.setDate(startMon.getDate() - (NUM_WEEKS - 1) * 7);

    const weeks: { date: string; depth: number; isToday: boolean; isFuture: boolean }[][] = [];
    const monthLabels: { label: string; weekIdx: number }[] = [];
    let lastMonth = -1;
    let totalDays = 0;
    let activeDays = 0;
    let currentStreak = 0;
    let maxStreak = 0;
    let tempStreak = 0;

    // Build all dates, tracking streaks from today backward
    const allDates: { date: string; active: boolean }[] = [];

    for (let w = 0; w < NUM_WEEKS; w++) {
      const week: typeof weeks[0] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(startMon);
        date.setDate(date.getDate() + w * 7 + d);
        const dateStr = date.toISOString().slice(0, 10);
        const isFuture = date > today;
        const isToday = dateStr === today.toISOString().slice(0, 10);
        const depth = sessionMap.get(dateStr) ?? 0;

        week.push({ date: dateStr, depth, isToday, isFuture });

        if (!isFuture) {
          totalDays++;
          if (depth > 0) activeDays++;
          allDates.push({ date: dateStr, active: depth > 0 });
        }

        // Month label on first day of each new month
        if (d === 0 && date.getMonth() !== lastMonth) {
          lastMonth = date.getMonth();
          monthLabels.push({
            label: date.toLocaleDateString('en-US', { month: 'short' }),
            weekIdx: w,
          });
        }
      }
      weeks.push(week);
    }

    // Compute current streak (from today backward)
    for (let i = allDates.length - 1; i >= 0; i--) {
      // Skip today if no session yet (don't break streak)
      if (i === allDates.length - 1 && !allDates[i].active) continue;
      if (allDates[i].active) currentStreak++;
      else break;
    }

    // Compute max streak
    for (const d of allDates) {
      if (d.active) {
        tempStreak++;
        maxStreak = Math.max(maxStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
    }

    const weeksWithSessions = new Set(
      progression.filter((p) => {
        const d = new Date(p.date);
        return d >= startMon && d <= today;
      }).map((p) => {
        const d = new Date(p.date);
        const weekStart = new Date(d);
        weekStart.setDate(weekStart.getDate() - ((d.getDay() + 6) % 7));
        return weekStart.toISOString().slice(0, 10);
      })
    ).size;

    return {
      weeks,
      monthLabels,
      stats: {
        activeDays,
        totalWeeks: NUM_WEEKS,
        weeksWithSessions,
        currentStreak,
        maxStreak,
        frequency: totalDays > 0 ? (activeDays / totalDays * 7).toFixed(1) : '0',
      },
    };
  }, [sessionMap, progression]);

  // Depth color intensity
  const maxDepth = useMemo(
    () => Math.max(...Array.from(sessionMap.values()), 1),
    [sessionMap]
  );

  function cellColor(depth: number, isFuture: boolean, isToday: boolean): string {
    if (isFuture) return 'transparent';
    if (depth <= 0) return Colors.surfaceHighest;
    const intensity = Math.min(1, depth / maxDepth);
    if (intensity > 0.7) return Colors.cyan;
    if (intensity > 0.4) return Colors.cyan + '80';
    return Colors.cyan + '40';
  }

  return (
    <View style={calStyles.card}>
      <View style={calStyles.header}>
        <View>
          <Text style={calStyles.title}>TRAINING CALENDAR</Text>
          <Text style={calStyles.sub}>Last 16 weeks · brighter = deeper</Text>
        </View>
        {stats.currentStreak >= 2 && (
          <View style={calStyles.streakBadge}>
            <MaterialIcons name="local-fire-department" size={10} color="#facc15" />
            <Text style={calStyles.streakText}>{stats.currentStreak}d STREAK</Text>
          </View>
        )}
      </View>

      {/* Month labels */}
      <View style={calStyles.monthRow}>
        <View style={{ width: 14 }} />
        {monthLabels.map((m, i) => (
          <Text
            key={i}
            style={[calStyles.monthLabel, {
              position: 'absolute',
              left: 14 + m.weekIdx * (10 + 3),
            }]}
          >
            {m.label}
          </Text>
        ))}
      </View>

      {/* Grid */}
      <View style={calStyles.grid}>
        {/* Day labels */}
        <View style={calStyles.dayLabelCol}>
          {DAY_LABELS.map((l, i) => (
            <Text key={i} style={calStyles.dayLabel}>{l}</Text>
          ))}
        </View>

        {/* Week columns */}
        <View style={calStyles.weekCols}>
          {weeks.map((week, wi) => (
            <View key={wi} style={calStyles.weekCol}>
              {week.map((day) => (
                <View
                  key={day.date}
                  style={[
                    calStyles.cell,
                    {
                      backgroundColor: cellColor(day.depth, day.isFuture, day.isToday),
                    },
                    day.isToday && calStyles.cellToday,
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </View>

      {/* Stats row */}
      <View style={calStyles.statsRow}>
        <View style={calStyles.stat}>
          <Text style={calStyles.statValue}>{stats.activeDays}</Text>
          <Text style={calStyles.statLabel}>ACTIVE DAYS</Text>
        </View>
        <View style={calStyles.statDivider} />
        <View style={calStyles.stat}>
          <Text style={calStyles.statValue}>{stats.weeksWithSessions}/{stats.totalWeeks}</Text>
          <Text style={calStyles.statLabel}>WEEKS ACTIVE</Text>
        </View>
        <View style={calStyles.statDivider} />
        <View style={calStyles.stat}>
          <Text style={[calStyles.statValue, { color: Colors.cyan }]}>{stats.frequency}</Text>
          <Text style={calStyles.statLabel}>DAYS/WEEK</Text>
        </View>
        <View style={calStyles.statDivider} />
        <View style={calStyles.stat}>
          <Text style={calStyles.statValue}>{stats.maxStreak}d</Text>
          <Text style={calStyles.statLabel}>BEST STREAK</Text>
        </View>
      </View>
    </View>
  );
}

export default function AnalyticsScreen() {
  const router = useRouter();
  const { data: progression, isLoading } = useDepthProgression(365);
  const { data: workingDepth } = useWorkingDepth();
  const { data: monthly } = useMonthlyStats();
  const { data: locations } = useLocationPerformance();
  const { data: plateau } = usePlateauStatus();
  const { data: allSessions } = useSessions(100);
  const depthGoalM = useAppStore((s) => s.userSettings.depthGoalM);

  // Table history for breath hold progression
  const [tableHistory, setTableHistory] = useState<TableSessionRecord[]>([]);
  useEffect(() => { loadTableHistory().then(setTableHistory); }, []);

  const maxDepth = progression ? Math.max(...progression.map((p) => p.max_depth_m), 1) : 1;

  const [selectedBarIdx, setSelectedBarIdx] = useState<number | null>(null);
  const [selectedBandIdx, setSelectedBandIdx] = useState<number | null>(null);
  const slicedProg = progression ? progression.slice(-60) : [];

  // ── Linear regression on depth progression ──────────────────────────────────
  const trendData = useMemo(() => {
    if (!slicedProg || slicedProg.length < 6) return null;
    const n = slicedProg.length;
    const ys = slicedProg.map((p) => p.max_depth_m);
    const sumX  = (n * (n - 1)) / 2;
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    const sumY  = ys.reduce((a, b) => a + b, 0);
    const sumXY = ys.reduce((acc, y, i) => acc + i * y, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;
    const slope     = (n * sumXY - sumX * sumY) / denom;      // depth change per session
    const intercept = (sumY - slope * sumX) / n;

    // Convert slope (per session) → per month using date range
    const msPerMonth = 1000 * 60 * 60 * 24 * 30.44;
    const first = new Date(slicedProg[0].date).getTime();
    const last  = new Date(slicedProg[n - 1].date).getTime();
    const spanMonths = Math.max((last - first) / msPerMonth, 0.5);
    const sessionsPerMonth = n / spanMonths;
    const mPerMonth = slope * sessionsPerMonth;

    // Predict depth at each bar index (0-based, within the 60-bar window)
    const trendAt = (i: number) =>
      Math.max(1, Math.min(maxDepth * 1.1, slope * i + intercept));

    // Goal ETA: sessions until goal depth is hit
    let etaMonths: number | null = null;
    if (depthGoalM && slope > 0) {
      const sessionsNeeded = (depthGoalM - (slope * (n - 1) + intercept)) / slope;
      if (sessionsNeeded > 0) {
        etaMonths = sessionsNeeded / sessionsPerMonth;
      }
    }

    return { slope, intercept, mPerMonth, trendAt, etaMonths };
  }, [slicedProg, maxDepth, depthGoalM]);

  // Depth band distribution (from last 90 sessions)
  const bands = [
    { label: '0-5M',  min: 0,  max: 5  },
    { label: '5-10M', min: 5,  max: 10 },
    { label: '10-20M',min: 10, max: 20 },
    { label: '20-30M',min: 20, max: 30 },
    { label: '30M+',  min: 30, max: 999 },
  ];
  const bandCounts = bands.map((b) =>
    (progression ?? []).filter((p) => p.max_depth_m >= b.min && p.max_depth_m < b.max).length
  );
  const maxBand = Math.max(...bandCounts, 1);

  return (
    <View style={styles.root}>
      {/* App Bar */}
      <View style={styles.appBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.cyan} />
        </TouchableOpacity>
        <View style={styles.appBarCenter}>
          <MaterialIcons name="monitor" size={16} color={Colors.cyan} />
          <Text style={styles.appBarTitle}>METRICS HUB</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Plateau Detector Banner ── */}
        {plateau && (
          <FadeSlide delay={0}>
            <View style={[styles.plateauBanner, plateau.plateau && styles.plateauBannerActive]}>
              <View style={styles.plateauBannerLeft}>
                <View style={styles.plateauBannerTitleRow}>
                  <MaterialIcons
                    name={plateau.plateau ? 'warning' : 'trending-up'}
                    size={14}
                    color={plateau.plateau ? Colors.primary : '#4ade80'}
                  />
                  <Text style={[styles.plateauBannerTitle, { color: plateau.plateau ? Colors.primary : '#4ade80' }]}>
                    STATUS: {plateau.plateau ? 'PLATEAU DETECTED' : 'PROGRESSING'}
                  </Text>
                </View>
                <Text style={styles.plateauBannerSub}>
                  {plateau.days_since_improvement}d since last PB
                  {plateau.last_pb_depth_m ? ` · ${fmtDepth(plateau.last_pb_depth_m)} on ${plateau.last_pb_date}` : ''}
                </Text>
              </View>
              {plateau.suggestion && (
                <View style={styles.recommendBox}>
                  <Text style={styles.recommendLabel}>COMMAND RECOMMENDATION</Text>
                  <Text style={styles.recommendText}>{plateau.suggestion}</Text>
                </View>
              )}
            </View>
          </FadeSlide>
        )}

        {/* ── Bento row: Depth Band + Working Depth ── */}
        <FadeSlide delay={80}>
          <View style={styles.bentoRow}>
            {/* Depth Band Distribution */}
            <View style={[styles.glassCard, { flex: 1, marginRight: 8 }]}>
              <Text style={styles.cardTitle}>DEPTH BANDS</Text>
              <Text style={styles.cardSub}>Dive density by zone</Text>
              {isLoading
                ? <ActivityIndicator color={Colors.cyan} style={{ marginTop: 16 }} />
                : (
                  <View style={styles.histogram}>
                    {bands.map((b, i) => {
                      const pct = bandCounts[i] / maxBand;
                      const isMax = bandCounts[i] === maxBand;
                      const isSelected = selectedBandIdx === i;
                      return (
                        <Pressable key={b.label} style={styles.histBarWrap} onPress={() => setSelectedBandIdx(isSelected ? null : i)}>
                          <View style={styles.histBarTrack}>
                            <View style={[
                              styles.histBar,
                              { height: `${Math.max(5, pct * 100)}%` as any,
                                backgroundColor: isSelected ? Colors.cyan : isMax ? Colors.primaryDim + 'aa' : Colors.primaryDim + '55' },
                            ]} />
                          </View>
                          <Text style={[styles.histLabel, (isMax || isSelected) && { color: Colors.cyan }]}>
                            {isSelected ? `×${bandCounts[i]}` : b.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
            </View>

            {/* Working Depth */}
            {workingDepth && (
              <View style={[styles.glassCard, { flex: 1, justifyContent: 'space-between' }]}>
                <Text style={[styles.cardTitle, { color: Colors.primaryDim }]}>WORKING DEPTH</Text>
                <Text style={styles.cardSub}>70th percentile</Text>
                <View style={styles.workingBig}>
                  <MaterialIcons name="waves" size={28} color={Colors.primary} style={{ opacity: 0.15, position: 'absolute', right: -4, top: -4 }} />
                  <Text style={styles.workingValue}>{workingDepth.working_depth_m.toFixed(1)}</Text>
                  <Text style={styles.workingUnit}>m</Text>
                </View>
                <View style={styles.workingRows}>
                  <View style={styles.workingRow}>
                    <Text style={styles.workingRowLabel}>PB</Text>
                    <Text style={[styles.workingRowValue, { color: Colors.cyan }]}>{fmtDepth(workingDepth.pb_depth_m)}</Text>
                  </View>
                  <View style={styles.workingRow}>
                    <Text style={styles.workingRowLabel}>AVG</Text>
                    <Text style={styles.workingRowValue}>{fmtDepth(workingDepth.avg_depth_m)}</Text>
                  </View>
                  <View style={styles.workingRow}>
                    <Text style={styles.workingRowLabel}>SESSIONS</Text>
                    <Text style={styles.workingRowValue}>{workingDepth.session_count}</Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        </FadeSlide>

        {/* ── Depth Progression (full bar chart) ── */}
        <FadeSlide delay={160}>
          <View style={styles.glassCard}>
            <View style={styles.chartHeader}>
              <View>
                <Text style={styles.cardTitle}>DEPTH PROGRESSION</Text>
                <Text style={styles.cardSub}>Last 12 months · bar = session max</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {trendData && (
                  <View style={[styles.trendBadge, { backgroundColor: trendData.mPerMonth >= 0.05 ? '#4ade8020' : '#facc1520' }]}>
                    <Text style={[styles.trendBadgeText, { color: trendData.mPerMonth >= 0.05 ? '#4ade80' : '#facc15' }]}>
                      {trendData.mPerMonth >= 0.05 ? '↑' : trendData.mPerMonth <= -0.05 ? '↓' : '→'}{' '}
                      {Math.abs(trendData.mPerMonth) >= 0.05 ? `+${trendData.mPerMonth.toFixed(1)}m/mo` : 'flat'}
                    </Text>
                  </View>
                )}
                <View style={styles.chartLegend}>
                  <View style={[styles.legendDot, { backgroundColor: Colors.cyan }]} />
                  <Text style={styles.legendText}>PB</Text>
                </View>
              </View>
            </View>
            {selectedBarIdx !== null && slicedProg[selectedBarIdx] && (
              <Pressable
                style={styles.barTooltip}
                onPress={() => router.push(`/session/${slicedProg[selectedBarIdx!].session_id}` as any)}
              >
                <MaterialIcons name="place" size={10} color={Colors.cyan} />
                <Text style={styles.barTooltipText}>
                  {slicedProg[selectedBarIdx].date}
                  {'  ·  '}
                  <Text style={{ color: Colors.cyan }}>{slicedProg[selectedBarIdx].max_depth_m.toFixed(1)}m</Text>
                </Text>
                <MaterialIcons name="chevron-right" size={14} color={Colors.outline} style={{ marginLeft: 4 }} />
              </Pressable>
            )}
            {isLoading
              ? <ActivityIndicator color={Colors.cyan} />
              : progression && progression.length > 0 && (
                <View style={styles.bigChart}>
                  {slicedProg.map((p, i) => {
                    const barH = Math.max(3, (p.max_depth_m / maxDepth) * CHART_H);
                    const isPb = p.max_depth_m === workingDepth?.pb_depth_m;
                    const isSelected = selectedBarIdx === i;
                    const trendH = trendData
                      ? Math.max(1, Math.min(CHART_H, (trendData.trendAt(i) / maxDepth) * CHART_H))
                      : null;
                    return (
                      <Pressable
                        key={p.session_id}
                        style={styles.bigBarOuter}
                        onPress={() => setSelectedBarIdx(isSelected ? null : i)}
                      >
                        {/* Colored bar, anchored to bottom */}
                        <View style={[styles.bigBarFill, {
                          height: barH,
                          backgroundColor: isSelected ? Colors.cyan : isPb ? Colors.primaryDim + 'cc' : Colors.primaryDim + '50',
                        }]} />
                        {/* Trend dot */}
                        {trendH !== null && (
                          <View style={[styles.trendDot, { bottom: trendH - 1.5 }]} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            <View style={styles.chartAxisRow}>
              <Text style={styles.axisLabel}>60 SESSIONS AGO</Text>
              <Text style={[styles.axisLabel, { color: Colors.outline + '80' }]}>TAP BAR FOR DETAILS</Text>
              <Text style={styles.axisLabel}>TODAY</Text>
            </View>
            {trendData?.etaMonths != null && (
              <View style={styles.etaRow}>
                <MaterialIcons name="flag" size={10} color={Colors.cyan} />
                <Text style={styles.etaText}>
                  Goal {depthGoalM}m · est. {trendData.etaMonths < 1
                    ? `${Math.round(trendData.etaMonths * 30)}d`
                    : `${trendData.etaMonths.toFixed(1)} mo`} at current rate
                </Text>
              </View>
            )}
          </View>
        </FadeSlide>

        {/* ── PB Milestone Staircase ── */}
        {progression && progression.length >= 3 && (() => {
          // Derive PB milestones: walk chronologically, track running max
          const sorted = [...progression].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
          );
          let runningMax = 0;
          const milestones: { date: string; depth: number; sessionId: number; jump: number; daysSinceLast: number }[] = [];
          for (const p of sorted) {
            if (p.max_depth_m > runningMax) {
              const jump = p.max_depth_m - runningMax;
              const daysSinceLast = milestones.length > 0
                ? Math.round((new Date(p.date).getTime() - new Date(milestones[milestones.length - 1].date).getTime()) / 86400000)
                : 0;
              milestones.push({ date: p.date, depth: p.max_depth_m, sessionId: p.session_id, jump, daysSinceLast });
              runningMax = p.max_depth_m;
            }
          }
          if (milestones.length < 2) return null;

          const minD = milestones[0].depth;
          const maxD = milestones[milestones.length - 1].depth;
          const range = Math.max(maxD - minD, 0.5);
          const STAIR_H = 80;

          // Stats
          const avgGap = milestones.slice(1).reduce((s, m) => s + m.daysSinceLast, 0) / (milestones.length - 1);
          const biggestJump = Math.max(...milestones.map((m) => m.jump));
          const totalGain = maxD - minD;
          const firstDate = new Date(milestones[0].date);
          const lastDate = new Date(milestones[milestones.length - 1].date);
          const spanMonths = Math.max((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44), 0.5);

          // Staircase points (normalized x/y for the chart)
          const dateMin = firstDate.getTime();
          const dateMax = lastDate.getTime();
          const dateRange = Math.max(dateMax - dateMin, 1);

          return (
            <FadeSlide delay={190}>
              <View style={styles.glassCard}>
                <View style={styles.chartHeader}>
                  <View>
                    <Text style={styles.cardTitle}>PB MILESTONES</Text>
                    <Text style={styles.cardSub}>{milestones.length} personal bests · {fmtDepth(minD)} to {fmtDepth(maxD)}</Text>
                  </View>
                  <View style={[styles.trendBadge, { backgroundColor: '#4ade8020' }]}>
                    <Text style={[styles.trendBadgeText, { color: '#4ade80' }]}>
                      +{totalGain.toFixed(1)}m in {spanMonths.toFixed(0)}mo
                    </Text>
                  </View>
                </View>

                {/* Staircase chart */}
                <View style={pbStyles.chart}>
                  {/* Y-axis labels */}
                  <View style={pbStyles.yAxis}>
                    <Text style={pbStyles.yLabel}>{fmtDepth(maxD)}</Text>
                    <Text style={pbStyles.yLabel}>{fmtDepth(minD)}</Text>
                  </View>
                  {/* Chart area */}
                  <View style={pbStyles.chartArea}>
                    {/* Grid lines */}
                    <View style={[pbStyles.gridLine, { top: 0 }]} />
                    <View style={[pbStyles.gridLine, { top: '50%' }]} />
                    <View style={[pbStyles.gridLine, { bottom: 0 }]} />
                    {/* Staircase steps */}
                    {milestones.map((m, i) => {
                      const x = ((new Date(m.date).getTime() - dateMin) / dateRange) * 100;
                      const y = ((m.depth - minD) / range) * 100;
                      const nextX = i < milestones.length - 1
                        ? ((new Date(milestones[i + 1].date).getTime() - dateMin) / dateRange) * 100
                        : 100;
                      return (
                        <React.Fragment key={m.sessionId}>
                          {/* Horizontal step line */}
                          <View style={[pbStyles.stepH, {
                            left: `${x}%`,
                            width: `${nextX - x}%`,
                            bottom: `${y}%`,
                          } as any]} />
                          {/* Vertical rise line */}
                          {i > 0 && (() => {
                            const prevY = ((milestones[i - 1].depth - minD) / range) * 100;
                            return (
                              <View style={[pbStyles.stepV, {
                                left: `${x}%`,
                                bottom: `${prevY}%`,
                                height: `${y - prevY}%`,
                              } as any]} />
                            );
                          })()}
                          {/* PB dot */}
                          <Pressable
                            style={[pbStyles.dot, {
                              left: `${x}%`,
                              bottom: `${y}%`,
                            } as any]}
                            onPress={() => router.push(`/session/${m.sessionId}` as any)}
                          >
                            <View style={pbStyles.dotInner} />
                          </Pressable>
                        </React.Fragment>
                      );
                    })}
                  </View>
                </View>
                {/* X-axis */}
                <View style={styles.chartAxisRow}>
                  <Text style={styles.axisLabel}>
                    {firstDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                  </Text>
                  <Text style={[styles.axisLabel, { color: Colors.outline + '80' }]}>TAP DOT TO VIEW</Text>
                  <Text style={styles.axisLabel}>
                    {lastDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                  </Text>
                </View>

                {/* Stats row */}
                <View style={pbStyles.statsRow}>
                  <View style={pbStyles.stat}>
                    <Text style={pbStyles.statValue}>{milestones.length}</Text>
                    <Text style={pbStyles.statLabel}>PBs SET</Text>
                  </View>
                  <View style={pbStyles.statDivider} />
                  <View style={pbStyles.stat}>
                    <Text style={[pbStyles.statValue, { color: Colors.cyan }]}>{biggestJump.toFixed(1)}<Text style={pbStyles.statUnit}>m</Text></Text>
                    <Text style={pbStyles.statLabel}>BIGGEST JUMP</Text>
                  </View>
                  <View style={pbStyles.statDivider} />
                  <View style={pbStyles.stat}>
                    <Text style={pbStyles.statValue}>{Math.round(avgGap)}<Text style={pbStyles.statUnit}>d</Text></Text>
                    <Text style={pbStyles.statLabel}>AVG GAP</Text>
                  </View>
                  <View style={pbStyles.statDivider} />
                  <View style={pbStyles.stat}>
                    <Text style={[pbStyles.statValue, { color: '#4ade80' }]}>{(totalGain / spanMonths).toFixed(1)}<Text style={pbStyles.statUnit}>m</Text></Text>
                    <Text style={pbStyles.statLabel}>PER MONTH</Text>
                  </View>
                </View>
              </View>
            </FadeSlide>
          );
        })()}

        {/* ── Monthly Stats ── */}
        {monthly && monthly.length > 0 && (
          <FadeSlide delay={220}>
            <Text style={styles.sectionLabel}>MONTHLY VOLUME</Text>
            <View style={[styles.glassCard, { padding: 0, overflow: 'hidden' }]}>
              <View style={[styles.monthRow, styles.monthHeader]}>
                <Text style={[styles.monthCell, styles.monthHeaderText]}>MONTH</Text>
                <Text style={[styles.monthCell, styles.monthHeaderText]}>SESS.</Text>
                <Text style={[styles.monthCell, styles.monthHeaderText]}>MAX</Text>
                <Text style={[styles.monthCell, styles.monthHeaderText]}>AVG</Text>
                <Text style={[styles.monthCell, styles.monthHeaderText]}>UW TIME</Text>
              </View>
              {monthly.slice(-8).reverse().map((m, i) => {
                const btMin = Math.round(m.total_bottom_time_s / 60);
                return (
                  <View key={m.month} style={[styles.monthRow, i > 0 && styles.monthDivider]}>
                    <Text style={[styles.monthCell, styles.monthNameText]}>{fmtMonth(m.month)}</Text>
                    <Text style={[styles.monthCell, styles.monthDataText]}>{m.session_count}</Text>
                    <Text style={[styles.monthCell, { color: Colors.cyan, fontSize: 13, fontWeight: '600' }]}>{fmtDepth(m.max_depth_m)}</Text>
                    <Text style={[styles.monthCell, styles.monthDataText]}>{fmtDepth(m.avg_depth_m)}</Text>
                    <Text style={[styles.monthCell, styles.monthDataText]}>{btMin}m</Text>
                  </View>
                );
              })}
            </View>
          </FadeSlide>
        )}

        {/* ── Training Calendar (heatmap) ── */}
        {progression && progression.length > 2 && (
          <FadeSlide delay={250}>
            <TrainingCalendar progression={progression} />
          </FadeSlide>
        )}

        {/* ── Training Load ── */}
        {progression && progression.length >= 5 && (() => {
          const today = new Date();
          today.setHours(23, 59, 59, 999);
          const NUM_WEEKS = 8;

          // Build weekly buckets (Mon-Sun), newest first internally then reversed for display
          const weekBuckets: { start: Date; totalDepth: number; sessions: number }[] = [];
          const dayOfWeek = today.getDay();
          const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          const thisMon = new Date(today);
          thisMon.setDate(thisMon.getDate() + mondayOffset);
          thisMon.setHours(0, 0, 0, 0);

          for (let w = 0; w < NUM_WEEKS; w++) {
            const start = new Date(thisMon);
            start.setDate(start.getDate() - w * 7);
            weekBuckets.push({ start, totalDepth: 0, sessions: 0 });
          }

          for (const p of progression) {
            const d = new Date(p.date);
            for (const wb of weekBuckets) {
              const end = new Date(wb.start);
              end.setDate(end.getDate() + 7);
              if (d >= wb.start && d < end) {
                wb.totalDepth += p.max_depth_m;
                wb.sessions++;
                break;
              }
            }
          }

          // Reverse so oldest is first (left) for display
          const weeks = [...weekBuckets].reverse();
          const maxVol = Math.max(...weeks.map((w) => w.totalDepth), 1);

          // ACWR: acute (last 7 days) / chronic (28-day avg per week)
          const acute = weekBuckets[0].totalDepth; // current week
          const chronic = weekBuckets.slice(0, 4).reduce((s, w) => s + w.totalDepth, 0) / 4;
          const acwr = chronic > 0 ? acute / chronic : acute > 0 ? 2.0 : 0;

          // Status classification
          let loadStatus: string;
          let loadColor: string;
          let loadIcon: 'trending-down' | 'remove' | 'check-circle' | 'warning' | 'error';
          if (acwr < 0.5) {
            loadStatus = 'DETRAINING'; loadColor = Colors.outline; loadIcon = 'trending-down';
          } else if (acwr < 0.8) {
            loadStatus = 'LOW LOAD'; loadColor = '#60a5fa'; loadIcon = 'remove';
          } else if (acwr <= 1.3) {
            loadStatus = 'OPTIMAL'; loadColor = '#4ade80'; loadIcon = 'check-circle';
          } else if (acwr <= 1.5) {
            loadStatus = 'HIGH LOAD'; loadColor = '#facc15'; loadIcon = 'warning';
          } else {
            loadStatus = 'DANGER ZONE'; loadColor = Colors.error; loadIcon = 'error';
          }

          // Trend: this week vs last week
          const thisWeekVol = weekBuckets[0].totalDepth;
          const lastWeekVol = weekBuckets[1]?.totalDepth ?? 0;
          const volDelta = lastWeekVol > 0 ? Math.round(((thisWeekVol - lastWeekVol) / lastWeekVol) * 100) : 0;

          return (
            <FadeSlide delay={260}>
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>TRAINING LOAD</Text>
              <View style={styles.glassCard}>
                {/* Status header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name={loadIcon} size={14} color={loadColor} />
                      <Text style={[styles.cardTitle, { color: loadColor, marginBottom: 0 }]}>{loadStatus}</Text>
                    </View>
                    <Text style={[styles.cardSub, { marginBottom: 0, marginTop: 2 }]}>
                      Acute:Chronic ratio · {acwr.toFixed(2)}
                    </Text>
                  </View>
                  <View style={[tlStyles.acwrBadge, { borderColor: loadColor + '40' }]}>
                    <Text style={[tlStyles.acwrValue, { color: loadColor }]}>{acwr.toFixed(2)}</Text>
                    <Text style={tlStyles.acwrLabel}>ACWR</Text>
                  </View>
                </View>

                {/* ACWR gauge bar */}
                <View style={tlStyles.gaugeTrack}>
                  {/* Zone segments */}
                  <View style={[tlStyles.gaugeZone, { flex: 25, backgroundColor: Colors.outline + '25' }]} />
                  <View style={[tlStyles.gaugeZone, { flex: 15, backgroundColor: '#60a5fa20' }]} />
                  <View style={[tlStyles.gaugeZone, { flex: 25, backgroundColor: '#4ade8020' }]} />
                  <View style={[tlStyles.gaugeZone, { flex: 10, backgroundColor: '#facc1520' }]} />
                  <View style={[tlStyles.gaugeZone, { flex: 25, backgroundColor: Colors.error + '20' }]} />
                  {/* Needle */}
                  <View style={[tlStyles.gaugeNeedle, {
                    left: `${Math.min(Math.max(acwr / 2, 0), 1) * 100}%`,
                    backgroundColor: loadColor,
                  } as any]} />
                </View>
                <View style={tlStyles.gaugeLabels}>
                  <Text style={tlStyles.gaugeLabel}>0</Text>
                  <Text style={tlStyles.gaugeLabel}>0.8</Text>
                  <Text style={tlStyles.gaugeLabel}>1.3</Text>
                  <Text style={tlStyles.gaugeLabel}>2.0</Text>
                </View>

                {/* Weekly volume bars */}
                <Text style={[styles.cardTitle, { marginTop: 16, marginBottom: 8 }]}>WEEKLY VOLUME</Text>
                <View style={tlStyles.barChart}>
                  {weeks.map((w, i) => {
                    const h = Math.max(3, (w.totalDepth / maxVol) * 60);
                    const isThis = i === weeks.length - 1;
                    return (
                      <View key={i} style={tlStyles.barCol}>
                        <Text style={tlStyles.barValue}>
                          {w.totalDepth > 0 ? `${Math.round(w.totalDepth)}` : ''}
                        </Text>
                        <View style={[tlStyles.bar, {
                          height: h,
                          backgroundColor: isThis ? loadColor : w.totalDepth > 0 ? Colors.primaryDim + '60' : Colors.surfaceHighest,
                        }]} />
                        <Text style={[tlStyles.barLabel, isThis && { color: loadColor }]}>
                          {isThis ? 'NOW' : `W${i + 1}`}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {/* Stats row */}
                <View style={tlStyles.statsRow}>
                  <View style={tlStyles.stat}>
                    <Text style={tlStyles.statValue}>{Math.round(acute)}<Text style={tlStyles.statUnit}>m</Text></Text>
                    <Text style={tlStyles.statLabel}>THIS WEEK</Text>
                  </View>
                  <View style={tlStyles.statDivider} />
                  <View style={tlStyles.stat}>
                    <Text style={tlStyles.statValue}>{Math.round(chronic)}<Text style={tlStyles.statUnit}>m</Text></Text>
                    <Text style={tlStyles.statLabel}>4-WK AVG</Text>
                  </View>
                  <View style={tlStyles.statDivider} />
                  <View style={tlStyles.stat}>
                    <Text style={[tlStyles.statValue, { color: volDelta > 0 ? '#4ade80' : volDelta < 0 ? Colors.error : Colors.outline }]}>
                      {volDelta > 0 ? '+' : ''}{volDelta}%
                    </Text>
                    <Text style={tlStyles.statLabel}>vs LAST WK</Text>
                  </View>
                  <View style={tlStyles.statDivider} />
                  <View style={tlStyles.stat}>
                    <Text style={tlStyles.statValue}>{weekBuckets[0].sessions}</Text>
                    <Text style={tlStyles.statLabel}>SESSIONS</Text>
                  </View>
                </View>

                {/* Coaching note */}
                <View style={[tlStyles.coachNote, { borderLeftColor: loadColor }]}>
                  <Text style={tlStyles.coachText}>
                    {acwr < 0.5
                      ? 'Volume is well below your recent average. Consider getting back in the water to maintain adaptations.'
                      : acwr < 0.8
                      ? 'Training load is below average. Good for recovery weeks, but don\'t stay here too long.'
                      : acwr <= 1.3
                      ? 'Training load is in the sweet spot. Keep this consistency for steady progression.'
                      : acwr <= 1.5
                      ? 'Load is ramping up. Monitor fatigue and recovery closely. Consider an easier session next.'
                      : 'Volume spike detected — high injury and fatigue risk. Scale back next session and prioritize recovery.'}
                  </Text>
                </View>
              </View>
            </FadeSlide>
          );
        })()}

        {/* ── Table Performance ── */}
        {tableHistory.length >= 2 && (() => {
          // Reverse to oldest→newest for chart
          const sorted = [...tableHistory].reverse();
          const last20 = sorted.slice(-20);
          const maxHoldTime = Math.max(...last20.map((r) => r.totalHoldTimeS), 1);
          const perfectCount = tableHistory.filter((r) => r.holdsCompleted === r.totalSets).length;
          const avgCompletion = tableHistory.reduce((s, r) => s + (r.totalSets > 0 ? r.holdsCompleted / r.totalSets : 0), 0) / tableHistory.length;
          const bestHoldTime = Math.max(...tableHistory.map((r) => r.totalHoldTimeS));
          const totalSessions = tableHistory.length;

          // Group by protocol for breakdown
          const byProtocol = new Map<string, { name: string; color: string; count: number; bestHold: number; perfectCount: number }>();
          for (const r of tableHistory) {
            const existing = byProtocol.get(r.protocolKey);
            if (existing) {
              existing.count++;
              existing.bestHold = Math.max(existing.bestHold, r.totalHoldTimeS);
              if (r.holdsCompleted === r.totalSets) existing.perfectCount++;
            } else {
              byProtocol.set(r.protocolKey, {
                name: r.protocolName,
                color: r.protocolColor,
                count: 1,
                bestHold: r.totalHoldTimeS,
                perfectCount: r.holdsCompleted === r.totalSets ? 1 : 0,
              });
            }
          }

          return (
            <FadeSlide delay={280}>
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>TABLE PERFORMANCE</Text>
              <View style={styles.glassCard}>
                <View style={styles.chartHeader}>
                  <View>
                    <Text style={styles.cardTitle}>HOLD TIME PROGRESSION</Text>
                    <Text style={styles.cardSub}>Last {last20.length} sessions · bar = total hold time</Text>
                  </View>
                  {perfectCount > 0 && (
                    <View style={tpStyles.perfectBadge}>
                      <MaterialIcons name="star" size={9} color="#facc15" />
                      <Text style={tpStyles.perfectBadgeText}>{perfectCount}× PERFECT</Text>
                    </View>
                  )}
                </View>

                {/* Bar chart */}
                <View style={tpStyles.chart}>
                  {last20.map((r, i) => {
                    const h = Math.max(3, (r.totalHoldTimeS / maxHoldTime) * 80);
                    const pct = r.totalSets > 0 ? r.holdsCompleted / r.totalSets : 0;
                    const isPerfect = pct === 1;
                    return (
                      <View key={r.id ?? i} style={tpStyles.barWrap}>
                        <View style={[tpStyles.bar, {
                          height: h,
                          backgroundColor: isPerfect ? '#4ade80' : pct >= 0.75 ? Colors.cyan : Colors.orange,
                          opacity: isPerfect ? 1 : 0.6,
                        }]} />
                      </View>
                    );
                  })}
                </View>
                <View style={styles.chartAxisRow}>
                  <Text style={styles.axisLabel}>OLDEST</Text>
                  <Text style={styles.axisLabel}>LATEST</Text>
                </View>

                {/* Summary stats */}
                <View style={tpStyles.statsRow}>
                  <View style={tpStyles.stat}>
                    <Text style={tpStyles.statValue}>{totalSessions}</Text>
                    <Text style={tpStyles.statLabel}>SESSIONS</Text>
                  </View>
                  <View style={tpStyles.statDivider} />
                  <View style={tpStyles.stat}>
                    <Text style={[tpStyles.statValue, { color: Colors.cyan }]}>{fmtTimer(bestHoldTime)}</Text>
                    <Text style={tpStyles.statLabel}>BEST HOLD</Text>
                  </View>
                  <View style={tpStyles.statDivider} />
                  <View style={tpStyles.stat}>
                    <Text style={[tpStyles.statValue, { color: '#4ade80' }]}>{Math.round(avgCompletion * 100)}%</Text>
                    <Text style={tpStyles.statLabel}>AVG COMP.</Text>
                  </View>
                  <View style={tpStyles.statDivider} />
                  <View style={tpStyles.stat}>
                    <Text style={[tpStyles.statValue, { color: '#facc15' }]}>{perfectCount}</Text>
                    <Text style={tpStyles.statLabel}>PERFECT</Text>
                  </View>
                </View>

                {/* Per-protocol breakdown */}
                {byProtocol.size > 1 && (
                  <View style={tpStyles.protoSection}>
                    <Text style={tpStyles.protoLabel}>BY PROTOCOL</Text>
                    {Array.from(byProtocol.entries()).map(([key, p]) => (
                      <View key={key} style={tpStyles.protoRow}>
                        <View style={[tpStyles.protoDot, { backgroundColor: p.color }]} />
                        <Text style={tpStyles.protoName}>{p.name}</Text>
                        <Text style={tpStyles.protoCount}>{p.count}×</Text>
                        <Text style={tpStyles.protoBest}>{fmtTimer(p.bestHold)}</Text>
                        {p.perfectCount > 0 && (
                          <Text style={tpStyles.protoPerfect}>{p.perfectCount} perfect</Text>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </FadeSlide>
          );
        })()}

        {/* ── CO₂ Tolerance Trend (from contraction tracking) ── */}
        {(() => {
          // Sessions that have contraction data with at least one hold tracked
          const withCx = tableHistory.filter(
            (r) => r.contractions && r.contractions.some((c) => c.count > 0),
          );
          if (withCx.length < 2) return null;

          // For each session, compute average time-to-first-contraction
          const dataPoints = withCx.map((r) => {
            const tracked = (r.contractions ?? []).filter((c) => c.count > 0 && c.firstAtS != null);
            const avgFirst = tracked.length > 0
              ? tracked.reduce((s, c) => s + (c.firstAtS ?? 0), 0) / tracked.length
              : 0;
            const totalCx = (r.contractions ?? []).reduce((s, c) => s + c.count, 0);
            return { date: r.date, avgFirstS: avgFirst, totalCx, protocolName: r.protocolName };
          }).reverse(); // oldest first

          const maxFirst = Math.max(...dataPoints.map((d) => d.avgFirstS), 15);
          const latest = dataPoints[dataPoints.length - 1];
          const earliest = dataPoints[0];

          // Trend: compare first half to second half
          const mid = Math.floor(dataPoints.length / 2);
          const firstHalf = dataPoints.slice(0, mid);
          const secondHalf = dataPoints.slice(mid);
          const avgFirst1 = firstHalf.reduce((s, d) => s + d.avgFirstS, 0) / firstHalf.length;
          const avgFirst2 = secondHalf.reduce((s, d) => s + d.avgFirstS, 0) / secondHalf.length;
          const trendPct = avgFirst1 > 0 ? ((avgFirst2 - avgFirst1) / avgFirst1) * 100 : 0;
          const improving = trendPct > 5;
          const declining = trendPct < -5;
          const trendLabel = improving ? 'IMPROVING' : declining ? 'DECLINING' : 'STABLE';
          const trendColor = improving ? '#4ade80' : declining ? Colors.error : Colors.cyan;

          return (
            <FadeSlide delay={300}>
              <View style={[styles.glassCard, { marginTop: 16 }]}>
                <View style={styles.chartHeader}>
                  <View>
                    <Text style={styles.cardTitle}>CO₂ TOLERANCE TREND</Text>
                    <Text style={styles.cardSub}>Avg time-to-first-contraction · {dataPoints.length} sessions</Text>
                  </View>
                  <View style={[cxStyles.trendBadge, { backgroundColor: trendColor + '18', borderColor: trendColor + '40' }]}>
                    <MaterialIcons
                      name={improving ? 'trending-up' : declining ? 'trending-down' : 'trending-flat'}
                      size={10}
                      color={trendColor}
                    />
                    <Text style={[cxStyles.trendText, { color: trendColor }]}>{trendLabel}</Text>
                  </View>
                </View>

                {/* Line chart of avg time-to-first-contraction */}
                <View style={cxStyles.chart}>
                  {dataPoints.map((d, i) => {
                    const h = Math.max(4, (d.avgFirstS / maxFirst) * 72);
                    const isLatest = i === dataPoints.length - 1;
                    return (
                      <View key={i} style={cxStyles.barWrap}>
                        <View style={[cxStyles.bar, {
                          height: h,
                          backgroundColor: isLatest ? Colors.orange : Colors.orange + '60',
                        }]} />
                        {isLatest && <View style={[cxStyles.dot, { backgroundColor: Colors.orange }]} />}
                      </View>
                    );
                  })}
                </View>
                <View style={styles.chartAxisRow}>
                  <Text style={styles.axisLabel}>OLDEST</Text>
                  <Text style={styles.axisLabel}>LATEST</Text>
                </View>

                {/* Stats */}
                <View style={cxStyles.statsRow}>
                  <View style={cxStyles.stat}>
                    <Text style={[cxStyles.statValue, { color: Colors.orange }]}>{fmtTimer(Math.round(latest.avgFirstS))}</Text>
                    <Text style={cxStyles.statLabel}>LATEST AVG</Text>
                  </View>
                  <View style={cxStyles.divider} />
                  <View style={cxStyles.stat}>
                    <Text style={cxStyles.statValue}>
                      {trendPct > 0 ? '+' : ''}{Math.round(trendPct)}%
                    </Text>
                    <Text style={cxStyles.statLabel}>CHANGE</Text>
                  </View>
                  <View style={cxStyles.divider} />
                  <View style={cxStyles.stat}>
                    <Text style={cxStyles.statValue}>
                      {fmtTimer(Math.round(Math.max(...dataPoints.map((d) => d.avgFirstS))))}
                    </Text>
                    <Text style={cxStyles.statLabel}>BEST</Text>
                  </View>
                </View>

                {/* Coaching note */}
                <View style={cxStyles.tip}>
                  <MaterialIcons name="lightbulb-outline" size={11} color={Colors.outline} />
                  <Text style={cxStyles.tipText}>
                    {improving
                      ? 'CO₂ tolerance is building — contractions starting later means your body is adapting to higher CO₂ levels. Keep training consistently.'
                      : declining
                        ? 'Time-to-first-contraction is dropping. Consider longer rest between table sessions and check sleep/recovery quality.'
                        : 'Tolerance is holding steady. To push further, try adding 15s to your CO₂ table hold times.'}
                  </Text>
                </View>
              </View>
            </FadeSlide>
          );
        })()}

        {/* ── Recovery Pattern ── */}
        {progression && progression.length >= 8 && (() => {
          // Sort sessions chronologically
          const sorted = [...progression].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
          );

          // Compute rest days before each session and pair with depth
          const restPairs: { restDays: number; depth: number }[] = [];
          for (let i = 1; i < sorted.length; i++) {
            const gap = Math.round(
              (new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86400000
            );
            if (gap >= 0 && gap <= 30) { // ignore gaps > 30 days (travel breaks etc)
              restPairs.push({ restDays: gap, depth: sorted[i].max_depth_m });
            }
          }
          if (restPairs.length < 5) return null;

          // Bucket into rest-day ranges
          const buckets = [
            { label: 'B2B',  min: 0, max: 0,  icon: 'bolt' as const },
            { label: '1d',   min: 1, max: 1,  icon: 'schedule' as const },
            { label: '2d',   min: 2, max: 2,  icon: 'schedule' as const },
            { label: '3-4d', min: 3, max: 4,  icon: 'schedule' as const },
            { label: '5-7d', min: 5, max: 7,  icon: 'event' as const },
            { label: '8d+',  min: 8, max: 30, icon: 'event' as const },
          ];

          const bucketData = buckets.map((b) => {
            const matching = restPairs.filter((p) => p.restDays >= b.min && p.restDays <= b.max);
            const avg = matching.length > 0
              ? matching.reduce((s, p) => s + p.depth, 0) / matching.length
              : 0;
            return { ...b, count: matching.length, avgDepth: avg };
          }).filter((b) => b.count > 0);

          if (bucketData.length < 2) return null;

          const maxAvgDepth = Math.max(...bucketData.map((b) => b.avgDepth), 1);
          const bestBucket = bucketData.reduce((best, b) => b.avgDepth > best.avgDepth ? b : best, bucketData[0]);

          // Find overall avg depth for comparison
          const overallAvg = restPairs.reduce((s, p) => s + p.depth, 0) / restPairs.length;

          return (
            <FadeSlide delay={310}>
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>RECOVERY PATTERN</Text>
              <View style={styles.glassCard}>
                <View style={styles.chartHeader}>
                  <View>
                    <Text style={styles.cardTitle}>REST vs PERFORMANCE</Text>
                    <Text style={styles.cardSub}>Avg depth after N rest days · {restPairs.length} sessions</Text>
                  </View>
                  <View style={rpStyles.sweetBadge}>
                    <MaterialIcons name="hotel" size={9} color={Colors.cyan} />
                    <Text style={rpStyles.sweetText}>SWEET SPOT: {bestBucket.label}</Text>
                  </View>
                </View>

                {/* Bar chart: rest interval → avg depth */}
                <View style={rpStyles.chart}>
                  {bucketData.map((b, i) => {
                    const pct = b.avgDepth / maxAvgDepth;
                    const isBest = b === bestBucket;
                    const aboveAvg = b.avgDepth >= overallAvg;
                    return (
                      <View key={b.label} style={rpStyles.barCol}>
                        <Text style={rpStyles.barValue}>
                          {b.avgDepth.toFixed(1)}
                        </Text>
                        <View style={[rpStyles.bar, {
                          height: Math.max(6, pct * 70),
                          backgroundColor: isBest ? Colors.cyan
                            : aboveAvg ? Colors.cyan + '60'
                            : Colors.outline + '40',
                        }]}>
                          {isBest && <View style={rpStyles.bestDot} />}
                        </View>
                        <Text style={[rpStyles.barLabel, isBest && { color: Colors.cyan }]}>
                          {b.label}
                        </Text>
                        <Text style={rpStyles.barCount}>×{b.count}</Text>
                      </View>
                    );
                  })}
                </View>

                {/* Average line label */}
                <View style={rpStyles.avgRow}>
                  <View style={rpStyles.avgLine} />
                  <Text style={rpStyles.avgText}>avg {overallAvg.toFixed(1)}m</Text>
                  <View style={rpStyles.avgLine} />
                </View>

                {/* Stats */}
                <View style={rpStyles.statsRow}>
                  <View style={rpStyles.stat}>
                    <Text style={[rpStyles.statValue, { color: Colors.cyan }]}>{bestBucket.label}</Text>
                    <Text style={rpStyles.statLabel}>OPTIMAL REST</Text>
                  </View>
                  <View style={rpStyles.statDivider} />
                  <View style={rpStyles.stat}>
                    <Text style={rpStyles.statValue}>{bestBucket.avgDepth.toFixed(1)}<Text style={rpStyles.statUnit}>m</Text></Text>
                    <Text style={rpStyles.statLabel}>AVG AT BEST</Text>
                  </View>
                  <View style={rpStyles.statDivider} />
                  <View style={rpStyles.stat}>
                    <Text style={rpStyles.statValue}>
                      {bestBucket.avgDepth > overallAvg
                        ? `+${((bestBucket.avgDepth / overallAvg - 1) * 100).toFixed(0)}%`
                        : '—'}
                    </Text>
                    <Text style={rpStyles.statLabel}>vs AVERAGE</Text>
                  </View>
                </View>

                {/* Coaching note */}
                <View style={rpStyles.coachNote}>
                  <MaterialIcons name="psychology" size={11} color={Colors.outline} />
                  <Text style={rpStyles.coachText}>
                    {bestBucket.min === 0
                      ? 'You perform best on back-to-back days — your body responds well to high frequency. Watch for fatigue signals across multi-day blocks.'
                      : bestBucket.min === 1
                        ? 'One day of rest gives your best sessions. Maintain this rhythm but ensure quality sleep on rest days.'
                        : bestBucket.min <= 2
                          ? `${bestBucket.label} rest yields your deepest dives. This suggests your recovery needs are moderate — don't rush back too quickly.`
                          : bestBucket.min <= 4
                            ? `${bestBucket.label} off works best for you. Consider 2 sessions per week for optimal progression.`
                            : `You perform best after extended rest (${bestBucket.label}). Your body may need longer recovery — quality over quantity.`}
                  </Text>
                </View>
              </View>
            </FadeSlide>
          );
        })()}

        {/* ── Heart Rate Trend ── */}
        {(() => {
          if (!allSessions) return null;
          const withHr = allSessions
            .filter((s) => s.avg_hr != null && s.avg_hr > 0)
            .slice(0, 30)
            .reverse(); // oldest first
          if (withHr.length < 4) return null;

          const avgHrs = withHr.map((s) => s.avg_hr!);
          const maxHrs = withHr.map((s) => s.max_hr ?? s.avg_hr!);
          const minHr = Math.min(...avgHrs);
          const maxHr = Math.max(...maxHrs);
          const overallAvg = Math.round(avgHrs.reduce((a, b) => a + b, 0) / avgHrs.length);
          const chartMax = Math.max(maxHr + 5, 100);
          const chartMin = Math.max(minHr - 10, 30);
          const range = chartMax - chartMin || 1;

          // Trend: compare first half avg HR to second half
          const mid = Math.floor(avgHrs.length / 2);
          const firstHalfAvg = avgHrs.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
          const secondHalfAvg = avgHrs.slice(mid).reduce((a, b) => a + b, 0) / (avgHrs.length - mid);
          const hrDelta = secondHalfAvg - firstHalfAvg;
          // For freedivers, lower avg HR = better dive reflex
          const improving = hrDelta < -2;
          const declining = hrDelta > 2;
          const trendLabel = improving ? 'IMPROVING' : declining ? 'RISING' : 'STABLE';
          const trendColor = improving ? '#4ade80' : declining ? Colors.orange : Colors.cyan;

          // Latest session stats
          const latest = withHr[withHr.length - 1];
          const latestAvg = Math.round(latest.avg_hr!);
          const lowestAvg = Math.round(minHr);

          return (
            <FadeSlide delay={325}>
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>HEART RATE TREND</Text>
              <View style={styles.glassCard}>
                <View style={styles.chartHeader}>
                  <View>
                    <Text style={styles.cardTitle}>DIVING BRADYCARDIA</Text>
                    <Text style={styles.cardSub}>Avg session HR · {withHr.length} sessions</Text>
                  </View>
                  <View style={[hrStyles.trendBadge, { backgroundColor: trendColor + '18', borderColor: trendColor + '40' }]}>
                    <MaterialIcons
                      name={improving ? 'trending-down' : declining ? 'trending-up' : 'trending-flat'}
                      size={10}
                      color={trendColor}
                    />
                    <Text style={[hrStyles.trendText, { color: trendColor }]}>{trendLabel}</Text>
                  </View>
                </View>

                {/* Dual-band chart: max HR (faint) + avg HR (solid) */}
                <View style={hrStyles.chart}>
                  {withHr.map((s, i) => {
                    const avgH = Math.max(4, ((s.avg_hr! - chartMin) / range) * 72);
                    const maxH = s.max_hr ? Math.max(avgH + 2, ((s.max_hr - chartMin) / range) * 72) : avgH;
                    const isLatest = i === withHr.length - 1;
                    return (
                      <View key={s.id} style={hrStyles.barWrap}>
                        {/* Max HR bar (faint background) */}
                        <View style={[hrStyles.barMax, { height: maxH }]} />
                        {/* Avg HR bar (solid foreground) */}
                        <View style={[hrStyles.barAvg, {
                          height: avgH,
                          backgroundColor: isLatest ? Colors.error : Colors.error + '80',
                        }]} />
                        {isLatest && <View style={[hrStyles.dot, { backgroundColor: Colors.error }]} />}
                      </View>
                    );
                  })}
                </View>
                <View style={styles.chartAxisRow}>
                  <Text style={styles.axisLabel}>OLDEST</Text>
                  <Text style={styles.axisLabel}>LATEST</Text>
                </View>

                {/* Stats */}
                <View style={hrStyles.statsRow}>
                  <View style={hrStyles.stat}>
                    <Text style={[hrStyles.statValue, { color: Colors.error }]}>{latestAvg}</Text>
                    <Text style={hrStyles.statUnit}>bpm</Text>
                    <Text style={hrStyles.statLabel}>LATEST AVG</Text>
                  </View>
                  <View style={hrStyles.divider} />
                  <View style={hrStyles.stat}>
                    <Text style={hrStyles.statValue}>{overallAvg}</Text>
                    <Text style={hrStyles.statUnit}>bpm</Text>
                    <Text style={hrStyles.statLabel}>OVERALL AVG</Text>
                  </View>
                  <View style={hrStyles.divider} />
                  <View style={hrStyles.stat}>
                    <Text style={[hrStyles.statValue, { color: '#4ade80' }]}>{lowestAvg}</Text>
                    <Text style={hrStyles.statUnit}>bpm</Text>
                    <Text style={hrStyles.statLabel}>LOWEST AVG</Text>
                  </View>
                  <View style={hrStyles.divider} />
                  <View style={hrStyles.stat}>
                    <Text style={hrStyles.statValue}>
                      {hrDelta > 0 ? '+' : ''}{Math.round(hrDelta)}
                    </Text>
                    <Text style={hrStyles.statUnit}>bpm</Text>
                    <Text style={hrStyles.statLabel}>TREND</Text>
                  </View>
                </View>

                {/* Coaching note */}
                <View style={hrStyles.tip}>
                  <MaterialIcons name="favorite" size={11} color={Colors.error + '80'} />
                  <Text style={hrStyles.tipText}>
                    {improving
                      ? 'Avg session HR is dropping — a sign of stronger mammalian dive reflex. Your body is adapting to submersion and conserving oxygen more effectively.'
                      : declining
                        ? 'Avg HR trending up. This may reflect fatigue, stress, or insufficient recovery. Check sleep quality and consider longer rest between sessions.'
                        : 'HR is holding steady. Consistent training frequency and good recovery will gradually strengthen your dive reflex over time.'}
                  </Text>
                </View>
              </View>
            </FadeSlide>
          );
        })()}

        {/* ── Locations ── */}
        {locations && locations.length > 0 && (
          <FadeSlide delay={320}>
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>LOCATION PERFORMANCE</Text>
            {locations.slice(0, 6).map((loc, i) => (
              <Pressable
                key={loc.location}
                style={({ pressed }) => [styles.locCard, i < locations.length - 1 && { marginBottom: 8 }, pressed && { opacity: 0.75 }]}
                onPress={() => router.push({ pathname: '/(tabs)/log', params: { location: loc.location } } as any)}
              >
                <View style={styles.locLeft}>
                  <Text style={styles.locName}>{loc.location}</Text>
                  <Text style={styles.locMeta}>{loc.session_count} sessions · last {loc.last_session}</Text>
                </View>
                <View style={styles.locRight}>
                  <Text style={styles.locMax}>{fmtDepth(loc.max_depth_m)}</Text>
                  <Text style={styles.locAvg}>avg {fmtDepth(loc.avg_depth_m)}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={18} color={Colors.outline} style={{ marginLeft: 8 }} />
              </Pressable>
            ))}
          </FadeSlide>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg, paddingTop: 0 },

  appBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)',
    backgroundColor: Colors.bg,
  },
  backBtn: { width: 36, alignItems: 'flex-start' },
  appBarCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  appBarTitle: { fontSize: 13, fontWeight: '700', color: Colors.cyan, letterSpacing: 4 },

  scroll: { padding: 16, paddingBottom: 100 },
  sectionLabel: { fontSize: 9, color: Colors.outline, letterSpacing: 2.5, fontWeight: '700', textTransform: 'uppercase', marginBottom: 10 },

  glassCard: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 16, marginBottom: 12,
  },
  cardTitle: { fontSize: 10, color: Colors.primary, letterSpacing: 2, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
  cardSub: { fontSize: 10, color: Colors.outline, marginBottom: 12 },

  // Plateau Banner
  plateauBanner: {
    borderLeftWidth: 4, borderLeftColor: Colors.primary,
    backgroundColor: Colors.surfaceLow,
    borderRadius: 8, padding: 14, marginBottom: 14,
  },
  plateauBannerActive: { borderLeftColor: Colors.primary },
  plateauBannerLeft: { marginBottom: 10 },
  plateauBannerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  plateauBannerTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  plateauBannerSub: { fontSize: 12, color: Colors.onSurfaceVariant },
  recommendBox: {
    backgroundColor: Colors.surfaceHighest, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.outlineVariant + '30',
    padding: 10,
  },
  recommendLabel: { fontSize: 9, color: Colors.primaryDim, letterSpacing: 3, fontWeight: '700', marginBottom: 4 },
  recommendText: { fontSize: 12, color: Colors.onSurface, lineHeight: 18 },

  // Bento row
  bentoRow: { flexDirection: 'row', marginBottom: 12 },

  // Histogram
  histogram: { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 4, marginTop: 4 },
  histBarWrap: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  histBarTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', marginBottom: 4 },
  histBar: { width: '100%', borderRadius: 2 },
  histLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 0.5 },

  // Working depth
  workingBig: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10, marginTop: 8 },
  workingValue: { fontSize: 48, fontWeight: '700', color: Colors.onSurface, letterSpacing: -2 },
  workingUnit: { fontSize: 18, color: Colors.onSurfaceVariant, marginBottom: 8, marginLeft: 2 },
  workingRows: { gap: 6 },
  workingRow: { flexDirection: 'row', justifyContent: 'space-between' },
  workingRowLabel: { fontSize: 9, color: Colors.outline, letterSpacing: 1.5, textTransform: 'uppercase' },
  workingRowValue: { fontSize: 12, color: Colors.onSurface, fontWeight: '600' },

  // Chart
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  chartLegend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 2, borderRadius: 1 },
  legendText: { fontSize: 9, color: Colors.outline, letterSpacing: 1 },
  barTooltip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surfaceHighest, borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 5, marginBottom: 10,
    alignSelf: 'flex-start', borderWidth: 1, borderColor: Colors.cyan + '30',
  },
  barTooltipText: { fontSize: 11, color: Colors.onSurface, fontWeight: '500' },
  bigChart: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_H, gap: 2 },
  bigBarOuter: { flex: 1, height: CHART_H, position: 'relative', justifyContent: 'flex-end' },
  bigBarFill: { width: '100%', borderRadius: 2, position: 'absolute', bottom: 0 },
  trendDot: { position: 'absolute', left: '50%', width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#facc15', marginLeft: -1.5 },
  trendBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  trendBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  etaText: { fontSize: 9, color: Colors.outline, letterSpacing: 0.5 },
  chartAxisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  axisLabel: { fontSize: 9, color: Colors.outline, letterSpacing: 1 },

  // Monthly
  monthRow: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10 },
  monthHeader: { backgroundColor: Colors.surfaceHighest + 'aa' },
  monthHeaderText: { fontSize: 8, color: Colors.outline, letterSpacing: 2, fontWeight: '700' },
  monthDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30' },
  monthCell: { flex: 1 },
  monthNameText: { fontSize: 12, color: Colors.onSurface },
  monthDataText: { fontSize: 12, color: Colors.onSurfaceVariant },

  // Locations
  locCard: {
    backgroundColor: Colors.surfaceLow, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.outlineVariant + '30',
    padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  locLeft: { flex: 1 },
  locName: { fontSize: 14, color: Colors.onSurface, fontWeight: '600' },
  locMeta: { fontSize: 10, color: Colors.outline, marginTop: 2 },
  locRight: { alignItems: 'flex-end' },
  locMax: { fontSize: 20, color: Colors.cyan, fontWeight: '300' },
  locAvg: { fontSize: 10, color: Colors.outline, marginTop: 2 },
});

const calStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 16, marginBottom: 12,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 14,
  },
  title: {
    fontSize: 10, color: Colors.primary, letterSpacing: 2,
    fontWeight: '700', textTransform: 'uppercase', marginBottom: 2,
  },
  sub: { fontSize: 10, color: Colors.outline },
  streakBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#facc1518', borderRadius: 4,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  streakText: { fontSize: 9, fontWeight: '700', color: '#facc15', letterSpacing: 0.5 },

  monthRow: {
    flexDirection: 'row', position: 'relative',
    height: 14, marginBottom: 4,
  },
  monthLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 0.5 },

  grid: { flexDirection: 'row', marginBottom: 12 },
  dayLabelCol: { width: 14, justifyContent: 'space-between' },
  dayLabel: { fontSize: 7, color: Colors.outline, height: 10, lineHeight: 10 },

  weekCols: { flex: 1, flexDirection: 'row', gap: 3 },
  weekCol: { flex: 1, gap: 3 },
  cell: {
    aspectRatio: 1, borderRadius: 2,
    maxHeight: 10, maxWidth: 10,
  },
  cellToday: {
    borderWidth: 1, borderColor: Colors.cyan + '80',
  },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30',
    paddingTop: 10,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 13, fontWeight: '700', color: Colors.onSurface },
  statLabel: {
    fontSize: 7, color: Colors.outline, letterSpacing: 1,
    fontWeight: '600', marginTop: 2,
  },
  statDivider: { width: 1, height: 20, backgroundColor: Colors.outlineVariant + '30' },
});

const tlStyles = StyleSheet.create({
  acwrBadge: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.2)',
  },
  acwrValue: { fontSize: 18, fontWeight: '700' },
  acwrLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5, fontWeight: '600', marginTop: 1 },
  gaugeTrack: {
    flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden',
    backgroundColor: Colors.surfaceHighest, position: 'relative',
  },
  gaugeZone: { height: '100%' },
  gaugeNeedle: {
    position: 'absolute', width: 3, height: 12, borderRadius: 1.5,
    top: -3, marginLeft: -1.5,
  },
  gaugeLabels: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 3,
    paddingHorizontal: 2,
  },
  gaugeLabel: { fontSize: 8, color: Colors.outline + '80' },
  barChart: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    height: 80, gap: 4,
  },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barValue: { fontSize: 8, color: Colors.outline, marginBottom: 2 },
  bar: { width: '100%', borderRadius: 3, minHeight: 3 },
  barLabel: { fontSize: 8, color: Colors.outline, marginTop: 3, fontWeight: '600' },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    marginTop: 14, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '20',
  },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 14, fontWeight: '700', color: Colors.onSurface },
  statUnit: { fontSize: 10, fontWeight: '400', color: Colors.outline },
  statLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1, fontWeight: '600', marginTop: 2 },
  statDivider: { width: 1, height: 20, backgroundColor: Colors.outlineVariant + '30' },
  coachNote: {
    borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 6,
    marginTop: 12, backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 4,
  },
  coachText: { fontSize: 11, color: Colors.textMuted, lineHeight: 16 },
});

const tpStyles = StyleSheet.create({
  perfectBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#facc1520', borderRadius: 4,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  perfectBadgeText: { fontSize: 9, color: '#facc15', fontWeight: '700', letterSpacing: 0.5 },

  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 80, gap: 2, marginBottom: 4 },
  barWrap: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 2 },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30',
    paddingTop: 10, marginTop: 8,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 14, fontWeight: '700', color: Colors.onSurface },
  statLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1, fontWeight: '600', marginTop: 2 },
  statDivider: { width: 1, height: 20, backgroundColor: Colors.outlineVariant + '30' },

  protoSection: {
    marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '20',
  },
  protoLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 2, fontWeight: '700', marginBottom: 8 },
  protoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 5,
  },
  protoDot: { width: 6, height: 6, borderRadius: 3 },
  protoName: { fontSize: 12, color: Colors.onSurface, fontWeight: '500', flex: 1 },
  protoCount: { fontSize: 11, color: Colors.outline, width: 28 },
  protoBest: { fontSize: 11, color: Colors.cyan, fontWeight: '600', width: 40, textAlign: 'right' },
  protoPerfect: { fontSize: 9, color: '#4ade80', width: 52, textAlign: 'right' },
});

const pbStyles = StyleSheet.create({
  chart: {
    flexDirection: 'row', height: 80, marginBottom: 4,
  },
  yAxis: {
    width: 32, justifyContent: 'space-between', paddingRight: 6,
  },
  yLabel: { fontSize: 8, color: Colors.outline, textAlign: 'right' },
  chartArea: {
    flex: 1, position: 'relative',
  },
  gridLine: {
    position: 'absolute', left: 0, right: 0,
    height: 1, backgroundColor: Colors.outlineVariant + '20',
  },
  stepH: {
    position: 'absolute', height: 2, borderRadius: 1,
    backgroundColor: Colors.cyan + '60',
  },
  stepV: {
    position: 'absolute', width: 2, borderRadius: 1,
    backgroundColor: Colors.cyan + '40',
  },
  dot: {
    position: 'absolute', width: 16, height: 16,
    marginLeft: -8, marginBottom: -8,
    alignItems: 'center', justifyContent: 'center',
  },
  dotInner: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: Colors.cyan,
    borderWidth: 1.5, borderColor: Colors.bg,
  },
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30',
    paddingTop: 10, marginTop: 8,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 14, fontWeight: '700', color: Colors.onSurface },
  statUnit: { fontSize: 10, fontWeight: '400', color: Colors.outline },
  statLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1, fontWeight: '600', marginTop: 2 },
  statDivider: { width: 1, height: 20, backgroundColor: Colors.outlineVariant + '30' },
});

// CO₂ Tolerance Trend styles
const cxStyles = StyleSheet.create({
  trendBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  trendText: { fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  chart: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: 80, gap: 2, marginBottom: 4,
  },
  barWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', position: 'relative' },
  bar: { width: '80%', borderRadius: 2, minWidth: 4 },
  dot: {
    position: 'absolute', top: -5,
    width: 5, height: 5, borderRadius: 2.5,
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30',
    paddingTop: 10, marginTop: 8,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '700', color: Colors.onSurface },
  statLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginTop: 3 },
  divider: { width: 1, height: 24, backgroundColor: Colors.outlineVariant + '30' },
  tip: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start',
    marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '20',
  },
  tipText: { fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16, flex: 1 },
});

// Recovery Pattern styles
const rpStyles = StyleSheet.create({
  sweetBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.cyan + '15',
    borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3,
  },
  sweetText: { fontSize: 8, fontWeight: '700', color: Colors.cyan, letterSpacing: 1 },
  chart: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: 100, gap: 6, marginBottom: 6, paddingHorizontal: 4,
  },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barValue: { fontSize: 9, color: Colors.outline, fontWeight: '600', marginBottom: 3 },
  bar: {
    width: '80%', borderRadius: 4, minWidth: 16,
    alignItems: 'center', justifyContent: 'flex-start',
  },
  bestDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#fff', marginTop: -3,
  },
  barLabel: { fontSize: 10, color: Colors.onSurfaceVariant, fontWeight: '600', marginTop: 4 },
  barCount: { fontSize: 8, color: Colors.outline },
  avgRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 12,
  },
  avgLine: { flex: 1, height: 1, backgroundColor: Colors.outline + '30' },
  avgText: { fontSize: 9, color: Colors.outline, letterSpacing: 1 },
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30',
    paddingTop: 10,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '700', color: Colors.onSurface },
  statUnit: { fontSize: 10, fontWeight: '400', color: Colors.outline },
  statLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginTop: 3 },
  statDivider: { width: 1, height: 24, backgroundColor: Colors.outlineVariant + '30' },
  coachNote: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start',
    marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '20',
  },
  coachText: { fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16, flex: 1 },
});

const hrStyles = StyleSheet.create({
  trendBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  trendText: { fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  chart: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: 80, gap: 2, marginBottom: 4, marginTop: 12,
  },
  barWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  barMax: {
    position: 'absolute', bottom: 0,
    width: '80%', borderRadius: 2,
    backgroundColor: Colors.error + '15',
  },
  barAvg: { width: '60%', borderRadius: 2, minHeight: 3 },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30',
    paddingTop: 10, marginTop: 8,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '700', color: Colors.onSurface },
  statUnit: { fontSize: 9, color: Colors.outline },
  statLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginTop: 2 },
  divider: { width: 1, height: 24, backgroundColor: Colors.outlineVariant + '30' },
  tip: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start',
    marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '20',
  },
  tipText: { fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16, flex: 1 },
});
