import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClient } from './client';

export type Discipline = 'CWT' | 'FIM' | 'CNF' | 'WARMUP' | 'STA';

/** [time_s, value] tuples — sparse, may be null if sensor not present */
export type TimeSeries = [number, number][];

export interface IndividualDive {
  dive_number: number;
  start_time: string;
  max_depth_m: number;
  bottom_time_s: number;
  descent_time_s: number | null;
  ascent_time_s: number | null;
  surface_interval_s: number | null;   // surface rest before this dive
  min_hr: number | null;
  max_hr: number | null;
  avg_hr: number | null;
  depth_profile: TimeSeries | null;    // [t_s, depth_m]
  hr_profile: TimeSeries | null;       // [t_s, bpm]
  velocity_profile: TimeSeries | null; // [t_s, m/s] vertical speed
  discipline: Discipline | null;       // explicit tag from Garmin if present
}

export function useSessionDives(sessionId: number) {
  return useQuery({
    queryKey: ['session-dives', sessionId],
    queryFn: async () => {
      const { data } = await getClient().get<IndividualDive[]>(
        `/sessions/${sessionId}/dives`,
      );
      return data;
    },
    staleTime: 60 * 60_000,
    retry: 1,
  });
}

export function useSaveDisciplineLabel(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ diveNumber, discipline, notes }: {
      diveNumber: number; discipline: Discipline | null; notes?: string;
    }) => {
      if (discipline === null) {
        await getClient().delete(`/sessions/${sessionId}/dives/${diveNumber}/label`);
      } else {
        await getClient().put(`/sessions/${sessionId}/dives/${diveNumber}/label`, {
          discipline, notes,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session-dives', sessionId] });
    },
  });
}

// ── Guest divers ──────────────────────────────────────────────────────────────

export interface GuestDiver {
  id: string;
  display_name: string;
  notes: string | null;
  dive_count: number;
}

export interface GuestDive {
  id: number;
  diver_id: string;
  session_file: string | null;
  dive_number: number | null;
  discipline: Discipline | null;
  max_depth_m: number;
  bottom_time_s: number | null;
  descent_time_s: number | null;
  ascent_time_s: number | null;
  surface_interval_s: number | null;
  water_temp_c: number | null;
  depth_profile: TimeSeries | null;
  hr_profile: TimeSeries | null;
  notes: string | null;
}

export interface GuestDiveCreate {
  discipline: Discipline | null;
  max_depth_m: number;
  bottom_time_s?: number;
  descent_time_s?: number;
  ascent_time_s?: number;
  notes?: string;
}

