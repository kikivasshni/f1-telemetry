// Turns one race session from OpenF1 into the static files the app plays back:
//
//   meta.json      session, drivers, track model, laps, stints, pit stops, race control,
//                  weather, classification, lap chart, track status periods
//   timing.json    position changes and gap/interval series per driver
//   report.json    the written race report and its key facts
//   pos.bin.gz     every car's x/y on a fixed 4 Hz grid (delta-encoded int16)
//   tel/<n>.bin.gz one driver's speed, rpm, gear, throttle, brake and DRS at native rate

import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { getJson, pool } from './lib/http.mjs';
import { dedupe, nearestIndex, resampleClosed, smoothCircular, thumbnail } from './lib/geo.mjs';
import { buildReport } from './lib/report.mjs';

const API = 'https://api.openf1.org/v1';
const DT = 0.25; // seconds between position samples
const TRACK_SPACING = 4; // metres between centreline points

const toMs = (iso) => Date.parse(iso);
const stamp = (ms) => new Date(ms).toISOString().slice(0, 19);
const round = (v, dp = 1) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const titleCase = (s) => (s ?? '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

function parseGap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return round(v, 3);
  const laps = /(\d+)\s*L/i.exec(String(v));
  return laps ? -Number(laps[1]) : null;
}

/** Value of a step series [[t, v], ...] at time t. */
function stepAt(series, t) {
  let v = series.length ? series[0][1] : null;
  for (const [st, sv] of series) {
    if (st > t) break;
    v = sv;
  }
  return v;
}

