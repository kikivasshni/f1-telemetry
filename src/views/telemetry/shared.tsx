import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadTelemetry } from '../../lib/data';
import { compound, lapTime, onDark } from '../../lib/format';
import { useApp } from '../../lib/store';
import { deltaTime, fastestLap, lapGrid, type LapGrid } from '../../lib/telemetry';
import type { Driver, Lap, Telemetry } from '../../lib/types';
import { useRace } from '../Race';

export interface PairSide {
  driver: Driver;
  lap: Lap | null;
  grid: LapGrid | null;
  colour: string;
  tel: Telemetry | null;
}

function useTelemetry(key: number, n: number | null): Telemetry | null {
  const [tel, setTel] = useState<{ n: number; data: Telemetry } | null>(null);
  useEffect(() => {
    if (n == null) return;
    let alive = true;
    loadTelemetry(key, n).then((data) => alive && setTel({ n, data }), () => {});
    return () => {
      alive = false;
    };
  }, [key, n]);
  return tel && tel.n === n ? tel.data : null;
}

/** The two laps under comparison, resampled and ready to draw. */
export function useLapPair() {
  const { session } = useRace();
  const { meta } = session;
  const selected = useApp((s) => s.selected);
  const rival = useApp((s) => s.rival);
  const lapA = useApp((s) => s.lapA);
  const lapB = useApp((s) => s.lapB);

  const nA = selected ?? meta.drivers[0].n;
  const nB = rival ?? meta.drivers.find((d) => d.n !== nA)!.n;
  const telA = useTelemetry(meta.key, nA);
  const telB = useTelemetry(meta.key, nB);

  return useMemo(() => {
    const build = (n: number, lapNo: number | null, tel: Telemetry | null, colour: string): PairSide => {
      const laps = meta.laps[n] ?? [];
      const lap = (lapNo != null ? laps.find((l) => l.lap === lapNo) : null) ?? fastestLap(laps);
      return { driver: session.byNum.get(n)!, lap, grid: tel && lap ? lapGrid(tel, lap, meta.track.length) : null, colour, tel };
    };
    const dA = session.byNum.get(nA)!;
    const dB = session.byNum.get(nB)!;
    const colourA = onDark(dA.colour);
    const colourB = dA.team === dB.team ? '#EDEBE6' : onDark(dB.colour);
    const a = build(nA, lapA, telA, colourA);
    const b = build(nB, lapB, telB, colourB);
    const delta = a.grid && b.grid ? deltaTime(a.grid, b.grid) : null;
    return { a, b, delta, loading: !telA || !telB };
  }, [session, meta, nA, nB, lapA, lapB, telA, telB]);
}

// ---- dropdown ----------------------------------------------------------------------------

