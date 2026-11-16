// Track geometry helpers. All coordinates are metres.

/** Catmull-Rom point on a closed loop. */
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Drop consecutive duplicates and a repeated closing point. */
export function dedupe(points, minDist = 0.5) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDist) out.push(p);
  }
  if (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < minDist * 4) out.pop();
  }
  return out;
}

/** Resample a closed polyline to (roughly) uniform spacing using a Catmull-Rom spline. */
export function resampleClosed(points, spacing) {
  const n = points.length;
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(1, Math.ceil(segLen / (spacing / 4)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      dense.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  // walk the dense loop at fixed arc length
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1];
  const count = Math.round(total / spacing);
  const step = total / count;
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const d = k * step;
    while (cum[j + 1] < d) j++;
    const a = dense[j % dense.length];
    const b = dense[(j + 1) % dense.length];
    const f = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return { points: out, length: total, step };
}

/** Nearest vertex index on a polyline (brute force; build-time only). */
export function nearestIndex(points, x, y) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i][0] - x;
    const dy = points[i][1] - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, dist: Math.sqrt(bestD) };
}

/** Circular moving average. */
export function smoothCircular(values, radius) {
  const n = values.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += values[(i + k + n) % n];
    out[i] = sum / (2 * radius + 1);
  }
  return out;
}

/** Douglas-Peucker style decimation by keeping every k-th point, for thumbnails. */
export function thumbnail(points, target = 140) {
  const stepN = Math.max(1, Math.floor(points.length / target));
  const picked = points.filter((_, i) => i % stepN === 0);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of picked) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const scale = 1000 / Math.max(maxX - minX, maxY - minY);
  const ox = (1000 - (maxX - minX) * scale) / 2;
  const oy = (1000 - (maxY - minY) * scale) / 2;
  // y is flipped so the outline reads the right way up in SVG space
  return picked.map(([x, y]) => [Math.round((x - minX) * scale + ox), Math.round(1000 - ((y - minY) * scale + oy))]);
}
