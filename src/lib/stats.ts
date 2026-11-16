// The stats desk: a question in plain English becomes a query plan, the plan runs over the
// results table in the browser, and the answer is shown with the SQL it corresponds to.
// Answers come from the data, never from memory.

export interface History {
  generatedAt: string;
  span: [number, number];
  openSeason: number | null;
  drivers: [string, string, string, string, string][];
  constructors: [string, string, string][];
  circuits: [string, string, string, string][];
  statuses: string[];
  races: [number, number, string, number, string][];
  results: number[][];
  champions: { drivers: [number, number, number, number][]; constructors: [number, number, number, number][] };
}

// result row columns
const RACE = 0, DRIVER = 1, TEAM = 2, GRID = 3, POS = 4, POINTS = 5, OUTCOME = 7, FASTEST = 8, STATUS = 9;

type Metric = 'wins' | 'podiums' | 'poles' | 'dnfs' | 'points' | 'starts' | 'fastest' | 'titles' | 'frontrow' | 'scores';

const METRICS: Record<Metric, { label: string; unit: string; where: string; test: (r: number[]) => boolean; sum?: boolean }> = {
  wins: { label: 'Wins', unit: 'wins', where: 'position = 1', test: (r) => r[POS] === 1 },
  podiums: { label: 'Podiums', unit: 'podiums', where: 'position <= 3', test: (r) => r[POS] >= 1 && r[POS] <= 3 },
  poles: { label: 'Pole positions', unit: 'poles', where: 'grid = 1', test: (r) => r[GRID] === 1 },
  frontrow: { label: 'Front-row starts', unit: 'front-row starts', where: 'grid <= 2', test: (r) => r[GRID] === 1 || r[GRID] === 2 },
  dnfs: { label: 'Retirements', unit: 'retirements', where: "outcome = 'retired'", test: (r) => r[OUTCOME] === 1 },
  scores: { label: 'Points finishes', unit: 'points finishes', where: 'points > 0', test: (r) => r[POINTS] > 0 },
  fastest: { label: 'Fastest laps', unit: 'fastest laps', where: 'fastest_lap_rank = 1', test: (r) => r[FASTEST] === 1 },
  points: { label: 'Points', unit: 'points', where: '', test: () => true, sum: true },
  starts: { label: 'Race entries', unit: 'race entries', where: '', test: () => true },
  titles: { label: 'World championships', unit: 'titles', where: '', test: () => true },
};

export interface Answer {
  ok: boolean;
  headline: string;
  value?: string;
  detail?: string;
  columns?: string[];
  rows?: { cells: (string | number)[]; bar?: number }[];
  sql?: string;
  scanned?: number;
  ms?: number;
  note?: string;
}

const ascii = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type Entity = { type: 'driver' | 'team' | 'circuit' | 'country' | 'gp'; id: number | string; key: string; rank: number };

const TEAM_ALIASES: Record<string, string> = { merc: 'mercedes', mercs: 'mercedes', redbull: 'red_bull', 'red bull racing': 'red_bull', aston: 'aston_martin', haas: 'haas', 'racing bulls': 'rb', sauber: 'sauber', alfa: 'alfa' };
const CIRCUIT_ALIASES: Record<string, string> = {
  cota: 'americas', austin: 'americas', interlagos: 'interlagos', 'abu dhabi': 'yas_marina', barcelona: 'catalunya', spa: 'spa', montreal: 'villeneuve', melbourne: 'albert_park',
  singapore: 'marina_bay', 'mexico city': 'rodriguez', imola: 'imola', bahrain: 'bahrain', 'las vegas': 'vegas', jeddah: 'jeddah', miami: 'miami', nurburgring: 'nurburgring', hockenheim: 'hockenheimring', sepang: 'sepang', shanghai: 'shanghai', austria: 'red_bull_ring', hungary: 'hungaroring', budapest: 'hungaroring',
};

export class StatsDesk {
  private entities: Entity[] = [];
  private maxYear: number;
  private minYear: number;

