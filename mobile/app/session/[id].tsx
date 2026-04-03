import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, Share, KeyboardAvoidingView, Platform,
  Pressable, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue, withTiming, withDelay, useAnimatedStyle, Easing,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../src/constants/colors';
import { useQueryClient } from '@tanstack/react-query';
import { useSession, useSessions, type Session } from '../../src/api/sessions';
import { usePersonalBests, useWorkingDepth } from '../../src/api/analytics';
import { useSessionDives, classifyDiscipline, type IndividualDive, type TimeSeries } from '../../src/api/dives';
import { getClient } from '../../src/api/client';
import { analyzeDiveReflex, type DiveReflexResult } from '../../src/utils/diveReflex';
import { Canvas, Path as SkPath, Skia, Line, vec } from '@shopify/react-native-skia';
import { fmtDepth, fmtSeconds, fmtDate } from '../../src/utils/formatters';

function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const opacity = useSharedValue(0);
  const ty = useSharedValue(12);
  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 350, easing: Easing.out(Easing.quad) }));
    ty.value = withDelay(delay, withTiming(0, { duration: 350, easing: Easing.out(Easing.quad) }));
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: ty.value }] } as any));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function noteKey(id: string) { return `@session_note_${id}`; }
function conditionsKey(id: string) { return `@session_conditions_${id}`; }

interface SessionConditions {
  visibility?: 'poor' | 'fair' | 'good' | 'excellent';
  current?: 'none' | 'light' | 'moderate' | 'strong';
  surface?: 'calm' | 'choppy' | 'rough';
  comfort?: 1 | 2 | 3 | 4 | 5;
  equalization?: 'smooth' | 'tight' | 'limiting' | 'failed';
}

