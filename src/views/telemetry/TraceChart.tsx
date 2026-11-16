import { useEffect, useRef, useState } from 'react';
import { signed } from '../../lib/format';
import type { TrackModel } from '../../lib/types';
import type { PairSide } from './shared';

interface PanelSpec {
  id: 'speed' | 'delta' | 'throttle' | 'brake' | 'gear';
  title: string;
  unit: string;
  weight: number;
}

const PANELS: PanelSpec[] = [
  { id: 'speed', title: 'Speed', unit: 'km/h', weight: 3.3 },
  { id: 'delta', title: 'Time delta', unit: 's', weight: 1.7 },
  { id: 'throttle', title: 'Throttle', unit: '%', weight: 1.2 },
  { id: 'brake', title: 'Brake', unit: '', weight: 0.7 },
  { id: 'gear', title: 'Gear', unit: '', weight: 1.15 },
];

const GUTTER = 46;
const RIGHT = 14;
const TOP = 36;
const BOTTOM = 24;
const GAP = 12;
const INK = '237,235,230';
const MONO = '"JetBrains Mono Variable", monospace';
const SANS = '"Archivo Variable", sans-serif';

interface Props {
  a: PairSide;
  b: PairSide;
  delta: Float32Array | null;
  track: TrackModel;
  cursor: number | null;
  onCursor: (d: number | null) => void;
  view: [number, number];
  onView: (v: [number, number]) => void;
}

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
}

