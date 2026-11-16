// Throttled, cached, retrying JSON client.
//
// Upstream APIs are rate limited (OpenF1: 3 req/s and 30 req/min, Jolpica: 4 req/s
// and 500 req/hour), so every host gets its own minimum gap between request starts.
// Responses land in .cache/ so a failed run resumes without re-downloading anything.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const CACHE_DIR = new URL('../../.cache/', import.meta.url);
const USER_AGENT = 'pit-wall-pipeline/0.1';

export const stats = { requests: 0, cacheHits: 0, retries: 0, bytes: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextSlot = new Map();

async function waitTurn(host, gapMs) {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + gapMs);
  if (at > now) await sleep(at - now);
}

/**
 * GET a JSON document.
 * A 404 (OpenF1's "No results found") resolves to an empty array.
 */
export async function getJson(url, { gapMs = 2150, cache = true, retries = 7, timeoutMs = 240000 } = {}) {
  const key = createHash('sha1').update(url).digest('hex');
  const file = new URL(`${key}.json.gz`, CACHE_DIR);

  if (cache) {
    try {
      const hit = JSON.parse(gunzipSync(await readFile(file)).toString('utf8'));
      stats.cacheHits++;
      return hit;
    } catch {
      // not cached yet
    }
  }

  const host = new URL(url).host;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await waitTurn(host, gapMs);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      stats.requests++;

      if (res.status === 404) {
        await res.arrayBuffer();
        return [];
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        await res.arrayBuffer().catch(() => {});
        throw Object.assign(new Error(`HTTP ${res.status}`), { waitMs: retryAfter * 1000 });
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { fatal: true });

      const text = await res.text();
      stats.bytes += text.length;
      const json = JSON.parse(text);
      const value = json && !Array.isArray(json) && json.detail ? [] : json;

      if (cache) {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(file, gzipSync(JSON.stringify(value), { level: 1 }));
      }
      return value;
    } catch (err) {
      if (err.fatal) throw err;
      lastError = err;
      stats.retries++;
      const backoff = Math.max(err.waitMs ?? 0, Math.min(60000, 3000 * 2 ** attempt));
      await sleep(backoff);
    }
  }
  throw new Error(`Gave up on ${url}: ${lastError?.message}`);
}

/** Run async jobs with a fixed number of workers, preserving input order. */
export async function pool(items, size, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}
