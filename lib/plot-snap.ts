import type { DrawnZone, LngLat } from "@/lib/mapbox";

export type SnapKind = "close" | "vertex" | "parallel";

export type SnapGuide = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

export type SnapResult = {
  point: LngLat;
  screen: { x: number; y: number };
  kind: SnapKind;
  guide?: SnapGuide;
};

type ProjectFn = (p: LngLat) => { x: number; y: number };
type UnprojectFn = (x: number, y: number) => LngLat;

export function collectZoneVertices(zones: DrawnZone[]): LngLat[] {
  const out: LngLat[] = [];
  for (const z of zones) {
    for (const p of z.coordinates) out.push(p);
  }
  return out;
}

export function collectZoneEdges(
  zones: DrawnZone[],
): { a: LngLat; b: LngLat }[] {
  const edges: { a: LngLat; b: LngLat }[] = [];
  for (const z of zones) {
    const pts = z.coordinates;
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      edges.push({ a: pts[i], b: pts[i + 1] });
    }
    if (pts.length >= 3) {
      edges.push({ a: pts[pts.length - 1], b: pts[0] });
    }
  }
  return edges;
}

function distPx(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Resolve cursor snap while drawing a polygon:
 * 1) close to first draft point
 * 2) magnet to any saved (or prior draft) vertex
 * 3) parallel to a saved edge (from last draft point)
 */
export function resolveDrawSnap(opts: {
  cursor: LngLat;
  draft: LngLat[];
  zones: DrawnZone[];
  project: ProjectFn;
  unproject: UnprojectFn;
  closePx?: number;
  vertexPx?: number;
  parallelPx?: number;
}): SnapResult | null {
  const closePx = opts.closePx ?? 32;
  const vertexPx = opts.vertexPx ?? 28;
  const parallelPx = opts.parallelPx ?? 16;
  const curScr = opts.project(opts.cursor);

  // 1) Close polygon
  if (opts.draft.length >= 3) {
    const first = opts.draft[0];
    const firstScr = opts.project(first);
    if (distPx(curScr, firstScr) <= closePx) {
      return {
        point: first,
        screen: firstScr,
        kind: "close",
      };
    }
  }

  // 2) Vertex magnet — all saved zones + earlier draft corners
  const vertices = [
    ...collectZoneVertices(opts.zones),
    ...opts.draft.slice(0, -1),
  ];
  let bestVertex: SnapResult | null = null;
  let bestVDist = vertexPx;
  for (const v of vertices) {
    const scr = opts.project(v);
    const d = distPx(curScr, scr);
    if (d <= bestVDist) {
      bestVDist = d;
      bestVertex = {
        point: v,
        screen: scr,
        kind: "vertex",
      };
    }
  }
  if (bestVertex) return bestVertex;

  // 3) Parallel to saved edges (needs at least one draft point)
  if (opts.draft.length === 0) return null;
  const last = opts.draft[opts.draft.length - 1];
  const lastScr = opts.project(last);
  const edges = collectZoneEdges(opts.zones);
  // Also parallel to earlier draft edges
  for (let i = 0; i < opts.draft.length - 1; i++) {
    edges.push({ a: opts.draft[i], b: opts.draft[i + 1] });
  }

  let bestPar: SnapResult | null = null;
  let bestPDist = parallelPx;

  for (const edge of edges) {
    const ea = opts.project(edge.a);
    const eb = opts.project(edge.b);
    const dx = eb.x - ea.x;
    const dy = eb.y - ea.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) continue;
    const ux = dx / len;
    const uy = dy / len;

    const vx = curScr.x - lastScr.x;
    const vy = curScr.y - lastScr.y;
    const t = vx * ux + vy * uy;
    // Need meaningful length along the edge direction
    if (Math.abs(t) < 8) continue;

    const px = lastScr.x + t * ux;
    const py = lastScr.y + t * uy;
    const d = Math.hypot(curScr.x - px, curScr.y - py);
    if (d > bestPDist) continue;

    bestPDist = d;
    const point = opts.unproject(px, py);
    // Guide: extend past the snapped point for visual feedback
    const guideLen = Math.max(80, Math.abs(t) + 40);
    bestPar = {
      point,
      screen: { x: px, y: py },
      kind: "parallel",
      guide: {
        ax: lastScr.x - ux * 24,
        ay: lastScr.y - uy * 24,
        bx: lastScr.x + ux * guideLen * Math.sign(t || 1),
        by: lastScr.y + uy * guideLen * Math.sign(t || 1),
      },
    };
  }

  return bestPar;
}