  constructor(public h: History) {
    [this.minYear, this.maxYear] = h.span;
    const rowsByDriver = new Map<number, number>();
    const winsByDriver = new Map<number, number>();
    for (const r of h.results) {
      rowsByDriver.set(r[DRIVER], (rowsByDriver.get(r[DRIVER]) ?? 0) + 1);
      if (r[POS] === 1) winsByDriver.set(r[DRIVER], (winsByDriver.get(r[DRIVER]) ?? 0) + 1);
    }
    const weight = (i: number) => (winsByDriver.get(i) ?? 0) * 50 + (rowsByDriver.get(i) ?? 0);

    const add = (e: Entity) => e.key.length > 1 && this.entities.push(e);
    const family = new Map<string, number>();
    h.drivers.forEach((d, i) => {
      add({ type: 'driver', id: i, key: ascii(`${d[1]} ${d[2]}`), rank: 6 });
      const fam = ascii(d[2]);
      const cur = family.get(fam);
      if (cur === undefined || weight(i) > weight(cur)) family.set(fam, i);
    });
    for (const [key, i] of family) add({ type: 'driver', id: i, key, rank: 1 });

    h.constructors.forEach((c, i) => {
      add({ type: 'team', id: i, key: ascii(c[1]), rank: 5 });
      add({ type: 'team', id: i, key: ascii(c[0].replace(/_/g, ' ')), rank: 5 });
    });
    for (const [alias, id] of Object.entries(TEAM_ALIASES)) {
      const i = h.constructors.findIndex((c) => c[0] === id);
      if (i >= 0) add({ type: 'team', id: i, key: alias, rank: 5 });
    }

    const countries = new Set<string>();
    h.circuits.forEach((c, i) => {
      add({ type: 'circuit', id: i, key: ascii(c[0].replace(/_/g, ' ')), rank: 4 });
      add({ type: 'circuit', id: i, key: ascii(c[2]), rank: 4 });
      countries.add(c[3]);
    });
    for (const [alias, id] of Object.entries(CIRCUIT_ALIASES)) {
      const i = h.circuits.findIndex((c) => c[0] === id);
      if (i >= 0) add({ type: 'circuit', id: i, key: alias, rank: 4.5 });
    }
    for (const c of countries) add({ type: 'country', id: c, key: ascii(c), rank: 2 });
    for (const name of new Set(h.races.map((r) => r[2]))) {
      const stem = ascii(name.replace(/ Grand Prix$/i, ''));
      add({ type: 'gp', id: name, key: `${stem} grand prix`, rank: 7 });
      add({ type: 'gp', id: name, key: `${stem} gp`, rank: 7 });
    }
    this.entities.sort((a, b) => b.key.length - a.key.length || b.rank - a.rank);
  }

  private driverName = (i: number) => `${this.h.drivers[i][1]} ${this.h.drivers[i][2]}`;
  private teamName = (i: number) => this.h.constructors[i][1];

  ask(question: string): Answer {
    const t0 = performance.now();
    const answer = this.run(question);
    answer.ms = Math.max(0.1, performance.now() - t0);
    return answer;
  }

