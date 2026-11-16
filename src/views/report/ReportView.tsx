import { useMemo, useState } from 'react';
import { clock } from '../../lib/clock';
import { gap, lapTime, longDate, onDark, pad2, raceTime } from '../../lib/format';
import { navigate } from '../../lib/router';
import { fastestLap } from '../../lib/telemetry';
import { useRace } from '../Race';
import { LapChart, RaceTrace, StrategyStrip } from './charts';

const MOMENT_LABEL: Record<string, string> = {
  start: 'Start',
  lead: 'Lead change',
  sc: 'Safety car',
  vsc: 'Virtual SC',
  red: 'Red flag',
  out: 'Retirement',
  fastest: 'Fastest lap',
  flag: 'Finish',
};

export function ReportView() {
  const { session } = useRace();
  const { meta, report } = session;
  const [focus, setFocus] = useState<number | null>(null);

  const order = useMemo(() => [...meta.classification].sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99)), [meta]);
  const podium = order.slice(0, 3);
  const bests = useMemo(() => new Map(meta.drivers.map((d) => [d.n, fastestLap(meta.laps[d.n] ?? [])?.d ?? null])), [meta]);
  const overallBest = report.fastest?.d ?? null;

  const watch = (t: number | null) => {
    if (t == null) return;
    clock.seek(Math.max(0, t - 6));
    navigate({ name: 'race', key: meta.key, tab: 'replay' });
    clock.play();
  };

  return (
    <div className="report">
      <header className="rp-hero">
        <div className="rp-kicker rise">
          <span className="num">R{pad2(meta.round)}</span>
          <span>Race report</span>
          <span>{meta.circuit}</span>
          <span>{longDate(meta.date)}</span>
        </div>
        <h2 className="rp-headline display rise" style={{ ['--i' as string]: 1 }}>
          {report.headline}
        </h2>
        <p className="rp-standfirst rise" style={{ ['--i' as string]: 2 }}>
          {report.standfirst}
        </p>

        <div className="rp-podium rise" style={{ ['--i' as string]: 3 }}>
          {podium.map((c, i) => {
            const d = session.byNum.get(c.n)!;
            return (
              <div key={c.n} className={`rp-step p${i + 1}`} style={{ ['--c' as string]: onDark(d.colour) }}>
                <span className="rp-step-pos display">{i + 1}</span>
                <div>
                  <span>{d.first}</span>
                  <b>{d.last}</b>
                  <em>{d.team}</em>
                </div>
                <span className="num rp-step-time">{i === 0 ? raceTime(c.time) : gap(c.gap) || '–'}</span>
              </div>
            );
          })}
        </div>
      </header>

      <section className="rp-facts">
        {report.facts.map((f, i) => {
          const d = f.n != null ? session.byNum.get(f.n) : null;
          return (
            <div key={f.label} className="rp-fact rise" style={{ ['--i' as string]: i, ['--c' as string]: d ? onDark(d.colour) : 'var(--line-3)' }}>
              <span className="label">{f.label}</span>
              <b className={/\d/.test(f.value) ? 'num' : 'display'}>{f.value}</b>
              <span className="rp-fact-sub">{f.sub}</span>
            </div>
          );
        })}
      </section>

      <div className="rp-body">
        <article className="rp-story">
          {report.sections.map((s) => (
            <section key={s.title}>
              <h3 className="label">{s.title}</h3>
              <p>{s.body}</p>
            </section>
          ))}
          <p className="rp-note">Written from the timing data by a rules engine. Every figure in this report traces back to a row in the session files.</p>
        </article>

        <aside className="rp-moments panel ticks">
          <div className="panel-head">
            <span className="label">Key moments</span>
            <span className="dim" style={{ fontSize: 11 }}>
              click to watch
            </span>
          </div>
          <ol>
            {report.moments.map((m, i) => (
              <li key={i}>
                <button onClick={() => watch(m.t)} disabled={m.t == null} className={`moment is-${m.kind}`}>
                  <span className="num moment-lap">L{m.lap}</span>
                  <i />
                  <span className="moment-body">
                    <em>{MOMENT_LABEL[m.kind]}</em>
                    {m.text}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                    <path d="M3 1.5v9l7.5-4.5z" />
                  </svg>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <section className="panel ticks rp-chart">
        <div className="rp-chart-head">
          <div>
            <h3 className="display">Lap chart</h3>
            <p>Position at the end of every lap. Hover a line to follow one driver through the race.</p>
          </div>
          <div className="rp-key">
            <span>
              <i className="solid" />
              first car
            </span>
            <span>
              <i className="dashed" />
              second car of a team
            </span>
            {meta.trackStatus.length > 0 && (
              <span>
                <i className="band" />
                neutralised
              </span>
            )}
          </div>
        </div>
        <LapChart session={session} focus={focus} onFocus={setFocus} />
      </section>

      <div className="rp-two">
        <section className="panel ticks rp-chart">
          <div className="rp-chart-head">
            <div>
              <h3 className="display">Race trace</h3>
              <p>Gap to the winner at the end of each lap. Steps are pit stops; converging lines are a neutralised race.</p>
            </div>
          </div>
          <RaceTrace session={session} focus={focus} onFocus={setFocus} />
        </section>

        <section className="panel ticks rp-chart">
          <div className="rp-chart-head">
            <div>
              <h3 className="display">Tyre strategy</h3>
              <p>Every stint, in finishing order.</p>
            </div>
          </div>
          <StrategyStrip session={session} focus={focus} onFocus={setFocus} />
        </section>
      </div>

      <section className="panel ticks rp-chart">
        <div className="rp-chart-head">
          <div>
            <h3 className="display">Classification</h3>
          </div>
        </div>
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th className="l">Driver</th>
                <th className="l">Team</th>
                <th>Grid</th>
                <th>+/−</th>
                <th>Laps</th>
                <th>Time / gap</th>
                <th>Best lap</th>
                <th>Stops</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {order.map((c) => {
                const d = session.byNum.get(c.n)!;
                const moved = c.pos && c.grid ? c.grid - c.pos : null;
                const best = bests.get(c.n) ?? null;
                const stops = Math.max(0, meta.stints.filter((s) => s.n === c.n).length - 1);
                return (
                  <tr key={c.n} className={focus === c.n ? 'is-focus' : ''} onPointerEnter={() => setFocus(c.n)} onPointerLeave={() => setFocus(null)}>
                    <td className="num">{c.pos ?? c.status}</td>
                    <td className="l">
                      <i className="team-bar" style={{ ['--c' as string]: onDark(d.colour) }} />
                      <b>{d.code}</b>
                      <span>
                        {d.first} {d.last}
                      </span>
                    </td>
                    <td className="l dim">{d.team}</td>
                    <td className="num">{c.grid ?? '–'}</td>
                    <td className={`num ${moved == null || moved === 0 ? 'dim' : moved > 0 ? 'up' : 'down'}`}>{moved == null ? '–' : moved === 0 ? '0' : `${moved > 0 ? '▲' : '▼'}${Math.abs(moved)}`}</td>
                    <td className="num">{c.laps}</td>
                    <td className="num">{c.status !== 'FIN' ? c.status : c.pos === 1 ? raceTime(c.time) : gap(c.gap) || '–'}</td>
                    <td className={`num${best != null && overallBest != null && Math.abs(best - overallBest) < 1e-4 ? ' rank-2' : ''}`}>{lapTime(best)}</td>
                    <td className="num">{stops}</td>
                    <td className="num">{c.points || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
