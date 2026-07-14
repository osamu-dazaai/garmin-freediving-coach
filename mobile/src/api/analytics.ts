import { useQuery } from '@tanstack/react-query';
import { getClient } from './client';

export interface DepthPoint {
  date: string;
  max_depth_m: number;
  session_id: number;
}

export interface WorkingDepth {
  working_depth_m: number;
  pb_depth_m: number;
  avg_depth_m: number;
  window_days: number;
  session_count: number;
}

export interface PersonalBests {
  max_depth_m: number;
  max_depth_date: string;
  max_bottom_time_s: number;
  max_bottom_time_date: string;
  total_sessions: number;
  total_bottom_time_s: number;
  total_depth_descended_m: number;
  window_label: string | null;
  window_sessions: number | null;
  window_bottom_time_s: number | null;
  window_depth_descended_m: number | null;
}

export interface LocationStat {
  location: string;
  session_count: number;
  max_depth_m: number;
  avg_depth_m: number;
  last_session: string;
}

export interface PlateauStatus {
  plateau: boolean;
  days_since_improvement: number;
  last_pb_date: string | null;
  last_pb_depth_m: number | null;
  suggestion: string | null;
}

export interface TrainingPhase {
  current_phase: 'pool' | 'open_water' | 'rest' | 'mixed';
  phase_start_date: string;
  session_count: number;
  avg_depth_m: number;
  streak_days: number;
}

export interface MonthlyStats {
  month: string;
  session_count: number;
  max_depth_m: number;
  avg_depth_m: number;
  total_bottom_time_s: number;
}

export function useDepthProgression(days = 365) {
  return useQuery({
    queryKey: ['analytics', 'depth-progression', days],
    queryFn: async () => {
      const { data } = await getClient().get<DepthPoint[]>('/analytics/depth-progression', {
        params: { days },
      });
      return data;
    },
    staleTime: 30 * 60_000,
  });
}

export function useWorkingDepth(windowDays = 90) {
  return useQuery({
    queryKey: ['analytics', 'working-depth', windowDays],
    queryFn: async () => {
      const { data } = await getClient().get<WorkingDepth>('/analytics/working-depth', {
        params: { window_days: windowDays },
      });
      return data;
    },
    staleTime: 30 * 60_000,
  });
}

export function usePersonalBests(since?: string, until?: string) {
  return useQuery({
    queryKey: ['analytics', 'personal-bests', since, until],
    queryFn: async () => {
      const { data } = await getClient().get<PersonalBests>('/analytics/personal-bests', {
        params: { ...(since && { since }), ...(until && { until }) },
      });
      return data;
    },
    staleTime: 60 * 60_000,
  });
}

export function useLocationPerformance() {
  return useQuery({
    queryKey: ['analytics', 'location-performance'],
    queryFn: async () => {
      const { data } = await getClient().get<LocationStat[]>('/analytics/location-performance');
      return data;
    },
    staleTime: 60 * 60_000,
  });
}

export function usePlateauStatus() {
  return useQuery({
    queryKey: ['analytics', 'plateau'],
    queryFn: async () => {
      const { data } = await getClient().get<PlateauStatus>('/analytics/plateau-detection');
      return data;
    },
    staleTime: 60 * 60_000,
  });
}

export function useTrainingPhase() {
  return useQuery({
    queryKey: ['analytics', 'training-phase'],
    queryFn: async () => {
      const { data } = await getClient().get<TrainingPhase>('/analytics/training-phase');
      return data;
    },
    staleTime: 10 * 60_000,
  });
}

export function useMonthlyStats(year?: number) {
  return useQuery({
    queryKey: ['analytics', 'monthly-stats', year],
    queryFn: async () => {
      const { data } = await getClient().get<MonthlyStats[]>('/analytics/monthly-stats', {
        params: year ? { year } : {},
      });
      return data;
    },
    staleTime: 60 * 60_000,
  });
}
