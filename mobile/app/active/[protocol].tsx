import { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Vibration, ScrollView, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withTiming, withRepeat, withSequence, Easing,
} from 'react-native-reanimated';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Canvas, Path as SkPath, Skia } from '@shopify/react-native-skia';
import { Colors } from '../../src/constants/colors';
import { useAppStore } from '../../src/store/appStore';
import { fmtTimer } from '../../src/utils/formatters';
import { saveTableSession, loadTableHistory, type TableSessionRecord, type ContractionData } from '../../src/utils/tableHistory';

// ── Guided breathing animation ───────────────────────────────────────────────
// 4s inhale + 6s exhale = 10s cycle (freediving recovery breathing pattern)
const INHALE_MS = 4000;
const EXHALE_MS = 6000;
const CYCLE_MS = INHALE_MS + EXHALE_MS;

function BreathGuide({ active, color }: { active: boolean; color: string }) {
  const scale = useSharedValue(0.6);
  const opacity = useSharedValue(0);
  const [breathLabel, setBreathLabel] = useState<'INHALE' | 'EXHALE'>('INHALE');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (active) {
      opacity.value = withTiming(1, { duration: 400 });
      startRef.current = Date.now();

      // Start animation loop
      const runCycle = () => {
        // Inhale: expand
        scale.value = withTiming(1, { duration: INHALE_MS, easing: Easing.inOut(Easing.sin) });
        setBreathLabel('INHALE');

        // Exhale: contract (after inhale completes)
        setTimeout(() => {
          scale.value = withTiming(0.6, { duration: EXHALE_MS, easing: Easing.inOut(Easing.sin) });
          setBreathLabel('EXHALE');
        }, INHALE_MS);
      };

      runCycle();
      intervalRef.current = setInterval(runCycle, CYCLE_MS);

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    } else {
      opacity.value = withTiming(0, { duration: 300 });
      scale.value = withTiming(0.6, { duration: 300 });
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [active]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!active) return null;

  return (
    <Animated.View style={[bgStyles.wrap, labelStyle]}>
      <Animated.View style={[bgStyles.circle, { borderColor: color + '40' }, circleStyle]}>
        <View style={[bgStyles.innerCircle, { backgroundColor: color + '08', borderColor: color + '20' }]} />
      </Animated.View>
      <Text style={[bgStyles.label, { color }]}>{breathLabel}</Text>
      <Text style={bgStyles.pattern}>4s in · 6s out · belly breathing</Text>
    </Animated.View>
  );
}

// ── Circular progress ring ───────────────────────────────────────────────────
// Replaces the linear progress bar with a circular arc around the timer.
// Rendered with Skia for smooth GPU-accelerated drawing.

const RING_SIZE = 200;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CENTER = RING_SIZE / 2;

function CircularProgress({ progress, color, isCountdown }: {
  progress: number; // 0-1
  color: string;
  isCountdown: boolean;
}) {
  const trackPath = useMemo(() => {
    const p = Skia.Path.Make();
    p.addCircle(RING_CENTER, RING_CENTER, RING_RADIUS);
    return p;
  }, []);

  const arcPath = useMemo(() => {
    if (progress <= 0) return null;
    const p = Skia.Path.Make();
    const sweep = Math.min(progress, 0.999) * 360;
    // Start from top (-90 degrees)
    p.addArc(
      { x: RING_STROKE / 2, y: RING_STROKE / 2, width: RING_SIZE - RING_STROKE, height: RING_SIZE - RING_STROKE },
      -90,
      sweep,
    );
    return p;
  }, [progress]);

  return (
    <Canvas style={{ width: RING_SIZE, height: RING_SIZE, position: 'absolute' }}>
      {/* Background track */}
      <SkPath
        path={trackPath}
        color={Skia.Color(Colors.outlineVariant + '20')}
        style="stroke"
        strokeWidth={RING_STROKE}
        strokeCap="round"
      />
      {/* Progress arc */}
      {arcPath && (
        <SkPath
          path={arcPath}
          color={Skia.Color(isCountdown ? Colors.error : color)}
          style="stroke"
          strokeWidth={RING_STROKE}
          strokeCap="round"
        />
      )}
    </Canvas>
  );
}

const bgStyles = StyleSheet.create({
  wrap: { alignItems: 'center', marginTop: 4, marginBottom: 8 },
  circle: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  innerCircle: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1,
  },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 3, marginTop: 8 },
  pattern: { fontSize: 9, color: Colors.outline, letterSpacing: 1, marginTop: 3 },
});

// Phase order: breathup → hold → rest → breathup → hold → rest → ...
// Last set has no rest after it.
type Phase = 'breathup' | 'hold' | 'rest' | 'done';

function getCoachNote(
  holdsCompleted: number,
  totalSets: number,
  protocolType?: string,
): { headline: string; body: string; color: string } {
  const pct = totalSets > 0 ? holdsCompleted / totalSets : 0;
  const isO2 = protocolType === 'o2';

  if (pct === 1) {
    return {
      headline: 'Perfect Session',
      body: isO2
        ? 'Full O₂ table completed. Oxygen efficiency building. Light session or rest tomorrow.'
        : 'All holds completed. CO₂ tolerance is building — rest 24-48h before the next table to let adaptation set in.',
      color: '#4ade80',
    };
  }
  if (pct >= 0.75) {
    return {
      headline: 'Strong Session',
      body: isO2
        ? `${holdsCompleted}/${totalSets} holds. Nearly clean. Push for the full table next time.`
        : `${holdsCompleted}/${totalSets} holds. The incomplete sets still trigger CO₂ adaptation. Aim for the full table next session.`,
      color: Colors.cyan,
    };
  }
  if (pct >= 0.5) {
    return {
      headline: 'Good Stimulus',
      body: `${holdsCompleted}/${totalSets} holds. Even partial tables build tolerance. Full rest before next session — don't rush the recovery.`,
      color: Colors.orange,
    };
  }
  return {
    headline: 'Hard Day',
    body: 'Tough session — that happens. Rest fully, stay hydrated, and return fresher. Consistent training beats heroic sessions.',
    color: Colors.error,
  };
}

