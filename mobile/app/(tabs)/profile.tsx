import { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../src/constants/colors';
import { useTriggerSync } from '../../src/api/protocols';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { VanityStats } from '../../src/components/VanityStats';
import { useAppStore } from '../../src/store/appStore';
import { usePersonalBests, useDepthProgression, type PersonalBests } from '../../src/api/analytics';
import { loadTableHistory, type TableSessionRecord } from '../../src/utils/tableHistory';

// ── Achievement system ────────────────────────────────────────────────────────

interface TableStats {
  totalSessions: number;
  perfectCount: number;
  totalHoldTimeS: number;
  bestHoldTimeS: number;
  hasContractionData: boolean;
  consecutivePerfect: number;  // current streak
}

function computeTableStats(history: TableSessionRecord[]): TableStats {
  const totalSessions = history.length;
  const perfectCount = history.filter((r) => r.holdsCompleted === r.totalSets).length;
  const totalHoldTimeS = history.reduce((s, r) => s + r.totalHoldTimeS, 0);
  const bestHoldTimeS = history.length > 0 ? Math.max(...history.map((r) => r.totalHoldTimeS)) : 0;
  const hasContractionData = history.some(
    (r) => r.contractions && r.contractions.some((c) => c.count > 0),
  );
  // Current consecutive perfect streak (most recent first)
  let consecutivePerfect = 0;
  for (const r of history) {
    if (r.holdsCompleted === r.totalSets) consecutivePerfect++;
    else break;
  }
  return { totalSessions, perfectCount, totalHoldTimeS, bestHoldTimeS, hasContractionData, consecutivePerfect };
}

interface Achievement {
  id: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  name: string;
  description: string;
  color: string;
  check: (pbs: PersonalBests, ts: TableStats) => boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  // Depth milestones
  { id: 'd10',  icon: 'pool',            name: '10m Club',        description: 'Reached 10 metres',          color: Colors.cyan,    check: (p) => p.max_depth_m >= 10 },
  { id: 'd15',  icon: 'scuba-diving',    name: 'Frenzel Zone',    description: 'Reached 15 metres',          color: Colors.cyan,    check: (p) => p.max_depth_m >= 15 },
  { id: 'd20',  icon: 'water',           name: 'Deep Blue',       description: 'Reached 20 metres',          color: '#65afff',      check: (p) => p.max_depth_m >= 20 },
  { id: 'd25',  icon: 'waves',           name: 'Quarter Century', description: 'Reached 25 metres',          color: '#9b7fff',      check: (p) => p.max_depth_m >= 25 },
  { id: 'd30',  icon: 'arrow-downward',  name: 'Mouthfill Master',description: 'Reached 30 metres',          color: '#c084fc',      check: (p) => p.max_depth_m >= 30 },
  { id: 'd40',  icon: 'bolt',            name: 'Abyssal',         description: 'Reached 40 metres',          color: '#facc15',      check: (p) => p.max_depth_m >= 40 },
  // Bottom time milestones
  { id: 'bt60', icon: 'timer',           name: 'One Minute',      description: 'Bottom time over 60s',       color: '#4ade80',      check: (p) => p.max_bottom_time_s >= 60 },
  { id: 'bt120',icon: 'hourglass-bottom',name: 'Two Minutes',     description: 'Bottom time over 120s',      color: '#4ade80',      check: (p) => p.max_bottom_time_s >= 120 },
  { id: 'bt180',icon: 'self-improvement',name: 'Three Minutes',   description: 'Bottom time over 180s',      color: '#facc15',      check: (p) => p.max_bottom_time_s >= 180 },
  // Volume milestones
  { id: 's10',  icon: 'calendar-today',  name: 'Getting Started', description: '10 sessions logged',         color: Colors.outline,  check: (p) => p.total_sessions >= 10 },
  { id: 's25',  icon: 'event-available', name: 'Committed',       description: '25 sessions logged',         color: Colors.tertiary, check: (p) => p.total_sessions >= 25 },
  { id: 's50',  icon: 'emoji-events',    name: 'Dedicated',       description: '50 sessions logged',         color: Colors.orange,   check: (p) => p.total_sessions >= 50 },
  { id: 's100', icon: 'military-tech',   name: 'Centurion',       description: '100 sessions logged',        color: '#facc15',       check: (p) => p.total_sessions >= 100 },
  // Total depth descended
  { id: 'td1k', icon: 'landscape',       name: 'Kilometre Club',  description: '1,000m total descended',     color: Colors.cyan,     check: (p) => p.total_depth_descended_m >= 1000 },
  { id: 'td5k', icon: 'terrain',         name: 'Deep Trekker',    description: '5,000m total descended',     color: '#9b7fff',       check: (p) => p.total_depth_descended_m >= 5000 },
  { id: 'td10k',icon: 'public',          name: 'Ocean Walker',    description: '10,000m total descended',    color: '#facc15',       check: (p) => p.total_depth_descended_m >= 10000 },
  // ── Table training achievements ──
  { id: 't1',   icon: 'air',             name: 'First Table',     description: 'Complete a breath table',     color: Colors.orange,   check: (_p, t) => t.totalSessions >= 1 },
  { id: 't5',   icon: 'repeat',          name: 'Table Regular',   description: '5 table sessions',            color: Colors.orange,   check: (_p, t) => t.totalSessions >= 5 },
  { id: 't15',  icon: 'fitness-center',  name: 'Table Grinder',   description: '15 table sessions',           color: '#c084fc',       check: (_p, t) => t.totalSessions >= 15 },
  { id: 'tp3',  icon: 'star',            name: 'Hat Trick',       description: '3 perfect tables',            color: '#4ade80',       check: (_p, t) => t.perfectCount >= 3 },
  { id: 'tp10', icon: 'star-border',     name: 'Flawless Ten',    description: '10 perfect tables',           color: '#facc15',       check: (_p, t) => t.perfectCount >= 10 },
  { id: 'ts3',  icon: 'local-fire-department', name: 'On Fire',   description: '3× perfect streak',           color: '#facc15',       check: (_p, t) => t.consecutivePerfect >= 3 },
  { id: 'th30', icon: 'hourglass-full',  name: 'Iron Lungs',      description: '30min total hold time',       color: Colors.tertiary, check: (_p, t) => t.totalHoldTimeS >= 1800 },
  { id: 'th60', icon: 'whatshot',        name: 'CO₂ Machine',     description: '60min total hold time',       color: '#facc15',       check: (_p, t) => t.totalHoldTimeS >= 3600 },
  { id: 'cx1',  icon: 'touch-app',       name: 'Body Listener',   description: 'Track your first contraction',color: Colors.orange,   check: (_p, t) => t.hasContractionData },
];

// ── Diver Level System ───────────────────────────────────────────────────────
const LEVEL_TITLES = [
  'Surface Swimmer',   // 0
  'Snorkeler',         // 1
  'Skin Diver',        // 2
  'Breath Holder',     // 3
  'Duck Diver',        // 4
  'Frenzel Diver',     // 5
  'Freediver',         // 6
  'Deep Freediver',    // 7
  'Advanced Freediver',// 8
  'Expert Freediver',  // 9
  'Master Freediver',  // 10
  'Deep Specialist',   // 11
  'Elite Freediver',   // 12
  'Abyss Diver',       // 13
  'Depth Warrior',     // 14
  'Abyssal Legend',    // 15
];

function computeDiverLevel(pbs: PersonalBests, ts: TableStats): {
  level: number; title: string; xp: number; xpForNext: number; pctToNext: number;
  breakdown: { label: string; pts: number; max: number }[];
} {
  // Depth XP: 0-50m mapped to 0-500 pts (10 pts per metre)
  const depthPts = Math.min(500, Math.round(pbs.max_depth_m * 10));
  const depthMax = 500;

  // Sessions XP: 0-200 sessions mapped to 0-300 pts (diminishing returns)
  const sessionPts = Math.min(300, Math.round(Math.sqrt(pbs.total_sessions) * 21));
  const sessionMax = 300;

  // Volume XP: 0-10000m descended mapped to 0-200 pts
  const volPts = Math.min(200, Math.round((pbs.total_depth_descended_m / 10000) * 200));
  const volMax = 200;

  // Bottom time XP: 0-180s mapped to 0-150 pts
  const btPts = Math.min(150, Math.round((pbs.max_bottom_time_s / 180) * 150));
  const btMax = 150;

  // Table training XP: 0-30 sessions mapped to 0-150 pts (sqrt curve)
  const tablePts = Math.min(150, Math.round(Math.sqrt(ts.totalSessions) * 27));
  const tableMax = 150;

  // Total XP (max 1300)
  const xp = depthPts + sessionPts + volPts + btPts + tablePts;

  // Level thresholds (exponential curve, extended for table XP)
  const thresholds = [0, 20, 50, 100, 170, 260, 370, 490, 620, 760, 900, 1030, 1140, 1210, 1260, 1300];
  let level = 0;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (xp >= thresholds[i]) { level = i; break; }
  }
  const currentThreshold = thresholds[level];
  const nextThreshold = level < thresholds.length - 1 ? thresholds[level + 1] : thresholds[level];
  const xpForNext = nextThreshold - currentThreshold;
  const xpProgress = xp - currentThreshold;
  const pctToNext = xpForNext > 0 ? Math.min(1, xpProgress / xpForNext) : 1;

  return {
    level,
    title: LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length - 1)],
    xp,
    xpForNext,
    pctToNext,
    breakdown: [
      { label: 'DEPTH', pts: depthPts, max: depthMax },
      { label: 'SESSIONS', pts: sessionPts, max: sessionMax },
      { label: 'VOLUME', pts: volPts, max: volMax },
      { label: 'HOLD TIME', pts: btPts, max: btMax },
      { label: 'TABLES', pts: tablePts, max: tableMax },
    ],
  };
}