  private run(question: string): Answer {
    const h = this.h;
    let q = ` ${ascii(question)} `;
    const raw = question;
    if (q.trim().length < 3) return this.unknown();

    // ---- entities ---------------------------------------------------------------------
    const drivers: number[] = [];
    const teams: number[] = [];
    const circuits = new Set<number>();
    let gp: string | null = null;
    for (const code of raw.match(/\b[A-Z]{3}\b/g) ?? []) {
      // three-letter codes only count when typed in capitals; newest driver wins a clash
      let found = -1;
      h.drivers.forEach((d, i) => {
        if (d[3] === code) found = i;
      });
      if (found >= 0 && !drivers.includes(found)) {
        drivers.push(found);
        q = q.replace(` ${code.toLowerCase()} `, ' ');
      }
    }
    for (const e of this.entities) {
      const needle = ` ${e.key} `;
      if (!q.includes(needle)) continue;
      q = q.replace(needle, ' _ ');
      if (e.type === 'driver') !drivers.includes(e.id as number) && drivers.push(e.id as number);
      else if (e.type === 'team') !teams.includes(e.id as number) && teams.push(e.id as number);
      else if (e.type === 'circuit') circuits.add(e.id as number);
      else if (e.type === 'country') h.circuits.forEach((c, i) => c[3] === e.id && circuits.add(i));
      else gp = e.id as string;
    }

    // ---- years ------------------------------------------------------------------------
    let years: [number, number] | null = null;
    const found = [...q.matchAll(/\b(19[5-9]\d|20[0-3]\d)\b/g)].map((m) => Number(m[1]));
    const decade = /\b(19[5-9]0|20[0-2]0)s\b/.exec(q) ?? /\b([0-9]0)s\b/.exec(q);
    if (decade) {
      const d = Number(decade[1]);
      const start = d >= 1000 ? d : d >= 50 ? 1900 + d : 2000 + d;
      years = [start, start + 9];
    } else if (found.length >= 2) years = [Math.min(...found), Math.max(...found)];
    else if (found.length === 1) {
      if (/\b(since|from)\b/.test(q)) years = [found[0], this.maxYear];
      else if (/\bafter\b/.test(q)) years = [found[0] + 1, this.maxYear];
      else if (/\b(before|until|prior)\b/.test(q)) years = [this.minYear, found[0] - (/\buntil\b/.test(q) ? 0 : 1)];
      else years = [found[0], found[0]];
    } else if (/\b(this|current) (season|year)\b/.test(q)) years = [this.maxYear, this.maxYear];
    else if (/\blast (season|year)\b/.test(q)) years = [this.maxYear - 1, this.maxYear - 1];

    // ---- metric -----------------------------------------------------------------------
    let metric: Metric | null = null;
    if (/champion|title/.test(q)) metric = 'titles';
    else if (/\bpoles?\b/.test(q)) metric = 'poles';
    else if (/podium/.test(q)) metric = 'podiums';
    else if (/fastest lap/.test(q)) metric = 'fastest';
    else if (/\bdnfs?\b|retire|did not finish|didn t finish|failed to finish/.test(q)) metric = 'dnfs';
    else if (/points finish|in the points|scored points/.test(q)) metric = 'scores';
    else if (/\bpoints?\b/.test(q)) metric = 'points';
    else if (/front row/.test(q)) metric = 'frontrow';
    else if (/\bwins?\b|\bwon\b|victor|winner/.test(q)) metric = 'wins';
    else if (/\bstarts?\b|\braces\b|entr(y|ies)|appearances|grands prix/.test(q)) metric = 'starts';

    const byTeam = /\b(team|teams|constructor|constructors)\b/.test(q) || (teams.length > 0 && drivers.length === 0);
    const wantsRank = /\b(most|top|best|record|ranking|leaders?|all time|highest|who has|which driver|which team|which constructor)\b/.test(q);
    const compare = (drivers.length >= 2 || teams.length >= 2) && /\b(vs|versus|compare|compared|or|against|and)\b/.test(q);
    const place = circuits.size > 0 || gp != null;

    const inScope = (r: number[]) => {
      const race = h.races[r[RACE]];
      if (years && (race[0] < years[0] || race[0] > years[1])) return false;
      if (gp && race[2] !== gp) return false;
      if (circuits.size && !circuits.has(race[3])) return false;
      return true;
    };
    const scopeSql = () => {
      const parts: string[] = [];
      if (years) parts.push(years[0] === years[1] ? `season = ${years[0]}` : `season BETWEEN ${years[0]} AND ${years[1]}`);
      if (gp) parts.push(`race_name = '${gp}'`);
      if (circuits.size) parts.push(circuits.size === 1 ? `circuit = '${h.circuits[[...circuits][0]][1].replace(/'/g, "''")}'` : `country = '${h.circuits[[...circuits][0]][3]}'`);
      return parts;
    };
    const scopeText = () => {
      const bits: string[] = [];
      if (gp) bits.push(`in the ${gp}`);
      else if (circuits.size === 1) bits.push(`at ${h.circuits[[...circuits][0]][1]}`);
      else if (circuits.size > 1) bits.push(`in ${h.circuits[[...circuits][0]][3]}`);
      if (years) bits.push(years[0] === years[1] ? `in ${years[0]}` : `from ${years[0]} to ${years[1]}`);
      return bits.length ? ` ${bits.join(' ')}` : '';
    };
    const sql = (select: string, where: string[], tail = '') =>
      `SELECT ${select}\nFROM results\nJOIN races USING (race_id)${where.length ? `\nWHERE ${where.join('\n  AND ')}` : ''}${tail ? `\n${tail}` : ''};`;

    // ---- one specific race ------------------------------------------------------------
    if (place && years && years[0] === years[1] && !compare && drivers.length === 0 && teams.length === 0 && (metric === 'wins' || metric === null || /result|podium|classification/.test(q))) {
      const rows = h.results.filter(inScope);
      if (!rows.length) return { ok: false, headline: `No race matches${scopeText()}.`, note: 'Check the year: not every circuit hosted a race every season.' };
      const raceIds = [...new Set(rows.map((r) => r[RACE]))];
      const race = h.races[raceIds[0]];
      const one = rows.filter((r) => r[RACE] === raceIds[0]).sort((a, b) => a[10] - b[10]);
      const winner = one.find((r) => r[POS] === 1) ?? one[0];
      return {
        ok: true,
        headline: `${this.driverName(winner[DRIVER])} won the ${race[0]} ${race[2]}`,
        value: this.driverName(winner[DRIVER]),
        detail: `${this.teamName(winner[TEAM])}, from ${winner[GRID] ? `P${winner[GRID]}` : 'the pit lane'} on the grid. Round ${race[1]}, ${h.circuits[race[3]][1]}.${raceIds.length > 1 ? ` (${raceIds.length} races matched; showing the first.)` : ''}`,
        columns: ['Pos', 'Driver', 'Constructor', 'Grid', 'Status'],
        rows: one.slice(0, 10).map((r) => ({ cells: [r[POS] || '–', this.driverName(r[DRIVER]), this.teamName(r[TEAM]), r[GRID] || 'PL', h.statuses[r[STATUS]]] })),
        sql: sql('position, driver, constructor, grid, status', scopeSql(), 'ORDER BY position\nLIMIT 10'),
        scanned: h.results.length,
      };
    }

    // ---- championships ----------------------------------------------------------------
    if (metric === 'titles') {
      const table = byTeam ? h.champions.constructors : h.champions.drivers;
      const name = byTeam ? this.teamName : this.driverName;
      const scoped = table.filter((c) => !years || (c[0] >= years[0] && c[0] <= years[1]));
      const who = byTeam ? teams : drivers;
      const view = byTeam ? 'constructor_champions' : 'driver_champions';
      const yearSql = years ? [years[0] === years[1] ? `season = ${years[0]}` : `season BETWEEN ${years[0]} AND ${years[1]}`] : [];
      if (who.length === 1 && !wantsRank) {
        const mine = scoped.filter((c) => c[1] === who[0]);
        return {
          ok: true,
          headline: `${name(who[0])}: ${mine.length} world championship${mine.length === 1 ? '' : 's'}${years ? scopeText() : ''}`,
          value: String(mine.length),
          detail: mine.length ? `Seasons: ${mine.map((c) => c[0]).join(', ')}.` : 'No titles in the data for this scope.',
          columns: ['Season', 'Points', 'Wins'],
          rows: mine.map((c) => ({ cells: [c[0], c[2], c[3]] })),
          sql: `SELECT season, points, wins\nFROM ${view}\nWHERE ${[`${byTeam ? 'constructor' : 'driver'} = '${name(who[0]).replace(/'/g, "''")}'`, ...yearSql].join('\n  AND ')}\nORDER BY season;`,
          scanned: table.length,
        };
      }
      if (years && years[0] === years[1]) {
        const c = scoped[0];
        if (!c) return { ok: false, headline: h.openSeason === years[0] ? `The ${years[0]} title is not decided yet.` : `No champion on record for ${years[0]}.` };
        return {
          ok: true,
          headline: `${name(c[1])} was ${years[0]} world champion`,
          value: name(c[1]),
          detail: `${c[2]} points and ${c[3]} win${c[3] === 1 ? '' : 's'}.`,
          sql: `SELECT ${byTeam ? 'constructor' : 'driver'}, points, wins\nFROM ${view}\nWHERE season = ${years[0]};`,
          scanned: table.length,
        };
      }
      const tally = new Map<number, number[]>();
      for (const c of scoped) (tally.get(c[1]) ?? tally.set(c[1], []).get(c[1])!).push(c[0]);
      const ranked = [...tally.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
      if (!ranked.length) return this.unknown();
      return {
        ok: true,
        headline: `${name(ranked[0][0])} has the most ${byTeam ? "constructors'" : "drivers'"} titles${years ? scopeText() : ''}: ${ranked[0][1].length}`,
        value: String(ranked[0][1].length),
        columns: [byTeam ? 'Constructor' : 'Driver', 'Titles', 'Seasons'],
        rows: ranked.map(([i, ys]) => ({ cells: [name(i), ys.length, ys.join(', ')], bar: ys.length / ranked[0][1].length })),
        sql: `SELECT ${byTeam ? 'constructor' : 'driver'}, COUNT(*) AS titles\nFROM ${view}${yearSql.length ? `\nWHERE ${yearSql[0]}` : ''}\nGROUP BY 1\nORDER BY titles DESC\nLIMIT 10;`,
        scanned: table.length,
      };
    }

