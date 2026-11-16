export function lapTime(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '–';
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(3).padStart(6, '0');
  return m ? `${m}:${rest}` : rest;
}

export function sectorTime(s: number | null | undefined): string {
  return s == null ? '–' : s.toFixed(3);
}

export function clock(s: number): string {
  const neg = s < 0;
  const v = Math.abs(s);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v - h * 3600) / 60);
  const sec = Math.floor(v - h * 3600 - m * 60);
  return `${neg ? '−' : ''}${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function raceTime(s: number | null | undefined): string {
  if (s == null) return '–';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const rest = (s - h * 3600 - m * 60).toFixed(3).padStart(6, '0');
  return `${h}:${String(m).padStart(2, '0')}:${rest}`;
}

/** Gap as shown on a timing tower: seconds, or laps when stored as a negative count. */
export function gap(v: number | null | undefined): string {
  if (v == null) return '';
  if (v < 0) return `${-v}L`;
  if (v === 0) return '';
  return `+${v.toFixed(v >= 100 ? 1 : 3)}`;
}

export function signed(v: number, dp = 3): string {
  const text = Math.abs(v).toFixed(dp);
  if (Number(text) === 0) return text;
  return (v > 0 ? "+" : "−") + text;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).toUpperCase();
}

export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function bytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} kB`;
  return `${n} B`;
}

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export const COMPOUND: Record<string, { letter: string; name: string; colour: string }> = {
  SOFT: { letter: 'S', name: 'Soft', colour: '#FF3B3B' },
  MEDIUM: { letter: 'M', name: 'Medium', colour: '#FFD23F' },
  HARD: { letter: 'H', name: 'Hard', colour: '#EDEBE6' },
  INTERMEDIATE: { letter: 'I', name: 'Intermediate', colour: '#3DDC68' },
  WET: { letter: 'W', name: 'Wet', colour: '#3D8BFF' },
  UNKNOWN: { letter: '?', name: 'Unknown', colour: '#6A6E77' },
};

export const compound = (c: string | undefined) => COMPOUND[c ?? 'UNKNOWN'] ?? COMPOUND.UNKNOWN;

/** Binary search: index of the last element <= value, or -1. */
export function lastAtOrBefore(arr: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Readable text colour for a label sitting on a team colour. */
export function inkOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#07080A' : '#FFFFFF';
}

/** Lift very dark team colours so they stay legible on a near-black surface. */
export function onDark(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum >= 70) return hex;
  const k = (70 - lum) / 255;
  const lift = (c: number) => Math.round(c + (255 - c) * k * 1.6);
  return `#${[lift(r), lift(g), lift(b)].map((c) => clamp(c, 0, 255).toString(16).padStart(2, '0')).join('')}`;
}
