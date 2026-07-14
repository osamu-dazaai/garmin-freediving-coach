import { useQuery } from '@tanstack/react-query';
import { getClient } from './client';

export interface SessionMeta {
  max_depth_m: number;
  avg_depth_m: number;
  dive_count: number | null;
  bottom_time_s: number | null;
  max_bottom_time_s: number | null;
  location_name: string;
  water_temp_c: number | null;
}

export interface Session {
  id: number;
  start_time: string;
  duration_s: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  dive: SessionMeta;
  is_pb: boolean;
}

type SessionFilter = 'all' | 'deep' | 'month' | '3months';

export function useSessions(limit = 20, filter: SessionFilter = 'all') {
  return useQuery({
    queryKey: ['sessions', limit, filter],
    queryFn: async () => {
      const { data } = await getClient().get<Session[]>('/sessions', {
        params: { limit, filter },
      });
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useSession(id: number) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: async () => {
      const { data } = await getClient().get<Session>(`/sessions/${id}`);
      return data;
    },
    staleTime: 60 * 60_000,
  });
}
