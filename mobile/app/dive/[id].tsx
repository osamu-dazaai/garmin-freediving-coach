import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions,
  TextInput, Keyboard, Modal, Pressable,
  type GestureResponderEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Canvas, Path, Skia, Circle, Line, vec } from '@shopify/react-native-skia';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../src/constants/colors';
import { fmtSeconds } from '../../src/utils/formatters';
import {
  classifyDiscipline, useSaveDisciplineLabel,
  type IndividualDive, type TimeSeries, type Discipline,
} from '../../src/api/dives';
import { analyzeDiveReflex, type DiveReflexResult } from '../../src/utils/diveReflex';
import { useAppStore } from '../../src/store/appStore';

const DISCIPLINES: { value: Discipline | null; label: string; color: string }[] = [
  { value: 'CWT',    label: 'CWT — Constant Weight',    color: Colors.cyan },
  { value: 'FIM',    label: 'FIM — Free Immersion',     color: Colors.orange },
  { value: 'CNF',    label: 'CNF — No Fins',            color: '#9b7fff' },
  { value: 'WARMUP', label: 'WARMUP / Hang',            color: Colors.outline },
  { value: 'STA',    label: 'STA — Static Apnea',       color: '#7fff9b' },
  { value: null,     label: 'Auto-detect (clear label)', color: Colors.outline },
];

const SCREEN_W = Dimensions.get('window').width;
const CHART_W = SCREEN_W - 48; // 24px padding each side
const CHART_H = 160;
const Y_AXIS_W = 32; // width for Y axis labels
const CHART_PAD = { top: 12, bottom: 20, left: Y_AXIS_W, right: 4 };
const PLOT_W = CHART_W - CHART_PAD.left - CHART_PAD.right;
const PLOT_H = CHART_H - CHART_PAD.top - CHART_PAD.bottom;

const DISC_COLOR: Record<string, string> = {
  CWT: Colors.cyan,
  FIM: Colors.orange,
  CNF: '#9b7fff',
};

// ── Pull analysis for FIM dives ──────────────────────────────────────────────

interface PullAnalysis {
  descentPulls: number;
  ascentPulls: number;
  pullCount: number;
  avgPullVelocity: number;   // m/s gained per pull
  avgPullInterval: number;   // seconds between pulls
  pullDetails: { time: number; velocityGain: number; phase: 'descent' | 'ascent' }[];
}

/**
 * Detect pulls in a single-phase rate series using mean-crossing.
 * Each above-mean excursion = one pull stroke.
 */
function detectPullsInPhase(
  rates: { time: number; rate: number }[],
  phase: 'descent' | 'ascent',
): { time: number; velocityGain: number; phase: 'descent' | 'ascent' }[] {
  if (rates.length < 3) return [];

  const meanRate = rates.reduce((s, r) => s + r.rate, 0) / rates.length;
  if (meanRate < 0.05) return []; // not enough movement

  const pulls: { time: number; velocityGain: number; phase: 'descent' | 'ascent' }[] = [];
  let inPull = false;
  let peakRate = 0;
  let peakTime = 0;
  let troughBeforePull = meanRate;

  for (let i = 0; i < rates.length; i++) {
    const above = rates[i].rate > meanRate;
    if (above && !inPull) {
      troughBeforePull = meanRate;
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        troughBeforePull = Math.min(troughBeforePull, rates[j].rate);
      }
      inPull = true;
      peakRate = rates[i].rate;
      peakTime = rates[i].time;
    } else if (above && inPull) {
      if (rates[i].rate > peakRate) {
        peakRate = rates[i].rate;
        peakTime = rates[i].time;
      }
    } else if (!above && inPull) {
      const gain = peakRate - troughBeforePull;
      if (gain > 0.01) {
        pulls.push({ time: peakTime, velocityGain: gain, phase });
      }
      inPull = false;
      peakRate = 0;
    }
  }
  if (inPull && peakRate > meanRate) {
    const gain = peakRate - troughBeforePull;
    if (gain > 0.01) {
      pulls.push({ time: peakTime, velocityGain: gain, phase });
    }
  }
  return pulls;
}

function analyzePulls(depthProfile: TimeSeries): PullAnalysis | null {
  if (depthProfile.length < 8) return null;

  // Find peak depth index
  let peakIdx = 0;
  for (let i = 1; i < depthProfile.length; i++) {
    if (depthProfile[i][1] > depthProfile[peakIdx][1]) peakIdx = i;
  }
  if (peakIdx < 3) return null;

  // ── Descent phase: compute descent rates (positive = going deeper) ──
  const descentRates: { time: number; rate: number }[] = [];
  for (let i = 1; i <= peakIdx; i++) {
    const dt = depthProfile[i][0] - depthProfile[i - 1][0];
    if (dt <= 0) continue;
    const rate = (depthProfile[i][1] - depthProfile[i - 1][1]) / dt;
    descentRates.push({ time: depthProfile[i][0], rate });
  }

  // ── Ascent phase: compute ascent rates (flip sign: positive = going up faster) ──
  const ascentRates: { time: number; rate: number }[] = [];
  for (let i = peakIdx + 1; i < depthProfile.length; i++) {
    const dt = depthProfile[i][0] - depthProfile[i - 1][0];
    if (dt <= 0) continue;
    // Ascending: depth decreases, so rate is negative. Flip to positive.
    const rate = -(depthProfile[i][1] - depthProfile[i - 1][1]) / dt;
    ascentRates.push({ time: depthProfile[i][0], rate });
  }

  const descentPulls = detectPullsInPhase(descentRates, 'descent');
  const ascentPulls = detectPullsInPhase(ascentRates, 'ascent');

  const allPulls = [...descentPulls, ...ascentPulls];
  if (allPulls.length < 2) return null;

  // Compute interval stats for each phase separately, then combine
  const allIntervals: number[] = [];
  if (descentPulls.length > 1) {
    for (let i = 1; i < descentPulls.length; i++) {
      allIntervals.push(descentPulls[i].time - descentPulls[i - 1].time);
    }
  }
  if (ascentPulls.length > 1) {
    for (let i = 1; i < ascentPulls.length; i++) {
      allIntervals.push(ascentPulls[i].time - ascentPulls[i - 1].time);
    }
  }
  const avgInterval = allIntervals.length > 0
    ? allIntervals.reduce((a, b) => a + b, 0) / allIntervals.length : 0;
  const avgVel = allPulls.reduce((s, p) => s + p.velocityGain, 0) / allPulls.length;

  return {
    descentPulls: descentPulls.length,
    ascentPulls: ascentPulls.length,
    pullCount: allPulls.length,
    avgPullVelocity: avgVel,
    avgPullInterval: avgInterval,
    pullDetails: allPulls,
  };
}

// ── Stall-based pull detection ────────────────────────────────────────────────
// During FIM, the watch (on wrist) momentarily stalls or rises as the arm
// reaches down to grab the rope, then accelerates as the diver pulls past.
// This creates a "staircase" pattern: stall → accelerate → glide → stall.
// We detect pulls by finding moments where descent rate drops near zero or
// reverses (depth plateau/micro-rise) during an otherwise active descent/ascent.

interface StallPullAnalysis {
  descentPulls: number;
  ascentPulls: number;
  pullCount: number;
  avgStallDuration: number;  // average stall length in seconds
  avgPullInterval: number;
  pullDetails: { time: number; stallDepth: number; stallDuration: number; phase: 'descent' | 'ascent' }[];
}

function detectStallsInPhase(
  depthProfile: TimeSeries,
  startIdx: number,
  endIdx: number,
  phase: 'descent' | 'ascent',
): { time: number; stallDepth: number; stallDuration: number; phase: 'descent' | 'ascent' }[] {
  if (endIdx - startIdx < 4) return [];

  // Compute per-sample rates
  const rates: { idx: number; rate: number; time: number; depth: number }[] = [];
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const dt = depthProfile[i][0] - depthProfile[i - 1][0];
    if (dt <= 0) continue;
    // For descent: positive rate = going deeper. For ascent: flip sign.
    const raw = (depthProfile[i][1] - depthProfile[i - 1][1]) / dt;
    const rate = phase === 'descent' ? raw : -raw;
    rates.push({ idx: i, rate, time: depthProfile[i][0], depth: depthProfile[i][1] });
  }
  if (rates.length < 4) return [];

  // Average speed in this phase (should be positive for active movement)
  const avgRate = rates.reduce((s, r) => s + r.rate, 0) / rates.length;
  if (avgRate < 0.15) return []; // barely moving, not reliable

  // Mirror of velocity mean-crossing: every below-mean trough = one pull.
  // The velocity method counts above-mean excursions (speed bursts from pulling).
  // The stall method counts below-mean excursions (deceleration from reaching).
  // Both should detect the same pull events from opposite perspectives.
  //
  // At 1Hz Garmin sampling, rate variations are subtle. We track the depth of
  // each trough (how far below mean it dips) as "deceleration gain" — analogous
  // to the velocity method's "velocity gain" for peaks.
  const stalls: { time: number; stallDepth: number; stallDuration: number; phase: 'descent' | 'ascent' }[] = [];

  let inTrough = false;
  let troughStart = 0;
  let troughMinRate = Infinity;
  let troughMinTime = 0;
  let troughMinDepth = 0;
  // Track the peak rate just before this trough (for gain calculation)
  let peakBeforeTrough = avgRate;

  for (let i = 0; i < rates.length; i++) {
    const belowMean = rates[i].rate < avgRate;

    if (belowMean && !inTrough) {
      // Find peak in the few samples before this trough
      peakBeforeTrough = avgRate;
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        peakBeforeTrough = Math.max(peakBeforeTrough, rates[j].rate);
      }
      inTrough = true;
      troughStart = rates[i].time;
      troughMinRate = rates[i].rate;
      troughMinTime = rates[i].time;
      troughMinDepth = rates[i].depth;
    } else if (belowMean && inTrough) {
      if (rates[i].rate < troughMinRate) {
        troughMinRate = rates[i].rate;
        troughMinTime = rates[i].time;
        troughMinDepth = rates[i].depth;
      }
    } else if (!belowMean && inTrough) {
      // Deceleration gain: how much the rate dropped from peak to trough
      const gain = peakBeforeTrough - troughMinRate;
      // Mirror the velocity method's threshold: gain > 0.01
      if (gain > 0.01) {
        const duration = rates[i].time - troughStart;
        stalls.push({
          time: troughMinTime,
          stallDepth: troughMinDepth,
          stallDuration: Math.max(duration, 0.5),
          phase,
        });
      }
      inTrough = false;
    }
  }

  // Close trailing trough
  if (inTrough && troughMinRate < avgRate) {
    const gain = peakBeforeTrough - troughMinRate;
    if (gain > 0.01) {
      const lastTime = rates[rates.length - 1].time;
      const duration = lastTime - troughStart;
      stalls.push({
        time: troughMinTime,
        stallDepth: troughMinDepth,
        stallDuration: Math.max(duration, 0.5),
        phase,
      });
    }
  }

  return stalls;
}

