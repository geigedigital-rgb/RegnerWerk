import type { LngLat, PlotFixture } from "@/lib/mapbox";
import { CATALOG, isMp800Family } from "../catalog";
import { clearPath, dist, makeLocalProjection } from "./geometry";
import type {
  HydraulicZoneInfo,
  PipeRun,
  PtM,
  SprinklerHead,
} from "../types";

/** Hydraulic zone colors — bright on satellite. */
export const ZONE_COLORS = [
  "#00FFCF",
  "#FFB020",
  "#7C9CFF",
  "#FF7AB0",
  "#9BE860",
  "#4CD9E8",
  "#D9A0FF",
  "#FF9A62",
];

/** Plan/canvas drawing colors — brand-adjacent, readable on white. */
export const ZONE_COLORS_CANVAS = [
  "#0A9F86", // aqua-deep
  "#B86A00", // amber
  "#3D5A9E", // ink blue
  "#A84570", // rose
  "#4F8F2F", // leaf
  "#1F7A8C", // teal
  "#6B4C9A", // plum
  "#C45C2A", // rust
];

export function zoneColor(zone: number, canvas = false): string {
  const palette = canvas ? ZONE_COLORS_CANVAS : ZONE_COLORS;
  return palette[zone % palette.length];
}

export function sourceFlowLMin(fixtures: PlotFixture[]): {
  flowLMin: number;
  assumed: boolean;
} {
  const quelle = fixtures.find((f) => f.kind === "wasserquelle");
  const m3h = quelle?.wassermengeM3h;
  if (typeof m3h === "number" && m3h > 0) {
    return { flowLMin: (m3h * 1000) / 60, assumed: false };
  }
  return {
    flowLMin: (CATALOG.hydraulics.defaultSourceFlowM3h * 1000) / 60,
    assumed: true,
  };
}

type KindBucket = "spray" | "spray_mp800" | "rotor" | "strip";

function bucketOf(h: SprinklerHead): KindBucket {
  if (h.kind === "rotor") return "rotor";
  if (h.kind === "strip") return "strip";
  // MP800 / MP815 (~20 mm/h) must not share a zone with standard MP (~10 mm/h)
  if (isMp800Family(h.configKey)) return "spray_mp800";
  return "spray";
}

/**
 * Split heads into hydraulic zones so each zone's flow fits the source.
 * Never mixes spray / rotor / strip / MP800 precip family in one zone.
 * Within a kind, heads are ordered by angle around the Verteiler.
 */
export function assignHydraulicZones(
  heads: SprinklerHead[],
  verteiler: LngLat,
  capLMin: number,
): { heads: SprinklerHead[]; zoneCount: number; overflow: boolean } {
  if (heads.length === 0) return { heads, zoneCount: 0, overflow: false };
  const proj = makeLocalProjection(verteiler);
  const v: PtM = { x: 0, y: 0 };

  function angle(h: SprinklerHead): number {
    const p = proj.toM(h.position);
    return Math.atan2(p.y - v.y, p.x - v.x);
  }

  const buckets: KindBucket[] = ["spray", "spray_mp800", "strip", "rotor"];
  const ordered: SprinklerHead[] = [];
  for (const bucket of buckets) {
    const subset = heads.filter((h) => bucketOf(h) === bucket);
    if (subset.length === 0) continue;
    const byLawn = new Map<string, SprinklerHead[]>();
    for (const h of subset) {
      const arr = byLawn.get(h.lawnZoneId) ?? [];
      arr.push(h);
      byLawn.set(h.lawnZoneId, arr);
    }
    const groups = [...byLawn.values()].map((arr) =>
      [...arr].sort((a, b) => angle(a) - angle(b)),
    );
    groups.sort((a, b) => angle(a[0]) - angle(b[0]));
    ordered.push(...groups.flat());
  }

  let zone = 0;
  let zoneFlow = 0;
  let zoneBucket: KindBucket | null = null;
  let overflow = false;
  const out = ordered.map((h) => {
    const b = bucketOf(h);
    if (h.flowLMin > capLMin) overflow = true;
    const kindChanged = zoneBucket != null && zoneBucket !== b;
    if (
      kindChanged ||
      (zoneFlow + h.flowLMin > capLMin && zoneFlow > 0)
    ) {
      zone += 1;
      zoneFlow = 0;
    }
    zoneBucket = b;
    zoneFlow += h.flowLMin;
    return { ...h, hydraulicZone: zone };
  });

  return { heads: out, zoneCount: zone + 1, overflow };
}

