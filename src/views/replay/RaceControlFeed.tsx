import { useMemo } from 'react';
import { clock, useClockTime } from '../../lib/clock';
import { useRace } from '../Race';

function tone(flag: string | null, cat: string, msg: string): string {
  if (flag === 'RED') return 'red';
  if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW' || cat === 'SafetyCar') return 'yellow';
  if (flag === 'GREEN' || flag === 'CLEAR') return 'green';
  if (flag === 'CHEQUERED') return 'flag';
  if (/PENALTY|INVESTIGATION|NOTED|DELETED/.test(msg)) return 'hot';
  return 'plain';
}

/** Race control shouts in capitals; keep the codes, calm the rest. */
const sentence = (s: string) =>
  (s.charAt(0) + s.slice(1).toLowerCase())
    .replace(/\b(fia|drs|vsc)\b/gi, (m) => m.toUpperCase())
    .replace(/\((\w{3})\)/g, (m) => m.toUpperCase())
    .replace(/\b(car|turn|lap|sector) (?=\d)/g, (m) => m.charAt(0).toUpperCase() + m.slice(1));

export function RaceControlFeed() {
  const { session } = useRace();
  const t = useClockTime(1);
  const all = session.meta.raceControl;

  const seen = useMemo(() => all.filter((m) => m.t <= t).length, [all, t]);
  const shown = useMemo(() => all.slice(Math.max(0, seen - 40), seen).reverse(), [all, seen]);

  return (
    <section className="rc panel ticks">
      <div className="panel-head">
        <span className="label">Race control</span>
        <span className="num dim" style={{ fontSize: 10.5 }}>
          {seen}/{all.length}
        </span>
      </div>
      <div className="rc-list">
        {shown.length === 0 && <div className="rc-empty">Waiting for the first message from race control.</div>}
        {shown.map((m) => (
          <button key={`${m.t}-${m.msg}`} className={`rc-item tone-${tone(m.flag, m.cat, m.msg)}`} onClick={() => clock.seek(Math.max(0, m.t - 3))} title="Jump to this moment">
            <i />
            <span className="rc-lap num">{m.lap != null ? `L${m.lap}` : '–'}</span>
            <span className="rc-msg">{sentence(m.msg)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
