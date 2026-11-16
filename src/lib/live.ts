import { lastAtOrBefore } from './format';
import type { Positions, Session, TrackStatus, WeatherSample } from './types';

export interface TowerRow {
  n: number;
  pos: number;
  gap: number | null;
  interval: number | null;
  lap: number;
  compound: string;
  tyreAge: number;
  lastLap: number | null;
  /** 2 = fastest of the race so far, 1 = personal best, 0 = neither */
  lastLapRank: 0 | 1 | 2;
  bestLap: number | null;
  stops: number;
  inPit: boolean;
  out: boolean;
  gained: number;
}

interface DriverIndex {
  posT: Float32Array;
  posV: Uint8Array;
  lapT: Float32Array;
  lapEnd: Float32Array;
  lapD: Float32Array;
  lapNo: Uint16Array;
  bestSoFar: Float32Array;
  gapT: Float32Array;
  pitExit: Float32Array;
  pitEntry: Float32Array;
  outAt: number | null;
  grid: number;
}

/** Pre-indexed timing data so the state of the race at any instant is a few binary searches. */
export class LiveTiming {
  private idx = new Map<number, DriverIndex>();
  private bestEnds: Float32Array;
  private bestTimes: Float32Array;

  constructor(private session: Session) {
    const { meta, timing } = session;
    const allLaps: { end: number; d: number }[] = [];

    for (const d of meta.drivers) {
      const p = timing.positions[d.n] ?? [];
      const laps = (meta.laps[d.n] ?? []).filter((l) => l.t != null);
      const lapD = Float32Array.from(laps.map((l) => l.d ?? NaN));
      const lapT = Float32Array.from(laps.map((l) => l.t as number));
      const lapEnd = Float32Array.from(laps.map((l) => (l.t as number) + (l.d ?? Infinity)));
      const bestSoFar = new Float32Array(laps.length);
      let best = Infinity;
      laps.forEach((l, i) => {
        if (l.d != null && l.lap > 1 && l.d < best) best = l.d;
        bestSoFar[i] = best;
        if (l.d != null && l.lap > 1) allLaps.push({ end: (l.t as number) + l.d, d: l.d });
      });
      const pits = meta.pits.filter((x) => x.n === d.n && x.t > meta.raceStart && x.lane != null && x.lane < 600);
      const cls = meta.classification.find((c) => c.n === d.n);
      this.idx.set(d.n, {
        posT: Float32Array.from(p.map((e) => e[0])),
        posV: Uint8Array.from(p.map((e) => e[1])),
        lapT,
        lapEnd,
        lapD,
        lapNo: Uint16Array.from(laps.map((l) => l.lap)),
        bestSoFar,
        gapT: Float32Array.from(timing.gaps[d.n]?.t ?? []),
        pitExit: Float32Array.from(pits.map((x) => x.t)),
        pitEntry: Float32Array.from(pits.map((x) => x.t - (x.lane as number))),
        outAt: cls?.outAt ?? null,
        grid: cls?.grid ?? 0,
      });
    }

    allLaps.sort((a, b) => a.end - b.end);
    this.bestEnds = Float32Array.from(allLaps.map((l) => l.end));
    this.bestTimes = new Float32Array(allLaps.length);
    let running = Infinity;
    allLaps.forEach((l, i) => {
      running = Math.min(running, l.d);
      this.bestTimes[i] = running;
    });
  }

  /** Fastest lap completed anywhere in the field by time t. */
  fastestBy(t: number): number {
    const i = lastAtOrBefore(this.bestEnds, t);
    return i < 0 ? Infinity : this.bestTimes[i];
  }

  /** Lap the leader is on at time t. */
  raceLap(t: number): number {
    let lap = 0;
    for (const ix of this.idx.values()) {
      const i = lastAtOrBefore(ix.lapT, t);
      if (i >= 0 && ix.lapNo[i] > lap) lap = ix.lapNo[i];
    }
    return Math.min(this.session.meta.totalLaps, Math.max(t >= this.session.meta.raceStart ? 1 : 0, lap));
  }