function DiverLevelCard({ pbs, tableStats }: { pbs: PersonalBests; tableStats: TableStats }) {
  const lvl = useMemo(() => computeDiverLevel(pbs, tableStats), [pbs, tableStats]);
  const isMaxLevel = lvl.level >= LEVEL_TITLES.length - 1;

  return (
    <LinearGradient
      colors={['rgba(0,240,255,0.08)', 'rgba(9,16,28,0.95)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={lvlStyles.card}
    >
      <View style={lvlStyles.topRow}>
        <View style={lvlStyles.levelCircle}>
          <Text style={lvlStyles.levelNum}>{lvl.level}</Text>
        </View>
        <View style={lvlStyles.titleCol}>
          <Text style={lvlStyles.title}>{lvl.title}</Text>
          <Text style={lvlStyles.xpText}>
            {lvl.xp} XP{!isMaxLevel ? ` · ${lvl.xpForNext - Math.round(lvl.pctToNext * lvl.xpForNext)} to next` : ' · MAX LEVEL'}
          </Text>
        </View>
      </View>

      {/* XP progress bar */}
      {!isMaxLevel && (
        <View style={lvlStyles.progressTrack}>
          <View style={[lvlStyles.progressFill, { width: `${Math.round(lvl.pctToNext * 100)}%` as any }]} />
        </View>
      )}

      {/* Breakdown bars */}
      <View style={lvlStyles.breakdownRow}>
        {lvl.breakdown.map((b) => {
          const pct = b.max > 0 ? (b.pts / b.max) * 100 : 0;
          return (
            <View key={b.label} style={lvlStyles.breakdownCol}>
              <View style={lvlStyles.breakdownBarTrack}>
                <View style={[lvlStyles.breakdownBarFill, { height: `${Math.max(4, pct)}%` as any }]} />
              </View>
              <Text style={lvlStyles.breakdownPts}>{b.pts}</Text>
              <Text style={lvlStyles.breakdownLabel}>{b.label}</Text>
            </View>
          );
        })}
      </View>
    </LinearGradient>
  );
}

const lvlStyles = StyleSheet.create({
  card: {
    borderRadius: 14, borderWidth: 1, borderColor: Colors.cyan + '25',
    padding: 16, marginBottom: 20,
  },
  topRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12,
  },
  levelCircle: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: Colors.cyan,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.cyan + '15',
  },
  levelNum: {
    fontSize: 20, fontWeight: '700', color: Colors.cyan,
  },
  titleCol: { flex: 1 },
  title: {
    fontSize: 16, fontWeight: '700', color: Colors.onSurface, letterSpacing: 0.3,
  },
  xpText: {
    fontSize: 11, color: Colors.outline, marginTop: 2,
  },
  progressTrack: {
    height: 4, backgroundColor: Colors.surfaceHighest,
    borderRadius: 2, overflow: 'hidden', marginBottom: 14,
  },
  progressFill: {
    height: '100%', borderRadius: 2, backgroundColor: Colors.cyan,
  },
  breakdownRow: {
    flexDirection: 'row', gap: 8,
  },
  breakdownCol: {
    flex: 1, alignItems: 'center',
  },
  breakdownBarTrack: {
    width: '100%', height: 32, backgroundColor: Colors.surfaceLow,
    borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end',
    marginBottom: 4,
  },
  breakdownBarFill: {
    width: '100%', borderRadius: 4, backgroundColor: Colors.cyan + '60',
  },
  breakdownPts: {
    fontSize: 10, fontWeight: '600', color: Colors.onSurfaceVariant,
  },
  breakdownLabel: {
    fontSize: 7, color: Colors.outline, letterSpacing: 1, fontWeight: '600', marginTop: 1,
  },
});