export async function ingestSession({ session, meeting, round: roundNo, outDir, log = console.log }) {
  const key = session.session_key;
  const q = (endpoint, extra = '') => `${API}/${endpoint}?session_key=${key}${extra}`;

  // ---- small endpoints -------------------------------------------------------------
  const driversRaw = await getJson(q('drivers'));
  const lapsRaw = await getJson(q('laps'));
  const positionRaw = await getJson(q('position'));
  const intervalsRaw = await getJson(q('intervals'));
  const stintsRaw = await getJson(q('stints'));
  const pitRaw = await getJson(q('pit'));
  const raceControlRaw = await getJson(q('race_control'));
  const weatherRaw = await getJson(q('weather'));
  const overtakesRaw = await getJson(q('overtakes'));
  const resultRaw = await getJson(q('session_result'));

  if (!driversRaw.length || !lapsRaw.length) throw new Error(`session ${key} has no driver or lap data`);

  // ---- time window -----------------------------------------------------------------
  const lapOneStarts = lapsRaw.filter((l) => l.lap_number === 1 && l.date_start).map((l) => toMs(l.date_start));
  const lapTwoStarts = lapsRaw.filter((l) => l.lap_number === 2 && l.date_start).map((l) => toMs(l.date_start));
  const raceStartMs = lapOneStarts.length
    ? Math.min(...lapOneStarts)
    : lapTwoStarts.length
      ? Math.min(...lapTwoStarts) - 100000
      : toMs(session.date_start);
  const lapEnds = lapsRaw
    .filter((l) => l.date_start && l.lap_duration)
    .map((l) => toMs(l.date_start) + l.lap_duration * 1000);
  const w0 = raceStartMs - 60000;
  const w1 = Math.min(Math.max(...lapEnds) + 45000, toMs(session.date_end) + 3 * 3600000);
  const duration = (w1 - w0) / 1000;
  const sec = (iso) => round((toMs(iso) - w0) / 1000, 2);
  const windowFilter = `&date>${stamp(w0 - 1000)}&date<${stamp(w1 + 1000)}`;

  // ---- drivers ---------------------------------------------------------------------
  const seen = new Set();
  const resultByNum = new Map(resultRaw.map((r) => [r.driver_number, r]));
  const drivers = driversRaw
    .filter((d) => !seen.has(d.driver_number) && seen.add(d.driver_number))
    .map((d) => ({
      n: d.driver_number,
      code: d.name_acronym,
      first: d.first_name ?? titleCase(d.full_name?.split(' ')[0]),
      last: d.last_name ?? titleCase(d.full_name?.split(' ').slice(1).join(' ')),
      team: d.team_name,
      colour: `#${(d.team_colour ?? '888888').toUpperCase()}`,
    }))
    .sort((a, b) => (resultByNum.get(a.n)?.position ?? 99) - (resultByNum.get(b.n)?.position ?? 99));
  const nums = drivers.map((d) => d.n);

  // ---- heavy endpoints: one driver at a time, two in flight ------------------------
  log(`  location + car data for ${nums.length} drivers`);
  const heavy = await pool(nums, 2, async (n) => {
    const loc = await getJson(q('location', `&driver_number=${n}${windowFilter}`));
    const car = await getJson(q('car_data', `&driver_number=${n}${windowFilter}`));
    return { n, loc, car };
  });

  const locations = new Map();
  const telemetry = new Map();
  for (const { n, loc, car } of heavy) {
    locations.set(
      n,
      loc
        .filter((r) => !(r.x === 0 && r.y === 0 && r.z === 0))
        .map((r) => [(toMs(r.date) - w0) / 1000, r.x / 10, r.y / 10, r.z / 10])
        .sort((a, b) => a[0] - b[0]),
    );
    telemetry.set(
      n,
      car
        .map((r) => ({
          t: toMs(r.date) - w0,
          speed: r.speed ?? 0,
          rpm: r.rpm ?? 0,
          gear: r.n_gear ?? 0,
          throttle: r.throttle > 100 ? 0 : (r.throttle ?? 0),
          brake: r.brake > 100 ? 0 : (r.brake ?? 0),
          drs: r.drs ?? 0,
        }))
        .filter((r) => r.t >= 0)
        .sort((a, b) => a.t - b.t),
    );
  }

  // ---- laps ------------------------------------------------------------------------
  const laps = {};
  for (const n of nums) {
    const rows = lapsRaw.filter((l) => l.driver_number === n).sort((a, b) => a.lap_number - b.lap_number);
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const l = rows[i];
      let start = l.date_start ? (toMs(l.date_start) - w0) / 1000 : null;
      if (start == null) {
        const prev = out[out.length - 1];
        start = prev && prev.d != null ? prev.t + prev.d : l.lap_number === 1 ? (raceStartMs - w0) / 1000 : null;
      }
      let dur = l.lap_duration;
      const next = rows[i + 1];
      if (dur == null && start != null && next?.date_start) dur = (toMs(next.date_start) - w0) / 1000 - start;
      out.push({
        lap: l.lap_number,
        t: round(start, 2),
        d: round(dur, 3),
        s: [round(l.duration_sector_1, 3), round(l.duration_sector_2, 3), round(l.duration_sector_3, 3)],
        out: l.is_pit_out_lap ? 1 : 0,
        st: l.st_speed ?? null,
      });
    }
    laps[n] = out;
  }
  const totalLaps = Math.max(...resultRaw.map((r) => r.number_of_laps ?? 0), ...lapsRaw.map((l) => l.lap_number));

  // ---- fastest clean lap: reference for the track model -----------------------------
  const pitLaps = new Set(pitRaw.map((p) => `${p.driver_number}:${p.lap_number}`));
  let ref = null;
  for (const n of nums) {
    for (const l of laps[n]) {
      if (l.d == null || l.t == null || l.out || l.lap === 1 || pitLaps.has(`${n}:${l.lap}`)) continue;
      if (!ref || l.d < ref.d) ref = { n, ...l };
    }
  }
  if (!ref) throw new Error(`session ${key} has no usable reference lap`);
  const refTrace = locations.get(ref.n).filter((p) => p[0] >= ref.t && p[0] <= ref.t + ref.d);

  // ---- track centreline ------------------------------------------------------------
  let circuit = null;
  if (meeting.circuit_info_url) {
    try {
      const info = await getJson(meeting.circuit_info_url, { gapMs: 1200, retries: 2 });
      if (Array.isArray(info?.x) && info.x.length > 50) circuit = info;
    } catch {
      log('  circuit info unavailable, deriving the outline from the fastest lap');
    }
  }
  const outline = circuit ? circuit.x.map((x, i) => [x / 10, circuit.y[i] / 10]) : refTrace.map((p) => [p[1], p[2]]);
  let { points: centre, length: trackLength, step } = resampleClosed(dedupe(outline, 1), TRACK_SPACING);

  // make the centreline run in driving direction, starting at the start/finish line
  const at = (frac) => refTrace[Math.min(refTrace.length - 1, Math.floor(refTrace.length * frac))];
  const ia = nearestIndex(centre, at(0.25)[1], at(0.25)[2]).index;
  const ib = nearestIndex(centre, at(0.35)[1], at(0.35)[2]).index;
  if ((ib - ia + centre.length) % centre.length > centre.length / 2) centre.reverse();
  const i0 = nearestIndex(centre, refTrace[0][1], refTrace[0][2]).index;
  centre = [...centre.slice(i0), ...centre.slice(0, i0)];

  // elevation: nearest measured z for every centreline point
  const CELL = 25;
  const buckets = new Map();
  for (const p of locations.get(ref.n)) {
    const k = `${Math.floor(p[1] / CELL)}:${Math.floor(p[2] / CELL)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  let lastZ = refTrace[0][3];
  const rawZ = centre.map(([x, y]) => {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    let best = null;
    let bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const p of buckets.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const d = (p[1] - x) ** 2 + (p[2] - y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      }
    }
    if (best) lastZ = best[3];
    return lastZ;
  });
  const smoothZ = smoothCircular(rawZ, 8);
  const minZ = Math.min(...smoothZ);

  const distOf = (x, y) => nearestIndex(centre, x, y).index * step;
  const sampleAt = (trace, t) => {
    let best = trace[0];
    for (const p of trace) {
      if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    }
    return best;
  };
  const sectors = [];
  if (ref.s[0] && ref.s[1]) {
    const a = sampleAt(refTrace, ref.t + ref.s[0]);
    const b = sampleAt(refTrace, ref.t + ref.s[0] + ref.s[1]);
    sectors.push(round(distOf(a[1], a[2]), 0), round(distOf(b[1], b[2]), 0));
  }
  const corners = (circuit?.corners ?? []).map((c) => {
    const x = c.trackPosition.x / 10;
    const y = c.trackPosition.y / 10;
    return { n: c.number, label: `${c.number}${c.letter ?? ''}`, d: round(distOf(x, y), 0), x: round(x), y: round(y), a: round(c.angle, 0) };
  });

  const track = {
    length: round(trackLength, 1),
    step: round(step, 4),
    x: centre.map((p) => round(p[0])),
    y: centre.map((p) => round(p[1])),
    z: smoothZ.map((z) => round(z - minZ)),
    corners,
    sectors,
    rotation: circuit?.rotation ?? 0,
    refLap: { n: ref.n, lap: ref.lap, d: ref.d },
  };

  // ---- positions on a fixed grid ---------------------------------------------------
  const samples = Math.ceil(duration / DT) + 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const trace of locations.values()) {
    for (const p of trace) {
      if (p[1] < minX) minX = p[1];
      if (p[1] > maxX) maxX = p[1];
      if (p[2] < minY) minY = p[2];
      if (p[2] > maxY) maxY = p[2];
    }
  }
  const cx = round((minX + maxX) / 2, 1);
  const cy = round((minY + maxY) / 2, 1);
  const reach = Math.max(maxX - cx, cx - minX, maxY - cy, cy - minY);
  const quantum = Math.max(0.1, Math.ceil((reach / 32000) * 20) / 20);

  const posBuf = new Int16Array(samples * 2 * nums.length);
  nums.forEach((n, di) => {
    const trace = locations.get(n);
    const xs = new Int16Array(samples);
    const ys = new Int16Array(samples);
    let j = 0;
    for (let i = 0; i < samples; i++) {
      const t = i * DT;
      while (j < trace.length - 1 && trace[j + 1][0] <= t) j++;
      let x = cx;
      let y = cy;
      if (trace.length) {
        const a = trace[j];
        const b = trace[j + 1];
        if (b && a[0] <= t && b[0] - a[0] <= 3) {
          const f = (t - a[0]) / (b[0] - a[0] || 1);
          x = a[1] + (b[1] - a[1]) * f;
          y = a[2] + (b[2] - a[2]) * f;
        } else {
          x = a[1];
          y = a[2];
        }
      }
      xs[i] = Math.round((x - cx) / quantum);
      ys[i] = Math.round((y - cy) / quantum);
    }
    const base = di * samples * 2;
    for (let i = 0; i < samples; i++) {
      posBuf[base + i] = i ? xs[i] - xs[i - 1] : xs[0];
      posBuf[base + samples + i] = i ? ys[i] - ys[i - 1] : ys[0];
    }
  });

  // ---- telemetry files -------------------------------------------------------------
  await mkdir(new URL('tel/', outDir), { recursive: true });
  let hasDrs = false;
  const lastMove = {};
  let telBytes = 0;
  for (const n of nums) {
    const rows = telemetry.get(n);
    const count = rows.length;
    const buf = new ArrayBuffer(4 + count * 12);
    new Uint32Array(buf, 0, 1)[0] = count;
    const dt = new Uint32Array(buf, 4, count);
    const speed = new Uint16Array(buf, 4 + count * 4, count);
    const rpm = new Uint16Array(buf, 4 + count * 6, count);
    const bytes = new Uint8Array(buf, 4 + count * 8, count * 4);
    let prev = 0;
    lastMove[n] = 0;
    for (let i = 0; i < count; i++) {
      const r = rows[i];
      dt[i] = r.t - prev;
      prev = r.t;
      speed[i] = r.speed;
      rpm[i] = r.rpm;
      bytes[i] = r.gear;
      bytes[count + i] = r.throttle;
      bytes[count * 2 + i] = r.brake;
      bytes[count * 3 + i] = r.drs;
      if (r.drs >= 8) hasDrs = true;
      if (r.speed > 20) lastMove[n] = r.t / 1000;
    }
    const gz = gzipSync(Buffer.from(buf), { level: 9 });
    telBytes += gz.length;
    await writeFile(new URL(`tel/${n}.bin.gz`, outDir), gz);
  }

  // ---- timing ----------------------------------------------------------------------
  const positions = {};
  const gaps = {};
  for (const n of nums) {
    const rows = positionRaw.filter((p) => p.driver_number === n).sort((a, b) => toMs(a.date) - toMs(b.date));
    const series = [];
    for (const p of rows) {
      const t = Math.max(0, sec(p.date));
      if (series.length && series[series.length - 1][0] === t) series[series.length - 1][1] = p.position;
      else if (!series.length || series[series.length - 1][1] !== p.position) series.push([t, p.position]);
    }
    positions[n] = series;

    const g = { t: [], gap: [], int: [] };
    for (const r of intervalsRaw.filter((r) => r.driver_number === n).sort((a, b) => toMs(a.date) - toMs(b.date))) {
      const t = sec(r.date);
      if (t < 0) continue;
      g.t.push(round(t, 1));
      g.gap.push(parseGap(r.gap_to_leader));
      g.int.push(parseGap(r.interval));
    }
    gaps[n] = g;
  }

  const grid = {};
  for (const n of nums) grid[n] = positions[n][0]?.[1] ?? null;

  const lapChart = {};
  for (const n of nums) {
    lapChart[n] = [grid[n]];
    for (const l of laps[n]) {
      if (l.t == null || l.d == null) continue;
      lapChart[n][l.lap] = stepAt(positions[n], l.t + l.d + 0.5);
    }
    for (let i = 1; i < lapChart[n].length; i++) if (lapChart[n][i] == null) lapChart[n][i] = lapChart[n][i - 1];
  }

  // ---- race control, track status --------------------------------------------------
  const raceControl = raceControlRaw
    .map((m) => ({
      t: sec(m.date),
      lap: m.lap_number ?? null,
      cat: m.category ?? 'Other',
      flag: m.flag ?? null,
      scope: m.scope ?? null,
      n: m.driver_number ?? null,
      msg: m.message ?? '',
    }))
    .filter((m) => m.t >= -600 && m.t <= duration && m.flag !== 'BLUE')
    .sort((a, b) => a.t - b.t);

  const status = [];
  let open = null;
  let scheduledClose = null;
  const close = (t) => {
    if (open) status.push({ type: open.type, t0: Math.max(0, open.t), t1: Math.min(duration, t) });
    open = null;
    scheduledClose = null;
  };
  for (const m of raceControl) {
    if (scheduledClose != null && m.t >= scheduledClose) close(scheduledClose);
    const text = m.msg.toUpperCase();
    if (text.includes('VIRTUAL SAFETY CAR DEPLOYED')) {
      close(m.t);
      open = { type: 'VSC', t: m.t };
    } else if (text.includes('VIRTUAL SAFETY CAR ENDING')) {
      if (open?.type === 'VSC') scheduledClose = m.t + 12;
    } else if (text.includes('SAFETY CAR DEPLOYED')) {
      close(m.t);
      open = { type: 'SC', t: m.t };
    } else if (text.includes('SAFETY CAR IN THIS LAP')) {
      if (open?.type === 'SC') scheduledClose = m.t + 75;
    } else if (m.flag === 'RED') {
      close(m.t);
      open = { type: 'RED', t: m.t };
    } else if (m.flag === 'GREEN' && open?.type === 'RED') {
      close(m.t);
    } else if (m.flag === 'CHEQUERED') {
      close(m.t);
    }
  }
  if (open) close(scheduledClose ?? duration);
  const trackStatus = status.filter((s) => s.t1 > s.t0);

  // ---- remaining tables ------------------------------------------------------------
  const stints = stintsRaw
    .filter((s) => s.lap_start != null)
    .map((s) => ({ n: s.driver_number, a: s.lap_start, b: s.lap_end ?? s.lap_start, c: s.compound ?? 'UNKNOWN', age: s.tyre_age_at_start ?? 0 }))
    .sort((a, b) => a.n - b.n || a.a - b.a);
  const pits = pitRaw
    .map((p) => ({ n: p.driver_number, t: sec(p.date), lap: p.lap_number, lane: round(p.lane_duration ?? p.pit_duration, 1), stop: round(p.stop_duration, 1) }))
    .filter((p) => p.t >= 0)
    .sort((a, b) => a.t - b.t);
  const weather = weatherRaw
    .map((w) => ({ t: sec(w.date), air: w.air_temperature, track: w.track_temperature, hum: w.humidity, rain: w.rainfall ? 1 : 0, wind: w.wind_speed, dir: w.wind_direction }))
    .filter((w) => w.t >= -120 && w.t <= duration);
  const overtakes = overtakesRaw
    .map((o) => ({ t: sec(o.date), by: o.overtaking_driver_number, on: o.overtaken_driver_number, pos: o.position }))
    .filter((o) => o.t >= 0 && o.t <= duration)
    .sort((a, b) => a.t - b.t);

  const winnerLaps = Math.max(...resultRaw.map((r) => r.number_of_laps ?? 0));
  const classification = drivers.map((d) => {
    const r = resultByNum.get(d.n) ?? {};
    const status = r.dsq ? 'DSQ' : r.dns ? 'DNS' : r.dnf ? 'DNF' : 'FIN';
    return {
      n: d.n,
      pos: r.position ?? null,
      grid: grid[d.n],
      laps: r.number_of_laps ?? laps[d.n].length,
      status,
      time: round(Array.isArray(r.duration) ? r.duration.at(-1) : r.duration, 3),
      gap: parseGap(Array.isArray(r.gap_to_leader) ? r.gap_to_leader.at(-1) : r.gap_to_leader),
      points: r.points ?? 0,
      outAt: status === 'FIN' ? null : status === 'DNS' ? 0 : round(lastMove[d.n] + 12, 1),
    };
  });

  const meta = {
    v: 1,
    key,
    year: session.year,
    round: roundNo,
    name: meeting.meeting_name,
    officialName: meeting.meeting_official_name,
    circuit: session.circuit_short_name,
    location: session.location,
    country: session.country_name,
    countryCode: session.country_code,
    date: session.date_start,
    gmtOffset: session.gmt_offset,
    totalLaps: Math.max(totalLaps, winnerLaps),
    duration: round(duration, 2),
    raceStart: round((raceStartMs - w0) / 1000, 2),
    hasDrs,
    drivers,
    track,
    pos: { dt: DT, samples, quantum, cx, cy, order: nums },
    laps,
    stints,
    pits,
    raceControl,
    trackStatus,
    weather,
    overtakes,
    classification,
    lapChart,
  };

  const report = buildReport(meta);
  const posGz = gzipSync(Buffer.from(posBuf.buffer), { level: 9 });

  await writeFile(new URL('meta.json', outDir), JSON.stringify(meta));
  await writeFile(new URL('timing.json', outDir), JSON.stringify({ positions, gaps }));
  await writeFile(new URL('report.json', outDir), JSON.stringify(report));
  await writeFile(new URL('pos.bin.gz', outDir), posGz);

  const winner = classification.find((c) => c.pos === 1);
  const byNum = new Map(drivers.map((d) => [d.n, d]));
  const podium = classification
    .filter((c) => c.pos && c.pos <= 3)
    .sort((a, b) => a.pos - b.pos)
    .map((c) => ({ code: byNum.get(c.n).code, colour: byNum.get(c.n).colour }));

  return {
    key,
    year: session.year,
    round: roundNo,
    name: meeting.meeting_name,
    circuit: session.circuit_short_name,
    country: session.country_name,
    countryCode: session.country_code,
    date: session.date_start,
    laps: meta.totalLaps,
    length: track.length,
    climb: round(Math.max(...track.z), 0),
    winner: winner ? { ...byNum.get(winner.n), time: winner.time } : null,
    podium,
    headline: report.headline,
    outline: thumbnail(
      centre.map((p) => {
        // turn the outline the way it is drawn on broadcast graphics
        const a = (track.rotation * Math.PI) / 180;
        return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
      }),
    ),
    bytes: { pos: posGz.length, tel: telBytes },
    samples: { positions: samples * nums.length, telemetry: [...telemetry.values()].reduce((s, r) => s + r.length, 0) },
  };
}
