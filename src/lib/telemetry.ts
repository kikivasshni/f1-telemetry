import { lastAtOrBefore } from './format';
import type { Corner, Lap, Positions, Telemetry, TrackModel } from './types';
import { carPosition } from './live';

export const GRID_STEP = 4; // metres between samples of a resampled lap

/** One lap resampled onto a uniform distance grid, so two laps can be compared metre for metre. */
export interface LapGrid {
  n: number;
  step: number;
  lapTime: number;
  speed: Float32Array;
  throttle: Float32Array;
  brake: Float32Array;
  gear: Float32Array;
  rpm: Float32Array;
  /** seconds since the start of the lap at each grid point */
  time: Float32Array;
}

export function lapGrid(tel: Telemetry, lap: Lap, trackLength: number): LapGrid | null {
  if (lap.t == null || lap.d == null) return null;
  const t0 = lap.t;
  const t1 = lap.t + lap.d;
  const i0 = Math.max(0, lastAtOrBefore(tel.t, t0));
  const i1 = Math.min(tel.count - 1, lastAtOrBefore(tel.t, t1) + 1);
  if (i1 - i0 < 20) return null;

  // integrate speed to get distance at every native sample inside the lap
  const m = i1 - i0 + 1;
  const dist = new Float64Array(m);
  const time = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const i = i0 + k;
    const a = Math.min(t1, Math.max(t0, tel.t[i]));
    time[k] = a - t0;
    if (k > 0) {
      const prev = Math.min(t1, Math.max(t0, tel.t[i - 1]));
      const v = (tel.speed[i] + tel.speed[i - 1]) / 2 / 3.6;
      dist[k] = dist[k - 1] + v * (a - prev);
    }
  }
  const total = dist[m - 1];
  if (total < trackLength * 0.7 || total > trackLength * 1.3) return null;
  const scale = trackLength / total;

  const n = Math.floor(trackLength / GRID_STEP) + 1;
  const out: LapGrid = {
    n,
    step: GRID_STEP,
    lapTime: lap.d,
    speed: new Float32Array(n),
    throttle: new Float32Array(n),
    brake: new Float32Array(n),
    gear: new Float32Array(n),
    rpm: new Float32Array(n),
    time: new Float32Array(n),
  };
  let k = 0;
  for (let g = 0; g < n; g++) {
    const d = (g * GRID_STEP) / scale;
    while (k < m - 2 && dist[k + 1] < d) k++;
    const span = dist[k + 1] - dist[k];
    const f = span > 0 ? Math.min(1, Math.max(0, (d - dist[k]) / span)) : 0;
    const a = i0 + k;
    const b = a + 1;
    out.speed[g] = tel.speed[a] + (tel.speed[b] - tel.speed[a]) * f;
    out.rpm[g] = tel.rpm[a] + (tel.rpm[b] - tel.rpm[a]) * f;
    out.throttle[g] = tel.throttle[a] + (tel.throttle[b] - tel.throttle[a]) * f;
    out.brake[g] = f < 0.5 ? tel.brake[a] : tel.brake[b];
    out.gear[g] = f < 0.5 ? tel.gear[a] : tel.gear[b];
    out.time[g] = time[k] + (time[k + 1] - time[k]) * f;
  }
  return out;
}

/** Fastest representative lap for a driver: no pit laps, no lap one. */
export function fastestLap(laps: Lap[]): Lap | null {
  let best: Lap | null = null;
  for (const l of laps) {
    if (l.d == null || l.t == null || l.lap === 1 || l.out) continue;
    if (!best || l.d < (best.d as number)) best = l;
  }
  return best;
}

