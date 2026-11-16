import { useEffect, useMemo, useRef, useState } from 'react';
import { clock, useClockState, useClockTime } from '../../lib/clock';
import { clock as fmtClock, lastAtOrBefore, onDark } from '../../lib/format';
import { useRace } from '../Race';

const MOMENT_GLYPH: Record<string, string> = {
  start: 'S',
  lead: 'L',
  sc: 'SC',
  vsc: 'V',
  red: 'R',
  out: '×',
  fastest: 'F',
  flag: '⚑',
};

export function Transport({ rates }: { rates: number[] }) {
  const { session, live } = useRace();
  const { meta, report } = session;
  const { playing, rate } = useClockState();
  const t = useClockTime(5);
  const bar = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number; text?: string } | null>(null);
  const dragging = useRef(false);

  // lap grid from the winner's laps
  const lapStarts = useMemo(() => {
    const winner = meta.classification.find((c) => c.pos === 1)?.n ?? meta.drivers[0].n;
    return (meta.laps[winner] ?? []).filter((l) => l.t != null).map((l) => l.t as number);
  }, [meta]);

  const ledBands = useMemo(
    () =>
      report.ledStints
        .map((s) => {
          const t0 = lapStarts[s.from - 1];
          const t1 = lapStarts[s.to] ?? meta.duration - 45;
          const d = session.byNum.get(s.n);
          return t0 == null || !d ? null : { t0, t1, colour: onDark(d.colour), code: d.code };
        })
        .filter((b): b is NonNullable<typeof b> => b !== null),
    [report, lapStarts, meta, session],
  );

  // the playhead follows the clock every frame without re-rendering React
  useEffect(() => {
    const apply = (now: number) => {
      const f = (now / meta.duration) * 100;
      if (head.current) head.current.style.left = `${f}%`;
      if (fill.current) fill.current.style.width = `${f}%`;
    };
    apply(clock.t);
    return clock.onFrame(apply);
  }, [meta.duration]);

  const timeAt = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * meta.duration;
  };

  const lapOf = (time: number) => Math.max(0, Math.min(meta.totalLaps, lastAtOrBefore(lapStarts, time) + 1));
  const pct = (time: number) => `${(time / meta.duration) * 100}%`;
  const lap = live.raceLap(t);

  const jumpLap = (dir: number) => {
    const i = lastAtOrBefore(lapStarts, clock.t + 0.5);
    const target = lapStarts[Math.min(lapStarts.length - 1, Math.max(0, i + dir))];
    if (target != null) clock.seek(target);
  };

  return (
    <section className="transport panel ticks">
      <div className="tp-controls">
        <button className="tp-step" onClick={() => jumpLap(-1)} aria-label="Previous lap" title="Previous lap">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M2 2h2v10H2zM12 2v10L5 7z" />
          </svg>
        </button>
        <button className={`tp-play${playing ? ' is-playing' : ''}`} onClick={() => clock.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 2h4v12H3zM9 2h4v12H9z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2v12l10-6z" />
            </svg>
          )}
        </button>
        <button className="tp-step" onClick={() => jumpLap(1)} aria-label="Next lap" title="Next lap">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M10 2h2v10h-2zM2 2v10l7-5z" />
          </svg>
        </button>
      </div>

      <div className="tp-readout">
        <div className="num tp-time">{fmtClock(t - meta.raceStart)}</div>
        <div className="label">
          Lap <span className="num">{Math.max(0, lap)}</span> of <span className="num">{meta.totalLaps}</span>
        </div>
      </div>

      <div
        className="tp-bar"
        ref={bar}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          clock.seek(timeAt(e.clientX));
        }}
        onPointerMove={(e) => {
          const time = timeAt(e.clientX);
          const rect = bar.current!.getBoundingClientRect();
          setHover({ x: e.clientX - rect.left, t: time });
          if (dragging.current) clock.seek(time);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => {
          if (!dragging.current) setHover(null);
        }}
        role="slider"
        aria-label="Race timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(meta.duration)}
        aria-valuenow={Math.round(t)}
        tabIndex={0}
      >
        <div className="tp-led" title="Race leader by lap">
          {ledBands.map((b, i) => (
            <i key={i} style={{ left: pct(b.t0), width: `calc(${pct(b.t1 - b.t0)} - 1px)`, background: b.colour }} />
          ))}
        </div>

        <div className="tp-track">
          {meta.trackStatus.map((s, i) => (
            <i key={i} className={`tp-status is-${s.type.toLowerCase()}`} style={{ left: pct(s.t0), width: pct(s.t1 - s.t0) }} />
          ))}
          <div className="tp-fill" ref={fill} />
          {lapStarts.map((ls, i) => (
            <i key={i} className={`tp-tick${(i + 1) % 10 === 0 ? ' is-major' : ''}`} style={{ left: pct(ls) }} />
          ))}
        </div>

        <div className="tp-laps num">
          {lapStarts.map((ls, i) => ((i + 1) % 10 === 0 ? <span key={i} style={{ left: pct(ls) }}>{i + 1}</span> : null))}
        </div>

        {report.moments
          .filter((m) => m.t != null)
          .map((m, i) => (
            <button
              key={i}
              className={`tp-pin is-${m.kind}`}
              style={{ left: pct(m.t as number) }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => clock.seek(Math.max(0, (m.t as number) - 4))}
              onPointerEnter={() => {
                const rect = bar.current!.getBoundingClientRect();
                setHover({ x: ((m.t as number) / meta.duration) * rect.width, t: m.t as number, text: m.text });
              }}
              aria-label={`Lap ${m.lap}: ${m.text}`}
            >
              {MOMENT_GLYPH[m.kind]}
            </button>
          ))}

        <div className="tp-head" ref={head} />

        {hover && (
          <div className="tooltip tp-tip" style={{ left: hover.x }}>
            <span className="num">
              L{lapOf(hover.t)} · {fmtClock(hover.t - meta.raceStart)}
            </span>
            {hover.text && <b>{hover.text}</b>}
          </div>
        )}
      </div>

      <div className="tp-rate">
        <span className="label">Speed</span>
        <div className="seg" role="group" aria-label="Playback speed">
          {rates.map((r) => (
            <button key={r} className={rate === r ? 'is-on' : ''} onClick={() => clock.setRate(r)}>
              {r}×
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
