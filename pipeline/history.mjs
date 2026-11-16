// Pulls every race result since 1950 from Jolpica (the Ergast successor) and packs it
// into one compact, column-oriented file for the stats desk and the predictor.
//
//   node pipeline/history.mjs           fetch (resumes from .cache) and rebuild
//
// Jolpica allows 4 requests a second and 500 an hour; the full history is about 280
// pages of 100 rows, so this stays inside one hour's budget with a one-second gap.

import { mkdir, writeFile } from 'node:fs/promises';
import { getJson, stats } from './lib/http.mjs';

const API = 'https://api.jolpi.ca/ergast/f1';
const OUT = new URL('../public/data/', import.meta.url);
const opts = { gapMs: 1050, retries: 8 };

async function pages(path, pick) {
  const rows = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const doc = await getJson(`${API}/${path}.json?limit=100&offset=${offset}`, opts);
    total = Number(doc.MRData.total);
    const got = pick(doc.MRData);
    rows.push(...got);
    offset += 100;
    if (offset % 2000 === 0 || offset >= total) console.log(`  ${path}: ${Math.min(offset, total)}/${total}`);
  }
  return rows;
}

function interner() {
  const index = new Map();
  const list = [];
  return {
    list,
    id(key, make) {
      let i = index.get(key);
      if (i === undefined) {
        i = list.length;
        index.set(key, i);
        list.push(make());
      }
      return i;
    },
  };
}

console.log('results');
const raceRows = await pages('results', (d) => d.RaceTable.Races);
console.log('champions');
// standings are only served one season at a time
const seasons = [...new Set(raceRows.map((r) => Number(r.season)))].sort((x, y) => x - y);
const driverChamps = [];
const teamChamps = [];
for (const season of seasons) {
  const d = await getJson(`${API}/${season}/driverstandings/1.json`, opts).catch(() => null);
  driverChamps.push(...(d?.MRData?.StandingsTable?.StandingsLists ?? []));
  if (season >= 1958) {
    const c = await getJson(`${API}/${season}/constructorstandings/1.json`, opts).catch(() => null);
    teamChamps.push(...(c?.MRData?.StandingsTable?.StandingsLists ?? []));
  }
}

const drivers = interner();
const constructors = interner();
const circuits = interner();
const statuses = interner();
const races = [];
const raceIndex = new Map();
const results = [];

// a race's results can be split across pages, so merge by season and round
for (const r of raceRows) {
  const key = `${r.season}:${r.round}`;
  let ri = raceIndex.get(key);
  if (ri === undefined) {
    ri = races.length;
    raceIndex.set(key, ri);
    const c = r.Circuit;
    const ci = circuits.id(c.circuitId, () => [c.circuitId, c.circuitName, c.Location.locality, c.Location.country]);
    races.push([Number(r.season), Number(r.round), r.raceName, ci, r.date]);
  }
  for (const x of r.Results) {
    const d = x.Driver;
    const di = drivers.id(d.driverId, () => [d.driverId, d.givenName, d.familyName, d.code ?? '', d.nationality ?? '']);
    const k = x.Constructor;
    const ki = constructors.id(k.constructorId, () => [k.constructorId, k.name, k.nationality ?? '']);
    const classified = /^\d+$/.test(x.positionText);
    // 0 classified · 1 retired · 2 disqualified · 3 other (withdrawn, not classified, excluded)
    const outcome = classified ? 0 : x.positionText === 'R' ? 1 : x.positionText === 'D' ? 2 : 3;
    results.push([
      ri,
      di,
      ki,
      Number(x.grid) || 0,
      classified ? Number(x.position) : 0,
      Number(x.points) || 0,
      Number(x.laps) || 0,
      outcome,
      x.FastestLap?.rank === '1' ? 1 : 0,
      statuses.id(x.status, () => x.status),
      Number(x.position) || 0,
    ]);
  }
}

const champion = (lists, kind) =>
  lists
    .map((l) => {
      const s = kind === 'driver' ? l.DriverStandings?.[0] : l.ConstructorStandings?.[0];
      if (!s) return null;
      const id = kind === 'driver' ? drivers.id(s.Driver.driverId, () => [s.Driver.driverId, s.Driver.givenName, s.Driver.familyName, s.Driver.code ?? '', s.Driver.nationality ?? '']) : constructors.id(s.Constructor.constructorId, () => [s.Constructor.constructorId, s.Constructor.name, s.Constructor.nationality ?? '']);
      return [Number(l.season), id, Number(s.points), Number(s.wins)];
    })
    .filter(Boolean);

const years = races.map((r) => r[0]);
const lastYear = Math.max(...years);
const lastRound = Math.max(...races.filter((r) => r[0] === lastYear).map((r) => r[1]));
const scheduled = await getJson(`${API}/${lastYear}.json?limit=100`, { ...opts, cache: false }).then((d) => Number(d.MRData.total), () => lastRound);

const history = {
  generatedAt: new Date().toISOString(),
  span: [Math.min(...years), lastYear],
  // a season still in progress has no champion yet
  openSeason: lastRound < scheduled ? lastYear : null,
  drivers: drivers.list,
  constructors: constructors.list,
  circuits: circuits.list,
  statuses: statuses.list,
  races,
  resultColumns: ['race', 'driver', 'constructor', 'grid', 'position', 'points', 'laps', 'outcome', 'fastestLap', 'status', 'order'],
  results,
  champions: { drivers: champion(driverChamps, 'driver'), constructors: champion(teamChamps, 'constructor') },
};
if (history.openSeason) {
  history.champions.drivers = history.champions.drivers.filter((c) => c[0] !== history.openSeason);
  history.champions.constructors = history.champions.constructors.filter((c) => c[0] !== history.openSeason);
}

await mkdir(OUT, { recursive: true });
await writeFile(new URL('history.json', OUT), JSON.stringify(history));
console.log(`${races.length} races · ${results.length} results · ${drivers.list.length} drivers · ${stats.requests} requests, ${stats.cacheHits} from cache`);
