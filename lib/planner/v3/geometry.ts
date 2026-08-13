import type { LngLat } from "@/lib/mapbox";
import type { PtM } from "../types";

/**
 * Equirectangular projection around an origin — accurate to centimeters at
 * garden scale (< 1 km), which is all the planner needs.
 */
export function makeLocalProjection(origin: LngLat) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const cosLat = Math.cos(origin.lat * toRad);
  return {
    toM(p: LngLat): PtM {
      return {
        x: (p.lng - origin.lng) * toRad * R * cosLat,
        y: (p.lat - origin.lat) * toRad * R,
      };
    },
    toLngLat(p: PtM): LngLat {
      return {
        lng: origin.lng + p.x / (toRad * R * cosLat),
        lat: origin.lat + p.y / (toRad * R),
      };
    },
  };
}

export function dist(a: PtM, b: PtM): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polygonAreaM2Local(ring: PtM[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}

/** Ensure counter-clockwise winding (positive signed area). */
export function ensureCCW(ring: PtM[]): PtM[] {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s >= 0 ? ring : [...ring].reverse();
}

export function pointInPolygon(pt: PtM, ring: PtM[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const denom = yj - yi || 1e-12;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / denom + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function distToSegment(p: PtM, a: PtM, b: PtM): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToBoundary(p: PtM, ring: PtM[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = distToSegment(p, ring[i], ring[(i + 1) % ring.length]);
    if (d < best) best = d;
  }
  return best;
}

export function bbox(ring: PtM[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Interior angle at vertex i of a CCW ring, degrees (0..360). */
export function interiorAngleDeg(ring: PtM[], i: number): number {
  const n = ring.length;
  const prev = ring[(i - 1 + n) % n];
  const cur = ring[i];
  const next = ring[(i + 1) % n];
  const a1 = Math.atan2(prev.y - cur.y, prev.x - cur.x);
  const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
  let ang = ((a1 - a2) * 180) / Math.PI;
  ang = ((ang % 360) + 360) % 360;
  return ang;
}

/**
 * Direction (deg CW from north / +y axis) of the bisector pointing into the
 * polygon at vertex i of a CCW ring.
 */
export function inwardBisectorDeg(ring: PtM[], i: number): number {
  const n = ring.length;
  const prev = ring[(i - 1 + n) % n];
  const cur = ring[i];
  const next = ring[(i + 1) % n];
  const a1 = Math.atan2(prev.y - cur.y, prev.x - cur.x);
  const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
  // rotate from edge->next toward edge->prev halfway (interior side of CCW ring)
  let ang = a1 - a2;
  ang = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const bis = a2 + ang / 2;
  return mathAngleToCompass(bis);
}

/** Inward normal (deg CW from north) of edge i→i+1 of a CCW ring. */
export function inwardNormalDeg(ring: PtM[], i: number): number {
  const a = ring[i];
  const b = ring[(i + 1) % ring.length];
  const edge = Math.atan2(b.y - a.y, b.x - a.x);
  // CCW ring: interior is to the left of the edge direction
  return mathAngleToCompass(edge + Math.PI / 2);
}

/** Outward normal (deg CW from north) of edge i→i+1 of a CCW ring. */
export function outwardNormalDeg(ring: PtM[], i: number): number {
  return (inwardNormalDeg(ring, i) + 180) % 360;
}

/**
 * Average of two compass bearings → compass degrees.
 * Used for building-corner bisectors into the lawn.
 */
export function averageCompassDeg(a: number, b: number): number {
  const a1 = compassToMathAngle(a);
  const a2 = compassToMathAngle(b);
  const ux = Math.cos(a1) + Math.cos(a2);
  const uy = Math.sin(a1) + Math.sin(a2);
  if (Math.hypot(ux, uy) < 1e-9) return a;
  return mathAngleToCompass(Math.atan2(uy, ux));
}

/** Convert math angle (rad, CCW from +x) to compass degrees (CW from north). */
export function mathAngleToCompass(rad: number): number {
  const deg = 90 - (rad * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Convert compass degrees (CW from north) to math angle in radians. */
export function compassToMathAngle(deg: number): number {
  return ((90 - deg) * Math.PI) / 180;
}

/** Point at distance d from p in compass direction deg. */
export function offsetPoint(p: PtM, deg: number, d: number): PtM {
  const a = compassToMathAngle(deg);
  return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
}

/**
 * Distance from p along compass bearing until the ray leaves the polygon
 * (or hits an obstacle ring). Returns 0 if p is already outside.
 */
export function rayExitDistance(
  p: PtM,
  compassDeg: number,
  ring: PtM[],
  obstacles: PtM[][] = [],
  maxM = 40,
  stepM = 0.25,
): number {
  if (!pointInPolygon(p, ring)) return 0;
  let lastInside = 0;
  for (let d = stepM; d <= maxM; d += stepM) {
    const q = offsetPoint(p, compassDeg, d);
    if (!pointInPolygon(q, ring)) return lastInside;
    if (obstacles.some((o) => pointInPolygon(q, o))) return lastInside;
    lastInside = d;
  }
  return lastInside;
}

/**
 * Tightest throw that stays on the lawn and misses obstacles within a sector.
 * Use this to cap radius so buildings / neighbours are not watered.
 */
export function sectorClearanceM(
  p: PtM,
  rotationDeg: number,
  arcDeg: number,
  ring: PtM[],
  obstacles: PtM[][] = [],
): number {
  const sample = (bearing: number) =>
    rayExitDistance(p, ((bearing % 360) + 360) % 360, ring, obstacles);

  if (arcDeg >= 360) {
    let best = Infinity;
    for (let a = 0; a < 360; a += 15) {
      best = Math.min(best, sample(a));
    }
    return Number.isFinite(best) ? best : 0;
  }

  const half = arcDeg / 2;
  const step = Math.max(5, Math.round(arcDeg / 16));
  let best = Infinity;
  for (let a = -half; a <= half + 0.01; a += step) {
    best = Math.min(best, sample(rotationDeg + a));
  }
  best = Math.min(best, sample(rotationDeg));
  return Number.isFinite(best) ? best : 0;
}

/** @deprecated Prefer sectorClearanceM for no-overspray caps. */
export function sectorReachM(
  p: PtM,
  rotationDeg: number,
  arcDeg: number,
  ring: PtM[],
  obstacles: PtM[][] = [],
): number {
  return sectorClearanceM(p, rotationDeg, arcDeg, ring, obstacles);
}

/** Shortest distance from point to any obstacle ring boundary (or interior = 0). */
export function distToObstacles(p: PtM, obstacles: PtM[][]): number {
  if (obstacles.length === 0) return Infinity;
  let best = Infinity;
  for (const o of obstacles) {
    if (pointInPolygon(p, o)) return 0;
    best = Math.min(best, distToBoundary(p, o));
  }
  return best;
}

/** True if open segment a→b enters any obstacle (samples + edge clips). */
export function segmentHitsObstacles(
  a: PtM,
  b: PtM,
  obstacles: PtM[][],
  stepM = 0.35,
): boolean {
  if (obstacles.length === 0) return false;
  const len = dist(a, b);
  if (len < 1e-6) {
    return obstacles.some((o) => pointInPolygon(a, o));
  }
  const n = Math.max(2, Math.ceil(len / stepM));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (obstacles.some((o) => pointInPolygon(p, o))) return true;
  }
  // Segment vs obstacle edges
  for (const ring of obstacles) {
    for (let i = 0; i < ring.length; i++) {
      if (segmentsIntersect(a, b, ring[i], ring[(i + 1) % ring.length])) {
        return true;
      }
    }
  }
  return false;
}

function orient(a: PtM, b: PtM, c: PtM): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSeg(a: PtM, b: PtM, p: PtM): boolean {
  return (
    Math.min(a.x, b.x) - 1e-9 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= p.y &&
    p.y <= Math.max(a.y, b.y) + 1e-9
  );
}

/** Proper or improper segment intersection (including touching). */
export function segmentsIntersect(a: PtM, b: PtM, c: PtM, d: PtM): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (Math.abs(o1) < 1e-9 && onSeg(a, b, c)) return true;
  if (Math.abs(o2) < 1e-9 && onSeg(a, b, d)) return true;
  if (Math.abs(o3) < 1e-9 && onSeg(c, d, a)) return true;
  if (Math.abs(o4) < 1e-9 && onSeg(c, d, b)) return true;
  return false;
}

/**
 * Polyline a→…→b that avoids Gebäude. Uses obstacle vertices as detours.
 * Falls back to straight line if no clear path found (caller may warn).
 */
export function clearPath(
  a: PtM,
  b: PtM,
  obstacles: PtM[][],
  padM = 0.55,
): { path: PtM[]; clear: boolean } {
  if (!segmentHitsObstacles(a, b, obstacles)) {
    return { path: [a, b], clear: true };
  }
  if (obstacles.length === 0) return { path: [a, b], clear: true };

  const waypoints: PtM[] = [];
  for (const ring of obstacles) {
    if (ring.length < 3) continue;
    let cx = 0;
    let cy = 0;
    for (const v of ring) {
      cx += v.x;
      cy += v.y;
    }
    cx /= ring.length;
    cy /= ring.length;
    for (const v of ring) {
      const dx = v.x - cx;
      const dy = v.y - cy;
      const L = Math.hypot(dx, dy) || 1;
      const p = { x: v.x + (dx / L) * padM, y: v.y + (dy / L) * padM };
      if (!obstacles.some((o) => pointInPolygon(p, o))) waypoints.push(p);
    }
    const bb = bbox(ring);
    const corners: PtM[] = [
      { x: bb.minX - padM, y: bb.minY - padM },
      { x: bb.maxX + padM, y: bb.minY - padM },
      { x: bb.maxX + padM, y: bb.maxY + padM },
      { x: bb.minX - padM, y: bb.maxY + padM },
    ];
    for (const p of corners) {
      if (!obstacles.some((o) => pointInPolygon(p, o))) waypoints.push(p);
    }
  }

  const nodes: PtM[] = [a, b, ...waypoints];
  const N = nodes.length;
  const INF = 1e12;
  const cost: number[][] = Array.from({ length: N }, () =>
    Array(N).fill(INF),
  );
  for (let i = 0; i < N; i++) {
    cost[i][i] = 0;
    for (let j = i + 1; j < N; j++) {
      if (segmentHitsObstacles(nodes[i], nodes[j], obstacles)) continue;
      const d = dist(nodes[i], nodes[j]);
      cost[i][j] = d;
      cost[j][i] = d;
    }
  }

  // Dijkstra 0 → 1
  const distN = Array(N).fill(INF);
  const prev = Array(N).fill(-1);
  const used = Array(N).fill(false);
  distN[0] = 0;
  for (let iter = 0; iter < N; iter++) {
    let u = -1;
    for (let i = 0; i < N; i++) {
      if (!used[i] && (u < 0 || distN[i] < distN[u])) u = i;
    }
    if (u < 0 || distN[u] >= INF) break;
    used[u] = true;
    if (u === 1) break;
    for (let v = 0; v < N; v++) {
      if (distN[u] + cost[u][v] < distN[v]) {
        distN[v] = distN[u] + cost[u][v];
        prev[v] = u;
      }
    }
  }

  if (distN[1] >= INF) {
    return { path: [a, b], clear: false };
  }
  const pathIdx: number[] = [];
  for (let cur = 1; cur !== -1; cur = prev[cur]) pathIdx.push(cur);
  pathIdx.reverse();
  return { path: pathIdx.map((i) => nodes[i]), clear: true };
}

export function polylineLength(points: PtM[]): number {
  let s = 0;
  for (let i = 0; i < points.length - 1; i++) s += dist(points[i], points[i + 1]);
  return s;
}

/**
 * Local width ≈ 2 × distance-to-boundary (medial-axis proxy).
 * Used to classify corridors vs open lawn without a single global width.
 */
export function localWidthM(p: PtM, ring: PtM[]): number {
  if (!pointInPolygon(p, ring)) return 0;
  return 2 * distToBoundary(p, ring);
}

export function sampleLocalWidths(
  ring: PtM[],
  obstacles: PtM[][] = [],
  step?: number,
): number[] {
  const box = bbox(ring);
  const s = step ?? Math.max(0.4, Math.min(box.w, box.h) / 20);
  const widths: number[] = [];
  for (let y = box.minY + s / 2; y <= box.maxY; y += s) {
    for (let x = box.minX + s / 2; x <= box.maxX; x += s) {
      const p = { x, y };
      if (!pointInPolygon(p, ring)) continue;
      if (obstacles.some((o) => pointInPolygon(p, o))) continue;
      widths.push(localWidthM(p, ring));
    }
  }
  return widths;
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const i = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor((p / 100) * sortedAsc.length)),
  );
  return sortedAsc[i];
}

/** Fraction of irrigable samples whose local width is below threshold. */
export function narrowFraction(
  ring: PtM[],
  obstacles: PtM[][],
  widthThresholdM: number,
): { fraction: number; medianWidthM: number; p20WidthM: number } {
  const widths = sampleLocalWidths(ring, obstacles);
  if (widths.length === 0) {
    return { fraction: 0, medianWidthM: 0, p20WidthM: 0 };
  }
  const sorted = [...widths].sort((a, b) => a - b);
  const narrow = widths.filter((w) => w < widthThresholdM).length;
  return {
    fraction: narrow / widths.length,
    medianWidthM: percentile(sorted, 50),
    p20WidthM: percentile(sorted, 20),
  };
}
