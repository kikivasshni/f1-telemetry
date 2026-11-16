import type { Manifest, Positions, Report, SeasonIndex, Session, SessionMeta, Telemetry, Timing } from './types';

const BASE = `${import.meta.env.BASE_URL}data/`;

async function json<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Fetch a gzip file. Hosts differ on whether they send it with a Content-Encoding
 * header (in which case the browser has already inflated it), so sniff the magic bytes.
 */
async function gzip(path: string, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(BASE + path);
  if (!res.ok || !res.body) throw new Error(`${path}: ${res.status}`);

  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total && onProgress) onProgress(Math.min(1, received / total));
  }
  const raw = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    raw.set(c, offset);
    offset += c.length;
  }

  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  return raw.buffer;
}

let indexPromise: Promise<SeasonIndex> | null = null;
export function loadIndex(): Promise<SeasonIndex> {
  indexPromise ??= json<SeasonIndex>('index.json');
  return indexPromise;
}

let manifestPromise: Promise<Manifest> | null = null;
export function loadManifest(): Promise<Manifest> {
  manifestPromise ??= json<Manifest>('manifest.json');
  return manifestPromise;
}

function decodePositions(buf: ArrayBuffer, meta: SessionMeta): Positions {
  const { samples, quantum, cx, cy, order, dt } = meta.pos;
  const deltas = new Int16Array(buf);
  const x: Float32Array[] = [];
  const y: Float32Array[] = [];
  order.forEach((_, di) => {
    const xs = new Float32Array(samples);
    const ys = new Float32Array(samples);
    const base = di * samples * 2;
    let ax = 0;
    let ay = 0;
    for (let i = 0; i < samples; i++) {
      ax = (ax + deltas[base + i]) | 0;
      ay = (ay + deltas[base + samples + i]) | 0;
      xs[i] = ax * quantum + cx;
      ys[i] = ay * quantum + cy;
    }
    x.push(xs);
    y.push(ys);
  });
  return { dt, samples, order, x, y };
}

const sessionCache = new Map<number, Promise<Session>>();

export function loadSession(key: number, onProgress?: (fraction: number) => void): Promise<Session> {
  let p = sessionCache.get(key);
  if (!p) {
    p = (async () => {
      const dir = `sessions/${key}/`;
      const [meta, timing, report, posBuf] = await Promise.all([
        json<SessionMeta>(`${dir}meta.json`),
        json<Timing>(`${dir}timing.json`),
        json<Report>(`${dir}report.json`),
        gzip(`${dir}pos.bin.gz`, onProgress),
      ]);
      const byNum = new Map(meta.drivers.map((d) => [d.n, d]));
      // second driver of each team gets a different marker so colour is never the only cue
      const teammateIndex = new Map<number, 0 | 1>();
      const seenTeams = new Set<string>();
      for (const d of [...meta.drivers].sort((a, b) => a.n - b.n)) {
        teammateIndex.set(d.n, seenTeams.has(d.team) ? 1 : 0);
        seenTeams.add(d.team);
      }
      return { meta, timing, report, positions: decodePositions(posBuf, meta), byNum, teammateIndex };
    })();
    sessionCache.set(key, p);
    p.catch(() => sessionCache.delete(key));
  }
  return p;
}

const telemetryCache = new Map<string, Promise<Telemetry>>();

export function loadTelemetry(key: number, driver: number): Promise<Telemetry> {
  const id = `${key}:${driver}`;
  let p = telemetryCache.get(id);
  if (!p) {
    p = gzip(`sessions/${key}/tel/${driver}.bin.gz`).then((buf) => {
      const count = new Uint32Array(buf, 0, 1)[0];
      const dt = new Uint32Array(buf, 4, count);
      const t = new Float32Array(count);
      let acc = 0;
      for (let i = 0; i < count; i++) {
        acc += dt[i];
        t[i] = acc / 1000;
      }
      const bytes = 4 + count * 8;
      return {
        count,
        t,
        speed: new Uint16Array(buf, 4 + count * 4, count),
        rpm: new Uint16Array(buf, 4 + count * 6, count),
        gear: new Uint8Array(buf, bytes, count),
        throttle: new Uint8Array(buf, bytes + count, count),
        brake: new Uint8Array(buf, bytes + count * 2, count),
        drs: new Uint8Array(buf, bytes + count * 3, count),
      };
    });
    telemetryCache.set(id, p);
    p.catch(() => telemetryCache.delete(id));
  }
  return p;
}

export function loadData<T>(path: string): Promise<T> {
  return json<T>(path);
}
