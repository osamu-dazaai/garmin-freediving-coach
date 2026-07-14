import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClient } from './client';

export interface ProtocolSet {
  hold_s: number;
  rest_s: number;
}

export interface Protocol {
  key: string;
  type: string;
  name: string;
  desc: string;
  detail: string;
  cycles: number;
  hold_s: number;
  rest_s: number;
  rest_end_s?: number;
  hold_fmt: string;
  rest_fmt: string;
  color: string;
  recommended: boolean;
  progress_pct: number;
  sets?: ProtocolSet[];
}

export function useProtocols() {
  return useQuery({
    queryKey: ['protocols'],
    queryFn: async () => {
      const { data } = await getClient().get<Protocol[]>('/protocols');
      return data;
    },
    staleTime: 30 * 60_000,
  });
}

export function useTriggerSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await getClient().post('/sync/trigger');
      return data;
    },
    onSuccess: () => {
      // Invalidate all data after sync
      qc.invalidateQueries();
    },
  });
}
