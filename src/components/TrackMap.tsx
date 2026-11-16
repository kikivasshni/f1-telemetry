import { useEffect, useMemo, useRef } from 'react';
import type { LapGrid } from '../lib/telemetry';
import type { TrackModel } from '../lib/types';

export type MapMode = 'plain' | 'speed' | 'advantage';

interface Props {
  track: TrackModel;
  mode: MapMode;
  a?: LapGrid | null;
  b?: LapGrid | null;
  colourA?: string;
  colourB?: string;
  /** distance from the start line under the cursor */
  cursor?: number | null;
  onCursor?: (d: number | null) => void;
  /** zoom to one stretch of the lap */
  focus?: { from: number; to: number } | null;
  /** highlight one stretch on the full map */
  highlight?: { from: number; to: number } | null;
  lines?: { x: Float32Array; y: Float32Array; colour: string }[];
  miniSectors?: number;
  className?: string;
}

/** Single-hue ramp for speed: dim ember when slow, bright when fast. */
export function speedColour(f: number): string {
  const k = Math.min(1, Math.max(0, f));
  const r = Math.round(70 + 185 * k);
  const g = Math.round(22 + 190 * k ** 1.5);
  const b = Math.round(12 + 120 * k ** 3);
  return `rgb(${r},${g},${b})`;
}

