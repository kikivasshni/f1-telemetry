import { useMemo, useState } from 'react';
import { compound, lastAtOrBefore, onDark } from '../../lib/format';
import { useSize } from '../../lib/hooks';
import type { Session } from '../../lib/types';

interface ChartProps {
  session: Session;
  focus: number | null;
  onFocus: (n: number | null) => void;
}

const dash = (session: Session, n: number) => (session.teammateIndex.get(n) ? '5 3' : undefined);

/** Laps covered by each neutralisation, for shading behind the charts. */
function useNeutralLaps(session: Session) {
  return useMemo(() => {
    const { meta } = session;
    const winner = meta.classification.find((c) => c.pos === 1)?.n ?? meta.drivers[0].n;
    const starts = (meta.laps[winner] ?? []).filter((l) => l.t != null).map((l) => l.t as number);
    return meta.trackStatus.map((s) => ({
      type: s.type,
      from: Math.max(1, lastAtOrBefore(starts, s.t0) + 1),
      to: Math.max(1, lastAtOrBefore(starts, s.t1) + 1),
    }));
  }, [session]);
}

// ---- lap chart -------------------------------------------------------------------------

export function LapChart({ session, focus, onFocus }: ChartProps) {
  const { meta } = session;
  const [ref, size] = useSize<HTMLDivElement>();
  const [tip, setTip] = useState<{ x: number; y: number; n: number; lap: number; pos: number } | null>(null);
  const neutral = useNeutralLaps(session);

  const count = meta.drivers.length;
  const rowH = 21;
  const top = 22;
  const left = 46;
  const right = 46;
  const H = top + count * rowH + 22;
  const W = size.w;
  const plotW = Math.max(10, W - left - right);
  const x = (lap: number) => left + (lap / meta.totalLaps) * plotW;
  const y = (pos: number) => top + (pos - 0.5) * rowH;

  const series = useMemo(
    () =>
      meta.drivers.map((d) => {
        const row = meta.lapChart[d.n] ?? [];
        const pts: { lap: number; pos: number }[] = [];
        row.forEach((p, lap) => {
          if (p != null) pts.push({ lap, pos: p });
        });
        return { n: d.n, code: d.code, colour: onDark(d.colour), pts };
      }),
    [meta],
  );

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const lap = Math.round(((mx - left) / plotW) * meta.totalLaps);
    if (lap < 0 || lap > meta.totalLaps) {
      setTip(null);
      onFocus(null);
      return;
    }
    let best: (typeof series)[number] | null = null;
    let bestPos = 0;
    let bestD = rowH * 0.9;
    for (const s of series) {
      const p = s.pts.find((q) => q.lap === lap);
      if (!p) continue;
      const d = Math.abs(y(p.pos) - my);
      if (d < bestD) {
        bestD = d;
        best = s;
        bestPos = p.pos;
      }
    }
    if (best) {
      setTip({ x: x(lap), y: y(bestPos), n: best.n, lap, pos: bestPos });
      onFocus(best.n);
    } else {
      setTip(null);
      onFocus(null);
    }
  };

  const tipDriver = tip ? session.byNum.get(tip.n) : null;

  return (
    <div className="chart-box" ref={ref}>
      {W > 0 && (
        <svg width={W} height={H} onPointerMove={move} onPointerLeave={() => { setTip(null); onFocus(null); }} role="img" aria-label="Position of every driver at the end of each lap">
          {neutral.map((s, i) => (
            <rect key={i} x={x(s.from - 1)} width={Math.max(2, x(s.to) - x(s.from - 1))} y={top - 6} height={count * rowH + 8} className={`nz nz-${s.type.toLowerCase()}`} />
          ))}
          {Array.from({ length: Math.floor(meta.totalLaps / 10) + 1 }, (_, i) => i * 10).map((lap) => (
            <g key={lap}>
              <line x1={x(lap)} x2={x(lap)} y1={top - 6} y2={H - 20} className="grid-line" />
              <text x={x(lap)} y={H - 6} className="axis-text" textAnchor="middle">
                {lap === 0 ? 'GRID' : `L${lap}`}
              </text>
            </g>
          ))}
          {series.map((s) => {
            const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.lap).toFixed(1)} ${y(p.pos).toFixed(1)}`).join('');
            const first = s.pts[0];
            const last = s.pts[s.pts.length - 1];
            const dim = focus != null && focus !== s.n;
            return (
              <g key={s.n} className={`series${dim ? ' is-dim' : ''}${focus === s.n ? ' is-focus' : ''}`}>
                <path d={d} fill="none" stroke={s.colour} strokeDasharray={dash(session, s.n)} />
                {first && (
                  <text x={left - 9} y={y(first.pos) + 3.5} textAnchor="end" className="end-label">
                    {s.code}
                  </text>
                )}
                {last && last.lap > 0 && (
                  <>
                    <circle cx={x(last.lap)} cy={y(last.pos)} r="3" fill={s.colour} />
                    <text x={x(last.lap) + 9} y={y(last.pos) + 3.5} className="end-label">
                      {s.code}
                    </text>
                  </>
                )}
              </g>
            );
          })}
          {tip && <circle cx={tip.x} cy={tip.y} r="5" className="tip-dot" />}
        </svg>
      )}
      {tip && tipDriver && (
        <div className={`tooltip chart-tip${tip.x > W * 0.7 ? ' is-left' : ''}`} style={{ left: tip.x, top: tip.y }}>
          <b>
            <i style={{ background: onDark(tipDriver.colour) }} />
            {tipDriver.first} {tipDriver.last}
          </b>
          <span className="num">
            {tip.lap === 0 ? 'Grid' : `Lap ${tip.lap}`} · P{tip.pos}
          </span>
        </div>
      )}
    </div>
  );
}

// ---- race trace ------------------------------------------------------------------------

export function RaceTrace({ session, focus, onFocus }: ChartProps) {
  const { meta } = session;
  const [ref, size] = useSize<HTMLDivElement>();
  const [tip, setTip] = useState<{ x: number; y: number; n: number; lap: number; gap: number } | null>(null);
  const neutral = useNeutralLaps(session);

  const { series, yMax, yMin } = useMemo(() => {
    const winner = meta.classification.find((c) => c.pos === 1)?.n ?? meta.drivers[0].n;
    const ends = new Map<number, number>();
    for (const l of meta.laps[winner] ?? []) if (l.t != null && l.d != null) ends.set(l.lap, l.t + l.d);
    const out = meta.drivers.map((d) => {
      const pts: { lap: number; gap: number }[] = [];
      for (const l of meta.laps[d.n] ?? []) {
        const ref = ends.get(l.lap);
        if (l.t == null || l.d == null || ref == null) continue;
        pts.push({ lap: l.lap, gap: l.t + l.d - ref });
      }
      return { n: d.n, code: d.code, colour: onDark(d.colour), pts };
    });
    // scale to the cars that finished on the lead lap
    const finals = out
      .filter((s) => meta.classification.find((c) => c.n === s.n)?.laps === meta.totalLaps)
      .map((s) => s.pts[s.pts.length - 1]?.gap ?? 0);
    const max = Math.min(140, Math.max(20, ...finals) * 1.08);
    // drivers who led before the winner did sit above the zero line
    let min = 0;
    for (const s of out) for (const p of s.pts) if (p.gap < min) min = p.gap;
    return { series: out, yMax: Math.ceil(max / 10) * 10, yMin: Math.floor(Math.max(-60, min) / 10) * 10 };
  }, [meta]);

  const H = 380;
  const top = 16;
  const left = 46;
  const right = 46;
  const bottom = 24;
  const W = size.w;
  const plotW = Math.max(10, W - left - right);
  const plotH = H - top - bottom;
  const x = (lap: number) => left + ((lap - 1) / Math.max(1, meta.totalLaps - 1)) * plotW;
  const y = (gap: number) => top + ((gap - yMin) / (yMax - yMin)) * plotH;
  const step = yMax - yMin > 80 ? 20 : 10;

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const lap = Math.round(((mx - left) / plotW) * (meta.totalLaps - 1)) + 1;
    let best: { n: number; gap: number } | null = null;
    let bestD = 16;
    for (const s of series) {
      const p = s.pts.find((q) => q.lap === lap);
      if (!p || p.gap > yMax) continue;
      const d = Math.abs(y(p.gap) - my);
      if (d < bestD) {
        bestD = d;
        best = { n: s.n, gap: p.gap };
      }
    }
    if (best) {
      setTip({ x: x(lap), y: y(best.gap), n: best.n, lap, gap: best.gap });
      onFocus(best.n);
    } else {
      setTip(null);
      onFocus(null);
    }
  };
  const tipDriver = tip ? session.byNum.get(tip.n) : null;

  return (
    <div className="chart-box" ref={ref}>
      {W > 0 && (
        <svg width={W} height={H} onPointerMove={move} onPointerLeave={() => { setTip(null); onFocus(null); }} role="img" aria-label="Gap to the race winner at the end of each lap">
          <defs>
            <clipPath id="trace-clip">
              <rect x={left} y={top - 4} width={plotW + 4} height={plotH + 4} />
            </clipPath>
          </defs>
          {neutral.map((s, i) => (
            <rect key={i} x={x(s.from)} width={Math.max(2, x(s.to + 1) - x(s.from))} y={top} height={plotH} className={`nz nz-${s.type.toLowerCase()}`} />
          ))}
          {Array.from({ length: Math.floor((yMax - yMin) / step) + 1 }, (_, i) => Math.ceil(yMin / step) * step + i * step).map((g) => (
            <g key={g}>
              <line x1={left} x2={W - right} y1={y(g)} y2={y(g)} className={g === 0 ? 'zero-line' : 'grid-line'} />
              <text x={left - 9} y={y(g) + 3} textAnchor="end" className="axis-text">
                {g === 0 ? 'WIN' : `${g > 0 ? '+' : '−'}${Math.abs(g)}s`}
              </text>
            </g>
          ))}
          {Array.from({ length: Math.floor(meta.totalLaps / 10) }, (_, i) => (i + 1) * 10).map((lap) => (
            <text key={lap} x={x(lap)} y={H - 6} className="axis-text" textAnchor="middle">
              L{lap}
            </text>
          ))}
          <g clipPath="url(#trace-clip)">
            {series.map((s) => {
              const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.lap).toFixed(1)} ${y(p.gap).toFixed(1)}`).join('');
              const dim = focus != null && focus !== s.n;
              return <path key={s.n} d={d} fill="none" stroke={s.colour} strokeDasharray={dash(session, s.n)} className={`series-line${dim ? ' is-dim' : ''}${focus === s.n ? ' is-focus' : ''}`} />;
            })}
          </g>
          {series.map((s) => {
            const last = s.pts[s.pts.length - 1];
            if (!last || last.gap > yMax || last.lap < meta.totalLaps) return null;
            return (
              <text key={s.n} x={W - right + 8} y={y(last.gap) + 3.5} className={`end-label${focus != null && focus !== s.n ? ' is-dim' : ''}`}>
                {s.code}
              </text>
            );
          })}
          {tip && <circle cx={tip.x} cy={tip.y} r="5" className="tip-dot" />}
        </svg>
      )}
      {tip && tipDriver && (
        <div className={`tooltip chart-tip${tip.x > W * 0.7 ? ' is-left' : ''}`} style={{ left: tip.x, top: tip.y }}>
          <b>
            <i style={{ background: onDark(tipDriver.colour) }} />
            {tipDriver.first} {tipDriver.last}
          </b>
          <span className="num">
            Lap {tip.lap} · {Math.abs(tip.gap) < 0.0005 ? 'the winner' : tip.gap < 0 ? `${Math.abs(tip.gap).toFixed(3)}s ahead of the winner` : `+${tip.gap.toFixed(3)}s`}
          </span>
        </div>
      )}
    </div>
  );
}