/** timeB - timeA at every grid point: positive means A is ahead on the road. */
export function deltaTime(a: LapGrid, b: LapGrid): Float32Array {
  const n = Math.min(a.n, b.n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.time[i] - a.time[i];
  return out;
}

export interface LapSummary {
  top: number;
  min: number;
  avg: number;
  fullThrottle: number;
  braking: number;
  coasting: number;
}

export function summarise(g: LapGrid): LapSummary {
  let top = 0;
  let min = Infinity;
  let full = 0;
  let brake = 0;
  let coast = 0;
  for (let i = 0; i < g.n; i++) {
    if (g.speed[i] > top) top = g.speed[i];
    if (g.speed[i] < min) min = g.speed[i];
    if (g.throttle[i] >= 98) full++;
    if (g.brake[i] > 0) brake++;
    else if (g.throttle[i] < 5) coast++;
  }
  return { top, min, avg: ((g.n - 1) * g.step) / g.lapTime * 3.6, fullThrottle: full / g.n, braking: brake / g.n, coasting: coast / g.n };
}

// ---- corner analysis -------------------------------------------------------------------

export interface CornerSide {
  brakePoint: number | null; // metres before the apex where braking starts
  entrySpeed: number;
  minSpeed: number;
  apex: number; // distance of the minimum speed
  throttlePoint: number | null; // metres after the apex where full throttle returns
  exitSpeed: number;
  time: number; // seconds through the segment
}

export interface CornerReport {
  corner: Corner;
  from: number;
  to: number;
  a: CornerSide;
  b: CornerSide;
  /** seconds A loses to B through this segment (negative: A gains) */
  loss: number;
  advice: string;
  detail: string;
  kind: 'brake' | 'apex' | 'exit' | 'gain' | 'even';
}

function side(g: LapGrid, from: number, to: number, cornerD: number): CornerSide {
  const idx = (d: number) => Math.min(g.n - 1, Math.max(0, Math.round(d / g.step)));
  const i0 = idx(from);
  const i1 = idx(to);
  // apex: lowest speed near the marked corner
  const c0 = idx(Math.max(from, cornerD - 90));
  const c1 = idx(Math.min(to, cornerD + 90));
  let apexI = c0;
  for (let i = c0; i <= c1; i++) if (g.speed[i] < g.speed[apexI]) apexI = i;

  // walk back from the apex to the start of the braking zone
  let brakeI: number | null = null;
  let seen = false;
  for (let i = apexI; i >= i0; i--) {
    if (g.brake[i] > 0) {
      brakeI = i;
      seen = true;
    } else if (seen && apexI - i > 3) break;
  }
  let throttleI: number | null = null;
  for (let i = apexI; i <= i1; i++) {
    if (g.throttle[i] >= 97) {
      throttleI = i;
      break;
    }
  }
  return {
    brakePoint: brakeI == null ? null : (apexI - brakeI) * g.step,
    entrySpeed: g.speed[brakeI ?? i0],
    minSpeed: g.speed[apexI],
    apex: apexI * g.step,
    throttlePoint: throttleI == null ? null : (throttleI - apexI) * g.step,
    exitSpeed: g.speed[i1],
    time: g.time[i1] - g.time[i0],
  };
}

/**
 * Split the lap into one segment per corner (boundaries halfway between corners) and
 * explain where driver A wins or loses time against driver B.
 */
export function analyseCorners(track: TrackModel, a: LapGrid, b: LapGrid, nameA: string, nameB: string): CornerReport[] {
  // merge corners that sit closer than 70 m into one complex
  const sorted = [...track.corners].sort((x, y) => x.d - y.d);
  const groups: Corner[][] = [];
  for (const c of sorted) {
    const g = groups[groups.length - 1];
    if (g && c.d - g[g.length - 1].d < 70) g.push(c);
    else groups.push([c]);
  }
  const merged: Corner[] = groups.map((g) => {
    const mid = g[Math.floor((g.length - 1) / 2)];
    return { ...mid, label: g.length > 1 ? `${g[0].label}–${g[g.length - 1].label}` : mid.label, d: g.reduce((s, c) => s + c.d, 0) / g.length };
  });

  const L = track.length;
  const out: CornerReport[] = [];
  merged.forEach((corner, i) => {
    const prev = merged[i - 1];
    const next = merged[i + 1];
    const from = prev ? (prev.d + corner.d) / 2 : 0;
    const to = next ? (corner.d + next.d) / 2 : L;
    const sa = side(a, from, to, corner.d);
    const sb = side(b, from, to, corner.d);
    const loss = sa.time - sb.time;

    const brakeDiff = sa.brakePoint != null && sb.brakePoint != null ? sa.brakePoint - sb.brakePoint : 0; // + : A brakes earlier
    const apexDiff = sb.minSpeed - sa.minSpeed; // + : B faster at the apex
    const throttleDiff = sa.throttlePoint != null && sb.throttlePoint != null ? sa.throttlePoint - sb.throttlePoint : 0; // + : A later on throttle
    const exitDiff = sb.exitSpeed - sa.exitSpeed;

    let advice: string;
    let detail: string;
    let kind: CornerReport['kind'];
    const turn = `Turn ${corner.label}`;

    if (Math.abs(loss) < 0.012) {
      kind = 'even';
      advice = `${turn}: nothing in it.`;
      detail = `Both through the apex at ${sa.minSpeed.toFixed(0)} and ${sb.minSpeed.toFixed(0)} km/h.`;
    } else if (loss > 0) {
      // candidate reasons, each scored in comparable units
      const reasons: { score: number; kind: CornerReport['kind']; advice: string; detail: string }[] = [
        {
          score: brakeDiff / 4,
          kind: 'brake',
          advice: `Brake ${brakeDiff.toFixed(0)} m later into ${turn}.`,
          detail: `${nameB} gets on the brakes ${sb.brakePoint?.toFixed(0)} m before the apex, ${nameA} at ${sa.brakePoint?.toFixed(0)} m.`,
        },
        {
          score: apexDiff / 2.5,
          kind: 'apex',
          advice: `Carry ${apexDiff.toFixed(0)} km/h more through the apex of ${turn}.`,
          detail: `Minimum speed ${sa.minSpeed.toFixed(0)} km/h against ${sb.minSpeed.toFixed(0)} km/h for ${nameB}.`,
        },
        {
          score: throttleDiff / 5,
          kind: 'exit',
          advice: `Back to full throttle ${throttleDiff.toFixed(0)} m sooner out of ${turn}.`,
          detail: `${nameB} is flat ${sb.throttlePoint?.toFixed(0)} m after the apex, ${nameA} waits until ${sa.throttlePoint?.toFixed(0)} m.`,
        },
        {
          score: exitDiff / 4,
          kind: 'exit',
          advice: `Find ${exitDiff.toFixed(0)} km/h on the exit of ${turn}.`,
          detail: `Exit speed ${sa.exitSpeed.toFixed(0)} km/h against ${sb.exitSpeed.toFixed(0)} km/h.`,
        },
      ];
      const best = reasons.sort((x, y) => y.score - x.score)[0];
      if (best.score >= 1) {
        ({ kind, advice, detail } = best);
      } else {
        kind = 'apex';
        advice = `${turn}: ${loss.toFixed(3)}s lost with no single cause.`;
        detail = `Small differences on entry, apex and exit add up. Apex ${sa.minSpeed.toFixed(0)} vs ${sb.minSpeed.toFixed(0)} km/h.`;
      }
    } else {
      kind = 'gain';
      const why =
        -brakeDiff >= 5
          ? `braking ${(-brakeDiff).toFixed(0)} m later`
          : -apexDiff >= 3
            ? `${(-apexDiff).toFixed(0)} km/h quicker at the apex`
            : -throttleDiff >= 6
              ? `on the throttle ${(-throttleDiff).toFixed(0)} m sooner`
              : -exitDiff >= 3
                ? `${(-exitDiff).toFixed(0)} km/h better on exit`
                : 'cleaner all the way through';
      advice = `${turn}: keep doing that.`;
      detail = `${nameA} gains here, ${why}.`;
    }

    out.push({ corner, from, to, a: sa, b: sb, loss, advice, detail, kind });
  });
  return out;
}

/** The line a car actually drove during a lap, from the 4 Hz position stream. */
export function lapLine(pos: Positions, driverIndex: number, lap: Lap, step = 0.08): { x: Float32Array; y: Float32Array } | null {
  if (lap.t == null || lap.d == null || driverIndex < 0) return null;
  const n = Math.ceil(lap.d / step) + 1;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const p = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    carPosition(pos, driverIndex, lap.t + Math.min(lap.d, i * step), p);
    x[i] = p.x;
    y[i] = p.y;
  }
  return { x, y };
}

