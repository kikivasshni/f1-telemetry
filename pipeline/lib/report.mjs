// Builds the written race report from the session's own timing data.
// Every sentence is derived from a number in meta.json: nothing is recalled or invented.

const COMPOUND = { SOFT: 'soft', MEDIUM: 'medium', HARD: 'hard', INTERMEDIATE: 'intermediate', WET: 'wet' };

export function fmtLap(s) {
  if (s == null) return '–';
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(3).padStart(6, '0');
  return m ? `${m}:${rest}` : rest;
}

export function fmtRaceTime(s) {
  if (s == null) return '–';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const rest = (s - h * 3600 - m * 60).toFixed(3).padStart(6, '0');
  return `${h}:${String(m).padStart(2, '0')}:${rest}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const list = (items) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export function buildReport(meta) {
  const driver = new Map(meta.drivers.map((d) => [d.n, d]));
  const last = (n) => driver.get(n)?.last ?? `#${n}`;
  const full = (n) => `${driver.get(n)?.first ?? ''} ${driver.get(n)?.last ?? ''}`.trim();
  const cls = [...meta.classification].sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99));
  const [p1, p2, p3] = cls;
  const place = meta.location || meta.circuit;

  // lap number being run by the winner at time t
  const winnerLaps = meta.laps[p1.n] ?? [];
  const lapAt = (t) => {
    let lap = 1;
    for (const l of winnerLaps) if (l.t != null && l.t <= t) lap = l.lap;
    return Math.min(lap, meta.totalLaps);
  };

  // ---- who led when ---------------------------------------------------------------
  const leaderOf = (lap) => {
    for (const d of meta.drivers) if (meta.lapChart[d.n]?.[lap] === 1) return d.n;
    return null;
  };
  const ledStints = [];
  for (let lap = 1; lap <= meta.totalLaps; lap++) {
    const n = leaderOf(lap);
    if (n == null) continue;
    const cur = ledStints[ledStints.length - 1];
    if (cur && cur.n === n) cur.to = lap;
    else ledStints.push({ n, from: lap, to: lap });
  }
  const lapsLed = new Map();
  for (const s of ledStints) lapsLed.set(s.n, (lapsLed.get(s.n) ?? 0) + s.to - s.from + 1);
  const leadChanges = Math.max(0, ledStints.length - 1);
  const pole = meta.drivers.find((d) => meta.classification.find((c) => c.n === d.n)?.grid === 1)?.n ?? null;

  // ---- fastest lap ----------------------------------------------------------------
  let fastest = null;
  for (const d of meta.drivers) {
    for (const l of meta.laps[d.n] ?? []) {
      if (l.d == null || l.lap === 1 || l.d < 40) continue;
      if (!fastest || l.d < fastest.d) fastest = { n: d.n, lap: l.lap, d: l.d };
    }
  }

  // ---- neutralisations ------------------------------------------------------------
  const neutral = meta.trackStatus.map((s) => ({ ...s, lap0: lapAt(s.t0), lap1: lapAt(s.t1) }));
  const sc = neutral.filter((s) => s.type === 'SC');
  const vsc = neutral.filter((s) => s.type === 'VSC');
  const red = neutral.filter((s) => s.type === 'RED');

  // ---- pit lane -------------------------------------------------------------------
  const racePits = meta.pits.filter((p) => p.t > meta.raceStart && p.lane != null && p.lane < 120);
  const timedStops = racePits.filter((p) => p.stop != null && p.stop > 1.4 && p.stop < 30);
  const quickest = timedStops.length ? timedStops.reduce((a, b) => (b.stop < a.stop ? b : a)) : null;
  const stintsOf = (n) => meta.stints.filter((s) => s.n === n).sort((a, b) => a.a - b.a);
  const compoundsOf = (n) => {
    const seq = [];
    for (const s of stintsOf(n)) if (seq[seq.length - 1] !== s.c) seq.push(s.c);
    return seq;
  };
  const stopsOf = (n) => racePits.filter((p) => p.n === n).length;

  // ---- movers ---------------------------------------------------------------------
  const finishers = cls.filter((c) => c.status === 'FIN' && c.pos && c.grid);
  const gain = (c) => c.grid - c.pos;
  const climber = finishers.length ? finishers.reduce((a, b) => (gain(b) > gain(a) ? b : a)) : null;
  const faller = finishers.length ? finishers.reduce((a, b) => (gain(b) < gain(a) ? b : a)) : null;
  const passes = new Map();
  for (const o of meta.overtakes) passes.set(o.by, (passes.get(o.by) ?? 0) + 1);
  const topPasser = [...passes.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const retired = cls.filter((c) => c.status === 'DNF');
  const noStart = cls.filter((c) => c.status === 'DNS');

  // ---- weather --------------------------------------------------------------------
  const inRace = meta.weather.filter((w) => w.t >= meta.raceStart);
  const wetShare = inRace.length ? inRace.filter((w) => w.rain).length / inRace.length : 0;
  const usedWets = meta.stints.some((s) => s.c === 'INTERMEDIATE' || s.c === 'WET');
  const wet = usedWets || wetShare > 0.25;
  const temps = (k) => {
    const vals = inRace.map((w) => w[k]).filter((v) => v != null && v > 1);
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [null, null];
  };
  const [trackLo, trackHi] = temps('track');
  const [airLo, airHi] = temps('air');

  // ---- margin ---------------------------------------------------------------------
  const margin = p2?.gap != null && p2.gap > 0 ? p2.gap : null;
  const marginText = margin != null ? `${margin.toFixed(3)}s` : p2?.gap != null && p2.gap < 0 ? plural(-p2.gap, 'lap') : null;

  // ---- headline -------------------------------------------------------------------
  const ledAll = lapsLed.get(p1.n) === meta.totalLaps && p1.grid === 1;
  let headline;
  let angle;
  if (wet) {
    headline = `${last(p1.n)} masters the wet to win in ${place}`;
    angle = 'wet';
  } else if (p1.grid && p1.grid >= 4) {
    headline = `${last(p1.n)} charges from ${ordinal(p1.grid)} on the grid to win in ${place}`;
    angle = 'charge';
  } else if (margin != null && margin < 1.2) {
    headline = `${last(p1.n)} holds off ${last(p2.n)} by ${margin.toFixed(3)}s in ${place}`;
    angle = 'close';
  } else if (red.length || sc.length >= 2) {
    headline = `${last(p1.n)} keeps a cool head through a disrupted race in ${place}`;
    angle = 'chaos';
  } else if (ledAll) {
    headline = `Lights to flag: ${last(p1.n)} controls every lap in ${place}`;
    angle = 'dominant';
  } else if (leadChanges >= 4) {
    headline = `${last(p1.n)} comes out on top after ${leadChanges} lead changes in ${place}`;
    angle = 'battle';
  } else {
    headline = `${last(p1.n)} wins the ${meta.name}`;
    angle = 'win';
  }

  const standfirst =
    `${full(p1.n)} won the ${meta.name} for ${driver.get(p1.n).team}` +
    (marginText ? `, finishing ${marginText} ahead of ${full(p2.n)}` : p2 ? `, ahead of ${full(p2.n)}` : '') +
    (p3 ? `, with ${full(p3.n)} completing the podium` : '') +
    ` after ${meta.totalLaps} laps of ${meta.circuit}.`;

  // ---- sections -------------------------------------------------------------------
  const sections = [];

  {
    const firstLeader = ledStints[0]?.n;
    const lapOne = meta.drivers
      .map((d) => ({ n: d.n, grid: meta.lapChart[d.n]?.[0], after: meta.lapChart[d.n]?.[1] }))
      .filter((r) => r.grid && r.after);
    const best = lapOne.length ? lapOne.reduce((a, b) => (b.grid - b.after > a.grid - a.after ? b : a)) : null;
    let body = pole != null ? `${full(pole)} lined up first on the grid. ` : '';
    if (firstLeader != null && pole != null && firstLeader !== pole) {
      body += `${last(firstLeader)} got the better launch and led the field across the line at the end of the opening lap. `;
    } else if (firstLeader != null) {
      body += `${last(firstLeader)} converted that into the lead at the end of lap one. `;
    }
    if (best && best.grid - best.after >= 2) {
      body += `The biggest winner of the opening lap was ${last(best.n)}, up ${plural(best.grid - best.after, 'place')} to ${ordinal(best.after)}.`;
    }
    if (body.trim()) sections.push({ title: 'The start', body: body.trim() });
  }

  {
    let body;
    if (leadChanges === 0) {
      body = `${last(p1.n)} was never headed, leading all ${meta.totalLaps} laps.`;
    } else {
      const led = [...lapsLed.entries()].sort((a, b) => b[1] - a[1]).map(([n, laps]) => `${last(n)} (${laps})`);
      body = `The lead changed hands ${plural(leadChanges, 'time')}. Laps led: ${list(led)}.`;
      const decisive = ledStints[ledStints.length - 1];
      if (decisive && decisive.n === p1.n && decisive.from > 1) {
        body += ` ${last(p1.n)} took the lead for good on lap ${decisive.from}.`;
      }
    }
    const bits = [];
    if (red.length) bits.push(`${plural(red.length, 'red flag')} (lap ${red.map((s) => s.lap0).join(', ')})`);
    if (sc.length) bits.push(`${plural(sc.length, 'safety car period')} (lap ${sc.map((s) => (s.lap1 > s.lap0 ? `${s.lap0}–${s.lap1}` : s.lap0)).join(', ')})`);
    if (vsc.length) bits.push(`${plural(vsc.length, 'virtual safety car')} (lap ${vsc.map((s) => s.lap0).join(', ')})`);
    body += bits.length ? ` The race was neutralised by ${list(bits)}.` : ' The race ran green from start to finish.';
    sections.push({ title: 'How it unfolded', body });
  }

  {
    const seq = compoundsOf(p1.n).map((c) => COMPOUND[c] ?? c.toLowerCase());
    const stops = stopsOf(p1.n);
    let body = `${last(p1.n)} ${stops === 0 ? 'did not stop' : `made ${plural(stops, 'stop')}`}`;
    if (seq.length) body += `, running ${seq.join(' → ')} tyres`;
    body += `. The field made ${plural(racePits.length, 'pit stop')} in total`;
    if (quickest) body += `; the quickest stationary time was ${quickest.stop.toFixed(1)}s for ${last(quickest.n)} on lap ${quickest.lap}`;
    body += '.';
    const oneStoppers = finishers.filter((c) => c.pos <= 10 && stopsOf(c.n) <= 1).length;
    const topTen = finishers.filter((c) => c.pos <= 10).length;
    if (topTen >= 8 && oneStoppers > 0) body += ` ${oneStoppers} of the top ${topTen} finishers got home with one stop or fewer.`;
    sections.push({ title: 'Strategy', body });
  }

  {
    const bits = [];
    if (climber && gain(climber) >= 3) {
      bits.push(`${full(climber.n)} made up the most ground, climbing ${plural(gain(climber), 'place')} from ${ordinal(climber.grid)} to ${ordinal(climber.pos)}.`);
    }
    if (faller && gain(faller) <= -4) {
      bits.push(`${last(faller.n)} went the other way, slipping from ${ordinal(faller.grid)} to ${ordinal(faller.pos)}.`);
    }
    if (meta.overtakes.length) {
      bits.push(`Timing recorded ${plural(meta.overtakes.length, 'on-track position change')}${topPasser ? `, ${topPasser[1]} of them by ${last(topPasser[0])}` : ''}.`);
    }
    if (bits.length) sections.push({ title: 'Movers', body: bits.join(' ') });
  }

  if (retired.length || noStart.length) {
    const bits = [];
    if (retired.length) {
      bits.push(`${list(retired.map((c) => `${last(c.n)} (lap ${c.laps + 1 > meta.totalLaps ? c.laps : c.laps + 1})`))} failed to finish.`);
    }
    if (noStart.length) bits.push(`${list(noStart.map((c) => last(c.n)))} did not take the start.`);
    sections.push({ title: 'Retirements', body: bits.join(' ') });
  }

  {
    let body = wet
      ? wetShare >= 0.15
        ? `Rain shaped the afternoon: wet-weather tyres were needed and rain was reported in ${Math.round(wetShare * 100)}% of weather readings.`
        : 'A damp track called for wet-weather tyres for part of the distance, although little rain fell during the race itself.'
      : 'It stayed dry throughout.';
    if (trackLo != null) body += ` Track temperature ranged from ${trackLo.toFixed(0)}°C to ${trackHi.toFixed(0)}°C, with air at ${airLo.toFixed(0)}–${airHi.toFixed(0)}°C.`;
    if (fastest) body += ` ${full(fastest.n)} set the fastest lap, a ${fmtLap(fastest.d)} on lap ${fastest.lap}.`;
    sections.push({ title: 'Conditions and pace', body });
  }

  // ---- key moments ----------------------------------------------------------------
  const moments = [{ t: meta.raceStart, lap: 1, kind: 'start', text: 'Lights out' }];
  for (let i = 1; i < ledStints.length; i++) {
    const s = ledStints[i];
    const lapRow = (meta.laps[s.n] ?? []).find((l) => l.lap === s.from);
    moments.push({ t: lapRow?.t ?? null, lap: s.from, kind: 'lead', n: s.n, text: `${last(s.n)} takes the lead from ${last(ledStints[i - 1].n)}` });
  }
  for (const s of neutral) {
    const label = s.type === 'SC' ? 'Safety car deployed' : s.type === 'VSC' ? 'Virtual safety car' : 'Red flag';
    moments.push({ t: s.t0, lap: s.lap0, kind: s.type.toLowerCase(), text: label });
  }
  for (const c of retired) moments.push({ t: c.outAt, lap: Math.min(meta.totalLaps, c.laps + 1), kind: 'out', n: c.n, text: `${last(c.n)} retires` });
  if (fastest) {
    const lapRow = (meta.laps[fastest.n] ?? []).find((l) => l.lap === fastest.lap);
    moments.push({ t: lapRow ? lapRow.t + lapRow.d : null, lap: fastest.lap, kind: 'fastest', n: fastest.n, text: `${last(fastest.n)} sets the fastest lap, ${fmtLap(fastest.d)}` });
  }
  const flagLap = winnerLaps[winnerLaps.length - 1];
  if (flagLap?.t != null && flagLap.d != null) {
    moments.push({ t: flagLap.t + flagLap.d, lap: meta.totalLaps, kind: 'flag', n: p1.n, text: `${last(p1.n)} takes the chequered flag` });
  }
  moments.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

  const facts = [
    { label: 'Winner', value: last(p1.n), sub: `${driver.get(p1.n).team} · ${fmtRaceTime(p1.time)}`, n: p1.n },
    { label: 'Winning margin', value: marginText ?? '–', sub: p2 ? `over ${last(p2.n)}` : '' },
    { label: 'Fastest lap', value: fastest ? fmtLap(fastest.d) : '–', sub: fastest ? `${last(fastest.n)} · lap ${fastest.lap}` : '', n: fastest?.n },
    { label: 'Lead changes', value: String(leadChanges), sub: `${lapsLed.size} different leader${lapsLed.size === 1 ? '' : 's'}` },
    { label: 'Pit stops', value: String(racePits.length), sub: quickest ? `quickest ${quickest.stop.toFixed(1)}s · ${last(quickest.n)}` : '' },
    { label: 'Position changes', value: String(meta.overtakes.length), sub: topPasser ? `${last(topPasser[0])} made ${topPasser[1]}` : 'on track' },
    { label: 'Neutralisations', value: String(sc.length + vsc.length + red.length), sub: [sc.length && `${sc.length} SC`, vsc.length && `${vsc.length} VSC`, red.length && `${red.length} red`].filter(Boolean).join(' · ') || 'green all the way' },
    { label: 'Track temp', value: trackHi != null ? `${trackHi.toFixed(0)}°C` : '–', sub: wet ? 'wet race' : 'dry race' },
  ];

  return {
    headline,
    angle,
    standfirst,
    sections,
    facts,
    moments,
    ledStints,
    fastest,
    source: 'rules',
  };
}
