// Race predictor: gradient-boosted regression trees that call the finishing order of a
// race from what is known when the grid forms up. Evaluated walk-forward: for every race
// of the target season the model is trained only on races that happened before it.
//
//   node pipeline/predict.mjs            latest season in history.json
//   node pipeline/predict.mjs --year 2025

import { readFile, readdir, writeFile } from 'node:fs/promises';

const DATA = new URL('../public/data/', import.meta.url);
const args = process.argv.slice(2);
const history = JSON.parse(await readFile(new URL('history.json', DATA), 'utf8'));
const YEAR = args.includes('--year') ? Number(args[args.indexOf('--year') + 1]) : history.span[1];
const WINDOW = 5; // seasons of history the model sees

const FEATURES = [
  { key: 'grid', label: 'Grid position' },
  { key: 'driverForm', label: 'Driver form (last 5 races)' },
  { key: 'teamForm', label: 'Team form (last 4 races)' },
  { key: 'circuit', label: 'Driver record at this circuit' },
  { key: 'teammate', label: 'Grid gap to team-mate' },
  { key: 'reliability', label: 'Recent retirement rate' },
];

// ---- feature table -----------------------------------------------------------------------

const races = history.races.map((r, i) => ({ i, year: r[0], round: r[1], name: r[2], circuit: r[3], date: r[4], rows: [] }));
for (const r of history.results) races[r[0]].rows.push({ driver: r[1], team: r[2], grid: r[3], pos: r[4], laps: r[6], outcome: r[7], order: r[10] });
const span = races.filter((r) => r.year >= YEAR - WINDOW && r.year <= YEAR).sort((a, b) => a.year - b.year || a.round - b.round);

const driverPast = new Map(); // driver -> finishing ranks, oldest first
const driverOut = new Map(); // driver -> 1 when retired
const teamPast = new Map();
const circuitPast = new Map(); // `${driver}:${circuit}` -> ranks
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const push = (map, key, v) => (map.get(key) ?? map.set(key, []).get(key)).push(v);

for (const race of span) {
  const n = race.rows.length;
  // finishing rank for everyone: classified order, then the rest by laps completed
  const ranked = [...race.rows].sort((a, b) => (a.pos || 99) - (b.pos || 99) || b.laps - a.laps || a.order - b.order);
  ranked.forEach((row, i) => (row.rank = i + 1));
  const back = n; // a pit-lane start counts as last on the grid

  for (const row of race.rows) {
    const grid = row.grid || back;
    const mate = race.rows.find((o) => o.team === row.team && o !== row);
    const df = driverPast.get(row.driver)?.slice(-5);
    const tf = teamPast.get(row.team)?.slice(-8);
    const cf = circuitPast.get(`${row.driver}:${race.circuit}`)?.slice(-3);
    const out = driverOut.get(row.driver)?.slice(-10);
    const teamForm = tf?.length ? mean(tf) : n * 0.6;
    row.x = [
      grid,
      df?.length ? mean(df) : teamForm,
      teamForm,
      cf?.length ? mean(cf) : df?.length ? mean(df) : teamForm,
      mate ? grid - (mate.grid || back) : 0,
      out?.length ? mean(out) : 0.15,
    ];
    row.y = row.rank;
  }
  for (const row of race.rows) {
    push(driverPast, row.driver, row.rank);
    push(driverOut, row.driver, row.outcome === 1 ? 1 : 0);
    push(teamPast, row.team, row.rank);
    push(circuitPast, `${row.driver}:${race.circuit}`, row.rank);
  }
}

// ---- gradient boosting ---------------------------------------------------------------------

function fitTree(X, residual, rows, depth, minLeaf, gain) {
  const sum = rows.reduce((s, i) => s + residual[i], 0);
  const value = sum / rows.length;
  if (depth === 0 || rows.length < minLeaf * 2) return { value };

  let best = null;
  for (let f = 0; f < X[0].length; f++) {
    const sorted = [...rows].sort((a, b) => X[a][f] - X[b][f]);
    let leftSum = 0;
    for (let k = 0; k < sorted.length - 1; k++) {
      leftSum += residual[sorted[k]];
      const nl = k + 1;
      const nr = sorted.length - nl;
      if (nl < minLeaf || nr < minLeaf || X[sorted[k]][f] === X[sorted[k + 1]][f]) continue;
      const score = leftSum ** 2 / nl + (sum - leftSum) ** 2 / nr - sum ** 2 / sorted.length;
      if (!best || score > best.score) best = { score, f, threshold: (X[sorted[k]][f] + X[sorted[k + 1]][f]) / 2 };
    }
  }
  if (!best || best.score <= 1e-9) return { value };
  gain[best.f] += best.score;
  const left = rows.filter((i) => X[i][best.f] <= best.threshold);
  const right = rows.filter((i) => X[i][best.f] > best.threshold);
  return { f: best.f, threshold: best.threshold, left: fitTree(X, residual, left, depth - 1, minLeaf, gain), right: fitTree(X, residual, right, depth - 1, minLeaf, gain) };
}

const walk = (node, x) => (node.value !== undefined && node.f === undefined ? node.value : walk(x[node.f] <= node.threshold ? node.left : node.right, x));

