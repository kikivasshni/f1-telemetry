import { useEffect, useRef, useState } from 'react';
import { clock, useClockTime } from '../../lib/clock';
import { onDark } from '../../lib/format';
import { useApp, type CameraMode } from '../../lib/store';
import { useRace } from '../Race';
import { DriverPanel } from './DriverPanel';
import { RaceControlFeed } from './RaceControlFeed';
import { Scene3D } from './Scene3D';
import { TimingTower } from './TimingTower';
import { Transport } from './Transport';

const CAMERAS: { id: CameraMode; label: string }[] = [
  { id: 'circuit', label: 'Circuit' },
  { id: 'follow', label: 'Follow' },
  { id: 'chase', label: 'Chase' },
];

const RATES = [1, 2, 5, 10, 30];

function Weather() {
  const { live } = useRace();
  const t = useClockTime(0.5);
  const w = live.weatherAt(t);
  if (!w) return null;
  return (
    <div className="wx">
      <div>
        <span className="label">Air</span>
        <b className="num">{w.air.toFixed(1)}°</b>
      </div>
      <div>
        <span className="label">Track</span>
        <b className="num">{w.track.toFixed(1)}°</b>
      </div>
      <div>
        <span className="label">Wind</span>
        <b className="num">
          {w.wind.toFixed(1)}
          <small> m/s</small>
        </b>
      </div>
      <div className={w.rain ? 'is-rain' : ''}>
        <span className="label">Sky</span>
        <b>{w.rain ? 'Rain' : 'Dry'}</b>
      </div>
    </div>
  );
}

export function ReplayView() {
  const { session, live } = useRace();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene3D | null>(null);
  const selected = useApp((s) => s.selected);
  const camera = useApp((s) => s.camera);
  const labels = useApp((s) => s.labels);
  const [hover, setHover] = useState<{ n: number; x: number; y: number; speed: number } | null>(null);
  const [webgl, setWebgl] = useState(true);

  useEffect(() => {
    if (!host.current) return;
    try {
      const s = new Scene3D(host.current, session, live, {
        time: () => clock.t,
        onSelect: (n) => useApp.getState().select(n),
        onHover: setHover,
      });
      scene.current = s;
      const app = useApp.getState();
      s.setSelected(app.selected);
      s.setCamera(app.camera);
      s.setLabels(app.labels);
      return () => {
        s.dispose();
        scene.current = null;
      };
    } catch {
      setWebgl(false);
    }
  }, [session, live]);

  useEffect(() => scene.current?.setSelected(selected), [selected]);
  useEffect(() => scene.current?.setCamera(camera), [camera]);
  useEffect(() => scene.current?.setLabels(labels), [labels]);

  // keyboard: the pit wall is driven like a video editor
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
      const app = useApp.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        clock.toggle();
      } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.code === 'ArrowRight' ? 1 : -1;
        clock.seek(clock.t + dir * (e.shiftKey ? 90 : 10));
      } else if (/^Digit[1-5]$/.test(e.code)) {
        clock.setRate(RATES[Number(e.code.slice(5)) - 1]);
      } else if (e.code === 'KeyC') {
        const order: CameraMode[] = ['circuit', 'follow', 'chase'];
        app.setCamera(order[(order.indexOf(app.camera) + 1) % order.length]);
      } else if (e.code === 'KeyL') {
        app.toggleLabels();
      } else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        const rows = live.rows(clock.t).filter((r) => !r.out);
        const i = rows.findIndex((r) => r.n === app.selected);
        const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.code === 'ArrowDown' ? 1 : -1)))];
        if (next) app.select(next.n);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live]);

  const hovered = hover ? session.byNum.get(hover.n) : null;
  const track = session.meta.track;

  return (
    <div className="replay">
      <TimingTower />

      <section className="stage panel ticks">
        <div className="stage-canvas" ref={host} />
        {!webgl && <div className="stage-fallback">This view needs WebGL, which is not available in this browser.</div>}
        <div className="stage-vignette" />
        {(session.meta.pos.coverage ?? 1) < 0.7 && (
          <div className="stage-notice">
            <b>Car positions are incomplete for this race.</b> The source has them for {Math.round((session.meta.pos.coverage ?? 0) * 100)}% of the distance, so cars stop moving on the map. Timing, telemetry and the report are complete.
          </div>
        )}

        <div className="stage-top">
          <div className="seg" role="group" aria-label="Camera">
            {CAMERAS.map((c) => (
              <button key={c.id} className={camera === c.id ? 'is-on' : ''} disabled={c.id !== 'circuit' && selected == null} onClick={() => useApp.getState().setCamera(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="seg">
            <button className={labels ? 'is-on' : ''} onClick={() => useApp.getState().toggleLabels()}>
              Labels
            </button>
          </div>
          <Weather />
        </div>

        <div className="stage-bottom">
          <div className="stage-fact">
            <span className="label">Lap length</span>
            <b className="num">
              {(track.length / 1000).toFixed(3)}
              <small> km</small>
            </b>
          </div>
          <div className="stage-fact">
            <span className="label">Elevation change</span>
            <b className="num">
              {Math.max(...track.z).toFixed(0)}
              <small> m</small>
            </b>
          </div>
          <div className="stage-fact">
            <span className="label">Corners</span>
            <b className="num">{track.corners.length || '–'}</b>
          </div>
          <div className="stage-hint">
            <span className="kbd">drag</span> orbit <span className="kbd">scroll</span> zoom <span className="kbd">C</span> camera
          </div>
        </div>

        {hover && hovered && (
          <div className="tooltip car-tip" style={{ left: hover.x + 16, top: hover.y - 12 }}>
            <i className="team-bar" style={{ ['--c' as string]: onDark(hovered.colour) }} />
            <div>
              <b>
                {hovered.first} {hovered.last}
              </b>
              <span className="dim">{hovered.team}</span>
            </div>
            <div className="car-tip-speed num">
              {Math.round(hover.speed)}
              <small>km/h</small>
            </div>
          </div>
        )}
      </section>

      <aside className="side">
        <DriverPanel />
        <RaceControlFeed />
      </aside>

      <Transport rates={RATES} />
    </div>
  );
}
