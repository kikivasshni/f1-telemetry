import { useEffect, useState } from 'react';
import { loadManifest } from '../lib/data';
import { bytes, compact, onDark, pad2 } from '../lib/format';
import { href } from '../lib/router';
import type { Manifest, RaceSummary, SeasonIndex } from '../lib/types';

type Row = RaceSummary & { bytes?: { pos: number; tel: number }; samples?: { positions: number; telemetry: number } };

const STAGES = [
  { n: '01', title: 'Sources', body: 'OpenF1 for car positions, telemetry and timing. Jolpica for every result since 1950.', meta: 'free tiers · no keys' },
  { n: '02', title: 'Throttled client', body: 'One request slot every 2.15 s per host, retries with backoff, and a disk cache so a failed run resumes where it stopped.', meta: '30 req/min upstream limit' },
  { n: '03', title: 'Session builder', body: 'Builds the track model with elevation, resamples every car onto a 4 Hz grid, delta-encodes to int16 and gzips.', meta: 'about 3.5 MB per race' },
  { n: '04', title: 'Models and reports', body: 'Writes the race report from the timing data and trains the predictor walk-forward over the season.', meta: 'runs in GitHub Actions' },
  { n: '05', title: 'Static lake', body: 'Plain files on a CDN. The app never calls an API at view time, so there is nothing to scale and nothing to pay for.', meta: 'GitHub Pages' },
  { n: '06', title: 'Browser', body: 'Inflates the binary streams, interpolates cars to 60 fps and runs the stats queries locally.', meta: 'three.js · canvas' },
];

export function Lake({ index }: { index: SeasonIndex }) {
  const [m, setM] = useState<Manifest | null>(null);
  useEffect(() => {
    loadManifest().then(setM, () => {});
  }, []);

  const races = Object.values(index.seasons)
    .flatMap((s) => s.races as Row[])
    .filter((r) => r.status === 'ready');
  const biggest = Math.max(1, ...races.map((r) => (r.bytes?.pos ?? 0) + (r.bytes?.tel ?? 0)));
  const tiles = m
    ? [
        { label: 'Sessions', value: String(m.sessions), sub: 'race sessions ingested' },
        { label: 'Lake size', value: bytes(m.bytes), sub: `${m.files.toLocaleString()} static files` },
        { label: 'Position samples', value: compact(m.positionSamples), sub: 'x/y for every car, 4 Hz' },
        { label: 'Telemetry samples', value: compact(m.telemetrySamples), sub: 'speed, rpm, gear, pedals' },
      ]
    : [];

  return (
    <main className="page lake">
      <header className="page-head">
        <span className="label rise">Data lake</span>
        <h1 className="display rise" style={{ ['--i' as string]: 1 }}>
          Ingest once, serve forever
        </h1>
        <p className="rise" style={{ ['--i' as string]: 2 }}>
          The upstream API allows thirty requests a minute, so nothing in the app talks to it. A pipeline pulls each race once, shapes it into compact static files and publishes them. Everything you see on the wall is read from those files.
        </p>
      </header>

      <section className="tiles">
        {tiles.map((t, i) => (
          <div key={t.label} className="tile rise" style={{ ['--i' as string]: i }}>
            <span className="label">{t.label}</span>
            <b className="num">{t.value}</b>
            <span className="tile-sub">{t.sub}</span>
          </div>
        ))}
      </section>

      <section className="flow">
        {STAGES.map((s, i) => (
          <div key={s.n} className="flow-step panel ticks rise" style={{ ['--i' as string]: i }}>
            <span className="num">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            <em>{s.meta}</em>
          </div>
        ))}
      </section>

      {m && (
        <section className="panel ticks rp-chart">
          <div className="rp-chart-head">
            <div>
              <h3 className="display">Last pipeline run</h3>
              <p>{new Date(m.generatedAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })} UTC</p>
            </div>
          </div>
          <div className="runstats">
            <div>
              <span className="label">Sessions built</span>
              <b className="num">{m.lastRun.ingested}</b>
            </div>
            <div>
              <span className="label">Upstream requests</span>
              <b className="num">{m.lastRun.requests.toLocaleString()}</b>
            </div>
            <div>
              <span className="label">Served from cache</span>
              <b className="num">{m.lastRun.cacheHits.toLocaleString()}</b>
            </div>
            <div>
              <span className="label">Retries</span>
              <b className="num">{m.lastRun.retries}</b>
            </div>
            <div>
              <span className="label">Downloaded</span>
              <b className="num">{bytes(m.lastRun.downloadedBytes)}</b>
            </div>
            <div>
              <span className="label">Run time</span>
              <b className="num">
                {Math.floor(m.lastRun.seconds / 60)}m {m.lastRun.seconds % 60}s
              </b>
            </div>
            <div>
              <span className="label">Shrink</span>
              <b className="num">{m.lastRun.downloadedBytes ? `${Math.round(m.lastRun.downloadedBytes / Math.max(1, m.bytes))}×` : '–'}</b>
            </div>
          </div>
        </section>
      )}

      <section className="panel ticks rp-chart">
        <div className="rp-chart-head">
          <div>
            <h3 className="display">Sessions</h3>
            <p>What each race costs to store and serve.</p>
          </div>
          <div className="rp-key">
            <span>
              <i className="band" style={{ background: 'var(--ink-2)' }} />
              positions
            </span>
            <span>
              <i className="band" style={{ background: 'var(--ink-4)' }} />
              telemetry
            </span>
          </div>
        </div>
        <div className="rp-table-wrap">
          <table className="rp-table lake-table">
            <thead>
              <tr>
                <th>Rnd</th>
                <th className="l">Race</th>
                <th className="l">Winner</th>
                <th>Laps</th>
                <th>Position samples</th>
                <th>Telemetry samples</th>
                <th className="l">Size on disk</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {races.map((r) => {
                const pos = r.bytes?.pos ?? 0;
                const tel = r.bytes?.tel ?? 0;
                return (
                  <tr key={r.key}>
                    <td className="num">{pad2(r.round)}</td>
                    <td className="l">
                      <a href={href({ name: 'race', key: r.key, tab: 'replay' })}>{r.name}</a>
                    </td>
                    <td className="l">
                      {r.winner && (
                        <span className="lake-winner">
                          <i className="team-bar" style={{ ['--c' as string]: onDark(r.winner.colour) }} />
                          {r.winner.code}
                        </span>
                      )}
                    </td>
                    <td className="num">{r.laps}</td>
                    <td className="num">{(r.samples?.positions ?? 0).toLocaleString()}</td>
                    <td className="num">{(r.samples?.telemetry ?? 0).toLocaleString()}</td>
                    <td className="l">
                      <span className="lake-size">
                        <i style={{ width: `${(pos / biggest) * 100}%`, background: 'var(--ink-2)' }} />
                        <i style={{ width: `${(tel / biggest) * 100}%`, background: 'var(--ink-4)' }} />
                      </span>
                    </td>
                    <td className="num">{bytes(pos + tel)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {m && (
        <section className="sources">
          {m.sources.map((s) => (
            <a key={s.name} className="panel ticks source" href={s.url} target="_blank" rel="noreferrer">
              <span className="label">Source</span>
              <h3>{s.name}</h3>
              <span>{s.licence}</span>
              <span className="num">{s.limit}</span>
            </a>
          ))}
        </section>
      )}
    </main>
  );
}
