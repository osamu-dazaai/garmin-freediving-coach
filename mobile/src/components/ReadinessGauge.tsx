import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import Animated, {
  useSharedValue,
  useDerivedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Colors } from '../constants/colors';

interface Props {
  score: number;
  level: string;
  size?: number;
}

function gaugeColor(score: number): string {
  if (score >= 80) return Colors.cyan;
  if (score >= 60) return Colors.blue;
  return Colors.red;
}

export function ReadinessGauge({ score, level, size = 180 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;
  const strokeWidth = size * 0.028;

  const color = gaugeColor(score);
  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = withTiming(score / 100, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [score]);

  const animatedEnd = useDerivedValue(() => progress.value);

  const circumference = 2 * Math.PI * r;

  // Background arc
  const bgPath = Skia.Path.Make();
  bgPath.addCircle(cx, cy, r);

  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }}>
      <Canvas style={{ width: size, height: size }}>
        {/* Track */}
        <Path
          path={bgPath}
          style="stroke"
          strokeWidth={strokeWidth}
          color="rgba(255,255,255,0.07)"
          start={0}
          end={1}
        />
        {/* Fill arc */}
        <Path
          path={bgPath}
          style="stroke"
          strokeWidth={strokeWidth}
          color={color}
          start={0}
          end={animatedEnd}
          strokeCap="square"
        />
      </Canvas>
      {/* Center text overlay */}
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text style={styles.label}>READINESS</Text>
        <Text style={[styles.score, { color }]}>{score}</Text>
        <Text style={[styles.level, { color }]}>{level}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 9, color: Colors.textFaint, letterSpacing: 2, textTransform: 'uppercase' },
  score: { fontSize: 44, fontWeight: '300', lineHeight: 52 },
  level: { fontSize: 9, letterSpacing: 2, fontWeight: '700', textTransform: 'uppercase' },
});