export function useGuestDivers() {
  return useQuery({
    queryKey: ['guest-divers'],
    queryFn: async () => {
      const { data } = await getClient().get<GuestDiver[]>('/guest-divers');
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useCreateGuestDiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { id: string; display_name: string; notes?: string }) => {
      const { data } = await getClient().post<GuestDiver>('/guest-divers', body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guest-divers'] }),
  });
}

export function useDeleteGuestDiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (diverId: string) => {
      await getClient().delete(`/guest-divers/${diverId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guest-divers'] }),
  });
}

export function useAddGuestDive(diverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: GuestDiveCreate) => {
      const { data } = await getClient().post(`/guest-divers/${diverId}/dives`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guest-divers'] }),
  });
}

export function useGuestDives(diverId: string) {
  return useQuery({
    queryKey: ['guest-dives', diverId],
    queryFn: async () => {
      const { data } = await getClient().get<GuestDive[]>(`/guest-divers/${diverId}/dives`);
      return data;
    },
    staleTime: 2 * 60_000,
    enabled: !!diverId,
  });
}

export function useLabelGuestDive(diverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ diveId, discipline }: { diveId: number; discipline: Discipline | null }) => {
      if (discipline === null) {
        await getClient().delete(`/guest-divers/${diverId}/dives/${diveId}/label`);
      } else {
        await getClient().patch(`/guest-divers/${diverId}/dives/${diveId}/label`, { discipline });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guest-dives', diverId] });
      qc.invalidateQueries({ queryKey: ['guest-divers'] });
    },
  });
}

// ─── Discipline classification ────────────────────────────────────────────────
//
// Uses the depth profile (pressure sensor) as the ONLY reliable signal.
// Garmin's directVerticalSpeed is firmware-smoothed to near-flatline and
// must NOT be used for classification.
//
// Two orthogonal biomechanical signals:
//
//   1. Descent rate variability (CV of instantaneous rates from depth samples)
//      CWT — fins produce smooth, continuous propulsion → low CV (<0.20)
//      FIM/CNF — discrete strokes create variable descent rates → high CV (>0.20)
//
//   2. Average descent speed (depth / time)
//      CWT — fastest (~0.8–1.5 m/s with fins)
//      FIM — moderate (~0.5–1.0 m/s, rope is efficient)
//      CNF — slowest (~0.3–0.7 m/s, body-only propulsion)
//
// Tiebreaker: ascent-to-descent speed ratio
//      FIM — ascent often faster (pulling rope + buoyancy assist) → ratio >1.1
//      CNF/CWT — ascent similar or slower than descent
//
// Warmup detection: sustained flat depth at the bottom (>8s within 1.5m of peak)
// indicates a hang/equalization stop rather than a performance turnaround.

export interface ClassificationResult {
  discipline: Discipline;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  /** True if a sustained bottom hang was detected — caller decides warmup vs hang based on dive_number */
  isWarmup: boolean;
  /** Duration in seconds of the bottom hang (0 if none) */
  bottomHangS: number;
}

// ── Depth profile analysis ────────────────────────────────────────────────────

interface DepthAnalysis {
  /** CV of instantaneous descent rate — CWT: <0.20, FIM/CNF: >0.20 */
  descentRateCV: number;
  /** Average descent rate in m/s */
  avgDescentRate: number;
  /** Average ascent rate in m/s */
  avgAscentRate: number;
  /** Ascent/descent speed ratio — FIM: >1.1 (pulling up is faster) */
  adRatio: number;
  /** Duration (seconds) of the longest flat plateau at bottom depth */
  bottomHangS: number;
}

function analyzeDepthProfile(profile: TimeSeries): DepthAnalysis | null {
  if (profile.length < 6) return null;

  // Find the peak depth index
  let peakIdx = 0;
  for (let i = 1; i < profile.length; i++) {
    if (profile[i][1] > profile[peakIdx][1]) peakIdx = i;
  }
  const peakDepth = profile[peakIdx][1];
  if (peakDepth < 1) return null; // too shallow to analyze

  // Need at least 3 samples on each side of peak
  if (peakIdx < 3 || profile.length - peakIdx < 3) return null;

  // ── Descent phase: start → peak ────────────────────────────────────────────
  // Trim the first ~3 seconds (duck dive) — it's always noisy regardless of
  // discipline and skews CV for short/shallow dives.
  const duckDiveCutoff = profile[0][0] + 3;
  const descent = profile.slice(0, peakIdx + 1);
  const descentRates: number[] = [];
  const allDescentRates: number[] = []; // including duck dive, for avg speed
  for (let i = 1; i < descent.length; i++) {
    const dt = descent[i][0] - descent[i - 1][0];
    if (dt <= 0) continue;
    const rate = (descent[i][1] - descent[i - 1][1]) / dt; // positive = descending
    if (rate > 0.02) {
      allDescentRates.push(rate);
      // Only include post-duck-dive samples in CV calculation
      if (descent[i][0] >= duckDiveCutoff) {
        descentRates.push(rate);
      }
    }
  }
  // Fall back to all rates if trimming left too few samples
  const cvRates = descentRates.length >= 3 ? descentRates : allDescentRates;
  if (cvRates.length < 3) return null;

  // CV of descent rates (excluding duck dive noise)
  const meanDescentRate = allDescentRates.reduce((a, b) => a + b, 0) / allDescentRates.length;
  const cvMean = cvRates.reduce((a, b) => a + b, 0) / cvRates.length;
  const descentVar = cvRates.reduce((s, r) => s + (r - cvMean) ** 2, 0) / cvRates.length;
  const descentRateCV = cvMean > 0 ? Math.sqrt(descentVar) / cvMean : 0;

  // ── Ascent phase: peak → end ───────────────────────────────────────────────
  const ascent = profile.slice(peakIdx);
  const ascentRates: number[] = [];
  for (let i = 1; i < ascent.length; i++) {
    const dt = ascent[i][0] - ascent[i - 1][0];
    if (dt <= 0) continue;
    const rate = (ascent[i - 1][1] - ascent[i][1]) / dt; // positive = ascending
    if (rate > 0.02) ascentRates.push(rate);
  }
  const meanAscentRate = ascentRates.length > 0
    ? ascentRates.reduce((a, b) => a + b, 0) / ascentRates.length
    : meanDescentRate; // fallback

  const adRatio = meanDescentRate > 0 ? meanAscentRate / meanDescentRate : 1;

  // ── Bottom hang detection ──────────────────────────────────────────────────
  // Find the longest consecutive run of samples within 1.5m of peak depth
  const hangThreshold = 1.5; // metres
  let maxHangS = 0;
  let hangStart: number | null = null;
  for (let i = 0; i < profile.length; i++) {
    const nearPeak = profile[i][1] >= peakDepth - hangThreshold;
    if (nearPeak) {
      if (hangStart === null) hangStart = profile[i][0];
    } else {
      if (hangStart !== null) {
        const dur = profile[i - 1][0] - hangStart;
        if (dur > maxHangS) maxHangS = dur;
        hangStart = null;
      }
    }
  }
  // Handle case where hang extends to end of profile
  if (hangStart !== null) {
    const dur = profile[profile.length - 1][0] - hangStart;
    if (dur > maxHangS) maxHangS = dur;
  }
  // Subtract typical turnaround time (a quick turn at the bottom takes ~2-3s)
  const bottomHangS = Math.max(0, maxHangS - 3);

  return {
    descentRateCV,
    avgDescentRate: meanDescentRate,
    avgAscentRate: meanAscentRate,
    adRatio,
    bottomHangS,
  };
}

// ── Main classifier ───────────────────────────────────────────────────────────

export function classifyDiscipline(dive: IndividualDive): ClassificationResult {
  // Prefer explicit tag from device
  if (dive.discipline) {
    return { discipline: dive.discipline, confidence: 'high', reason: 'Device-tagged', isWarmup: false, bottomHangS: 0 };
  }

  const { max_depth_m, descent_time_s, ascent_time_s } = dive;
  const depthConfident = max_depth_m >= 10;

  // ── Path A: depth-profile-based (pressure sensor = only reliable signal) ───
  if (dive.depth_profile && dive.depth_profile.length >= 6) {
    const dp = analyzeDepthProfile(dive.depth_profile);

    if (dp) {
      const isWarmup = dp.bottomHangS > 8;
      const warmupNote = isWarmup ? ` · ${Math.round(dp.bottomHangS)}s bottom hang` : '';

      // CWT — smooth steady descent with fins
      // Duck dive (first ~3s) is already trimmed from CV calculation,
      // so 0.20 threshold works for all depths.
      if (dp.descentRateCV < 0.20) {
        return {
          discipline: 'CWT',
          confidence: depthConfident ? 'high' : 'medium',
          reason: `Smooth descent (CV=${dp.descentRateCV.toFixed(2)}, rate=${dp.avgDescentRate.toFixed(2)} m/s)${warmupNote}`,
          isWarmup, bottomHangS: dp.bottomHangS,
        };
      }

      // Variable descent (CV >= 0.20) → FIM, CNF, or casual CWT
      //
      // Key insight: a "variable" descent doesn't automatically mean FIM.
      // Casual CWT (safety dives, relaxed finning) can also produce CV > 0.20.
      // Speed is NOT a differentiator — strong FIM divers exceed 0.9 m/s.
      //
      // FIM requires STRONG evidence of pull-glide oscillation:
      //   - Very high CV (>= 0.35): clear pull-glide sawtooth pattern
      //   - OR high CV (>= 0.20) + strong A/D ratio (>= 1.15): rope pulling confirmed
      //   - OR moderate CV (0.20–0.35) + moderate A/D (>= 1.08) + high CV (>= 0.28)
      //
      // Mild CV (0.20–0.30) without strong A/D defaults to CWT (casual finning).

      const highCV = dp.descentRateCV >= 0.35;
      const strongAD = dp.adRatio >= 1.15;
      const moderateAD = dp.adRatio >= 1.08;
      const clearPullPattern = dp.descentRateCV >= 0.28 && moderateAD;

      if (highCV || strongAD || clearPullPattern) {
        // Distinguish FIM from CNF: CNF is slow body-only propulsion
        if (dp.avgDescentRate < 0.35 && dp.adRatio < 1.08) {
          return {
            discipline: 'CNF',
            confidence: depthConfident ? 'high' : 'medium',
            reason: `Slow variable descent (CV=${dp.descentRateCV.toFixed(2)}, rate=${dp.avgDescentRate.toFixed(2)} m/s) — body propulsion${warmupNote}`,
            isWarmup, bottomHangS: dp.bottomHangS,
          };
        }
        const conf = depthConfident && (highCV || strongAD) ? 'high' : 'medium';
        return {
          discipline: 'FIM',
          confidence: conf,
          reason: `Pull-glide pattern (CV=${dp.descentRateCV.toFixed(2)}, A/D=${dp.adRatio.toFixed(2)}, rate=${dp.avgDescentRate.toFixed(2)} m/s)${warmupNote}`,
          isWarmup, bottomHangS: dp.bottomHangS,
        };
      }

      // Mild CV (0.20–0.30) without strong FIM evidence
      // → likely casual CWT (relaxed finning, safety dive, etc.)
      if (dp.avgDescentRate < 0.35) {
        // Very slow + mildly variable → CNF
        return {
          discipline: 'CNF',
          confidence: 'medium',
          reason: `Slow variable descent (CV=${dp.descentRateCV.toFixed(2)}, rate=${dp.avgDescentRate.toFixed(2)} m/s) — body propulsion${warmupNote}`,
          isWarmup, bottomHangS: dp.bottomHangS,
        };
      }
      return {
        discipline: 'CWT',
        confidence: 'medium',
        reason: `Mildly variable descent (CV=${dp.descentRateCV.toFixed(2)}, rate=${dp.avgDescentRate.toFixed(2)} m/s) — casual finning${warmupNote}`,
        isWarmup, bottomHangS: dp.bottomHangS,
      };
    }
  }

  // ── Path B: speed-only fallback (no usable depth profile) ──────────────────
  // Without a depth profile we can't compute CV, so classification is low-confidence.
  // The ascent/descent ratio is the best remaining signal:
  //   FIM: ascent often faster than descent (pulling rope + buoyancy)
  //   CWT: ascent ≈ descent (fins work both ways)
  //   CNF: slow all around
  const isWarmup = dive.bottom_time_s > 0 && descent_time_s != null && descent_time_s > 0
    && dive.bottom_time_s > descent_time_s * 1.5;

  if (!descent_time_s || !ascent_time_s || max_depth_m < 3) {
    return { discipline: 'CWT', confidence: 'low', reason: 'Insufficient data', isWarmup, bottomHangS: 0 };
  }

  const descentV = max_depth_m / descent_time_s;
  const ascentV  = max_depth_m / ascent_time_s;
  const adRatio  = ascentV / descentV;

  // FIM signal: ascent notably faster than descent (rope pulling + buoyancy)
  if (adRatio >= 1.08) {
    return {
      discipline: 'FIM',
      confidence: 'low',
      reason: `Ascent ${adRatio.toFixed(2)}× faster than descent — rope pattern (no profile)`,
      isWarmup, bottomHangS: 0,
    };
  }

  // Very slow descent → likely CNF (body-only propulsion)
  if (descentV < 0.35) {
    return {
      discipline: 'CNF',
      confidence: depthConfident ? 'medium' : 'low',
      reason: `Slow descent ${descentV.toFixed(2)} m/s — body propulsion (no profile)`,
      isWarmup, bottomHangS: 0,
    };
  }

  // Default: CWT (most common discipline, can't distinguish without profile)
  return {
    discipline: 'CWT',
    confidence: 'low',
    reason: `Descent ${descentV.toFixed(2)} m/s, A/D=${adRatio.toFixed(2)} — defaulting CWT (no profile)`,
    isWarmup, bottomHangS: 0,
  };
}