export function Dropdown({ button, children, className, align = 'left' }: { button: ReactNode; children: (close: () => void) => ReactNode; className?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className={`dd ${open ? 'is-open' : ''} ${className ?? ''}`} ref={ref}>
      <button className="dd-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {button}
        <svg className="dd-caret" width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="m1.5 3 3 3 3-3" />
        </svg>
      </button>
      {open && <div className={`dd-menu align-${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function DriverPicker({ value, onPick, exclude, colour }: { value: Driver; onPick: (n: number) => void; exclude: number; colour: string }) {
  const { session } = useRace();
  const order = [...session.meta.classification].sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99));
  return (
    <Dropdown
      className="dd-driver"
      button={
        <>
          <i className="team-bar" style={{ ['--c' as string]: colour }} />
          <span className="dd-code">{value.code}</span>
          <span className="dd-name">{value.last}</span>
        </>
      }
    >
      {(close) =>
        order.map((c) => {
          const d = session.byNum.get(c.n)!;
          return (
            <button
              key={d.n}
              className={`dd-item${d.n === value.n ? ' is-on' : ''}`}
              disabled={d.n === exclude || c.status === 'DNS'}
              onClick={() => {
                onPick(d.n);
                close();
              }}
            >
              <span className="num dd-pos">{c.pos ?? c.status}</span>
              <i className="team-bar" style={{ ['--c' as string]: onDark(d.colour) }} />
              <span className="dd-code">{d.code}</span>
              <span className="dd-name">
                {d.first} {d.last}
              </span>
              <span className="dd-team">{d.team}</span>
            </button>
          );
        })
      }
    </Dropdown>
  );
}

function LapPicker({ driver, value, onPick }: { driver: Driver; value: Lap | null; onPick: (lap: number | null) => void }) {
  const { session } = useRace();
  const { meta } = session;
  const laps = meta.laps[driver.n] ?? [];
  const best = fastestLap(laps);
  const stintOf = (lap: number) => meta.stints.find((s) => s.n === driver.n && lap >= s.a && lap <= s.b);
  return (
    <Dropdown
      className="dd-lap"
      button={
        <>
          <span className="label">Lap</span>
          <span className="num dd-lapno">{value?.lap ?? '–'}</span>
          <span className={`num dd-laptime${value && best && value.lap === best.lap ? ' rank-1' : ''}`}>{lapTime(value?.d)}</span>
        </>
      }
    >
      {(close) => (
        <>
          <button
            className="dd-item dd-fast"
            onClick={() => {
              onPick(null);
              close();
            }}
          >
            Fastest lap <span className="num">{lapTime(best?.d)}</span>
          </button>
          {laps.map((l) => {
            const tyre = compound(stintOf(l.lap)?.c);
            const usable = l.d != null && l.t != null;
            return (
              <button
                key={l.lap}
                className={`dd-item${value?.lap === l.lap ? ' is-on' : ''}`}
                disabled={!usable}
                onClick={() => {
                  onPick(l.lap);
                  close();
                }}
              >
                <span className="num dd-pos">{l.lap}</span>
                <i className="tyre" style={{ ['--tc' as string]: tyre.colour }}>
                  {tyre.letter}
                </i>
                <span className={`num${best && l.lap === best.lap ? ' rank-1' : ''}`}>{lapTime(l.d)}</span>
                <span className="dd-team">{l.out ? 'out lap' : l.lap === 1 ? 'start' : ''}</span>
              </button>
            );
          })}
        </>
      )}
    </Dropdown>
  );
}

/** The "driver A lap N against driver B lap M" bar shared by Telemetry and Engineer. */
export function PairBar({ a, b, children }: { a: PairSide; b: PairSide; children?: ReactNode }) {
  const app = useApp.getState();
  const lapA = useApp((s) => s.lapA);
  const lapB = useApp((s) => s.lapB);
  return (
    <div className="pairbar">
      <div className="pair-side">
        <DriverPicker value={a.driver} colour={a.colour} exclude={b.driver.n} onPick={(n) => app.select(n)} />
        <LapPicker driver={a.driver} value={a.lap} onPick={(l) => useApp.getState().setLaps(l, lapB)} />
      </div>
      <button
        className="pair-swap"
        title="Swap drivers"
        aria-label="Swap drivers"
        onClick={() => {
          const s = useApp.getState();
          const [na, nb, la, lb] = [s.selected, s.rival, s.lapA, s.lapB];
          s.select(nb);
          s.setRival(na);
          useApp.getState().setLaps(lb, la);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M2 4.5h10m0 0L9.5 2M12 4.5 9.5 7M12 9.5H2m0 0L4.5 7M2 9.5 4.5 12" />
        </svg>
      </button>
      <div className="pair-side">
        <DriverPicker value={b.driver} colour={b.colour} exclude={a.driver.n} onPick={(n) => app.setRival(n)} />
        <LapPicker driver={b.driver} value={b.lap} onPick={(l) => useApp.getState().setLaps(lapA, l)} />
      </div>
      {children}
    </div>
  );
}
