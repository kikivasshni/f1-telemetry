export interface Driver {
  n: number;
  code: string;
  first: string;
  last: string;
  team: string;
  colour: string;
}

export interface Corner {
  n: number;
  label: string;
  d: number;
  x: number;
  y: number;
  a: number;
}

export interface TrackModel {
  length: number;
  step: number;
  x: number[];
  y: number[];
  z: number[];
  corners: Corner[];
  sectors: number[];
  rotation: number;
  refLap: { n: number; lap: number; d: number };
}

export interface Lap {
  lap: number;
  t: number | null;
  d: number | null;
  s: [number | null, number | null, number | null];
  out: 0 | 1;
  st: number | null;
}

export interface Stint {
  n: number;
  a: number;
  b: number;
  c: string;
  age: number;
}

export interface PitStop {
  n: number;
  t: number;
  lap: number;
  lane: number | null;
  stop: number | null;
}

export interface RaceControlMessage {
  t: number;
  lap: number | null;
  cat: string;
  flag: string | null;
  scope: string | null;
  n: number | null;
  msg: string;
}

export interface TrackStatus {
  type: 'SC' | 'VSC' | 'RED';
  t0: number;
  t1: number;
}

export interface WeatherSample {
  t: number;
  air: number;
  track: number;
  hum: number;
  rain: 0 | 1;
  wind: number;
  dir: number;
}

export interface Classified {
  n: number;
  pos: number | null;
  grid: number | null;
  laps: number;
  status: 'FIN' | 'DNF' | 'DNS' | 'DSQ';
  time: number | null;
  gap: number | null;
  points: number;
  outAt: number | null;
}

export interface SessionMeta {
  v: number;
  key: number;
  year: number;
  round: number;
  name: string;
  officialName: string;
  circuit: string;
  location: string;
  country: string;
  countryCode: string;
  date: string;
  totalLaps: number;
  duration: number;
  raceStart: number;
  hasDrs: boolean;
  drivers: Driver[];
  track: TrackModel;
  pos: { dt: number; samples: number; quantum: number; cx: number; cy: number; order: number[] };
  laps: Record<number, Lap[]>;
  stints: Stint[];
  pits: PitStop[];
  raceControl: RaceControlMessage[];
  trackStatus: TrackStatus[];
  weather: WeatherSample[];
  overtakes: { t: number; by: number; on: number; pos: number }[];
  classification: Classified[];
  lapChart: Record<number, (number | null)[]>;
}

export interface Timing {
  positions: Record<number, [number, number][]>;
  gaps: Record<number, { t: number[]; gap: (number | null)[]; int: (number | null)[] }>;
}

export interface ReportMoment {
  t: number | null;
  lap: number;
  kind: 'start' | 'lead' | 'sc' | 'vsc' | 'red' | 'out' | 'fastest' | 'flag';
  n?: number;
  text: string;
}

export interface Report {
  headline: string;
  angle: string;
  standfirst: string;
  sections: { title: string; body: string }[];
  facts: { label: string; value: string; sub: string; n?: number }[];
  moments: ReportMoment[];
  ledStints: { n: number; from: number; to: number }[];
  fastest: { n: number; lap: number; d: number } | null;
  source: string;
}

export interface RaceSummary {
  key: number;
  year: number;
  round: number;
  name: string;
  circuit: string;
  country: string;
  countryCode: string;
  date: string;
  status: 'ready' | 'pending' | 'upcoming';
  laps?: number;
  length?: number;
  climb?: number;
  winner?: (Driver & { time: number | null }) | null;
  podium?: { code: string; colour: string }[];
  headline?: string;
  outline?: [number, number][];
}

export interface SeasonIndex {
  seasons: Record<string, { year: number; races: RaceSummary[] }>;
}

export interface Manifest {
  generatedAt: string;
  sessions: number;
  files: number;
  bytes: number;
  positionSamples: number;
  telemetrySamples: number;
  lastRun: { ingested: number; requests: number; cacheHits: number; retries: number; downloadedBytes: number; seconds: number };
  sources: { name: string; url: string; licence: string; limit: string }[];
}

/** Decoded per-driver telemetry, column oriented. */
export interface Telemetry {
  count: number;
  t: Float32Array; // seconds since window start
  speed: Uint16Array;
  rpm: Uint16Array;
  gear: Uint8Array;
  throttle: Uint8Array;
  brake: Uint8Array;
  drs: Uint8Array;
}

/** Decoded car positions: absolute metres on the fixed grid. */
export interface Positions {
  dt: number;
  samples: number;
  order: number[];
  x: Float32Array[]; // one array per driver, same order as `order`
  y: Float32Array[];
}

export interface Session {
  meta: SessionMeta;
  timing: Timing;
  report: Report;
  positions: Positions;
  byNum: Map<number, Driver>;
  teammateIndex: Map<number, 0 | 1>;
}
