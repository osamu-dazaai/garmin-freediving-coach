import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { GlassCard } from './GlassCard';
import { Colors } from '../../constants/colors';

interface Props {
  label: string;
  value: string | number | null;
  unit?: string;
  color?: string;
  barPct?: number;  // 0–100
  index?: number;   // for stagger animation
}

export function MetricCard({ label, value, unit, color = Colors.cyan, barPct = 0, index = 0 }: Props) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  React.useEffect(() => {
    opacity.value = withDelay(index * 80, withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) }));
    translateY.value = withDelay(index * 80, withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const barWidth = useSharedValue(0);
  React.useEffect(() => {
    barWidth.value = withDelay(index * 80 + 300, withTiming(barPct, { duration: 600, easing: Easing.out(Easing.cubic) }));
  }, [barPct]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${barWidth.value}%` as any,
  }));

  const display = value !== null && value !== undefined ? String(value) : '—';

  return (
    <Animated.View style={[animStyle, styles.wrapper]}>
      <GlassCard style={styles.card}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.valueRow}>
          <Text style={[styles.value, { color }]}>{display}</Text>
          {unit && <Text style={styles.unit}>{unit}</Text>}
        </View>
        <View style={styles.barBg}>
          <Animated.View style={[styles.bar, { backgroundColor: color }, barStyle]} />
        </View>
      </GlassCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, minWidth: '47%' },
  card: { padding: 14 },
  label: { fontSize: 10, color: Colors.textFaint, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3, marginBottom: 8 },
  value: { fontSize: 26, fontWeight: '300' },
  unit: { fontSize: 12, color: Colors.textMuted },
  barBg: { height: 2, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' },
  bar: { height: 2, borderRadius: 2 },
});
