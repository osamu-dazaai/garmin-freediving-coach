import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';
import { usePersonalBests } from '../api/analytics';
import { fmtDepth, fmtSeconds } from '../utils/formatters';

type Period = { label: string; since: string | undefined; until?: string };

const PERIODS: Period[] = [
  { label: 'All Time', since: undefined },
  { label: 'This Year', since: new Date().getFullYear() + '-01-01' },
  { label: 'Last 6M', since: sixMonthsAgo() },
  { label: 'Last 90d', since: daysAgo(90) },
  { label: 'Last 30d', since: daysAgo(30) },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function sixMonthsAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}

function fmtHours(s: number): string {
  const h = s / 3600;
  if (h >= 1) return `${h.toFixed(1)}h`;
  return fmtSeconds(s);
}

export function VanityStats() {
  const [selectedPeriod, setSelectedPeriod] = useState(0);
  const period = PERIODS[selectedPeriod];
  const { data: pbs, isLoading } = usePersonalBests(period.since, period.until);

  const isFiltered = selectedPeriod > 0;
  const sessions = isFiltered ? (pbs?.window_sessions ?? 0) : (pbs?.total_sessions ?? 0);
  const bottomTime = isFiltered ? (pbs?.window_bottom_time_s ?? 0) : (pbs?.total_bottom_time_s ?? 0);
  const depthDescended = isFiltered ? (pbs?.window_depth_descended_m ?? 0) : (pbs?.total_depth_descended_m ?? 0);

  return (
    <View>
      {/* Period filter chips */}
      <View style={styles.chipRow}>
        {PERIODS.map((p, i) => (
          <TouchableOpacity
            key={p.label}
            onPress={() => setSelectedPeriod(i)}
            style={[styles.chip, i === selectedPeriod && styles.chipActive]}
          >
            <Text style={[styles.chipText, i === selectedPeriod && styles.chipTextActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.cyan} style={{ marginTop: 16 }} />
      ) : (
        <View style={styles.grid}>
          <VanityCard
            label="Sessions"
            value={String(sessions)}
            sub={isFiltered ? period.label : 'lifetime'}
            color={Colors.cyan}
            index={0}
          />
          <VanityCard
            label="Time Underwater"
            value={fmtHours(bottomTime)}
            sub={isFiltered ? period.label : 'lifetime'}
            color={Colors.blue}
            index={1}
          />
          <VanityCard
            label="Depth Descended"
            value={`${Math.round(depthDescended)}m`}
            sub={isFiltered ? period.label : 'lifetime'}
            color="#9b7fff"
            index={2}
          />
          <VanityCard
            label="PB Depth"
            value={fmtDepth(pbs?.max_depth_m ?? 0)}
            sub={pbs?.max_depth_date ?? ''}
            color={Colors.cyan}
            index={3}
          />
          <VanityCard
            label="Best Hold Time"
            value={fmtSeconds(pbs?.max_bottom_time_s ?? 0)}
            sub={pbs?.max_bottom_time_date ?? ''}
            color="#4ade80"
            index={4}
          />
        </View>
      )}
    </View>
  );
}

function VanityCard({ label, value, sub, color, index }: {
  label: string; value: string; sub: string; color: string; index: number;
}) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.92);

  React.useEffect(() => {
    opacity.value = withDelay(index * 60, withTiming(1, { duration: 350, easing: Easing.out(Easing.quad) }));
    scale.value = withDelay(index * 60, withTiming(1, { duration: 350, easing: Easing.out(Easing.back(1.1)) }));
  }, [value]);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[anim, styles.cardWrap]}>
      <LinearGradient
        colors={[`${color}18`, 'rgba(9,16,28,0.97)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, { borderColor: `${color}30` }]}
      >
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={[styles.cardValue, { color }]}>{value}</Text>
        <Text style={styles.cardSub}>{sub}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
    borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  chipActive: { borderColor: Colors.cyan, backgroundColor: 'rgba(0,240,255,0.1)' },
  chipText: { fontSize: 11, color: Colors.textMuted },
  chipTextActive: { color: Colors.cyan },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cardWrap: { width: '47.5%' },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  cardLabel: { fontSize: 9, color: Colors.textFaint, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 },
  cardValue: { fontSize: 26, fontWeight: '300', marginBottom: 4 },
  cardSub: { fontSize: 10, color: Colors.textFaint },
});
