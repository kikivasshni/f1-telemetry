import { useEffect, useMemo, useRef, useState } from 'react';
import { loadManifest, loadSession } from '../lib/data';
import { compact, onDark, pad2, raceTime, shortDate } from '../lib/format';
import { useCountUp } from '../lib/hooks';
import { LiveTiming } from '../lib/live';
import { href, type RaceTab } from '../lib/router';
import type { Manifest, RaceSummary, SeasonIndex, Session } from '../lib/types';
import { Scene3D } from './replay/Scene3D';

const AMBIENT_RATE = 8;

function HeroScene({ race, onState }: { race: RaceSummary; onState: (s: { lap: number; total: number; leader: string; colour: string } | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let scene: Scene3D | null = null;
    let timer = 0;
    let alive = true;

    loadSession(race.key).then((session: Session) => {
      if (!alive || !host.current) return;
      const live = new LiveTiming(session);
      const { meta } = session;
      const start = Math.max(0, meta.raceStart - 4);
      const span = Math.max(60, meta.duration - 60 - start);
      const t0 = performance.now();
      const time = () => start + ((((performance.now() - t0) / 1000) * AMBIENT_RATE) % span);
      try {
        scene = new Scene3D(host.current, session, live, { ambient: true, time });
      } catch {
        return;
      }
      setReady(true);
      const tick = () => {
        const t = time();
        const lead = live.rows(t)[0];
        const d = lead ? session.byNum.get(lead.n) : null;
        onState(d ? { lap: live.raceLap(t), total: meta.totalLaps, leader: d.code, colour: onDark(d.colour) } : null);
      };
      tick();
      timer = window.setInterval(tick, 500);
    }, () => {});

    return () => {
      alive = false;
      window.clearInterval(timer);
      scene?.dispose();
    };
  }, [race.key, onState]);

  return <div className={`hero-scene${ready ? ' is-ready' : ''}`} ref={host} aria-hidden="true" />;
}

function Stat({ value, label, format }: { value: number; label: string; format: (n: number) => string }) {
  const v = useCountUp(value);
  return (
    <div className="hero-stat">
      <b className="num">{format(v)}</b>
      <span className="label">{label}</span>
    </div>
  );
}