/**
 * Route pipes as a branching tree (MST) from Verteiler to heads — shorter
 * than a snake tour and uses T-Stücke at junctions. Edges detour around
 * Gebäude; emits one lateral segment per tree edge.
 */
export function routePipes(
  heads: SprinklerHead[],
  verteiler: LngLat,
  quelle: LngLat | null,
  obstacleZones: { coordinates: LngLat[] }[] = [],
): { pipes: PipeRun[]; headsWithLineEnd: SprinklerHead[]; warnings: string[] } {
  const proj = makeLocalProjection(verteiler);
  const pipes: PipeRun[] = [];
  const warnings: string[] = [];
  const obstacles = obstacleZones
    .map((z) => z.coordinates.map((c) => proj.toM(c)))
    .filter((r) => r.length >= 3);

  const zones = [...new Set(heads.map((h) => h.hydraulicZone))].sort(
    (a, b) => a - b,
  );

  /** headId → number of tree edges */
  const degree = new Map<string, number>();

  for (const z of zones) {
    const zoneHeads = heads.filter((h) => h.hydraulicZone === z);
    if (zoneHeads.length === 0) continue;

    type Node = { id: string; pt: PtM; head?: SprinklerHead };
    const nodes: Node[] = [
      { id: "__verteiler__", pt: { x: 0, y: 0 } },
      ...zoneHeads.map((h) => ({
        id: h.id,
        pt: proj.toM(h.position),
        head: h,
      })),
    ];
    const n = nodes.length;

    // Precompute clear-path costs between all pairs
    const edgePath: PtM[][][] = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => []),
    );
    const edgeCost: number[][] = Array.from({ length: n }, () =>
      Array(n).fill(Infinity),
    );
    let blockedPairs = 0;
    for (let i = 0; i < n; i++) {
      edgeCost[i][i] = 0;
      for (let j = i + 1; j < n; j++) {
        const { path, clear } = clearPath(
          nodes[i].pt,
          nodes[j].pt,
          obstacles,
        );
        if (!clear) blockedPairs += 1;
        let len = 0;
        for (let k = 1; k < path.length; k++) {
          len += dist(path[k - 1], path[k]);
        }
        // Heavy penalty if still not clear (straight through building)
        const cost = clear ? len : len + 500;
        edgeCost[i][j] = cost;
        edgeCost[j][i] = cost;
        edgePath[i][j] = path;
        edgePath[j][i] = [...path].reverse();
      }
    }
    if (blockedPairs > 0) {
      warnings.push(
        `Zone ${z + 1}: einige Leitungswege um Gebäude umgeleitet — bitte manuell prüfen.`,
      );
    }

    // Prim MST rooted at Verteiler (index 0)
    const inTree = Array(n).fill(false);
    const parent = Array(n).fill(-1);
    const best = Array(n).fill(Infinity);
    best[0] = 0;
    for (let iter = 0; iter < n; iter++) {
      let u = -1;
      for (let i = 0; i < n; i++) {
        if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
      }
      if (u < 0 || best[u] >= Infinity) break;
      inTree[u] = true;
      for (let v = 0; v < n; v++) {
        if (!inTree[v] && edgeCost[u][v] < best[v]) {
          best[v] = edgeCost[u][v];
          parent[v] = u;
        }
      }
    }

    let seg = 0;
    for (let v = 1; v < n; v++) {
      const u = parent[v];
      if (u < 0) continue;
      const path = edgePath[u][v];
      if (path.length < 2) continue;
      let lengthM = 0;
      for (let k = 1; k < path.length; k++) {
        lengthM += dist(path[k - 1], path[k]);
      }
      pipes.push({
        id: `pipe-zone-${z}-${seg++}`,
        kind: "lateral",
        hydraulicZone: z,
        points: path.map((p) => proj.toLngLat(p)),
        lengthM: Number(lengthM.toFixed(1)),
      });
      // Degree only for head endpoints (not waypoints)
      for (const idx of [u, v]) {
        const id = nodes[idx].id;
        if (id === "__verteiler__") continue;
        degree.set(id, (degree.get(id) ?? 0) + 1);
      }
    }
  }

  const updated = heads.map((h) => ({
    ...h,
    // Leaf of tree → elbow; branch point → tee
    lineEnd: (degree.get(h.id) ?? 0) <= 1,
  }));

  if (quelle) {
    const q = proj.toM(quelle);
    const { path, clear } = clearPath(q, { x: 0, y: 0 }, obstacles);
    if (!clear) {
      warnings.push(
        "Hauptleitung Quelle→Verteiler kreuzt ggf. ein Gebäude — Trasse prüfen.",
      );
    }
    let lengthM = 0;
    for (let k = 1; k < path.length; k++) {
      lengthM += dist(path[k - 1], path[k]);
    }
    pipes.push({
      id: "pipe-main",
      kind: "main",
      hydraulicZone: null,
      points: path.map((p) => proj.toLngLat(p)),
      lengthM: Number(lengthM.toFixed(1)),
    });
  }

  return { pipes, headsWithLineEnd: updated, warnings };
}