const BREATHUP_S = 10; // 10s breathup before each hold

export default function ActiveSessionScreen() {
  const router = useRouter();
  const protocol = useAppStore((s) => s.activeProtocol);

  const sets: { hold_s: number; rest_s: number }[] = protocol?.sets ?? [];
  const totalSets = sets.length || protocol?.cycles || 8;

  const [setIdx, setSetIdx] = useState(0);       // 0-based current set index
  const [phase, setPhase] = useState<Phase>('breathup');
  const [running, setRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(BREATHUP_S);
  // Safety gate — disabled for dry sessions; re-enable when pool mode is added
  const [buddyConfirmed, setBuddyConfirmed] = useState(true);

  // Protocol history — loaded on mount (before this session is saved) for comparison
  const [priorHistory, setPriorHistory] = useState<TableSessionRecord[]>([]);
  useEffect(() => {
    if (protocol) {
      loadTableHistory().then((all) => {
        setPriorHistory(all.filter((r) => r.protocolKey === protocol.key));
      });
    }
  }, []);

  // Session stat tracking
  type HoldResult = { hold_s: number; completed: boolean };
  const [holdResults, setHoldResults] = useState<HoldResult[]>([]);
  const [sessionTime, setSessionTime] = useState(0);
  const holdResultsRef = useRef<HoldResult[]>([]);
  const sessionStartRef = useRef<number | null>(null);
  const skipNextHoldRef = useRef(false);

  // Contraction tracking — tap during hold to mark diaphragm contractions
  const [contractions, setContractions] = useState<ContractionData[]>([]);
  const contractionsRef = useRef<ContractionData[]>([]);
  const currentContractionRef = useRef<ContractionData>({ firstAtS: null, count: 0 });
  const [currentCxCount, setCurrentCxCount] = useState(0); // UI counter for re-render
  const holdStartRef = useRef<number | null>(null);

  const startRef = useRef<number | null>(null);
  const durationRef = useRef(BREATHUP_S);
  const phaseRef = useRef<Phase>('breathup');
  const setIdxRef = useRef(0);
  const lastCountdownBuzz = useRef(-1);

  // Haptic countdown: short buzz at 5-4-3-2-1 during hold so diver knows time is almost up
  useEffect(() => {
    if (phase === 'hold' && running && secondsLeft <= 5 && secondsLeft > 0) {
      if (secondsLeft !== lastCountdownBuzz.current) {
        lastCountdownBuzz.current = secondsLeft;
        Vibration.vibrate(secondsLeft === 1 ? [0, 80, 40, 80] : 35);
      }
    } else if (secondsLeft > 5) {
      lastCountdownBuzz.current = -1;
    }
  }, [secondsLeft, phase, running]);

  // Keep screen awake while timer is running — critical for breath hold glanceability
  useEffect(() => {
    if (running) {
      activateKeepAwakeAsync();
    } else {
      deactivateKeepAwake();
    }
    return () => { deactivateKeepAwake(); };
  }, [running]);

  const pulseFill = useSharedValue(0.6);
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseFill.value,
    transform: [{ scale: 0.94 + pulseFill.value * 0.08 }],
  } as any));

  useEffect(() => {
    if (running && phase === 'hold') {
      pulseFill.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.5, { duration: 4000, easing: Easing.inOut(Easing.sin) }),
        ), -1, false,
      );
    } else {
      pulseFill.value = withTiming(0.6, { duration: 600 });
    }
  }, [running, phase]);

  // Main timer loop
  useEffect(() => {
    if (!running) return;
    let animId: number;
    startRef.current = Date.now();

    function tick() {
      const elapsed = (Date.now() - (startRef.current ?? Date.now())) / 1000;
      const remaining = Math.max(0, durationRef.current - elapsed);
      setSecondsLeft(Math.ceil(remaining));

      if (remaining <= 0) {
        advancePhase();
        return;
      }
      animId = requestAnimationFrame(tick);
    }

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [running, phase, setIdx]);

  function currentSet() { return sets[setIdxRef.current]; }

  function advancePhase() {
    const cur = phaseRef.current;
    const idx = setIdxRef.current;

    if (cur === 'breathup') {
      // Start hold
      const holdDur = currentSet()?.hold_s ?? (protocol?.hold_s ?? 60);
      Vibration.vibrate([0, 200, 100, 200]);
      phaseRef.current = 'hold';
      durationRef.current = holdDur;
      startRef.current = Date.now();
      holdStartRef.current = Date.now();
      currentContractionRef.current = { firstAtS: null, count: 0 };
      setCurrentCxCount(0);
      setPhase('hold');
      setSecondsLeft(holdDur);

    } else if (cur === 'hold') {
      // Hold finished — record result + contractions
      const holdDur = currentSet()?.hold_s ?? (protocol?.hold_s ?? 60);
      const result: HoldResult = { hold_s: holdDur, completed: !skipNextHoldRef.current };
      skipNextHoldRef.current = false;
      holdResultsRef.current = [...holdResultsRef.current, result];
      setHoldResults([...holdResultsRef.current]);
      contractionsRef.current = [...contractionsRef.current, { ...currentContractionRef.current }];
      setContractions([...contractionsRef.current]);

      Vibration.vibrate(500);
      const isLast = idx >= totalSets - 1;
      if (isLast) {
        const elapsed = sessionStartRef.current ? Math.floor((Date.now() - sessionStartRef.current) / 1000) : 0;
        setSessionTime(elapsed);
        phaseRef.current = 'done';
        setPhase('done');
        setRunning(false);
        Vibration.vibrate([0, 300, 200, 300, 200, 300]);
        // Persist to local history
        const results = holdResultsRef.current;
        const completed = results.filter((h) => h.completed).length;
        const holdTotal = results.filter((h) => h.completed).reduce((s, h) => s + h.hold_s, 0);
        if (protocol) {
          saveTableSession({
            date: new Date().toISOString(),
            protocolName: protocol.name,
            protocolKey: protocol.key,
            protocolColor: protocol.color,
            holdsCompleted: completed,
            totalSets,
            totalHoldTimeS: holdTotal,
            sessionTimeS: elapsed,
            contractions: contractionsRef.current,
          });
        }
        return;
      }
      const restDur = currentSet()?.rest_s ?? (protocol?.rest_s ?? 120);
      phaseRef.current = 'rest';
      durationRef.current = restDur;
      startRef.current = Date.now();
      setPhase('rest');
      setSecondsLeft(restDur);

    } else if (cur === 'rest') {
      // Rest finished — breathup for next hold
      const nextIdx = idx + 1;
      setIdxRef.current = nextIdx;
      setSetIdx(nextIdx);
      Vibration.vibrate([0, 100, 80, 100]);
      phaseRef.current = 'breathup';
      durationRef.current = BREATHUP_S;
      startRef.current = Date.now();
      setPhase('breathup');
      setSecondsLeft(BREATHUP_S);
    }
  }

  function skipPhase() {
    if (phaseRef.current === 'hold') skipNextHoldRef.current = true;
    setRunning(false);
    setTimeout(() => {
      advancePhase();
      setRunning(true);
    }, 100);
  }

  function toggleRun() {
    if (!running) {
      if (!sessionStartRef.current) sessionStartRef.current = Date.now();
      startRef.current = Date.now();
    }
    setRunning((r) => !r);
  }

  function markContraction() {
    if (phase !== 'hold' || !holdStartRef.current) return;
    const elapsedS = Math.round((Date.now() - holdStartRef.current) / 1000);
    const cur = currentContractionRef.current;
    currentContractionRef.current = {
      firstAtS: cur.firstAtS ?? elapsedS,
      count: cur.count + 1,
    };
    setCurrentCxCount(cur.count + 1);
    Vibration.vibrate(15); // subtle haptic confirmation
  }

  function reset() {
    setRunning(false);
    setSetIdx(0);
    setIdxRef.current = 0;
    phaseRef.current = 'breathup';
    durationRef.current = BREATHUP_S;
    setPhase('breathup');
    setSecondsLeft(BREATHUP_S);
    holdResultsRef.current = [];
    setHoldResults([]);
    contractionsRef.current = [];
    setContractions([]);
    currentContractionRef.current = { firstAtS: null, count: 0 };
    setCurrentCxCount(0);
    holdStartRef.current = null;
    sessionStartRef.current = null;
    skipNextHoldRef.current = false;
  }

  if (!protocol) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={{ color: Colors.textMuted }}>No protocol selected.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: Colors.cyan }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'done') {
    const color = protocol.color;
    const holdsCompleted = holdResults.filter((h) => h.completed).length;
    const holdsSkipped = holdResults.filter((h) => !h.completed).length;
    const totalHoldTime = holdResults.filter((h) => h.completed).reduce((s, h) => s + h.hold_s, 0);
    return (
      <LinearGradient colors={[Colors.bg, '#080f1e', Colors.bg]} style={styles.root}>
        <ScrollView contentContainerStyle={styles.doneScroll} showsVerticalScrollIndicator={false}>
          <MaterialIcons name="check-circle" size={56} color={Colors.cyan} style={{ marginBottom: 16 }} />
          <Text style={styles.doneTitle}>SESSION COMPLETE</Text>
          <Text style={[styles.doneSub, { color, marginBottom: 28 }]}>{protocol.name}</Text>

          {/* Stats grid */}
          <View style={styles.doneGrid}>
            <View style={styles.doneCell}>
              <Text style={styles.doneCellValue}>{fmtTimer(sessionTime)}</Text>
              <Text style={styles.doneCellLabel}>SESSION TIME</Text>
            </View>
            <View style={[styles.doneCell, styles.doneCellBorder]}>
              <Text style={[styles.doneCellValue, { color: Colors.cyan }]}>
                {holdsCompleted}<Text style={styles.doneCellSub}>/{totalSets}</Text>
              </Text>
              <Text style={styles.doneCellLabel}>HOLDS DONE</Text>
            </View>
            <View style={styles.doneCell}>
              <Text style={styles.doneCellValue}>{fmtTimer(totalHoldTime)}</Text>
              <Text style={styles.doneCellLabel}>HOLD TIME</Text>
            </View>
          </View>

          {holdsSkipped > 0 && (
            <Text style={styles.doneSkipped}>{holdsSkipped} set{holdsSkipped > 1 ? 's' : ''} skipped</Text>
          )}

          {/* Contraction summary */}
          {(() => {
            const cx = contractions;
            const withCx = cx.filter((c) => c.count > 0);
            if (withCx.length === 0) return null;
            const avgFirst = withCx.reduce((s, c) => s + (c.firstAtS ?? 0), 0) / withCx.length;
            const totalCx = cx.reduce((s, c) => s + c.count, 0);
            return (
              <View style={[cxStyles.summaryCard, { borderLeftColor: Colors.orange }]}>
                <View style={cxStyles.summaryHeader}>
                  <MaterialIcons name="touch-app" size={12} color={Colors.orange} />
                  <Text style={cxStyles.summaryTitle}>CONTRACTIONS</Text>
                </View>
                <View style={cxStyles.summaryRow}>
                  <View style={cxStyles.summaryCell}>
                    <Text style={cxStyles.summaryValue}>{fmtTimer(Math.round(avgFirst))}</Text>
                    <Text style={cxStyles.summaryLabel}>AVG FIRST</Text>
                  </View>
                  <View style={[cxStyles.summaryCell, { borderLeftWidth: 1, borderLeftColor: Colors.outlineVariant + '30' }]}>
                    <Text style={cxStyles.summaryValue}>{totalCx}</Text>
                    <Text style={cxStyles.summaryLabel}>TOTAL</Text>
                  </View>
                  <View style={[cxStyles.summaryCell, { borderLeftWidth: 1, borderLeftColor: Colors.outlineVariant + '30' }]}>
                    <Text style={cxStyles.summaryValue}>{withCx.length}<Text style={{ fontSize: 11, color: Colors.outline }}>/{cx.length}</Text></Text>
                    <Text style={cxStyles.summaryLabel}>HOLDS W/ CX</Text>
                  </View>
                </View>
                <Text style={cxStyles.summaryTip}>
                  Longer time-to-first-contraction = better CO₂ tolerance. Track this across sessions.
                </Text>
              </View>
            );
          })()}

          {/* Per-set results */}
          <View style={styles.doneSetRow}>
            {holdResults.map((h, i) => (
              <View key={i} style={[styles.doneSetChip, { borderColor: h.completed ? color + '60' : Colors.error + '40' }]}>
                <MaterialIcons
                  name={h.completed ? 'check' : 'close'}
                  size={10}
                  color={h.completed ? color : Colors.error}
                />
                <Text style={[styles.doneSetChipLabel, { color: h.completed ? color : Colors.error }]}>
                  {i + 1}
                </Text>
                {h.completed && (
                  <Text style={styles.doneSetChipTime}>{fmtTimer(h.hold_s)}</Text>
                )}
              </View>
            ))}
          </View>

          {/* Coach note */}
          {(() => {
            const note = getCoachNote(holdsCompleted, totalSets, protocol.type);
            return (
              <View style={[styles.coachCard, { borderLeftColor: note.color }]}>
                <View style={styles.coachHeader}>
                  <MaterialIcons name="insights" size={13} color={note.color} />
                  <Text style={[styles.coachHeadline, { color: note.color }]}>{note.headline.toUpperCase()}</Text>
                </View>
                <Text style={styles.coachBody}>{note.body}</Text>
              </View>
            );
          })()}

          {/* Protocol history comparison */}
          {priorHistory.length > 0 && (() => {
            const last = priorHistory[0]; // most recent prior attempt
            const attemptNum = priorHistory.length + 1;
            const completionPct = totalSets > 0 ? Math.round((holdsCompleted / totalSets) * 100) : 0;
            const lastPct = last.totalSets > 0 ? Math.round((last.holdsCompleted / last.totalSets) * 100) : 0;
            const pctDelta = completionPct - lastPct;
            const holdDelta = totalHoldTime - last.totalHoldTimeS;

            // Streak: count consecutive 100% completions (including this one)
            let streak = holdsCompleted === totalSets ? 1 : 0;
            if (streak > 0) {
              for (const r of priorHistory) {
                if (r.holdsCompleted === r.totalSets) streak++;
                else break;
              }
            }

            // Last 5 attempts for sparkline (oldest → newest, including this session)
            const recent = [...priorHistory.slice(0, 4)].reverse();
            const sparkData = [
              ...recent.map((r) => r.totalSets > 0 ? r.holdsCompleted / r.totalSets : 0),
              totalSets > 0 ? holdsCompleted / totalSets : 0,
            ];
            const sparkMax = Math.max(...sparkData, 0.1);

            return (
              <View style={styles.histCard}>
                <View style={styles.histHeader}>
                  <View style={styles.histHeaderLeft}>
                    <MaterialIcons name="history" size={12} color={Colors.outline} />
                    <Text style={styles.histMicro}>ATTEMPT #{attemptNum}</Text>
                  </View>
                  {streak >= 2 && (
                    <View style={styles.streakBadge}>
                      <MaterialIcons name="local-fire-department" size={10} color="#facc15" />
                      <Text style={styles.streakText}>{streak}× PERFECT</Text>
                    </View>
                  )}
                </View>

                {/* Sparkline: completion rate over last attempts */}
                <View style={styles.sparkRow}>
                  {sparkData.map((pct, i) => {
                    const h = Math.max(3, (pct / sparkMax) * 32);
                    const isThis = i === sparkData.length - 1;
                    return (
                      <View key={i} style={styles.sparkBarWrap}>
                        <View style={[styles.sparkBar, {
                          height: h,
                          backgroundColor: isThis ? color : pct >= 1 ? color + '50' : Colors.outline + '40',
                        }]} />
                        {isThis && <View style={[styles.sparkDot, { backgroundColor: color }]} />}
                      </View>
                    );
                  })}
                </View>

                {/* Deltas vs last attempt */}
                <View style={styles.histDeltaRow}>
                  <View style={styles.histDelta}>
                    <Text style={styles.histDeltaLabel}>vs LAST</Text>
                    <Text style={[styles.histDeltaValue, { color: pctDelta > 0 ? '#4ade80' : pctDelta < 0 ? Colors.error : Colors.outline }]}>
                      {pctDelta > 0 ? '↑' : pctDelta < 0 ? '↓' : '='}{Math.abs(pctDelta)}%
                    </Text>
                    <Text style={styles.histDeltaSub}>completion</Text>
                  </View>
                  <View style={[styles.histDelta, { borderLeftWidth: 1, borderLeftColor: Colors.outlineVariant + '30' }]}>
                    <Text style={styles.histDeltaLabel}>HOLD TIME</Text>
                    <Text style={[styles.histDeltaValue, { color: holdDelta > 0 ? '#4ade80' : holdDelta < 0 ? Colors.error : Colors.outline }]}>
                      {holdDelta > 0 ? '+' : ''}{fmtTimer(Math.abs(holdDelta))}
                    </Text>
                    <Text style={styles.histDeltaSub}>{holdDelta >= 0 ? 'more' : 'less'}</Text>
                  </View>
                  <View style={[styles.histDelta, { borderLeftWidth: 1, borderLeftColor: Colors.outlineVariant + '30' }]}>
                    <Text style={styles.histDeltaLabel}>TOTAL</Text>
                    <Text style={styles.histDeltaValue}>{priorHistory.length + 1}</Text>
                    <Text style={styles.histDeltaSub}>sessions</Text>
                  </View>
                </View>
              </View>
            );
          })()}

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 20, alignSelf: 'center' }}>
            <TouchableOpacity
              onPress={async () => {
                const lines: string[] = [
                  `🫁 ${protocol.name}`,
                  `${holdsCompleted}/${totalSets} holds • ${fmtTimer(totalHoldTime)} total`,
                ];
                const cxWithData = contractions.filter((c) => c.count > 0);
                if (cxWithData.length > 0) {
                  const avgFirst = Math.round(cxWithData.reduce((s, c) => s + (c.firstAtS ?? 0), 0) / cxWithData.length);
                  lines.push(`First contraction avg: ${fmtTimer(avgFirst)}`);
                }
                if (priorHistory.length > 0) {
                  const streak = (() => {
                    let s = holdsCompleted === totalSets ? 1 : 0;
                    if (s > 0) for (const r of priorHistory) { if (r.holdsCompleted === r.totalSets) s++; else break; }
                    return s;
                  })();
                  if (streak >= 2) lines.push(`🔥 ${streak}× perfect streak`);
                  lines.push(`Attempt #${priorHistory.length + 1}`);
                }
                lines.push('', 'Trained with Garmin Freediving');
                try { await Share.share({ message: lines.join('\n') }); } catch {}
              }}
              style={[styles.ctaBtn, { borderColor: Colors.outline }]}
            >
              <MaterialIcons name="share" size={16} color={Colors.textMuted} />
              <Text style={[styles.ctaText, { color: Colors.textMuted }]}>SHARE</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.back()} style={[styles.ctaBtn, { borderColor: Colors.cyan }]}>
              <MaterialIcons name="check" size={16} color={Colors.cyan} />
              <Text style={[styles.ctaText, { color: Colors.cyan }]}>DONE</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </LinearGradient>
    );
  }

  // Safety gate — shown before the session starts
  if (!buddyConfirmed) {
    const color = protocol.color;
    return (
      <LinearGradient colors={[Colors.bg, '#070d1a', Colors.bg]} style={[styles.root, styles.center]}>
        <View style={styles.safetyCard}>
          <View style={styles.safetyIconRow}>
            <MaterialIcons name="warning" size={28} color={Colors.error} />
          </View>
          <Text style={styles.safetyTitle}>SAFETY CHECK</Text>
          <Text style={styles.safetyRule}>
            Never freedive alone.
          </Text>
          <Text style={styles.safetyBody}>
            Always train with an alert buddy or safety diver who knows rescue procedures and is ready to assist immediately.
          </Text>
          <View style={styles.safetyDivider} />
          <Text style={styles.safetyPrompt}>Confirm before starting your session:</Text>

          <TouchableOpacity
            onPress={() => setBuddyConfirmed(true)}
            style={[styles.safetyConfirmBtn, { borderColor: color, backgroundColor: color + '15' }]}
          >
            <MaterialIcons name="people" size={18} color={color} />
            <Text style={[styles.safetyConfirmText, { color }]}>MY BUDDY IS READY</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.back()} style={styles.safetyCancelBtn}>
            <Text style={styles.safetyCancelText}>I'm training alone — go back</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  const color = protocol.color;
  const currentHold = sets[setIdx]?.hold_s ?? protocol.hold_s;
  const currentRest = sets[setIdx]?.rest_s ?? protocol.rest_s;
  const nextSet = sets[setIdx + 1];
  const isLastSet = setIdx >= totalSets - 1;

  const isCountdown = phase === 'hold' && running && secondsLeft <= 5 && secondsLeft > 0;

  // Hook breathing: first 12s of rest = 3 hook breaths (~4s each)
  const HOOK_DURATION_S = 12;
  const HOOK_CYCLE_S = 4; // 1.5s sharp inhale + 1s hold + 1.5s exhale
  const restElapsedS = phase === 'rest' && running ? durationRef.current - secondsLeft : 0;
  const inHookPhase = phase === 'rest' && running && restElapsedS < HOOK_DURATION_S;
  const hookNum = inHookPhase ? Math.min(3, Math.floor(restElapsedS / HOOK_CYCLE_S) + 1) : 0;
  const hookSubPhase = inHookPhase
    ? (restElapsedS % HOOK_CYCLE_S < 1.5 ? 'IN' : restElapsedS % HOOK_CYCLE_S < 2.5 ? 'HOLD' : 'OUT')
    : null;

  const phaseColor = isCountdown ? Colors.error : phase === 'hold' ? color : phase === 'rest' ? Colors.tertiary : Colors.outline;
  const phaseLabel = phase === 'hold' ? 'HOLD'
    : phase === 'rest' ? (inHookPhase ? 'HOOK BREATHE' : 'RECOVER')
    : 'BREATHE UP';
  const phaseIcon = phase === 'hold' ? 'pause-circle-filled' : inHookPhase ? 'shield' : 'air';
  const progress = durationRef.current > 0 ? Math.min(1, 1 - (secondsLeft / durationRef.current)) : 0;

  return (
    <LinearGradient colors={[Colors.bg, '#070d1a', Colors.bg]} style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.exitBtn}>
          <MaterialIcons name="close" size={20} color={Colors.outline} />
        </TouchableOpacity>
        <Text style={[styles.protocolName, { color }]}>{protocol.name}</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Set phase indicators */}
      <View style={styles.indicatorsRow}>
        {Array.from({ length: totalSets }).map((_, i) => {
          const isDone = i < setIdx;
          const isCurrent = i === setIdx;
          const isUpcoming = i > setIdx;
          const holdActive = isCurrent && phase === 'hold';
          const restActive = isCurrent && phase === 'rest';
          const breathActive = isCurrent && phase === 'breathup';
          return (
            <View key={i} style={[styles.indicator, isCurrent && { borderColor: color + '60' }]}>
              {/* Hold half */}
              <View style={[
                styles.indicatorHalf,
                { borderRadius: 3, borderTopRightRadius: 0, borderBottomRightRadius: 0 },
                isDone && { backgroundColor: color + '40' },
                holdActive && { backgroundColor: color },
                breathActive && { backgroundColor: color + '30' },
                isUpcoming && { backgroundColor: Colors.surfaceHighest },
                restActive && { backgroundColor: color + '25' },
              ]}>
                <Text style={[styles.indicatorHalfLabel, { color: (holdActive || isDone) ? color : Colors.outline + '60' }]}>H</Text>
              </View>
              {/* Rest half */}
              <View style={[
                styles.indicatorHalf,
                { borderRadius: 3, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
                isDone && { backgroundColor: Colors.tertiary + '40' },
                restActive && { backgroundColor: Colors.tertiary },
                breathActive && { backgroundColor: Colors.tertiary + '20' },
                holdActive && { backgroundColor: Colors.tertiary + '20' },
                isUpcoming && { backgroundColor: Colors.surfaceHighest },
              ]}>
                <Text style={[styles.indicatorHalfLabel, { color: (restActive || isDone) ? Colors.tertiary : Colors.outline + '60' }]}>R</Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text style={styles.setCounter}>
        SET <Text style={{ color }}>{setIdx + 1}</Text> / {totalSets}
      </Text>

      {/* Phase label */}
      <View style={styles.phaseLabelRow}>
        <MaterialIcons name={phaseIcon as any} size={16} color={phaseColor} />
        <Text style={[styles.phaseLabel, { color: phaseColor }]}>{phaseLabel}</Text>
      </View>

      {/* Timer ring with circular progress */}
      <Animated.View style={[styles.timerWrap, pulseStyle]}>
        <View style={styles.timerRingOuter}>
          <CircularProgress progress={progress} color={phaseColor} isCountdown={isCountdown} />
          <View style={[
            styles.timerRing,
            isCountdown && { shadowColor: Colors.error, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
          ]}>
            <Text style={[styles.timer, { color: phaseColor }, isCountdown && { fontSize: 68, fontWeight: '300' }]}>
              {fmtTimer(secondsLeft)}
            </Text>
            {isCountdown
              ? <Text style={[styles.timerSub, { color: Colors.error, letterSpacing: 3 }]}>SURFACE SOON</Text>
              : phase === 'breathup'
                ? <Text style={styles.timerSub}>breathe up</Text>
                : phase === 'hold'
                  ? <Text style={styles.timerSub}>{fmtTimer(currentHold)} hold</Text>
                  : <Text style={styles.timerSub}>{fmtTimer(currentRest)} rest</Text>
            }
          </View>
        </View>
      </Animated.View>

      {/* Breathing guide — active during rest (after hook phase) and breathup */}
      <BreathGuide
        active={running && ((phase === 'rest' && !inHookPhase) || phase === 'breathup')}
        color={phase === 'rest' ? Colors.tertiary : color}
      />

      {/* Hook breathing guide — first 12s of rest (safety-critical) */}
      {inHookPhase && (
        <View style={hkStyles.wrap}>
          <View style={hkStyles.countRow}>
            {[1, 2, 3].map((n) => (
              <View
                key={n}
                style={[
                  hkStyles.countDot,
                  n <= hookNum ? hkStyles.countDotActive : null,
                  n === hookNum && hkStyles.countDotCurrent,
                ]}
              >
                <Text style={[hkStyles.countNum, n <= hookNum && hkStyles.countNumActive]}>
                  {n}
                </Text>
              </View>
            ))}
          </View>
          <View style={hkStyles.phaseRow}>
            <View style={[hkStyles.phasePill, hookSubPhase === 'IN' && hkStyles.phaseActive]}>
              <Text style={[hkStyles.phaseText, hookSubPhase === 'IN' && hkStyles.phaseTextActive]}>
                SHARP IN
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={10} color={Colors.outline} />
            <View style={[hkStyles.phasePill, hookSubPhase === 'HOLD' && hkStyles.phaseActive]}>
              <Text style={[hkStyles.phaseText, hookSubPhase === 'HOLD' && hkStyles.phaseTextActive]}>
                HOLD
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={10} color={Colors.outline} />
            <View style={[hkStyles.phasePill, hookSubPhase === 'OUT' && hkStyles.phaseActive]}>
              <Text style={[hkStyles.phaseText, hookSubPhase === 'OUT' && hkStyles.phaseTextActive]}>
                EXHALE
              </Text>
            </View>
          </View>
          <Text style={hkStyles.tip}>Maintains thoracic pressure — prevents blackout</Text>
        </View>
      )}

      {/* Contraction marker — tap during hold to track diaphragm contractions */}
      {running && phase === 'hold' && (
        <TouchableOpacity
          onPress={markContraction}
          activeOpacity={0.5}
          style={[cxStyles.tapBtn, { borderColor: Colors.orange + '50', backgroundColor: Colors.orange + '10' }]}
        >
          <Text style={cxStyles.tapCount}>
            {currentCxCount > 0 ? String(currentCxCount) : ''}
          </Text>
          <Text style={cxStyles.tapLabel}>TAP ON CONTRACTION</Text>
        </TouchableOpacity>
      )}

      {/* Next set info */}
      <View style={styles.nextInfo}>
        {!isLastSet && nextSet ? (
          <Text style={styles.nextText}>
            Next: <Text style={{ color }}>{fmtTimer(nextSet.hold_s)}</Text> hold
            {' · '}<Text style={{ color: Colors.tertiary }}>{fmtTimer(nextSet.rest_s)}</Text> rest
          </Text>
        ) : isLastSet ? (
          <Text style={styles.nextText}>Last set — finish strong</Text>
        ) : null}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          onPress={toggleRun}
          style={[styles.ctaBtn, { borderColor: color, backgroundColor: running ? 'transparent' : `${color}18` }]}
        >
          <MaterialIcons name={running ? 'pause' : 'play-arrow'} size={18} color={color} />
          <Text style={[styles.ctaText, { color }]}>{running ? 'PAUSE' : 'START'}</Text>
        </TouchableOpacity>

        <View style={styles.secondaryRow}>
          {running && (
            <TouchableOpacity onPress={skipPhase} style={[styles.secondaryBtn, { borderColor: color + '60', backgroundColor: color + '12' }]}>
              <MaterialIcons name="skip-next" size={16} color={color} />
              <Text style={[styles.secondaryText, { color }]}>SKIP</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={reset} style={[styles.secondaryBtn, { borderColor: Colors.error + '50', backgroundColor: Colors.error + '0e' }]}>
            <MaterialIcons name="replay" size={16} color={Colors.error} />
            <Text style={[styles.secondaryText, { color: Colors.error }]}>RESET</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Set table (scrollable peek) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tableScroll}
        style={styles.tableWrap}
      >
        {sets.map((s, i) => (
          <View
            key={i}
            style={[
              styles.tableCell,
              i === setIdx && { borderColor: color, backgroundColor: color + '14' },
              i < setIdx && { opacity: 0.35 },
            ]}
          >
            <Text style={[styles.tableCellIdx, i === setIdx && { color }]}>{i + 1}</Text>
            <Text style={styles.tableCellHold}>{fmtTimer(s.hold_s)}</Text>
            <Text style={styles.tableCellRest}>{fmtTimer(s.rest_s)}</Text>
          </View>
        ))}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 56 },
  center: { justifyContent: 'center', alignItems: 'center' },

  header: {
    paddingHorizontal: 20, marginBottom: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  exitBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  protocolName: { fontSize: 11, fontWeight: '700', letterSpacing: 2 },

  indicatorsRow: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginBottom: 8, flexWrap: 'wrap', paddingHorizontal: 16 },
  indicator: {
    flexDirection: 'row', borderRadius: 4, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.outlineVariant + '30',
  },
  indicatorHalf: { width: 16, height: 22, alignItems: 'center', justifyContent: 'center' },
  indicatorHalfLabel: { fontSize: 7, fontWeight: '700', letterSpacing: 0.5 },

  setCounter: { textAlign: 'center', fontSize: 12, color: Colors.outline, letterSpacing: 3, marginBottom: 6 },

  phaseLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 32 },
  phaseLabel: { fontSize: 13, letterSpacing: 4, fontWeight: '700' },

  timerWrap: { alignItems: 'center', marginBottom: 24 },
  timerRingOuter: {
    width: RING_SIZE, height: RING_SIZE,
    alignItems: 'center', justifyContent: 'center',
  },
  timerRing: {
    width: RING_SIZE - RING_STROKE * 2, height: RING_SIZE - RING_STROKE * 2,
    borderRadius: (RING_SIZE - RING_STROKE * 2) / 2,
    alignItems: 'center', justifyContent: 'center',
  },
  timer: { fontSize: 54, fontWeight: '200', letterSpacing: 3 },
  timerSub: { fontSize: 10, color: Colors.outline, letterSpacing: 2, marginTop: 4 },

  nextInfo: { alignItems: 'center', height: 22, marginBottom: 8 },
  nextText: { fontSize: 11, color: Colors.outline, letterSpacing: 1 },

  controls: { alignItems: 'center', gap: 14 },
  ctaBtn: {
    borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 48,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  ctaText: { fontSize: 15, fontWeight: '700', letterSpacing: 3 },
  secondaryRow: { flexDirection: 'row', gap: 12 },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 18,
    borderRadius: 10, borderWidth: 1,
  },
  secondaryText: { fontSize: 11, fontWeight: '700', letterSpacing: 2 },

  // Safety gate
  safetyCard: {
    backgroundColor: Colors.surfaceLow,
    borderRadius: 16, borderWidth: 1, borderColor: Colors.error + '30',
    margin: 24, padding: 24,
  },
  safetyIconRow: { alignItems: 'center', marginBottom: 12 },
  safetyTitle: {
    fontSize: 14, fontWeight: '800', color: Colors.error,
    letterSpacing: 4, textAlign: 'center', marginBottom: 12,
  },
  safetyRule: {
    fontSize: 18, fontWeight: '700', color: Colors.onSurface,
    textAlign: 'center', marginBottom: 10,
  },
  safetyBody: {
    fontSize: 13, color: Colors.onSurfaceVariant, lineHeight: 20,
    textAlign: 'center', marginBottom: 16,
  },
  safetyDivider: { height: 1, backgroundColor: Colors.outlineVariant + '30', marginBottom: 16 },
  safetyPrompt: { fontSize: 11, color: Colors.outline, textAlign: 'center', marginBottom: 14, letterSpacing: 0.5 },
  safetyConfirmBtn: {
    borderWidth: 1, borderRadius: 12, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginBottom: 12,
  },
  safetyConfirmText: { fontSize: 14, fontWeight: '800', letterSpacing: 2 },
  safetyCancelBtn: { alignItems: 'center', paddingVertical: 8 },
  safetyCancelText: { fontSize: 11, color: Colors.outline, textDecorationLine: 'underline' },

  // Done screen
  doneScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, paddingTop: 80 },
  doneTitle: { fontSize: 20, color: Colors.cyan, letterSpacing: 3, fontWeight: '700', marginBottom: 6 },
  doneSub: { fontSize: 12, letterSpacing: 2, fontWeight: '600' },
  doneGrid: {
    flexDirection: 'row', width: '100%',
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    overflow: 'hidden', marginBottom: 12,
  },
  doneCell: { flex: 1, alignItems: 'center', paddingVertical: 18 },
  doneCellBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.outlineVariant + '30' },
  doneCellValue: { fontSize: 24, fontWeight: '700', color: Colors.onSurface, marginBottom: 4 },
  doneCellSub: { fontSize: 14, color: Colors.outline, fontWeight: '400' },
  doneCellLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 2, fontWeight: '700' },
  doneSkipped: { fontSize: 11, color: Colors.error, marginBottom: 12, letterSpacing: 1 },
  doneSetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 4 },
  doneSetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5,
    backgroundColor: Colors.surfaceLow,
  },
  doneSetChipLabel: { fontSize: 10, fontWeight: '700' },
  doneSetChipTime: { fontSize: 9, color: Colors.outline, marginLeft: 2 },
  coachCard: {
    width: '100%', marginTop: 20,
    backgroundColor: Colors.surfaceHigh, borderRadius: 10,
    borderLeftWidth: 3, padding: 14,
  },
  coachHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  coachHeadline: { fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  coachBody: { fontSize: 13, color: Colors.onSurfaceVariant, lineHeight: 20 },

  // Protocol history comparison
  histCard: {
    width: '100%', marginTop: 16,
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14,
  },
  histHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  histHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  histMicro: { fontSize: 9, color: Colors.outline, letterSpacing: 2, fontWeight: '700' },
  streakBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#facc1518', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 3,
  },
  streakText: { fontSize: 8, color: '#facc15', fontWeight: '700', letterSpacing: 1 },
  sparkRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: 36, gap: 4, marginBottom: 12,
  },
  sparkBarWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', position: 'relative' },
  sparkBar: { width: '100%', borderRadius: 2 },
  sparkDot: {
    position: 'absolute', top: -5,
    width: 4, height: 4, borderRadius: 2,
  },
  histDeltaRow: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30',
    paddingTop: 10,
  },
  histDelta: { flex: 1, alignItems: 'center' },
  histDeltaLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginBottom: 3 },
  histDeltaValue: { fontSize: 16, fontWeight: '700', color: Colors.onSurface },
  histDeltaSub: { fontSize: 8, color: Colors.outline, marginTop: 1 },

  // Set table
  tableWrap: { marginTop: 20, maxHeight: 80 },
  tableScroll: { paddingHorizontal: 20, gap: 8 },
  tableCell: {
    width: 56, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.outlineVariant + '40',
    backgroundColor: Colors.surfaceLow,
  },
  tableCellIdx: { fontSize: 9, color: Colors.outline, letterSpacing: 1, marginBottom: 4 },
  tableCellHold: { fontSize: 11, color: Colors.onSurface, fontWeight: '600' },
  tableCellRest: { fontSize: 10, color: Colors.outline },
});

