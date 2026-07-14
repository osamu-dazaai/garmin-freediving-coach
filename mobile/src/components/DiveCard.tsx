import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { fmtDepth, fmtSeconds, fmtDate } from '../utils/formatters';
import type { Session } from '../api/sessions';

interface Props {
  session: Session;
  onPress?: () => void;
  pbDepthM?: number; // personal best depth — if provided, shows % of PB context
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;
  return '';
}

/** Depth → accent opacity (0.15 for shallow, 0.50 for deep) */
function depthAccent(depthM: number): number {
  if (depthM <= 0) return 0;
  // Scale: 5m → 0.15, 15m → 0.30, 30m+ → 0.50
  return Math.min(0.50, 0.10 + depthM * 0.013);
}

export function DiveCard({ session, onPress, pbDepthM }: Props) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const d = session.dive;
  const accent = depthAccent(d.max_depth_m);
  const relative = relativeTime(session.start_time);
  const pbPct = pbDepthM && pbDepthM > 0 && !session.is_pb
    ? Math.round((d.max_depth_m / pbDepthM) * 100)
    : null;

  // Session intensity classification
  const intensity = (() => {
    if (session.is_pb) return null; // PB badge takes priority
    if (!pbDepthM || pbDepthM <= 0) return null;
    const pct = d.max_depth_m / pbDepthM;
    if (pct >= 0.9) return { label: 'MAX', color: '#f87171', icon: 'whatshot' as const };
    if (pct >= 0.7) return { label: 'WORKING', color: Colors.cyan, icon: 'fitness-center' as const };
    return { label: 'LIGHT', color: Colors.textFaint, icon: 'spa' as const };
  })();

  return (
    <Pressable
      onPressIn={() => { scale.value = withTiming(0.97, { duration: 100 }); }}
      onPressOut={() => { scale.value = withTiming(1, { duration: 150 }); }}
      onPress={onPress}
    >
      <Animated.View style={animStyle}>
        <LinearGradient
          colors={session.is_pb ? ['rgba(0,240,255,0.12)', 'rgba(9,16,28,0.95)'] : Colors.gradientCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.card, session.is_pb && styles.pbCard]}
        >
          {/* Depth-intensity left accent bar */}
          <View style={[styles.accentBar, {
            backgroundColor: session.is_pb ? Colors.cyan : `rgba(0,240,255,${accent})`,
          }]} />

          {session.is_pb && (
            <View style={styles.pbBadge}>
              <MaterialIcons name="emoji-events" size={9} color={Colors.bg} />
              <Text style={styles.pbText}>PERSONAL BEST</Text>
            </View>
          )}

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.loc}>{d.location_name.toUpperCase()}</Text>
              <View style={styles.dateRow}>
                <Text style={styles.date}>{fmtDate(session.start_time)}</Text>
                {relative !== '' && (
                  <Text style={styles.relative}> · {relative}</Text>
                )}
              </View>
            </View>
            <View style={styles.depthCol}>
              <Text style={[styles.depth, session.is_pb && { color: Colors.cyan }]}>
                {fmtDepth(d.max_depth_m)}
              </Text>
              {pbPct != null ? (
                <Text style={[styles.depthLabel, pbPct >= 90 && { color: Colors.cyan }]}>
                  {pbPct}% of PB
                </Text>
              ) : (
                <Text style={styles.depthLabel}>MAX DEPTH</Text>
              )}
            </View>
          </View>

          <View style={styles.statsRow}>
            <Stat label="Dives" value={d.dive_count ? String(d.dive_count) : '—'} />
            <Stat label="Bottom Time" value={fmtSeconds(d.bottom_time_s ?? 0)} />
            <Stat label="Max BT" value={fmtSeconds(d.max_bottom_time_s ?? 0)} />
            {session.duration_s != null && session.duration_s > 0 && (
              <Stat label="Duration" value={fmtSeconds(session.duration_s)} />
            )}
            {session.avg_hr ? <Stat label="Avg HR" value={`${Math.round(session.avg_hr)}`} unit="bpm" /> : null}
          </View>

          {/* Bottom row: water temp + intensity + contextual badges */}
          {(d.water_temp_c != null || intensity != null) && (
            <View style={styles.bottomRow}>
              {d.water_temp_c != null && (
                <View style={styles.tempBadge}>
                  <MaterialIcons name="thermostat" size={10} color={Colors.cyan} />
                  <Text style={styles.tempText}>{d.water_temp_c.toFixed(1)}°C</Text>
                </View>
              )}
              {intensity != null && (
                <View style={[styles.intensityBadge, { borderColor: intensity.color + '40' }]}>
                  <MaterialIcons name={intensity.icon} size={9} color={intensity.color} />
                  <Text style={[styles.intensityText, { color: intensity.color }]}>{intensity.label}</Text>
                </View>
              )}
            </View>
          )}
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    paddingLeft: 20,
    marginBottom: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  pbCard: { borderColor: 'rgba(0,240,255,0.3)' },

  // Depth-intensity left accent bar
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },

  pbBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.cyan,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 8,
  },
  pbText: { fontSize: 9, fontWeight: '700', color: Colors.bg, letterSpacing: 1 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  loc: { fontSize: 11, color: Colors.textMuted, letterSpacing: 1.5, fontWeight: '600' },
  dateRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  date: { fontSize: 12, color: Colors.textFaint },
  relative: { fontSize: 11, color: Colors.textFaint },

  depthCol: { alignItems: 'flex-end' },
  depth: { fontSize: 28, fontWeight: '300', color: Colors.textPrimary },
  depthLabel: { fontSize: 9, color: Colors.textFaint, letterSpacing: 1.5 },

  statsRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  stat: {},
  statLabel: { fontSize: 9, color: Colors.textFaint, letterSpacing: 1, textTransform: 'uppercase' },
  statValue: { fontSize: 13, color: Colors.textMuted, fontWeight: '500', marginTop: 2 },
  statUnit: { fontSize: 10, fontWeight: '400', color: Colors.textFaint },

  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  tempBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,240,255,0.08)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tempText: { fontSize: 10, color: Colors.cyan, fontWeight: '600', letterSpacing: 0.5 },
  intensityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  intensityText: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
});