export function buildZoneInfos(
  heads: SprinklerHead[],
  pipes: PipeRun[],
): HydraulicZoneInfo[] {
  const zones = [...new Set(heads.map((h) => h.hydraulicZone))].sort(
    (a, b) => a - b,
  );
  return zones.map((z) => {
    const zoneHeads = heads.filter((h) => h.hydraulicZone === z);
    const zonePipes = pipes.filter(
      (p) => p.kind === "lateral" && p.hydraulicZone === z,
    );
    const pipeLengthM = zonePipes.reduce((s, p) => s + p.lengthM, 0);
    return {
      index: z,
      headIds: zoneHeads.map((h) => h.id),
      flowLMin: Number(
        zoneHeads.reduce((s, h) => s + h.flowLMin, 0).toFixed(1),
      ),
      pipeLengthM: Number(pipeLengthM.toFixed(1)),
      color: ZONE_COLORS[z % ZONE_COLORS.length],
    };
  });
}

/**
 * Hazen–Williams head loss (bar) for PE pipe.
 * hf (m) = 10.67 * L * Q^1.852 / (C^1.852 * D^4.87)
 * with Q in m³/s, D in m, L in m; convert meters of water to bar (/10.2).
 */
export function hazenWilliamsLossBar(params: {
  lengthM: number;
  flowLMin: number;
  internalDiameterMm: number;
  c?: number;
}): number {
  const { lengthM, flowLMin, internalDiameterMm } = params;
  const c = params.c ?? CATALOG.hydraulics.hazenWilliamsC;
  if (lengthM <= 0 || flowLMin <= 0) return 0;
  const Q = flowLMin / 1000 / 60; // m³/s
  const D = internalDiameterMm / 1000;
  const hfM =
    (10.67 * lengthM * Math.pow(Q, 1.852)) /
    (Math.pow(c, 1.852) * Math.pow(D, 4.87));
  return hfM / 10.2;
}

/**
 * Check residual pressure at the far end of each zone lateral.
 * Returns German warning strings when below recommended head pressure.
 */
export function pressureWarnings(
  heads: SprinklerHead[],
  pipes: PipeRun[],
): string[] {
  const warnings: string[] = [];
  const p0 = CATALOG.hydraulics.assumedVerteilerPressureBar;
  const pMin = CATALOG.hydraulics.recommendedPressureBar;
  const idMm = CATALOG.hydraulics.pe25InternalDiameterMm;

  const zones = [...new Set(heads.map((h) => h.hydraulicZone))];
  for (const z of zones) {
    const zoneHeads = heads.filter((h) => h.hydraulicZone === z);
    const zonePipes = pipes.filter(
      (p) => p.kind === "lateral" && p.hydraulicZone === z,
    );
    if (zonePipes.length === 0 || zoneHeads.length === 0) continue;
    const lengthM = zonePipes.reduce((s, p) => s + p.lengthM, 0);
    const flow = zoneHeads.reduce((s, h) => s + h.flowLMin, 0);
    const loss = hazenWilliamsLossBar({
      lengthM,
      flowLMin: flow,
      internalDiameterMm: idMm,
    });
    const residual = p0 - loss;
    if (residual < pMin) {
      warnings.push(
        `Zone ${z + 1}: geschätzter Druck am letzten Regner ${residual.toFixed(1)} bar (Ziel ≥ ${pMin.toLocaleString("de-DE")} bar) — Leitung kürzen oder PE 32 prüfen.`,
      );
    }
  }
  return warnings;
}