// Contraction tracking styles
const cxStyles = StyleSheet.create({
  tapBtn: {
    alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 24,
    marginBottom: 8,
  },
  tapCount: {
    fontSize: 18, fontWeight: '700', color: Colors.orange,
    minWidth: 20, textAlign: 'center',
  },
  tapLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 2, color: Colors.orange,
  },
  summaryCard: {
    width: '100%', marginTop: 16,
    backgroundColor: Colors.surfaceHigh, borderRadius: 10,
    borderLeftWidth: 3, padding: 14,
  },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  summaryTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 2, color: Colors.orange },
  summaryRow: { flexDirection: 'row', marginBottom: 10 },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 20, fontWeight: '700', color: Colors.onSurface, marginBottom: 2 },
  summaryLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700' },
  summaryTip: { fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16 },
});

// ── Hook breathing styles ─────────────────────────────────────────────────────
const hkStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center', marginTop: 12, gap: 8,
  },
  countRow: {
    flexDirection: 'row', gap: 8,
  },
  countDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.surfaceHighest,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  countDotActive: {
    backgroundColor: Colors.tertiary + '25',
    borderColor: Colors.tertiary + '50',
  },
  countDotCurrent: {
    backgroundColor: Colors.tertiary + '40',
    borderColor: Colors.tertiary,
  },
  countNum: {
    fontSize: 12, fontWeight: '700', color: Colors.outline,
  },
  countNumActive: { color: Colors.tertiary },
  phaseRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  phasePill: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6, backgroundColor: Colors.surfaceHighest,
  },
  phaseActive: {
    backgroundColor: Colors.tertiary + '30',
  },
  phaseText: {
    fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: Colors.outline,
  },
  phaseTextActive: { color: Colors.tertiary },
  tip: {
    fontSize: 9, color: Colors.outline, letterSpacing: 0.5,
  },
});