const VISIBILITY_OPTS = ['poor', 'fair', 'good', 'excellent'] as const;
const CURRENT_OPTS = ['none', 'light', 'moderate', 'strong'] as const;
const SURFACE_OPTS = ['calm', 'choppy', 'rough'] as const;
const EQ_OPTS = ['smooth', 'tight', 'limiting', 'failed'] as const;

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isLoading } = useSession(Number(id));
  const { data: pbs } = usePersonalBests();
  const { data: workingDepth } = useWorkingDepth();
  const { data: dives, isLoading: loadingDives } = useSessionDives(Number(id));
  const { data: recentSessions } = useSessions(20);
  const [expandedDive, setExpandedDive] = useState<number | null>(null);

  const [note, setNote] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  // ── Conditions state ──
  const [conditions, setConditions] = useState<SessionConditions>({});
  const [conditionsExpanded, setConditionsExpanded] = useState(false);

  // ── FIT resync state ──
  const [fitSyncing, setFitSyncing] = useState(false);
  const [fitResult, setFitResult] = useState<string | null>(null);

  // Load saved note + conditions
  useEffect(() => {
    if (!id) return;
    AsyncStorage.getItem(noteKey(id)).then((v) => {
      if (v) setNote(v);
    });
    AsyncStorage.getItem(conditionsKey(id)).then((v) => {
      if (v) {
        try { setConditions(JSON.parse(v)); } catch {}
      }
    });
  }, [id]);

  const updateCondition = useCallback(async <K extends keyof SessionConditions>(
    key: K,
    value: SessionConditions[K],
  ) => {
    setConditions((prev) => {
      const next = { ...prev };
      if (next[key] === value) {
        delete next[key]; // toggle off
      } else {
        next[key] = value;
      }
      AsyncStorage.setItem(conditionsKey(id!), JSON.stringify(next));
      return next;
    });
  }, [id]);

  const saveNote = useCallback(async () => {
    const trimmed = noteDraft.trim();
    setNote(trimmed);
    setEditingNote(false);
    if (trimmed) {
      await AsyncStorage.setItem(noteKey(id!), trimmed);
    } else {
      await AsyncStorage.removeItem(noteKey(id!));
    }
  }, [noteDraft, id]);

  function shareSession() {
    if (!session) return;
    const d = session.dive;

    // Header
    const header = `🤿 ${d.location_name.toUpperCase()}`;
    const date = fmtDate(session.start_time);
    const separator = '━'.repeat(Math.min(24, d.location_name.length + 4));

    // PB badge
    const pbLine = session.is_pb ? '🏆 NEW PERSONAL BEST!' : '';

    // Core stats
    const depthLine = `📐 Max Depth: ${fmtDepth(d.max_depth_m)}`;
    const btLine = `⏱ Max BT: ${fmtSeconds(d.max_bottom_time_s ?? 0)}`;
    const diveLine = d.dive_count ? `🔢 Dives: ${d.dive_count}` : '';
    const totalBtLine = d.bottom_time_s ? `⏳ Total BT: ${fmtSeconds(d.bottom_time_s)}` : '';
    const durationLine = session.duration_s ? `🕐 Session: ${fmtSeconds(session.duration_s)}` : '';

    // Context — depth vs PB and working depth
    const contextParts: string[] = [];
    if (pbs && pbs.max_depth_m > 0 && !session.is_pb) {
      const pct = Math.round((d.max_depth_m / pbs.max_depth_m) * 100);
      contextParts.push(`${pct}% of PB (${fmtDepth(pbs.max_depth_m)})`);
    }
    if (workingDepth && workingDepth.working_depth_m > 0) {
      const diff = d.max_depth_m - workingDepth.working_depth_m;
      if (diff >= 0.5) contextParts.push(`+${diff.toFixed(1)}m above working depth`);
    }
    const contextLine = contextParts.length > 0 ? `📊 ${contextParts.join(' · ')}` : '';

    // Conditions
    const condParts: string[] = [];
    if (d.water_temp_c != null) condParts.push(`${d.water_temp_c.toFixed(1)}°C`);
    if (session.avg_hr) condParts.push(`Avg HR ${Math.round(session.avg_hr)} bpm`);
    const condLine = condParts.length > 0 ? `🌊 ${condParts.join(' · ')}` : '';

    // Discipline breakdown from dives data
    let discLine = '';
    if (dives && dives.length > 0) {
      const counts: Record<string, number> = {};
      for (const dive of dives) {
        const cls = classifyDiscipline(dive);
        counts[cls.discipline] = (counts[cls.discipline] ?? 0) + 1;
      }
      const parts = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([disc, n]) => `${n}× ${disc}`);
      if (parts.length > 0) discLine = `🏊 ${parts.join(' · ')}`;
    }

    // Notes
    const noteLine = note ? `\n💬 "${note}"` : '';

    const lines = [
      header,
      date,
      separator,
      pbLine,
      depthLine,
      btLine,
      diveLine,
      totalBtLine,
      durationLine,
      contextLine,
      condLine,
      discLine,
      noteLine,
      '',
      'Logged via ApneaOS 🫁',
    ].filter(Boolean).join('\n');

    Share.share({ message: lines });
  }

  // ── Adjacent session navigation ────────────────────────────────────────────
  const { prevSession, nextSession, sessionIndex, sessionTotal } = useMemo(() => {
    if (!recentSessions || recentSessions.length === 0) return { prevSession: null, nextSession: null, sessionIndex: -1, sessionTotal: 0 };
    const idx = recentSessions.findIndex((s) => s.id === Number(id));
    if (idx < 0) return { prevSession: null, nextSession: null, sessionIndex: -1, sessionTotal: recentSessions.length };
    // recentSessions is newest-first: prev (older) = idx+1, next (newer) = idx-1
    return {
      prevSession: idx < recentSessions.length - 1 ? recentSessions[idx + 1] : null,
      nextSession: idx > 0 ? recentSessions[idx - 1] : null,
      sessionIndex: idx,
      sessionTotal: recentSessions.length,
    };
  }, [recentSessions, id]);

  if (isLoading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={Colors.cyan} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.notFound}>Session not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: Colors.cyan }}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const d = session.dive;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* App bar */}
      <View style={styles.appBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.cyan} />
        </TouchableOpacity>
        <Text style={styles.appBarTitle}>SESSION DETAIL</Text>
        <View style={styles.appBarRight}>
          <TouchableOpacity onPress={shareSession}>
            <MaterialIcons name="share" size={20} color={Colors.outline} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Session navigation */}
      {(prevSession || nextSession) && (
        <View style={navStyles.bar}>
          <TouchableOpacity
            style={[navStyles.btn, !prevSession && navStyles.btnDisabled]}
            onPress={() => prevSession && router.replace(`/session/${prevSession.id}` as any)}
            disabled={!prevSession}
          >
            <MaterialIcons name="chevron-left" size={18} color={prevSession ? Colors.cyan : Colors.outline + '40'} />
            <Text style={[navStyles.btnText, !prevSession && navStyles.btnTextDisabled]}>Older</Text>
          </TouchableOpacity>
          <Text style={navStyles.counter}>
            {sessionIndex >= 0 ? `${sessionTotal - sessionIndex} of ${sessionTotal}` : ''}
          </Text>
          <TouchableOpacity
            style={[navStyles.btn, !nextSession && navStyles.btnDisabled]}
            onPress={() => nextSession && router.replace(`/session/${nextSession.id}` as any)}
            disabled={!nextSession}
          >
            <Text style={[navStyles.btnText, !nextSession && navStyles.btnTextDisabled]}>Newer</Text>
            <MaterialIcons name="chevron-right" size={18} color={nextSession ? Colors.cyan : Colors.outline + '40'} />
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Session header ── */}
        <FadeIn delay={0}>
          <View style={styles.sessionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sessionTitle}>
                {fmtDate(session.start_time).toUpperCase()} — {d.location_name.toUpperCase()}
              </Text>
              {session.is_pb && (
                <View style={styles.pbBadge}>
                  <MaterialIcons name="emoji-events" size={10} color={Colors.bg} />
                  <Text style={styles.pbText}>PERSONAL BEST</Text>
                </View>
              )}
            </View>
          </View>
        </FadeIn>

        {/* ── Depth highlight ── */}
        {d.avg_depth_m > 0 && (
          <FadeIn delay={80}>
            <View style={styles.glassCard}>
              <Text style={styles.bentoMicro}>DEPTH SUMMARY</Text>
              <View style={styles.depthRow}>
                <View style={styles.depthCell}>
                  <Text style={styles.depthLabel}>MAX</Text>
                  <Text style={[styles.depthValue, { color: session.is_pb ? Colors.cyan : Colors.onSurface }]}>
                    {d.max_depth_m.toFixed(1)}<Text style={styles.depthUnit}>m</Text>
                  </Text>
                </View>
                <View style={[styles.depthCell, styles.depthCellBorder]}>
                  <Text style={styles.depthLabel}>AVG</Text>
                  <Text style={styles.depthValue}>
                    {d.avg_depth_m.toFixed(1)}<Text style={styles.depthUnit}>m</Text>
                  </Text>
                </View>
                {d.dive_count ? (
                  <View style={styles.depthCell}>
                    <Text style={styles.depthLabel}>DIVES</Text>
                    <Text style={styles.depthValue}>{d.dive_count}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </FadeIn>
        )}

        {/* ── Depth context bar ── */}
        {pbs && pbs.max_depth_m > 0 && d.max_depth_m > 0 && (
          <FadeIn delay={120}>
            <View style={styles.ctxCard}>
              <View style={styles.ctxHeader}>
                <Text style={styles.ctxMicro}>DEPTH CONTEXT</Text>
                <Text style={styles.ctxPct}>
                  <Text style={{ color: session.is_pb ? Colors.cyan : Colors.onSurface }}>
                    {Math.round((d.max_depth_m / pbs.max_depth_m) * 100)}%
                  </Text>
                  {' of PB'}
                </Text>
              </View>
              <View style={styles.ctxTrack}>
                {/* Session depth fill */}
                <View style={[styles.ctxFill, {
                  width: `${Math.min(100, (d.max_depth_m / pbs.max_depth_m) * 100)}%` as any,
                  backgroundColor: session.is_pb ? Colors.cyan : Colors.primaryDim,
                }]} />
                {/* Working depth marker */}
                {workingDepth && workingDepth.working_depth_m < pbs.max_depth_m && (
                  <View style={[styles.ctxMarker, {
                    left: `${(workingDepth.working_depth_m / pbs.max_depth_m) * 100}%` as any,
                  }]} />
                )}
              </View>
              <View style={styles.ctxLabels}>
                <Text style={styles.ctxLabel}>0m</Text>
                {workingDepth && workingDepth.working_depth_m < pbs.max_depth_m && (
                  <Text style={[styles.ctxLabel, styles.ctxLabelWorking, {
                    left: `${(workingDepth.working_depth_m / pbs.max_depth_m) * 100}%` as any,
                  }]}>
                    {fmtDepth(workingDepth.working_depth_m)}
                  </Text>
                )}
                <Text style={[styles.ctxLabel, { color: Colors.cyan }]}>
                  PB {fmtDepth(pbs.max_depth_m)}
                </Text>
              </View>
              {/* Session marker label */}
              <View style={styles.ctxSessionRow}>
                <View style={[styles.ctxSessionDot, { backgroundColor: session.is_pb ? Colors.cyan : Colors.primaryDim }]} />
                <Text style={styles.ctxSessionLabel}>
                  This session: <Text style={{ color: session.is_pb ? Colors.cyan : Colors.onSurface }}>
                    {fmtDepth(d.max_depth_m)}
                  </Text>
                  {workingDepth ? (
                    <Text style={{ color: Colors.outline }}>
                      {d.max_depth_m >= workingDepth.working_depth_m
                        ? `  ↑${(d.max_depth_m - workingDepth.working_depth_m).toFixed(1)}m above working`
                        : `  ↓${(workingDepth.working_depth_m - d.max_depth_m).toFixed(1)}m below working`}
                    </Text>
                  ) : null}
                </Text>
              </View>
            </View>
          </FadeIn>
        )}

        {/* ── vs Previous Session comparison ── */}
        {recentSessions && recentSessions.length >= 2 && session && (() => {
          // Find previous session (the one right before this one chronologically)
          const sorted = [...recentSessions].sort((a, b) => b.start_time.localeCompare(a.start_time));
          const thisIdx = sorted.findIndex((s) => s.id === session.id);
          const prev = thisIdx >= 0 && thisIdx < sorted.length - 1 ? sorted[thisIdx + 1] : null;
          if (!prev) return null;

          // Also compute rolling average from last 10 sessions (excluding this one)
          const others = sorted.filter((s) => s.id !== session.id).slice(0, 10);
          const avgDepth = others.length > 0 ? others.reduce((s, x) => s + x.dive.max_depth_m, 0) / others.length : null;
          const avgBT = others.length > 0 ? others.reduce((s, x) => s + (x.dive.max_bottom_time_s ?? 0), 0) / others.length : null;

          const depthDelta = d.max_depth_m - prev.dive.max_depth_m;
          const btDelta = (d.max_bottom_time_s ?? 0) - (prev.dive.max_bottom_time_s ?? 0);
          const diveDelta = (d.dive_count ?? 0) - (prev.dive.dive_count ?? 0);
          const depthVsAvg = avgDepth != null ? d.max_depth_m - avgDepth : null;

          const fmtDelta = (v: number, unit: string) => {
            const sign = v > 0 ? '+' : '';
            const color = v > 0 ? '#4ade80' : v < 0 ? Colors.error : Colors.outline;
            return { text: `${sign}${v.toFixed(1)}${unit}`, color };
          };
          const fmtDeltaInt = (v: number, unit: string) => {
            const sign = v > 0 ? '+' : '';
            const color = v > 0 ? '#4ade80' : v < 0 ? Colors.error : Colors.outline;
            return { text: `${sign}${Math.round(v)}${unit}`, color };
          };

          const dd = fmtDelta(depthDelta, 'm');
          const bd = fmtDeltaInt(btDelta, 's');
          const dvd = fmtDeltaInt(diveDelta, '');
          const dad = depthVsAvg != null ? fmtDelta(depthVsAvg, 'm') : null;

          const prevDate = new Date(prev.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          return (
            <FadeIn delay={135}>
              <View style={cmpStyles.card}>
                <View style={cmpStyles.header}>
                  <MaterialIcons name="compare-arrows" size={13} color={Colors.primaryDim} />
                  <Text style={cmpStyles.title}>VS PREVIOUS</Text>
                  <Text style={cmpStyles.prevDate}>{prevDate} · {fmtDepth(prev.dive.max_depth_m)}</Text>
                </View>

                <View style={cmpStyles.row}>
                  <View style={cmpStyles.metric}>
                    <Text style={cmpStyles.metricLabel}>MAX DEPTH</Text>
                    <Text style={[cmpStyles.metricDelta, { color: dd.color }]}>{dd.text}</Text>
                  </View>
                  <View style={cmpStyles.divider} />
                  <View style={cmpStyles.metric}>
                    <Text style={cmpStyles.metricLabel}>BEST BT</Text>
                    <Text style={[cmpStyles.metricDelta, { color: bd.color }]}>{bd.text}</Text>
                  </View>
                  {d.dive_count != null && prev.dive.dive_count != null && (
                    <>
                      <View style={cmpStyles.divider} />
                      <View style={cmpStyles.metric}>
                        <Text style={cmpStyles.metricLabel}>DIVES</Text>
                        <Text style={[cmpStyles.metricDelta, { color: dvd.color }]}>{dvd.text}</Text>
                      </View>
                    </>
                  )}
                  {dad && (
                    <>
                      <View style={cmpStyles.divider} />
                      <View style={cmpStyles.metric}>
                        <Text style={cmpStyles.metricLabel}>VS 10-AVG</Text>
                        <Text style={[cmpStyles.metricDelta, { color: dad.color }]}>{dad.text}</Text>
                      </View>
                    </>
                  )}
                </View>
              </View>
            </FadeIn>
          );
        })()}

        {/* ── Full stats ── */}
        <FadeIn delay={140}>
          <Text style={styles.sectionLabel}>SESSION LOG</Text>
          <View style={[styles.glassCard, { padding: 0, overflow: 'hidden' }]}>
            <StatRow label="Avg Depth" value={fmtDepth(d.avg_depth_m)} />
            <StatRow label="Max Bottom Time" value={fmtSeconds(d.max_bottom_time_s ?? 0)} />
            <StatRow label="Total Bottom Time" value={fmtSeconds(d.bottom_time_s ?? 0)} />
            {session.avg_hr ? <StatRow label="Avg Heart Rate" value={`${Math.round(session.avg_hr)} bpm`} /> : null}
            {session.max_hr ? <StatRow label="Max Heart Rate" value={`${Math.round(session.max_hr)} bpm`} /> : null}
            {session.duration_s ? <StatRow label="Session Duration" value={fmtSeconds(session.duration_s)} noBorder /> : null}
          </View>
        </FadeIn>

        {/* ── Conditions ── */}
        <FadeIn delay={200}>
          <TouchableOpacity
            onPress={() => setConditionsExpanded(!conditionsExpanded)}
            activeOpacity={0.8}
            style={cdStyles.headerBtn}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="water" size={13} color={Colors.outline} />
              <Text style={styles.sectionLabel}>CONDITIONS</Text>
            </View>
            {/* Inline condition tags when collapsed */}
            {!conditionsExpanded && Object.keys(conditions).length > 0 && (
              <View style={cdStyles.inlineTags}>
                {conditions.visibility && (
                  <View style={[cdStyles.miniTag, { borderColor: cdColors.visibility + '40' }]}>
                    <Text style={[cdStyles.miniTagText, { color: cdColors.visibility }]}>{conditions.visibility.toUpperCase()}</Text>
                  </View>
                )}
                {conditions.current && (
                  <View style={[cdStyles.miniTag, { borderColor: cdColors.current + '40' }]}>
                    <Text style={[cdStyles.miniTagText, { color: cdColors.current }]}>{conditions.current.toUpperCase()}</Text>
                  </View>
                )}
                {conditions.surface && (
                  <View style={[cdStyles.miniTag, { borderColor: cdColors.surface + '40' }]}>
                    <Text style={[cdStyles.miniTagText, { color: cdColors.surface }]}>{conditions.surface.toUpperCase()}</Text>
                  </View>
                )}
                {conditions.comfort && (
                  <View style={[cdStyles.miniTag, { borderColor: cdColors.comfort + '40' }]}>
                    <Text style={[cdStyles.miniTagText, { color: cdColors.comfort }]}>{'★'.repeat(conditions.comfort)}</Text>
                  </View>
                )}
                {conditions.equalization && (
                  <View style={[cdStyles.miniTag, { borderColor: cdColors.equalization + '40' }]}>
                    <Text style={[cdStyles.miniTagText, { color: cdColors.equalization }]}>EQ:{conditions.equalization.toUpperCase()}</Text>
                  </View>
                )}
              </View>
            )}
            <MaterialIcons name={conditionsExpanded ? 'expand-less' : 'expand-more'} size={18} color={Colors.outline} />
          </TouchableOpacity>
          {conditionsExpanded && (
            <View style={cdStyles.card}>
              {/* Water temp from Garmin */}
              {d.water_temp_c != null && (
                <View style={cdStyles.tempRow}>
                  <MaterialIcons name="thermostat" size={14} color={Colors.cyan} />
                  <Text style={cdStyles.tempLabel}>WATER TEMP</Text>
                  <Text style={cdStyles.tempValue}>{d.water_temp_c.toFixed(1)}°C</Text>
                </View>
              )}

              {/* Visibility */}
              <View style={cdStyles.tagSection}>
                <Text style={cdStyles.tagLabel}>VISIBILITY</Text>
                <View style={cdStyles.tagRow}>
                  {VISIBILITY_OPTS.map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={[cdStyles.tag, conditions.visibility === opt && { backgroundColor: cdColors.visibility + '20', borderColor: cdColors.visibility }]}
                      onPress={() => updateCondition('visibility', opt)}
                    >
                      <Text style={[cdStyles.tagText, conditions.visibility === opt && { color: cdColors.visibility }]}>{opt.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Current */}
              <View style={cdStyles.tagSection}>
                <Text style={cdStyles.tagLabel}>CURRENT</Text>
                <View style={cdStyles.tagRow}>
                  {CURRENT_OPTS.map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={[cdStyles.tag, conditions.current === opt && { backgroundColor: cdColors.current + '20', borderColor: cdColors.current }]}
                      onPress={() => updateCondition('current', opt)}
                    >
                      <Text style={[cdStyles.tagText, conditions.current === opt && { color: cdColors.current }]}>{opt.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Surface */}
              <View style={cdStyles.tagSection}>
                <Text style={cdStyles.tagLabel}>SURFACE</Text>
                <View style={cdStyles.tagRow}>
                  {SURFACE_OPTS.map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={[cdStyles.tag, conditions.surface === opt && { backgroundColor: cdColors.surface + '20', borderColor: cdColors.surface }]}
                      onPress={() => updateCondition('surface', opt)}
                    >
                      <Text style={[cdStyles.tagText, conditions.surface === opt && { color: cdColors.surface }]}>{opt.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Comfort rating */}
              <View style={cdStyles.tagSection}>
                <Text style={cdStyles.tagLabel}>COMFORT</Text>
                <View style={cdStyles.starRow}>
                  {([1, 2, 3, 4, 5] as const).map((n) => (
                    <TouchableOpacity key={n} onPress={() => updateCondition('comfort', n)} style={cdStyles.starBtn}>
                      <MaterialIcons
                        name={conditions.comfort && conditions.comfort >= n ? 'star' : 'star-border'}
                        size={24}
                        color={conditions.comfort && conditions.comfort >= n ? '#facc15' : Colors.outline}
                      />
                    </TouchableOpacity>
                  ))}
                  {conditions.comfort && (
                    <Text style={cdStyles.comfortLabel}>
                      {conditions.comfort === 1 ? 'Tough' : conditions.comfort === 2 ? 'Hard' : conditions.comfort === 3 ? 'OK' : conditions.comfort === 4 ? 'Good' : 'Perfect'}
                    </Text>
                  )}
                </View>
              </View>

              {/* Equalization */}
              <View style={cdStyles.tagSection}>
                <Text style={cdStyles.tagLabel}>EQUALIZATION</Text>
                <View style={cdStyles.tagRow}>
                  {EQ_OPTS.map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={[cdStyles.tag, conditions.equalization === opt && { backgroundColor: cdColors.equalization + '20', borderColor: cdColors.equalization }]}
                      onPress={() => updateCondition('equalization', opt)}
                    >
                      <Text style={[cdStyles.tagText, conditions.equalization === opt && { color: cdColors.equalization }]}>{opt.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {(conditions.equalization === 'limiting' || conditions.equalization === 'failed') && (
                  <View style={cdStyles.eqTip}>
                    <MaterialIcons name="info-outline" size={11} color={cdColors.equalization} />
                    <Text style={cdStyles.eqTipText}>
                      {conditions.equalization === 'failed'
                        ? 'EQ failure is the body\'s signal to turn. Never push past a failed equalization — risk of barotrauma. Consider dry Frenzel practice and mouthfill drills.'
                        : 'Tight EQ often improves with proper warm-up dives and relaxation. Try jaw-forward Frenzel and slower descent rate in the first 10m.'}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </FadeIn>

        {/* ── Individual dives ── */}
        <FadeIn delay={240}>
          <View style={styles.noteLabelRow}>
            <MaterialIcons name="scuba-diving" size={13} color={Colors.outline} />
            <Text style={[styles.sectionLabel, { marginTop: 16, marginBottom: 0 }]}>INDIVIDUAL DIVES</Text>
          </View>
          {loadingDives && (
            <ActivityIndicator color={Colors.cyan} style={{ marginVertical: 12 }} />
          )}
          {!loadingDives && (!dives || dives.length === 0) && (
            <View style={styles.divesEmpty}>
              <MaterialIcons name="water" size={22} color={Colors.outline} />
              <Text style={styles.divesEmptyText}>Per-dive data not available for this session</Text>
            </View>
          )}
          {dives && dives.length >= 1 && <DisciplineSummary dives={dives} />}
          {dives && dives.length >= 3 && <CoachSummary dives={dives} session={session} />}
          {dives && dives.length >= 2 && <DiveReflexSummaryCard dives={dives} />}
          {dives && dives.length >= 2 && <DepthOverlayCard dives={dives} />}
          {dives && dives.length >= 2 && <SessionShapeCard dives={dives} />}
          {dives && dives.length >= 3 && <SessionInsightsCard dives={dives} />}
          {dives && dives.length >= 4 && <WarmupQualityCard dives={dives} />}
          {dives && dives.length >= 2 && <SISafetyCard dives={dives} />}
          {dives && dives.length >= 2 && <DescentAscentCard dives={dives} />}
          {dives && dives.map((dive) => (
            <DiveRow
              key={dive.dive_number}
              dive={dive}
              expanded={expandedDive === dive.dive_number}
              onToggle={() => setExpandedDive(
                expandedDive === dive.dive_number ? null : dive.dive_number
              )}
            />
          ))}
        </FadeIn>

        {/* ── Session notes ── */}
        <FadeIn delay={260}>
          <View style={styles.noteSection}>
            <View style={styles.noteLabelRow}>
              <MaterialIcons name="notes" size={13} color={Colors.outline} />
              <Text style={styles.sectionLabel}>NOTES</Text>
            </View>

            {editingNote ? (
              <View style={styles.noteEditCard}>
                <TextInput
                  style={styles.noteInput}
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  multiline
                  autoFocus
                  placeholder="Equalization, conditions, how it felt..."
                  placeholderTextColor={Colors.outline}
                  returnKeyType="default"
                />
                <View style={styles.noteActions}>
                  <TouchableOpacity onPress={() => setEditingNote(false)} style={styles.noteCancelBtn}>
                    <Text style={styles.noteCancelText}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={saveNote} style={styles.noteSaveBtn}>
                    <MaterialIcons name="check" size={14} color={Colors.bg} />
                    <Text style={styles.noteSaveText}>SAVE</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : note ? (
              <TouchableOpacity
                onPress={() => { setNoteDraft(note); setEditingNote(true); }}
                style={styles.noteCard}
                activeOpacity={0.75}
              >
                <Text style={styles.noteText}>{note}</Text>
                <MaterialIcons name="edit" size={14} color={Colors.outline} style={{ marginTop: 6 }} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => { setNoteDraft(''); setEditingNote(true); }}
                style={styles.noteEmpty}
              >
                <MaterialIcons name="add" size={16} color={Colors.primaryDim} />
                <Text style={styles.noteEmptyText}>Add session notes</Text>
              </TouchableOpacity>
            )}
          </View>
        </FadeIn>

        {/* ── FIT Re-sync ── */}
        <FadeIn delay={280}>
          <TouchableOpacity
            style={fitStyles.btn}
            disabled={fitSyncing}
            onPress={async () => {
              setFitSyncing(true);
              setFitResult(null);
              try {
                const { data } = await getClient().post(`/sessions/${id}/dives/resync-fit`);
                setFitResult(`Synced ${data.dives_parsed} dives from FIT file`);
                // Invalidate dive cache so the screen reloads with new data
                queryClient.invalidateQueries({ queryKey: ['session-dives', Number(id)] });
              } catch (err: any) {
                setFitResult(`Failed: ${err?.response?.data?.detail ?? err.message}`);
              } finally {
                setFitSyncing(false);
              }
            }}
          >
            {fitSyncing ? (
              <ActivityIndicator size="small" color={Colors.primaryDim} />
            ) : (
              <MaterialIcons name="sync" size={14} color={Colors.primaryDim} />
            )}
            <Text style={fitStyles.btnText}>
              {fitSyncing ? 'SYNCING FIT FILE...' : 'RE-SYNC FROM FIT FILE'}
            </Text>
          </TouchableOpacity>
          {fitResult && (
            <Text style={[fitStyles.result, { color: fitResult.startsWith('Failed') ? Colors.error : '#4ade80' }]}>
              {fitResult}
            </Text>
          )}
          <Text style={fitStyles.hint}>
            Downloads raw FIT data from Garmin for higher-precision depth profiles
          </Text>
        </FadeIn>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Discipline badge ─────────────────────────────────────────────────────────
const DISC_COLOR: Record<string, string> = {
  CWT: Colors.cyan,
  FIM: Colors.orange,
  CNF: '#9b7fff',
};

// ── Coach Summary — synthesize all analysis into one paragraph ────────────────
function CoachSummary({ dives, session }: { dives: IndividualDive[]; session: Session }) {
  const summary = useMemo(() => {
    if (!dives || dives.length < 3) return null;

    const depths = dives.map((d) => d.max_depth_m);
    const maxDepth = Math.max(...depths);
    const maxIdx = depths.indexOf(maxDepth);
    const lines: string[] = [];

    // ── 1. Session shape
    const diveCount = dives.length;
    const avgDepth = depths.reduce((s, v) => s + v, 0) / depths.length;
    lines.push(`${diveCount} dives, max ${maxDepth.toFixed(1)}m (avg ${avgDepth.toFixed(1)}m).`);

    // ── 2. Warm-up quality
    if (maxIdx >= 3) {
      const warmupDepths = dives.slice(0, maxIdx).map((d) => d.max_depth_m);
      const startPct = Math.round((warmupDepths[0] / maxDepth) * 100);
      if (startPct < 45) {
        lines.push(`Textbook warm-up: ${maxIdx} dives building from ${warmupDepths[0].toFixed(0)}m (${startPct}% of max).`);
      } else {
        lines.push(`Warm-up started at ${startPct}% of max — consider starting shallower for better dive reflex activation.`);
      }
    } else if (maxIdx < 2 && diveCount >= 4) {
      lines.push(`Deepest dive was #${maxIdx + 1} — limited warm-up before max attempt.`);
    }

    // ── 3. Depth progression pattern
    const peakPct = maxIdx / (diveCount - 1);
    if (diveCount >= 5) {
      if (peakPct > 0.65) {
        lines.push('Strong progressive build — peaked late in the session.');
      } else if (peakPct < 0.3) {
        lines.push('Peaked early then tapered — possible fatigue or conservative approach.');
      }
    }

    // ── 4. Descent speed trend
    const descentSpeeds = dives
      .filter((d) => d.descent_time_s != null && d.descent_time_s > 0)
      .map((d) => d.max_depth_m / d.descent_time_s!);
    if (descentSpeeds.length >= 4) {
      const firstHalf = descentSpeeds.slice(0, Math.ceil(descentSpeeds.length / 2));
      const secondHalf = descentSpeeds.slice(Math.floor(descentSpeeds.length / 2));
      const avg1 = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
      const avg2 = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
      const delta = ((avg2 - avg1) / avg1) * 100;
      if (delta < -8) {
        lines.push(`Descent speed dropped ${Math.abs(delta).toFixed(0)}% through the session — fatigue signal.`);
      } else if (Math.abs(delta) <= 8) {
        lines.push('Descent speed stayed consistent throughout.');
      }
    }

    // ── 5. Surface intervals
    const siValues = dives
      .map((d) => d.surface_interval_s)
      .filter((v): v is number => v != null && v > 0 && v < 3600);
    if (siValues.length >= 3) {
      const avgSI = siValues.reduce((s, v) => s + v, 0) / siValues.length;
      // Check for short SIs after deep dives
      const shortSIs = dives.filter((d, i) => {
        if (i === 0 || !d.surface_interval_s) return false;
        const prevDepth = dives[i - 1].max_depth_m;
        const ratio = d.surface_interval_s! / (dives[i - 1].bottom_time_s || 30);
        return prevDepth > avgDepth && ratio < 2;
      });
      if (shortSIs.length > 0) {
        lines.push(`${shortSIs.length} surface interval${shortSIs.length > 1 ? 's were' : ' was'} shorter than 2× bottom time after deep dives — allow more recovery.`);
      } else if (avgSI > 120) {
        lines.push(`Good rest discipline — avg ${Math.round(avgSI / 60)}min surface intervals.`);
      }
    }

    // ── 6. Discipline mix
    const discCounts = new Map<string, number>();
    for (const d of dives) {
      const cls = classifyDiscipline(d);
      discCounts.set(cls.discipline, (discCounts.get(cls.discipline) ?? 0) + 1);
    }
    if (discCounts.size > 1) {
      const parts = Array.from(discCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([disc, count]) => `${count}× ${disc}`);
      lines.push(`Mixed disciplines: ${parts.join(', ')}.`);
    }

    // ── 7. Overall verdict
    let verdict: string;
    let icon: 'check-circle' | 'info' | 'warning';
    let color: string;
    if (maxIdx >= 2 && peakPct >= 0.3 && peakPct <= 0.85) {
      verdict = 'Well-structured session with progressive depth build.';
      icon = 'check-circle';
      color = '#4ade80';
    } else if (maxIdx < 2 && diveCount >= 4) {
      verdict = 'Consider more warm-up dives before max attempts for safety.';
      icon = 'warning';
      color = Colors.orange;
    } else {
      verdict = 'Solid session. Review individual dive cards below for details.';
      icon = 'info';
      color = Colors.cyan;
    }

    return { lines, verdict, icon, color };
  }, [dives, session]);

  if (!summary) return null;

  return (
    <View style={coachStyles.card}>
      <View style={coachStyles.header}>
        <MaterialIcons name="record-voice-over" size={14} color={Colors.cyan} />
        <Text style={coachStyles.title}>SESSION DEBRIEF</Text>
      </View>
      <Text style={coachStyles.body}>{summary.lines.join(' ')}</Text>
      <View style={[coachStyles.verdictRow, { backgroundColor: summary.color + '10' }]}>
        <MaterialIcons name={summary.icon} size={13} color={summary.color} />
        <Text style={[coachStyles.verdictText, { color: summary.color }]}>{summary.verdict}</Text>
      </View>
    </View>
  );
}

const coachStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cyan + '15',
    padding: 16, marginBottom: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10,
  },
  title: {
    fontSize: 9, color: Colors.cyan, letterSpacing: 2.5, fontWeight: '700',
  },
  body: {
    fontSize: 13, color: Colors.onSurface, lineHeight: 20, marginBottom: 12,
  },
  verdictRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 8, padding: 10,
  },
  verdictText: {
    fontSize: 12, fontWeight: '600', flex: 1, lineHeight: 17,
  },
});

// ── Mini profile chart ────────────────────────────────────────────────────────
function MiniChart({
  data, color, inverted = false, height = 52, label,
}: {
  data: TimeSeries; color: string; inverted?: boolean; height?: number; label?: string;
}) {
  if (!data || data.length < 2) return null;
  const values = data.map(([, v]) => v);
  const maxV = Math.max(...values, 0.1);
  const minV = inverted ? 0 : Math.min(...values);
  const range = maxV - minV || 1;

  return (
    <View style={{ marginBottom: 8 }}>
      {label && <Text style={dvStyles.chartLabel}>{label}</Text>}
      <View style={[dvStyles.chartTrack, { height }]}>
        {data.map(([t, v], i) => {
          const pct = (v - minV) / range;
          const barH = Math.max(2, pct * height);
          return (
            <View
              key={i}
              style={[
                dvStyles.chartBar,
                inverted
                  ? { height: barH, alignSelf: 'flex-start', backgroundColor: color + 'cc' }
                  : { height: barH, alignSelf: 'flex-end', backgroundColor: color + 'cc' },
              ]}
            />
          );
        })}
      </View>
      <View style={dvStyles.chartAxis}>
        <Text style={dvStyles.chartAxisLabel}>0s</Text>
        <Text style={dvStyles.chartAxisLabel}>{data[data.length - 1][0]}s</Text>
      </View>
    </View>
  );
}

// ── Dive detail link ──────────────────────────────────────────────────────────
function DiveDetailLink({ dive, discColor }: { dive: IndividualDive; discColor: string }) {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={dvStyles.detailLink}
      onPress={() => router.push({
        pathname: '/dive/[id]' as any,
        params: { id: String(dive.dive_number), diveJson: JSON.stringify(dive) },
      })}
    >
      <MaterialIcons name="analytics" size={12} color={discColor} />
      <Text style={[dvStyles.detailLinkText, { color: discColor }]}>DETAILED VIEW</Text>
      <MaterialIcons name="chevron-right" size={14} color={discColor} />
    </TouchableOpacity>
  );
}

// ── Depth zone breakdown ──────────────────────────────────────────────────────
interface DepthZone {
  label: string;
  note: string;
  minM: number;
  maxM: number;
  color: string;
  timeS: number;
  pct: number;
}

function DepthZoneBreakdown({
  depthProfile, maxDepth, discColor,
}: {
  depthProfile: TimeSeries; maxDepth: number; discColor: string;
}) {
  // Define zones based on actual dive depth
  const zones: Omit<DepthZone, 'timeS' | 'pct'>[] = [
    { label: 'SURFACE', note: 'Duck dive', minM: 0, maxM: 5, color: Colors.primaryDim },
  ];
  if (maxDepth >= 10) {
    zones.push({ label: 'FRENZEL', note: '5–10m', minM: 5, maxM: 10, color: Colors.cyan });
  }
  if (maxDepth >= 20) {
    zones.push({ label: 'TRANSITION', note: '10–20m', minM: 10, maxM: 20, color: Colors.orange });
    zones.push({ label: 'MOUTHFILL', note: '20m+', minM: 20, maxM: 999, color: '#9b7fff' });
  } else if (maxDepth >= 10) {
    zones.push({ label: 'DEEP', note: '10m+', minM: 10, maxM: 999, color: Colors.orange });
  }

  // Compute time in each zone from depth profile
  let totalTime = 0;
  const zoneTimes = new Array(zones.length).fill(0);

  for (let i = 1; i < depthProfile.length; i++) {
    const dt = depthProfile[i][0] - depthProfile[i - 1][0];
    if (dt <= 0) continue;
    const avgDepth = (depthProfile[i][1] + depthProfile[i - 1][1]) / 2;
    totalTime += dt;

    for (let z = zones.length - 1; z >= 0; z--) {
      if (avgDepth >= zones[z].minM) {
        zoneTimes[z] += dt;
        break;
      }
    }
  }

  if (totalTime <= 0) return null;

  const zoneData: DepthZone[] = zones.map((z, i) => ({
    ...z,
    timeS: zoneTimes[i],
    pct: zoneTimes[i] / totalTime,
  })).filter((z) => z.timeS > 0.5); // only show zones with meaningful time

  if (zoneData.length < 2) return null;

  return (
    <View style={dzStyles.wrap}>
      <Text style={dzStyles.label}>DEPTH ZONES</Text>

      {/* Stacked proportion bar */}
      <View style={dzStyles.propBar}>
        {zoneData.map((z) => (
          <View
            key={z.label}
            style={[dzStyles.propSegment, {
              flex: z.pct,
              backgroundColor: z.color + '90',
            }]}
          />
        ))}
      </View>

      {/* Zone rows */}
      {zoneData.map((z) => (
        <View key={z.label} style={dzStyles.zoneRow}>
          <View style={[dzStyles.zoneDot, { backgroundColor: z.color }]} />
          <Text style={[dzStyles.zoneName, { color: z.color }]}>{z.label}</Text>
          <Text style={dzStyles.zoneNote}>{z.note}</Text>
          <Text style={dzStyles.zoneTime}>{Math.round(z.timeS)}s</Text>
          <Text style={dzStyles.zonePct}>{Math.round(z.pct * 100)}%</Text>
        </View>
      ))}
    </View>
  );
}

// ── DiveRow ───────────────────────────────────────────────────────────────────
function DiveRow({
  dive, expanded, onToggle,
}: {
  dive: IndividualDive; expanded: boolean; onToggle: () => void;
}) {
  const cls = classifyDiscipline(dive);
  const discColor = DISC_COLOR[cls.discipline] ?? Colors.outline;
  // Only first 3 non-safety dives are warmups; later hangs are labeled "HANG"
  const hangLabel = cls.isWarmup
    ? (dive.dive_number <= 3 ? 'WARMUP' : `HANG ${Math.round(cls.bottomHangS)}s`)
    : null;

  return (
    <Pressable onPress={onToggle} style={dvStyles.diveRow}>
      {/* ── Header row ── */}
      <View style={dvStyles.diveHeader}>
        <View style={[dvStyles.diveNumBadge, { backgroundColor: discColor + '20' }]}>
          <Text style={[dvStyles.diveNum, { color: discColor }]}>#{dive.dive_number}</Text>
        </View>

        <View style={dvStyles.diveInfo}>
          <Text style={dvStyles.diveDepth}>{dive.max_depth_m.toFixed(1)}m</Text>
          <Text style={dvStyles.diveBt}>{fmtSeconds(dive.bottom_time_s)}</Text>
        </View>

        {/* Surface interval */}
        {dive.surface_interval_s != null && (
          <Text style={dvStyles.diveSI}>SI {fmtSeconds(dive.surface_interval_s)}</Text>
        )}

        {/* Warmup / Hang badge */}
        {hangLabel && (
          <View style={dvStyles.warmupBadge}>
            <Text style={dvStyles.warmupText}>{hangLabel}</Text>
          </View>
        )}

        {/* Discipline badge */}
        <View style={[dvStyles.discBadge, { borderColor: discColor + '60' }]}>
          <Text style={[dvStyles.discText, { color: discColor }]}>{cls.discipline}</Text>
          {cls.confidence !== 'high' && (
            <Text style={dvStyles.discConf}>{cls.confidence === 'medium' ? '~' : '?'}</Text>
          )}
        </View>

        <MaterialIcons
          name={expanded ? 'expand-less' : 'expand-more'}
          size={18}
          color={Colors.outline}
        />
      </View>

      {/* ── Expanded detail ── */}
      {expanded && (
        <View style={dvStyles.diveDetail}>
          {/* Timing row */}
          <View style={dvStyles.timingRow}>
            {dive.descent_time_s != null && (
              <View style={dvStyles.timingCell}>
                <Text style={dvStyles.timingLabel}>DESCENT</Text>
                <Text style={dvStyles.timingValue}>{fmtSeconds(dive.descent_time_s)}</Text>
                <Text style={dvStyles.timingVelocity}>
                  {(dive.max_depth_m / dive.descent_time_s).toFixed(2)} m/s
                </Text>
              </View>
            )}
            {dive.ascent_time_s != null && (
              <View style={dvStyles.timingCell}>
                <Text style={dvStyles.timingLabel}>ASCENT</Text>
                <Text style={dvStyles.timingValue}>{fmtSeconds(dive.ascent_time_s)}</Text>
                <Text style={dvStyles.timingVelocity}>
                  {(dive.max_depth_m / dive.ascent_time_s).toFixed(2)} m/s
                </Text>
              </View>
            )}
            {dive.min_hr != null && (
              <View style={dvStyles.timingCell}>
                <Text style={dvStyles.timingLabel}>MIN HR</Text>
                <Text style={[dvStyles.timingValue, { color: Colors.cyan }]}>
                  {Math.round(dive.min_hr)}
                </Text>
                <Text style={dvStyles.timingVelocity}>bpm</Text>
              </View>
            )}
            {dive.max_hr != null && (
              <View style={dvStyles.timingCell}>
                <Text style={dvStyles.timingLabel}>MAX HR</Text>
                <Text style={dvStyles.timingValue}>{Math.round(dive.max_hr)}</Text>
                <Text style={dvStyles.timingVelocity}>bpm</Text>
              </View>
            )}
          </View>

          {/* Discipline reasoning */}
          <View style={dvStyles.clsRow}>
            <MaterialIcons name="info-outline" size={11} color={Colors.outline} />
            <Text style={dvStyles.clsReason}>{cls.reason}</Text>
          </View>

          {/* Depth zone breakdown */}
          {dive.depth_profile && dive.depth_profile.length > 3 && dive.max_depth_m >= 5 && (
            <DepthZoneBreakdown depthProfile={dive.depth_profile} maxDepth={dive.max_depth_m} discColor={discColor} />
          )}

          {/* Depth profile (inverted: deeper = taller bar from top) */}
          {dive.depth_profile && dive.depth_profile.length > 1 && (
            <MiniChart
              data={dive.depth_profile}
              color={discColor}
              inverted
              height={70}
              label="DEPTH PROFILE"
            />
          )}

          {/* HR profile */}
          {dive.hr_profile && dive.hr_profile.length > 1 && (
            <MiniChart
              data={dive.hr_profile}
              color={Colors.error}
              height={48}
              label="HEART RATE"
            />
          )}

          {/* Velocity profile */}
          {dive.velocity_profile && dive.velocity_profile.length > 1 && (
            <MiniChart
              data={dive.velocity_profile}
              color={Colors.orange}
              height={40}
              label="VERTICAL SPEED (m/s)"
            />
          )}

          {/* Detailed view link */}
          <DiveDetailLink dive={dive} discColor={discColor} />
        </View>
      )}
    </Pressable>
  );
}

// ── Session discipline summary ────────────────────────────────────────────────
function DisciplineSummary({ dives }: { dives: IndividualDive[] }) {
  if (!dives || dives.length < 1) return null;

  // Classify all dives and aggregate
  const counts: Record<string, number> = {};
  let warmupCount = 0;
  let hangCount = 0;
  let totalBottomS = 0;
  for (const dive of dives) {
    const cls = classifyDiscipline(dive);
    counts[cls.discipline] = (counts[cls.discipline] ?? 0) + 1;
    if (cls.isWarmup && dive.dive_number <= 3) warmupCount++;
    else if (cls.isWarmup) hangCount++;
    totalBottomS += dive.bottom_time_s;
  }

  // Sort by count descending
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const primary = sorted[0]?.[0] ?? 'CWT';
  const totalDives = dives.length;

  return (
    <View style={discSumStyles.wrap}>
      {/* Discipline proportion bar */}
      <View style={discSumStyles.propBar}>
        {sorted.map(([disc, count]) => (
          <View
            key={disc}
            style={[discSumStyles.propSegment, {
              flex: count,
              backgroundColor: (DISC_COLOR[disc] ?? Colors.outline) + '80',
            }]}
          />
        ))}
      </View>

      {/* Discipline pills */}
      <View style={discSumStyles.pillRow}>
        {sorted.map(([disc, count]) => {
          const color = DISC_COLOR[disc] ?? Colors.outline;
          return (
            <View key={disc} style={[discSumStyles.pill, { borderColor: color + '50' }]}>
              <View style={[discSumStyles.pillDot, { backgroundColor: color }]} />
              <Text style={[discSumStyles.pillDisc, { color }]}>{disc}</Text>
              <Text style={discSumStyles.pillCount}>{count}</Text>
            </View>
          );
        })}
        {warmupCount > 0 && (
          <View style={[discSumStyles.pill, { borderColor: Colors.orange + '40' }]}>
            <Text style={[discSumStyles.pillDisc, { color: Colors.orange }]}>WARMUP</Text>
            <Text style={discSumStyles.pillCount}>{warmupCount}</Text>
          </View>
        )}
        {hangCount > 0 && (
          <View style={[discSumStyles.pill, { borderColor: Colors.outline + '40' }]}>
            <Text style={[discSumStyles.pillDisc, { color: Colors.outline }]}>HANG</Text>
            <Text style={discSumStyles.pillCount}>{hangCount}</Text>
          </View>
        )}
      </View>

      {/* Bottom line: total underwater time */}
      <Text style={discSumStyles.bottomLine}>
        {totalDives} dive{totalDives !== 1 ? 's' : ''}
        {' · '}{fmtSeconds(totalBottomS)} total underwater
        {sorted.length === 1 ? ` · Pure ${primary} session` : ` · Mixed session`}
      </Text>
    </View>
  );
}

// ── Depth profile overlay card ────────────────────────────────────────────────
const OVERLAY_DISC_COLOR: Record<string, string> = {
  CWT: Colors.cyan,
  FIM: Colors.orange,
  CNF: '#9b7fff',
};

// ── Dive Reflex Summary ─────────────────────────────────────────────────────
// Aggregates mammalian dive reflex (MDR) across all dives in the session.
// Shows how HR drop % progresses through warm-ups and working dives.

const QUALITY_COLOR: Record<string, string> = {
  excellent: '#4ade80',
  strong: Colors.cyan,
  developing: Colors.orange,
  minimal: Colors.outline,
};

function DiveReflexSummaryCard({ dives }: { dives: IndividualDive[] }) {
  const reflexData = useMemo(() => {
    const results: { diveNum: number; depth: number; reflex: DiveReflexResult }[] = [];
    for (const dive of dives) {
      if (dive.hr_profile && dive.hr_profile.length >= 6) {
        const r = analyzeDiveReflex(dive.hr_profile);
        if (r) results.push({ diveNum: dive.dive_number, depth: dive.max_depth_m, reflex: r });
      }
    }
    return results;
  }, [dives]);

  if (reflexData.length < 2) return null;

  const drops = reflexData.map((r) => r.reflex.dropPct);
  const avgDrop = drops.reduce((a, b) => a + b, 0) / drops.length;
  const bestDrop = Math.max(...drops);
  const bestIdx = drops.indexOf(bestDrop);
  const bestDive = reflexData[bestIdx];

  // Reflex progression: compare first half to second half
  const mid = Math.floor(reflexData.length / 2);
  const firstHalfAvg = reflexData.slice(0, mid).reduce((s, r) => s + r.reflex.dropPct, 0) / mid;
  const secondHalfAvg = reflexData.slice(mid).reduce((s, r) => s + r.reflex.dropPct, 0) / (reflexData.length - mid);
  const progression = secondHalfAvg - firstHalfAvg;
  const improving = progression > 2;

  // Quality distribution
  const qualCounts: Record<string, number> = { excellent: 0, strong: 0, developing: 0, minimal: 0 };
  for (const r of reflexData) qualCounts[r.reflex.quality]++;

  // Max bar height for the chart
  const maxDrop = Math.max(...drops, 1);

  return (
    <View style={drStyles.card}>
      <View style={drStyles.header}>
        <MaterialIcons name="favorite" size={13} color={Colors.error} />
        <Text style={drStyles.title}>DIVE REFLEX</Text>
        {improving && (
          <View style={drStyles.improvBadge}>
            <MaterialIcons name="trending-up" size={9} color="#4ade80" />
            <Text style={drStyles.improvText}>IMPROVING</Text>
          </View>
        )}
      </View>

      {/* HR drop bar chart across dives */}
      <View style={drStyles.chart}>
        {reflexData.map((r, i) => {
          const h = Math.max(4, (r.reflex.dropPct / maxDrop) * 48);
          const color = QUALITY_COLOR[r.reflex.quality] ?? Colors.outline;
          const isBest = i === bestIdx;
          return (
            <View key={r.diveNum} style={drStyles.barWrap}>
              {isBest && <View style={[drStyles.bestDot, { backgroundColor: color }]} />}
              <View style={[drStyles.bar, { height: h, backgroundColor: isBest ? color : color + '70' }]} />
              <Text style={drStyles.barLabel}>#{r.diveNum}</Text>
            </View>
          );
        })}
      </View>
      <View style={drStyles.chartAxis}>
        <Text style={drStyles.axisText}>HR DROP % PER DIVE</Text>
      </View>

      {/* Stats row */}
      <View style={drStyles.statsRow}>
        <View style={drStyles.stat}>
          <Text style={drStyles.statLabel}>AVG DROP</Text>
          <Text style={[drStyles.statValue, { color: Colors.error }]}>
            -{Math.round(avgDrop)}%
          </Text>
        </View>
        <View style={[drStyles.stat, drStyles.statBorder]}>
          <Text style={drStyles.statLabel}>BEST</Text>
          <Text style={[drStyles.statValue, { color: QUALITY_COLOR[bestDive.reflex.quality] }]}>
            -{Math.round(bestDrop)}%
          </Text>
          <Text style={drStyles.statSub}>dive #{bestDive.diveNum} · {bestDive.depth.toFixed(0)}m</Text>
        </View>
        <View style={[drStyles.stat, drStyles.statBorder]}>
          <Text style={drStyles.statLabel}>PROGRESSION</Text>
          <Text style={[drStyles.statValue, { color: improving ? '#4ade80' : progression < -2 ? Colors.orange : Colors.outline }]}>
            {progression > 0 ? '+' : ''}{Math.round(progression)}%
          </Text>
          <Text style={drStyles.statSub}>{improving ? '2nd half stronger' : progression < -2 ? 'fatigue signal' : 'steady'}</Text>
        </View>
      </View>

      {/* Quality distribution */}
      <View style={drStyles.qualRow}>
        {(['excellent', 'strong', 'developing', 'minimal'] as const).map((q) => {
          const count = qualCounts[q];
          if (count === 0) return null;
          return (
            <View key={q} style={drStyles.qualChip}>
              <View style={[drStyles.qualDot, { backgroundColor: QUALITY_COLOR[q] }]} />
              <Text style={[drStyles.qualText, { color: QUALITY_COLOR[q] }]}>
                {count}× {q.toUpperCase()}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Coaching note */}
      <Text style={drStyles.tip}>
        {improving
          ? 'Dive reflex strengthened through the session — good warm-up protocol activating your MDR progressively.'
          : progression < -2
          ? 'HR drop decreased later in the session — possible fatigue or sympathetic nervous system activation. Consider shorter sessions or longer surface intervals.'
          : avgDrop >= 30
          ? 'Strong dive reflex throughout the session. Your mammalian dive response is well-trained.'
          : avgDrop >= 20
          ? 'Moderate dive reflex. Cold water exposure and progressive depth training will strengthen your MDR over time.'
          : 'Dive reflex is developing. Focus on relaxation techniques during breathe-up and progressive warm-up protocol.'}
      </Text>
    </View>
  );
}

const drStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14, marginTop: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12,
  },
  title: {
    fontSize: 9, letterSpacing: 2.5, fontWeight: '700', flex: 1,
    color: Colors.onSurfaceVariant,
  },
  improvBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: '#4ade8015', borderWidth: 1, borderColor: '#4ade8040',
  },
  improvText: { fontSize: 7, fontWeight: '700', color: '#4ade80', letterSpacing: 1.5 },
  chart: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 3,
    height: 56, paddingHorizontal: 4,
  },
  barWrap: { flex: 1, alignItems: 'center' },
  bestDot: {
    width: 4, height: 4, borderRadius: 2, marginBottom: 2,
  },
  bar: { width: '80%', borderRadius: 2, minWidth: 4, maxWidth: 16 },
  barLabel: { fontSize: 7, color: Colors.outline, marginTop: 2 },
  chartAxis: { alignItems: 'center', marginTop: 2, marginBottom: 10 },
  axisText: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5 },
  statsRow: { flexDirection: 'row', marginBottom: 10 },
  stat: { flex: 1, alignItems: 'center' },
  statBorder: { borderLeftWidth: 1, borderLeftColor: Colors.outlineVariant + '30' },
  statLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginBottom: 3 },
  statValue: { fontSize: 18, fontWeight: '700' },
  statSub: { fontSize: 8, color: Colors.outline, marginTop: 1 },
  qualRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10,
  },
  qualChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
    backgroundColor: Colors.surfaceLow,
  },
  qualDot: { width: 5, height: 5, borderRadius: 2.5 },
  qualText: { fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  tip: {
    fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16,
    backgroundColor: Colors.surfaceLow, borderRadius: 8, padding: 10,
  },
});

const OVERLAY_W = Dimensions.get('window').width - 48;
const OVERLAY_H = 160;
const OV_PAD = { top: 10, bottom: 18, left: 30, right: 8 };
const OV_PLOT_W = OVERLAY_W - OV_PAD.left - OV_PAD.right;
const OV_PLOT_H = OVERLAY_H - OV_PAD.top - OV_PAD.bottom;

function DepthOverlayCard({ dives }: { dives: IndividualDive[] }) {
  // Only show dives that have depth profiles
  const profileDives = useMemo(
    () => dives.filter((d) => d.depth_profile && d.depth_profile.length > 3),
    [dives],
  );
  if (profileDives.length < 2) return null;

  // Find global max depth and max duration (time-aligned from t=0)
  const globalMaxDepth = Math.max(...profileDives.map((d) => d.max_depth_m), 1);
  const globalMaxTime = Math.max(
    ...profileDives.map((d) => {
      const p = d.depth_profile!;
      return p[p.length - 1][0] - p[0][0];
    }),
    1,
  );

  // Build Skia paths for each dive
  const paths = useMemo(() => {
    return profileDives.map((dive) => {
      const profile = dive.depth_profile!;
      const t0 = profile[0][0];
      const cls = classifyDiscipline(dive);
      const color = OVERLAY_DISC_COLOR[cls.discipline] ?? Colors.outline;

      const path = Skia.Path.Make();
      for (let i = 0; i < profile.length; i++) {
        const t = profile[i][0] - t0;
        const depth = profile[i][1];
        const x = OV_PAD.left + (t / globalMaxTime) * OV_PLOT_W;
        const y = OV_PAD.top + (depth / globalMaxDepth) * OV_PLOT_H;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      return { path, color, diveNum: dive.dive_number, maxDepth: dive.max_depth_m };
    });
  }, [profileDives, globalMaxDepth, globalMaxTime]);

  // Y axis labels (depth ticks)
  const yTicks = useMemo(() => {
    const step = globalMaxDepth <= 15 ? 5 : globalMaxDepth <= 30 ? 10 : 15;
    const ticks: number[] = [0];
    for (let d = step; d <= globalMaxDepth; d += step) ticks.push(d);
    return ticks;
  }, [globalMaxDepth]);

  // Time axis labels
  const maxTimeFmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
  };

  return (
    <View style={ovStyles.card}>
      <View style={ovStyles.header}>
        <Text style={ovStyles.micro}>DEPTH OVERLAY</Text>
        <Text style={ovStyles.sub}>{profileDives.length} dives</Text>
      </View>

      <View style={{ position: 'relative' }}>
        {/* Y axis depth labels */}
        {yTicks.map((tick) => {
          const y = OV_PAD.top + (tick / globalMaxDepth) * OV_PLOT_H;
          return (
            <Text key={tick} style={[ovStyles.yLabel, { top: y - 5 }]}>
              {tick}m
            </Text>
          );
        })}

        <Canvas style={{ width: OVERLAY_W, height: OVERLAY_H }}>
          {/* Horizontal grid lines */}
          {yTicks.map((tick) => {
            const y = OV_PAD.top + (tick / globalMaxDepth) * OV_PLOT_H;
            return (
              <Line
                key={tick}
                p1={vec(OV_PAD.left, y)}
                p2={vec(OV_PAD.left + OV_PLOT_W, y)}
                color={Skia.Color(Colors.outline + '15')}
                style="stroke"
                strokeWidth={0.5}
              />
            );
          })}
          {/* Dive profile lines — deepest dive rendered last (on top) */}
          {paths
            .slice()
            .sort((a, b) => a.maxDepth - b.maxDepth)
            .map(({ path, color, diveNum }) => (
              <SkPath
                key={diveNum}
                path={path}
                color={Skia.Color(color)}
                style="stroke"
                strokeWidth={1.5}
                strokeCap="round"
                strokeJoin="round"
              />
            ))}
        </Canvas>
      </View>

      {/* Time axis */}
      <View style={ovStyles.timeAxis}>
        <Text style={ovStyles.timeLabel}>0s</Text>
        <Text style={ovStyles.timeLabel}>{maxTimeFmt(globalMaxTime / 2)}</Text>
        <Text style={ovStyles.timeLabel}>{maxTimeFmt(globalMaxTime)}</Text>
      </View>

      {/* Legend */}
      <View style={ovStyles.legend}>
        {paths.map(({ color, diveNum, maxDepth }) => (
          <View key={diveNum} style={ovStyles.legendItem}>
            <View style={[ovStyles.legendDot, { backgroundColor: color }]} />
            <Text style={ovStyles.legendText}>#{diveNum}</Text>
            <Text style={ovStyles.legendDepth}>{maxDepth.toFixed(1)}m</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Session shape overview card ───────────────────────────────────────────────
function SessionShapeCard({ dives }: { dives: IndividualDive[] }) {
  if (!dives || dives.length < 2) return null;

  const maxDepth = Math.max(...dives.map((d) => d.max_depth_m), 0.1);
  const bestDive = dives.reduce((a, b) => (b.max_depth_m > a.max_depth_m ? b : a));

  // Surface interval stats
  const siValues = dives
    .map((d) => d.surface_interval_s)
    .filter((v): v is number => v != null && v > 0 && v < 3600);
  const avgSI = siValues.length > 0 ? siValues.reduce((a, b) => a + b, 0) / siValues.length : null;

  // SI consistency (coefficient of variation)
  let siCV: number | null = null;
  if (siValues.length >= 3 && avgSI) {
    const variance = siValues.reduce((s, v) => s + (v - avgSI) ** 2, 0) / siValues.length;
    siCV = Math.sqrt(variance) / avgSI;
  }
  const siLabel  = siCV === null ? null : siCV < 0.20 ? 'Consistent' : siCV < 0.45 ? 'Variable' : 'Erratic';
  const siColor  = siCV === null ? Colors.outline : siCV < 0.20 ? '#4ade80' : siCV < 0.45 ? Colors.orange : Colors.error;

  // Depth warm-up pattern: does depth generally increase in the first half?
  const mid = Math.floor(dives.length / 2);
  const firstHalfAvg = dives.slice(0, mid).reduce((s, d) => s + d.max_depth_m, 0) / mid;
  const secondHalfAvg = dives.slice(mid).reduce((s, d) => s + d.max_depth_m, 0) / (dives.length - mid);
  const hasWarmup = secondHalfAvg > firstHalfAvg * 1.05;

  return (
    <View style={shapeStyles.card}>
      <View style={shapeStyles.header}>
        <Text style={shapeStyles.micro}>SESSION SHAPE</Text>
        {hasWarmup && (
          <View style={shapeStyles.warmupBadge}>
            <MaterialIcons name="trending-up" size={9} color="#4ade80" />
            <Text style={shapeStyles.warmupText}>WARM-UP PATTERN</Text>
          </View>
        )}
      </View>

      {/* Depth bar chart across the dive sequence */}
      <View style={shapeStyles.chart}>
        {dives.map((dive) => {
          const cls = classifyDiscipline(dive);
          const color = DISC_COLOR[cls.discipline] ?? Colors.primaryDim;
          const barH = Math.max(3, (dive.max_depth_m / maxDepth) * 60);
          const isBest = dive.dive_number === bestDive.dive_number;
          return (
            <View key={dive.dive_number} style={shapeStyles.barWrap}>
              {isBest && <View style={shapeStyles.bestDot} />}
              <View style={[
                shapeStyles.bar,
                { height: barH, backgroundColor: isBest ? color : color + '55' },
              ]} />
            </View>
          );
        })}
      </View>

      {/* Aggregate stats */}
      <View style={shapeStyles.statsRow}>
        <View style={shapeStyles.stat}>
          <Text style={shapeStyles.statLbl}>DIVES</Text>
          <Text style={shapeStyles.statVal}>{dives.length}</Text>
        </View>
        {avgSI !== null && (
          <View style={shapeStyles.stat}>
            <Text style={shapeStyles.statLbl}>AVG SI</Text>
            <Text style={shapeStyles.statVal}>{fmtSeconds(avgSI)}</Text>
          </View>
        )}
        {siLabel !== null && (
          <View style={shapeStyles.stat}>
            <Text style={shapeStyles.statLbl}>SI RHYTHM</Text>
            <Text style={[shapeStyles.statVal, { color: siColor }]}>{siLabel}</Text>
          </View>
        )}
        <View style={shapeStyles.stat}>
          <Text style={shapeStyles.statLbl}>BEST</Text>
          <Text style={[shapeStyles.statVal, { color: Colors.cyan }]}>{bestDive.max_depth_m.toFixed(1)}m</Text>
        </View>
      </View>
    </View>
  );
}

// ── Surface interval safety analysis ──────────────────────────────────────────
interface SIWarning {
  diveNum: number;
  siS: number;
  prevBottomS: number;
  ratio: number;
  severity: 'danger' | 'caution';
}

// ── Warm-up quality analysis ──────────────────────────────────────────────────
function WarmupQualityCard({ dives }: { dives: IndividualDive[] }) {
  if (!dives || dives.length < 4) return null;

  const depths = dives.map((d) => d.max_depth_m);
  const maxDepth = Math.max(...depths);
  const maxIdx = depths.indexOf(maxDepth);

  // Warm-up = dives before the deepest dive
  if (maxIdx < 2) {
    // Not enough warm-up dives before max attempt
    return (
      <View style={wuStyles.card}>
        <View style={wuStyles.header}>
          <Text style={wuStyles.micro}>WARM-UP ANALYSIS</Text>
        </View>
        <View style={wuStyles.alertRow}>
          <MaterialIcons name="warning" size={14} color={Colors.orange} />
          <Text style={wuStyles.alertText}>
            Deepest dive was #{maxIdx + 1} of {dives.length} — only {maxIdx} warm-up dive{maxIdx !== 1 ? 's' : ''} before max attempt
          </Text>
        </View>
        <Text style={wuStyles.tip}>
          Aim for 3+ progressive warm-up dives before pushing depth to allow proper equalization and mammalian dive reflex activation.
        </Text>
      </View>
    );
  }

  const warmupDives = dives.slice(0, maxIdx);
  const warmupDepths = warmupDives.map((d) => d.max_depth_m);

  // Check if warm-up was progressive (each dive deeper or same as previous)
  let progressiveCount = 0;
  for (let i = 1; i < warmupDepths.length; i++) {
    if (warmupDepths[i] >= warmupDepths[i - 1] - 0.5) progressiveCount++;
  }
  const progressiveRatio = warmupDepths.length > 1
    ? progressiveCount / (warmupDepths.length - 1)
    : 1;

  // Max depth jump between consecutive warm-up dives
  let maxJump = 0;
  for (let i = 1; i < warmupDepths.length; i++) {
    const jump = warmupDepths[i] - warmupDepths[i - 1];
    if (jump > maxJump) maxJump = jump;
  }

  // First warm-up depth as % of max
  const startPct = (warmupDepths[0] / maxDepth) * 100;
  // Last warm-up depth as % of max
  const lastWarmupPct = (warmupDepths[warmupDepths.length - 1] / maxDepth) * 100;

  // Quality rating
  let quality: 'excellent' | 'good' | 'rushed' | 'insufficient';
  let qualityColor: string;
  if (warmupDives.length >= 3 && progressiveRatio >= 0.8 && startPct < 50 && maxJump < maxDepth * 0.4) {
    quality = 'excellent';
    qualityColor = '#4ade80';
  } else if (warmupDives.length >= 2 && progressiveRatio >= 0.6 && startPct < 65) {
    quality = 'good';
    qualityColor = Colors.cyan;
  } else if (warmupDives.length >= 2 && (startPct >= 65 || maxJump >= maxDepth * 0.5)) {
    quality = 'rushed';
    qualityColor = Colors.orange;
  } else {
    quality = 'insufficient';
    qualityColor = Colors.error;
  }

  const qualityLabel = {
    excellent: 'Textbook',
    good: 'Solid',
    rushed: 'Rushed',
    insufficient: 'Needs Work',
  }[quality];

  // Build mini depth progression bar chart for warm-up + max
  const vizDives = [...warmupDives, dives[maxIdx]];
  const vizMax = maxDepth;

  return (
    <View style={wuStyles.card}>
      <View style={wuStyles.header}>
        <Text style={wuStyles.micro}>WARM-UP ANALYSIS</Text>
        <View style={[wuStyles.badge, { backgroundColor: qualityColor + '20' }]}>
          <Text style={[wuStyles.badgeText, { color: qualityColor }]}>{qualityLabel.toUpperCase()}</Text>
        </View>
      </View>

      {/* Mini depth progression */}
      <View style={wuStyles.vizRow}>
        {vizDives.map((d, i) => {
          const isMax = i === vizDives.length - 1;
          const h = Math.max(6, (d.max_depth_m / vizMax) * 48);
          return (
            <View key={i} style={wuStyles.vizCol}>
              <View style={wuStyles.vizBarTrack}>
                <View style={[wuStyles.vizBar, {
                  height: h,
                  backgroundColor: isMax ? Colors.cyan : qualityColor + '80',
                }]} />
              </View>
              <Text style={[wuStyles.vizLabel, isMax && { color: Colors.cyan, fontWeight: '700' }]}>
                {d.max_depth_m.toFixed(0)}m
              </Text>
              <Text style={wuStyles.vizNum}>#{d.dive_number}</Text>
            </View>
          );
        })}
      </View>

      {/* Stats */}
      <View style={wuStyles.statsRow}>
        <View style={wuStyles.stat}>
          <Text style={wuStyles.statValue}>{warmupDives.length}</Text>
          <Text style={wuStyles.statLabel}>WARM-UPS</Text>
        </View>
        <View style={wuStyles.statDiv} />
        <View style={wuStyles.stat}>
          <Text style={wuStyles.statValue}>{warmupDepths[0].toFixed(0)}m</Text>
          <Text style={wuStyles.statLabel}>STARTED AT</Text>
        </View>
        <View style={wuStyles.statDiv} />
        <View style={wuStyles.stat}>
          <Text style={wuStyles.statValue}>{Math.round(startPct)}%</Text>
          <Text style={wuStyles.statLabel}>OF MAX</Text>
        </View>
        <View style={wuStyles.statDiv} />
        <View style={wuStyles.stat}>
          <Text style={[wuStyles.statValue, maxJump > maxDepth * 0.4 ? { color: Colors.orange } : {}]}>
            {maxJump.toFixed(1)}m
          </Text>
          <Text style={wuStyles.statLabel}>MAX JUMP</Text>
        </View>
      </View>

      {/* Coaching tip */}
      {quality === 'excellent' && (
        <Text style={wuStyles.tip}>
          Progressive build-up from {warmupDepths[0].toFixed(0)}m to {maxDepth.toFixed(0)}m across {warmupDives.length} dives. Dive reflex had time to activate fully.
        </Text>
      )}
      {quality === 'good' && (
        <Text style={wuStyles.tip}>
          Decent progression. Consider starting shallower — {Math.round(maxDepth * 0.3)}m or less — to give equalization more time to settle.
        </Text>
      )}
      {quality === 'rushed' && (
        <Text style={wuStyles.tip}>
          Started at {Math.round(startPct)}% of max depth. Try starting below 40% and adding 2-3 more progressive dives to reduce blackout risk.
        </Text>
      )}
      {quality === 'insufficient' && (
        <Text style={wuStyles.tip}>
          Not enough warm-up before max attempt. Aim for 3+ progressive dives starting shallow to activate the mammalian dive reflex safely.
        </Text>
      )}
    </View>
  );
}

const wuStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 16, marginBottom: 12,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  micro: {
    fontSize: 9, color: Colors.outline, letterSpacing: 2.5, fontWeight: '700',
  },
  badge: {
    borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3,
  },
  badgeText: {
    fontSize: 9, fontWeight: '700', letterSpacing: 0.5,
  },
  alertRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  alertText: {
    fontSize: 12, color: Colors.orange, flex: 1, lineHeight: 17,
  },
  vizRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    marginBottom: 12, paddingHorizontal: 4,
  },
  vizCol: {
    flex: 1, alignItems: 'center',
  },
  vizBarTrack: {
    height: 48, justifyContent: 'flex-end', width: '100%', alignItems: 'center',
  },
  vizBar: {
    width: '70%', borderRadius: 3, minWidth: 8, maxWidth: 24,
  },
  vizLabel: {
    fontSize: 9, color: Colors.onSurfaceVariant, marginTop: 4, fontWeight: '500',
  },
  vizNum: {
    fontSize: 7, color: Colors.outline, letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30',
    paddingTop: 10, marginBottom: 8,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 13, fontWeight: '700', color: Colors.onSurface },
  statLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1, fontWeight: '600', marginTop: 2 },
  statDiv: { width: 1, height: 18, backgroundColor: Colors.outlineVariant + '30' },
  tip: {
    fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '20',
  },
});

function SISafetyCard({ dives }: { dives: IndividualDive[] }) {
  if (!dives || dives.length < 2) return null;

  const warnings: SIWarning[] = [];
  for (let i = 1; i < dives.length; i++) {
    const si = dives[i].surface_interval_s;
    const prevBT = dives[i - 1].bottom_time_s;
    if (si == null || si <= 0 || prevBT <= 0) continue;
    // Skip very short surface dives (< 5m) — likely duck dives between warmups
    if (dives[i - 1].max_depth_m < 3) continue;

    const ratio = si / prevBT;
    // Safety rules:
    // - SI < 1× bottom time: DANGER (high risk of hypoxic blackout)
    // - SI < 2× bottom time: CAUTION (below recommended minimum)
    // - Also flag if SI < 90 seconds after any dive deeper than 10m
    const isDeep = dives[i - 1].max_depth_m >= 10;
    if (ratio < 1.0 || (isDeep && si < 90)) {
      warnings.push({ diveNum: dives[i].dive_number, siS: si, prevBottomS: prevBT, ratio, severity: 'danger' });
    } else if (ratio < 2.0) {
      warnings.push({ diveNum: dives[i].dive_number, siS: si, prevBottomS: prevBT, ratio, severity: 'caution' });
    }
  }

  if (warnings.length === 0) return null;

  const hasDanger = warnings.some((w) => w.severity === 'danger');
  const borderColor = hasDanger ? Colors.error : Colors.orange;

  return (
    <View style={[siStyles.card, { borderLeftColor: borderColor }]}>
      <View style={siStyles.header}>
        <MaterialIcons name="warning" size={14} color={borderColor} />
        <Text style={[siStyles.title, { color: borderColor }]}>
          {hasDanger ? 'SI SAFETY WARNING' : 'SI ADVISORY'}
        </Text>
        <Text style={siStyles.count}>{warnings.length} flagged</Text>
      </View>

      {warnings.map((w) => (
        <View key={w.diveNum} style={siStyles.row}>
          <View style={[siStyles.severityDot, {
            backgroundColor: w.severity === 'danger' ? Colors.error : Colors.orange,
          }]} />
          <View style={siStyles.rowContent}>
            <Text style={siStyles.rowMain}>
              <Text style={{ fontWeight: '700' }}>Before dive #{w.diveNum}</Text>
              {': '}
              <Text style={{ color: w.severity === 'danger' ? Colors.error : Colors.orange }}>
                {Math.round(w.siS)}s SI
              </Text>
              {' after '}
              <Text style={{ color: Colors.onSurface }}>{Math.round(w.prevBottomS)}s</Text>
              {' bottom time'}
            </Text>
            <Text style={siStyles.rowRatio}>
              {w.ratio.toFixed(1)}× ratio
              {w.ratio < 1.0
                ? ' — SI shorter than dive time'
                : w.ratio < 2.0
                  ? ' — below 2× recommended minimum'
                  : ''}
            </Text>
          </View>
        </View>
      ))}

      <View style={siStyles.ruleBox}>
        <MaterialIcons name="info-outline" size={11} color={Colors.outline} />
        <Text style={siStyles.ruleText}>
          Recommended: SI ≥ 2× previous bottom time, minimum 90s after dives deeper than 10m. Short SIs increase hypoxic blackout risk.
        </Text>
      </View>
    </View>
  );
}

// ── Session performance insights ──────────────────────────────────────────────
function SessionInsightsCard({ dives }: { dives: IndividualDive[] }) {
  if (!dives || dives.length < 3) return null;

  // Filter to real dives (skip warmups — first 3 with hangs)
  const realDives = dives.filter((d) => {
    const cls = classifyDiscipline(d);
    return !(cls.isWarmup && d.dive_number <= 3);
  });
  if (realDives.length < 3) return null;

  // ── Descent speed trend ──
  const descentSpeeds = realDives
    .filter((d) => d.descent_time_s != null && d.descent_time_s > 0)
    .map((d) => d.max_depth_m / d.descent_time_s!);

  let descentTrend: 'stable' | 'slowing' | 'improving' | null = null;
  let descentDelta = 0;
  if (descentSpeeds.length >= 3) {
    const firstHalf = descentSpeeds.slice(0, Math.ceil(descentSpeeds.length / 2));
    const secondHalf = descentSpeeds.slice(Math.floor(descentSpeeds.length / 2));
    const avg1 = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
    descentDelta = ((avg2 - avg1) / avg1) * 100;
    descentTrend = Math.abs(descentDelta) < 5 ? 'stable' : descentDelta < 0 ? 'slowing' : 'improving';
  }

  // ── Surface interval trend ──
  const siValues = realDives
    .map((d) => d.surface_interval_s)
    .filter((v): v is number => v != null && v > 0 && v < 3600);

  let siTrend: 'stable' | 'increasing' | 'decreasing' | null = null;
  let siDelta = 0;
  if (siValues.length >= 3) {
    const firstHalf = siValues.slice(0, Math.ceil(siValues.length / 2));
    const secondHalf = siValues.slice(Math.floor(siValues.length / 2));
    const avg1 = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
    siDelta = ((avg2 - avg1) / avg1) * 100;
    siTrend = Math.abs(siDelta) < 10 ? 'stable' : siDelta > 0 ? 'increasing' : 'decreasing';
  }

  // ── Depth progression ──
  const depths = realDives.map((d) => d.max_depth_m);
  const peakIdx = depths.indexOf(Math.max(...depths));
  const peakPct = peakIdx / (depths.length - 1); // 0 = peaked early, 1 = peaked late

  // ── Overall fatigue score (0 = fresh, 100 = fatigued) ──
  let fatigueScore = 50; // neutral baseline
  if (descentTrend === 'slowing') fatigueScore += Math.min(25, Math.abs(descentDelta) * 1.5);
  if (descentTrend === 'improving') fatigueScore -= Math.min(15, descentDelta * 0.8);
  if (siTrend === 'increasing') fatigueScore += Math.min(20, siDelta * 0.5);
  if (siTrend === 'decreasing') fatigueScore -= Math.min(10, Math.abs(siDelta) * 0.3);
  if (peakPct < 0.3) fatigueScore += 10; // peaked early, tapered off
  if (peakPct > 0.6) fatigueScore -= 5; // peaked late, still fresh
  fatigueScore = Math.max(0, Math.min(100, Math.round(fatigueScore)));

  const fatigueLabel =
    fatigueScore < 30 ? 'Fresh' :
    fatigueScore < 50 ? 'Steady' :
    fatigueScore < 70 ? 'Mild Fatigue' : 'Fatigued';
  const fatigueColor =
    fatigueScore < 30 ? '#4ade80' :
    fatigueScore < 50 ? Colors.cyan :
    fatigueScore < 70 ? Colors.orange : Colors.error;

  // Build insight lines
  const insights: { icon: string; text: string; color: string }[] = [];
  if (descentTrend === 'slowing') {
    insights.push({
      icon: 'trending-down',
      text: `Descent speed dropped ${Math.abs(descentDelta).toFixed(0)}% in later dives`,
      color: Colors.orange,
    });
  } else if (descentTrend === 'improving') {
    insights.push({
      icon: 'trending-up',
      text: `Descent speed improved ${descentDelta.toFixed(0)}% across session`,
      color: '#4ade80',
    });
  } else if (descentTrend === 'stable') {
    insights.push({
      icon: 'trending-flat',
      text: 'Descent speed consistent throughout',
      color: Colors.cyan,
    });
  }

  if (siTrend === 'increasing') {
    insights.push({
      icon: 'schedule',
      text: `Rest periods grew ${siDelta.toFixed(0)}% longer — body needed more recovery`,
      color: Colors.orange,
    });
  } else if (siTrend === 'stable') {
    insights.push({
      icon: 'schedule',
      text: 'Surface intervals stayed consistent',
      color: Colors.cyan,
    });
  }

  if (peakPct < 0.25 && depths.length >= 4) {
    insights.push({
      icon: 'arrow-downward',
      text: `Deepest dive was #${peakIdx + 1} of ${depths.length} — early peak then taper`,
      color: Colors.orange,
    });
  } else if (peakPct > 0.7 && depths.length >= 4) {
    insights.push({
      icon: 'arrow-upward',
      text: `Deepest dive was #${peakIdx + 1} of ${depths.length} — strong build-up`,
      color: '#4ade80',
    });
  }

  return (
    <View style={insightStyles.card}>
      <View style={insightStyles.header}>
        <Text style={insightStyles.micro}>SESSION INSIGHTS</Text>
        <View style={[insightStyles.scoreBadge, { backgroundColor: fatigueColor + '18' }]}>
          <View style={[insightStyles.scoreDot, { backgroundColor: fatigueColor }]} />
          <Text style={[insightStyles.scoreText, { color: fatigueColor }]}>{fatigueLabel}</Text>
        </View>
      </View>

      {/* Fatigue meter */}
      <View style={insightStyles.meterWrap}>
        <View style={insightStyles.meterTrack}>
          <View style={[insightStyles.meterFill, {
            width: `${fatigueScore}%` as any,
            backgroundColor: fatigueColor,
          }]} />
        </View>
        <View style={insightStyles.meterLabels}>
          <Text style={insightStyles.meterLabel}>Fresh</Text>
          <Text style={insightStyles.meterLabel}>Fatigued</Text>
        </View>
      </View>

      {/* Insight bullets */}
      {insights.map((ins, i) => (
        <View key={i} style={insightStyles.insightRow}>
          <MaterialIcons name={ins.icon as any} size={13} color={ins.color} />
          <Text style={insightStyles.insightText}>{ins.text}</Text>
        </View>
      ))}
    </View>
  );
}

function StatRow({ label, value, noBorder }: { label: string; value: string; noBorder?: boolean }) {
  return (
    <View style={[styles.statRow, !noBorder && styles.statRowBorder]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  notFound: { color: Colors.outline },

  appBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)',
    backgroundColor: Colors.bg,
  },
  backBtn: { width: 36 },
  appBarTitle: { fontSize: 12, fontWeight: '700', color: Colors.cyan, letterSpacing: 3 },
  appBarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  scroll: { padding: 16, paddingBottom: 80 },
  sectionLabel: { fontSize: 9, color: Colors.outline, letterSpacing: 2.5, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },

  // Depth context bar
  ctxCard: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14, marginBottom: 16,
  },
  ctxHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  ctxMicro: { fontSize: 9, color: Colors.primaryDim, letterSpacing: 2.5, fontWeight: '700', textTransform: 'uppercase' },
  ctxPct: { fontSize: 12, color: Colors.outline },
  ctxTrack: {
    height: 6, backgroundColor: Colors.surfaceHighest,
    borderRadius: 3, overflow: 'visible', marginBottom: 4, position: 'relative',
  },
  ctxFill: { height: '100%', borderRadius: 3 },
  ctxMarker: {
    position: 'absolute', top: -3, width: 2, height: 12,
    backgroundColor: Colors.orange, borderRadius: 1,
  },
  ctxLabels: { flexDirection: 'row', justifyContent: 'space-between', position: 'relative', marginBottom: 10 },
  ctxLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 1 },
  ctxLabelWorking: { position: 'absolute', color: Colors.orange, transform: [{ translateX: -12 }] },
  ctxSessionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30', paddingTop: 10 },
  ctxSessionDot: { width: 8, height: 8, borderRadius: 4 },
  ctxSessionLabel: { fontSize: 12, color: Colors.onSurfaceVariant, flex: 1 },

  // Session header
  sessionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 12,
  },
  sessionTitle: { fontSize: 16, fontWeight: '700', color: Colors.onSurface, letterSpacing: -0.3, lineHeight: 22, flexShrink: 1 },
  pbBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.cyan, borderRadius: 4,
    paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 6,
  },
  pbText: { fontSize: 9, fontWeight: '700', color: Colors.bg, letterSpacing: 1 },

  // Depth summary
  depthRow: { flexDirection: 'row', marginTop: 12 },
  depthCell: { flex: 1, alignItems: 'center' },
  depthCellBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.outlineVariant + '40' },
  depthLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 },
  depthValue: { fontSize: 28, fontWeight: '700', color: Colors.onSurface },
  depthUnit: { fontSize: 14, fontWeight: '400', color: Colors.onSurfaceVariant },

  // Glass card
  glassCard: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 16, marginBottom: 16,
  },
  bentoMicro: { fontSize: 9, color: Colors.primary, letterSpacing: 2.5, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },

  // Stats table
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  statRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant + '30' },
  statLabel: { fontSize: 13, color: Colors.onSurfaceVariant },
  statValue: { fontSize: 14, color: Colors.onSurface, fontWeight: '500' },

  // Notes
  noteSection: { marginTop: 4, marginBottom: 20 },
  noteLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  noteCard: {
    backgroundColor: Colors.glass, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14,
  },
  noteText: { fontSize: 14, color: Colors.onSurface, lineHeight: 21 },
  noteEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.glass, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.glassBorder,
    borderStyle: 'dashed', padding: 14,
  },
  noteEmptyText: { fontSize: 13, color: Colors.outline },
  noteEditCard: {
    backgroundColor: Colors.glass, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.primaryDim + '50',
    padding: 14,
  },
  noteInput: {
    fontSize: 14, color: Colors.onSurface, lineHeight: 21,
    minHeight: 80, textAlignVertical: 'top',
  },
  noteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30' },
  noteCancelBtn: { paddingHorizontal: 14, paddingVertical: 8 },
  noteCancelText: { fontSize: 11, color: Colors.outline, letterSpacing: 1, fontWeight: '600' },
  noteSaveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.cyan, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  noteSaveText: { fontSize: 11, color: Colors.bg, fontWeight: '700', letterSpacing: 1 },

  // Unused legacy styles kept for safety
  siWarning: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: Colors.errorContainerBg, borderLeftWidth: 4, borderLeftColor: Colors.error, borderRadius: 8, padding: 14, marginBottom: 14 },
  siTitle: { fontSize: 10, color: Colors.error, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  siText: { fontSize: 12, color: Colors.onSurface, lineHeight: 18 },

  // Individual dives empty state
  divesEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, opacity: 0.5 },
  divesEmptyText: { fontSize: 12, color: Colors.outline },
});

const navStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: Colors.surfaceLow,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.06)',
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 6, backgroundColor: Colors.glass,
    borderWidth: 1, borderColor: Colors.glassBorder,
  },
  btnDisabled: { opacity: 0.3 },
  btnText: { fontSize: 11, color: Colors.cyan, fontWeight: '600' },
  btnTextDisabled: { color: Colors.outline },
  counter: { fontSize: 10, color: Colors.outline, letterSpacing: 1 },
});

// ── DiveRow styles ────────────────────────────────────────────────────────────
const dvStyles = StyleSheet.create({
  diveRow: {
    backgroundColor: Colors.glass,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    marginBottom: 8,
    overflow: 'hidden',
  },
  diveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
  },
  diveNumBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diveNum: { fontSize: 13, fontWeight: '700' },

  diveInfo: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  diveDepth: { fontSize: 17, fontWeight: '700', color: Colors.onSurface },
  diveBt: { fontSize: 12, color: Colors.onSurfaceVariant },
  diveSI: { fontSize: 10, color: Colors.outline },
  warmupBadge: {
    backgroundColor: Colors.orange + '20', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  warmupText: { fontSize: 8, fontWeight: '700', color: Colors.orange, letterSpacing: 0.8 },

  discBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  discText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  discConf: { fontSize: 10, color: Colors.outline },

  diveDetail: {
    paddingHorizontal: 12,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant + '25',
    paddingTop: 10,
  },

  timingRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  timingCell: {
    flex: 1,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 8,
    padding: 9,
    alignItems: 'center',
  },
  timingLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginBottom: 4 },
  timingValue: { fontSize: 15, fontWeight: '700', color: Colors.onSurface },
  timingVelocity: { fontSize: 9, color: Colors.outline, marginTop: 2 },

  clsRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 12 },
  clsReason: { fontSize: 11, color: Colors.outline, flex: 1 },

  detailLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '20',
    paddingTop: 10, marginTop: 4,
  },
  detailLinkText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },

  chartLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginBottom: 4 },
  chartTrack: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 6,
    overflow: 'hidden',
    gap: 1,
  },
  chartBar: { flex: 1, borderRadius: 1 },
  chartAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  chartAxisLabel: { fontSize: 8, color: Colors.outline },
});

