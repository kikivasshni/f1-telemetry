import { useEffect, useMemo, useState } from 'react';
import { TrackMap, speedColour, type MapMode } from '../../components/TrackMap';
import { lapTime, sectorTime, signed } from '../../lib/format';
import { summarise } from '../../lib/telemetry';
import { useRace } from '../Race';
import { PairBar, useLapPair } from './shared';
import { TraceChart } from './TraceChart';

export function TelemetryView() {
  const { session } = useRace();
  const track = session.meta.track;
  const { a, b, delta, loading } = useLapPair();
  const [cursor, setCursor] = useState<number | null>(null);
  const [view, setView] = useState<[number, number]>([0, track.length]);
  const [mapMode, setMapMode] = useState<MapMode>('advantage');

  useEffect(() => setView([0, track.length]), [track.length]);

  const sumA = useMemo(() => (a.grid ? summarise(a.grid) : null), [a.grid]);
  const sumB = useMemo(() => (b.grid ? summarise(b.grid) : null), [b.grid]);
  const zoomed = view[0] > 1 || view[1] < track.length - 1;
  const gapTotal = a.lap?.d != null && b.lap?.d != null ? a.lap.d - b.lap.d : null;

  const rows: { label: string; a: string; b: string; diff: number | null; lowerIsBetter: boolean; dp: number }[] = [
    { label: 'Lap time', a: lapTime(a.lap?.d), b: lapTime(b.lap?.d), diff: gapTotal, lowerIsBetter: true, dp: 3 },
    ...[0, 1, 2].map((i) => {
      const sa = a.lap?.s[i] ?? null;
      const sb = b.lap?.s[i] ?? null;
      return { label: `Sector ${i + 1}`, a: sectorTime(sa), b: sectorTime(sb), diff: sa != null && sb != null ? sa - sb : null, lowerIsBetter: true, dp: 3 };
    }),
    { label: 'Top speed, km/h', a: sumA ? sumA.top.toFixed(0) : '–', b: sumB ? sumB.top.toFixed(0) : '–', diff: sumA && sumB ? sumA.top - sumB.top : null, lowerIsBetter: false, dp: 0 },
    { label: 'Slowest point, km/h', a: sumA ? sumA.min.toFixed(0) : '–', b: sumB ? sumB.min.toFixed(0) : '–', diff: sumA && sumB ? sumA.min - sumB.min : null, lowerIsBetter: false, dp: 0 },
    {
      label: 'Full throttle',
      a: sumA ? `${(sumA.fullThrottle * 100).toFixed(0)}%` : '–',
      b: sumB ? `${(sumB.fullThrottle * 100).toFixed(0)}%` : '–',
      diff: sumA && sumB ? (sumA.fullThrottle - sumB.fullThrottle) * 100 : null,
      lowerIsBetter: false,
      dp: 0,
    },
    {
      label: 'On the brakes',
      a: sumA ? `${(sumA.braking * 100).toFixed(0)}%` : '–',
      b: sumB ? `${(sumB.braking * 100).toFixed(0)}%` : '–',
      diff: sumA && sumB ? (sumA.braking - sumB.braking) * 100 : null,
      lowerIsBetter: true,
      dp: 0,
    },
  ];

  const unusable = !loading && (!a.grid || !b.grid);

  return (
    <div className="analysis">
      <PairBar a={a} b={b}>
        <div className="pair-result">
          {gapTotal != null && (
            <>
              <span className="label">Over the lap</span>
              <b className="num">
                <i className="swatch" style={{ background: gapTotal <= 0 ? a.colour : b.colour }} />
                {(gapTotal <= 0 ? a : b).driver.code} {Math.abs(gapTotal).toFixed(3)}s quicker
              </b>
            </>
          )}
        </div>
      </PairBar>

      <div className="tel-grid">
        <section className="panel ticks tel-chart">
          <div className="panel-head">
            <div className="legend">
              <span>
                <i style={{ background: a.colour }} />
                {a.driver.code} <em className="num">L{a.lap?.lap ?? '–'}</em>
              </span>
              <span>
                <i style={{ background: b.colour }} />
                {b.driver.code} <em className="num">L{b.lap?.lap ?? '–'}</em>
              </span>
            </div>
            <div className="chart-hint">
              {zoomed ? (
                <button className="link-btn" onClick={() => setView([0, track.length])}>
                  Reset zoom
                </button>
              ) : (
                <>
                  <span className="kbd">scroll</span> zoom <span className="kbd">drag</span> pan
                </>
              )}
            </div>
          </div>
          {unusable ? (
            <div className="chart-empty">
              <div className="label">No clean telemetry for this lap</div>
              <p>Pick another lap: pit laps, lap one and laps with missing samples cannot be aligned by distance.</p>
            </div>
          ) : (
            <TraceChart a={a} b={b} delta={delta} track={track} cursor={cursor} onCursor={setCursor} view={view} onView={setView} />
          )}
          {loading && <div className="chart-loading">Loading car telemetry…</div>}
        </section>

        <aside className="tel-side">
          <section className="panel ticks tel-map">
            <div className="panel-head">
              <span className="label">{mapMode === 'advantage' ? 'Who is quicker where' : `${a.driver.code} speed`}</span>
              <div className="seg">
                <button className={mapMode === 'advantage' ? 'is-on' : ''} onClick={() => setMapMode('advantage')}>
                  Advantage
                </button>
                <button className={mapMode === 'speed' ? 'is-on' : ''} onClick={() => setMapMode('speed')}>
                  Speed
                </button>
              </div>
            </div>
            <TrackMap track={track} mode={mapMode} a={a.grid} b={b.grid} colourA={a.colour} colourB={b.colour} cursor={cursor} onCursor={setCursor} />
            <div className="map-legend">
              {mapMode === 'advantage' ? (
                <>
                  <span>
                    <i style={{ background: a.colour }} />
                    {a.driver.code} quicker
                  </span>
                  <span>
                    <i style={{ background: b.colour }} />
                    {b.driver.code} quicker
                  </span>
                  <span className="dim">25 mini-sectors</span>
                </>
              ) : (
                <>
                  <span className="num">{sumA ? sumA.min.toFixed(0) : ''}</span>
                  <i className="ramp" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(speedColour).join(',')})` }} />
                  <span className="num">{sumA ? sumA.top.toFixed(0) : ''} km/h</span>
                </>
              )}
            </div>
          </section>

          <section className="panel ticks tel-table">
            <table>
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
                  <th>Diff</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const better = r.diff == null || Math.abs(r.diff) < 10 ** -r.dp / 2 ? null : r.diff < 0 === r.lowerIsBetter ? 'a' : 'b';
                  return (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className={`num${better === 'a' ? ' is-best' : ''}`}>{r.a}</td>
                      <td className={`num${better === 'b' ? ' is-best' : ''}`}>{r.b}</td>
                      <td className="num dim">{r.diff == null ? '–' : signed(r.diff, r.dp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </aside>
      </div>
    </div>
  );
}
