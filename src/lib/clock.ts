import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

type Listener = (t: number) => void;

/**
 * The replay clock. Everything on the pit wall reads from this one source of time.
 * It lives outside React so the 3D scene and canvases can follow it every frame
 * without re-rendering the component tree.
 */
export class Clock {
  t = 0;
  duration = 0;
  rate = 1;
  playing = false;
  /** Bumped on every seek so consumers can tell a jump from normal playback. */
  seekId = 0;

  private frameListeners = new Set<Listener>();
  private stateListeners = new Set<() => void>();
  private raf = 0;
  private last = 0;
  private snapshot = { playing: false, rate: 1 };

  configure(duration: number, start: number) {
    this.pause();
    this.duration = duration;
    this.t = start;
    this.seekId++;
    this.emitFrame();
  }

  private loop = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt * this.rate;
    if (this.t >= this.duration) {
      this.t = this.duration;
      this.emitFrame();
      this.pause();
      return;
    }
    this.emitFrame();
    this.raf = requestAnimationFrame(this.loop);
  };

  play() {
    if (this.playing) return;
    if (this.t >= this.duration - 0.5) {
      this.t = 0;
      this.seekId++;
    }
    this.playing = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    this.emitState();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emitState();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    this.t = Math.min(this.duration, Math.max(0, t));
    this.seekId++;
    this.emitFrame();
  }

  setRate(rate: number) {
    this.rate = rate;
    this.emitState();
  }

  onFrame(fn: Listener) {
    this.frameListeners.add(fn);
    return () => {
      this.frameListeners.delete(fn);
    };
  }

  private emitFrame() {
    for (const fn of this.frameListeners) fn(this.t);
  }

  private emitState() {
    this.snapshot = { playing: this.playing, rate: this.rate };
    for (const fn of this.stateListeners) fn();
  }

  subscribeState = (fn: () => void) => {
    this.stateListeners.add(fn);
    return () => {
      this.stateListeners.delete(fn);
    };
  };

  getState = () => this.snapshot;
}

export const clock = new Clock();
if (import.meta.env.DEV) (window as unknown as { __clock: Clock }).__clock = clock;

export function useClockState() {
  return useSyncExternalStore(clock.subscribeState, clock.getState);
}

/** Current replay time, re-rendering at most `hz` times a second. */
export function useClockTime(hz = 5): number {
  const [t, setT] = useState(clock.t);
  const last = useRef(0);
  useEffect(() => {
    let seek = clock.seekId;
    setT(clock.t);
    return clock.onFrame((now) => {
      const wall = performance.now();
      if (clock.seekId !== seek || wall - last.current >= 1000 / hz) {
        seek = clock.seekId;
        last.current = wall;
        setT(now);
      }
    });
  }, [hz]);
  return t;
}