// ── Session shape card styles ─────────────────────────────────────────────────
const discSumStyles = StyleSheet.create({
  wrap: { marginBottom: 10 },
  propBar: {
    flexDirection: 'row', height: 4, borderRadius: 2,
    overflow: 'hidden', marginBottom: 8, gap: 2,
  },
  propSegment: { borderRadius: 2 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: Colors.surfaceLow,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillDisc: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  pillCount: { fontSize: 10, color: Colors.outline },
  bottomLine: { fontSize: 10, color: Colors.outline, lineHeight: 16 },
});

const shapeStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14, marginBottom: 10,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  micro: { fontSize: 9, color: Colors.primaryDim, letterSpacing: 2.5, fontWeight: '700', textTransform: 'uppercase' },
  warmupBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#4ade8018', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  warmupText: { fontSize: 8, color: '#4ade80', fontWeight: '700', letterSpacing: 1 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 68, gap: 2, marginBottom: 12 },
  barWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', position: 'relative' },
  bar: { width: '100%', borderRadius: 2 },
  bestDot: { position: 'absolute', top: -5, width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.cyan },
  statsRow: {
    flexDirection: 'row', borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant + '30', paddingTop: 10,
  },
  stat: { flex: 1, alignItems: 'center' },
  statLbl: { fontSize: 8, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginBottom: 3, textTransform: 'uppercase' },
  statVal: { fontSize: 13, fontWeight: '600', color: Colors.onSurface },
});

const insightStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14, marginBottom: 10,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  micro: {
    fontSize: 9, color: Colors.primaryDim, letterSpacing: 2.5,
    fontWeight: '700', textTransform: 'uppercase',
  },
  scoreBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3,
  },
  scoreDot: { width: 6, height: 6, borderRadius: 3 },
  scoreText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  meterWrap: { marginBottom: 12 },
  meterTrack: {
    height: 4, backgroundColor: Colors.surfaceHighest,
    borderRadius: 2, overflow: 'hidden',
  },
  meterFill: { height: '100%', borderRadius: 2 },
  meterLabels: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 3,
  },
  meterLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 0.5 },
  insightRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingVertical: 5,
  },
  insightText: { fontSize: 12, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 17 },
});

const dzStyles = StyleSheet.create({
  wrap: { marginBottom: 10 },
  label: {
    fontSize: 8, color: Colors.outline, letterSpacing: 1.5,
    fontWeight: '700', marginBottom: 6,
  },
  propBar: {
    flexDirection: 'row', height: 6, borderRadius: 3,
    overflow: 'hidden', gap: 2, marginBottom: 8,
  },
  propSegment: { borderRadius: 3 },
  zoneRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 3,
  },
  zoneDot: { width: 6, height: 6, borderRadius: 3 },
  zoneName: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, width: 72 },
  zoneNote: { fontSize: 9, color: Colors.outline, flex: 1 },
  zoneTime: { fontSize: 11, fontWeight: '600', color: Colors.onSurfaceVariant, width: 32, textAlign: 'right' },
  zonePct: { fontSize: 10, color: Colors.outline, width: 28, textAlign: 'right' },
});

const siStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    borderLeftWidth: 3, padding: 14, marginBottom: 10,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10,
  },
  title: { fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  count: { fontSize: 10, color: Colors.outline, marginLeft: 'auto' },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '20',
  },
  severityDot: { width: 7, height: 7, borderRadius: 4, marginTop: 4 },
  rowContent: { flex: 1 },
  rowMain: { fontSize: 12, color: Colors.onSurfaceVariant, lineHeight: 17 },
  rowRatio: { fontSize: 10, color: Colors.outline, marginTop: 2 },
  ruleBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.surfaceLow, borderRadius: 8,
    padding: 10, marginTop: 10,
  },
  ruleText: { fontSize: 10, color: Colors.outline, flex: 1, lineHeight: 15 },
});

const ovStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14, marginBottom: 10,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8,
  },
  micro: {
    fontSize: 9, color: Colors.primaryDim, letterSpacing: 2.5,
    fontWeight: '700', textTransform: 'uppercase',
  },
  sub: { fontSize: 10, color: Colors.outline },
  yLabel: {
    position: 'absolute', left: 0, fontSize: 8,
    color: Colors.outline, width: 26, textAlign: 'right',
  },
  timeAxis: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingLeft: 30, paddingRight: 8, marginTop: 2,
  },
  timeLabel: { fontSize: 8, color: Colors.outline },
  legend: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginTop: 10, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '20',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 10, fontWeight: '600', color: Colors.onSurfaceVariant },
  legendDepth: { fontSize: 9, color: Colors.outline },
});

const cmpStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14, marginBottom: 10,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10,
  },
  title: {
    fontSize: 9, color: Colors.primaryDim, letterSpacing: 2.5,
    fontWeight: '700', flex: 1,
  },
  prevDate: { fontSize: 10, color: Colors.outline },
  row: {
    flexDirection: 'row', alignItems: 'center',
  },
  metric: { flex: 1, alignItems: 'center' },
  metricLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1, fontWeight: '700', marginBottom: 3 },
  metricDelta: { fontSize: 16, fontWeight: '700' },
  divider: { width: 1, height: 28, backgroundColor: Colors.outlineVariant + '25' },
});

const cdColors = {
  visibility: '#60a5fa',
  current: Colors.orange,
  surface: '#a78bfa',
  comfort: '#facc15',
  equalization: '#34d399',
};

const cdStyles = StyleSheet.create({
  headerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, marginBottom: 4, paddingVertical: 4,
  },
  inlineTags: { flexDirection: 'row', gap: 4, flex: 1, marginLeft: 8, flexWrap: 'wrap' },
  miniTag: {
    borderWidth: 1, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  miniTagText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14, marginBottom: 4,
  },
  tempRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingBottom: 10, marginBottom: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant + '20',
  },
  tempLabel: { fontSize: 9, color: Colors.outline, letterSpacing: 1.5, fontWeight: '600', flex: 1 },
  tempValue: { fontSize: 16, fontWeight: '600', color: Colors.cyan },
  tagSection: { marginBottom: 10 },
  tagLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 2, fontWeight: '700', marginBottom: 6 },
  tagRow: { flexDirection: 'row', gap: 6 },
  tag: {
    borderWidth: 1, borderColor: Colors.outlineVariant + '40', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  tagText: { fontSize: 10, fontWeight: '600', color: Colors.outline, letterSpacing: 0.5 },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  starBtn: { padding: 2 },
  comfortLabel: { fontSize: 11, color: Colors.onSurfaceVariant, marginLeft: 8 },
  eqTip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: 8, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '20',
  },
  eqTipText: { fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16, flex: 1 },
});

