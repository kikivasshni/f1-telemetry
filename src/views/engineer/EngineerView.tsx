import { useEffect, useMemo, useState } from 'react';
import { TrackMap } from '../../components/TrackMap';
import { compound, lapTime, signed } from '../../lib/format';
import { analyseCorners, lapLine, stintNotes, type CornerReport, type LapGrid } from '../../lib/telemetry';
import { useRace } from '../Race';
import { PairBar, useLapPair, type PairSide } from '../telemetry/shared';

const KIND_LABEL: Record<CornerReport['kind'], string> = {
  brake: 'Braking',
  apex: 'Apex speed',
  exit: 'Exit',
  gain: 'Gaining',
  even: 'Level',
};

/** Diverging bars: one per corner, coloured by whoever is quicker through it. */
function LossChart({ reports, a, b, active, onPick }: { reports: CornerReport[]; a: PairSide; b: PairSide; active: number; onPick: (i: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0.05, ...reports.map((r) => Math.abs(r.loss)));
  const W = 1000;
  const H = 210;
  const mid = H / 2 + 4;
  const reach = H / 2 - 30;
  const slot = W / reports.length;
  const barW = Math.min(34, slot * 0.56);
  const shown = hover ?? active;
  const r = reports[shown];

  return (
    <div className="losschart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Time ${a.driver.code} gains or loses to ${b.driver.code} in each corner`}>
        <line x1="0" x2={W} y1={mid} y2={mid} className="lc-zero" vectorEffect="non-scaling-stroke" />
        {reports.map((rep, i) => {
          const h = Math.max(2, (Math.abs(rep.loss) / max) * reach);
          const x = i * slot + (slot - barW) / 2;
          const losing = rep.loss > 0;
          return (
            <g key={i} className={`lc-bar${i === active ? ' is-active' : ''}${hover === i ? ' is-hover' : ''}`} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onClick={() => onPick(i)}>
              <rect x={i * slot} y="0" width={slot} height={H} fill="transparent" />
              <rect x={x} y={losing ? mid - h - 1 : mid + 1} width={barW} height={h} fill={losing ? b.colour : a.colour} style={{ transformOrigin: `0 ${mid}px`, animationDelay: `${i * 28}ms` }} />
            </g>
          );
        })}
      </svg>
      <div className="lc-labels num">
        {reports.map((rep, i) => (
          <span key={i} className={i === active ? 'is-active' : ''}>
            {rep.corner.label}
          </span>
        ))}
      </div>
      <div className="lc-axis">
        <span>
          <i style={{ background: b.colour }} />
          {b.driver.code} quicker (bars up)
        </span>
        <span>
          <i style={{ background: a.colour }} />
          {a.driver.code} quicker (bars down)
        </span>
        {r && (
          <b className="num">
            Turn {r.corner.label}: {r.loss > 0 ? b.driver.code : a.driver.code} by {Math.abs(r.loss).toFixed(3)}s
          </b>
        )}
      </div>
    </div>
  );
}

/** Speed through one corner for both drivers. */
function SegmentTrace({ a, b, from, to, apexA }: { a: PairSide; b: PairSide; from: number; to: number; apexA: number }) {
  const W = 600;
  const H = 150;
  const pad = 6;
  const build = (g: LapGrid | null) => {
    if (!g) return { d: '', lo: Infinity, hi: 0 };
    const i0 = Math.max(0, Math.floor(from / g.step));
    const i1 = Math.min(g.n - 1, Math.ceil(to / g.step));
    let lo = Infinity;
    let hi = 0;
    for (let i = i0; i <= i1; i++) {
      lo = Math.min(lo, g.speed[i]);
      hi = Math.max(hi, g.speed[i]);
    }
    return { i0, i1, lo, hi, g, d: '' };
  };
  const sa = build(a.grid);
  const sb = build(b.grid);
  const lo = Math.min(sa.lo, sb.lo) - 6;
  const hi = Math.max(sa.hi, sb.hi) + 6;
  const x = (d: number) => ((d - from) / (to - from)) * W;
  const y = (v: number) => pad + (H - pad * 2) * (1 - (v - lo) / (hi - lo || 1));
  const path = (s: typeof sa) => {
    if (!('g' in s) || !s.g) return '';
    let out = '';
    for (let i = s.i0!; i <= s.i1!; i++) out += `${i === s.i0 ? 'M' : 'L'}${x(i * s.g.step).toFixed(1)} ${y(s.g.speed[i]).toFixed(1)}`;
    return out;
  };
  return (
    <div className="segtrace">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Speed through the corner for both drivers">
        <line x1={x(apexA)} x2={x(apexA)} y1="0" y2={H} className="st-apex" vectorEffect="non-scaling-stroke" />
        <path d={path(sb)} fill="none" stroke={b.colour} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        <path d={path(sa)} fill="none" stroke={a.colour} strokeWidth="1.9" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="st-scale num">
        <span>{Math.round(hi)} km/h</span>
        <span>{Math.round(lo)}</span>
      </div>
      <div className="st-x num">
        <span>{Math.round(from)} m</span>
        <span className="dim">apex</span>
        <span>{Math.round(to)} m</span>
      </div>
    </div>
  );
}

export function EngineerView() {
  const { session } = useRace();
  const { meta } = session;
  const track = meta.track;
  const { a, b, loading } = useLapPair();
  const [active, setActive] = useState(0);

  const reports = useMemo(() => (a.grid && b.grid && track.corners.length ? analyseCorners(track, a.grid, b.grid, a.driver.code, b.driver.code) : []), [track, a.grid, b.grid, a.driver.code, b.driver.code]);

  // open on the corner where the most time is lost
  useEffect(() => {
    if (!reports.length) return;
    let worst = 0;
    reports.forEach((r, i) => {
      if (r.loss > reports[worst].loss) worst = i;
    });
    setActive(worst);
  }, [reports]);

  const ranked = useMemo(() => reports.map((r, i) => ({ r, i })).sort((x, y) => y.r.loss - x.r.loss), [reports]);
  const lines = useMemo(() => {
    const idx = (n: number) => meta.pos.order.indexOf(n);
    const la = a.lap ? lapLine(session.positions, idx(a.driver.n), a.lap) : null;
    const lb = b.lap ? lapLine(session.positions, idx(b.driver.n), b.lap) : null;
    return [lb && { ...lb, colour: b.colour }, la && { ...la, colour: a.colour }].filter((l): l is NonNullable<typeof l> => !!l);
  }, [session, meta, a.lap, b.lap, a.driver.n, b.driver.n, a.colour, b.colour]);

  const notes = useMemo(
    () =>
      stintNotes(
        meta.laps[a.driver.n] ?? [],
        meta.stints.filter((s) => s.n === a.driver.n),
        meta.trackStatus,
      ),
    [meta, a.driver.n],
  );

  const cur = reports[Math.min(active, reports.length - 1)];
  const totalLoss = reports.reduce((s, r) => s + r.loss, 0);
  const lost = reports.filter((r) => r.loss > 0.012).reduce((s, r) => s + r.loss, 0);
  const gained = reports.filter((r) => r.loss < -0.012).reduce((s, r) => s - r.loss, 0);

  const rowsFor = (r: CornerReport) => [
    { label: 'Brakes before apex', a: r.a.brakePoint, b: r.b.brakePoint, unit: 'm', dp: 0, lower: true },
    { label: 'Speed at braking', a: r.a.entrySpeed, b: r.b.entrySpeed, unit: 'km/h', dp: 0, lower: false },
    { label: 'Apex speed', a: r.a.minSpeed, b: r.b.minSpeed, unit: 'km/h', dp: 0, lower: false },
    { label: 'Full throttle after apex', a: r.a.throttlePoint, b: r.b.throttlePoint, unit: 'm', dp: 0, lower: true },
    { label: 'Exit speed', a: r.a.exitSpeed, b: r.b.exitSpeed, unit: 'km/h', dp: 0, lower: false },
    { label: 'Time through', a: r.a.time, b: r.b.time, unit: 's', dp: 3, lower: true },
  ];

  return (
    <div className="analysis engineer">
      <PairBar a={a} b={b}>
        <div className="pair-result">
          <span className="label">Coaching {a.driver.code} against {b.driver.code}</span>
          {reports.length > 0 && (
            <b className="num">
              {lost.toFixed(3)}s to find · {gained.toFixed(3)}s already banked
            </b>
          )}
        </div>
      </PairBar>

      {loading ? (
        <div className="panel ticks eng-empty">Loading car telemetry…</div>
      ) : !reports.length ? (
        <div className="panel ticks eng-empty">
          <div className="label">Nothing to coach on yet</div>
          <p>{track.corners.length ? 'One of these laps has no clean telemetry. Pick another lap above.' : 'This circuit has no corner map, so corner-by-corner advice is unavailable.'}</p>
        </div>
      ) : (
        <div className="eng-grid">
          <section className="panel ticks eng-radio">
            <div className="panel-head">
              <span className="label">Engineer to {a.driver.code}</span>
              <span className="num dim" style={{ fontSize: 10.5 }}>
                net {signed(totalLoss)}s
              </span>
            </div>
            <div className="eng-list">
              {ranked.map(({ r, i }, k) => (
                <button key={i} className={`eng-msg kind-${r.kind}${i === active ? ' is-active' : ''}`} style={{ ['--i' as string]: k }} onClick={() => setActive(i)}>
                  <span className="eng-turn num">T{r.corner.label}</span>
                  <span className="eng-body">
                    <b>{r.advice}</b>
                    <span>{r.detail}</span>
                  </span>
                  <span className="eng-loss num">
                    {signed(r.loss)}
                    <small>{KIND_LABEL[r.kind]}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="eng-main">
            <section className="panel ticks">
              <div className="panel-head">
                <span className="label">Where the lap time goes</span>
                <span className="dim" style={{ fontSize: 11 }}>
                  one bar per corner, start to finish
                </span>
              </div>
              <LossChart reports={reports} a={a} b={b} active={active} onPick={setActive} />
            </section>

            {cur && (
              <section className="panel ticks eng-corner">
                <div className="eng-corner-map">
                  <div className="eng-corner-title">
                    <span className="label">Turn</span>
                    <b className="display">{cur.corner.label}</b>
                    <span className="dim">
                      {Math.round(cur.from)}–{Math.round(cur.to)} m
                    </span>
                  </div>
                  <TrackMap track={track} mode="plain" focus={{ from: cur.from, to: cur.to }} lines={lines} colourA={a.colour} colourB={b.colour} />
                  <div className="map-legend">
                    <span>
                      <i style={{ background: a.colour }} />
                      {a.driver.code} line
                    </span>
                    <span>
                      <i style={{ background: b.colour }} />
                      {b.driver.code} line
                    </span>
                    <span className="dim">car position, 3.7 Hz</span>
                  </div>
                </div>

                <div className="eng-corner-data">
                  <div className={`eng-call kind-${cur.kind}`}>
                    <span className="label">{KIND_LABEL[cur.kind]}</span>
                    <p>{cur.advice}</p>
                    <span>{cur.detail}</span>
                  </div>
                  <SegmentTrace a={a} b={b} from={cur.from} to={cur.to} apexA={cur.a.apex} />
                  <table className="eng-table">
                    <thead>
                      <tr>
                        <th />
                        <th>
                          <i style={{ background: a.colour }} />
                          {a.driver.code}
                        </th>
                        <th>
                          <i style={{ background: b.colour }} />
                          {b.driver.code}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowsFor(cur).map((row) => {
                        const fmt = (v: number | null) => (v == null ? '–' : `${v.toFixed(row.dp)}`);
                        const better = row.a == null || row.b == null || Math.abs(row.a - row.b) < 10 ** -row.dp / 2 ? null : row.a < row.b === row.lower ? 'a' : 'b';
                        return (
                          <tr key={row.label}>
                            <td>
                              {row.label} <small>{row.unit}</small>
                            </td>
                            <td className={`num${better === 'a' ? ' is-best' : ''}`}>{fmt(row.a)}</td>
                            <td className={`num${better === 'b' ? ' is-best' : ''}`}>{fmt(row.b)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="panel ticks eng-stints">
              <div className="panel-head">
                <span className="label">{a.driver.code} race pace by stint</span>
                <span className="dim" style={{ fontSize: 11 }}>
                  clean green-flag laps only
                </span>
              </div>
              <div className="stint-rows">
                {notes.map((s, i) => {
                  const tyre = compound(s.compound);
                  const verdict =
                    s.slope == null
                      ? 'Too short to read a trend.'
                      : s.slope > 0.06
                        ? `Pace fell away by ${s.slope.toFixed(3)}s per lap over the stint.`
                        : s.slope > 0.015
                          ? `Gentle drop-off of ${s.slope.toFixed(3)}s per lap.`
                          : s.slope < -0.015
                            ? `Got quicker by ${Math.abs(s.slope).toFixed(3)}s per lap through the stint.`
                            : 'Pace held flat across the stint.';
                  return (
                    <div className="stint-row" key={i}>
                      <i className="tyre" style={{ ['--tc' as string]: tyre.colour }}>
                        {tyre.letter}
                      </i>
                      <div>
                        <b>{tyre.name}</b>
                        <span className="num dim">
                          L{s.from}–{s.to} · {s.laps} laps
                        </span>
                      </div>
                      <div>
                        <span className="label">Average</span>
                        <b className="num">{lapTime(s.avg)}</b>
                      </div>
                      <div>
                        <span className="label">Best</span>
                        <b className="num">{lapTime(s.best)}</b>
                      </div>
                      <div className="stint-slope">
                        <span className="label">Trend per lap</span>
                        <b className="num">{s.slope == null ? '–' : `${signed(s.slope)}s`}</b>
                      </div>
                      <p>{verdict}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