function AchievementBadges({ pbs, tableStats }: { pbs: PersonalBests; tableStats: TableStats }) {
  const { unlocked, locked, nextUp } = useMemo(() => {
    const unlocked: (Achievement & { idx: number })[] = [];
    const locked: (Achievement & { idx: number })[] = [];
    ACHIEVEMENTS.forEach((a, idx) => {
      if (a.check(pbs, tableStats)) unlocked.push({ ...a, idx });
      else locked.push({ ...a, idx });
    });
    // Next achievement to unlock (first locked one)
    const nextUp = locked.length > 0 ? locked[0] : null;
    return { unlocked, locked, nextUp };
  }, [pbs, tableStats]);

  return (
    <View>
      <View style={achStyles.header}>
        <Text style={achStyles.count}>
          {unlocked.length}<Text style={achStyles.countTotal}>/{ACHIEVEMENTS.length}</Text>
        </Text>
        <Text style={achStyles.countLabel}>UNLOCKED</Text>
      </View>

      {/* Unlocked badges */}
      <View style={achStyles.grid}>
        {unlocked.map((a) => (
          <LinearGradient
            key={a.id}
            colors={[`${a.color}18`, 'rgba(9,16,28,0.97)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[achStyles.badge, { borderColor: `${a.color}40` }]}
          >
            <MaterialIcons name={a.icon} size={20} color={a.color} />
            <Text style={[achStyles.badgeName, { color: a.color }]}>{a.name}</Text>
            <Text style={achStyles.badgeDesc}>{a.description}</Text>
          </LinearGradient>
        ))}
      </View>

      {/* Next up */}
      {nextUp && (
        <View style={achStyles.nextCard}>
          <View style={achStyles.nextLeft}>
            <MaterialIcons name={nextUp.icon} size={16} color={Colors.outline} />
            <View style={{ flex: 1 }}>
              <Text style={achStyles.nextLabel}>NEXT UP</Text>
              <Text style={achStyles.nextName}>{nextUp.name}</Text>
            </View>
          </View>
          <Text style={achStyles.nextDesc}>{nextUp.description}</Text>
        </View>
      )}

      {/* Locked (dimmed, smaller) */}
      {locked.length > 1 && (
        <View style={achStyles.lockedRow}>
          {locked.slice(1, 6).map((a) => (
            <View key={a.id} style={achStyles.lockedBadge}>
              <MaterialIcons name={a.icon} size={14} color={Colors.outline + '60'} />
              <Text style={achStyles.lockedName}>{a.name}</Text>
            </View>
          ))}
          {locked.length > 6 && (
            <Text style={achStyles.lockedMore}>+{locked.length - 6} more</Text>
          )}
        </View>
      )}
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const syncMutation = useTriggerSync();
  const { userSettings, setUserSettings } = useAppStore();
  const { data: pbs } = usePersonalBests();
  const { data: progression } = useDepthProgression(730); // 2 years
  const [tableHistory, setTableHistory] = useState<TableSessionRecord[]>([]);
  useEffect(() => { loadTableHistory().then(setTableHistory); }, []);
  const tableStats = useMemo(() => computeTableStats(tableHistory), [tableHistory]);

  // Compute PB milestones from depth progression
  const pbMilestones = useMemo(() => {
    if (!progression || progression.length < 2) return [];
    const sorted = [...progression].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const milestones: { date: string; depth: number; gain: number; sessionId: number; milestone: number | null }[] = [];
    let runningMax = 0;
    // Pre-defined depth milestones to flag
    const DEPTH_MILESTONES = [5, 10, 15, 20, 25, 30, 35, 40, 50, 60];
    const crossedMilestones = new Set<number>();
    for (const s of sorted) {
      if (s.max_depth_m > runningMax) {
        const gain = s.max_depth_m - runningMax;
        // Check which milestone was crossed
        let crossed: number | null = null;
        for (const m of DEPTH_MILESTONES) {
          if (s.max_depth_m >= m && runningMax < m && !crossedMilestones.has(m)) {
            crossed = m;
            crossedMilestones.add(m);
          }
        }
        runningMax = s.max_depth_m;
        milestones.push({
          date: s.date,
          depth: s.max_depth_m,
          gain,
          sessionId: s.session_id,
          milestone: crossed,
        });
      }
    }
    // Return newest first, limit to 15
    return milestones.reverse().slice(0, 15);
  }, [progression]);

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(userSettings.name);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState(
    userSettings.depthGoalM != null ? String(userSettings.depthGoalM) : ''
  );

  function saveName() {
    const trimmed = nameInput.trim();
    if (trimmed) setUserSettings({ name: trimmed });
    setEditingName(false);
  }

  function saveGoal() {
    const val = parseFloat(goalInput);
    setUserSettings({ depthGoalM: isNaN(val) || val <= 0 ? null : val });
    setEditingGoal(false);
  }

  function adjustGoal(delta: number) {
    const current = userSettings.depthGoalM ?? (pbs?.max_depth_m ? Math.ceil(pbs.max_depth_m / 5) * 5 : 20);
    const next = Math.max(5, Math.round((current + delta) / 5) * 5);
    setUserSettings({ depthGoalM: next });
    setGoalInput(String(next));
  }

  const pb = pbs?.max_depth_m ?? 0;
  const goal = userSettings.depthGoalM;
  const goalProgress = goal && goal > 0 ? Math.min(1, pb / goal) : null;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>FREEDIVER</Text>
        {editingName ? (
          <View style={styles.nameEditRow}>
            <TextInput
              style={styles.nameInput}
              value={nameInput}
              onChangeText={setNameInput}
              onSubmitEditing={saveName}
              onBlur={saveName}
              autoFocus
              returnKeyType="done"
              selectTextOnFocus
            />
            <TouchableOpacity onPress={saveName} style={styles.nameEditDone}>
              <MaterialIcons name="check" size={20} color={Colors.cyan} />
            </TouchableOpacity>
          </View>
        ) : (
          <Pressable onPress={() => { setNameInput(userSettings.name); setEditingName(true); }} style={styles.nameRow}>
            <Text style={styles.name}>{userSettings.name}</Text>
            <MaterialIcons name="edit" size={16} color={Colors.outline} style={{ marginLeft: 8, marginTop: 6 }} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Diver level */}
        {pbs && <DiverLevelCard pbs={pbs} tableStats={tableStats} />}

        {/* Depth goal */}
        <Text style={styles.sectionLabel}>DEPTH GOAL</Text>
        <GlassCard style={styles.goalCard}>
          {goal ? (
            <>
              <View style={styles.goalHeader}>
                <View>
                  <Text style={styles.goalValue}>
                    {pb.toFixed(1)}<Text style={styles.goalUnit}>m</Text>
                    <Text style={styles.goalSep}> / </Text>
                    <Text style={[styles.goalTarget, { color: Colors.cyan }]}>{goal}m</Text>
                  </Text>
                  <Text style={styles.goalSub}>Current PB → Target</Text>
                </View>
                <TouchableOpacity onPress={() => { setGoalInput(String(goal)); setEditingGoal(true); }}>
                  <MaterialIcons name="edit" size={18} color={Colors.outline} />
                </TouchableOpacity>
              </View>
              {/* Progress bar */}
              <View style={styles.goalTrack}>
                <View style={[styles.goalFill, { width: `${Math.round((goalProgress ?? 0) * 100)}%` as any }]} />
              </View>
              <Text style={styles.goalPct}>{Math.round((goalProgress ?? 0) * 100)}% of goal</Text>
            </>
          ) : editingGoal ? (
            <View style={styles.goalSetRow}>
              <TextInput
                style={styles.goalInput}
                value={goalInput}
                onChangeText={setGoalInput}
                keyboardType="numeric"
                placeholder="e.g. 25"
                placeholderTextColor={Colors.outline}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={saveGoal}
                onBlur={saveGoal}
              />
              <Text style={styles.goalInputUnit}>m</Text>
              <TouchableOpacity onPress={saveGoal} style={styles.goalSaveBtn}>
                <Text style={styles.goalSaveBtnText}>SET GOAL</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setEditingGoal(true)} style={styles.goalEmpty}>
              <MaterialIcons name="flag" size={22} color={Colors.outline} />
              <Text style={styles.goalEmptyText}>Set a depth goal</Text>
              <MaterialIcons name="add" size={18} color={Colors.cyan} />
            </TouchableOpacity>
          )}

          {/* Quick adjust stepper (shown when goal is set and not editing) */}
          {goal != null && !editingGoal && (
            <View style={styles.goalStepper}>
              <TouchableOpacity onPress={() => adjustGoal(-5)} style={styles.stepBtn}>
                <MaterialIcons name="remove" size={16} color={Colors.outline} />
              </TouchableOpacity>
              <Text style={styles.stepLabel}>adjust ±5m</Text>
              <TouchableOpacity onPress={() => adjustGoal(5)} style={styles.stepBtn}>
                <MaterialIcons name="add" size={16} color={Colors.cyan} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setUserSettings({ depthGoalM: null }); setGoalInput(''); }} style={[styles.stepBtn, { marginLeft: 8 }]}>
                <MaterialIcons name="close" size={14} color={Colors.error} />
              </TouchableOpacity>
            </View>
          )}
        </GlassCard>

        {/* Vanity stats */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>YOUR NUMBERS</Text>
        <VanityStats />

        {/* PB Milestones Timeline */}
        {pbMilestones.length >= 2 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 28 }]}>PB MILESTONES</Text>
            <GlassCard style={mlStyles.card}>
              <View style={mlStyles.header}>
                <MaterialIcons name="emoji-events" size={14} color="#facc15" />
                <Text style={mlStyles.headerText}>YOUR DEPTH JOURNEY</Text>
                <Text style={mlStyles.headerCount}>{pbMilestones.length} records</Text>
              </View>
              {pbMilestones.map((m, i) => {
                const d = new Date(m.date);
                const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
                const isFirst = i === 0; // most recent = current PB
                const isMilestone = m.milestone != null;
                return (
                  <Pressable
                    key={`${m.date}-${m.depth}`}
                    style={({ pressed }) => [mlStyles.row, pressed && { opacity: 0.7 }]}
                    onPress={() => router.push(`/session/${m.sessionId}` as any)}
                  >
                    {/* Timeline spine */}
                    <View style={mlStyles.spine}>
                      <View style={[
                        mlStyles.dot,
                        isMilestone && mlStyles.dotMilestone,
                        isFirst && mlStyles.dotCurrent,
                      ]}>
                        {isMilestone && (
                          <MaterialIcons name="star" size={8} color="#facc15" />
                        )}
                      </View>
                      {i < pbMilestones.length - 1 && <View style={mlStyles.line} />}
                    </View>
                    {/* Content */}
                    <View style={mlStyles.content}>
                      <View style={mlStyles.contentTop}>
                        <Text style={[mlStyles.depth, isFirst && { color: Colors.cyan }]}>
                          {m.depth.toFixed(1)}m
                        </Text>
                        {isMilestone && (
                          <View style={mlStyles.milestoneBadge}>
                            <Text style={mlStyles.milestoneText}>{m.milestone}m CLUB</Text>
                          </View>
                        )}
                        {isFirst && (
                          <View style={mlStyles.currentBadge}>
                            <Text style={mlStyles.currentText}>CURRENT PB</Text>
                          </View>
                        )}
                      </View>
                      <View style={mlStyles.contentBottom}>
                        <Text style={mlStyles.date}>{dateStr}</Text>
                        <Text style={mlStyles.gain}>+{m.gain.toFixed(1)}m</Text>
                      </View>
                    </View>
                    <MaterialIcons name="chevron-right" size={14} color={Colors.outline + '60'} />
                  </Pressable>
                );
              })}
            </GlassCard>
          </>
        )}

        {/* Achievement badges */}
        {pbs && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 28 }]}>ACHIEVEMENTS</Text>
            <AchievementBadges pbs={pbs} tableStats={tableStats} />
          </>
        )}

        {/* Garmin sync */}
        <Text style={[styles.sectionLabel, { marginTop: 28 }]}>GARMIN CONNECT</Text>
        <GlassCard style={styles.syncCard}>
          <View>
            <Text style={styles.connectedText}>● Connected</Text>
            <Text style={styles.connectedSub}>Syncing via garminconnect</Text>
          </View>
          <TouchableOpacity
            onPress={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            style={styles.syncBtn}
          >
            {syncMutation.isPending
              ? <ActivityIndicator size="small" color={Colors.bg} />
              : <Text style={styles.syncBtnText}>SYNC NOW</Text>}
          </TouchableOpacity>
        </GlassCard>
        {syncMutation.isSuccess && <Text style={styles.syncSuccess}>✓ Sync complete</Text>}
        {syncMutation.isError && <Text style={styles.syncError}>✗ Sync failed — check connection</Text>}

        {/* Analytics shortcut */}
        <Text style={[styles.sectionLabel, { marginTop: 28 }]}>DEEP ANALYTICS</Text>
        <TouchableOpacity onPress={() => router.push('/analytics')} style={styles.analyticsBtn}>
          <Text style={styles.analyticsBtnText}>Depth Progression · Plateaus · Locations →</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg, paddingTop: 56 },
  header: { paddingHorizontal: 20, marginBottom: 24 },
  eyebrow: { fontSize: 9, color: Colors.outline, letterSpacing: 3, marginBottom: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 32, fontWeight: '200', color: Colors.onSurface, letterSpacing: 1 },
  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: {
    fontSize: 28, fontWeight: '200', color: Colors.onSurface,
    borderBottomWidth: 1, borderBottomColor: Colors.cyan,
    flex: 1, paddingVertical: 2,
  },
  nameEditDone: { padding: 6 },
  scroll: { paddingHorizontal: 20, paddingBottom: 100 },
  sectionLabel: { fontSize: 10, color: Colors.outline, letterSpacing: 2, marginBottom: 12, fontWeight: '700' },

  // Goal card
  goalCard: { padding: 16 },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  goalValue: { fontSize: 28, fontWeight: '700', color: Colors.onSurface },
  goalUnit: { fontSize: 16, fontWeight: '400', color: Colors.onSurfaceVariant },
  goalSep: { fontSize: 18, color: Colors.outline },
  goalTarget: { fontSize: 28, fontWeight: '700' },
  goalSub: { fontSize: 10, color: Colors.outline, letterSpacing: 1, marginTop: 2 },
  goalTrack: { height: 4, backgroundColor: Colors.surfaceHighest, borderRadius: 2, overflow: 'hidden', marginBottom: 6 },
  goalFill: { height: '100%', backgroundColor: Colors.cyan, borderRadius: 2 },
  goalPct: { fontSize: 10, color: Colors.primaryDim, letterSpacing: 1 },
  goalEmpty: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  goalEmptyText: { fontSize: 14, color: Colors.outline, flex: 1 },
  goalSetRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  goalInput: {
    fontSize: 24, color: Colors.onSurface, borderBottomWidth: 1,
    borderBottomColor: Colors.cyan, width: 80, paddingVertical: 2,
  },
  goalInputUnit: { fontSize: 16, color: Colors.onSurfaceVariant },
  goalSaveBtn: {
    backgroundColor: Colors.cyan + '20', borderWidth: 1, borderColor: Colors.cyan,
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  goalSaveBtnText: { fontSize: 11, fontWeight: '700', color: Colors.cyan, letterSpacing: 1 },
  goalStepper: { flexDirection: 'row', alignItems: 'center', marginTop: 12, borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '30', paddingTop: 10 },
  stepBtn: { padding: 6, borderRadius: 6, borderWidth: 1, borderColor: Colors.outlineVariant + '40' },
  stepLabel: { flex: 1, textAlign: 'center', fontSize: 10, color: Colors.outline, letterSpacing: 1 },

  // Sync
  syncCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  connectedText: { fontSize: 13, color: '#4ade80', fontWeight: '600' },
  connectedSub: { fontSize: 11, color: Colors.outline, marginTop: 2 },
  syncBtn: {
    backgroundColor: Colors.cyan, paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 10, minWidth: 110, alignItems: 'center',
  },
  syncBtnText: { fontSize: 12, fontWeight: '700', color: Colors.bg, letterSpacing: 1 },
  syncSuccess: { fontSize: 12, color: '#4ade80', marginTop: 8 },
  syncError: { fontSize: 12, color: Colors.error, marginTop: 8 },

  // Analytics
  analyticsBtn: {
    backgroundColor: Colors.surfaceLow, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 18, alignItems: 'center',
  },
  analyticsBtnText: { fontSize: 13, color: Colors.cyan },
});