export function TraceChart({ a, b, delta, track, cursor, onCursor, view, onView }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; view: [number, number] } | null>(null);
  const L = track.length;

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = Math.max(10, size.w - GUTTER - RIGHT);
  const xOf = (d: number) => GUTTER + ((d - view[0]) / (view[1] - view[0])) * plotW;
  const dOf = (px: number) => view[0] + ((px - GUTTER) / plotW) * (view[1] - view[0]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !size.w || !size.h) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);

    const ga = a.grid;
    const gb = b.grid;
    const total = PANELS.reduce((s, p) => s + p.weight, 0);
    const availH = size.h - TOP - BOTTOM - GAP * (PANELS.length - 1);
    let y = TOP;
    const boxes = PANELS.map((p) => {
      const h = (availH * p.weight) / total;
      const box = { ...p, y, h };
      y += h + GAP;
      return box;
    });
    const plotBottom = y - GAP;

    // ---- vertical guides: sectors and corners --------------------------------------
    g.textBaseline = 'alphabetic';
    const sectors = [0, ...track.sectors, L];
    for (let s = 0; s < sectors.length - 1; s++) {
      const x0 = Math.max(GUTTER, xOf(sectors[s]));
      const x1 = Math.min(size.w - RIGHT, xOf(sectors[s + 1]));
      if (x1 <= x0) continue;
      if (s % 2 === 1) {
        g.fillStyle = `rgba(${INK},0.022)`;
        g.fillRect(x0, TOP, x1 - x0, plotBottom - TOP);
      }
      g.fillStyle = `rgba(${INK},0.3)`;
      g.font = `600 9px ${SANS}`;
      g.textAlign = 'left';
      if (x1 - x0 > 60) g.fillText(`SECTOR ${s + 1}`, x0 + 4, 11);
    }
    g.font = `500 9px ${MONO}`;
    g.textAlign = 'center';
    let lastLabelX = -99;
    for (const c of track.corners) {
      const x = xOf(c.d);
      if (x < GUTTER || x > size.w - RIGHT) continue;
      g.strokeStyle = `rgba(${INK},0.08)`;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, TOP - 4);
      g.lineTo(Math.round(x) + 0.5, plotBottom);
      g.stroke();
      g.setLineDash([]);
      if (x - lastLabelX > 15) {
        g.fillStyle = `rgba(${INK},0.5)`;
        g.fillText(c.label, x, TOP - 7);
        lastLabelX = x;
      }
    }

    const i0 = (grid: { n: number; step: number }) => Math.max(0, Math.floor(view[0] / grid.step) - 1);
    const i1 = (grid: { n: number; step: number }) => Math.min(grid.n - 1, Math.ceil(view[1] / grid.step) + 1);

    for (const p of boxes) {
      // ---- scale ----------------------------------------------------------------
      let lo = 0;
      let hi = 100;
      if (p.id === 'speed') {
        lo = Infinity;
        hi = 0;
        for (const grid of [ga, gb]) {
          if (!grid) continue;
          for (let i = i0(grid); i <= i1(grid); i++) {
            if (grid.speed[i] < lo) lo = grid.speed[i];
            if (grid.speed[i] > hi) hi = grid.speed[i];
          }
        }
        if (!Number.isFinite(lo)) [lo, hi] = [0, 340];
        lo = Math.floor((lo - 8) / 20) * 20;
        hi = Math.ceil((hi + 8) / 20) * 20;
      } else if (p.id === 'delta') {
        let m = 0.05;
        if (delta && ga) for (let i = i0(ga); i <= Math.min(delta.length - 1, i1(ga)); i++) m = Math.max(m, Math.abs(delta[i]));
        hi = m * 1.18;
        lo = -hi;
      } else if (p.id === 'gear') {
        lo = 0.5;
        hi = 8.5;
      } else if (p.id === 'brake') {
        lo = 0;
        hi = 1;
      }
      const yOf = (v: number) => p.y + p.h * (1 - (v - lo) / (hi - lo));

      g.save();
      g.beginPath();
      g.rect(0, p.y - 1, size.w, p.h + 2);
      g.clip();

      // ---- grid + y ticks -------------------------------------------------------
      g.font = `400 9px ${MONO}`;
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      const ticks: number[] = [];
      if (p.id === 'speed') {
        const st = niceStep(hi - lo, 5);
        for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) ticks.push(v);
      } else if (p.id === 'delta') {
        const st = niceStep(hi - lo, 4);
        for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) ticks.push(Math.abs(v) < 1e-9 ? 0 : v);
      } else if (p.id === 'throttle') ticks.push(0, 50, 100);
      else if (p.id === 'gear') ticks.push(2, 4, 6, 8);
      for (const v of ticks) {
        const yy = Math.round(yOf(v)) + 0.5;
        g.strokeStyle = `rgba(${INK},${p.id === 'delta' && v === 0 ? 0.3 : 0.06})`;
        g.beginPath();
        g.moveTo(GUTTER, yy);
        g.lineTo(size.w - RIGHT, yy);
        g.stroke();
        g.fillStyle = `rgba(${INK},0.36)`;
        g.fillText(p.id === 'delta' ? (v === 0 ? '0' : signed(v, 2)) : String(Math.round(v)), GUTTER - 7, yy);
      }

      // ---- series ---------------------------------------------------------------
      const line = (grid: NonNullable<typeof ga>, values: Float32Array, colour: string, width: number, stepped = false) => {
        g.strokeStyle = colour;
        g.lineWidth = width;
        g.lineJoin = 'round';
        g.beginPath();
        const from = i0(grid);
        const to = Math.min(values.length - 1, i1(grid));
        for (let i = from; i <= to; i++) {
          const x = xOf(i * grid.step);
          const yy = yOf(values[i]);
          if (i === from) g.moveTo(x, yy);
          else if (stepped) {
            g.lineTo(x, yOf(values[i - 1]));
            g.lineTo(x, yy);
          } else g.lineTo(x, yy);
        }
        g.stroke();
      };

      if (p.id === 'delta' && delta && ga) {
        const from = i0(ga);
        const to = Math.min(delta.length - 1, i1(ga));
        const zero = yOf(0);
        // fill toward whoever is ahead
        for (const [colour, positive] of [[a.colour, true], [b.colour, false]] as const) {
          g.save();
          g.beginPath();
          g.rect(GUTTER, positive ? p.y : zero, plotW, positive ? zero - p.y : p.y + p.h - zero);
          g.clip();
          g.beginPath();
          g.moveTo(xOf(from * ga.step), zero);
          for (let i = from; i <= to; i++) g.lineTo(xOf(i * ga.step), yOf(delta[i]));
          g.lineTo(xOf(to * ga.step), zero);
          g.closePath();
          g.globalAlpha = 0.2;
          g.fillStyle = colour;
          g.fill();
          g.restore();
        }
        line(ga, delta, `rgb(${INK})`, 1.5);
      } else if (p.id === 'brake') {
        const half = p.h / 2 - 1.5;
        const blocks = (grid: NonNullable<typeof ga>, top: number, colour: string) => {
          g.fillStyle = `rgba(${INK},0.05)`;
          g.fillRect(GUTTER, top, plotW, half);
          g.fillStyle = colour;
          let start = -1;
          const to = i1(grid);
          for (let i = i0(grid); i <= to + 1; i++) {
            const on = i <= to && grid.brake[i] > 0;
            if (on && start < 0) start = i;
            if (!on && start >= 0) {
              const x0 = Math.max(GUTTER, xOf((start - 0.5) * grid.step));
              const x1 = Math.min(size.w - RIGHT, xOf((i - 0.5) * grid.step));
              if (x1 > x0) g.fillRect(x0, top, Math.max(1, x1 - x0), half);
              start = -1;
            }
          }
        };
        if (ga) blocks(ga, p.y, a.colour);
        if (gb) blocks(gb, p.y + half + 3, b.colour);
      } else if (p.id !== 'delta') {
        const key = p.id as 'speed' | 'throttle' | 'gear';
        if (gb) line(gb, gb[key], b.colour, 1.5, p.id === 'gear');
        if (ga) line(ga, ga[key], a.colour, 1.75, p.id === 'gear');
      }
      g.restore();

      // ---- panel title ----------------------------------------------------------
      g.font = `600 9px ${SANS}`;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      const title = `${p.title.toUpperCase()}${p.unit ? `  ${p.unit}` : ''}`;
      const tw = g.measureText(title).width;
      g.fillStyle = 'rgba(11,13,16,0.85)';
      g.fillRect(GUTTER + 4, p.y + 3, tw + 8, 13);
      g.fillStyle = `rgba(${INK},0.55)`;
      g.fillText(title, GUTTER + 8, p.y + 5);
      if (p.id === 'delta') {
        g.textAlign = 'right';
        g.fillStyle = `rgba(${INK},0.4)`;
        g.fillText(`▲ ${a.driver.code} AHEAD    ▼ ${b.driver.code} AHEAD`, size.w - RIGHT - 4, p.y + 5);
      }
    }

    // ---- x axis -----------------------------------------------------------------
    g.font = `400 9px ${MONO}`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const xs = niceStep(view[1] - view[0], Math.max(4, Math.floor(plotW / 110)));
    for (let d = Math.ceil(view[0] / xs) * xs; d <= view[1]; d += xs) {
      const x = xOf(d);
      g.fillStyle = `rgba(${INK},0.36)`;
      g.fillText(`${Math.round(d)} m`, x, plotBottom + 8);
      g.strokeStyle = `rgba(${INK},0.2)`;
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, plotBottom);
      g.lineTo(Math.round(x) + 0.5, plotBottom + 4);
      g.stroke();
    }

    // ---- crosshair --------------------------------------------------------------
    if (cursor != null && cursor >= view[0] && cursor <= view[1]) {
      const x = Math.round(xOf(cursor)) + 0.5;
      g.strokeStyle = `rgba(${INK},0.55)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, TOP - 4);
      g.lineTo(x, plotBottom);
      g.stroke();
    }
  }, [a, b, delta, track, cursor, view, size, L, plotW]); // eslint-disable-line react-hooks/exhaustive-deps

  // wheel zoom needs a non-passive listener
  useEffect(() => {
    const el = wrap.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const at = dOf(e.clientX - rect.left);
      const k = Math.exp(e.deltaY * 0.0015);
      const span = Math.min(L, Math.max(120, (view[1] - view[0]) * k));
      const f = (at - view[0]) / (view[1] - view[0]);
      let v0 = at - span * f;
      v0 = Math.max(0, Math.min(L - span, v0));
      onView([v0, v0 + span]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const readout = (() => {
    if (cursor == null || !a.grid) return null;
    const ia = Math.min(a.grid.n - 1, Math.round(cursor / a.grid.step));
    const ib = b.grid ? Math.min(b.grid.n - 1, Math.round(cursor / b.grid.step)) : 0;
    const corner = track.corners.find((c) => Math.abs(c.d - cursor) < 45);
    return { ia, ib, corner, x: xOf(cursor) };
  })();

  return (
    <div
      className="tracechart"
      ref={wrap}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, view };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        if (drag.current && Math.abs(e.clientX - drag.current.x) > 3) {
          const span = drag.current.view[1] - drag.current.view[0];
          const shift = ((drag.current.x - e.clientX) / plotW) * span;
          const v0 = Math.max(0, Math.min(L - span, drag.current.view[0] + shift));
          onView([v0, v0 + span]);
        }
        onCursor(px >= GUTTER && px <= size.w - RIGHT ? Math.max(0, Math.min(L, dOf(px))) : null);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => !drag.current && onCursor(null)}
      onDoubleClick={() => onView([0, L])}
    >
      <canvas ref={ref} style={{ width: '100%', height: '100%' }} role="img" aria-label={`Telemetry traces for ${a.driver.code} and ${b.driver.code} against lap distance`} />
      {readout && a.grid && (
        <div className={`tooltip trace-tip${readout.x > size.w * 0.62 ? ' is-left' : ''}`} style={{ left: readout.x }}>
          <div className="trace-tip-head num">
            {Math.round(cursor!)} m{readout.corner ? ` · Turn ${readout.corner.label}` : ''}
          </div>
          <table>
            <thead>
              <tr>
                <th />
                <th>
                  <i style={{ background: a.colour }} />
                  {a.driver.code}
                </th>
                {b.grid && (
                  <th>
                    <i style={{ background: b.colour }} />
                    {b.driver.code}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="num">
              <tr>
                <td>Speed</td>
                <td>{a.grid.speed[readout.ia].toFixed(0)}</td>
                {b.grid && <td>{b.grid.speed[readout.ib].toFixed(0)}</td>}
              </tr>
              <tr>
                <td>Throttle</td>
                <td>{a.grid.throttle[readout.ia].toFixed(0)}%</td>
                {b.grid && <td>{b.grid.throttle[readout.ib].toFixed(0)}%</td>}
              </tr>
              <tr>
                <td>Brake</td>
                <td>{a.grid.brake[readout.ia] > 0 ? 'on' : '–'}</td>
                {b.grid && <td>{b.grid.brake[readout.ib] > 0 ? 'on' : '–'}</td>}
              </tr>
              <tr>
                <td>Gear</td>
                <td>{a.grid.gear[readout.ia]}</td>
                {b.grid && <td>{b.grid.gear[readout.ib]}</td>}
              </tr>
            </tbody>
          </table>
          {delta && readout.ia < delta.length && (
            <div className="trace-tip-delta num">
              {Math.abs(delta[readout.ia]) < 0.0005 ? 'level' : `${(delta[readout.ia] > 0 ? a : b).driver.code} ahead by ${Math.abs(delta[readout.ia]).toFixed(3)}s`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
