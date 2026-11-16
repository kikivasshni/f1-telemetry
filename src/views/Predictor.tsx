import { useEffect, useState } from 'react';
import { loadData } from '../lib/data';
import { onDark, pad2 } from '../lib/format';
import { useSize } from '../lib/hooks';
import { href } from '../lib/router';
import type { SeasonIndex } from '../lib/types';

interface Score {
  spearman: number;
  mae: number;
  winner: number;
  podium: number;
  top10: number;
}
interface PredRow {
  code: string;
  name: string;
  team: string;
  colour: string;
  grid: number;
  predicted: number;
  score: number;
  actual: number;
  classified: boolean;
}
interface PredRace {
  round: number;
  name: string;
  date: string;
  key: number | null;
  trainedOn: number;
  model: Score;
  grid: Score;
  rows: PredRow[];
}
interface PredictorData {
  generatedAt: string;
  year: number;
  window: [number, number];
  params: { trees: number; rate: number; depth: number; minLeaf: number; loss: string };
  lastTraining: { rows: number; races: number };
  importance: { key: string; label: string; share: number }[];
  summary: { races: number; model: Score; grid: Score };
  races: PredRace[];
}

const MODEL = '#FF4B1F';
const BASE = '#8A8D95';

function AccuracyChart({ data, active, onPick }: { data: PredictorData; active: number; onPick: (i: number) => void }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 250;
  const left = 40;
  const right = 60;
  const top = 14;
  const bottom = 28;
  const W = size.w;
  const n = data.races.length;
  const x = (i: number) => left + (n > 1 ? i / (n - 1) : 0.5) * (W - left - right);
  const lo = Math.min(0, ...data.races.flatMap((r) => [r.model.spearman, r.grid.spearman]));
  const y = (v: number) => top + (1 - (v - lo) / (1 - lo)) * (H - top - bottom);
  const line = (key: 'model' | 'grid') => data.races.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(r[key].spearman).toFixed(1)}`).join('');
  const shown = hover ?? active;
  const r = data.races[shown];
  const last = data.races[n - 1];

  return (
    <div className="chart-box" ref={ref}>
      {W > 0 && (
        <svg
          width={W}
          height={H}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left - left) / (W - left - right)) * (n - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
          onClick={() => hover != null && onPick(hover)}
          role="img"
          aria-label="Rank correlation between predicted and actual finishing order for each race, model against grid order"
        >
          {[0, 0.25, 0.5, 0.75, 1].filter((v) => v >= lo).map((v) => (
            <g key={v}>
              <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} className="grid-line" />
              <text x={left - 8} y={y(v) + 3} textAnchor="end" className="axis-text">
                {v.toFixed(2)}
              </text>
            </g>
          ))}
          {data.races.map((race, i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="axis-text" style={{ fill: i === shown ? 'var(--ink)' : undefined }}>
              {n > 16 && i % 2 ? '' : `R${race.round}`}
            </text>
          ))}
          <line x1={x(shown)} x2={x(shown)} y1={top} y2={H - bottom} className="zero-line" />
          <path d={line('grid')} fill="none" stroke={BASE} strokeWidth="1.5" strokeDasharray="4 3" />
          <path d={line('model')} fill="none" stroke={MODEL} strokeWidth="2" strokeLinejoin="round" />
          {data.races.map((race, i) => (
            <circle key={i} cx={x(i)} cy={y(race.model.spearman)} r={i === shown ? 5 : 3} fill={MODEL} stroke="var(--bg-1)" strokeWidth="2" />
          ))}
          <text x={W - right + 8} y={y(last.model.spearman) + 3} className="end-label" style={{ fill: 'var(--ink)' }}>
            Model
          </text>
          <text x={W - right + 8} y={y(last.grid.spearman) + (Math.abs(y(last.grid.spearman) - y(last.model.spearman)) < 12 ? 16 : 3)} className="end-label">
            Grid
          </text>
        </svg>
      )}
      {r && W > 0 && (
        <div className={`tooltip chart-tip${x(shown) > W * 0.7 ? ' is-left' : ''}`} style={{ left: x(shown), top: top + 30 }}>
          <b>{r.name}</b>
          <span className="num">
            model {r.model.spearman.toFixed(2)} · grid {r.grid.spearman.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}

function Slope({ race }: { race: PredRace }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [focus, setFocus] = useState<string | null>(null);
  const n = race.rows.length;
  const rowH = 24;
  const top = 30;
  const H = top + n * rowH + 8;
  const W = size.w;
  const colL = 150;
  const colR = Math.max(colL + 80, W - 150);
  const y = (rank: number) => top + (rank - 0.5) * rowH;

  return (
    <div className="chart-box slope" ref={ref}>
      {W > 0 && (
        <svg width={W} height={H} onPointerLeave={() => setFocus(null)} role="img" aria-label={`Predicted against actual finishing order, ${race.name}`}>
          <text x={colL} y={14} textAnchor="end" className="col-title">
            Predicted
          </text>
          <text x={colR} y={14} className="col-title">
            Finished
          </text>
          {race.rows.map((r) => {
            const miss = Math.abs(r.predicted - r.actual);
            const dim = focus != null && focus !== r.code;
            const colour = onDark(r.colour);
            const y1 = y(r.predicted);
            const y2 = y(r.actual);
            const mid = (colL + colR) / 2;
            return (
              <g key={r.code} className={`slope-row${dim ? ' is-dim' : ''}${focus === r.code ? ' is-focus' : ''}`} onPointerEnter={() => setFocus(r.code)}>
                <path d={`M${colL + 12} ${y1} C${mid} ${y1} ${mid} ${y2} ${colR - 12} ${y2}`} fill="none" stroke={colour} strokeDasharray={r.classified ? undefined : '3 3'} />
                <path d={`M0 ${y1} H${colL + 12} C${mid} ${y1} ${mid} ${y2} ${colR - 12} ${y2} H${W}`} fill="none" stroke="transparent" strokeWidth={rowH * 0.8} />
                <circle cx={colL + 12} cy={y1} r="3.5" fill={colour} />
                <circle cx={colR - 12} cy={y2} r="3.5" fill={r.classified ? colour : 'var(--bg-1)'} stroke={colour} strokeWidth="1.5" />
                <text x={colL} y={y1 + 4} textAnchor="end" className="slope-label">
                  <tspan className="slope-rank">{r.predicted}</tspan>
                  <tspan dx="10">{r.code}</tspan>
                </text>
                <text x={colR} y={y2 + 4} className="slope-label">
                  <tspan>{r.code}</tspan>
                  <tspan dx="10" className="slope-rank">
                    {r.classified ? `P${r.actual}` : 'DNF'}
                  </tspan>
                  <tspan dx="10" className={`slope-miss${miss === 0 ? ' is-hit' : ''}`}>
                    {miss === 0 ? 'exact' : `${r.predicted > r.actual ? '▲' : '▼'}${miss}`}
                  </tspan>
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function Predictor({ index }: { index: SeasonIndex }) {
  const [data, setData] = useState<PredictorData | null>(null);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    loadData<PredictorData>('predictor.json').then((d) => {
      setData(d);
      setActive(d.races.length - 1);
    }, () => setError(true));
  }, []);

  if (!data) {
    return (
      <main className="page">
        <header className="page-head">
          <span className="label">Race predictor</span>
          <h1 className="display">{error ? 'No model yet' : 'Loading the model'}</h1>
          <p>{error ? 'Run the history and predict pipelines to train it.' : 'Fetching walk-forward predictions…'}</p>
        </header>
      </main>
    );
  }

  const race = data.races[active];
  const s = data.summary;
  const ready = new Set(Object.values(index.seasons).flatMap((x) => x.races).filter((r) => r.status === 'ready').map((r) => r.key));
  const beat = data.races.filter((r) => r.model.spearman > r.grid.spearman).length;
  const tiles = [
    { label: 'Rank correlation', value: s.model.spearman.toFixed(3), sub: `grid order alone scores ${s.grid.spearman.toFixed(3)}`, good: s.model.spearman >= s.grid.spearman },
    { label: 'Winners called', value: `${s.model.winner}/${s.races}`, sub: `pole-sitter won ${s.grid.winner} of ${s.races}`, good: s.model.winner >= s.grid.winner },
    { label: 'Podium places right', value: `${s.model.podium}/${s.races * 3}`, sub: `grid order gets ${s.grid.podium}`, good: s.model.podium >= s.grid.podium },
    { label: 'Average miss', value: s.model.mae.toFixed(2), sub: `places per driver · grid misses by ${s.grid.mae.toFixed(2)}`, good: s.model.mae <= s.grid.mae },
  ];

  return (
    <main className="page predictor">
      <header className="page-head">
        <span className="label rise">Race predictor · {data.year} season</span>
        <h1 className="display rise" style={{ ['--i' as string]: 1 }}>
          Called from the grid, marked at the flag
        </h1>
        <p className="rise" style={{ ['--i' as string]: 2 }}>
          A gradient-boosted model predicts the finishing order of each race from what is known when the cars line up. It is retrained before every round on the races that came before it, so no prediction ever sees its own result. Beating the starting grid is the bar: it beat it in {beat} of {s.races} races.
        </p>
      </header>

      <section className="tiles">
        {tiles.map((t, i) => (
          <div key={t.label} className={`tile rise${t.good ? ' is-good' : ''}`} style={{ ['--i' as string]: i }}>
            <span className="label">{t.label}</span>
            <b className="num">{t.value}</b>
            <span className="tile-sub">{t.sub}</span>
          </div>
        ))}
      </section>

      <section className="panel ticks rp-chart">
        <div className="rp-chart-head">
          <div>
            <h3 className="display">Accuracy, race by race</h3>
            <p>Spearman rank correlation between the predicted and the actual order: 1.00 is a perfect call. Click a round to open it below.</p>
          </div>
          <div className="rp-key">
            <span>
              <i className="solid" style={{ borderColor: MODEL }} />
              model
            </span>
            <span>
              <i className="dashed" />
              starting grid
            </span>
          </div>
        </div>
        <AccuracyChart data={data} active={active} onPick={setActive} />
      </section>

      <div className="pred-two">
        <section className="panel ticks rp-chart">
          <div className="rp-chart-head">
            <div>
              <span className="label">Round {pad2(race.round)}</span>
              <h3 className="display" style={{ marginTop: 8 }}>
                {race.name}
              </h3>
              <p>
                Trained on {race.trainedOn.toLocaleString()} earlier results. Correlation {race.model.spearman.toFixed(2)}, {race.model.podium} of 3 podium places, winner {race.model.winner ? 'called' : 'missed'}.
              </p>
            </div>
            <div className="pred-nav">
              <button className="tp-step" onClick={() => setActive(Math.max(0, active - 1))} disabled={active === 0} aria-label="Previous round">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M8 2 4 6l4 4" />
                </svg>
              </button>
              <button className="tp-step" onClick={() => setActive(Math.min(data.races.length - 1, active + 1))} disabled={active === data.races.length - 1} aria-label="Next round">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="m4 2 4 4-4 4" />
                </svg>
              </button>
              {race.key != null && ready.has(race.key) && (
                <a className="btn ghost" href={href({ name: 'race', key: race.key, tab: 'replay' })}>
                  Watch the race
                </a>
              )}
            </div>
          </div>
          <Slope race={race} key={race.round} />
        </section>

        <aside className="pred-side">
          <section className="panel ticks rp-chart">
            <div className="rp-chart-head">
              <div>
                <h3 className="display">What the model leans on</h3>
                <p>Share of the error each input removes, in the model trained for the latest round.</p>
              </div>
            </div>
            <div className="importance">
              {data.importance.map((f, i) => (
                <div key={f.key} className="imp-row" style={{ ['--i' as string]: i }}>
                  <span>{f.label}</span>
                  <div className="imp-bar">
                    <i style={{ transform: `scaleX(${f.share / data.importance[0].share})` }} />
                  </div>
                  <b className="num">{(f.share * 100).toFixed(1)}%</b>
                </div>
              ))}
            </div>
          </section>

          <section className="panel ticks method">
            <span className="label">Method</span>
            <dl>
              <div>
                <dt>Model</dt>
                <dd>
                  {data.params.trees} regression trees, depth {data.params.depth}, learning rate {data.params.rate}
                </dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>Finishing rank; retirements ranked by laps completed</dd>
              </div>
              <div>
                <dt>Training window</dt>
                <dd>
                  {data.window[0]}–{data.window[1]}, {data.lastTraining.races} races, {data.lastTraining.rows.toLocaleString()} rows
                </dd>
              </div>
              <div>
                <dt>Evaluation</dt>
                <dd>Walk-forward: each race is predicted by a model that has never seen it</dd>
              </div>
              <div>
                <dt>Where it runs</dt>
                <dd>Trained in the pipeline, no servers; this page only reads the results</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}