function train(X, y, { trees = 140, rate = 0.07, depth = 3, minLeaf = 14 } = {}) {
  const base = mean(y);
  const pred = y.map(() => base);
  const gain = X[0].map(() => 0);
  const forest = [];
  const all = y.map((_, i) => i);
  for (let t = 0; t < trees; t++) {
    const residual = y.map((v, i) => v - pred[i]);
    const tree = fitTree(X, residual, all, depth, minLeaf, gain);
    forest.push(tree);
    for (let i = 0; i < y.length; i++) pred[i] += rate * walk(tree, X[i]);
  }
  return { predict: (x) => base + rate * forest.reduce((s, tree) => s + walk(tree, x), 0), gain, trees };
}

// ---- scoring -------------------------------------------------------------------------------

function spearman(a, b) {
  const n = a.length;
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (a[i] - b[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function score(order, rows) {
  // order: rows sorted by predicted finish
  const predRank = new Map(order.map((r, i) => [r, i + 1]));
  const a = rows.map((r) => predRank.get(r));
  const b = rows.map((r) => r.rank);
  const top = (k) => new Set(rows.filter((r) => r.rank <= k));
  const hit = (k) => order.slice(0, k).filter((r) => top(k).has(r)).length;
  return {
    spearman: +spearman(a, b).toFixed(3),
    mae: +mean(a.map((v, i) => Math.abs(v - b[i]))).toFixed(2),
    winner: order[0].rank === 1 ? 1 : 0,
    podium: hit(3),
    top10: hit(10),
  };
}

// ---- colours and session links from the telemetry lake --------------------------------------

const sessions = new Map();
for (const dir of await readdir(new URL('sessions/', DATA)).catch(() => [])) {
  try {
    const meta = JSON.parse(await readFile(new URL(`sessions/${dir}/meta.json`, DATA), 'utf8'));
    sessions.set(meta.date.slice(0, 10), meta);
  } catch {
    // not a session folder
  }
}

// ---- walk forward ------------------------------------------------------------------------

const target = span.filter((r) => r.year === YEAR);
const out = [];
let lastModel = null;
for (const race of target) {
  const before = span.filter((r) => r.year < race.year || (r.year === race.year && r.round < race.round));
  const X = before.flatMap((r) => r.rows.map((row) => row.x));
  const y = before.flatMap((r) => r.rows.map((row) => row.y));
  const model = train(X, y);
  lastModel = { model, rows: X.length, races: before.length };

  for (const row of race.rows) row.score = model.predict(row.x);
  const byModel = [...race.rows].sort((a, b) => a.score - b.score);
  const byGrid = [...race.rows].sort((a, b) => (a.grid || 99) - (b.grid || 99));
  const meta = sessions.get(race.date);
  const colours = new Map((meta?.drivers ?? []).map((d) => [d.code, d.colour]));

  out.push({
    round: race.round,
    name: race.name,
    date: race.date,
    key: meta?.key ?? null,
    trainedOn: X.length,
    model: score(byModel, race.rows),
    grid: score(byGrid, race.rows),
    rows: byModel.map((row, i) => {
      const d = history.drivers[row.driver];
      return {
        code: d[3] || d[2].slice(0, 3).toUpperCase(),
        name: `${d[1]} ${d[2]}`,
        team: history.constructors[row.team][1],
        colour: colours.get(d[3]) ?? '#8A8D95',
        grid: row.grid,
        predicted: i + 1,
        score: +row.score.toFixed(2),
        actual: row.rank,
        classified: row.pos > 0,
      };
    }),
  });
  console.log(`R${String(race.round).padStart(2, '0')} ${race.name.padEnd(28)} rho ${out.at(-1).model.spearman.toFixed(2)} (grid ${out.at(-1).grid.spearman.toFixed(2)})  podium ${out.at(-1).model.podium}/3`);
}

const agg = (key) => {
  const s = { spearman: 0, mae: 0, winner: 0, podium: 0, top10: 0 };
  for (const r of out) for (const k of Object.keys(s)) s[k] += r[key][k];
  return { spearman: +(s.spearman / out.length).toFixed(3), mae: +(s.mae / out.length).toFixed(2), winner: s.winner, podium: s.podium, top10: s.top10 };
};
const totalGain = lastModel.model.gain.reduce((s, v) => s + v, 0) || 1;

await writeFile(
  new URL('predictor.json', DATA),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    year: YEAR,
    window: [YEAR - WINDOW, YEAR],
    params: { trees: 140, rate: 0.07, depth: 3, minLeaf: 14, loss: 'squared error on finishing rank' },
    lastTraining: { rows: lastModel.rows, races: lastModel.races },
    importance: FEATURES.map((f, i) => ({ ...f, share: +(lastModel.model.gain[i] / totalGain).toFixed(4) })).sort((a, b) => b.share - a.share),
    summary: { races: out.length, model: agg('model'), grid: agg('grid') },
    races: out,
  }),
);
console.log(`\n${out.length} races · model rho ${agg('model').spearman} vs grid ${agg('grid').spearman}`);
