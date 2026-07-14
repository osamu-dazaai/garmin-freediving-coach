import { useEffect, useMemo, useState, useRef } from 'react';
import {
  View, Text, SectionList, StyleSheet, TouchableOpacity,
  RefreshControl, TextInput, Pressable, Keyboard,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../src/constants/colors';
import { useSessions } from '../../src/api/sessions';
import type { Session } from '../../src/api/sessions';
import { usePersonalBests } from '../../src/api/analytics';
import { DiveCard } from '../../src/components/DiveCard';
import { fmtDepth, fmtSeconds } from '../../src/utils/formatters';

type Filter = 'all' | 'month' | '3months' | 'deep';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',     label: 'All Time'    },
  { key: 'month',   label: 'This Month'  },
  { key: '3months', label: 'Last 3M'     },
  { key: 'deep',    label: '10m+ Dives'  },
];

interface MonthSection {
  title: string;
  sessionCount: number;
  maxDepth: number;
  pbInMonth: boolean;
  data: Session[];
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function groupByMonth(sessions: Session[]): MonthSection[] {
  const map = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = monthLabel(s.start_time);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return Array.from(map.entries()).map(([title, data]) => ({
    title,
    sessionCount: data.length,
    maxDepth: Math.max(...data.map((s) => s.dive.max_depth_m)),
    pbInMonth: data.some((s) => s.is_pb),
    data,
  }));
}

function filterByQuery(sessions: Session[], query: string): Session[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) =>
    s.dive.location_name.toLowerCase().includes(q)
  );
}