  rows(t: number): TowerRow[] {
    const { meta, timing } = this.session;
    const fastest = this.fastestBy(t);
    const rows: TowerRow[] = [];

    for (const d of meta.drivers) {
      const ix = this.idx.get(d.n)!;
      const pi = lastAtOrBefore(ix.posT, t);
      const pos = pi >= 0 ? ix.posV[pi] : ix.grid || 99;

      const li = lastAtOrBefore(ix.lapT, t);
      const lap = li >= 0 ? ix.lapNo[li] : 0;

      // last completed lap
      let done = li;
      if (done >= 0 && ix.lapEnd[done] > t) done--;
      const lastLap = done >= 0 && Number.isFinite(ix.lapD[done]) ? ix.lapD[done] : null;
      const bestLap = done >= 0 && Number.isFinite(ix.bestSoFar[done]) ? ix.bestSoFar[done] : null;
      let rank: 0 | 1 | 2 = 0;
      if (lastLap != null && bestLap != null && lastLap <= bestLap + 1e-4 && ix.lapNo[done] > 1) {
        rank = lastLap <= fastest + 1e-4 ? 2 : 1;
      }

      const stint = meta.stints.find((s) => s.n === d.n && lap >= s.a && lap <= s.b) ?? meta.stints.filter((s) => s.n === d.n && s.a <= Math.max(1, lap)).pop();

      const g = timing.gaps[d.n];
      const gi = lastAtOrBefore(ix.gapT, t);
      const racing = t >= meta.raceStart;

      let inPit = false;
      let stops = 0;
      for (let k = 0; k < ix.pitExit.length; k++) {
        if (t >= ix.pitEntry[k] && t <= ix.pitExit[k]) inPit = true;
        if (t >= ix.pitEntry[k]) stops++;
      }

      rows.push({
        n: d.n,
        pos,
        gap: racing && gi >= 0 ? g.gap[gi] : null,
        interval: racing && gi >= 0 ? g.int[gi] : null,
        lap,
        compound: stint?.c ?? 'UNKNOWN',
        tyreAge: stint ? stint.age + Math.max(0, lap - stint.a) : 0,
        lastLap,
        lastLapRank: rank,
        bestLap,
        stops,
        inPit,
        out: ix.outAt != null && t >= ix.outAt,
        gained: ix.grid ? ix.grid - pos : 0,
      });
    }

    rows.sort((a, b) => Number(a.out) - Number(b.out) || a.pos - b.pos);
    return rows;
  }

  statusAt(t: number): TrackStatus | null {
    return this.session.meta.trackStatus.find((s) => t >= s.t0 && t <= s.t1) ?? null;
  }

  weatherAt(t: number): WeatherSample | null {
    const w = this.session.meta.weather;
    let cur: WeatherSample | null = w[0] ?? null;
    for (const s of w) {
      if (s.t > t) break;
      cur = s;
    }
    return cur;
  }

  isOut(n: number, t: number): boolean {
    const o = this.idx.get(n)?.outAt;
    return o != null && t >= o;
  }
}

/** Smooth car position between the 4 Hz samples (Catmull-Rom). */
export function carPosition(pos: Positions, driverIndex: number, t: number, out: { x: number; y: number }) {
  const xs = pos.x[driverIndex];
  const ys = pos.y[driverIndex];
  const f = Math.min(pos.samples - 1.001, Math.max(0, t / pos.dt));
  const i1 = Math.floor(f);
  const u = f - i1;
  const i0 = Math.max(0, i1 - 1);
  const i2 = Math.min(pos.samples - 1, i1 + 1);
  const i3 = Math.min(pos.samples - 1, i1 + 2);
  const u2 = u * u;
  const u3 = u2 * u;
  const c0 = -0.5 * u3 + u2 - 0.5 * u;
  const c1 = 1.5 * u3 - 2.5 * u2 + 1;
  const c2 = -1.5 * u3 + 2 * u2 + 0.5 * u;
  const c3 = 0.5 * u3 - 0.5 * u2;
  out.x = xs[i0] * c0 + xs[i1] * c1 + xs[i2] * c2 + xs[i3] * c3;
  out.y = ys[i0] * c0 + ys[i1] * c1 + ys[i2] * c2 + ys[i3] * c3;
  return out;
}