    if (!metric) {
      if (drivers.length || teams.length) metric = 'wins';
      else return this.unknown();
    }
    const m = METRICS[metric];
    const tallyOf = (rows: number[][], col: number) => {
      const out = new Map<number, number>();
      const seen = new Set<string>();
      for (const r of rows) {
        if (!m.test(r)) continue;
        if (metric === 'starts' && col === TEAM) {
          const k = `${r[TEAM]}:${r[RACE]}`;
          if (seen.has(k)) continue;
          seen.add(k);
        }
        out.set(r[col], (out.get(r[col]) ?? 0) + (m.sum ? r[POINTS] : 1));
      }
      return out;
    };
    const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    const agg = m.sum ? 'SUM(points)' : metric === 'starts' && byTeam ? 'COUNT(DISTINCT race_id)' : 'COUNT(*)';
    const scoped = h.results.filter(inScope);

    // ---- head to head -----------------------------------------------------------------
    if (compare) {
      const ids = (drivers.length >= 2 ? drivers : teams).slice(0, 4);
      const col = drivers.length >= 2 ? DRIVER : TEAM;
      const name = col === DRIVER ? this.driverName : this.teamName;
      const list: Metric[] = ['starts', 'wins', 'podiums', 'poles', 'fastest', 'points'];
      const rows = list.map((key) => {
        const mm = METRICS[key];
        const vals = ids.map((id) => {
          let v = 0;
          const seen = new Set<number>();
          for (const r of scoped) {
            if (r[col] !== id || !mm.test(r)) continue;
            if (key === 'starts' && col === TEAM) {
              if (seen.has(r[RACE])) continue;
              seen.add(r[RACE]);
            }
            v += mm.sum ? r[POINTS] : 1;
          }
          return v;
        });
        return { cells: [mm.label, ...vals.map(fmt)] };
      });
      const champs = col === DRIVER ? h.champions.drivers : h.champions.constructors;
      rows.push({ cells: ['World championships', ...ids.map((id) => String(champs.filter((c) => c[1] === id && (!years || (c[0] >= years[0] && c[0] <= years[1]))).length))] });
      return {
        ok: true,
        headline: `${ids.map(name).join(' against ')}${scopeText()}`,
        columns: ['', ...ids.map(name)],
        rows,
        sql: sql(
          `${col === DRIVER ? 'driver' : 'constructor'},\n       COUNT(*) AS entries,\n       COUNT(*) FILTER (WHERE position = 1) AS wins,\n       COUNT(*) FILTER (WHERE position <= 3) AS podiums,\n       COUNT(*) FILTER (WHERE grid = 1) AS poles,\n       SUM(points) AS points`,
          [`${col === DRIVER ? 'driver' : 'constructor'} IN (${ids.map((i) => `'${name(i).replace(/'/g, "''")}'`).join(', ')})`, ...scopeSql()],
          'GROUP BY 1',
        ),
        scanned: h.results.length,
      };
    }

    // ---- one driver or team: a count ----------------------------------------------------
    const subject = drivers.length ? { col: DRIVER, id: drivers[0], name: this.driverName(drivers[0]), field: 'driver' } : teams.length ? { col: TEAM, id: teams[0], name: this.teamName(teams[0]), field: 'constructor' } : null;
    if (subject) {
      const mine = scoped.filter((r) => r[subject.col] === subject.id && (teams.length && drivers.length ? r[TEAM] === teams[0] : true));
      const hits = mine.filter(m.test);
      let total = 0;
      const perYear = new Map<number, number>();
      const seenRace = new Set<number>();
      for (const r of hits) {
        if (metric === 'starts' && subject.col === TEAM) {
          if (seenRace.has(r[RACE])) continue;
          seenRace.add(r[RACE]);
        }
        const v = m.sum ? r[POINTS] : 1;
        total += v;
        const y = h.races[r[RACE]][0];
        perYear.set(y, (perYear.get(y) ?? 0) + v);
      }
      const seasons = [...perYear.entries()].filter(([, v]) => v > 0).sort((a, b) => b[0] - a[0]);
      const peak = Math.max(1, ...seasons.map(([, v]) => v));
      const withTeam = teams.length && drivers.length ? ` with ${this.teamName(teams[0])}` : '';
      const where = [`${subject.field} = '${subject.name.replace(/'/g, "''")}'`, ...(withTeam ? [`constructor = '${this.teamName(teams[0]).replace(/'/g, "''")}'`] : []), ...(m.where ? [m.where] : []), ...scopeSql()];
      return {
        ok: true,
        headline: `${subject.name}: ${fmt(total)} ${total === 1 ? m.unit.replace(/s$/, '') : m.unit}${withTeam}${scopeText()}`,
        value: fmt(total),
        detail: mine.length ? `From ${new Set(mine.map((r) => r[RACE])).size} race entries in scope.${metric === 'fastest' ? ' Fastest laps are only recorded from 2004.' : ''}` : 'No race entries match this scope.',
        columns: seasons.length > 1 ? ['Season', m.label] : undefined,
        rows: seasons.length > 1 ? seasons.slice(0, 14).map(([y, v]) => ({ cells: [y, fmt(v)], bar: v / peak })) : undefined,
        sql: sql(`${agg} AS ${metric}`, where),
        scanned: h.results.length,
      };
    }

    // ---- leaderboard ------------------------------------------------------------------
    if (wantsRank || years || place) {
      const col = byTeam ? TEAM : DRIVER;
      const name = byTeam ? this.teamName : this.driverName;
      const ranked = [...tallyOf(scoped, col).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (!ranked.length) return { ok: false, headline: `Nothing matches${scopeText()}.` };
      const tie = ranked.filter((r) => r[1] === ranked[0][1]).length;
      return {
        ok: true,
        headline: `${tie > 1 ? `${tie} tied on` : `${name(ranked[0][0])} leads with`} ${fmt(ranked[0][1])} ${m.unit}${scopeText()}`,
        value: fmt(ranked[0][1]),
        detail: metric === 'fastest' ? 'Fastest laps are only recorded from 2004.' : undefined,
        columns: ['#', byTeam ? 'Constructor' : 'Driver', m.label],
        rows: ranked.map(([i, v], k) => ({ cells: [k + 1, name(i), fmt(v)], bar: v / ranked[0][1] })),
        sql: sql(`${byTeam ? 'constructor' : 'driver'}, ${agg} AS ${metric}`, [...(m.where ? [m.where] : []), ...scopeSql()], `GROUP BY 1\nORDER BY ${metric} DESC\nLIMIT 10`),
        scanned: h.results.length,
      };
    }
    return this.unknown();
  }

  private unknown(): Answer {
    return {
      ok: false,
      headline: 'That one is outside what the results table can answer.',
      note: 'The desk understands wins, podiums, poles, retirements, points, fastest laps, race entries and championships, filtered by driver, constructor, circuit, Grand Prix and season.',
    };
  }
}
