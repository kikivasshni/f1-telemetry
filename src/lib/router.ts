import { useSyncExternalStore } from 'react';

export type RaceTab = 'replay' | 'telemetry' | 'engineer' | 'report';

export type Route =
  | { name: 'home' }
  | { name: 'race'; key: number; tab: RaceTab }
  | { name: 'predictor' }
  | { name: 'stats' }
  | { name: 'lake' };

const TABS: RaceTab[] = ['replay', 'telemetry', 'engineer', 'report'];

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'race' && Number(parts[1])) {
    const tab = TABS.includes(parts[2] as RaceTab) ? (parts[2] as RaceTab) : 'replay';
    return { name: 'race', key: Number(parts[1]), tab };
  }
  if (parts[0] === 'predictor') return { name: 'predictor' };
  if (parts[0] === 'stats') return { name: 'stats' };
  if (parts[0] === 'lake') return { name: 'lake' };
  return { name: 'home' };
}

let current: Route = parse(window.location.hash);
const listeners = new Set<() => void>();

window.addEventListener('hashchange', () => {
  current = parse(window.location.hash);
  for (const fn of listeners) fn();
});

export function href(route: Route): string {
  switch (route.name) {
    case 'race':
      return `#/race/${route.key}/${route.tab}`;
    case 'home':
      return '#/';
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route) {
  window.location.hash = href(route).slice(1);
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
