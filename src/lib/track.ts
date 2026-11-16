import type { TrackModel } from './types';

/** Fast lookups over the track centreline. */
export class TrackGeo {
  readonly n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly step: number;
  readonly length: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly maxZ: number;

  constructor(model: TrackModel) {
    this.n = model.x.length;
    this.x = Float32Array.from(model.x);
    this.y = Float32Array.from(model.y);
    this.z = Float32Array.from(model.z);
    this.step = model.step;
    this.length = model.length;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.x[i] < minX) minX = this.x[i];
      if (this.x[i] > maxX) maxX = this.x[i];
      if (this.y[i] < minY) minY = this.y[i];
      if (this.y[i] > maxY) maxY = this.y[i];
      if (this.z[i] > maxZ) maxZ = this.z[i];
    }
    this.minX = minX;
    this.maxX = maxX;
    this.minY = minY;
    this.maxY = maxY;
    this.maxZ = maxZ;
  }

  get cx() {
    return (this.minX + this.maxX) / 2;
  }
  get cy() {
    return (this.minY + this.maxY) / 2;
  }
  get extent() {
    return Math.max(this.maxX - this.minX, this.maxY - this.minY);
  }

  /** Nearest centreline index. With a hint only a window around it is searched. */
  nearest(x: number, y: number, hint = -1, window = 60): number {
    const n = this.n;
    let best = 0;
    let bestD = Infinity;
    if (hint >= 0) {
      for (let k = -window; k <= window; k++) {
        const i = (hint + k + n) % n;
        const dx = this.x[i] - x;
        const dy = this.y[i] - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (bestD < 80 * 80) return best;
    }
    bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = this.x[i] - x;
      const dy = this.y[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Interpolated centreline point at a distance from the start line. */
  at(distance: number): { x: number; y: number; z: number } {
    const n = this.n;
    const f = (((distance / this.step) % n) + n) % n;
    const i = Math.floor(f);
    const j = (i + 1) % n;
    const k = f - i;
    return {
      x: this.x[i] + (this.x[j] - this.x[i]) * k,
      y: this.y[i] + (this.y[j] - this.y[i]) * k,
      z: this.z[i] + (this.z[j] - this.z[i]) * k,
    };
  }
}
