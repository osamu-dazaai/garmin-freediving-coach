import type { TimeSeries } from '../api/dives';

export interface DiveReflexResult {
  surfaceHR: number;       // avg HR in first few seconds (pre-dive or initial)
  minHR: number;           // lowest HR during dive
  dropPct: number;         // percentage drop from surface to min
  timeToMinS: number;      // seconds from start to reach minimum
  dropRatePerS: number;    // bpm lost per second in the initial drop phase
  recoveryHR: number | null; // HR in last few seconds (surfacing)
  quality: 'excellent' | 'strong' | 'developing' | 'minimal';
}

/**
 * Analyze the mammalian dive reflex (MDR) from an HR profile.
 * Key metrics: how quickly HR drops, how low it gets, and recovery speed.
 */
export function analyzeDiveReflex(hrProfile: TimeSeries): DiveReflexResult | null {
  if (hrProfile.length < 6) return null;

  const t0 = hrProfile[0][0];
  const tEnd = hrProfile[hrProfile.length - 1][0];
  const duration = tEnd - t0;
  if (duration < 10) return null;

  // Surface HR: average of first 5 seconds
  const surfaceSamples = hrProfile.filter(([t]) => t - t0 <= 5);
  if (surfaceSamples.length === 0) return null;
  const surfaceHR = surfaceSamples.reduce((s, [, hr]) => s + hr, 0) / surfaceSamples.length;
  if (surfaceHR < 30) return null; // bad data

  // Find minimum HR and when it occurs
  let minHR = Infinity;
  let minHRTime = t0;
  for (const [t, hr] of hrProfile) {
    if (hr > 0 && hr < minHR) {
      minHR = hr;
      minHRTime = t;
    }
  }
  if (minHR === Infinity || minHR >= surfaceHR) return null;

  const dropPct = ((surfaceHR - minHR) / surfaceHR) * 100;
  const timeToMinS = minHRTime - t0;

  // Drop rate: average bpm lost per second in the descent phase (first half or to min)
  const dropWindow = Math.min(timeToMinS, duration * 0.6);
  const dropRatePerS = dropWindow > 0 ? (surfaceHR - minHR) / dropWindow : 0;

  // Recovery HR: average of last 5 seconds (surfacing)
  const recoverySamples = hrProfile.filter(([t]) => tEnd - t <= 5);
  const recoveryHR = recoverySamples.length > 0
    ? recoverySamples.reduce((s, [, hr]) => s + hr, 0) / recoverySamples.length
    : null;

  // Quality rating based on drop percentage
  let quality: DiveReflexResult['quality'];
  if (dropPct >= 35) quality = 'excellent';
  else if (dropPct >= 25) quality = 'strong';
  else if (dropPct >= 15) quality = 'developing';
  else quality = 'minimal';

  return { surfaceHR, minHR, dropPct, timeToMinS, dropRatePerS, recoveryHR, quality };
}
