import { useEffect, useMemo, useRef, useState } from 'react';
import { useClockTime } from '../../lib/clock';
import { loadTelemetry } from '../../lib/data';
import { compound, gap, lapTime, lastAtOrBefore, onDark, sectorTime } from '../../lib/format';
import { useApp } from '../../lib/store';
import type { Telemetry } from '../../lib/types';
import { useRace } from '../Race';

const WINDOW = 24; // seconds of history in the trace
const LEDS = 15;

function sample(tel: Telemetry, t: number) {
  const i = lastAtOrBefore(tel.t, t);
  if (i < 0 || t - tel.t[i] > 4) return null;
  const j = Math.min(tel.count - 1, i + 1);
  const span = tel.t[j] - tel.t[i];
  const f = span > 0 ? Math.min(1, (t - tel.t[i]) / span) : 0;
  return {
    speed: tel.speed[i] + (tel.speed[j] - tel.speed[i]) * f,
    rpm: tel.rpm[i] + (tel.rpm[j] - tel.rpm[i]) * f,
    gear: tel.gear[i],
    throttle: tel.throttle[i] + (tel.throttle[j] - tel.throttle[i]) * f,
    brake: tel.brake[i],
    drs: tel.drs[i] >= 10,
  };
}

function Trace({ tel, t, colour }: { tel: Telemetry | null; t: number; colour: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
    }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const pedal = 16;
    const top = 6;
    const plotH = h - pedal - top - 4;
    const yOf = (speed: number) => top + plotH * (1 - Math.min(1, speed / 360));

    g.strokeStyle = 'rgba(237,235,230,0.07)';
    g.lineWidth = 1;
    g.font = '9px "JetBrains Mono Variable", monospace';
    g.fillStyle = 'rgba(237,235,230,0.32)';
    for (const s of [100, 200, 300]) {
      const y = Math.round(yOf(s)) + 0.5;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.fillText(String(s), 2, y - 3);
    }
    if (!tel) return;

    const t0 = t - WINDOW;
    const i0 = Math.max(0, lastAtOrBefore(tel.t, t0));
    const i1 = lastAtOrBefore(tel.t, t);
    if (i1 <= i0) return;
    const xOf = (time: number) => ((time - t0) / WINDOW) * w;

    // pedals: throttle as a green strip, braking as red blocks
    for (let i = i0; i < i1; i++) {
      const x = xOf(tel.t[i]);
      const x2 = xOf(tel.t[i + 1]);
      if (x2 - x > 12) continue;
      if (tel.brake[i] > 0) {
        g.fillStyle = 'rgba(255,59,59,0.9)';
        g.fillRect(x, h - pedal / 2 + 1, x2 - x + 0.6, pedal / 2 - 1);
      }
      if (tel.throttle[i] > 2) {
        g.fillStyle = `rgba(47,224,123,${0.2 + 0.7 * (tel.throttle[i] / 100)})`;
        g.fillRect(x, h - pedal, x2 - x + 0.6, pedal / 2 - 1);
      }
    }

    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(237,235,230,0)');
    grad.addColorStop(0.35, colour);
    grad.addColorStop(1, colour);
    g.strokeStyle = grad;
    g.lineWidth = 1.75;
    g.lineJoin = 'round';
    g.beginPath();
    let pen = false;
    for (let i = i0; i <= i1; i++) {
      const x = xOf(tel.t[i]);
      const y = yOf(tel.speed[i]);
      if (pen && tel.t[i] - tel.t[i - 1] < 3) g.lineTo(x, y);
      else g.moveTo(x, y);
      pen = true;
    }
    g.stroke();

    const now = sample(tel, t);
    if (now) {
      g.fillStyle = colour;
      g.beginPath();
      g.arc(w - 3, yOf(now.speed), 3, 0, Math.PI * 2);
      g.fill();
    }
  }, [tel, t, colour]);

  return <canvas ref={ref} className="dp-trace" role="img" aria-label="Speed, throttle and brake over the last 24 seconds" />;
}

