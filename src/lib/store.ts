import { create } from 'zustand';

export type CameraMode = 'circuit' | 'follow' | 'chase';

interface AppState {
  /** Driver whose car, telemetry and timing are in focus. */
  selected: number | null;
  /** Second driver for comparisons. */
  rival: number | null;
  camera: CameraMode;
  labels: boolean;
  lapA: number | null;
  lapB: number | null;
  select: (n: number | null) => void;
  setRival: (n: number | null) => void;
  setCamera: (mode: CameraMode) => void;
  toggleLabels: () => void;
  setLaps: (a: number | null, b: number | null) => void;
  reset: () => void;
}

export const useApp = create<AppState>((set) => ({
  selected: null,
  rival: null,
  camera: 'circuit',
  labels: true,
  lapA: null,
  lapB: null,
  select: (n) => set((s) => ({ selected: n, lapA: n === s.selected ? s.lapA : null })),
  setRival: (n) => set((s) => ({ rival: n, lapB: n === s.rival ? s.lapB : null })),
  setCamera: (camera) => set({ camera }),
  toggleLabels: () => set((s) => ({ labels: !s.labels })),
  setLaps: (lapA, lapB) => set({ lapA, lapB }),
  reset: () => set({ selected: null, rival: null, camera: 'circuit', lapA: null, lapB: null }),
}));
