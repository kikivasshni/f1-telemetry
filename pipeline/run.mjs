// Ingests every finished race of a season that is not in the lake yet, then rebuilds
// the index the app boots from.
//
//   node pipeline/run.mjs --year 2026            all finished races of 2026
//   node pipeline/run.mjs --year 2026 --limit 2  only the next two missing races
//   node pipeline/run.mjs --session 11412        one session (re-ingests it)
//   node pipeline/run.mjs --year 2026 --force    rebuild everything from cache

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { getJson, stats } from './lib/http.mjs';
import { ingestSession } from './ingest-session.mjs';

const API = 'https://api.openf1.org/v1';
const DATA = new URL('../public/data/', import.meta.url);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? true);
};
const year = Number(flag('year') ?? new Date().getUTCFullYear());
const only = flag('session') ? Number(flag('session')) : null;
const limit = flag('limit') ? Number(flag('limit')) : Infinity;
const force = args.includes('--force');

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return fallback;
  }
}

async function dirSize(url) {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(url, { withFileTypes: true }).catch(() => [])) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
    if (entry.isDirectory()) {
      const sub = await dirSize(child);
      bytes += sub.bytes;
      files += sub.files;
    } else {
      bytes += (await stat(child)).size;
      files++;
    }
  }
  return { bytes, files };
}

const started = Date.now();
await mkdir(DATA, { recursive: true });

const sessions = (await getJson(`${API}/sessions?year=${year}&session_name=Race`, { cache: false }))
  .filter((s) => !s.is_cancelled)
  .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
const meetings = new Map((await getJson(`${API}/meetings?year=${year}`, { cache: false })).map((m) => [m.meeting_key, m]));

const index = await readJson(new URL('index.json', DATA), { seasons: {} });
const season = (index.seasons[year] ??= { year, races: [] });
const known = new Map(season.races.filter((r) => r.status === 'ready').map((r) => [r.key, r]));

const races = [];
let ingested = 0;
for (let i = 0; i < sessions.length; i++) {
  const session = sessions[i];
  const meeting = meetings.get(session.meeting_key) ?? {};
  const roundNo = i + 1;
  const finished = Date.parse(session.date_end) < Date.now() - 6 * 3600 * 1000;
  const base = {
    key: session.session_key,
    year,
    round: roundNo,
    name: meeting.meeting_name ?? `${session.country_name} Grand Prix`,
    circuit: session.circuit_short_name,
    country: session.country_name,
    countryCode: session.country_code,
    date: session.date_start,
  };

  const wanted = only ? session.session_key === only : finished && (force || !known.has(session.session_key));
  if (wanted && ingested < limit) {
    console.log(`[${roundNo}/${sessions.length}] ${base.name} (${session.session_key})`);
    const outDir = new URL(`sessions/${session.session_key}/`, DATA);
    await mkdir(outDir, { recursive: true });
    try {
      const summary = await ingestSession({ session, meeting, round: roundNo, outDir });
      races.push({ ...summary, status: 'ready' });
      ingested++;
      console.log(`  done · ${(summary.bytes.pos / 1e6).toFixed(2)} MB positions · ${(summary.bytes.tel / 1e6).toFixed(2)} MB telemetry`);
    } catch (err) {
      console.error(`  failed: ${err.message}`);
      races.push(known.get(session.session_key) ?? { ...base, status: finished ? 'pending' : 'upcoming' });
    }
  } else {
    races.push(known.get(session.session_key) ?? { ...base, status: finished ? 'pending' : 'upcoming' });
  }

  // keep the index current after every race so an interrupted run loses nothing
  const rest = sessions.slice(i + 1).map((s, k) => {
    const m = meetings.get(s.meeting_key) ?? {};
    const done = Date.parse(s.date_end) < Date.now() - 6 * 3600 * 1000;
    return (
      known.get(s.session_key) ?? {
        key: s.session_key,
        year,
        round: i + 2 + k,
        name: m.meeting_name ?? `${s.country_name} Grand Prix`,
        circuit: s.circuit_short_name,
        country: s.country_name,
        countryCode: s.country_code,
        date: s.date_start,
        status: done ? 'pending' : 'upcoming',
      }
    );
  });
  season.races = [...races, ...rest];
  await writeFile(new URL('index.json', DATA), JSON.stringify(index));
}

const lake = await dirSize(DATA);
const ready = Object.values(index.seasons).flatMap((s) => s.races).filter((r) => r.status === 'ready');
const manifest = {
  generatedAt: new Date().toISOString(),
  sessions: ready.length,
  files: lake.files,
  bytes: lake.bytes,
  positionSamples: ready.reduce((s, r) => s + (r.samples?.positions ?? 0), 0),
  telemetrySamples: ready.reduce((s, r) => s + (r.samples?.telemetry ?? 0), 0),
  lastRun: {
    ingested,
    requests: stats.requests,
    cacheHits: stats.cacheHits,
    retries: stats.retries,
    downloadedBytes: stats.bytes,
    seconds: Math.round((Date.now() - started) / 1000),
  },
  sources: [
    { name: 'OpenF1', url: 'https://openf1.org', licence: 'CC BY-NC-SA 4.0', limit: '30 requests / minute' },
    { name: 'Jolpica F1', url: 'https://github.com/jolpica/jolpica-f1', licence: 'Apache-2.0', limit: '500 requests / hour' },
  ],
};
await writeFile(new URL('manifest.json', DATA), JSON.stringify(manifest));
console.log(`\n${ingested} session(s) ingested · ${stats.requests} requests · ${stats.cacheHits} cache hits · ${manifest.lastRun.seconds}s`);
