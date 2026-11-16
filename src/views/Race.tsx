import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { clock } from '../lib/clock';
import { loadSession } from '../lib/data';
import { longDate, pad2 } from '../lib/format';
import { LiveTiming } from '../lib/live';
import { href, type RaceTab } from '../lib/router';
import { useApp } from '../lib/store';
import type { SeasonIndex, Session } from '../lib/types';
import { EngineerView } from './engineer/EngineerView';
import { ReplayView } from './replay/ReplayView';
import { ReportView } from './report/ReportView';
import { TelemetryView } from './telemetry/TelemetryView';

interface RaceContext {
  session: Session;
  live: LiveTiming;
}

const Ctx = createContext<RaceContext | null>(null);

export function useRace(): RaceContext {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRace outside a race');
  return v;
}

const TABS: { id: RaceTab; label: string; hint: string }[] = [
  { id: 'replay', label: 'Replay', hint: 'Every car, every lap' },
  { id: 'telemetry', label: 'Telemetry', hint: 'Driver against driver' },
  { id: 'engineer', label: 'Engineer', hint: 'Corner by corner' },
  { id: 'report', label: 'Report', hint: 'The story of the race' },
];

export function Race({ raceKey, tab, index }: { raceKey: number; tab: RaceTab; index: SeasonIndex }) {
  const [session, setSession] = useState<Session | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const summary = useMemo(
    () =>
      Object.values(index.seasons)
        .flatMap((s) => s.races)
        .find((r) => r.key === raceKey),
    [index, raceKey],
  );

  // a race the index knows about but has no files for yet: nothing to fetch
  const waiting = summary && summary.status !== 'ready' ? summary.status : null;

  useEffect(() => {
    let alive = true;
    setSession(null);
    setError(null);
    if (waiting) return;
    loadSession(raceKey, (f) => alive && setProgress(f)).then(
      (s) => {
        if (!alive) return;
        const app = useApp.getState();
        app.reset();
        const winner = s.meta.classification.find((c) => c.pos === 1)?.n ?? s.meta.drivers[0].n;
        const second = s.meta.classification.find((c) => c.pos === 2)?.n ?? s.meta.drivers[1]?.n ?? null;
        app.select(winner);
        app.setRival(second);
        clock.configure(s.meta.duration, Math.max(0, s.meta.raceStart - 6));
        setSession(s);
      },
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
      clock.pause();
    };
  }, [raceKey, waiting]);

  const live = useMemo(() => (session ? new LiveTiming(session) : null), [session]);
  const ctx = useMemo(() => (session && live ? { session, live } : null), [session, live]);

  if (error || waiting) {
    return (
      <div className="loader">
        <div className="loader-inner">
          <div className="label">{summary?.name ?? `Session ${raceKey}`}</div>
          <div className="loader-title">{waiting === 'upcoming' ? 'Not raced yet' : waiting ? 'Awaiting data' : 'Session not in the lake'}</div>
          <p className="dim" style={{ margin: '10px 0 18px' }}>
            {waiting
              ? 'This race appears here once its data has been ingested after the chequered flag.'
              : 'This session has not been ingested yet.'}
          </p>
          <a className="btn ghost" href={href({ name: 'home' })}>
            Back to the season
          </a>
        </div>
      </div>
    );
  }

  if (!session || !ctx) {
    return (
      <div className="loader">
        <div className="loader-inner">
          <div className="label">{summary ? `Round ${pad2(summary.round)} · ${summary.circuit}` : 'Loading'}</div>
          <div className="loader-title">{summary?.name ?? 'Loading session'}</div>
          <div className="loader-bar">
            <i style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
          </div>
          <div className="num dim" style={{ marginTop: 8, fontSize: 11 }}>
            {Math.round(progress * 100)}% · positions for every car at 4 Hz
          </div>
        </div>
      </div>
    );
  }

  const { meta } = session;
  return (
    <Ctx.Provider value={ctx}>
      <div className={`race race-${tab}`}>
        <div className="race-head">
          <a className="race-back" href={href({ name: 'home' })} aria-label="Back to the season">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M9 2 4 7l5 5" />
            </svg>
          </a>
          <div className="race-title">
            <span className="race-round num">R{pad2(meta.round)}</span>
            <h1>{meta.name}</h1>
            <span className="race-sub">
              {meta.circuit} · {longDate(meta.date)}
            </span>
          </div>
          <nav className="race-tabs" aria-label="Race views">
            {TABS.map((t) => (
              <a
                key={t.id}
                className={`race-tab${tab === t.id ? ' is-active' : ''}`}
                href={href({ name: 'race', key: raceKey, tab: t.id })}
                title={t.hint}
              >
                {t.label}
              </a>
            ))}
          </nav>
        </div>
        {tab === 'replay' && <ReplayView />}
        {tab === 'telemetry' && <TelemetryView />}
        {tab === 'engineer' && <EngineerView />}
        {tab === 'report' && <ReportView />}
      </div>
    </Ctx.Provider>
  );
}
