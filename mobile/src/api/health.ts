import { useQuery } from '@tanstack/react-query';
import { getClient } from './client';

export interface HealthMetric {
  date: string;
  resting_hr: number | null;
  hrv_avg: number | null;
  sleep_score: number | null;
  body_battery_charged: number | null;
  stress_avg: number | null;
}

export interface ReadinessScore {
  date: string;
  score: number;
  level: 'OPTIMAL' | 'MODERATE' | 'LOW';
  hrv_avg: number | null;
  sleep_score: number | null;
  body_battery: number | null;
  stress_avg: number | null;
  components: Record<string, number>;
}

export function useReadiness() {
  return useQuery({
    queryKey: ['readiness', 'today'],
    queryFn: async () => {
      const { data } = await getClient().get<ReadinessScore>('/readiness/today');
      return data;
    },
    staleTime: 10 * 60_000,
  });
}

export function useHealthMetrics(days = 30) {
  return useQuery({
    queryKey: ['health-metrics', days],
    queryFn: async () => {
      const { data } = await getClient().get<HealthMetric[]>('/health-metrics', {
        params: { days },
      });
      return data;
    },
    staleTime: 10 * 60_000,
  });
}