// ---- stint analysis --------------------------------------------------------------------

export interface StintNote {
  from: number;
  to: number;
  compound: string;
  laps: number;
  avg: number | null;
  best: number | null;
  /** seconds per lap the pace changed over the stint (positive: getting slower) */
  slope: number | null;
}

export function stintNotes(laps: Lap[], stints: { a: number; b: number; c: string }[], neutral: { t0: number; t1: number }[]): StintNote[] {
  return stints.map((s) => {
    const clean = laps.filter((l) => {
      if (l.lap < s.a || l.lap > s.b || l.d == null || l.t == null || l.out || l.lap === 1) return false;
      const t0 = l.t;
      const t1 = l.t + l.d;
      return !neutral.some((nz) => t0 < nz.t1 + 20 && t1 > nz.t0 - 5);
    });
    // drop in-laps and other outliers: anything 7% off the stint median
    const sortedD = clean.map((l) => l.d as number).sort((x, y) => x - y);
    const median = sortedD[Math.floor(sortedD.length / 2)];
    const used = clean.filter((l) => (l.d as number) < median * 1.07);
    let slope: number | null = null;
    if (used.length >= 5) {
      const mx = used.reduce((a, l) => a + l.lap, 0) / used.length;
      const my = used.reduce((a, l) => a + (l.d as number), 0) / used.length;
      let num = 0;
      let den = 0;
      for (const l of used) {
        num += (l.lap - mx) * ((l.d as number) - my);
        den += (l.lap - mx) ** 2;
      }
      slope = den ? num / den : null;
    }
    return {
      from: s.a,
      to: s.b,
      compound: s.c,
      laps: s.b - s.a + 1,
      avg: used.length ? used.reduce((a, l) => a + (l.d as number), 0) / used.length : null,
      best: used.length ? Math.min(...used.map((l) => l.d as number)) : null,
      slope,
    };
  });
}