// ---- tyre strategy ---------------------------------------------------------------------

export function StrategyStrip({ session, focus, onFocus }: ChartProps) {
  const { meta } = session;
  const [tip, setTip] = useState<{ n: number; i: number } | null>(null);
  const order = [...meta.classification].sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99));
  const used = [...new Set(meta.stints.map((s) => s.c))];

  return (
    <div className="strategy">
      {order.map((c) => {
        const d = session.byNum.get(c.n)!;
        const stints = meta.stints.filter((s) => s.n === c.n);
        return (
          <div key={c.n} className={`strat-row${focus != null && focus !== c.n ? ' is-dim' : ''}`} onPointerEnter={() => onFocus(c.n)} onPointerLeave={() => onFocus(null)}>
            <span className="num strat-pos">{c.pos ?? c.status}</span>
            <span className="strat-code">{d.code}</span>
            <div className="strat-bar">
              {stints.map((s, i) => {
                const tyre = compound(s.c);
                const open = tip?.n === c.n && tip.i === i;
                return (
                  <div
                    key={i}
                    className="strat-stint"
                    style={{ left: `${((s.a - 1) / meta.totalLaps) * 100}%`, width: `calc(${((s.b - s.a + 1) / meta.totalLaps) * 100}% - 2px)`, background: tyre.colour }}
                    onPointerEnter={() => setTip({ n: c.n, i })}
                    onPointerLeave={() => setTip(null)}
                  >
                    {s.b - s.a + 1 >= 4 && <span className="num">{s.b - s.a + 1}</span>}
                    {open && (
                      <div className="tooltip strat-tip">
                        <b>
                          {tyre.name} · {s.b - s.a + 1} laps
                        </b>
                        <span className="num">
                          L{s.a}–{s.b}
                          {s.age ? ` · ${s.age} laps old at fitting` : ' · new set'}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <span className="num strat-stops">{Math.max(0, stints.length - 1)}</span>
          </div>
        );
      })}
      <div className="strat-axis num">
        <span />
        <span />
        <div>
          {Array.from({ length: Math.floor(meta.totalLaps / 10) }, (_, i) => (i + 1) * 10).map((lap) => (
            <span key={lap} style={{ left: `${(lap / meta.totalLaps) * 100}%` }}>
              L{lap}
            </span>
          ))}
        </div>
        <span />
      </div>
      <div className="strat-legend">
        {used.map((c) => (
          <span key={c}>
            <i style={{ background: compound(c).colour }} />
            {compound(c).name}
          </span>
        ))}
        <span className="dim">numbers are laps in the stint · right column is pit stops</span>
      </div>
    </div>
  );
}