// ── Descent & Ascent Speed Profile ──────────────────────────────────────────
function DescentAscentCard({ dives }: { dives: IndividualDive[] }) {
  // Need at least 2 dives with timing data
  const rated = dives.filter(
    (d) => d.descent_time_s != null && d.descent_time_s > 0
        && d.ascent_time_s != null && d.ascent_time_s > 0
        && d.max_depth_m >= 3,
  );
  if (rated.length < 2) return null;

  const descentRates = rated.map((d) => d.max_depth_m / d.descent_time_s!);
  const ascentRates = rated.map((d) => d.max_depth_m / d.ascent_time_s!);
  const maxRate = Math.max(...descentRates, ...ascentRates, 0.5);

  const avgDescent = descentRates.reduce((s, v) => s + v, 0) / descentRates.length;
  const avgAscent = ascentRates.reduce((s, v) => s + v, 0) / ascentRates.length;

  // Ascent safety zones
  const ascentColor = (rate: number) =>
    rate > 1.2 ? Colors.error : rate > 0.9 ? Colors.orange : '#4ade80';

  // Consistency: coefficient of variation
  const descentMean = avgDescent;
  const descentStd = Math.sqrt(descentRates.reduce((s, v) => s + (v - descentMean) ** 2, 0) / descentRates.length);
  const descentCV = descentMean > 0 ? (descentStd / descentMean) * 100 : 0;
  const consistencyLabel = descentCV < 10 ? 'Very consistent' : descentCV < 20 ? 'Consistent' : descentCV < 35 ? 'Variable' : 'Inconsistent';
  const consistencyColor = descentCV < 10 ? '#4ade80' : descentCV < 20 ? Colors.cyan : descentCV < 35 ? Colors.orange : Colors.error;

  const BAR_H = 48;

  // Coaching note
  const ascentWarning = ascentRates.some((r) => r > 1.2);
  const ascentCaution = ascentRates.some((r) => r > 0.9);

  return (
    <View style={daStyles.card}>
      <View style={daStyles.header}>
        <MaterialIcons name="speed" size={13} color={Colors.cyan} />
        <Text style={daStyles.title}>SPEED PROFILE</Text>
        <View style={[daStyles.badge, { backgroundColor: consistencyColor + '18', borderColor: consistencyColor + '40' }]}>
          <Text style={[daStyles.badgeText, { color: consistencyColor }]}>{consistencyLabel.toUpperCase()}</Text>
        </View>
      </View>

      {/* Stats row */}
      <View style={daStyles.statsRow}>
        <View style={daStyles.stat}>
          <Text style={[daStyles.statValue, { color: Colors.cyan }]}>{avgDescent.toFixed(1)}</Text>
          <Text style={daStyles.statUnit}>m/s</Text>
          <Text style={daStyles.statLabel}>AVG DESCENT</Text>
        </View>
        <View style={[daStyles.stat, { borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.outlineVariant + '30' }]}>
          <Text style={[daStyles.statValue, { color: ascentColor(avgAscent) }]}>{avgAscent.toFixed(1)}</Text>
          <Text style={daStyles.statUnit}>m/s</Text>
          <Text style={daStyles.statLabel}>AVG ASCENT</Text>
        </View>
        <View style={daStyles.stat}>
          <Text style={[daStyles.statValue, { color: consistencyColor }]}>{descentCV.toFixed(0)}%</Text>
          <Text style={daStyles.statUnit}>CV</Text>
          <Text style={daStyles.statLabel}>VARIATION</Text>
        </View>
      </View>

      {/* Per-dive speed bars */}
      <View style={daStyles.chartWrap}>
        <View style={daStyles.chartLegend}>
          <View style={daStyles.legendItem}>
            <View style={[daStyles.legendDot, { backgroundColor: Colors.cyan }]} />
            <Text style={daStyles.legendText}>Descent</Text>
          </View>
          <View style={daStyles.legendItem}>
            <View style={[daStyles.legendDot, { backgroundColor: '#4ade80' }]} />
            <Text style={daStyles.legendText}>Ascent</Text>
          </View>
        </View>
        <View style={[daStyles.chart, { height: BAR_H * 2 + 20 }]}>
          {/* Center line */}
          <View style={[daStyles.centerLine, { top: BAR_H + 10 }]} />
          {/* Bars */}
          <View style={daStyles.barRow}>
            {rated.map((d, i) => {
              const dRate = descentRates[i];
              const aRate = ascentRates[i];
              const dH = (dRate / maxRate) * BAR_H;
              const aH = (aRate / maxRate) * BAR_H;
              return (
                <View key={d.dive_number} style={daStyles.barCol}>
                  {/* Descent bar (above center) */}
                  <View style={daStyles.barAbove}>
                    <View style={[daStyles.bar, {
                      height: dH,
                      backgroundColor: Colors.cyan,
                      borderTopLeftRadius: 2,
                      borderTopRightRadius: 2,
                    }]} />
                  </View>
                  {/* Dive number */}
                  <Text style={daStyles.barLabel}>{d.dive_number}</Text>
                  {/* Ascent bar (below center) */}
                  <View style={daStyles.barBelow}>
                    <View style={[daStyles.bar, {
                      height: aH,
                      backgroundColor: ascentColor(aRate),
                      borderBottomLeftRadius: 2,
                      borderBottomRightRadius: 2,
                    }]} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {/* Ascent safety zone legend */}
      <View style={daStyles.zoneRow}>
        <View style={daStyles.zone}>
          <View style={[daStyles.zoneDot, { backgroundColor: '#4ade80' }]} />
          <Text style={daStyles.zoneText}>{'<0.9 safe'}</Text>
        </View>
        <View style={daStyles.zone}>
          <View style={[daStyles.zoneDot, { backgroundColor: Colors.orange }]} />
          <Text style={daStyles.zoneText}>0.9–1.2 caution</Text>
        </View>
        <View style={daStyles.zone}>
          <View style={[daStyles.zoneDot, { backgroundColor: Colors.error }]} />
          <Text style={daStyles.zoneText}>{'>1.2 fast'}</Text>
        </View>
      </View>

      {/* Coaching note */}
      {(ascentWarning || ascentCaution) && (
        <View style={[daStyles.tip, { borderLeftColor: ascentWarning ? Colors.error : Colors.orange }]}>
          <Text style={daStyles.tipText}>
            {ascentWarning
              ? 'Some ascents exceeded 1.2 m/s. Fast ascents increase blackout risk near the surface. Slow your last 10m.'
              : 'Ascent speeds approaching caution zone. Maintain awareness of speed in the last 10m where shallow water blackout risk peaks.'}
          </Text>
        </View>
      )}
    </View>
  );
}

const daStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14, marginBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  title: { fontSize: 10, fontWeight: '800', letterSpacing: 2, color: Colors.cyan, flex: 1 },
  badge: {
    borderWidth: 1, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeText: { fontSize: 7, fontWeight: '700', letterSpacing: 1 },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceLow, borderRadius: 8,
    marginBottom: 14,
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  statValue: { fontSize: 20, fontWeight: '700' },
  statUnit: { fontSize: 9, color: Colors.outline, marginTop: -2 },
  statLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginTop: 4 },
  chartWrap: { marginBottom: 10 },
  chartLegend: { flexDirection: 'row', gap: 14, marginBottom: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 9, color: Colors.outline },
  chart: { position: 'relative' },
  centerLine: {
    position: 'absolute', left: 0, right: 0,
    height: 1, backgroundColor: Colors.outlineVariant + '40',
  },
  barRow: {
    flexDirection: 'row', flex: 1,
    justifyContent: 'space-evenly', alignItems: 'center',
  },
  barCol: { alignItems: 'center', flex: 1, maxWidth: 28 },
  barAbove: { height: 48, justifyContent: 'flex-end', alignItems: 'center' },
  barBelow: { height: 48, justifyContent: 'flex-start', alignItems: 'center' },
  bar: { width: 8, minHeight: 2 },
  barLabel: { fontSize: 7, color: Colors.outline, marginVertical: 2, letterSpacing: 0.5 },
  zoneRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 8 },
  zone: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  zoneDot: { width: 5, height: 5, borderRadius: 2.5 },
  zoneText: { fontSize: 8, color: Colors.outline },
  tip: {
    borderLeftWidth: 2, paddingLeft: 10, paddingVertical: 4,
  },
  tipText: { fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16 },
});

const fitStyles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.primaryDim + '30', borderRadius: 8,
    borderStyle: 'dashed',
    paddingVertical: 10, marginTop: 20,
  },
  btnText: { fontSize: 10, color: Colors.primaryDim, fontWeight: '600', letterSpacing: 1.5 },
  result: { fontSize: 11, textAlign: 'center', marginTop: 8 },
  hint: { fontSize: 10, color: Colors.outline, textAlign: 'center', marginTop: 4, marginBottom: 20 },
});
