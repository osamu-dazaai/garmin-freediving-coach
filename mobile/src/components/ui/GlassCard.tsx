import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '../../constants/colors';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'glass' | 'surface' | 'surface-high' | 'lowest';
  accentBorder?: string;
  noPad?: boolean;
}

export function GlassCard({
  children,
  style,
  variant = 'glass',
  accentBorder,
  noPad = false,
}: Props) {
  const bg = {
    glass: Colors.glass,
    surface: Colors.surface,
    'surface-high': Colors.surfaceHigh,
    lowest: Colors.surfaceLowest,
  }[variant];

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: bg },
        accentBorder ? { borderColor: accentBorder, borderWidth: 1 } : null,
        noPad ? { padding: 0 } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: 16,
    overflow: 'hidden',
  },
});