function analyzeStallPulls(depthProfile: TimeSeries): StallPullAnalysis | null {
  if (depthProfile.length < 8) return null;

  // Find peak depth index
  let peakIdx = 0;
  for (let i = 1; i < depthProfile.length; i++) {
    if (depthProfile[i][1] > depthProfile[peakIdx][1]) peakIdx = i;
  }
  if (peakIdx < 3) return null;

  // Skip first 2 samples (surface entry noise) and last 2 before peak
  const descentStart = Math.min(2, peakIdx - 1);
  const descentEnd = peakIdx;

  // Skip first 2 after peak and last 2 (surface exit noise)
  const ascentStart = peakIdx;
  const ascentEnd = Math.max(peakIdx + 1, depthProfile.length - 3);

  const descentStalls = detectStallsInPhase(depthProfile, descentStart, descentEnd, 'descent');
  const ascentStalls = detectStallsInPhase(depthProfile, ascentStart, ascentEnd, 'ascent');

  const allStalls = [...descentStalls, ...ascentStalls];
  if (allStalls.length < 1) return null;

  // Compute intervals per phase
  const allIntervals: number[] = [];
  if (descentStalls.length > 1) {
    for (let i = 1; i < descentStalls.length; i++) {
      allIntervals.push(descentStalls[i].time - descentStalls[i - 1].time);
    }
  }
  if (ascentStalls.length > 1) {
    for (let i = 1; i < ascentStalls.length; i++) {
      allIntervals.push(ascentStalls[i].time - ascentStalls[i - 1].time);
    }
  }
  const avgInterval = allIntervals.length > 0
    ? allIntervals.reduce((a, b) => a + b, 0) / allIntervals.length : 0;
  const avgStallDur = allStalls.reduce((s, p) => s + p.stallDuration, 0) / allStalls.length;

  return {
    descentPulls: descentStalls.length,
    ascentPulls: ascentStalls.length,
    pullCount: allStalls.length,
    avgStallDuration: avgStallDur,
    avgPullInterval: avgInterval,
    pullDetails: allStalls,
  };
}

// ── Compute velocity from depth profile ──────────────────────────────────────
// Garmin's velocity_profile is firmware-smoothed to near-zero flatline.
// We compute instantaneous vertical speed from consecutive depth samples instead.
function computeVelocityFromDepth(depthProfile: TimeSeries): TimeSeries {
  if (depthProfile.length < 3) return [];
  const velocity: TimeSeries = [];
  // Use centered differences for smoother result (3-point window)
  for (let i = 1; i < depthProfile.length - 1; i++) {
    const dt = depthProfile[i + 1][0] - depthProfile[i - 1][0];
    if (dt <= 0) continue;
    // Positive = descending, negative = ascending
    const rate = (depthProfile[i + 1][1] - depthProfile[i - 1][1]) / dt;
    velocity.push([depthProfile[i][0], rate]);
  }
  // Add endpoints
  if (depthProfile.length >= 2) {
    const dt0 = depthProfile[1][0] - depthProfile[0][0];
    if (dt0 > 0) velocity.unshift([depthProfile[0][0], (depthProfile[1][1] - depthProfile[0][1]) / dt0]);
    const n = depthProfile.length;
    const dtN = depthProfile[n - 1][0] - depthProfile[n - 2][0];
    if (dtN > 0) velocity.push([depthProfile[n - 1][0], (depthProfile[n - 1][1] - depthProfile[n - 2][1]) / dtN]);
  }
  return velocity;
}

// Dive reflex analysis imported from src/utils/diveReflex.ts

// ── Freefall detection (CWT) ─────────────────────────────────────────────────
// During CWT descent, the diver actively kicks until reaching negative buoyancy
// depth, then freefalls passively. The transition is visible in the depth profile
// as a shift from variable descent rate (kicking) to smooth, steady descent.
// We detect this by computing a rolling CV of descent rate and finding where
// it drops below a threshold.

interface FreefallResult {
  freefallDepth: number;     // depth where freefall begins
  freefallTime: number;      // seconds into descent when freefall starts
  kickingDuration: number;   // seconds of active kicking
  freefallDuration: number;  // seconds of passive freefall
  kickingPct: number;        // % of descent spent kicking
  avgKickingRate: number;    // m/s during active phase
  avgFreefallRate: number;   // m/s during passive phase
  speedGain: number;         // how much faster freefall is vs kicking (ratio)
}

function detectFreefall(depthProfile: TimeSeries): FreefallResult | null {
  if (depthProfile.length < 12) return null;

  // Find peak depth index
  let peakIdx = 0;
  for (let i = 1; i < depthProfile.length; i++) {
    if (depthProfile[i][1] > depthProfile[peakIdx][1]) peakIdx = i;
  }
  if (peakIdx < 8) return null; // need enough descent samples
  const peakDepth = depthProfile[peakIdx][1];
  if (peakDepth < 12) return null; // too shallow for meaningful freefall

  // Compute per-sample descent rates
  const rates: { idx: number; time: number; depth: number; rate: number }[] = [];
  for (let i = 1; i <= peakIdx; i++) {
    const dt = depthProfile[i][0] - depthProfile[i - 1][0];
    if (dt <= 0) continue;
    const rate = (depthProfile[i][1] - depthProfile[i - 1][1]) / dt;
    if (rate > 0) { // only positive = going deeper
      rates.push({ idx: i, time: depthProfile[i][0], depth: depthProfile[i][1], rate });
    }
  }
  if (rates.length < 8) return null;

  // Rolling CV with window of 4 samples
  const WINDOW = 4;
  const rollingCV: { idx: number; cv: number; depth: number; time: number }[] = [];
  for (let i = WINDOW - 1; i < rates.length; i++) {
    const window = rates.slice(i - WINDOW + 1, i + 1);
    const mean = window.reduce((s, r) => s + r.rate, 0) / window.length;
    if (mean < 0.1) continue;
    const variance = window.reduce((s, r) => s + (r.rate - mean) ** 2, 0) / window.length;
    const cv = Math.sqrt(variance) / mean;
    rollingCV.push({ idx: rates[i].idx, cv, depth: rates[i].depth, time: rates[i].time });
  }
  if (rollingCV.length < 4) return null;

  // Skip first 3 seconds (duck dive) — always noisy
  const duckDiveCutoff = depthProfile[0][0] + 3;
  const postDuck = rollingCV.filter((r) => r.time >= duckDiveCutoff);
  if (postDuck.length < 4) return null;

  // Find transition: first point where CV drops below 0.15 for at least 3 consecutive samples
  // after initially being above 0.15 (kicking phase)
  const CV_THRESHOLD = 0.15;
  let kickingPhaseFound = false;
  let transitionIdx = -1;

  for (let i = 0; i < postDuck.length; i++) {
    if (postDuck[i].cv >= CV_THRESHOLD) {
      kickingPhaseFound = true;
    }
    if (kickingPhaseFound && postDuck[i].cv < CV_THRESHOLD) {
      // Check next 2 samples also below threshold
      let sustained = true;
      for (let j = 1; j <= 2 && i + j < postDuck.length; j++) {
        if (postDuck[i + j].cv >= CV_THRESHOLD) { sustained = false; break; }
      }
      if (sustained) {
        transitionIdx = i;
        break;
      }
    }
  }

  if (transitionIdx < 0) return null;

  const transitionPoint = postDuck[transitionIdx];
  // Freefall must start below 8m (above that, negative buoyancy is very unlikely)
  if (transitionPoint.depth < 8) return null;

  const t0 = depthProfile[0][0];
  const kickingDuration = transitionPoint.time - t0;
  const freefallDuration = depthProfile[peakIdx][0] - transitionPoint.time;
  if (freefallDuration < 2) return null; // too short to be meaningful

  // Compute avg rates for each phase
  const kickingRates = rates.filter((r) => r.time < transitionPoint.time && r.time >= duckDiveCutoff);
  const freefallRates = rates.filter((r) => r.time >= transitionPoint.time);

  const avgKickingRate = kickingRates.length > 0
    ? kickingRates.reduce((s, r) => s + r.rate, 0) / kickingRates.length : 0;
  const avgFreefallRate = freefallRates.length > 0
    ? freefallRates.reduce((s, r) => s + r.rate, 0) / freefallRates.length : 0;

  const totalDescentTime = depthProfile[peakIdx][0] - t0;

  return {
    freefallDepth: transitionPoint.depth,
    freefallTime: kickingDuration,
    kickingDuration,
    freefallDuration,
    kickingPct: totalDescentTime > 0 ? (kickingDuration / totalDescentTime) * 100 : 0,
    avgKickingRate,
    avgFreefallRate,
    speedGain: avgKickingRate > 0 ? avgFreefallRate / avgKickingRate : 1,
  };
}

// ── Y axis tick generation ───────────────────────────────────────────────────
function niceYTicks(minV: number, maxV: number, count: number = 4): number[] {
  const range = maxV - minV;
  if (range <= 0) return [minV];
  // Find nice step size
  const rawStep = range / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceSteps = [1, 2, 5, 10];
  const step = niceSteps.find((s) => s * mag >= rawStep)! * mag;
  const start = Math.floor(minV / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= maxV + step * 0.01; v += step) {
    if (v >= minV - step * 0.01) ticks.push(v);
  }
  return ticks.length > 0 ? ticks : [minV, maxV];
}

// ── Line chart component ─────────────────────────────────────────────────────