/** Circuit outline that sends a marker round the lap while hovered. */
function Outline({ points, colour, active }: { points: [number, number][]; colour: string; active: boolean }) {
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const d = useMemo(() => `${points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('')}Z`, [points]);

  useEffect(() => {
    const p = path.current;
    const c = dot.current;
    if (!p || !c || !active) return;
    const len = p.getTotalLength();
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const pt = p.getPointAtLength((((now - t0) / 3200) % 1) * len);
      c.setAttribute('cx', String(pt.x));
      c.setAttribute('cy', String(pt.y));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <svg className="outline" viewBox="-40 -40 1080 1080" style={{ ['--c' as string]: colour }} aria-hidden="true">
      <path d={d} className="outline-glow" />
      <path d={d} className="outline-line" ref={path} pathLength={1} />
      <circle ref={dot} r="22" className="outline-dot" cx={points[0][0]} cy={points[0][1]} />
    </svg>
  );
}

function RaceCard({ race, i }: { race: RaceSummary; i: number }) {
  const [hover, setHover] = useState(false);
  const ready = race.status === 'ready';
  const colour = race.winner ? onDark(race.winner.colour) : '#EDEBE6';

  const body = (
    <>
      <div className="rc-top">
        <span className="num rc-round">R{pad2(race.round)}</span>
        <span className="num rc-date">{shortDate(race.date)}</span>
      </div>
      <div className="rc-outline">
        {race.outline ? <Outline points={race.outline} colour={colour} active={hover} /> : <div className="rc-tbd">{race.status === 'upcoming' ? 'Lights out soon' : 'Awaiting data'}</div>}
      </div>
      <div className="rc-name">
        <h3>{race.name.replace(/ Grand Prix$/, '')}</h3>
        <span>
          {race.circuit} · {race.country}
        </span>
      </div>
      {ready && race.winner ? (
        <div className="rc-foot">
          <i className="team-bar" style={{ ['--c' as string]: colour }} />
          <b>{race.winner.code}</b>
          <span className="rc-winner">{race.winner.last}</span>
          <span className="rc-podium">
            {race.podium?.slice(1).map((p) => (
              <em key={p.code}>{p.code}</em>
            ))}
          </span>
          <span className="num rc-time">{raceTime(race.winner.time).slice(0, -4)}</span>
        </div>
      ) : (
        <div className="rc-foot is-empty">
          <span className="label">{race.status === 'upcoming' ? 'Upcoming' : 'Data pending'}</span>
        </div>
      )}
      {ready && (
        <span className="rc-open">
          Open
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5" />
          </svg>
        </span>
      )}
    </>
  );

  const props = {
    className: `racecard ticks${ready ? '' : ' is-off'}`,
    style: { ['--i' as string]: i % 12, ['--c' as string]: colour },
    onPointerEnter: () => setHover(true),
    onPointerLeave: () => setHover(false),
  };
  return ready ? (
    <a {...props} href={href({ name: 'race', key: race.key, tab: 'replay' })} aria-label={`${race.name}, won by ${race.winner?.last ?? 'unknown'}`}>
      {body}
    </a>
  ) : (
    <div {...props}>{body}</div>
  );
}

const MODULES: { n: string; title: string; text: string; tab?: RaceTab; route?: 'predictor' | 'stats' }[] = [
  { n: '01', title: 'Replay', text: 'The whole field on a 3D circuit with real elevation. Scrub, follow a car, ride behind it.', tab: 'replay' },
  { n: '02', title: 'Telemetry', text: 'Two laps laid over each other, metre for metre: speed, throttle, brake, gear and the time between them.', tab: 'telemetry' },
  { n: '03', title: 'Engineer', text: 'Corner by corner, where the lap time goes and what to do about it, with the lines both cars drove.', tab: 'engineer' },
  { n: '04', title: 'Report', text: 'The story of the race written from the timing data, with the lap chart, race trace and every stint.', tab: 'report' },
  { n: '05', title: 'Predictor', text: 'A gradient-boosted model calls the finishing order from the grid, then gets marked against what happened.', route: 'predictor' },
  { n: '06', title: 'Stats desk', text: 'Ask anything about every season since 1950 and see the query that produced the answer.', route: 'stats' },
];

export function Home({ index }: { index: SeasonIndex }) {
  const season = useMemo(() => Object.values(index.seasons).sort((a, b) => b.year - a.year)[0], [index]);
  const ready = season.races.filter((r) => r.status === 'ready');
  const latest = ready[ready.length - 1];
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [now, setNow] = useState<{ lap: number; total: number; leader: string; colour: string } | null>(null);

  useEffect(() => {
    loadManifest().then(setManifest, () => {});
  }, []);

  if (!latest) {
    return (
      <div className="loader">
        <div className="loader-inner">
          <div className="label">Pit Wall</div>
          <div className="loader-title">The lake is empty</div>
          <p className="dim" style={{ marginTop: 10 }}>
            Run the ingest pipeline to load a season.
          </p>
        </div>
      </div>
    );
  }

  return (
    <main className="home">
      <section className="hero">
        <HeroScene race={latest} onState={setNow} />
        <div className="hero-scrim" />

        <div className="hero-copy">
          <div className="hero-kicker rise">
            <i className="pulse-dot" />
            {season.year} season · {ready.length} of {season.races.length} races in the lake
          </div>
          <h1 className="display hero-title">
            <span className="rise" style={{ ['--i' as string]: 1 }}>
              Every car.
            </span>
            <span className="rise" style={{ ['--i' as string]: 2 }}>
              Every lap.
            </span>
            <span className="rise is-outline" style={{ ['--i' as string]: 3 }}>
              Every metre.
            </span>
          </h1>
          <p className="hero-sub rise" style={{ ['--i' as string]: 4 }}>
            Pit Wall rebuilds a Grand Prix from open timing data: the whole field on a 3D circuit, any two laps compared metre for metre, and an engineer that tells you where the time went.
          </p>
          <div className="hero-cta rise" style={{ ['--i' as string]: 5 }}>
            <a className="btn" href={href({ name: 'race', key: latest.key, tab: 'replay' })}>
              Watch {latest.name.replace(/ Grand Prix$/, '')}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M2 7h10M7.5 2.5 12 7l-4.5 4.5" />
              </svg>
            </a>
            <a className="btn ghost" href="#season" onClick={(e) => { e.preventDefault(); document.getElementById('season')?.scrollIntoView({ behavior: 'smooth' }); }}>
              Browse the season
            </a>
          </div>
        </div>

        <div className="hero-foot">
          <div className="hero-stats rise" style={{ ['--i' as string]: 6 }}>
            <Stat value={ready.length} label="Races" format={(n) => String(Math.round(n))} />
            <Stat value={manifest?.positionSamples ?? 0} label="Position samples" format={(n) => compact(Math.round(n))} />
            <Stat value={manifest?.telemetrySamples ?? 0} label="Telemetry samples" format={(n) => compact(Math.round(n))} />
            <Stat value={(manifest?.bytes ?? 0) / 1e6} label="Megabytes, all static" format={(n) => n.toFixed(0)} />
          </div>
          <a className="hero-live rise" style={{ ['--i' as string]: 7, ['--c' as string]: now?.colour ?? 'var(--ink-3)' }} href={href({ name: 'race', key: latest.key, tab: 'replay' })}>
            <span className="label">Playing behind this text, at {AMBIENT_RATE}×</span>
            <b>{latest.name}</b>
            <span className="num">
              {now ? (
                <>
                  Lap {now.lap}/{now.total} · <i /> {now.leader} leads
                </>
              ) : (
                'loading car positions…'
              )}
            </span>
          </a>
        </div>
      </section>

      <section className="season" id="season">
        <header className="section-head">
          <div>
            <span className="label">The calendar</span>
            <h2 className="display">{season.year} season</h2>
          </div>
          <p>Hover a circuit to send a car round it. Open a race to replay it.</p>
        </header>
        <div className="racegrid">
          {season.races.map((r, i) => (
            <RaceCard key={r.key} race={r} i={i} />
          ))}
        </div>
      </section>

      <section className="modules">
        <header className="section-head">
          <div>
            <span className="label">What is on the wall</span>
            <h2 className="display">Six instruments, one data lake</h2>
          </div>
          <p>Every screen reads the same static files. Nothing calls a server when you press play.</p>
        </header>
        <div className="module-list">
          {MODULES.map((m) => (
            <a key={m.n} className="module" href={m.tab ? href({ name: 'race', key: latest.key, tab: m.tab }) : href({ name: m.route! })}>
              <span className="num">{m.n}</span>
              <h3 className="display">{m.title}</h3>
              <p>{m.text}</p>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 11h14M11.5 4.5 18 11l-6.5 6.5" />
              </svg>
            </a>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>
          Timing data from <a href="https://openf1.org" target="_blank" rel="noreferrer">OpenF1</a> (CC BY-NC-SA 4.0) and <a href="https://github.com/jolpica/jolpica-f1" target="_blank" rel="noreferrer">Jolpica F1</a>. Circuit maps from MultiViewer. Non-commercial.
        </span>
        <span>Unofficial and not associated in any way with the Formula 1 companies. F1, FORMULA 1 and GRAND PRIX are trade marks of Formula One Licensing B.V.</span>
      </footer>
    </main>
  );
}