export function TrackMap({ track, mode, a, b, colourA = '#EDEBE6', colourB = '#EDEBE6', cursor, onCursor, focus, highlight, lines, miniSectors = 25, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const layout = useRef<{ px: Float32Array; py: Float32Array; scale: number } | null>(null);

  // rotate the circuit the way broadcast graphics draw it
  const rotated = useMemo(() => {
    const ang = (track.rotation * Math.PI) / 180;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const rot = (x: number, y: number): [number, number] => [x * cos - y * sin, x * sin + y * cos];
    const n = track.x.length;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) [x[i], y[i]] = rot(track.x[i], track.y[i]);
    return { x, y, rot, n };
  }, [track]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const { x, y, n, rot } = rotated;
      const idxOf = (d: number) => Math.min(n - 1, Math.max(0, Math.round(d / track.step)));
      const i0 = focus ? idxOf(focus.from) : 0;
      const i1 = focus ? idxOf(focus.to) : n - 1;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = i0; i <= i1; i++) {
        if (x[i] < minX) minX = x[i];
        if (x[i] > maxX) maxX = x[i];
        if (y[i] < minY) minY = y[i];
        if (y[i] > maxY) maxY = y[i];
      }
      const pad = focus ? 46 : 26;
      const span = Math.max(maxX - minX, 1);
      const spanY = Math.max(maxY - minY, 1);
      const scale = Math.min((w - pad * 2) / span, (h - pad * 2) / spanY);
      const ox = (w - span * scale) / 2 - minX * scale;
      const oy = (h - spanY * scale) / 2 + maxY * scale;
      const px = new Float32Array(n);
      const py = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        px[i] = x[i] * scale + ox;
        py[i] = oy - y[i] * scale;
      }
      layout.current = { px, py, scale };
      const toPx = (wx: number, wy: number): [number, number] => {
        const [rx, ry] = rot(wx, wy);
        return [rx * scale + ox, oy - ry * scale];
      };

      g.lineCap = 'round';
      g.lineJoin = 'round';
      const path = (from: number, to: number) => {
        g.beginPath();
        g.moveTo(px[from], py[from]);
        for (let i = from + 1; i <= to; i++) g.lineTo(px[i], py[i]);
      };
      const base = focus ? Math.min(34, Math.max(12, 13 * scale)) : 7;

      // bed
      path(0, n - 1);
      if (!focus) g.closePath();
      g.strokeStyle = focus ? '#14181d' : 'rgba(237,235,230,0.09)';
      g.lineWidth = base + (focus ? 0 : 5);
      g.stroke();

      if (focus) {
        // kerb lines either side of the asphalt
        g.strokeStyle = 'rgba(237,235,230,0.14)';
        g.lineWidth = base + 3;
        path(0, n - 1);
        g.stroke();
        g.strokeStyle = '#14181d';
        g.lineWidth = base;
        path(0, n - 1);
        g.stroke();
      }

      if (mode === 'speed' && a) {
        let lo = Infinity;
        let hi = 0;
        for (let i = 0; i < a.n; i++) {
          if (a.speed[i] < lo) lo = a.speed[i];
          if (a.speed[i] > hi) hi = a.speed[i];
        }
        g.lineWidth = base;
        for (let i = 0; i < n - 1; i++) {
          const gi = Math.min(a.n - 1, Math.round((i * track.step) / a.step));
          g.strokeStyle = speedColour((a.speed[gi] - lo) / (hi - lo || 1));
          g.beginPath();
          g.moveTo(px[i], py[i]);
          g.lineTo(px[i + 1], py[i + 1]);
          g.stroke();
        }
      } else if (mode === 'advantage' && a && b) {
        const m = Math.min(a.n, b.n);
        g.lineWidth = base;
        for (let s = 0; s < miniSectors; s++) {
          const g0 = Math.floor((s / miniSectors) * (m - 1));
          const g1 = Math.floor(((s + 1) / miniSectors) * (m - 1));
          const ta = a.time[g1] - a.time[g0];
          const tb = b.time[g1] - b.time[g0];
          const from = idxOf(g0 * a.step);
          const to = Math.min(n - 1, idxOf(g1 * a.step));
          if (to <= from) continue;
          g.strokeStyle = Math.abs(ta - tb) < 0.004 ? 'rgba(237,235,230,0.35)' : ta < tb ? colourA : colourB;
          g.lineCap = 'butt';
          path(from, to);
          g.stroke();
          g.lineCap = 'round';
        }
        // small gaps between mini-sectors
        g.fillStyle = '#0b0d10';
        for (let s = 1; s < miniSectors; s++) {
          const i = idxOf(Math.floor((s / miniSectors) * (m - 1)) * a.step);
          g.beginPath();
          g.arc(px[i], py[i], 1.6, 0, Math.PI * 2);
          g.fill();
        }
      } else if (!focus) {
        path(0, n - 1);
        g.closePath();
        g.strokeStyle = 'rgba(237,235,230,0.7)';
        g.lineWidth = 2;
        g.stroke();
      }

      if (highlight) {
        g.strokeStyle = '#FF4B1F';
        g.lineWidth = base + 2;
        path(idxOf(highlight.from), idxOf(highlight.to));
        g.stroke();
      }

      // the lines the cars actually drove
      for (const line of lines ?? []) {
        g.strokeStyle = line.colour;
        g.lineWidth = 2;
        g.beginPath();
        let pen = false;
        for (let i = 0; i < line.x.length; i++) {
          const [lx, ly] = toPx(line.x[i], line.y[i]);
          if (lx < -40 || lx > w + 40 || ly < -40 || ly > h + 40) {
            pen = false;
            continue;
          }
          if (pen) g.lineTo(lx, ly);
          else g.moveTo(lx, ly);
          pen = true;
        }
        g.stroke();
      }

      // start line
      {
        const dx = px[1] - px[0];
        const dy = py[1] - py[0];
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * (base / 2 + 4);
        const ny = (dx / len) * (base / 2 + 4);
        if (!focus || (i0 === 0 && px[0] > 0)) {
          g.strokeStyle = '#EDEBE6';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(px[0] - nx, py[0] - ny);
          g.lineTo(px[0] + nx, py[0] + ny);
          g.stroke();
        }
      }

      // corner numbers
      g.font = '600 9px "JetBrains Mono Variable", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const c of track.corners) {
        if (focus && (c.d < focus.from - 30 || c.d > focus.to + 30)) continue;
        const ang = (c.a * Math.PI) / 180;
        const off = (focus ? 30 : 15) / scale;
        const [cxp, cyp] = toPx(c.x + Math.cos(ang) * off, c.y + Math.sin(ang) * off);
        g.fillStyle = 'rgba(237,235,230,0.42)';
        g.fillText(c.label, cxp, cyp);
      }

      if (cursor != null) {
        const i = idxOf(cursor);
        g.fillStyle = '#07080a';
        g.beginPath();
        g.arc(px[i], py[i], 7, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#EDEBE6';
        g.beginPath();
        g.arc(px[i], py[i], 4.5, 0, Math.PI * 2);
        g.fill();
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [rotated, track, mode, a, b, colourA, colourB, cursor, focus, highlight, lines, miniSectors]);

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current;
    if (!l || !onCursor) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = -1;
    let bestD = 40 * 40;
    for (let i = 0; i < l.px.length; i++) {
      const d = (l.px[i] - mx) ** 2 + (l.py[i] - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    onCursor(best < 0 ? null : best * track.step);
  };

  return <canvas ref={ref} className={`trackmap ${className ?? ''}`} onPointerMove={pick} onPointerLeave={() => onCursor?.(null)} role="img" aria-label="Circuit map" />;
}
