import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, ActivityIndicator, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../src/constants/colors';
import { useProtocols } from '../../src/api/protocols';
import { useWorkingDepth, usePlateauStatus, useTrainingPhase } from '../../src/api/analytics';
import { useReadiness } from '../../src/api/health';
import { useAppStore } from '../../src/store/appStore';
import { fmtTimer } from '../../src/utils/formatters';
import { loadTableHistory, type TableSessionRecord } from '../../src/utils/tableHistory';

// Routine checklist persistence — keyed by today's date so it resets daily
const ROUTINE_KEY_PREFIX = '@routine_checks_';
function routineKey() {
  return ROUTINE_KEY_PREFIX + new Date().toISOString().slice(0, 10);
}
async function loadRoutineChecks(): Promise<Record<string, boolean>> {
  try {
    const raw = await AsyncStorage.getItem(routineKey());
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
async function saveRoutineChecks(checks: Record<string, boolean>): Promise<void> {
  try {
    await AsyncStorage.setItem(routineKey(), JSON.stringify(checks));
    // Clean up old keys (older than 2 days)
    const keys = await AsyncStorage.getAllKeys();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 2);
    const cutoffStr = ROUTINE_KEY_PREFIX + cutoff.toISOString().slice(0, 10);
    const stale = keys.filter((k) => k.startsWith(ROUTINE_KEY_PREFIX) && k < cutoffStr);
    if (stale.length > 0) await AsyncStorage.multiRemove(stale);
  } catch { /* non-fatal */ }
}

// Dryland/training routines derived from user data
function buildRoutines(
  workingDepth: number | null,
  isPlateau: boolean,
  phase: string | null,
): { id: string; title: string; desc: string; items: string[] }[] {
  const routines = [];

  // Always: flexibility + equalization warmup
  routines.push({
    id: 'warmup',
    title: 'Pre-Dive Warmup',
    desc: 'Mobility, diaphragm activation, equalization check',
    items: [
      'Neck rotations × 10 each direction',
      'Thoracic spine stretch — 2 min',
      'Diaphragm breathe × 20 deep belly breaths',
      'Frenzel equalization — 5 min on deck',
      'Rib cage stretches × 10',
    ],
  });

  // If plateau: add FRC/mouthfill drills
  if (isPlateau && workingDepth && workingDepth > 15) {
    routines.push({
      id: 'frc',
      title: 'Equalization Drills',
      desc: 'For plateau breaking — FRC & mouthfill technique',
      items: [
        'Dry mouthfill packing × 5 min',
        'FRC breath holds × 3 sets (easy)',
        'Inverted hang (2 min) — simulate 20m+',
        'Jaw-forward Frenzel at full exhale',
        'Relax shoulders, arms loose throughout',
      ],
    });
  }

  // Open water phase: mobility for cold water
  if (phase === 'open_water') {
    routines.push({
      id: 'mobility',
      title: 'Open Water Prep',
      desc: 'Buoyancy, duck dive, finning technique',
      items: [
        'Hip flexor stretch × 2 min each side',
        'Duck dive simulation × 5 reps (dry)',
        'Monofin kick practice (if applicable)',
        'Mental walkthrough of target depth',
        'Check equalisation to target depth — dry',
      ],
    });
  } else {
    // Pool phase: static breath hold table focus
    routines.push({
      id: 'static_prep',
      title: 'Static Table Prep',
      desc: 'CO₂ tolerance, body scan, relaxation',
      items: [
        'Body scan relaxation — 5 min lying down',
        'Box breathing (4-4-4-4) × 3 min',
        'Progressive muscle relaxation',
        'Visualize still water, sinking feeling',
        'Settle HR < 60 before starting tables',
      ],
    });
  }

  // Recovery (always useful)
  routines.push({
    id: 'recovery',
    title: 'Post-Session Recovery',
    desc: 'Debrief, cooldown, log your dive',
    items: [
      'Walk or light movement × 10 min',
      'Protein + electrolytes within 30 min',
      'Log session notes & max depth',
      'Note equalization depth and technique',
      'Rest HR check (compare to baseline)',
    ],
  });

  return routines;
}

// ── Intensity classification ──────────────────────────────────────────────────
// O2 tables drive hypoxia on purpose — blackout risk rises sharply when fatigued.
// CO2 tables are demanding but not acutely dangerous when readiness is moderate.
type Intensity = 'high' | 'moderate' | 'low';

function protocolIntensity(type: string): Intensity {
  const t = (type || '').toLowerCase();
  if (t.includes('o2') || t === 'o₂') return 'high';
  if (t.includes('co2') || t === 'co₂' || t.includes('carbon')) return 'moderate';
  return 'low';
}

// readiness thresholds for O2 gating
// < 50: block  (too risky, clearly fatigued)
// 50–64: warn  (proceed with caution)
// ≥ 65: clear
function o2Gate(score: number | undefined): 'block' | 'warn' | 'clear' {
  if (score === undefined) return 'clear'; // no data — don't block
  if (score < 50) return 'block';
  if (score < 65) return 'warn';
  return 'clear';
}

// ── Custom table overrides ──────────────────────────────────────────────────
function customSetsKey(protocolKey: string) { return `@custom_sets_${protocolKey}`; }

async function loadCustomSets(protocolKey: string): Promise<{ hold_s: number; rest_s: number }[] | null> {
  const raw = await AsyncStorage.getItem(customSetsKey(protocolKey));
  return raw ? JSON.parse(raw) : null;
}

async function saveCustomSets(protocolKey: string, sets: { hold_s: number; rest_s: number }[]) {
  await AsyncStorage.setItem(customSetsKey(protocolKey), JSON.stringify(sets));
}

async function clearCustomSets(protocolKey: string) {
  await AsyncStorage.removeItem(customSetsKey(protocolKey));
}

export default function ProtocolScreen() {
  const router = useRouter();
  const { data: protocols, isLoading } = useProtocols();
  const { data: workingDepth } = useWorkingDepth();
  const { data: plateau } = usePlateauStatus();
  const { data: phase } = useTrainingPhase();
  const { data: readiness } = useReadiness();
  const setActiveProtocol = useAppStore((s) => s.setActiveProtocol);

  const [tab, setTab] = useState<'tables' | 'training'>('tables');
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [expandedRoutine, setExpandedRoutine] = useState<string | null>('warmup');
  const [tableHistory, setTableHistory] = useState<TableSessionRecord[]>([]);
  const [customSetsMap, setCustomSetsMap] = useState<Record<string, { hold_s: number; rest_s: number }[]>>({});
  const [editingProtocol, setEditingProtocol] = useState<string | null>(null);
  const [editSets, setEditSets] = useState<{ hold_s: number; rest_s: number }[]>([]);

  useEffect(() => {
    loadTableHistory().then(setTableHistory);
  }, [tab]); // reload when switching to tables tab

  // Load persisted routine checks on mount
  useEffect(() => {
    loadRoutineChecks().then(setCheckedItems);
  }, []);

  // Load custom sets for all protocols
  useEffect(() => {
    if (!protocols) return;
    const loadAll = async () => {
      const map: Record<string, { hold_s: number; rest_s: number }[]> = {};
      for (const p of protocols) {
        const custom = await loadCustomSets(p.key);
        if (custom) map[p.key] = custom;
      }
      setCustomSetsMap(map);
    };
    loadAll();
  }, [protocols]);

  const routines = buildRoutines(
    workingDepth?.working_depth_m ?? null,
    plateau?.plateau ?? false,
    phase?.current_phase ?? null,
  );

  const toggleCheck = useCallback((key: string) => {
    setCheckedItems((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveRoutineChecks(next);
      return next;
    });
  }, []);

  // Get effective sets for a protocol (custom override or default)
  function getEffectiveSets(p: any): { hold_s: number; rest_s: number }[] {
    return customSetsMap[p.key] ?? p.sets ?? [];
  }

  function startProtocol(p: any) {
    const effectiveSets = getEffectiveSets(p);
    setActiveProtocol({ ...p, sets: effectiveSets });
    router.push(`/active/${p.key}`);
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="timer" size={16} color={Colors.cyan} />
          <Text style={styles.title}>TRAINING</Text>
        </View>
        {workingDepth && (
          <Text style={styles.headerSub}>
            Working depth: <Text style={{ color: Colors.cyan }}>{workingDepth.working_depth_m.toFixed(1)}m</Text>
          </Text>
        )}
      </View>

      {/* Tab switch */}
      <View style={styles.tabSwitch}>
        <Pressable
          style={[styles.switchBtn, tab === 'tables' && styles.switchBtnActive]}
          onPress={() => setTab('tables')}
        >
          <Text style={[styles.switchText, tab === 'tables' && styles.switchTextActive]}>BREATH TABLES</Text>
        </Pressable>
        <Pressable
          style={[styles.switchBtn, tab === 'training' && styles.switchBtnActive]}
          onPress={() => setTab('training')}
        >
          <Text style={[styles.switchText, tab === 'training' && styles.switchTextActive]}>ROUTINES</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── BREATH TABLES ── */}
        {tab === 'tables' && (
          <>
            {/* Readiness context bar */}
            {readiness && (() => {
              const score = readiness.score;
              const gate = o2Gate(score);
              const barColor = gate === 'block' ? Colors.error : gate === 'warn' ? Colors.orange : Colors.cyan;
              const barLabel = gate === 'block'
                ? 'LOW READINESS — O₂ TABLES LOCKED'
                : gate === 'warn'
                ? 'MODERATE READINESS — O₂ TABLES: CAUTION'
                : 'READINESS OK';
              const barSub = gate === 'block'
                ? `Score ${score} — HRV/sleep indicates fatigue. O₂ tables raise blackout risk when depleted.`
                : gate === 'warn'
                ? `Score ${score} — You can train, but consider CO₂ work instead of O₂ today.`
                : `Score ${score} — All protocols cleared for today.`;
              return (
                <View style={[styles.readinessBanner, { borderColor: barColor + '40', backgroundColor: barColor + '0d' }]}>
                  <View style={styles.readinessBannerRow}>
                    <MaterialIcons
                      name={gate === 'block' ? 'warning' : gate === 'warn' ? 'info-outline' : 'check-circle-outline'}
                      size={14}
                      color={barColor}
                    />
                    <Text style={[styles.readinessBannerLabel, { color: barColor }]}>{barLabel}</Text>
                    <View style={[styles.readinessScorePill, { backgroundColor: barColor + '20', borderColor: barColor + '50' }]}>
                      <Text style={[styles.readinessScoreText, { color: barColor }]}>{score}</Text>
                    </View>
                  </View>
                  <Text style={styles.readinessBannerSub}>{barSub}</Text>
                </View>
              );
            })()}

            {/* Today's training pick */}
            {protocols && protocols.length > 0 && (() => {
              const gate = o2Gate(readiness?.score);
              // Find the best protocol to recommend today
              const now = Date.now();

              // Score each protocol
              const scored = protocols.map((p) => {
                const intensity = protocolIntensity(p.type);
                const isO2 = intensity === 'high';
                const pGate = isO2 ? gate : 'clear';
                const hist = tableHistory.filter((r) => r.protocolKey === p.key);
                const lastDone = hist.length > 0 ? new Date(hist[0].date).getTime() : 0;
                const daysSince = lastDone > 0 ? Math.floor((now - lastDone) / 86400000) : 999;
                const recentPerfect = hist.length > 0 && hist[0].holdsCompleted === hist[0].totalSets;
                const sessions = hist.length;

                let score = 0;

                // Blocked protocols get -1000
                if (pGate === 'block') score -= 1000;
                // Warned O2 protocols get penalized
                if (pGate === 'warn') score -= 50;

                // Prefer protocols not done recently
                if (daysSince >= 7) score += 30;
                else if (daysSince >= 3) score += 20;
                else if (daysSince >= 1) score += 5;
                else score -= 30; // done today already

                // Prefer protocols with some history (familiar)
                if (sessions >= 2 && sessions <= 10) score += 10;
                if (sessions >= 1) score += 5;

                // If last attempt was perfect, slight nudge to try a different one
                if (recentPerfect && daysSince < 3) score -= 10;

                // API recommended flag
                if (p.recommended) score += 15;

                // Prefer CO2 when readiness is moderate
                if (gate === 'warn' && !isO2) score += 25;

                return { protocol: p, score, daysSince, sessions, recentPerfect, blocked: pGate === 'block' };
              });

              scored.sort((a, b) => b.score - a.score);
              const pick = scored[0];
              if (!pick || pick.blocked) return null;

              const p = pick.protocol;
              const reason = pick.daysSince >= 7
                ? `Haven't done this in ${pick.daysSince}d — good time to revisit`
                : pick.daysSince >= 3
                ? `${pick.daysSince}d since last attempt — fresh for another round`
                : pick.sessions === 0
                ? 'New protocol — give it a try'
                : pick.recentPerfect
                ? 'Last attempt was perfect — keep the momentum'
                : 'Good match for today\'s readiness level';

              return (
                <Pressable
                  style={({ pressed }) => [pickStyles.card, { borderColor: p.color + '50' }, pressed && { opacity: 0.85 }]}
                  onPress={() => startProtocol(p)}
                >
                  <View style={pickStyles.header}>
                    <MaterialIcons name="auto-awesome" size={13} color={p.color} />
                    <Text style={pickStyles.label}>TODAY'S PICK</Text>
                  </View>
                  <Text style={[pickStyles.name, { color: p.color }]}>{p.name}</Text>
                  <Text style={pickStyles.type}>{p.type.toUpperCase()}</Text>
                  <Text style={pickStyles.reason}>{reason}</Text>
                  <View style={pickStyles.footer}>
                    {pick.sessions > 0 && (
                      <Text style={pickStyles.footerStat}>
                        {pick.sessions} session{pick.sessions !== 1 ? 's' : ''} logged
                      </Text>
                    )}
                    <View style={{ flex: 1 }} />
                    <View style={[pickStyles.goBtn, { backgroundColor: p.color + '20', borderColor: p.color + '50' }]}>
                      <MaterialIcons name="play-arrow" size={14} color={p.color} />
                      <Text style={[pickStyles.goText, { color: p.color }]}>START</Text>
                    </View>
                  </View>
                </Pressable>
              );
            })()}

            {isLoading && <ActivityIndicator color={Colors.cyan} style={{ marginTop: 40 }} />}
            {protocols?.map((p) => {
              const intensity = protocolIntensity(p.type);
              const gate = intensity === 'high' ? o2Gate(readiness?.score) : 'clear';
              const blocked = gate === 'block';
              const warned = gate === 'warn';

              return (
              <LinearGradient
                key={p.key}
                colors={[`${p.color}14`, 'rgba(9,16,28,0.97)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.card, { borderColor: `${p.color}40`, opacity: blocked ? 0.6 : 1 }]}
              >
                {/* Intensity + recommended badges */}
                <View style={styles.cardBadgeRow}>
                  {p.recommended && (
                    <View style={[styles.badge, { backgroundColor: p.color }]}>
                      <Text style={styles.badgeText}>RECOMMENDED</Text>
                    </View>
                  )}
                  {intensity === 'high' && (
                    <View style={[styles.intensityBadge, { borderColor: Colors.error + '60', backgroundColor: Colors.error + '12' }]}>
                      <MaterialIcons name="whatshot" size={9} color={Colors.error} />
                      <Text style={[styles.intensityBadgeText, { color: Colors.error }]}>HIGH INTENSITY</Text>
                    </View>
                  )}
                  {intensity === 'moderate' && (
                    <View style={[styles.intensityBadge, { borderColor: Colors.orange + '60', backgroundColor: Colors.orange + '12' }]}>
                      <Text style={[styles.intensityBadgeText, { color: Colors.orange }]}>MODERATE</Text>
                    </View>
                  )}
                </View>

                <Text style={[styles.cardType, { color: p.color }]}>{p.type.toUpperCase()}</Text>
                <Text style={styles.cardName}>{p.name}</Text>
                <Text style={styles.cardDesc}>{p.desc}</Text>
                <Text style={styles.cardDetail}>{p.detail}</Text>

                {/* O2 caution inline warning */}
                {(blocked || warned) && (
                  <View style={[styles.o2Warning, { borderColor: (blocked ? Colors.error : Colors.orange) + '40', backgroundColor: (blocked ? Colors.error : Colors.orange) + '0d' }]}>
                    <MaterialIcons name="warning" size={12} color={blocked ? Colors.error : Colors.orange} />
                    <Text style={[styles.o2WarningText, { color: blocked ? Colors.error : Colors.orange }]}>
                      {blocked
                        ? 'Locked — readiness too low for hypoxic training. Risk of shallow water blackout increases significantly when fatigued.'
                        : 'Caution — your readiness is below optimal. Ensure you have a buddy and extra surface intervals if proceeding.'}
                    </Text>
                  </View>
                )}

                {/* Estimated session duration */}
                {(() => {
                  const eSets = getEffectiveSets(p);
                  if (eSets.length === 0) return null;
                  const totalSec = eSets.reduce((s: number, set: any) => s + set.hold_s + set.rest_s, 0) + 10 * eSets.length;
                  const mins = Math.ceil(totalSec / 60);
                  const isCustom = !!customSetsMap[p.key];
                  return (
                    <View style={styles.durationRow}>
                      <MaterialIcons name="schedule" size={11} color={p.color} />
                      <Text style={[styles.durationText, { color: p.color }]}>~{mins} min session</Text>
                      {isCustom && (
                        <View style={[ceStyles.customBadge, { borderColor: p.color + '40' }]}>
                          <MaterialIcons name="tune" size={9} color={p.color} />
                          <Text style={[ceStyles.customBadgeText, { color: p.color }]}>CUSTOM</Text>
                        </View>
                      )}
                    </View>
                  );
                })()}

                {/* Per-set preview (uses custom overrides if any) */}
                {(() => {
                  const eSets = getEffectiveSets(p);
                  if (eSets.length === 0) return null;
                  return (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.setsPreview}>
                      {eSets.map((s: any, i: number) => (
                        <View key={i} style={[styles.setChip, { borderColor: `${p.color}30` }]}>
                          <Text style={[styles.setChipIdx, { color: p.color }]}>{i + 1}</Text>
                          <Text style={styles.setChipHold}>{fmtTimer(s.hold_s)}</Text>
                          <Text style={styles.setChipRest}>{fmtTimer(s.rest_s)}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  );
                })()}

                {/* Customize / Edit sets */}
                {p.sets && p.sets.length > 0 && editingProtocol !== p.key && (
                  <TouchableOpacity
                    style={[ceStyles.customizeBtn, { borderColor: p.color + '30' }]}
                    onPress={() => {
                      const eSets = getEffectiveSets(p);
                      setEditSets(eSets.map((s: any) => ({ hold_s: s.hold_s, rest_s: s.rest_s })));
                      setEditingProtocol(p.key);
                    }}
                  >
                    <MaterialIcons name="tune" size={13} color={p.color} />
                    <Text style={[ceStyles.customizeBtnText, { color: p.color }]}>
                      {customSetsMap[p.key] ? 'EDIT TABLE' : 'CUSTOMIZE TABLE'}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Inline set editor */}
                {editingProtocol === p.key && (
                  <View style={ceStyles.editor}>
                    <View style={ceStyles.editorHeader}>
                      <MaterialIcons name="tune" size={12} color={p.color} />
                      <Text style={[ceStyles.editorTitle, { color: p.color }]}>CUSTOMIZE SETS</Text>
                    </View>
                    {/* Column headers */}
                    <View style={ceStyles.colHeaders}>
                      <Text style={[ceStyles.colH, { width: 24 }]}>#</Text>
                      <Text style={[ceStyles.colH, { flex: 1 }]}>HOLD</Text>
                      <Text style={[ceStyles.colH, { flex: 1 }]}>REST</Text>
                    </View>
                    {editSets.map((s, i) => (
                      <View key={i} style={ceStyles.setRow}>
                        <Text style={[ceStyles.setIdx, { color: p.color }]}>{i + 1}</Text>
                        {/* Hold time (±5s) */}
                        <View style={ceStyles.adjGroup}>
                          <TouchableOpacity style={ceStyles.adjBtn} onPress={() => {
                            const next = [...editSets];
                            next[i] = { ...next[i], hold_s: Math.max(5, next[i].hold_s - 5) };
                            setEditSets(next);
                          }}>
                            <MaterialIcons name="remove" size={14} color={Colors.onSurfaceVariant} />
                          </TouchableOpacity>
                          <Text style={ceStyles.adjValue}>{fmtTimer(s.hold_s)}</Text>
                          <TouchableOpacity style={ceStyles.adjBtn} onPress={() => {
                            const next = [...editSets];
                            next[i] = { ...next[i], hold_s: Math.min(600, next[i].hold_s + 5) };
                            setEditSets(next);
                          }}>
                            <MaterialIcons name="add" size={14} color={Colors.onSurfaceVariant} />
                          </TouchableOpacity>
                        </View>
                        {/* Rest time (±5s) */}
                        <View style={ceStyles.adjGroup}>
                          <TouchableOpacity style={ceStyles.adjBtn} onPress={() => {
                            const next = [...editSets];
                            next[i] = { ...next[i], rest_s: Math.max(5, next[i].rest_s - 5) };
                            setEditSets(next);
                          }}>
                            <MaterialIcons name="remove" size={14} color={Colors.onSurfaceVariant} />
                          </TouchableOpacity>
                          <Text style={[ceStyles.adjValue, { color: Colors.tertiary }]}>{fmtTimer(s.rest_s)}</Text>
                          <TouchableOpacity style={ceStyles.adjBtn} onPress={() => {
                            const next = [...editSets];
                            next[i] = { ...next[i], rest_s: Math.min(600, next[i].rest_s + 5) };
                            setEditSets(next);
                          }}>
                            <MaterialIcons name="add" size={14} color={Colors.onSurfaceVariant} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                    {/* Action buttons */}
                    <View style={ceStyles.editorActions}>
                      {customSetsMap[p.key] && (
                        <TouchableOpacity
                          style={ceStyles.resetBtn}
                          onPress={async () => {
                            await clearCustomSets(p.key);
                            setCustomSetsMap((prev) => {
                              const next = { ...prev };
                              delete next[p.key];
                              return next;
                            });
                            setEditingProtocol(null);
                          }}
                        >
                          <MaterialIcons name="restore" size={12} color={Colors.outline} />
                          <Text style={ceStyles.resetText}>RESET TO DEFAULT</Text>
                        </TouchableOpacity>
                      )}
                      <View style={{ flex: 1 }} />
                      <TouchableOpacity
                        style={ceStyles.cancelBtn}
                        onPress={() => setEditingProtocol(null)}
                      >
                        <Text style={ceStyles.cancelText}>CANCEL</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[ceStyles.saveBtn, { backgroundColor: p.color + '20', borderColor: p.color + '40' }]}
                        onPress={async () => {
                          await saveCustomSets(p.key, editSets);
                          setCustomSetsMap((prev) => ({ ...prev, [p.key]: editSets }));
                          setEditingProtocol(null);
                        }}
                      >
                        <MaterialIcons name="check" size={12} color={p.color} />
                        <Text style={[ceStyles.saveText, { color: p.color }]}>SAVE</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* Per-protocol history inline */}
                {(() => {
                  const hist = tableHistory.filter((r) => r.protocolKey === p.key);
                  if (hist.length === 0) return null;
                  const last5 = hist.slice(0, 5).reverse(); // oldest → newest for sparkline
                  const latest = hist[0];
                  const latestPct = Math.round((latest.holdsCompleted / latest.totalSets) * 100);
                  const bestHold = Math.max(...hist.map((r) => r.totalHoldTimeS));
                  const perfectCount = hist.filter((r) => r.holdsCompleted === r.totalSets).length;
                  const dateStr = new Date(latest.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  return (
                    <View style={[pStyles.histInline, { borderColor: p.color + '25' }]}>
                      {/* Sparkline */}
                      <View style={pStyles.sparkRow}>
                        <Text style={pStyles.sparkLabel}>LAST {last5.length}</Text>
                        {last5.map((r, i) => {
                          const pct = r.holdsCompleted / r.totalSets;
                          return (
                            <View key={r.id} style={pStyles.sparkBarOuter}>
                              <View style={[pStyles.sparkBarFill, {
                                height: `${Math.max(pct * 100, 8)}%`,
                                backgroundColor: pct === 1 ? '#4ade80' : pct >= 0.75 ? p.color : Colors.orange,
                              }]} />
                            </View>
                          );
                        })}
                        <View style={{ flex: 1 }} />
                        <Text style={pStyles.sparkStat}>
                          Last: <Text style={{ color: latestPct === 100 ? '#4ade80' : Colors.onSurface }}>{latestPct}%</Text>
                          {' · '}{dateStr}
                        </Text>
                      </View>
                      {/* Stats row */}
                      <View style={pStyles.histStatsRow}>
                        <Text style={pStyles.histStat}>
                          {hist.length} session{hist.length !== 1 ? 's' : ''}
                        </Text>
                        <Text style={pStyles.histStatDivider}>·</Text>
                        <Text style={pStyles.histStat}>
                          Best: {fmtTimer(bestHold)}
                        </Text>
                        {perfectCount > 0 && (
                          <>
                            <Text style={pStyles.histStatDivider}>·</Text>
                            <Text style={[pStyles.histStat, { color: '#4ade80' }]}>
                              {perfectCount}× perfect
                            </Text>
                          </>
                        )}
                      </View>
                    </View>
                  );
                })()}

                <TouchableOpacity
                  onPress={() => !blocked && startProtocol(p)}
                  style={[styles.startBtn, { borderColor: blocked ? Colors.error + '50' : p.color }]}
                  activeOpacity={blocked ? 1 : 0.7}
                >
                  <MaterialIcons
                    name={blocked ? 'lock' : 'play-arrow'}
                    size={16}
                    color={blocked ? Colors.error : p.color}
                  />
                  <Text style={[styles.startText, { color: blocked ? Colors.error : p.color }]}>
                    {blocked ? 'LOCKED — LOW READINESS' : 'START SESSION'}
                  </Text>
                </TouchableOpacity>
              </LinearGradient>
              );
            })}

            {/* ── Training history ── */}
            {tableHistory.length > 0 && (
              <>
                <Text style={styles.historyLabel}>RECENT SESSIONS</Text>
                {tableHistory.slice(0, 8).map((record) => {
                  const pct = Math.round((record.holdsCompleted / record.totalSets) * 100);
                  const dateStr = new Date(record.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  return (
                    <View key={record.id} style={[styles.historyRow, { borderLeftColor: record.protocolColor + '80' }]}>
                      <View style={styles.historyLeft}>
                        <Text style={styles.historyName}>{record.protocolName}</Text>
                        <Text style={styles.historyDate}>{dateStr}</Text>
                      </View>
                      <View style={styles.historyRight}>
                        <Text style={[styles.historyPct, { color: pct === 100 ? '#4ade80' : pct >= 75 ? Colors.cyan : Colors.orange }]}>
                          {record.holdsCompleted}/{record.totalSets}
                        </Text>
                        <Text style={styles.historyTime}>{fmtTimer(record.totalHoldTimeS)}</Text>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </>
        )}

        {/* ── TRAINING ROUTINES ── */}
        {tab === 'training' && (
          <>
            {(() => {
              const totalItems = routines.reduce((s, r) => s + r.items.length, 0);
              const totalDone = routines.reduce((s, r) => s + r.items.filter((_, i) => checkedItems[`${r.id}-${i}`]).length, 0);
              const allComplete = totalDone === totalItems && totalItems > 0;
              return (
                <View style={styles.routineProgressWrap}>
                  <Text style={styles.routineIntro}>
                    Routines derived from your dive data
                    {plateau?.plateau ? ' · plateau mode active' : ''}.
                    {allComplete ? '' : ' Tap items to check off.'}
                  </Text>
                  {totalDone > 0 && (
                    <View style={styles.routineProgressRow}>
                      <View style={styles.routineProgressTrack}>
                        <View style={[styles.routineProgressFill, { width: `${(totalDone / totalItems) * 100}%` as any }]} />
                      </View>
                      <Text style={[styles.routineProgressText, allComplete && { color: '#4ade80' }]}>
                        {allComplete ? 'All done — ready to dive' : `${totalDone}/${totalItems}`}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })()}
            {routines.map((routine) => {
              const isExpanded = expandedRoutine === routine.id;
              const completedCount = routine.items.filter((_, i) => checkedItems[`${routine.id}-${i}`]).length;
              const allDone = completedCount === routine.items.length;
              return (
                <View key={routine.id} style={[styles.routineCard, allDone && styles.routineCardDone]}>
                  <Pressable
                    onPress={() => setExpandedRoutine(isExpanded ? null : routine.id)}
                    style={styles.routineHeader}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.routineTitle}>{routine.title}</Text>
                      <Text style={styles.routineDesc}>{routine.desc}</Text>
                    </View>
                    {allDone ? (
                      <View style={styles.routineDoneBadge}>
                        <MaterialIcons name="check-circle" size={10} color="#4ade80" />
                        <Text style={styles.routineDoneText}>DONE</Text>
                      </View>
                    ) : (
                      <View style={styles.routineBadge}>
                        <Text style={styles.routineBadgeText}>{completedCount}/{routine.items.length}</Text>
                      </View>
                    )}
                    <MaterialIcons
                      name={isExpanded ? 'expand-less' : 'expand-more'}
                      size={20}
                      color={Colors.outline}
                      style={{ marginLeft: 8 }}
                    />
                  </Pressable>

                  {isExpanded && (
                    <View style={styles.routineItems}>
                      {routine.items.map((item, i) => {
                        const key = `${routine.id}-${i}`;
                        const done = !!checkedItems[key];
                        return (
                          <Pressable
                            key={key}
                            onPress={() => toggleCheck(key)}
                            style={[styles.routineItem, done && styles.routineItemDone]}
                          >
                            <View style={[styles.checkbox, done && styles.checkboxDone]}>
                              {done && <MaterialIcons name="check" size={12} color={Colors.bg} />}
                            </View>
                            <Text style={[styles.routineItemText, done && styles.routineItemTextDone]}>
                              {item}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg, paddingTop: 56 },

  header: {
    paddingHorizontal: 20, marginBottom: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: Colors.onSurface, letterSpacing: 2 },
  headerSub: { fontSize: 11, color: Colors.outline },

  // Tab switch
  tabSwitch: {
    flexDirection: 'row', marginHorizontal: 20, marginBottom: 16,
    backgroundColor: Colors.surfaceHigh, borderRadius: 8, padding: 3,
  },
  switchBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  switchBtnActive: { backgroundColor: Colors.surfaceBright },
  switchText: { fontSize: 10, color: Colors.outline, letterSpacing: 2, fontWeight: '600' },
  switchTextActive: { color: Colors.onSurface },

  scroll: { paddingHorizontal: 20, paddingBottom: 100 },

  // Readiness banner
  readinessBanner: {
    borderWidth: 1, borderRadius: 10, padding: 12,
    marginBottom: 16,
  },
  readinessBannerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  readinessBannerLabel: { flex: 1, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  readinessScorePill: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  readinessScoreText: { fontSize: 11, fontWeight: '700' },
  readinessBannerSub: { fontSize: 11, color: Colors.outline, lineHeight: 16 },

  // Protocol cards
  card: { borderRadius: 14, borderWidth: 1, padding: 18, marginBottom: 16 },
  cardBadgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 9, fontWeight: '700', color: Colors.bg, letterSpacing: 1 },
  intensityBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1,
  },
  intensityBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  o2Warning: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12,
  },
  o2WarningText: { flex: 1, fontSize: 11, lineHeight: 16 },
  cardType: { fontSize: 9, letterSpacing: 2.5, fontWeight: '700', marginBottom: 4 },
  cardName: { fontSize: 15, fontWeight: '600', color: Colors.onSurface, marginBottom: 4 },
  cardDesc: { fontSize: 12, color: Colors.onSurfaceVariant, marginBottom: 4 },
  cardDetail: { fontSize: 11, color: Colors.outline, marginBottom: 8, lineHeight: 17 },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  durationText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },

  // Per-set preview chips
  setsPreview: { marginBottom: 14 },
  setChip: {
    alignItems: 'center', borderRadius: 6, borderWidth: 1,
    padding: 8, marginRight: 6, minWidth: 48,
    backgroundColor: Colors.surfaceLow,
  },
  setChipIdx: { fontSize: 8, fontWeight: '700', letterSpacing: 1, marginBottom: 3 },
  setChipHold: { fontSize: 11, color: Colors.onSurface, fontWeight: '600' },
  setChipRest: { fontSize: 9, color: Colors.outline, marginTop: 1 },

  startBtn: {
    borderWidth: 1, borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  startText: { fontSize: 13, fontWeight: '700', letterSpacing: 2 },

  // Training history
  historyLabel: {
    fontSize: 9, color: Colors.outline, letterSpacing: 2.5, fontWeight: '700',
    textTransform: 'uppercase', marginTop: 24, marginBottom: 10,
  },
  historyRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.surfaceHigh, borderLeftWidth: 2,
    borderRadius: 6, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 6,
  },
  historyLeft: { flex: 1 },
  historyName: { fontSize: 13, color: Colors.onSurface, fontWeight: '500' },
  historyDate: { fontSize: 10, color: Colors.outline, marginTop: 1 },
  historyRight: { alignItems: 'flex-end' },
  historyPct: { fontSize: 15, fontWeight: '700' },
  historyTime: { fontSize: 10, color: Colors.outline, marginTop: 1 },

  // Routine cards
  routineProgressWrap: { marginBottom: 16 },
  routineIntro: { fontSize: 12, color: Colors.outline, marginBottom: 8, lineHeight: 18 },
  routineProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routineProgressTrack: { flex: 1, height: 3, backgroundColor: Colors.surfaceHighest, borderRadius: 2, overflow: 'hidden' },
  routineProgressFill: { height: '100%', backgroundColor: '#4ade80', borderRadius: 2 },
  routineProgressText: { fontSize: 10, color: Colors.outline, fontWeight: '600' },
  routineCard: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    marginBottom: 12, overflow: 'hidden',
  },
  routineCardDone: { borderColor: '#4ade8030', backgroundColor: '#4ade8008' },
  routineDoneBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#4ade8018', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  routineDoneText: { fontSize: 9, color: '#4ade80', fontWeight: '700', letterSpacing: 1 },
  routineHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16,
  },
  routineTitle: { fontSize: 14, color: Colors.onSurface, fontWeight: '600', marginBottom: 2 },
  routineDesc: { fontSize: 11, color: Colors.outline },
  routineBadge: {
    backgroundColor: Colors.surfaceHighest, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  routineBadgeText: { fontSize: 10, color: Colors.primaryDim, fontWeight: '700' },
  routineItems: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30', paddingHorizontal: 16, paddingBottom: 8 },
  routineItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  routineItemDone: { opacity: 0.5 },
  checkbox: {
    width: 20, height: 20, borderRadius: 4,
    borderWidth: 1.5, borderColor: Colors.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: Colors.cyan, borderColor: Colors.cyan },
  routineItemText: { fontSize: 13, color: Colors.onSurface, flex: 1, lineHeight: 19 },
  routineItemTextDone: { textDecorationLine: 'line-through', color: Colors.outline },
});

// Per-protocol inline history styles
const pStyles = StyleSheet.create({
  histInline: {
    borderWidth: 1, borderRadius: 8, padding: 10,
    marginBottom: 14, backgroundColor: Colors.surfaceLow,
  },
  sparkRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 3,
    marginBottom: 6, height: 28,
  },
  sparkLabel: {
    fontSize: 8, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700',
    marginRight: 4, alignSelf: 'center',
  },
  sparkBarOuter: {
    width: 10, height: '100%', backgroundColor: Colors.surfaceHigh,
    borderRadius: 2, overflow: 'hidden', justifyContent: 'flex-end',
  },
  sparkBarFill: { borderRadius: 2 },
  sparkStat: { fontSize: 10, color: Colors.outline, alignSelf: 'center' },
  histStatsRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  histStat: { fontSize: 10, color: Colors.onSurfaceVariant },
  histStatDivider: { fontSize: 10, color: Colors.outline },
});

const pickStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, padding: 16, marginBottom: 16,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
  },
  label: {
    fontSize: 9, color: Colors.outline, letterSpacing: 2.5, fontWeight: '700',
  },
  name: {
    fontSize: 18, fontWeight: '700', letterSpacing: -0.3,
  },
  type: {
    fontSize: 9, color: Colors.outline, letterSpacing: 2, fontWeight: '600', marginTop: 2,
  },
  reason: {
    fontSize: 12, color: Colors.onSurfaceVariant, marginTop: 8, lineHeight: 17,
  },
  footer: {
    flexDirection: 'row', alignItems: 'center', marginTop: 12,
    paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '25',
  },
  footerStat: { fontSize: 10, color: Colors.outline },
  goBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  goText: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});

const ceStyles = StyleSheet.create({
  customBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8,
  },
  customBadgeText: { fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  customizeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 8, borderStyle: 'dashed',
    paddingVertical: 8, marginBottom: 10,
  },
  customizeBtnText: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  editor: {
    backgroundColor: Colors.surfaceLow, borderRadius: 10,
    padding: 12, marginBottom: 12,
  },
  editorHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10,
  },
  editorTitle: { fontSize: 9, fontWeight: '700', letterSpacing: 2 },
  colHeaders: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 4,
    paddingHorizontal: 2,
  },
  colH: { fontSize: 8, color: Colors.outline, letterSpacing: 1.5, fontWeight: '600' },
  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant + '15',
  },
  setIdx: { width: 24, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  adjGroup: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  adjBtn: {
    width: 28, height: 28, borderRadius: 6,
    backgroundColor: Colors.surfaceHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  adjValue: {
    width: 46, fontSize: 13, fontWeight: '600', color: Colors.onSurface,
    textAlign: 'center',
  },
  editorActions: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
  },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 6,
  },
  resetText: { fontSize: 9, color: Colors.outline, fontWeight: '600', letterSpacing: 1 },
  cancelBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  cancelText: { fontSize: 10, color: Colors.outline, fontWeight: '600', letterSpacing: 1 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  saveText: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
});
