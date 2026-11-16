import { useState } from 'react';
import { useClockTime } from '../../lib/clock';
import { compound, gap, lapTime, onDark } from '../../lib/format';
import { useApp } from '../../lib/store';
import { useRace } from '../Race';

const ROW = 29;

const STATUS = {
  SC: { label: 'Safety car', cls: 'is-sc' },
  VSC: { label: 'Virtual SC', cls: 'is-sc' },
  RED: { label: 'Red flag', cls: 'is-red' },
} as const;

export function TimingTower() {
  const { session, live } = useRace();
  const t = useClockTime(4);
  const selected = useApp((s) => s.selected);
  const [mode, setMode] = useState<'interval' | 'leader'>('interval');

  const rows = live.rows(t);
  const lap = live.raceLap(t);
  const status = live.statusAt(t);
  const racing = t >= session.meta.raceStart;
  const finished = lap >= session.meta.totalLaps && rows[0] && rows[0].lap >= session.meta.totalLaps && t > session.meta.duration - 50;
  const order = new Map(rows.map((r, i) => [r.n, i]));

  return (
    <section className="tower panel ticks">
      <div className="tower-head">
        <div className="tower-lap">
          <span className="label">Lap</span>
          <div className="num">
            <b>{racing ? lap : 0}</b>
            <i>/{session.meta.totalLaps}</i>
          </div>
        </div>
        <div className={`flag-chip ${status ? STATUS[status.type].cls : finished ? 'is-flag' : racing ? 'is-green' : ''}`}>
          <i />
          {status ? STATUS[status.type].label : finished ? 'Chequered' : racing ? 'Green' : 'Grid'}
        </div>
      </div>

      <div className="tower-cols">
        <span>Pos</span>
        <span>Driver</span>
        <button onClick={() => setMode(mode === 'interval' ? 'leader' : 'interval')} title="Switch between interval and gap to leader">
          {mode === 'interval' ? 'Interval' : 'Leader'}
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
            <path d="M4 0 7 3H1zM4 8 1 5h6z" />
          </svg>
        </button>
        <span>Tyre</span>
        <span>Last lap</span>
      </div>

      <div className="tower-rows" style={{ height: rows.length * ROW }}>
        {session.meta.drivers.map((d) => {
          const i = order.get(d.n) ?? 0;
          const r = rows[i];
          const tyre = compound(r.compound);
          const value = r.out ? 'OUT' : r.inPit ? 'PIT' : i === 0 && racing ? (mode === 'interval' ? 'Interval' : 'Leader') : gap(mode === 'interval' ? r.interval : r.gap);
          return (
            <button
              key={d.n}
              className={`tw-row${selected === d.n ? ' is-selected' : ''}${r.out ? ' is-out' : ''}`}
              style={{ transform: `translateY(${i * ROW}px)`, zIndex: selected === d.n ? 2 : 1 }}
              onClick={() => useApp.getState().select(d.n)}
              aria-label={`${d.first} ${d.last}, position ${r.pos}`}
            >
              <span className="tw-pos num">{r.out ? '–' : r.pos}</span>
              <i className="team-bar" style={{ ['--c' as string]: onDark(d.colour) }} />
              <span className="tw-code">
                {d.code}
                {racing && !r.out && r.gained !== 0 && (
                  <em className={r.gained > 0 ? 'up' : 'down'}>
                    {r.gained > 0 ? '▲' : '▼'}
                    {Math.abs(r.gained)}
                  </em>
                )}
              </span>
              <span className={`tw-gap num${r.inPit ? ' is-pit' : ''}${i === 0 && racing && !r.out && !r.inPit ? ' is-lead' : ''}`}>{value}</span>
              <span className="tw-tyre">
                <i className="tyre" style={{ ['--tc' as string]: tyre.colour }}>
                  {tyre.letter}
                </i>
                <span className="num">{r.tyreAge}</span>
              </span>
              <span className={`tw-last num rank-${r.lastLapRank}`}>{lapTime(r.lastLap)}</span>
            </button>
          );
        })}
      </div>

      <div className="tower-legend">
        <span>
          <i style={{ background: 'var(--purple)' }} />
          Fastest of the race
        </span>
        <span>
          <i style={{ background: 'var(--green)' }} />
          Personal best
        </span>
      </div>
    </section>
  );
}