export function DriverPanel() {
  const { session, live } = useRace();
  const { meta } = session;
  const selected = useApp((s) => s.selected);
  const t = useClockTime(15);
  const [tel, setTel] = useState<Telemetry | null>(null);
  const driver = selected != null ? session.byNum.get(selected) : null;

  useEffect(() => {
    setTel(null);
    if (selected == null) return;
    let alive = true;
    loadTelemetry(meta.key, selected).then((x) => alive && setTel(x), () => {});
    return () => {
      alive = false;
    };
  }, [meta.key, selected]);

  const maxRpm = useMemo(() => {
    if (!tel) return 12500;
    let m = 0;
    for (let i = 0; i < tel.count; i += 3) if (tel.rpm[i] > m) m = tel.rpm[i];
    return m || 12500;
  }, [tel]);

  const bestSectors = useMemo(() => {
    const overall = [Infinity, Infinity, Infinity];
    const own = [Infinity, Infinity, Infinity];
    for (const d of meta.drivers) {
      for (const l of meta.laps[d.n] ?? []) {
        l.s.forEach((s, i) => {
          if (s == null) return;
          if (s < overall[i]) overall[i] = s;
          if (d.n === selected && s < own[i]) own[i] = s;
        });
      }
    }
    return { overall, own };
  }, [meta, selected]);

  if (!driver) {
    return (
      <section className="dp panel ticks is-empty">
        <div className="label">No driver selected</div>
        <p>Pick a car on the circuit or a row in the timing tower.</p>
      </section>
    );
  }

  const row = live.rows(t).find((r) => r.n === driver.n)!;
  const now = tel ? sample(tel, t) : null;
  const colour = onDark(driver.colour);
  const tyre = compound(row.compound);
  const lit = now ? Math.round(Math.max(0, Math.min(1, (now.rpm - maxRpm * 0.45) / (maxRpm * 0.53))) * LEDS) : 0;

  const laps = meta.laps[driver.n] ?? [];
  let lastDone = null;
  for (const l of laps) if (l.t != null && l.d != null && l.t + l.d <= t) lastDone = l;

  return (
    <section className="dp panel ticks" style={{ ['--c' as string]: colour }}>
      <div className="dp-head">
        <div className="dp-number num">{driver.n}</div>
        <div className="dp-name">
          <span>{driver.first}</span>
          <b>{driver.last}</b>
          <em>{driver.team}</em>
        </div>
        <div className="dp-pos">
          <span className="label">Pos</span>
          <b className="num">{row.out ? '–' : row.pos}</b>
        </div>
      </div>

      <div className="dp-gauges">
        <div className="dp-speed">
          <b className="num">{now ? Math.round(now.speed) : '–'}</b>
          <span className="label">km/h</span>
        </div>
        <div className="dp-gear">
          <b className="num">{now ? (now.gear === 0 ? 'N' : now.gear) : '–'}</b>
          <span className="label">Gear</span>
        </div>
        <div className="dp-pedals">
          <div className="dp-pedal">
            <span className="label">Thr</span>
            <div className="dp-bar">
              <i style={{ transform: `scaleX(${now ? now.throttle / 100 : 0})`, background: 'var(--green)' }} />
            </div>
          </div>
          <div className="dp-pedal">
            <span className="label">Brk</span>
            <div className="dp-bar">
              <i style={{ transform: `scaleX(${now && now.brake > 0 ? 1 : 0})`, background: 'var(--red)' }} />
            </div>
          </div>
          {meta.hasDrs && (
            <div className={`dp-drs${now?.drs ? ' is-on' : ''}`}>DRS</div>
          )}
        </div>
      </div>

      <div className="dp-leds" aria-label={`Engine speed ${now ? Math.round(now.rpm) : 0} rpm`}>
        {Array.from({ length: LEDS }, (_, i) => (
          <i key={i} className={`${i < lit ? 'is-lit' : ''} ${i < 5 ? 'g' : i < 10 ? 'r' : 'p'}`} />
        ))}
        <span className="num">
          {now ? Math.round(now.rpm / 10) * 10 : '–'}
          <small> rpm</small>
        </span>
      </div>

      <Trace tel={tel} t={t} colour={colour} />

      <div className="dp-grid">
        <div>
          <span className="label">Gap to leader</span>
          <b className="num">{row.out ? 'OUT' : row.pos === 1 ? 'Leader' : gap(row.gap) || '–'}</b>
        </div>
        <div>
          <span className="label">Tyre</span>
          <b>
            <i className="tyre" style={{ ['--tc' as string]: tyre.colour }}>
              {tyre.letter}
            </i>
            <span className="num">{row.tyreAge}</span>
            <small>laps</small>
          </b>
        </div>
        <div>
          <span className="label">Last lap</span>
          <b className={`num rank-${row.lastLapRank}`}>{lapTime(row.lastLap)}</b>
        </div>
        <div>
          <span className="label">Best lap</span>
          <b className="num">{lapTime(row.bestLap)}</b>
        </div>
      </div>

      <div className="dp-sectors">
        {[0, 1, 2].map((i) => {
          const s = lastDone?.s[i] ?? null;
          const cls = s == null ? '' : s <= bestSectors.overall[i] + 1e-4 ? 'rank-2' : s <= bestSectors.own[i] + 1e-4 ? 'rank-1' : 'rank-y';
          return (
            <div key={i} className={cls}>
              <i />
              <span className="label">S{i + 1}</span>
              <b className="num">{sectorTime(s)}</b>
            </div>
          );
        })}
      </div>
    </section>
  );
}