const mlStyles = StyleSheet.create({
  card: { padding: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  headerText: { fontSize: 10, fontWeight: '800', letterSpacing: 2, color: '#facc15', flex: 1 },
  headerCount: { fontSize: 9, color: Colors.outline, letterSpacing: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
  },
  spine: { alignItems: 'center', width: 20 },
  dot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: Colors.surfaceHighest,
    borderWidth: 2, borderColor: Colors.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 1,
  },
  dotMilestone: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#facc15' + '30',
    borderColor: '#facc15',
  },
  dotCurrent: {
    backgroundColor: Colors.cyan + '30',
    borderColor: Colors.cyan,
  },
  line: {
    width: 2, flex: 1, minHeight: 10,
    backgroundColor: Colors.outlineVariant + '40',
    marginTop: -1,
  },
  content: { flex: 1 },
  contentTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  depth: { fontSize: 16, fontWeight: '700', color: Colors.onSurface },
  milestoneBadge: {
    backgroundColor: '#facc15' + '18', borderWidth: 1, borderColor: '#facc15' + '40',
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1,
  },
  milestoneText: { fontSize: 7, fontWeight: '700', color: '#facc15', letterSpacing: 1 },
  currentBadge: {
    backgroundColor: Colors.cyan + '18', borderWidth: 1, borderColor: Colors.cyan + '40',
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1,
  },
  currentText: { fontSize: 7, fontWeight: '700', color: Colors.cyan, letterSpacing: 1 },
  contentBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  date: { fontSize: 10, color: Colors.outline, letterSpacing: 0.5 },
  gain: { fontSize: 10, color: '#4ade80', fontWeight: '600' },
});

const achStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 14 },
  count: { fontSize: 28, fontWeight: '700', color: Colors.cyan },
  countTotal: { fontSize: 16, fontWeight: '400', color: Colors.outline },
  countLabel: { fontSize: 9, color: Colors.outline, letterSpacing: 2, fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: {
    width: '47%', borderRadius: 14, borderWidth: 1,
    padding: 14, alignItems: 'center', gap: 6,
  },
  badgeName: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center' },
  badgeDesc: { fontSize: 9, color: Colors.outline, textAlign: 'center', letterSpacing: 0.5 },

  nextCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surfaceLow, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.outlineVariant + '30',
    borderStyle: 'dashed', padding: 12, marginTop: 12,
  },
  nextLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  nextLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 2, fontWeight: '700' },
  nextName: { fontSize: 12, color: Colors.onSurfaceVariant, fontWeight: '600' },
  nextDesc: { fontSize: 10, color: Colors.outline, textAlign: 'right' },

  lockedRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '20',
  },
  lockedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 6, borderWidth: 1, borderColor: Colors.outlineVariant + '25',
    paddingHorizontal: 8, paddingVertical: 5,
  },
  lockedName: { fontSize: 9, color: Colors.outline + '80', letterSpacing: 0.5 },
  lockedMore: { fontSize: 9, color: Colors.outline, alignSelf: 'center', marginLeft: 4 },
});