function LineChart({
  data, color, label, unit, inverted = false, height = CHART_H,
  highlightPoints,
}: {
  data: TimeSeries;
  color: string;
  label: string;
  unit: string;
  inverted?: boolean;
  height?: number;
  highlightPoints?: { time: number }[];
}) {
  const [inspectIdx, setInspectIdx] = useState<number | null>(null);
  const chartRef = useRef<View>(null);
  const chartXRef = useRef(0);

  if (!data || data.length < 2) return null;

  const plotH = height - CHART_PAD.top - CHART_PAD.bottom;

  const times = data.map(([t]) => t);
  const values = data.map(([, v]) => v);
  const minT = times[0];
  const maxT = times[times.length - 1];
  const tRange = maxT - minT || 1;
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const vRange = maxV - minV || 1;

  // Map touch X to nearest data index
  const touchToIdx = useCallback((pageX: number) => {
    const relX = pageX - chartXRef.current;
    const tAtX = minT + (relX / CHART_W) * tRange;
    // Binary-ish search for nearest
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(data[i][0] - tAtX);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }, [data, minT, tRange]);

  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    chartRef.current?.measureInWindow((x) => { chartXRef.current = x; });
    setInspectIdx(touchToIdx(e.nativeEvent.pageX));
  }, [touchToIdx]);

  const onTouchMove = useCallback((e: GestureResponderEvent) => {
    setInspectIdx(touchToIdx(e.nativeEvent.pageX));
  }, [touchToIdx]);

  const onTouchEnd = useCallback(() => {
    // Keep the last inspected point visible for a moment
    setTimeout(() => setInspectIdx(null), 1500);
  }, []);

  // Build Skia path
  const path = useMemo(() => {
    const p = Skia.Path.Make();
    for (let i = 0; i < data.length; i++) {
      const x = CHART_PAD.left + ((data[i][0] - minT) / tRange) * PLOT_W;
      const normV = (data[i][1] - minV) / vRange;
      const y = inverted
        ? CHART_PAD.top + normV * plotH           // deeper = lower on screen
        : CHART_PAD.top + (1 - normV) * plotH;    // higher value = higher on screen
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    return p;
  }, [data, minT, tRange, minV, vRange, plotH, inverted]);

  // Fill path (area under/above the line)
  const fillPath = useMemo(() => {
    const p = Skia.Path.Make();
    for (let i = 0; i < data.length; i++) {
      const x = CHART_PAD.left + ((data[i][0] - minT) / tRange) * PLOT_W;
      const normV = (data[i][1] - minV) / vRange;
      const y = inverted
        ? CHART_PAD.top + normV * plotH
        : CHART_PAD.top + (1 - normV) * plotH;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    // Close the area
    const lastX = CHART_PAD.left + ((data[data.length - 1][0] - minT) / tRange) * PLOT_W;
    const firstX = CHART_PAD.left;
    if (inverted) {
      p.lineTo(lastX, CHART_PAD.top);
      p.lineTo(firstX, CHART_PAD.top);
    } else {
      p.lineTo(lastX, CHART_PAD.top + plotH);
      p.lineTo(firstX, CHART_PAD.top + plotH);
    }
    p.close();
    return p;
  }, [data, minT, tRange, minV, vRange, plotH, inverted]);

  // Highlight points (pull markers)
  const highlightCoords = useMemo(() => {
    if (!highlightPoints) return [];
    return highlightPoints.map((hp) => {
      // Find nearest data point
      let closest = 0;
      let bestDist = Infinity;
      for (let i = 0; i < data.length; i++) {
        const d = Math.abs(data[i][0] - hp.time);
        if (d < bestDist) { bestDist = d; closest = i; }
      }
      const x = CHART_PAD.left + ((data[closest][0] - minT) / tRange) * PLOT_W;
      const normV = (data[closest][1] - minV) / vRange;
      const y = inverted
        ? CHART_PAD.top + normV * plotH
        : CHART_PAD.top + (1 - normV) * plotH;
      return { x, y };
    });
  }, [highlightPoints, data, minT, tRange, minV, vRange, plotH, inverted]);

  // Inspect crosshair coordinates
  const inspectPt = inspectIdx !== null ? (() => {
    const x = CHART_PAD.left + ((data[inspectIdx][0] - minT) / tRange) * PLOT_W;
    const normV = (data[inspectIdx][1] - minV) / vRange;
    const y = inverted
      ? CHART_PAD.top + normV * plotH
      : CHART_PAD.top + (1 - normV) * plotH;
    return { x, y, time: data[inspectIdx][0], value: data[inspectIdx][1] };
  })() : null;

  // Axis labels
  const duration = maxT - minT;
  const midT = minT + duration / 2;

  // Y axis ticks
  const yTicks = useMemo(() => niceYTicks(minV, maxV, 4), [minV, maxV]);

  // Format time as m:ss
  const fmtTime = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return min > 0 ? `${min}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
  };

  return (
    <View style={styles.chartWrap}>
      <View style={styles.chartLabelRow}>
        <Text style={styles.chartLabel}>{label}</Text>
        {inspectPt ? (
          <View style={[styles.inspectTooltip, { borderColor: color + '60' }]}>
            <Text style={[styles.inspectValue, { color }]}>
              {Math.abs(inspectPt.value) < 10 ? inspectPt.value.toFixed(2) : inspectPt.value.toFixed(1)}
              <Text style={styles.inspectUnit}> {unit}</Text>
            </Text>
            <Text style={styles.inspectTime}>{fmtTime(inspectPt.time)}</Text>
          </View>
        ) : (
          <Text style={styles.chartRange}>
            {minV.toFixed(1)} – {maxV.toFixed(1)} {unit}
          </Text>
        )}
      </View>
      <View style={{ position: 'relative' }}>
        {/* Y axis labels (React Native Text, positioned absolutely) */}
        {yTicks.map((tick) => {
          const normV = (tick - minV) / vRange;
          const y = inverted
            ? CHART_PAD.top + normV * plotH
            : CHART_PAD.top + (1 - normV) * plotH;
          return (
            <Text
              key={tick}
              style={[styles.yAxisLabel, { top: y - 5 }]}
            >
              {Math.abs(tick) >= 10 ? Math.round(tick) : tick.toFixed(1)}
            </Text>
          );
        })}
        <View
          ref={chartRef}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderStart={onTouchStart}
          onResponderMove={onTouchMove}
          onResponderRelease={onTouchEnd}
        >
          <Canvas style={{ width: CHART_W, height }}>
            {/* Horizontal grid lines at Y ticks */}
            {yTicks.map((tick) => {
              const normV = (tick - minV) / vRange;
              const y = inverted
                ? CHART_PAD.top + normV * plotH
                : CHART_PAD.top + (1 - normV) * plotH;
              return (
                <Line
                  key={tick}
                  p1={vec(CHART_PAD.left, y)}
                  p2={vec(CHART_PAD.left + PLOT_W, y)}
                  color={Skia.Color(Colors.outline + '18')}
                  style="stroke"
                  strokeWidth={0.5}
                />
              );
            })}
            {/* Fill area */}
            <Path
              path={fillPath}
              color={Skia.Color(color + '15')}
              style="fill"
            />
            {/* Line */}
            <Path
              path={path}
              color={Skia.Color(color)}
              style="stroke"
              strokeWidth={1.5}
              strokeCap="round"
              strokeJoin="round"
            />
            {/* Zero line for velocity */}
            {!inverted && minV < 0 && maxV > 0 && (
              <Line
                p1={vec(CHART_PAD.left, CHART_PAD.top + (maxV / vRange) * plotH)}
                p2={vec(CHART_PAD.left + PLOT_W, CHART_PAD.top + (maxV / vRange) * plotH)}
                color={Skia.Color(Colors.outline + '60')}
                style="stroke"
                strokeWidth={0.75}
              />
            )}
            {/* Pull highlight dots */}
            {highlightCoords.map((pt, i) => (
              <Circle key={i} cx={pt.x} cy={pt.y} r={3} color={Skia.Color('#facc15')} />
            ))}
            {/* Inspect crosshair */}
            {inspectPt && (
              <>
                <Line
                  p1={vec(inspectPt.x, CHART_PAD.top)}
                  p2={vec(inspectPt.x, CHART_PAD.top + plotH)}
                  color={Skia.Color(color + '80')}
                  style="stroke"
                  strokeWidth={0.75}
                />
                <Circle cx={inspectPt.x} cy={inspectPt.y} r={4} color={Skia.Color(color)} />
                <Circle cx={inspectPt.x} cy={inspectPt.y} r={2} color={Skia.Color('#ffffff')} />
              </>
            )}
          </Canvas>
        </View>
      </View>
      <View style={[styles.chartAxisRow, { paddingLeft: Y_AXIS_W }]}>
        <Text style={styles.chartAxisLabel}>{fmtTime(minT)}</Text>
        <Text style={styles.chartAxisLabel}>{fmtTime(midT)}</Text>
        <Text style={styles.chartAxisLabel}>{fmtTime(maxT)}</Text>
      </View>
    </View>
  );
}

// ── Main dive detail screen ──────────────────────────────────────────────────

export default function DiveDetailScreen() {
  const params = useLocalSearchParams<{ id: string; sessionId: string; diveJson: string }>();
  const router = useRouter();
  const sessionId = params.sessionId ? Number(params.sessionId) : null;

  const dive: IndividualDive | null = useMemo(() => {
    try { return JSON.parse(params.diveJson ?? ''); }
    catch { return null; }
  }, [params.diveJson]);

  if (!dive) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={{ color: Colors.outline }}>Dive data unavailable.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: Colors.cyan }}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Per-dive notes ──
  const noteKey = `@dive_note_${params.id ?? dive.dive_number}`;
  const pullCountKey = `@dive_pullcount_${params.id ?? dive.dive_number}`;
  const [note, setNote] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [actualPullCount, setActualPullCount] = useState<string>('');
  const [editingPulls, setEditingPulls] = useState(false);
  const [pullDraft, setPullDraft] = useState('');

  // ── Discipline label ──
  const [pickerVisible, setPickerVisible] = useState(false);
  // storedLabel: the discipline saved on the server (already in dive.discipline if set)
  const [storedLabel, setStoredLabel] = useState<Discipline | null>(
    (dive?.discipline as Discipline | null) ?? null,
  );
  const saveLabel = sessionId ? useSaveDisciplineLabel(sessionId) : null;

  useEffect(() => {
    AsyncStorage.getItem(noteKey).then((v) => { if (v) setNote(v); });
    AsyncStorage.getItem(pullCountKey).then((v) => { if (v) setActualPullCount(v); });
  }, [noteKey, pullCountKey]);

  const saveNote = useCallback(async () => {
    const trimmed = noteDraft.trim();
    setNote(trimmed);
    setEditingNote(false);
    Keyboard.dismiss();
    if (trimmed) await AsyncStorage.setItem(noteKey, trimmed);
    else await AsyncStorage.removeItem(noteKey);
  }, [noteDraft, noteKey]);

  const savePullCount = useCallback(async () => {
    const trimmed = pullDraft.trim();
    setActualPullCount(trimmed);
    setEditingPulls(false);
    Keyboard.dismiss();
    if (trimmed) await AsyncStorage.setItem(pullCountKey, trimmed);
    else await AsyncStorage.removeItem(pullCountKey);
  }, [pullDraft, pullCountKey]);

  // If a stored label exists, inject it so classifyDiscipline returns it at high confidence
  const diveForClass: IndividualDive = storedLabel
    ? { ...dive, discipline: storedLabel }
    : dive;
  const cls = classifyDiscipline(diveForClass);
  const isLabelled = storedLabel !== null;
  const discColor = DISC_COLOR[cls.discipline] ?? Colors.outline;
  const pulls = dive.depth_profile ? analyzePulls(dive.depth_profile) : null;
  const stallPulls = dive.depth_profile ? analyzeStallPulls(dive.depth_profile) : null;
  const reflex = dive.hr_profile ? analyzeDiveReflex(dive.hr_profile) : null;
  const freefall = dive.depth_profile && cls.discipline === 'CWT' ? detectFreefall(dive.depth_profile) : null;
  const isFIM = cls.discipline === 'FIM';
  // Only first 3 dives are warmup; later hangs show duration
  const hangLabel = cls.isWarmup
    ? (dive.dive_number <= 3 ? 'WARMUP' : `HANG ${Math.round(cls.bottomHangS)}s`)
    : null;

  return (
    <View style={styles.root}>
      {/* App bar */}
      <View style={styles.appBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.cyan} />
        </TouchableOpacity>
        <Text style={styles.appBarTitle}>DIVE {dive.dive_number}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Header card ── */}
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View style={styles.headerDepthCol}>
              <Text style={styles.headerDepthValue}>
                {dive.max_depth_m.toFixed(1)}
                <Text style={styles.headerDepthUnit}>m</Text>
              </Text>
              <Text style={styles.headerDepthLabel}>MAX DEPTH</Text>
            </View>
            <View style={styles.headerBadges}>
              <TouchableOpacity
                onPress={() => setPickerVisible(true)}
                style={[styles.discBadge, { borderColor: discColor + '60' }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.discText, { color: discColor }]}>{cls.discipline}</Text>
                {isLabelled
                  ? <MaterialIcons name="edit" size={10} color={discColor} style={{ marginLeft: 3 }} />
                  : cls.confidence !== 'high'
                    ? <Text style={styles.discConf}>{cls.confidence === 'medium' ? '~' : '?'}</Text>
                    : null
                }
              </TouchableOpacity>
              {hangLabel && (
                <View style={[styles.discBadge, { borderColor: Colors.orange + '60' }]}>
                  <Text style={[styles.discText, { color: Colors.orange }]}>{hangLabel}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>BOTTOM TIME</Text>
              <Text style={styles.statValue}>{fmtSeconds(dive.bottom_time_s)}</Text>
            </View>
            {dive.descent_time_s != null && (
              <View style={[styles.statCell, styles.statBorder]}>
                <Text style={styles.statLabel}>DESCENT</Text>
                <Text style={styles.statValue}>{fmtSeconds(dive.descent_time_s)}</Text>
                <Text style={styles.statSub}>{(dive.max_depth_m / dive.descent_time_s).toFixed(2)} m/s</Text>
              </View>
            )}
            {dive.ascent_time_s != null && (
              <View style={[styles.statCell, styles.statBorder]}>
                <Text style={styles.statLabel}>ASCENT</Text>
                <Text style={styles.statValue}>{fmtSeconds(dive.ascent_time_s)}</Text>
                <Text style={styles.statSub}>{(dive.max_depth_m / dive.ascent_time_s).toFixed(2)} m/s</Text>
              </View>
            )}
          </View>

          {/* HR row */}
          {(dive.min_hr != null || dive.avg_hr != null) && (
            <View style={styles.hrRow}>
              {dive.min_hr != null && (
                <View style={styles.hrCell}>
                  <Text style={styles.hrLabel}>MIN HR</Text>
                  <Text style={[styles.hrValue, { color: Colors.cyan }]}>{Math.round(dive.min_hr)} <Text style={styles.hrUnit}>bpm</Text></Text>
                </View>
              )}
              {dive.avg_hr != null && (
                <View style={styles.hrCell}>
                  <Text style={styles.hrLabel}>AVG HR</Text>
                  <Text style={styles.hrValue}>{Math.round(dive.avg_hr)} <Text style={styles.hrUnit}>bpm</Text></Text>
                </View>
              )}
              {dive.max_hr != null && (
                <View style={styles.hrCell}>
                  <Text style={styles.hrLabel}>MAX HR</Text>
                  <Text style={styles.hrValue}>{Math.round(dive.max_hr)} <Text style={styles.hrUnit}>bpm</Text></Text>
                </View>
              )}
              {dive.surface_interval_s != null && (
                <View style={styles.hrCell}>
                  <Text style={styles.hrLabel}>SURFACE INT.</Text>
                  <Text style={styles.hrValue}>{fmtSeconds(dive.surface_interval_s)}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Classification reasoning */}
        <View style={styles.clsCard}>
          <MaterialIcons name="psychology" size={13} color={discColor} />
          <Text style={styles.clsText}>{cls.reason}</Text>
        </View>

        {/* ── Depth profile (line chart, inverted) ── */}
        {dive.depth_profile && dive.depth_profile.length > 1 && (
          <LineChart
            data={dive.depth_profile}
            color={discColor}
            label="DEPTH PROFILE"
            unit="m"
            inverted
            height={180}
            highlightPoints={isFIM && pulls ? pulls.pullDetails : undefined}
          />
        )}

        {/* ── HR profile ── */}
        {dive.hr_profile && dive.hr_profile.length > 1 && (
          <LineChart
            data={dive.hr_profile}
            color={Colors.error}
            label="HEART RATE"
            unit="bpm"
            height={140}
          />
        )}

        {/* ── Dive Reflex Analysis ── */}
        {reflex && (
          <View style={styles.reflexCard}>
            <View style={styles.reflexHeader}>
              <MaterialIcons name="favorite" size={14} color={Colors.error} />
              <Text style={styles.reflexTitle}>DIVE REFLEX</Text>
              <View style={[styles.reflexQuality, {
                backgroundColor: reflex.quality === 'excellent' ? '#4ade8020'
                  : reflex.quality === 'strong' ? Colors.cyan + '20'
                  : reflex.quality === 'developing' ? Colors.orange + '20'
                  : Colors.outline + '20',
                borderColor: reflex.quality === 'excellent' ? '#4ade8050'
                  : reflex.quality === 'strong' ? Colors.cyan + '50'
                  : reflex.quality === 'developing' ? Colors.orange + '50'
                  : Colors.outline + '50',
              }]}>
                <Text style={[styles.reflexQualityText, {
                  color: reflex.quality === 'excellent' ? '#4ade80'
                    : reflex.quality === 'strong' ? Colors.cyan
                    : reflex.quality === 'developing' ? Colors.orange
                    : Colors.outline,
                }]}>
                  {reflex.quality.toUpperCase()}
                </Text>
              </View>
            </View>

            {/* Big drop percentage */}
            <View style={styles.reflexBigRow}>
              <Text style={[styles.reflexBigValue, { color: Colors.error }]}>
                -{Math.round(reflex.dropPct)}%
              </Text>
              <View style={styles.reflexBigSub}>
                <Text style={styles.reflexBigLabel}>HR drop</Text>
                <Text style={styles.reflexBigDetail}>
                  {Math.round(reflex.surfaceHR)} → {Math.round(reflex.minHR)} bpm
                </Text>
              </View>
            </View>

            {/* Stats row */}
            <View style={styles.reflexStatsRow}>
              <View style={styles.reflexStat}>
                <Text style={styles.reflexStatLabel}>SURFACE HR</Text>
                <Text style={styles.reflexStatValue}>{Math.round(reflex.surfaceHR)}<Text style={styles.reflexStatUnit}> bpm</Text></Text>
              </View>
              <View style={[styles.reflexStat, styles.statBorder]}>
                <Text style={styles.reflexStatLabel}>MIN HR</Text>
                <Text style={[styles.reflexStatValue, { color: Colors.cyan }]}>{Math.round(reflex.minHR)}<Text style={styles.reflexStatUnit}> bpm</Text></Text>
              </View>
              <View style={[styles.reflexStat, styles.statBorder]}>
                <Text style={styles.reflexStatLabel}>TIME TO MIN</Text>
                <Text style={styles.reflexStatValue}>{Math.round(reflex.timeToMinS)}<Text style={styles.reflexStatUnit}>s</Text></Text>
              </View>
              {reflex.recoveryHR != null && (
                <View style={[styles.reflexStat, styles.statBorder]}>
                  <Text style={styles.reflexStatLabel}>RECOVERY</Text>
                  <Text style={styles.reflexStatValue}>{Math.round(reflex.recoveryHR)}<Text style={styles.reflexStatUnit}> bpm</Text></Text>
                </View>
              )}
            </View>

            {/* Drop rate */}
            <View style={styles.reflexRateRow}>
              <MaterialIcons name="trending-down" size={12} color={Colors.error + '80'} />
              <Text style={styles.reflexRateText}>
                Drop rate: {reflex.dropRatePerS.toFixed(1)} bpm/s
                {reflex.dropRatePerS >= 3 ? ' — rapid onset (trained reflex)' :
                 reflex.dropRatePerS >= 1.5 ? ' — moderate onset' : ' — gradual onset'}
              </Text>
            </View>
          </View>
        )}

        {/* ── Freefall Detection (CWT only) ── */}
        {freefall && (
          <View style={ffStyles.card}>
            <View style={ffStyles.header}>
              <MaterialIcons name="air" size={14} color={Colors.cyan} />
              <Text style={ffStyles.title}>FREEFALL</Text>
              <View style={ffStyles.depthBadge}>
                <Text style={ffStyles.depthBadgeText}>{freefall.freefallDepth.toFixed(1)}m</Text>
              </View>
            </View>

            {/* Visual descent timeline */}
            <View style={ffStyles.timeline}>
              <View style={ffStyles.tlRow}>
                <View style={[ffStyles.tlSegment, {
                  flex: freefall.kickingPct,
                  backgroundColor: Colors.orange + '40',
                  borderColor: Colors.orange + '60',
                }]}>
                  <Text style={[ffStyles.tlLabel, { color: Colors.orange }]}>KICK</Text>
                </View>
                <View style={[ffStyles.tlSegment, {
                  flex: 100 - freefall.kickingPct,
                  backgroundColor: Colors.cyan + '25',
                  borderColor: Colors.cyan + '50',
                }]}>
                  <Text style={[ffStyles.tlLabel, { color: Colors.cyan }]}>FREEFALL</Text>
                </View>
              </View>
              <View style={ffStyles.tlMarks}>
                <Text style={ffStyles.tlMark}>0m</Text>
                <Text style={[ffStyles.tlMark, { color: Colors.cyan }]}>{freefall.freefallDepth.toFixed(0)}m</Text>
                <Text style={ffStyles.tlMark}>{dive.max_depth_m.toFixed(0)}m</Text>
              </View>
            </View>

            {/* Stats grid */}
            <View style={ffStyles.statsRow}>
              <View style={ffStyles.stat}>
                <Text style={ffStyles.statLabel}>FREEFALL AT</Text>
                <Text style={[ffStyles.statValue, { color: Colors.cyan }]}>
                  {freefall.freefallDepth.toFixed(1)}<Text style={ffStyles.statUnit}>m</Text>
                </Text>
              </View>
              <View style={[ffStyles.stat, ffStyles.statBorder]}>
                <Text style={ffStyles.statLabel}>KICK TIME</Text>
                <Text style={ffStyles.statValue}>
                  {Math.round(freefall.kickingDuration)}<Text style={ffStyles.statUnit}>s</Text>
                </Text>
              </View>
              <View style={[ffStyles.stat, ffStyles.statBorder]}>
                <Text style={ffStyles.statLabel}>FALL TIME</Text>
                <Text style={ffStyles.statValue}>
                  {Math.round(freefall.freefallDuration)}<Text style={ffStyles.statUnit}>s</Text>
                </Text>
              </View>
            </View>

            {/* Speed comparison */}
            <View style={ffStyles.speedRow}>
              <View style={ffStyles.speedCol}>
                <Text style={ffStyles.speedLabel}>KICKING</Text>
                <Text style={[ffStyles.speedVal, { color: Colors.orange }]}>
                  {freefall.avgKickingRate.toFixed(2)} m/s
                </Text>
              </View>
              <MaterialIcons name="arrow-forward" size={12} color={Colors.outline} />
              <View style={ffStyles.speedCol}>
                <Text style={ffStyles.speedLabel}>FREEFALL</Text>
                <Text style={[ffStyles.speedVal, { color: Colors.cyan }]}>
                  {freefall.avgFreefallRate.toFixed(2)} m/s
                </Text>
              </View>
              {freefall.speedGain > 1 && (
                <View style={ffStyles.gainBadge}>
                  <Text style={ffStyles.gainText}>+{Math.round((freefall.speedGain - 1) * 100)}%</Text>
                </View>
              )}
            </View>

            {/* Coaching tip */}
            <Text style={ffStyles.tip}>
              {freefall.kickingPct <= 40
                ? 'Excellent — short kick phase means efficient weighting and strong duck dive. You spend most of descent passively sinking.'
                : freefall.kickingPct <= 60
                ? 'Good balance. Freefall starts in the mid-zone. Consider lung packing or slight weight adjustment to start freefall earlier.'
                : 'You\'re kicking for most of the descent. Adding 0.5-1kg of weight or packing more air could lower your freefall depth and save significant O\u2082.'}
            </Text>
          </View>
        )}

        {/* ── Velocity profile ── */}
        {/* Garmin's velocity_profile is firmware-smoothed to near-zero.
            Compute velocity from depth profile for an accurate signal. */}
        {dive.depth_profile && dive.depth_profile.length > 3 && (() => {
          // Check if Garmin velocity data is usable (not all zeros)
          const garminVel = dive.velocity_profile;
          const garminUsable = garminVel && garminVel.length > 2 &&
            garminVel.some(([, v]) => Math.abs(v) > 0.01);
          const velData = garminUsable ? garminVel! : computeVelocityFromDepth(dive.depth_profile!);
          if (velData.length < 2) return null;
          return (
            <LineChart
              data={velData}
              color={Colors.tertiary}
              label={garminUsable ? 'VELOCITY' : 'VELOCITY (from depth)'}
              unit="m/s"
              height={160}
              highlightPoints={isFIM && pulls ? pulls.pullDetails : undefined}
            />
          );
        })()}

        {/* ── Ascent Safety Analysis ── */}
        {dive.depth_profile && dive.depth_profile.length > 5 && dive.max_depth_m >= 5 && (() => {
          const dp = dive.depth_profile!;
          // Find turnaround point (deepest sample)
          let turnIdx = 0;
          let deepest = 0;
          for (let i = 0; i < dp.length; i++) {
            if (dp[i][1] > deepest) { deepest = dp[i][1]; turnIdx = i; }
          }
          // Ascent = from turnaround to surface
          const ascent = dp.slice(turnIdx);
          if (ascent.length < 3) return null;

          // Compute instantaneous ascent speeds in zones
          const speeds: { time: number; depth: number; speed: number }[] = [];
          for (let i = 1; i < ascent.length; i++) {
            const dt = ascent[i][0] - ascent[i - 1][0];
            if (dt <= 0) continue;
            const dDepth = ascent[i - 1][1] - ascent[i][1]; // positive = ascending
            const speed = dDepth / dt;
            if (speed > 0) {
              speeds.push({ time: ascent[i][0], depth: ascent[i][1], speed });
            }
          }
          if (speeds.length < 2) return null;

          const avgSpeed = speeds.reduce((s, v) => s + v.speed, 0) / speeds.length;
          const peakSpeed = Math.max(...speeds.map((s) => s.speed));

          // Shallow zone analysis (top 10m) — most dangerous for blackout
          const shallowSpeeds = speeds.filter((s) => s.depth <= 10);
          const avgShallowSpeed = shallowSpeeds.length > 0
            ? shallowSpeeds.reduce((s, v) => s + v.speed, 0) / shallowSpeeds.length
            : avgSpeed;

          // Deep zone (below 10m)
          const deepSpeeds = speeds.filter((s) => s.depth > 10);
          const avgDeepSpeed = deepSpeeds.length > 0
            ? deepSpeeds.reduce((s, v) => s + v.speed, 0) / deepSpeeds.length
            : avgSpeed;

          // Acceleration in shallow zone (bad — should slow down, not speed up)
          const shallowAccel = avgShallowSpeed > avgDeepSpeed * 1.15;

          // Safety thresholds for freediving ascent
          // Recommended: 0.8-1.0 m/s. Above 1.2 = fast. Above 1.5 = dangerous.
          let rating: 'safe' | 'moderate' | 'fast' | 'dangerous';
          let ratingColor: string;
          if (avgSpeed <= 1.0 && peakSpeed <= 1.4 && !shallowAccel) {
            rating = 'safe';
            ratingColor = '#4ade80';
          } else if (avgSpeed <= 1.2 && peakSpeed <= 1.8) {
            rating = 'moderate';
            ratingColor = Colors.cyan;
          } else if (avgSpeed <= 1.5 || peakSpeed <= 2.2) {
            rating = 'fast';
            ratingColor = Colors.orange;
          } else {
            rating = 'dangerous';
            ratingColor = Colors.error;
          }

          const ratingLabel = {
            safe: 'Controlled',
            moderate: 'Acceptable',
            fast: 'Fast',
            dangerous: 'Too Fast',
          }[rating];

          // Build zone bar data (normalize to 4 depth zones)
          const maxDepthM = dive.max_depth_m;
          const zones = maxDepthM >= 20
            ? [
                { label: `${Math.round(maxDepthM)}-${Math.round(maxDepthM * 0.5)}m`, min: maxDepthM * 0.5, max: maxDepthM },
                { label: `${Math.round(maxDepthM * 0.5)}-10m`, min: 10, max: maxDepthM * 0.5 },
                { label: '10-5m', min: 5, max: 10 },
                { label: '5-0m', min: 0, max: 5 },
              ]
            : [
                { label: `${Math.round(maxDepthM)}-${Math.round(maxDepthM * 0.5)}m`, min: maxDepthM * 0.5, max: maxDepthM },
                { label: `${Math.round(maxDepthM * 0.5)}-0m`, min: 0, max: maxDepthM * 0.5 },
              ];

          const zoneAvgs = zones.map((z) => {
            const zSpeeds = speeds.filter((s) => s.depth >= z.min && s.depth < z.max);
            return zSpeeds.length > 0
              ? zSpeeds.reduce((s, v) => s + v.speed, 0) / zSpeeds.length
              : 0;
          });
          const maxZoneSpeed = Math.max(...zoneAvgs, 0.5);

          return (
            <View style={asStyles.card}>
              <View style={asStyles.header}>
                <MaterialIcons name="speed" size={14} color={ratingColor} />
                <Text style={asStyles.title}>ASCENT SAFETY</Text>
                <View style={[asStyles.badge, { backgroundColor: ratingColor + '20', borderColor: ratingColor + '50' }]}>
                  <Text style={[asStyles.badgeText, { color: ratingColor }]}>{ratingLabel.toUpperCase()}</Text>
                </View>
              </View>

              {/* Zone speed bars */}
              <View style={asStyles.zoneSection}>
                {zones.map((z, i) => {
                  const pct = (zoneAvgs[i] / maxZoneSpeed) * 100;
                  const isShallow = z.max <= 10;
                  const isFast = zoneAvgs[i] > 1.2;
                  const barColor = isFast
                    ? (isShallow ? Colors.error : Colors.orange)
                    : (isShallow ? '#4ade80' : Colors.cyan);
                  return (
                    <View key={i} style={asStyles.zoneRow}>
                      <Text style={asStyles.zoneLabel}>{z.label}</Text>
                      <View style={asStyles.zoneBarTrack}>
                        <View style={[asStyles.zoneBar, {
                          width: `${Math.max(8, pct)}%`,
                          backgroundColor: barColor,
                        } as any]} />
                      </View>
                      <Text style={[asStyles.zoneSpeed, zoneAvgs[i] > 1.2 && { color: Colors.orange }]}>
                        {zoneAvgs[i].toFixed(1)}
                      </Text>
                    </View>
                  );
                })}
                <Text style={asStyles.zoneUnit}>m/s</Text>
              </View>

              {/* Stats */}
              <View style={asStyles.statsRow}>
                <View style={asStyles.stat}>
                  <Text style={asStyles.statLabel}>AVG SPEED</Text>
                  <Text style={[asStyles.statValue, avgSpeed > 1.2 ? { color: Colors.orange } : {}]}>
                    {avgSpeed.toFixed(2)}<Text style={asStyles.statUnit}> m/s</Text>
                  </Text>
                </View>
                <View style={[asStyles.stat, { borderLeftWidth: 1, borderLeftColor: Colors.outlineVariant + '30' }]}>
                  <Text style={asStyles.statLabel}>PEAK SPEED</Text>
                  <Text style={[asStyles.statValue, peakSpeed > 1.5 ? { color: Colors.orange } : {}]}>
                    {peakSpeed.toFixed(2)}<Text style={asStyles.statUnit}> m/s</Text>
                  </Text>
                </View>
                <View style={[asStyles.stat, { borderLeftWidth: 1, borderLeftColor: Colors.outlineVariant + '30' }]}>
                  <Text style={asStyles.statLabel}>SHALLOW ZONE</Text>
                  <Text style={[asStyles.statValue, shallowAccel ? { color: Colors.error } : { color: '#4ade80' }]}>
                    {avgShallowSpeed.toFixed(2)}<Text style={asStyles.statUnit}> m/s</Text>
                  </Text>
                </View>
              </View>

              {/* Safety notes */}
              {shallowAccel && (
                <View style={asStyles.alertRow}>
                  <MaterialIcons name="warning" size={12} color={Colors.error} />
                  <Text style={asStyles.alertText}>
                    Speed increased in shallow zone ({avgShallowSpeed.toFixed(1)} vs {avgDeepSpeed.toFixed(1)} m/s deep). Slow down above 10m to reduce blackout risk.
                  </Text>
                </View>
              )}
              <Text style={asStyles.tip}>
                {rating === 'safe'
                  ? 'Controlled ascent with steady pacing. Good shallow zone discipline.'
                  : rating === 'moderate'
                  ? 'Acceptable speed. Focus on slowing down in the last 10m for extra safety margin.'
                  : rating === 'fast'
                  ? 'Ascent was faster than recommended. Target 0.8-1.0 m/s, especially in the shallow zone where O\u2082 partial pressure drops fastest.'
                  : 'Dangerously fast ascent. The rapid pressure change in shallow water greatly increases blackout risk. Practice controlled, steady ascents.'}
              </Text>
            </View>
          );
        })()}

        {/* ── FIM Pull Analysis ── */}
        {isFIM && (pulls || stallPulls) && (
          <View style={styles.pullCard}>
            <View style={styles.pullHeader}>
              <MaterialIcons name="touch-app" size={14} color={Colors.orange} />
              <Text style={styles.pullTitle}>PULL ANALYSIS</Text>
            </View>

            {/* ── Method comparison header ── */}
            {pulls && stallPulls && (
              <View style={cpStyles.compRow}>
                <View style={cpStyles.compMethod}>
                  <View style={[cpStyles.compDot, { backgroundColor: Colors.orange }]} />
                  <Text style={cpStyles.compLabel}>VELOCITY</Text>
                  <Text style={[cpStyles.compCount, { color: Colors.orange }]}>{pulls.pullCount}</Text>
                </View>
                <View style={cpStyles.compVs}>
                  <Text style={cpStyles.compVsText}>vs</Text>
                </View>
                <View style={cpStyles.compMethod}>
                  <View style={[cpStyles.compDot, { backgroundColor: '#a78bfa' }]} />
                  <Text style={cpStyles.compLabel}>DEPTH STALL</Text>
                  <Text style={[cpStyles.compCount, { color: '#a78bfa' }]}>{stallPulls.pullCount}</Text>
                </View>
              </View>
            )}

            {/* ── Velocity method stats ── */}
            {pulls && (
              <>
                <View style={cpStyles.methodBanner}>
                  <View style={[cpStyles.methodDot, { backgroundColor: Colors.orange }]} />
                  <Text style={cpStyles.methodName}>VELOCITY MEAN-CROSSING</Text>
                  <Text style={cpStyles.methodDesc}>speed bursts above average</Text>
                </View>
                <View style={styles.pullStatsRow}>
                  <View style={styles.pullStat}>
                    <Text style={styles.pullStatValue}>{pulls.pullCount}</Text>
                    <Text style={styles.pullStatLabel}>TOTAL</Text>
                  </View>
                  <View style={[styles.pullStat, styles.statBorder]}>
                    <Text style={[styles.pullStatValue, { color: Colors.orange }]}>{pulls.descentPulls}<Text style={styles.pullStatUnit}> ↓</Text></Text>
                    <Text style={styles.pullStatLabel}>DESC</Text>
                  </View>
                  <View style={[styles.pullStat, styles.statBorder]}>
                    <Text style={[styles.pullStatValue, { color: Colors.cyan }]}>{pulls.ascentPulls}<Text style={styles.pullStatUnit}> ↑</Text></Text>
                    <Text style={styles.pullStatLabel}>ASC</Text>
                  </View>
                  <View style={[styles.pullStat, styles.statBorder]}>
                    <Text style={styles.pullStatValue}>{pulls.avgPullInterval.toFixed(1)}<Text style={styles.pullStatUnit}>s</Text></Text>
                    <Text style={styles.pullStatLabel}>INTERVAL</Text>
                  </View>
                </View>

                {pulls.descentPulls > 0 && (
                  <View style={styles.pullBreakdown}>
                    <Text style={styles.pullBreakdownTitle}>DESCENT ({pulls.descentPulls})</Text>
                    <View style={styles.pullChips}>
                      {pulls.pullDetails
                        .filter((p) => p.phase === 'descent')
                        .map((p, i) => (
                          <View key={i} style={[styles.pullChip, { borderColor: Colors.orange + '40' }]}>
                            <Text style={[styles.pullChipNum, { color: Colors.orange }]}>#{i + 1}</Text>
                            <Text style={styles.pullChipTime}>{p.time.toFixed(0)}s</Text>
                            <Text style={styles.pullChipVel}>+{p.velocityGain.toFixed(2)}</Text>
                          </View>
                        ))}
                    </View>
                  </View>
                )}
                {pulls.ascentPulls > 0 && (
                  <View style={styles.pullBreakdown}>
                    <Text style={styles.pullBreakdownTitle}>ASCENT ({pulls.ascentPulls})</Text>
                    <View style={styles.pullChips}>
                      {pulls.pullDetails
                        .filter((p) => p.phase === 'ascent')
                        .map((p, i) => (
                          <View key={i} style={[styles.pullChip, { borderColor: Colors.cyan + '40' }]}>
                            <Text style={[styles.pullChipNum, { color: Colors.cyan }]}>#{i + 1}</Text>
                            <Text style={styles.pullChipTime}>{p.time.toFixed(0)}s</Text>
                            <Text style={styles.pullChipVel}>+{p.velocityGain.toFixed(2)}</Text>
                          </View>
                        ))}
                    </View>
                  </View>
                )}
              </>
            )}

            {/* ── Depth stall method stats ── */}
            {stallPulls && (
              <>
                <View style={[cpStyles.methodBanner, { marginTop: pulls ? 14 : 0, borderLeftColor: '#a78bfa' }]}>
                  <View style={[cpStyles.methodDot, { backgroundColor: '#a78bfa' }]} />
                  <Text style={cpStyles.methodName}>DEPTH STALL DETECTION</Text>
                  <Text style={cpStyles.methodDesc}>watch pauses as hand reaches for rope</Text>
                </View>
                <View style={styles.pullStatsRow}>
                  <View style={styles.pullStat}>
                    <Text style={styles.pullStatValue}>{stallPulls.pullCount}</Text>
                    <Text style={styles.pullStatLabel}>TOTAL</Text>
                  </View>
                  <View style={[styles.pullStat, styles.statBorder]}>
                    <Text style={[styles.pullStatValue, { color: '#a78bfa' }]}>{stallPulls.descentPulls}<Text style={styles.pullStatUnit}> ↓</Text></Text>
                    <Text style={styles.pullStatLabel}>DESC</Text>
                  </View>
                  <View style={[styles.pullStat, styles.statBorder]}>
                    <Text style={[styles.pullStatValue, { color: '#c4b5fd' }]}>{stallPulls.ascentPulls}<Text style={styles.pullStatUnit}> ↑</Text></Text>
                    <Text style={styles.pullStatLabel}>ASC</Text>
                  </View>
                  <View style={[styles.pullStat, styles.statBorder]}>
                    <Text style={styles.pullStatValue}>{stallPulls.avgStallDuration.toFixed(1)}<Text style={styles.pullStatUnit}>s</Text></Text>
                    <Text style={styles.pullStatLabel}>AVG STALL</Text>
                  </View>
                </View>

                {stallPulls.descentPulls > 0 && (
                  <View style={styles.pullBreakdown}>
                    <Text style={styles.pullBreakdownTitle}>DESCENT STALLS ({stallPulls.descentPulls})</Text>
                    <View style={styles.pullChips}>
                      {stallPulls.pullDetails
                        .filter((p) => p.phase === 'descent')
                        .map((p, i) => (
                          <View key={i} style={[styles.pullChip, { borderColor: '#a78bfa40' }]}>
                            <Text style={[styles.pullChipNum, { color: '#a78bfa' }]}>#{i + 1}</Text>
                            <Text style={styles.pullChipTime}>{p.time.toFixed(0)}s</Text>
                            <Text style={styles.pullChipVel}>{p.stallDepth.toFixed(1)}m</Text>
                          </View>
                        ))}
                    </View>
                  </View>
                )}
                {stallPulls.ascentPulls > 0 && (
                  <View style={styles.pullBreakdown}>
                    <Text style={styles.pullBreakdownTitle}>ASCENT STALLS ({stallPulls.ascentPulls})</Text>
                    <View style={styles.pullChips}>
                      {stallPulls.pullDetails
                        .filter((p) => p.phase === 'ascent')
                        .map((p, i) => (
                          <View key={i} style={[styles.pullChip, { borderColor: '#c4b5fd40' }]}>
                            <Text style={[styles.pullChipNum, { color: '#c4b5fd' }]}>#{i + 1}</Text>
                            <Text style={styles.pullChipTime}>{p.time.toFixed(0)}s</Text>
                            <Text style={styles.pullChipVel}>{p.stallDepth.toFixed(1)}m</Text>
                          </View>
                        ))}
                    </View>
                  </View>
                )}
              </>
            )}

            {/* Actual pull count input */}
            <View style={cpStyles.actualRow}>
              <MaterialIcons name="fact-check" size={13} color={Colors.cyan} />
              <Text style={cpStyles.actualLabel}>ACTUAL PULL COUNT</Text>
              {editingPulls ? (
                <View style={cpStyles.actualInputWrap}>
                  <TextInput
                    style={cpStyles.actualInput}
                    value={pullDraft}
                    onChangeText={setPullDraft}
                    keyboardType="number-pad"
                    placeholder="e.g. 12"
                    placeholderTextColor={Colors.outline + '60'}
                    autoFocus
                    onSubmitEditing={savePullCount}
                    returnKeyType="done"
                  />
                  <TouchableOpacity onPress={savePullCount} style={cpStyles.actualSaveBtn}>
                    <MaterialIcons name="check" size={14} color={Colors.cyan} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => { setPullDraft(actualPullCount); setEditingPulls(true); }}
                  style={cpStyles.actualValueBtn}
                >
                  <Text style={[cpStyles.actualValue, !actualPullCount && { color: Colors.outline }]}>
                    {actualPullCount || 'Tap to record'}
                  </Text>
                  <MaterialIcons name="edit" size={11} color={Colors.outline} />
                </TouchableOpacity>
              )}
            </View>

            {/* Accuracy comparison vs actual */}
            {actualPullCount && (pulls || stallPulls) && (() => {
              const actual = parseInt(actualPullCount, 10);
              if (isNaN(actual) || actual <= 0) return null;
              const velDiff = pulls ? Math.abs(pulls.pullCount - actual) : null;
              const stallDiff = stallPulls ? Math.abs(stallPulls.pullCount - actual) : null;
              const velPct = pulls ? Math.round((1 - Math.abs(pulls.pullCount - actual) / actual) * 100) : null;
              const stallPct = stallPulls ? Math.round((1 - Math.abs(stallPulls.pullCount - actual) / actual) * 100) : null;
              return (
                <View style={cpStyles.accCard}>
                  <Text style={cpStyles.accTitle}>ACCURACY vs ACTUAL ({actual} pulls)</Text>
                  <View style={cpStyles.accRow}>
                    {velPct !== null && (
                      <View style={cpStyles.accCol}>
                        <Text style={[cpStyles.accPct, { color: velPct >= 80 ? '#4ade80' : velPct >= 50 ? '#facc15' : Colors.error }]}>
                          {velPct}%
                        </Text>
                        <Text style={cpStyles.accMethod}>Velocity</Text>
                        <Text style={cpStyles.accDelta}>off by {velDiff}</Text>
                      </View>
                    )}
                    {stallPct !== null && (
                      <View style={cpStyles.accCol}>
                        <Text style={[cpStyles.accPct, { color: stallPct >= 80 ? '#4ade80' : stallPct >= 50 ? '#facc15' : Colors.error }]}>
                          {stallPct}%
                        </Text>
                        <Text style={cpStyles.accMethod}>Depth Stall</Text>
                        <Text style={cpStyles.accDelta}>off by {stallDiff}</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })()}

            {/* Comparison note */}
            {pulls && stallPulls && !actualPullCount && (
              <View style={cpStyles.noteCard}>
                <MaterialIcons name="science" size={12} color={Colors.outline} />
                <Text style={cpStyles.noteText}>
                  Comparing two detection methods. Record your actual pull count above to see which method is more accurate!
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── Dive Notes ── */}
        <View style={dnStyles.card}>
          <View style={dnStyles.header}>
            <MaterialIcons name="edit-note" size={14} color={Colors.outline} />
            <Text style={dnStyles.title}>DIVE NOTES</Text>
            {!editingNote && (
              <TouchableOpacity
                onPress={() => { setNoteDraft(note); setEditingNote(true); }}
                style={dnStyles.editBtn}
              >
                <MaterialIcons name={note ? 'edit' : 'add'} size={12} color={Colors.cyan} />
                <Text style={dnStyles.editBtnText}>{note ? 'EDIT' : 'ADD NOTE'}</Text>
              </TouchableOpacity>
            )}
          </View>
          {editingNote ? (
            <View>
              <TextInput
                style={dnStyles.input}
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="Equalization, technique, conditions, feelings..."
                placeholderTextColor={Colors.outline + '60'}
                multiline
                autoFocus
                textAlignVertical="top"
              />
              <View style={dnStyles.actions}>
                <TouchableOpacity onPress={() => { setEditingNote(false); Keyboard.dismiss(); }} style={dnStyles.cancelBtn}>
                  <Text style={dnStyles.cancelText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveNote} style={dnStyles.saveBtn}>
                  <MaterialIcons name="check" size={12} color={Colors.cyan} />
                  <Text style={dnStyles.saveText}>SAVE</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : note ? (
            <Text style={dnStyles.noteText}>{note}</Text>
          ) : (
            <Text style={dnStyles.emptyText}>Tap ADD NOTE to record observations about this dive</Text>
          )}
        </View>

        {/* ── Next Dive Tips ── */}
        {(() => {
          const tips: { icon: string; color: string; title: string; body: string }[] = [];

          // 1. Ascent speed coaching
          if (dive.depth_profile && dive.depth_profile.length > 5 && dive.max_depth_m >= 5) {
            const dp = dive.depth_profile;
            let turnIdx = 0;
            for (let i = 1; i < dp.length; i++) {
              if (dp[i][1] > dp[turnIdx][1]) turnIdx = i;
            }
            const ascent = dp.slice(turnIdx);
            if (ascent.length >= 3) {
              const speeds: number[] = [];
              for (let i = 1; i < ascent.length; i++) {
                const dt = ascent[i][0] - ascent[i - 1][0];
                if (dt <= 0) continue;
                const spd = (ascent[i - 1][1] - ascent[i][1]) / dt;
                if (spd > 0) speeds.push(spd);
              }
              const avgAsc = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
              if (avgAsc > 1.2) {
                tips.push({
                  icon: 'speed',
                  color: Colors.orange,
                  title: 'Slow your ascent',
                  body: `Average ${avgAsc.toFixed(1)} m/s — target 0.8–1.0 m/s. Count "one-one-thousand" per arm stroke to pace yourself, especially in the last 10m.`,
                });
              } else if (avgAsc <= 1.0 && avgAsc > 0) {
                tips.push({
                  icon: 'speed',
                  color: '#4ade80',
                  title: 'Ascent pace is solid',
                  body: `${avgAsc.toFixed(1)} m/s — well controlled. Maintain this rhythm as you push to deeper dives.`,
                });
              }
            }
          }

          // 2. Freefall coaching (CWT)
          if (freefall) {
            if (freefall.kickingPct > 55) {
              tips.push({
                icon: 'fitness-center',
                color: Colors.orange,
                title: 'Start freefall earlier',
                body: `You kicked for ${Math.round(freefall.kickingPct)}% of the descent. Try adding 0.5kg or packing more air to reach negative buoyancy sooner and save O₂.`,
              });
            } else if (freefall.kickingPct <= 40) {
              tips.push({
                icon: 'air',
                color: Colors.cyan,
                title: 'Great freefall efficiency',
                body: `Only ${Math.round(freefall.kickingPct)}% kicking — most of your descent was passive. Keep this balance on your next dive.`,
              });
            }
          }

          // 3. Dive reflex coaching
          if (reflex) {
            if (reflex.quality === 'developing' || reflex.quality === 'minimal') {
              tips.push({
                icon: 'favorite',
                color: Colors.error,
                title: 'Build your dive reflex',
                body: `HR dropped only ${Math.round(reflex.dropPct)}%. Try a longer, calmer breathe-up (2+ min) with exhale-focused breathing. Face immersion before diving can also prime the reflex.`,
              });
            } else if (reflex.quality === 'excellent') {
              tips.push({
                icon: 'favorite',
                color: '#4ade80',
                title: 'Strong dive reflex',
                body: `${Math.round(reflex.dropPct)}% HR drop — your mammalian dive reflex is well trained. This gives you a larger O₂ reserve at depth.`,
              });
            }
          }

          // 4. Surface interval coaching
          if (dive.surface_interval_s != null && dive.bottom_time_s > 0) {
            const siRatio = dive.surface_interval_s / dive.bottom_time_s;
            if (siRatio < 2) {
              tips.push({
                icon: 'timer',
                color: Colors.error,
                title: 'Extend your surface interval',
                body: `SI was only ${siRatio.toFixed(1)}× bottom time. Aim for at least 2× for working dives and 3× before max attempts to fully reoxygenate.`,
              });
            }
          }

          // 5. FIM pull efficiency
          if (isFIM && pulls && pulls.pullCount > 0 && dive.max_depth_m > 0) {
            const metersPerPull = (dive.max_depth_m * 2) / pulls.pullCount; // total distance / pulls
            if (metersPerPull < 1.5) {
              tips.push({
                icon: 'touch-app',
                color: Colors.orange,
                title: 'Lengthen your pulls',
                body: `~${metersPerPull.toFixed(1)}m per pull — short strokes burn more O₂. Focus on full-length pulls with a brief glide between each.`,
              });
            }
          }

          // Limit to 3 most relevant tips
          const shown = tips.slice(0, 3);
          if (shown.length === 0) return null;

          return (
            <View style={ndStyles.card}>
              <View style={ndStyles.header}>
                <MaterialIcons name="lightbulb" size={14} color="#facc15" />
                <Text style={ndStyles.title}>NEXT DIVE TIPS</Text>
              </View>
              {shown.map((tip, i) => (
                <View key={i} style={[ndStyles.tipRow, i > 0 && ndStyles.tipBorder]}>
                  <View style={[ndStyles.iconWrap, { backgroundColor: tip.color + '18' }]}>
                    <MaterialIcons name={tip.icon as any} size={14} color={tip.color} />
                  </View>
                  <View style={ndStyles.tipContent}>
                    <Text style={[ndStyles.tipTitle, { color: tip.color }]}>{tip.title}</Text>
                    <Text style={ndStyles.tipBody}>{tip.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          );
        })()}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Discipline picker modal ── */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerVisible(false)}
      >
        <Pressable style={pickerStyles.backdrop} onPress={() => setPickerVisible(false)}>
          <Pressable style={pickerStyles.sheet} onPress={() => {}}>
            <Text style={pickerStyles.title}>SET DISCIPLINE</Text>
            <Text style={pickerStyles.sub}>Dive {dive.dive_number} · {dive.max_depth_m.toFixed(1)}m</Text>
            {DISCIPLINES.map((opt) => (
              <TouchableOpacity
                key={opt.value ?? 'auto'}
                style={[
                  pickerStyles.option,
                  (storedLabel === opt.value) && pickerStyles.optionActive,
                ]}
                onPress={async () => {
                  setPickerVisible(false);
                  if (!sessionId || !saveLabel) return;
                  setStoredLabel(opt.value);
                  saveLabel.mutate({ diveNumber: dive.dive_number, discipline: opt.value });
                }}
              >
                <View style={[pickerStyles.dot, { backgroundColor: opt.color }]} />
                <Text style={[pickerStyles.optionText, { color: opt.color }]}>{opt.label}</Text>
                {storedLabel === opt.value && (
                  <MaterialIcons name="check" size={14} color={opt.color} />
                )}
              </TouchableOpacity>
            ))}
            {!sessionId && (
              <Text style={pickerStyles.noSession}>
                Open this dive from a session to save labels.
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    color: Colors.onSurface, fontSize: 11, fontWeight: '700', letterSpacing: 2,
    marginBottom: 4,
  },
  sub: {
    color: Colors.outline, fontSize: 12, marginBottom: 20,
  },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10,
    marginBottom: 4,
  },
  optionActive: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  dot: {
    width: 8, height: 8, borderRadius: 4,
  },
  optionText: {
    flex: 1, fontSize: 14, fontWeight: '500',
  },
  noSession: {
    color: Colors.outline, fontSize: 11, textAlign: 'center', marginTop: 12,
  },
});

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: { justifyContent: 'center', alignItems: 'center' },

  appBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)',
    backgroundColor: Colors.bg,
  },
  backBtn: { width: 36 },
  appBarTitle: { fontSize: 12, fontWeight: '700', color: Colors.cyan, letterSpacing: 3 },

  scroll: { padding: 16, paddingBottom: 80 },

  // Header card
  headerCard: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 16, marginBottom: 12,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  headerDepthCol: {},
  headerDepthValue: { fontSize: 42, fontWeight: '300', color: Colors.onSurface },
  headerDepthUnit: { fontSize: 18, fontWeight: '400', color: Colors.outline },
  headerDepthLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 2, fontWeight: '700', marginTop: 2 },
  headerBadges: { flexDirection: 'row', gap: 6, marginTop: 4 },
  discBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  discText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  discConf: { fontSize: 10, color: Colors.outline },

  statsRow: { flexDirection: 'row', marginBottom: 10 },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  statBorder: { borderLeftWidth: 1, borderLeftColor: Colors.outlineVariant + '30' },
  statLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
  statValue: { fontSize: 16, fontWeight: '700', color: Colors.onSurface },
  statSub: { fontSize: 9, color: Colors.outline, marginTop: 2 },

  hrRow: {
    flexDirection: 'row', gap: 8,
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '25',
    paddingTop: 10,
  },
  hrCell: { flex: 1, alignItems: 'center' },
  hrLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginBottom: 3 },
  hrValue: { fontSize: 13, fontWeight: '600', color: Colors.onSurface },
  hrUnit: { fontSize: 10, fontWeight: '400', color: Colors.outline },

  // Classification
  clsCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.surfaceHigh, borderRadius: 8,
    padding: 10, marginBottom: 14,
  },
  clsText: { fontSize: 11, color: Colors.outline, flex: 1, lineHeight: 16 },

  // Chart
  chartWrap: { marginBottom: 16 },
  chartLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  chartLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 2, fontWeight: '700' },
  chartRange: { fontSize: 9, color: Colors.outline },
  yAxisLabel: {
    position: 'absolute', left: 0, width: Y_AXIS_W - 4,
    fontSize: 8, color: Colors.outline, textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  inspectTooltip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceHighest, borderRadius: 6, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  inspectValue: { fontSize: 12, fontWeight: '700' },
  inspectUnit: { fontSize: 9, fontWeight: '400', color: Colors.outline },
  inspectTime: { fontSize: 9, color: Colors.outline },
  chartAxisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2, paddingHorizontal: 2 },
  chartAxisLabel: { fontSize: 8, color: Colors.outline },

  // Pull analysis
  pullCard: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.orange + '25',
    padding: 14,
  },
  pullHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  pullTitle: { fontSize: 9, color: Colors.orange, letterSpacing: 2.5, fontWeight: '700' },
  pullStatsRow: { flexDirection: 'row', marginBottom: 12 },
  pullStat: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  pullStatValue: { fontSize: 20, fontWeight: '700', color: Colors.onSurface },
  pullStatUnit: { fontSize: 11, fontWeight: '400', color: Colors.outline },
  pullStatLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1, fontWeight: '700', marginTop: 3 },

  pullBreakdown: {
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '25',
    paddingTop: 10,
  },
  pullBreakdownTitle: { fontSize: 8, color: Colors.outline, letterSpacing: 2, fontWeight: '700', marginBottom: 8 },
  pullChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pullChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surfaceHigh, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.orange + '20',
  },
  pullChipNum: { fontSize: 9, color: Colors.orange, fontWeight: '700' },
  pullChipTime: { fontSize: 9, color: Colors.outline },
  pullChipVel: { fontSize: 9, color: Colors.onSurface, fontWeight: '600' },

  // Dive reflex card
  reflexCard: {
    backgroundColor: Colors.glass, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 16, marginBottom: 16,
  },
  reflexHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14,
  },
  reflexTitle: { fontSize: 9, color: Colors.error, letterSpacing: 2.5, fontWeight: '700', flex: 1 },
  reflexQuality: {
    borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  reflexQualityText: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  reflexBigRow: {
    flexDirection: 'row', alignItems: 'baseline', gap: 12, marginBottom: 14,
  },
  reflexBigValue: { fontSize: 36, fontWeight: '700' },
  reflexBigSub: {},
  reflexBigLabel: { fontSize: 12, color: Colors.onSurfaceVariant, fontWeight: '600' },
  reflexBigDetail: { fontSize: 11, color: Colors.outline, marginTop: 1 },
  reflexStatsRow: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '25',
    paddingTop: 10, marginBottom: 10,
  },
  reflexStat: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  reflexStatLabel: { fontSize: 7, color: Colors.outline, letterSpacing: 1, fontWeight: '700', marginBottom: 3 },
  reflexStatValue: { fontSize: 14, fontWeight: '600', color: Colors.onSurface },
  reflexStatUnit: { fontSize: 10, fontWeight: '400', color: Colors.outline },
  reflexRateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceLow, borderRadius: 8, padding: 10,
  },
  reflexRateText: { fontSize: 11, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
});

const asStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 16, marginBottom: 16,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14,
  },
  title: {
    fontSize: 9, letterSpacing: 2.5, fontWeight: '700', flex: 1,
    color: Colors.onSurfaceVariant,
  },
  badge: {
    borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  zoneSection: { marginBottom: 12 },
  zoneRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 6,
  },
  zoneLabel: {
    width: 62, fontSize: 9, color: Colors.outline, letterSpacing: 0.5,
  },
  zoneBarTrack: {
    flex: 1, height: 10, backgroundColor: Colors.surfaceLow,
    borderRadius: 5, overflow: 'hidden', marginRight: 8,
  },
  zoneBar: {
    height: '100%', borderRadius: 5,
  },
  zoneSpeed: {
    width: 28, fontSize: 10, color: Colors.onSurfaceVariant,
    fontWeight: '600', textAlign: 'right', fontVariant: ['tabular-nums'],
  },
  zoneUnit: {
    fontSize: 8, color: Colors.outline, textAlign: 'right',
    marginTop: -2, letterSpacing: 1,
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: Colors.outlineVariant + '25',
    paddingTop: 10, marginBottom: 10,
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  statLabel: {
    fontSize: 7, color: Colors.outline, letterSpacing: 1, fontWeight: '700', marginBottom: 3,
  },
  statValue: { fontSize: 14, fontWeight: '600', color: Colors.onSurface },
  statUnit: { fontSize: 10, fontWeight: '400', color: Colors.outline },
  alertRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.error + '10', borderRadius: 8,
    padding: 10, marginBottom: 8,
  },
  alertText: {
    fontSize: 11, color: Colors.error, flex: 1, lineHeight: 16,
  },
  tip: {
    fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16,
    backgroundColor: Colors.surfaceLow, borderRadius: 8, padding: 10,
  },
});

const cpStyles = StyleSheet.create({
  compRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceLow, borderRadius: 8,
    padding: 10, marginBottom: 14,
  },
  compMethod: { flex: 1, alignItems: 'center', gap: 3 },
  compDot: { width: 6, height: 6, borderRadius: 3 },
  compLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700' },
  compCount: { fontSize: 22, fontWeight: '700' },
  compVs: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.outlineVariant + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  compVsText: { fontSize: 9, color: Colors.outline, fontWeight: '600' },
  methodBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 8,
    borderLeftWidth: 3, borderLeftColor: Colors.orange,
    backgroundColor: Colors.surfaceLow, borderRadius: 4,
    marginBottom: 8,
  },
  methodDot: { width: 5, height: 5, borderRadius: 2.5 },
  methodName: { fontSize: 8, color: Colors.onSurfaceVariant, letterSpacing: 1.5, fontWeight: '700' },
  methodDesc: { fontSize: 9, color: Colors.outline, flex: 1, textAlign: 'right' },
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.surfaceLow, borderRadius: 8,
    padding: 10, marginTop: 12,
  },
  noteText: { fontSize: 11, color: Colors.outline, flex: 1, lineHeight: 16 },
  actualRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surfaceLow, borderRadius: 8,
    padding: 10, marginTop: 12,
  },
  actualLabel: { fontSize: 8, color: Colors.cyan, letterSpacing: 1.5, fontWeight: '700' },
  actualInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actualInput: {
    flex: 1, fontSize: 16, fontWeight: '700', color: Colors.onSurface,
    backgroundColor: Colors.surfaceHigh, borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 4, textAlign: 'center',
  },
  actualSaveBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.cyan + '20',
    alignItems: 'center', justifyContent: 'center',
  },
  actualValueBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
  },
  actualValue: { fontSize: 16, fontWeight: '700', color: Colors.onSurface },
  accCard: {
    backgroundColor: Colors.surfaceLow, borderRadius: 8,
    padding: 10, marginTop: 8,
  },
  accTitle: { fontSize: 8, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginBottom: 8 },
  accRow: { flexDirection: 'row', justifyContent: 'space-around' },
  accCol: { alignItems: 'center' },
  accPct: { fontSize: 20, fontWeight: '700' },
  accMethod: { fontSize: 9, color: Colors.outline, letterSpacing: 1, fontWeight: '600', marginTop: 2 },
  accDelta: { fontSize: 10, color: Colors.outline },
});

const dnStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 16, marginTop: 16,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
  },
  title: {
    fontSize: 9, letterSpacing: 2.5, fontWeight: '700', flex: 1,
    color: Colors.onSurfaceVariant,
  },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, backgroundColor: Colors.cyan + '15',
  },
  editBtnText: { fontSize: 9, color: Colors.cyan, fontWeight: '700', letterSpacing: 1 },
  input: {
    fontSize: 13, color: Colors.onSurface, lineHeight: 20,
    backgroundColor: Colors.surfaceLow, borderRadius: 8,
    padding: 12, minHeight: 80, maxHeight: 160,
    borderWidth: 1, borderColor: Colors.cyan + '30',
  },
  actions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8,
  },
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  cancelText: { fontSize: 10, color: Colors.outline, fontWeight: '600', letterSpacing: 1 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: Colors.cyan + '15', borderRadius: 6,
  },
  saveText: { fontSize: 10, color: Colors.cyan, fontWeight: '700', letterSpacing: 1 },
  noteText: { fontSize: 13, color: Colors.onSurfaceVariant, lineHeight: 20 },
  emptyText: { fontSize: 12, color: Colors.outline, fontStyle: 'italic' },
});

const ffStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.glassBorder,
    padding: 16, marginTop: 16,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14,
  },
  title: {
    fontSize: 9, letterSpacing: 2.5, fontWeight: '700', flex: 1,
    color: Colors.onSurfaceVariant,
  },
  depthBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    backgroundColor: Colors.cyan + '20', borderWidth: 1, borderColor: Colors.cyan + '40',
  },
  depthBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.cyan },
  timeline: { marginBottom: 14 },
  tlRow: {
    flexDirection: 'row', height: 28, borderRadius: 6, overflow: 'hidden', gap: 2,
  },
  tlSegment: {
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderRadius: 6,
  },
  tlLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 1.5 },
  tlMarks: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 2,
  },
  tlMark: { fontSize: 9, color: Colors.outline },
  statsRow: {
    flexDirection: 'row', marginBottom: 12,
  },
  stat: { flex: 1, alignItems: 'center' },
  statBorder: { borderLeftWidth: 1, borderLeftColor: Colors.outlineVariant + '30' },
  statLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 1.5, fontWeight: '700', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '700', color: Colors.onSurface },
  statUnit: { fontSize: 11, fontWeight: '400' },
  speedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    backgroundColor: Colors.surfaceLow, borderRadius: 8, padding: 10, marginBottom: 12,
  },
  speedCol: { alignItems: 'center' },
  speedLabel: { fontSize: 8, color: Colors.outline, letterSpacing: 1.2, fontWeight: '700', marginBottom: 2 },
  speedVal: { fontSize: 13, fontWeight: '700' },
  gainBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: '#4ade8020',
  },
  gainText: { fontSize: 10, fontWeight: '700', color: '#4ade80' },
  tip: {
    fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16,
    backgroundColor: Colors.surfaceLow, borderRadius: 8, padding: 10,
  },
});

// ── Next Dive Tips styles ─────────────────────────────────────────────────────
const ndStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(250,204,21,0.15)',
    padding: 14, marginTop: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12,
  },
  title: {
    fontSize: 10, fontWeight: '700', color: '#facc15',
    letterSpacing: 2,
  },
  tipRow: {
    flexDirection: 'row', gap: 10, paddingVertical: 10,
  },
  tipBorder: {
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)',
  },
  iconWrap: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  tipContent: { flex: 1 },
  tipTitle: {
    fontSize: 12, fontWeight: '700', marginBottom: 3,
  },
  tipBody: {
    fontSize: 11, color: Colors.onSurfaceVariant, lineHeight: 16,
  },
});