export default function LogScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { location: locationParam } = useLocalSearchParams<{ location?: string }>();
  const [filter, setFilter] = useState<Filter>('all');
  const [sortBy, setSortBy] = useState<'date' | 'depth'>('date');
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<TextInput>(null);

  // Pre-fill search when navigated from analytics location tap
  useEffect(() => {
    if (locationParam) setQuery(locationParam);
  }, [locationParam]);

  const { data: sessions, isLoading, refetch } = useSessions(200, filter);
  const { data: pbs } = usePersonalBests();

  const filtered = useMemo(
    () => filterByQuery(sessions ?? [], query),
    [sessions, query]
  );
  const sections = useMemo(() => {
    if (sortBy === 'depth') {
      const sorted = [...filtered].sort((a, b) => b.dive.max_depth_m - a.dive.max_depth_m);
      return [{
        title: `All Sessions`,
        sessionCount: sorted.length,
        maxDepth: sorted.length > 0 ? sorted[0].dive.max_depth_m : 0,
        pbInMonth: sorted.some((s) => s.is_pb),
        data: sorted,
      }];
    }
    return groupByMonth(filtered);
  }, [filtered, sortBy]);

  const isSearching = query.trim().length > 0;

  // ── Consistency & momentum ────────────────────────────────────────────────
  const momentum = useMemo(() => {
    if (!sessions || sessions.length < 2) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Weekly streak: how many consecutive weeks (Mon-Sun) have at least 1 session?
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const thisMonday = new Date(now);
    thisMonday.setDate(thisMonday.getDate() + mondayOffset);

    // Check up to 52 weeks back
    let streak = 0;
    for (let w = 0; w < 52; w++) {
      const weekStart = new Date(thisMonday);
      weekStart.setDate(weekStart.getDate() - w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const hasSession = sessions.some((s) => {
        const d = new Date(s.start_time);
        return d >= weekStart && d < weekEnd;
      });
      if (hasSession) streak++;
      else break;
    }

    // This month vs last month
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

    const thisMonthSessions = sessions.filter((s) => {
      const d = new Date(s.start_time);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const lastMonthSessions = sessions.filter((s) => {
      const d = new Date(s.start_time);
      return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear;
    });

    const thisCount = thisMonthSessions.length;
    const lastCount = lastMonthSessions.length;
    const thisBest = thisMonthSessions.length > 0
      ? Math.max(...thisMonthSessions.map((s) => s.dive.max_depth_m))
      : 0;
    const lastBest = lastMonthSessions.length > 0
      ? Math.max(...lastMonthSessions.map((s) => s.dive.max_depth_m))
      : 0;
    const countDelta = thisCount - lastCount;
    const depthDelta = thisBest - lastBest;

    // Days since last session
    const lastSession = sessions[0];
    const daysSince = Math.floor(
      (now.getTime() - new Date(lastSession.start_time).getTime()) / 86400000
    );

    return { streak, thisCount, lastCount, countDelta, thisBest, lastBest, depthDelta, daysSince };
  }, [sessions]);

  // Aggregate stats for the filtered view
  const filterStats = useMemo(() => {
    if (!filtered || filtered.length === 0) return null;
    const count = filtered.length;
    const bestDepth = Math.max(...filtered.map((s) => s.dive.max_depth_m));
    const avgDepth = filtered.reduce((s, x) => s + x.dive.max_depth_m, 0) / count;
    const totalBtS = filtered.reduce((s, x) => s + (x.dive.bottom_time_s ?? 0), 0);
    const totalDives = filtered.reduce((s, x) => s + (x.dive.dive_count ?? 1), 0);
    const pbCount = filtered.filter((s) => s.is_pb).length;
    return { count, bestDepth, avgDepth, totalBtS, totalDives, pbCount };
  }, [filtered]);

  function clearSearch() {
    setQuery('');
    Keyboard.dismiss();
  }

  return (
    <Pressable style={styles.root} onPress={Keyboard.dismiss}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>DIVE LOG</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={styles.count}>
            {isSearching
              ? `${filtered.length} of ${sessions?.length ?? 0}`
              : `${sessions?.length ?? 0} sessions`}
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/external-divers' as any)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: 0.7 }}
          >
            <MaterialIcons name="group" size={16} color={Colors.cyan} />
            <Text style={{ color: Colors.cyan, fontSize: 11, fontWeight: '600' }}>DIVERS</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search bar */}
      <View style={[styles.searchWrap, searchFocused && styles.searchWrapFocused]}>
        <MaterialIcons name="search" size={18} color={searchFocused ? Colors.cyan : Colors.outline} />
        <TextInput
          ref={searchRef}
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by location..."
          placeholderTextColor={Colors.outline}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          returnKeyType="search"
          clearButtonMode="never"
        />
        {isSearching && (
          <TouchableOpacity onPress={clearSearch} hitSlop={8}>
            <MaterialIcons name="close" size={16} color={Colors.outline} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter chips + sort toggle — hidden while actively searching */}
      {!isSearching && (
        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.chip, filter === f.key && styles.chipActive]}
            >
              <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={() => setSortBy((s) => s === 'date' ? 'depth' : 'date')}
            style={[styles.sortBtn, sortBy === 'depth' && styles.sortBtnActive]}
          >
            <MaterialIcons
              name={sortBy === 'depth' ? 'sort' : 'schedule'}
              size={13}
              color={sortBy === 'depth' ? Colors.cyan : Colors.outline}
            />
            <Text style={[styles.sortBtnText, sortBy === 'depth' && styles.sortBtnTextActive]}>
              {sortBy === 'depth' ? 'DEPTH' : 'DATE'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Filter stats summary */}
      {filterStats && filtered.length > 1 && (
        <View style={styles.statsBar}>
          <View style={styles.statsCell}>
            <Text style={styles.statsValue}>{filterStats.totalDives}</Text>
            <Text style={styles.statsLabel}>DIVES</Text>
          </View>
          <View style={styles.statsDivider} />
          <View style={styles.statsCell}>
            <Text style={[styles.statsValue, { color: Colors.cyan }]}>{fmtDepth(filterStats.bestDepth)}</Text>
            <Text style={styles.statsLabel}>BEST</Text>
          </View>
          <View style={styles.statsDivider} />
          <View style={styles.statsCell}>
            <Text style={styles.statsValue}>{fmtDepth(filterStats.avgDepth)}</Text>
            <Text style={styles.statsLabel}>AVG</Text>
          </View>
          <View style={styles.statsDivider} />
          <View style={styles.statsCell}>
            <Text style={styles.statsValue}>{Math.round(filterStats.totalBtS / 60)}<Text style={styles.statsUnit}>m</Text></Text>
            <Text style={styles.statsLabel}>UNDERWATER</Text>
          </View>
          {filterStats.pbCount > 0 && (
            <>
              <View style={styles.statsDivider} />
              <View style={styles.statsCell}>
                <Text style={[styles.statsValue, { color: '#facc15' }]}>{filterStats.pbCount}</Text>
                <Text style={styles.statsLabel}>PBs</Text>
              </View>
            </>
          )}
        </View>
      )}

      <SectionList
        sections={sections}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={!isSearching && sortBy === 'date'}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={!isSearching && momentum && filter === 'all' && sortBy === 'date' ? (
          <View style={momStyles.card}>
            <View style={momStyles.topRow}>
              {/* Streak */}
              <View style={momStyles.streakCol}>
                <View style={momStyles.streakCircle}>
                  <Text style={momStyles.streakNum}>{momentum.streak}</Text>
                </View>
                <Text style={momStyles.streakLabel}>WEEK STREAK</Text>
              </View>

              {/* This month vs last */}
              <View style={momStyles.vsCol}>
                <Text style={momStyles.vsTitle}>THIS MONTH</Text>
                <View style={momStyles.vsRow}>
                  <View style={momStyles.vsStat}>
                    <Text style={momStyles.vsValue}>{momentum.thisCount}</Text>
                    <Text style={momStyles.vsSub}>sessions</Text>
                  </View>
                  <View style={momStyles.vsStat}>
                    <Text style={momStyles.vsValue}>{momentum.thisBest > 0 ? fmtDepth(momentum.thisBest) : '—'}</Text>
                    <Text style={momStyles.vsSub}>best depth</Text>
                  </View>
                </View>
                {momentum.lastCount > 0 && (
                  <View style={momStyles.deltaRow}>
                    <MaterialIcons
                      name={momentum.countDelta >= 0 ? 'trending-up' : 'trending-down'}
                      size={11}
                      color={momentum.countDelta >= 0 ? '#4ade80' : Colors.orange}
                    />
                    <Text style={[momStyles.deltaText, {
                      color: momentum.countDelta >= 0 ? '#4ade80' : Colors.orange,
                    }]}>
                      {momentum.countDelta >= 0 ? '+' : ''}{momentum.countDelta} sessions
                    </Text>
                    {momentum.depthDelta !== 0 && (
                      <Text style={[momStyles.deltaText, {
                        color: momentum.depthDelta >= 0 ? '#4ade80' : Colors.orange,
                      }]}>
                        {' · '}{momentum.depthDelta >= 0 ? '+' : ''}{momentum.depthDelta.toFixed(1)}m depth
                      </Text>
                    )}
                    <Text style={momStyles.deltaVs}> vs last month</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Nudge if stale */}
            {momentum.daysSince >= 4 && (
              <View style={momStyles.nudgeRow}>
                <MaterialIcons name="notifications-active" size={11} color={Colors.orange} />
                <Text style={momStyles.nudgeText}>
                  {momentum.daysSince}d since last session — get back in the water!
                </Text>
              </View>
            )}
          </View>
        ) : null}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => { qc.invalidateQueries({ queryKey: ['sessions'] }); refetch(); }}
            tintColor={Colors.cyan}
          />
        }
        renderSectionHeader={({ section }) =>
          isSearching ? null : sortBy === 'depth' ? (
            <View style={styles.sectionHeader}>
              <View style={styles.sectionLeft}>
                <Text style={styles.sectionMonth}>Sorted by Depth</Text>
                <Text style={styles.sectionMeta}>
                  {section.sessionCount} session{section.sessionCount !== 1 ? 's' : ''}
                  {'  ·  '}deepest{' '}
                  <Text style={{ color: Colors.cyan }}>{fmtDepth(section.maxDepth)}</Text>
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.sectionHeader}>
              <View style={styles.sectionLeft}>
                <Text style={styles.sectionMonth}>{section.title}</Text>
                <Text style={styles.sectionMeta}>
                  {section.sessionCount} session{section.sessionCount !== 1 ? 's' : ''}
                  {'  ·  '}best{' '}
                  <Text style={{ color: Colors.cyan }}>{fmtDepth(section.maxDepth)}</Text>
                </Text>
              </View>
              {section.pbInMonth && (
                <View style={styles.pbChip}>
                  <MaterialIcons name="emoji-events" size={10} color={Colors.bg} />
                  <Text style={styles.pbChipText}>PB</Text>
                </View>
              )}
            </View>
          )
        }
        renderItem={({ item }) => (
          <DiveCard
            session={item}
            pbDepthM={pbs?.max_depth_m}
            onPress={() => router.push(`/session/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          !isLoading ? (
            isSearching ? (
              <View style={styles.emptyState}>
                <MaterialIcons name="search-off" size={36} color={Colors.outline} />
                <Text style={styles.emptyTitle}>No results for "{query}"</Text>
                <TouchableOpacity onPress={clearSearch}>
                  <Text style={styles.emptyClear}>Clear search</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <MaterialIcons name="water" size={40} color={Colors.outline} />
                <Text style={styles.emptyTitle}>No sessions found</Text>
                <Text style={styles.emptySub}>Sync with Garmin Connect to import dives</Text>
              </View>
            )
          ) : null
        }
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg, paddingTop: 56 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, marginBottom: 10,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.onSurface, letterSpacing: 2 },
  count: { fontSize: 12, color: Colors.outline },

  // Search bar
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 10,
    backgroundColor: Colors.surfaceHigh, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.outlineVariant + '40',
    paddingHorizontal: 12, paddingVertical: 9,
  },
  searchWrapFocused: { borderColor: Colors.cyan + '60' },
  searchInput: { flex: 1, fontSize: 14, color: Colors.onSurface },

  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 8 },
  statsBar: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 20, marginBottom: 10,
    backgroundColor: Colors.surfaceHigh, borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 4,
  },
  statsCell: { flex: 1, alignItems: 'center' },
  statsValue: { fontSize: 14, fontWeight: '700', color: Colors.onSurface },
  statsUnit: { fontSize: 10, fontWeight: '400', color: Colors.outline },
  statsLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1, fontWeight: '600', marginTop: 1 },
  statsDivider: { width: 1, height: 20, backgroundColor: Colors.outlineVariant + '30' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.outlineVariant + '60',
    backgroundColor: Colors.surfaceLow,
  },
  chipActive: { borderColor: Colors.cyan, backgroundColor: Colors.cyan + '15' },
  chipText: { fontSize: 11, color: Colors.outline, letterSpacing: 0.5 },
  chipTextActive: { color: Colors.cyan, fontWeight: '600' },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.outlineVariant + '60',
    backgroundColor: Colors.surfaceLow,
  },
  sortBtnActive: { borderColor: Colors.cyan + '60', backgroundColor: Colors.cyan + '10' },
  sortBtnText: { fontSize: 9, color: Colors.outline, fontWeight: '700', letterSpacing: 1 },
  sortBtnTextActive: { color: Colors.cyan },

  list: { paddingHorizontal: 20, paddingBottom: 100 },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.bg,
    paddingTop: 18, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant + '25',
    marginBottom: 10,
  },
  sectionLeft: { flex: 1 },
  sectionMonth: { fontSize: 13, fontWeight: '700', color: Colors.onSurface, letterSpacing: 0.5 },
  sectionMeta: { fontSize: 11, color: Colors.outline, marginTop: 1 },
  pbChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.cyan, borderRadius: 4,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  pbChipText: { fontSize: 9, fontWeight: '700', color: Colors.bg, letterSpacing: 0.5 },

  emptyState: { alignItems: 'center', marginTop: 60, gap: 10 },
  emptyTitle: { fontSize: 15, color: Colors.onSurfaceVariant, fontWeight: '600' },
  emptySub: { fontSize: 12, color: Colors.outline, textAlign: 'center' },
  emptyClear: { fontSize: 13, color: Colors.cyan, marginTop: 4 },
});

const momStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 14, marginBottom: 14,
  },
  topRow: {
    flexDirection: 'row', gap: 14,
  },
  streakCol: {
    alignItems: 'center', justifyContent: 'center', paddingRight: 14,
    borderRightWidth: 1, borderRightColor: Colors.outlineVariant + '30',
  },
  streakCircle: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 2, borderColor: Colors.cyan,
    backgroundColor: Colors.cyan + '12',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  streakNum: {
    fontSize: 18, fontWeight: '700', color: Colors.cyan,
  },
  streakLabel: {
    fontSize: 7, color: Colors.outline, letterSpacing: 1, fontWeight: '700',
  },
  vsCol: { flex: 1 },
  vsTitle: {
    fontSize: 8, color: Colors.outline, letterSpacing: 2, fontWeight: '700', marginBottom: 6,
  },
  vsRow: { flexDirection: 'row', gap: 16, marginBottom: 4 },
  vsStat: {},
  vsValue: { fontSize: 16, fontWeight: '700', color: Colors.onSurface },
  vsSub: { fontSize: 9, color: Colors.outline, marginTop: 1 },
  deltaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4,
  },
  deltaText: { fontSize: 10, fontWeight: '600' },
  deltaVs: { fontSize: 9, color: Colors.outline },
  nudgeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '25',
  },
  nudgeText: { fontSize: 11, color: Colors.orange, flex: 1 },
});
