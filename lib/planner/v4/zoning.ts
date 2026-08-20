/**
 * Professional valve zoning for Sofort v4.
 * Improved spatial coherence, visual aesthetics, and obstacle-aware edges.
 */
import type { DrawnZone, LngLat } from "@/lib/mapbox";
import { CATALOG, isMp800Family } from "../catalog";
import { dist, makeLocalProjection, bbox, pointInPolygon, distToBoundary, segmentHitsObstacles } from "./geometry";
import { assignHydraulicZones } from "./hydraulics";
import type { PtM, SprinklerHead } from "../types";
import type { ZoneDecision } from "./types";

export type ManagementArea = {
  id: string;
  lawnZoneId: string;
  vegetationClass: "LAWN" | "BED" | "HEDGE";
  waterDemandClass: string;
  sunExposure: "SUN" | "PART_SHADE" | "SHADE" | "UNKNOWN";
  soilClass: string;
  slopeClass: string;
  establishmentClass: "NEW" | "ESTABLISHED" | "UNKNOWN";
  scheduleGroupId: string;
  assumptions: string[];
};

export type CompatibilityKey = string;

type HeadNode = {
  head: SprinklerHead;
  x: number;
  y: number;
  managementAreaId: string;
  scheduleGroupId: string;
  irrigationMethod: string;
  precipitationBucket: string;
  pressureClass: string;
  scheduleClass: string;
  compatibilityKey: CompatibilityKey;
  lawnComponentId: string;
};

type GraphEdge = {
  a: string;
  b: string;
  couplingScore: number;
};

const ORPHAN_FLOW_RATIO = 0.35;
const ORPHAN_HEAD_COUNT = 2;

export function buildManagementAreas(zones: DrawnZone[]): {
  areas: ManagementArea[];
  assumptions: string[];
} {
  const assumptions: string[] = [];
  const areas: ManagementArea[] = [];
  const lawns = zones.filter((z) => z.type === "rasen");
  const beds = zones.filter((z) => z.type === "beet");
  const hedges = zones.filter((z) => z.type === "hecke");

  if (lawns.length > 0) {
    assumptions.push(
      "ManagementArea: einheitliches Rasenprofil (Sonne/Boden unbekannt).",
    );
  }

  for (const lawn of lawns) {
    areas.push({
      id: `ma-${lawn.id}`,
      lawnZoneId: lawn.id,
      vegetationClass: "LAWN",
      waterDemandClass: "lawn-standard",
      sunExposure: "UNKNOWN",
      soilClass: "UNKNOWN",
      slopeClass: "UNKNOWN",
      establishmentClass: "UNKNOWN",
      scheduleGroupId: "SG-LAWN",
      assumptions: ["sun/soil not provided — default lawn schedule"],
    });
  }
  for (const bed of beds) {
    areas.push({
      id: `ma-${bed.id}`,
      lawnZoneId: bed.id,
      vegetationClass: "BED",
      waterDemandClass: "bed",
      sunExposure: "UNKNOWN",
      soilClass: "UNKNOWN",
      slopeClass: "UNKNOWN",
      establishmentClass: "UNKNOWN",
      scheduleGroupId: "SG-BED",
      assumptions: [],
    });
  }
  for (const hedge of hedges) {
    areas.push({
      id: `ma-${hedge.id}`,
      lawnZoneId: hedge.id,
      vegetationClass: "HEDGE",
      waterDemandClass: "hedge",
      sunExposure: "UNKNOWN",
      soilClass: "UNKNOWN",
      slopeClass: "UNKNOWN",
      establishmentClass: "UNKNOWN",
      scheduleGroupId: "SG-HEDGE",
      assumptions: [],
    });
  }
  return { areas, assumptions };
}

function irrigationMethodOf(h: SprinklerHead): string {
  if (h.kind === "rotor") return "rotor";
  if (h.kind === "strip") return "strip";
  if (isMp800Family(h.configKey)) return "spray_mp800";
  return "spray";
}

function precipitationBucketOf(h: SprinklerHead): string {
  if (isMp800Family(h.configKey)) return "mp800-high";
  if (h.kind === "strip") return "strip";
  if (h.kind === "rotor") return "rotor";
  return "matched-rotator";
}

function pressureClassOf(_h: SprinklerHead): string {
  return "prs40";
}

function scheduleClassOf(area: ManagementArea | undefined): string {
  return area?.waterDemandClass ?? "lawn-standard";
}

function compatibilityKeyOf(node: {
  irrigationMethod: string;
  precipitationBucket: string;
  pressureClass: string;
  scheduleClass: string;
  /** Separate drawn Rasen polygons never share a valve (product rule). */
  lawnComponentId: string;
}): CompatibilityKey {
  return [
    node.irrigationMethod,
    node.precipitationBucket,
    node.pressureClass,
    node.scheduleClass,
    node.lawnComponentId,
  ].join("|");
}

function primaryReasonForKey(
  key: CompatibilityKey,
): ZoneDecision["primaryReason"] {
  const [method, precip] = key.split("|");
  if (precip === "mp800-high" || precip === "strip") return "PRECIPITATION_CLASS";
  if (method === "rotor" || method === "strip" || method === "spray_mp800") {
    return "IRRIGATION_METHOD";
  }
  return "SOURCE_FLOW";
}

/** Hydraulics-only key without lawn id — for comparing equipment compatibility. */
function hydraulicCompatPrefix(key: CompatibilityKey): string {
  const parts = key.split("|");
  return parts.slice(0, 4).join("|");
}

export function buildHeadCompatibilityGroups(
  heads: SprinklerHead[],
  areas: ManagementArea[],
  origin: LngLat,
): Map<CompatibilityKey, HeadNode[]> {
  const areaByLawn = new Map(areas.map((a) => [a.lawnZoneId, a]));
  const proj = makeLocalProjection(origin);
  const groups = new Map<CompatibilityKey, HeadNode[]>();

  const sorted = [...heads].sort((a, b) => a.id.localeCompare(b.id));
  for (const head of sorted) {
    const area = areaByLawn.get(head.lawnZoneId);
    const pt = proj.toM(head.position);
    const lawnComponentId = head.lawnZoneId;
    const partial = {
      irrigationMethod: irrigationMethodOf(head),
      precipitationBucket: precipitationBucketOf(head),
      pressureClass: pressureClassOf(head),
      scheduleClass: scheduleClassOf(area),
      lawnComponentId,
    };
    const key = compatibilityKeyOf(partial);
    const node: HeadNode = {
      head,
      x: pt.x,
      y: pt.y,
      managementAreaId: area?.id ?? `ma-${head.lawnZoneId}`,
      scheduleGroupId: area?.scheduleGroupId ?? "SG-LAWN",
      irrigationMethod: partial.irrigationMethod,
      precipitationBucket: partial.precipitationBucket,
      pressureClass: partial.pressureClass,
      scheduleClass: partial.scheduleClass,
      compatibilityKey: key,
      lawnComponentId,
    };
    const arr = groups.get(key) ?? [];
    arr.push(node);
    groups.set(key, arr);
  }
  return groups;
}

/**
 * Obstacle-aware adjacency graph: neighbors within max(R_i, R_j) * 1.5,
 * but only if the line between them does not cross an obstacle (Gebaeude/Weg).
 * If the graph has disconnected components, cross-component minimum-distance
 * edges are added (only obstacle-free ones) so partition algorithms have a connected graph.
 */
export function buildHeadAdjacencyGraph(
  nodes: HeadNode[],
  obstacleRingsM: PtM[][] = [],
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const ptA = { x: a.x, y: a.y };
      const ptB = { x: b.x, y: b.y };
      const d = dist(ptA, ptB);
      const maxR = Math.max(a.head.radiusM, b.head.radiusM);
      // Keep adjacency local — long H2H radii must not glue opposite lawn ends
      // into one "connected" zone (classic torn orange valve).
      const maxHop = Math.min(Math.max(maxR * 1.2, 4.5), 8.5);
      if (d > maxHop) continue;
      // Do not connect heads whose line crosses an obstacle
      if (obstacleRingsM.length > 0 && segmentHitsObstacles(ptA, ptB, obstacleRingsM)) continue;
      const sameLawn = a.lawnComponentId === b.lawnComponentId ? 1 : 0.35;
      const h2h = maxR > 0 ? Math.max(0, 1 - d / maxR) : 0;
      const couplingScore = sameLawn * (0.4 + 0.6 * h2h);
      edges.push({ a: a.head.id, b: b.head.id, couplingScore });
    }
  }

  // Ensure graph connectivity: find components and bridge them (obstacle-free only)
  if (nodes.length > 1) {
    const comps = graphComponents(nodes, edges);
    if (comps.length > 1) {
      for (let ci = 0; ci < comps.length; ci++) {
        for (let cj = ci + 1; cj < comps.length; cj++) {
          let bestD = Infinity;
          let bestA = "";
          let bestB = "";
          for (const na of comps[ci]) {
            for (const nb of comps[cj]) {
              const ptA = { x: na.x, y: na.y };
              const ptB = { x: nb.x, y: nb.y };
              if (obstacleRingsM.length > 0 && segmentHitsObstacles(ptA, ptB, obstacleRingsM)) continue;
              const d = dist(ptA, ptB);
              if (d < bestD) {
                bestD = d;
                bestA = na.head.id;
                bestB = nb.head.id;
              }
            }
          }
          if (bestA && bestB) {
            const maxR = Math.max(
              nodes.find((n) => n.head.id === bestA)!.head.radiusM,
              nodes.find((n) => n.head.id === bestB)!.head.radiusM,
            );
            const h2h = maxR > 0 ? Math.max(0, 1 - bestD / (maxR * 2)) : 0;
            edges.push({ a: bestA, b: bestB, couplingScore: 0.15 * h2h + 0.05 });
          }
        }
      }
    }
  }

  return edges;
}

/** BFS-based connected components of the head adjacency graph. */
function graphComponents(nodes: HeadNode[], edges: GraphEdge[]): HeadNode[][] {
  const nodeIds = new Set(nodes.map((n) => n.head.id));
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.head.id, []);
  for (const e of edges) {
    // Only consider edges where both endpoints are in the node set
    if (nodeIds.has(e.a) && nodeIds.has(e.b)) {
      adj.get(e.a)!.push(e.b);
      adj.get(e.b)!.push(e.a);
    }
  }
  const visited = new Set<string>();
  const comps: HeadNode[][] = [];
  const byId = new Map(nodes.map((n) => [n.head.id, n]));
  for (const n of nodes) {
    if (visited.has(n.head.id)) continue;
    const comp: HeadNode[] = [];
    const queue = [n.head.id];
    visited.add(n.head.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = byId.get(id);
      if (node) comp.push(node);
      for (const nb of adj.get(id) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    if (comp.length > 0) comps.push(comp);
  }
  return comps;
}

/**
 * Check if removing nodeId disconnects the subgraph of ids in `zoneIds`.
 * Returns true if removal keeps the zone connected (safe to move).
 */
function isArticulationSafe(
  nodeId: string,
  zoneIds: Set<string>,
  edges: GraphEdge[],
): boolean {
  if (zoneIds.size <= 2) return true;
  const remaining = new Set(zoneIds);
  remaining.delete(nodeId);
  const adj = new Map<string, string[]>();
  for (const id of remaining) adj.set(id, []);
  for (const e of edges) {
    if (remaining.has(e.a) && remaining.has(e.b)) {
      adj.get(e.a)!.push(e.b);
      adj.get(e.b)!.push(e.a);
    }
  }
  const start = remaining.values().next().value!;
  const visited = new Set<string>();
  const queue = [start];
  visited.add(start);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const nb of adj.get(id) ?? []) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  return visited.size === remaining.size;
}

/**
 * Repair disconnected zones after partition: reassign smaller disconnected
 * fragments to the nearest connected zone by coupling score.
 * If the target is full, swap out a peripheral head to free capacity.
 */
function repairConnectivity(
  zones: HeadNode[][],
  edges: GraphEdge[],
  zoneOf: Map<string, number>,
  zoneFlow: number[],
  capLpm: number,
): void {
  for (let z = 0; z < zones.length; z++) {
    if (zones[z].length <= 1) continue;
    const strongEdges = edges.filter((e) => e.couplingScore >= 0.22);
    const comps = graphComponents(zones[z], strongEdges);
    if (comps.length <= 1) continue;
    comps.sort((a, b) => b.length - a.length);
    for (let ci = 1; ci < comps.length; ci++) {
      const fragment = comps[ci];
      for (const node of fragment) {
        if (!node?.head) continue;
        let bestZone = -1;
        let bestCoup = -1;
        for (let tz = 0; tz < zones.length; tz++) {
          if (tz === z) continue;
          const neigh = strongNeighborsOf(node.head.id, edges);
          let coup = 0;
          for (const nb of neigh) {
            if (zoneOf.get(nb) === tz) {
              const e = edges.find(
                (ed) =>
                  (ed.a === node.head.id && ed.b === nb) ||
                  (ed.b === node.head.id && ed.a === nb),
              );
              coup += e?.couplingScore ?? 0;
            }
          }
          if (coup <= 0) {
            // Euclidean fallback to nearest zone centroid
            const c = zoneCentroid(zones[tz]);
            const d = dist({ x: node.x, y: node.y }, c);
            coup = 0.01 / Math.max(d, 0.5);
          }
          if (coup > bestCoup) {
            bestCoup = coup;
            bestZone = tz;
          }
        }
        if (bestZone < 0) continue;

        const need = node.head.flowLMin;
        if (zoneFlow[bestZone] + need > capLpm + 1e-6) {
          // Free capacity: move the head in bestZone farthest from its centroid
          // (and preferably near zone z) into zone z if that fits.
          const cT = zoneCentroid(zones[bestZone]);
          let victim: HeadNode | null = null;
          let bestScore = -Infinity;
          for (const cand of zones[bestZone]) {
            if (zoneFlow[z] + cand.head.flowLMin > capLpm + 1e-6) continue;
            const dOwn = dist({ x: cand.x, y: cand.y }, cT);
            const dFrag = dist({ x: cand.x, y: cand.y }, { x: node.x, y: node.y });
            const score = dOwn - 0.3 * dFrag;
            if (score > bestScore) {
              bestScore = score;
              victim = cand;
            }
          }
          if (!victim) continue;
          zoneOf.set(victim.head.id, z);
          zoneFlow[bestZone] -= victim.head.flowLMin;
          zoneFlow[z] += victim.head.flowLMin;
          zones[bestZone] = zones[bestZone].filter((n) => n.head.id !== victim!.head.id);
          zones[z].push(victim);
        }

        if (zoneFlow[bestZone] + need > capLpm + 1e-6) continue;
        zoneOf.set(node.head.id, bestZone);
        zoneFlow[z] -= need;
        zoneFlow[bestZone] += need;
        zones[z] = zones[z].filter((n) => n.head.id !== node.head.id);
        zones[bestZone].push(node);
      }
    }
  }
}

/**
 * Move heads that sit closer to another zone's centroid into that zone when flow allows.
 */
function compactOutliers(
  zones: HeadNode[][],
  edges: GraphEdge[],
  zoneOf: Map<string, number>,
  zoneFlow: number[],
  capLpm: number,
  byId: Map<string, HeadNode>,
): void {
  function meanDistToMates(n: HeadNode, zone: HeadNode[]): number {
    const mates = zone.filter((h) => h.head.id !== n.head.id);
    if (mates.length === 0) return 0;
    return (
      mates.reduce(
        (s, h) => s + dist({ x: n.x, y: n.y }, { x: h.x, y: h.y }),
        0,
      ) / mates.length
    );
  }

  for (let pass = 0; pass < 5; pass++) {
    let moved = false;
    const centroids = zones.map((z) => zoneCentroid(z));
    for (const [id, z] of [...zoneOf.entries()]) {
      const n = byId.get(id);
      if (!n || zones[z].length <= 1) continue;
      const dOwnMean = meanDistToMates(n, zones[z]);
      const dOwnC = dist({ x: n.x, y: n.y }, centroids[z]);

      let bestTz = -1;
      let bestScore = 0;
      for (let tz = 0; tz < zones.length; tz++) {
        if (tz === z) continue;
        if (zoneFlow[tz] + n.head.flowLMin > capLpm + 1e-6) continue;
        const dOtherMean = meanDistToMates(n, zones[tz]);
        const dOtherC = dist({ x: n.x, y: n.y }, centroids[tz]);
        // Clear win: much closer to other zone's heads / centroid
        const gainMean = dOwnMean - dOtherMean;
        const gainC = dOwnC - dOtherC;
        const score = gainMean * 1.2 + gainC;
        if (score > 4 && score > bestScore) {
          bestScore = score;
          bestTz = tz;
        }
      }
      if (bestTz < 0) continue;

      const neigh = strongNeighborsOf(id, edges);
      const adjacent = neigh.some((nb) => zoneOf.get(nb) === bestTz);
      // Allow non-adjacent jump only for severe outliers (far from own mates)
      if (!adjacent && dOwnMean < 12) continue;

      const remainIds = new Set(
        [...zoneOf.entries()].filter(([, zz]) => zz === z).map(([hid]) => hid),
      );
      if (!isArticulationSafe(id, remainIds, edges)) continue;

      zoneOf.set(id, bestTz);
      zoneFlow[z] -= n.head.flowLMin;
      zoneFlow[bestTz] += n.head.flowLMin;
      zones[z] = zones[z].filter((h) => h.head.id !== id);
      zones[bestTz].push(n);
      moved = true;
    }
    if (!moved) break;
  }
}

function couplingBetween(
  edges: GraphEdge[],
  setA: Set<string>,
  setB: Set<string>,
): number {
  let s = 0;
  for (const e of edges) {
    const ab = setA.has(e.a) && setB.has(e.b);
    const ba = setA.has(e.b) && setB.has(e.a);
    if (ab || ba) s += e.couplingScore;
  }
  return s;
}

/** k-medoids style seeds by Euclidean meters (deterministic). */
function pickSeeds(nodes: HeadNode[], k: number): HeadNode[] {
  if (k <= 1 || nodes.length === 0) return nodes.slice(0, 1);
  const ordered = [...nodes].sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
    return a.head.id.localeCompare(b.head.id);
  });
  const seeds: HeadNode[] = [ordered[0]];
  while (seeds.length < k && seeds.length < ordered.length) {
    let best: HeadNode | null = null;
    let bestDist = -1;
    for (const n of ordered) {
      if (seeds.some((s) => s.head.id === n.head.id)) continue;
      let minD = Infinity;
      for (const s of seeds) {
        const d = dist({ x: n.x, y: n.y }, { x: s.x, y: s.y });
        if (d < minD) minD = d;
      }
      if (minD > bestDist) {
        bestDist = minD;
        best = n;
      }
    }
    if (!best) break;
    seeds.push(best);
  }
  return seeds;
}

/**
 * Bottleneck-aware seeding: detect narrow corridor in the lawn polygon and
 * place seeds on opposite sides of it. Falls back to farthest-first pickSeeds.
 *
 * Strategy: compute local width (2× distance-to-boundary) at each head position.
 * If a narrow isthmus exists (some heads have width < median × 0.5), find the
 * narrowest head and seed on the two farthest heads on either side of it.
 */
function pickSeedsBottleneck(
  nodes: HeadNode[],
  k: number,
  lawnRingM: PtM[] | null,
): HeadNode[] {
  if (k !== 2 || !lawnRingM || lawnRingM.length < 3 || nodes.length < 4) {
    return pickSeeds(nodes, k);
  }

  // Compute local width at each head position
  const widths = nodes.map((n) => {
    const pt = { x: n.x, y: n.y };
    if (!pointInPolygon(pt, lawnRingM)) return Infinity;
    return 2 * distToBoundary(pt, lawnRingM);
  });

  const finiteWidths = widths.filter((w) => Number.isFinite(w));
  if (finiteWidths.length < 3) return pickSeeds(nodes, k);

  const sorted = [...finiteWidths].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = median * 0.5;

  // Find the narrowest head
  let narrowIdx = -1;
  let narrowWidth = Infinity;
  for (let i = 0; i < widths.length; i++) {
    if (widths[i] < narrowWidth) {
      narrowWidth = widths[i];
      narrowIdx = i;
    }
  }

  // Only use bottleneck seeding if there's a genuine narrow corridor
  if (narrowIdx < 0 || narrowWidth >= threshold || narrowWidth >= median * 0.8) {
    return pickSeeds(nodes, k);
  }

  const narrowPt = { x: nodes[narrowIdx].x, y: nodes[narrowIdx].y };

  // Find the two farthest heads on opposite sides of the bottleneck
  // Use perpendicular to the local boundary to define "sides"
  let seedA: HeadNode | null = null;
  let seedB: HeadNode | null = null;
  let bestDA = -1;
  let bestDB = -1;

  // Classify heads as left/right of the narrowest point using x-y projection
  // relative to the narrowest head's local gradient direction
  const dists = nodes.map((n) => dist({ x: n.x, y: n.y }, narrowPt));
  for (let i = 0; i < nodes.length; i++) {
    if (i === narrowIdx) continue;
    const dx = nodes[i].x - narrowPt.x;
    const dy = nodes[i].y - narrowPt.y;
    // Use principal axis: classify by sign of projection onto longest span
    const bbx = bbox(lawnRingM);
    const useX = bbx.w >= bbx.h;
    const side = useX ? dx : dy;
    if (side >= 0 && dists[i] > bestDA) {
      bestDA = dists[i];
      seedA = nodes[i];
    } else if (side < 0 && dists[i] > bestDB) {
      bestDB = dists[i];
      seedB = nodes[i];
    }
  }

  if (seedA && seedB) return [seedA, seedB];
  return pickSeeds(nodes, k);
}

function neighborsOf(id: string, edges: GraphEdge[]): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (e.a === id) out.push(e.b);
    else if (e.b === id) out.push(e.a);
  }
  return out;
}

/** Strong neighbors only (ignore weak bridge edges used for global connectivity). */
function strongNeighborsOf(id: string, edges: GraphEdge[], minCoup = 0.22): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (e.couplingScore < minCoup) continue;
    if (e.a === id) out.push(e.b);
    else if (e.b === id) out.push(e.a);
  }
  return out;
}

function zoneCentroid(nodes: HeadNode[]): PtM {
  if (nodes.length === 0) return { x: 0, y: 0 };
  return {
    x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
    y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
  };
}

/**
 * Contiguous bands along the lawn's long axis — prevents torn valve zones
 * that skip across the plot just to balance litres.
 */
function contiguousAxisPartition(
  nodes: HeadNode[],
  k: number,
  capLpm: number,
): HeadNode[][] | null {
  return contiguousOrderedPartition(
    nodes,
    k,
    capLpm,
    [...nodes].sort((a, b) => {
      const xs = nodes.map((n) => n.x);
      const ys = nodes.map((n) => n.y);
      const spanX = Math.max(...xs) - Math.min(...xs);
      const spanY = Math.max(...ys) - Math.min(...ys);
      const useX = spanX >= spanY;
      const d = useX ? a.x - b.x : a.y - b.y;
      if (Math.abs(d) > 0.05) return d;
      const d2 = useX ? a.y - b.y : a.x - b.x;
      if (Math.abs(d2) > 0.05) return d2;
      return a.head.id.localeCompare(b.head.id);
    }),
  );
}

/**
 * Pie-slice zones around the Verteiler (local origin). Best when the box sits
 * in a corner — groups SW / SE / N into separate valves without crossing.
 */
function contiguousAngularPartition(
  nodes: HeadNode[],
  k: number,
  capLpm: number,
): HeadNode[][] | null {
  const withAng = nodes.map((n) => ({
    n,
    ang: Math.atan2(n.y, n.x),
  }));
  withAng.sort((a, b) => a.ang - b.ang || a.n.head.id.localeCompare(b.n.head.id));
  // Rotate start so the largest angular gap is the wrap cut
  let maxGap = -1;
  let start = 0;
  for (let i = 0; i < withAng.length; i++) {
    const a = withAng[i].ang;
    const b = withAng[(i + 1) % withAng.length].ang;
    const gap = i + 1 < withAng.length ? b - a : b + Math.PI * 2 - a;
    if (gap > maxGap) {
      maxGap = gap;
      start = (i + 1) % withAng.length;
    }
  }
  const ordered = [
    ...withAng.slice(start).map((x) => x.n),
    ...withAng.slice(0, start).map((x) => x.n),
  ];
  return contiguousOrderedPartition(nodes, k, capLpm, ordered);
}

function contiguousOrderedPartition(
  _nodes: HeadNode[],
  k: number,
  capLpm: number,
  ordered: HeadNode[],
): HeadNode[][] | null {
  if (ordered.length === 0) return [];
  if (k <= 1) return [ordered];
  if (k > ordered.length) return null;

  const totalFlow = ordered.reduce((s, n) => s + n.head.flowLMin, 0);
  const target = totalFlow / k;
  const parts: HeadNode[][] = [];
  let i = 0;

  for (let z = 0; z < k; z++) {
    const part: HeadNode[] = [];
    let flow = 0;
    const zonesLeft = k - z;
    while (i < ordered.length) {
      const headsLeftAfter = ordered.length - i - 1;
      const zonesAfter = zonesLeft - 1;
      if (part.length > 0 && headsLeftAfter < zonesAfter) break;

      const next = ordered[i];
      if (part.length > 0 && flow + next.head.flowLMin > capLpm + 1e-6) break;

      if (
        z < k - 1 &&
        part.length > 0 &&
        flow >= target * 0.82 &&
        flow + next.head.flowLMin > target * 1.18
      ) {
        break;
      }

      part.push(next);
      flow += next.head.flowLMin;
      i += 1;

      if (
        z < k - 1 &&
        flow >= target * 0.95 &&
        ordered.length - i >= zonesAfter &&
        i < ordered.length &&
        flow + ordered[i].head.flowLMin > target * 1.2
      ) {
        break;
      }
    }
    if (part.length === 0) return null;
    parts.push(part);
  }

  if (i < ordered.length) {
    for (; i < ordered.length; i++) {
      const last = parts[parts.length - 1];
      const f = last.reduce((s, n) => s + n.head.flowLMin, 0);
      if (f + ordered[i].head.flowLMin > capLpm + 1e-6) return null;
      last.push(ordered[i]);
    }
  }

  return parts;
}

/**
 * Recursively cut the lawn into compact spatial halves, then pack each half
 * into the needed number of valves. Avoids middle-strip zones that span
 * top+bottom of a wide plot.
 */
function recursiveSpatialPartition(
  nodes: HeadNode[],
  k: number,
  capLpm: number,
): HeadNode[][] | null {
  if (nodes.length === 0) return [];
  if (k <= 1) {
    const f = nodes.reduce((s, n) => s + n.head.flowLMin, 0);
    return f <= capLpm + 1e-6 ? [nodes] : null;
  }
  if (k > nodes.length) return null;

  if (k === 2 || nodes.length < 6) {
    return (
      contiguousAngularPartition(nodes, k, capLpm) ??
      contiguousAxisPartition(nodes, k, capLpm) ??
      spatialClusterPartition(nodes, k, capLpm)
    );
  }

  const tryAxis = (useX: boolean): HeadNode[][] | null => {
    const ordered = [...nodes].sort((a, b) => {
      const d = useX ? a.x - b.x : a.y - b.y;
      if (Math.abs(d) > 0.05) return d;
      const d2 = useX ? a.y - b.y : a.x - b.x;
      if (Math.abs(d2) > 0.05) return d2;
      return a.head.id.localeCompare(b.head.id);
    });
    const total = ordered.reduce((s, n) => s + n.head.flowLMin, 0);
    let bestCut = -1;
    let bestScore = Infinity;
    for (let cut = 1; cut < ordered.length; cut++) {
      const left = ordered.slice(0, cut);
      const right = ordered.slice(cut);
      const fL = left.reduce((s, n) => s + n.head.flowLMin, 0);
      const fR = right.reduce((s, n) => s + n.head.flowLMin, 0);
      const kL = Math.max(
        1,
        Math.min(k - 1, Math.round((k * fL) / total) || 1),
      );
      const kR = k - kL;
      if (kR < 1 || left.length < kL || right.length < kR) continue;
      if (fL / kL > capLpm * 1.05 || fR / kR > capLpm * 1.05) continue;
      const balance = Math.abs(fL / kL - fR / kR);
      // Prefer cuts that separate distant heads (large gap at cut)
      const gap = useX
        ? ordered[cut].x - ordered[cut - 1].x
        : ordered[cut].y - ordered[cut - 1].y;
      const sc = balance - gap * 0.15;
      if (sc < bestScore) {
        bestScore = sc;
        bestCut = cut;
      }
    }
    if (bestCut < 0) return null;

    const left = ordered.slice(0, bestCut);
    const right = ordered.slice(bestCut);
    const fL = left.reduce((s, n) => s + n.head.flowLMin, 0);
    let kL = Math.max(1, Math.min(k - 1, Math.round((k * fL) / total) || 1));
    let kR = k - kL;
    while (kL > 1 && left.length < kL) {
      kL -= 1;
      kR += 1;
    }
    while (kR > 1 && right.length < kR) {
      kR -= 1;
      kL += 1;
    }
    if (left.length < kL || right.length < kR) return null;

    const leftParts = recursiveSpatialPartition(left, kL, capLpm);
    const rightParts = recursiveSpatialPartition(right, kR, capLpm);
    if (!leftParts || !rightParts) return null;
    return [...leftParts, ...rightParts];
  };

  const byX = tryAxis(true);
  const byY = tryAxis(false);
  const opts = [byX, byY].filter((p): p is HeadNode[][] => !!p);
  if (opts.length === 0) {
    return (
      contiguousAngularPartition(nodes, k, capLpm) ??
      contiguousAxisPartition(nodes, k, capLpm)
    );
  }
  opts.sort((a, b) => {
    const wa = Math.max(...a.map((z) => meanPairDistance(z)));
    const wb = Math.max(...b.map((z) => meanPairDistance(z)));
    return wa - wb;
  });
  return opts[0];
}

/**
 * Nearest-seed spatial clusters, then repair capacity by moving geographic outliers.
 * Best for wide open lawns where axis bands still mix top+bottom of a strip.
 */
function spatialClusterPartition(
  nodes: HeadNode[],
  k: number,
  capLpm: number,
): HeadNode[][] | null {
  if (nodes.length === 0) return [];
  if (k <= 1) return [nodes];
  if (k > nodes.length) return null;

  const seeds = pickSeeds(nodes, k);
  const zoneOf = new Map<string, number>();
  for (const n of nodes) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < seeds.length; i++) {
      const d = dist({ x: n.x, y: n.y }, { x: seeds[i].x, y: seeds[i].y });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    zoneOf.set(n.head.id, best);
  }

  const rebuild = (): HeadNode[][] => {
    const z: HeadNode[][] = Array.from({ length: k }, () => []);
    for (const n of nodes) z[zoneOf.get(n.head.id)!].push(n);
    return z;
  };

  let zones = rebuild();
  // Capacity repair: move head closest to an under-cap zone into that zone
  for (let iter = 0; iter < nodes.length * 4; iter++) {
    let heavy = -1;
    let heavyFlow = -1;
    for (let z = 0; z < k; z++) {
      const f = zones[z].reduce((s, n) => s + n.head.flowLMin, 0);
      if (f > capLpm + 1e-6 && f > heavyFlow) {
        heavyFlow = f;
        heavy = z;
      }
    }
    if (heavy < 0) break;

    const lightZones: number[] = [];
    for (let z = 0; z < k; z++) {
      if (z === heavy) continue;
      const f = zones[z].reduce((s, n) => s + n.head.flowLMin, 0);
      if (f < capLpm - 0.5) lightZones.push(z);
    }
    if (lightZones.length === 0) return null;

    let victim: HeadNode | null = null;
    let bestTz = -1;
    let bestScore = Infinity;
    const cH = zoneCentroid(zones[heavy]);
    for (const n of zones[heavy]) {
      if (zones[heavy].length <= 1) continue;
      for (const tz of lightZones) {
        const f = zones[tz].reduce((s, h) => s + h.head.flowLMin, 0);
        if (f + n.head.flowLMin > capLpm + 1e-6) continue;
        const cT = zoneCentroid(zones[tz].length ? zones[tz] : [n]);
        // Prefer moving the head nearest the light zone (and far from heavy core)
        const score =
          dist({ x: n.x, y: n.y }, cT) -
          0.35 * dist({ x: n.x, y: n.y }, cH);
        if (score < bestScore) {
          bestScore = score;
          victim = n;
          bestTz = tz;
        }
      }
    }
    if (!victim || bestTz < 0) return null;
    zoneOf.set(victim.head.id, bestTz);
    zones = rebuild();
  }

  // Lloyd-ish: reassign to nearest centroid if capacity allows (2 passes)
  for (let pass = 0; pass < 2; pass++) {
    const centroids = zones.map((z) => zoneCentroid(z));
    let changed = false;
    for (const n of nodes) {
      const cur = zoneOf.get(n.head.id)!;
      let best = cur;
      let bestD = dist({ x: n.x, y: n.y }, centroids[cur]);
      for (let tz = 0; tz < k; tz++) {
        if (tz === cur) continue;
        const f = zones[tz].reduce((s, h) => s + h.head.flowLMin, 0);
        if (f + n.head.flowLMin > capLpm + 1e-6) continue;
        // Leaving cur must keep at least one head if others need slots — soft
        if (zones[cur].length <= 1) continue;
        const d = dist({ x: n.x, y: n.y }, centroids[tz]);
        if (d + 0.5 < bestD) {
          bestD = d;
          best = tz;
        }
      }
      if (best !== cur) {
        zoneOf.set(n.head.id, best);
        changed = true;
        zones = rebuild();
      }
    }
    if (!changed) break;
  }

  // Final: drop empty; if still over cap, fail
  zones = zones.filter((z) => z.length > 0);
  if (zones.length !== k) return null;
  for (const z of zones) {
    const f = z.reduce((s, n) => s + n.head.flowLMin, 0);
    if (f > capLpm + 1e-6) return null;
  }
  return zones;
}

function meanPairDistance(nodes: HeadNode[]): number {
  if (nodes.length < 2) return 0;
  let s = 0;
  let n = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      s += dist(
        { x: nodes[i].x, y: nodes[i].y },
        { x: nodes[j].x, y: nodes[j].y },
      );
      n += 1;
    }
  }
  return s / Math.max(n, 1);
}

/**
 * Region-growing fallback when contiguous axis bands are not feasible.
 * Spatial contiguity beats flow balance.
 */
function balancedPartition(
  nodes: HeadNode[],
  edges: GraphEdge[],
  k: number,
  capLpm: number,
  lawnRingM?: PtM[] | null,
): HeadNode[][] | null {
  if (nodes.length === 0) return [];
  if (k <= 1) return [nodes];
  if (k > nodes.length) k = nodes.length;

  const byId = new Map(nodes.map((n) => [n.head.id, n]));
  const totalFlow = nodes.reduce((s, n) => s + n.head.flowLMin, 0);
  const target = totalFlow / k;
  const seeds = lawnRingM
    ? pickSeedsBottleneck(nodes, k, lawnRingM)
    : pickSeeds(nodes, k);

  const zoneOf = new Map<string, number>();
  const zoneFlow = Array.from({ length: k }, () => 0);
  const zones: HeadNode[][] = Array.from({ length: k }, () => []);

  for (let i = 0; i < seeds.length; i++) {
    const id = seeds[i].head.id;
    zoneOf.set(id, i);
    zoneFlow[i] += seeds[i].head.flowLMin;
    zones[i].push(seeds[i]);
  }

  const remaining = new Set(
    nodes.map((n) => n.head.id).filter((id) => !zoneOf.has(id)),
  );

  while (remaining.size > 0) {
    let bestId: string | null = null;
    let bestZone = -1;
    let bestCost = Infinity;

    for (const id of remaining) {
      const node = byId.get(id)!;
      const flow = node.head.flowLMin;
      const neigh = strongNeighborsOf(id, edges);
      const adjacentZones = new Set<number>();
      for (const nb of neigh) {
        const nz = zoneOf.get(nb);
        if (nz !== undefined) adjacentZones.add(nz);
      }

      // Hard rule: if any adjacent zone has capacity, never jump to a distant one
      const adjacentFeasible = [...adjacentZones].filter(
        (z) => zoneFlow[z] + flow <= capLpm + 1e-6,
      );
      const candidateZones =
        adjacentFeasible.length > 0
          ? adjacentFeasible
          : [...Array(k).keys()].filter(
              (z) => zoneFlow[z] + flow <= capLpm + 1e-6,
            );

      for (const z of candidateZones) {
        let cutGain = 0;
        for (const nb of neigh) {
          const nz = zoneOf.get(nb);
          if (nz === undefined) continue;
          const edge = edges.find(
            (e) =>
              (e.a === id && e.b === nb) || (e.b === id && e.a === nb),
          );
          const c = edge?.couplingScore ?? 0;
          if (nz === z) cutGain -= c;
          else cutGain += c;
        }
        const hasNeighbor = adjacentZones.has(z);
        const connectPenalty = hasNeighbor || zones[z].length === 0 ? 0 : 40;
        const projected = zoneFlow[z] + flow;
        const imbalance = Math.abs(projected - target) / Math.max(target, 1);
        const overFill = Math.max(0, projected - target) / Math.max(target, 1);
        const underBonus = projected <= target + 1e-6 ? -0.2 : 0;
        // Distance to zone centroid — keep compact blobs
        const c = zoneCentroid(zones[z]);
        const distPen =
          zones[z].length === 0
            ? 0
            : dist({ x: node.x, y: node.y }, c) / 12;
        const cost =
          cutGain * 2.0 +
          imbalance * 0.7 +
          overFill * 1.2 +
          connectPenalty +
          distPen +
          underBonus;
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          bestId = id;
          bestZone = z;
        }
      }
    }

    // Fallback: nearest feasible zone by centroid (not least-loaded)
    if (bestId == null) {
      for (const id of remaining) {
        const node = byId.get(id)!;
        const flow = node.head.flowLMin;
        for (let z = 0; z < k; z++) {
          if (zoneFlow[z] + flow > capLpm + 1e-6) continue;
          const c = zoneCentroid(zones[z].length ? zones[z] : [node]);
          const d = dist({ x: node.x, y: node.y }, c);
          if (d < bestCost) {
            bestCost = d;
            bestId = id;
            bestZone = z;
          }
        }
      }
    }

    if (bestId == null || bestZone < 0) return null;

    const node = byId.get(bestId)!;
    zoneOf.set(bestId, bestZone);
    zoneFlow[bestZone] += node.head.flowLMin;
    zones[bestZone].push(node);
    remaining.delete(bestId);
  }

  repairConnectivity(zones, edges, zoneOf, zoneFlow, capLpm);
  compactOutliers(zones, edges, zoneOf, zoneFlow, capLpm, byId);

  // Soft balance only when move stays adjacent and keeps both zones connected
  for (let iter = 0; iter < 24; iter++) {
    let improved = false;
    let heavy = 0;
    let light = 0;
    for (let z = 1; z < k; z++) {
      if (zoneFlow[z] > zoneFlow[heavy]) heavy = z;
      if (zoneFlow[z] < zoneFlow[light]) light = z;
    }
    if (heavy === light) break;
    if (Math.abs(zoneFlow[heavy] - zoneFlow[light]) < target * 0.22) break;

    for (const [id, z] of zoneOf) {
      if (z !== heavy) continue;
      const n = byId.get(id)!;
      const move = n.head.flowLMin;
      const newH = zoneFlow[heavy] - move;
      const newL = zoneFlow[light] + move;
      if (newH <= 0 || newL > capLpm + 1e-6) continue;

      const neigh = strongNeighborsOf(id, edges);
      if (!neigh.some((nb) => zoneOf.get(nb) === light)) continue;

      const heavyIds = new Set(
        [...zoneOf.entries()].filter(([, zz]) => zz === heavy).map(([hid]) => hid),
      );
      if (!isArticulationSafe(id, heavyIds, edges)) continue;

      // Don't move a head farther from light centroid than from heavy
      const cH = zoneCentroid(zones[heavy]);
      const cL = zoneCentroid(zones[light]);
      const dH = dist({ x: n.x, y: n.y }, cH);
      const dL = dist({ x: n.x, y: n.y }, cL);
      if (dL > dH * 1.05) continue;

      const before = Math.abs(zoneFlow[heavy] - target) + Math.abs(zoneFlow[light] - target);
      const after = Math.abs(newH - target) + Math.abs(newL - target);
      if (after + 1e-6 < before) {
        zoneOf.set(id, light);
        zoneFlow[heavy] = newH;
        zoneFlow[light] = newL;
        zones[heavy] = zones[heavy].filter((h) => h.head.id !== id);
        zones[light].push(n);
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }

  repairConnectivity(zones, edges, zoneOf, zoneFlow, capLpm);

  const rebuilt: HeadNode[][] = Array.from({ length: k }, () => []);
  for (const n of nodes) {
    const z = zoneOf.get(n.head.id);
    if (z == null) return null;
    rebuilt[z].push(n);
  }
  return rebuilt.filter((z) => z.length > 0);
}

function isOrphanZone(
  zone: HeadNode[],
  siblings: HeadNode[][],
  capLpm: number,
  edges: GraphEdge[],
): boolean {
  const flow = zone.reduce((s, n) => s + n.head.flowLMin, 0);
  if (zone.length > ORPHAN_HEAD_COUNT && flow > 8) return false;
  for (const sib of siblings) {
    if (sib === zone) continue;
    const sibFlow = sib.reduce((s, n) => s + n.head.flowLMin, 0);
    if (sibFlow <= 0) continue;
    if (flow / sibFlow > ORPHAN_FLOW_RATIO && zone.length > ORPHAN_HEAD_COUNT) {
      continue;
    }
    if (flow + sibFlow > capLpm + 1e-6) continue;
    const setZ = new Set(zone.map((n) => n.head.id));
    const setS = new Set(sib.map((n) => n.head.id));
    // Same compatibility already guaranteed within group
    const cut = couplingBetween(edges, setZ, setS);
    if (cut >= 0.15 || zone.length <= ORPHAN_HEAD_COUNT) {
      return true;
    }
  }
  return false;
}

/**
 * Compute the convex-hull area of a set of 2D points (Graham scan).
 * Returns 0 for ≤2 points.
 */
function convexHullArea(pts: PtM[]): number {
  if (pts.length <= 2) return 0;
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: PtM, a: PtM, b: PtM) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: PtM[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: PtM[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    area += hull[i].x * hull[j].y - hull[j].x * hull[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Score a partition with aesthetic penalties.
 * Lower is better.
 * Penalties:
 *  - Zone count (prefer fewer zones)
 *  - Orphan zones (≤ ORPHAN_HEAD_COUNT heads)
 *  - Flow imbalance
 *  - Adjacency cut (edges between different zones = checkerboard)
 *  - Isolated orphan heads (single head of one zone surrounded by others in adjacency)
 *  - Tentacle ratio (zone convex hull area vs head count — long tentacles have high hull/count)
 *  - Disconnected fragments per zone
 */
function scorePartition(
  parts: HeadNode[][],
  edges: GraphEdge[],
  target: number,
): number {
  let imbalance = 0;
  let orphanZones = 0;
  let cut = 0;
  let isolatedOrphans = 0;
  let tentacleScore = 0;
  let disconnectedFragments = 0;

  const partIndex = new Map<string, number>();
  for (let i = 0; i < parts.length; i++) {
    for (const n of parts[i]) partIndex.set(n.head.id, i);
  }

  // Build adjacency per node for orphan detection
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.a)) adj.set(e.a, new Set());
    if (!adj.has(e.b)) adj.set(e.b, new Set());
    adj.get(e.a)!.add(e.b);
    adj.get(e.b)!.add(e.a);
  }

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const f = p.reduce((s, n) => s + n.head.flowLMin, 0);
    imbalance += Math.abs(f - target);
    if (p.length <= ORPHAN_HEAD_COUNT) orphanZones += 1;

    // Check for isolated orphan heads: a head all whose neighbors are in another zone
    for (const n of p) {
      const neighbors = adj.get(n.head.id);
      if (neighbors && neighbors.size > 0) {
        const allDifferent = [...neighbors].every(
          (nid) => partIndex.get(nid) !== i,
        );
        if (allDifferent) isolatedOrphans += 1;
      }
    }

    // Tentacle detection: ratio of convex hull area to ideal compact circle area
    if (p.length >= 3) {
      const pts = p.map((n) => ({ x: n.x, y: n.y }));
      const hull = convexHullArea(pts);
      const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
      const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;
      const maxDist = Math.max(...pts.map((pt) => dist(pt, { x: cx, y: cy })));
      const idealArea = Math.PI * maxDist * maxDist;
      if (idealArea > 0) {
        const compactness = hull / idealArea;
        // Very elongated zones (low compactness) get penalized
        // Compact circle = 1.0, thin line ≈ 0
        tentacleScore += Math.max(0, 1 - compactness);
      }
    }

    // Check connectivity of each zone (ignore weak bridge edges)
    if (p.length > 1) {
      const zoneNodeIds = new Set(p.map((n) => n.head.id));
      const zoneEdges = edges.filter(
        (e) =>
          e.couplingScore >= 0.22 &&
          zoneNodeIds.has(e.a) &&
          zoneNodeIds.has(e.b),
      );
      const comps = graphComponents(p, zoneEdges);
      if (comps.length > 1) disconnectedFragments += comps.length - 1;
    }
  }

  // Cut: total coupling across zone boundaries (checkerboard indicator)
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      cut += couplingBetween(
        edges,
        new Set(parts[i].map((n) => n.head.id)),
        new Set(parts[j].map((n) => n.head.id)),
      );
    }
  }

  return (
    1.2 * (parts.length - 1) +
    1.0 * orphanZones +
    0.08 * (imbalance / Math.max(target, 1)) +
    0.4 * cut +
    3.0 * isolatedOrphans +
    2.5 * tentacleScore +
    12.0 * disconnectedFragments
  );
}

function partitionCompatibilityGroup(
  nodes: HeadNode[],
  capLpm: number,
  lawnRingM?: PtM[] | null,
  obstacleRingsM: PtM[][] = [],
): { parts: HeadNode[][]; reason: ZoneDecision["primaryReason"]; warning?: string } {
  if (nodes.length === 0) {
    return { parts: [], reason: "SOURCE_FLOW" };
  }
  const totalFlow = nodes.reduce((s, n) => s + n.head.flowLMin, 0);
  const kFlow = Math.max(1, Math.ceil(totalFlow / capLpm));

  // If all flow fits in one zone, never split
  if (kFlow <= 1) {
    return { parts: [nodes], reason: primaryReasonForKey(nodes[0].compatibilityKey) };
  }

  const edges = buildHeadAdjacencyGraph(nodes, obstacleRingsM);
  // Contiguous axis bands first (compact laterals); growth as fallback
  const candidatesK = [kFlow];

  let best: HeadNode[][] | null = null;
  let bestScore = Infinity;

  for (const k of candidatesK) {
    const axisParts = contiguousAxisPartition(nodes, k, capLpm);
    const angleParts = contiguousAngularPartition(nodes, k, capLpm);
    const recurParts = recursiveSpatialPartition(nodes, k, capLpm);
    const clusterParts = spatialClusterPartition(nodes, k, capLpm);
    const grownParts = balancedPartition(nodes, edges, k, capLpm, lawnRingM);
    const options = [
      recurParts,
      angleParts,
      clusterParts,
      axisParts,
      grownParts,
    ].filter((p): p is HeadNode[][] => !!p && p.length > 0);

    for (const parts of options) {
      let rejected = false;
      for (const z of parts) {
        if (parts.length > 1 && isOrphanZone(z, parts, capLpm, edges)) {
          rejected = true;
          break;
        }
      }
      let candidate = parts;
      if (rejected) {
        const merged = tryMergeOrphans(parts, capLpm, edges);
        if (merged && merged.length < parts.length) candidate = merged;
        else if (rejected && axisParts === parts) {
          // Axis cut with tiny end zone — keep; growth may be worse
        } else if (rejected) {
          continue;
        }
      }
      const target = totalFlow / candidate.length;
      // Lexicographic: compact first, hydraulics second
      const worstSpread = Math.max(
        ...candidate.map((z) => meanPairDistance(z)),
        0,
      );
      const avgSpread =
        candidate.reduce((s, z) => s + meanPairDistance(z), 0) /
        Math.max(candidate.length, 1);
      const base = scorePartition(candidate, edges, target);
      const sc = worstSpread * 1000 + avgSpread * 10 + base;
      if (sc < bestScore) {
        bestScore = sc;
        best = candidate;
      }
    }
  }

  if (!best) {
    // last resort: single zone if under cap, else force kFlow partition
    if (totalFlow <= capLpm + 1e-6) {
      return { parts: [nodes], reason: "SOURCE_FLOW" };
    }
    const forced = balancedPartition(nodes, edges, kFlow, capLpm, lawnRingM);
    if (forced && forced.length > 0) {
      return {
        parts: forced,
        reason: "SOURCE_FLOW",
        warning: "Zonen-Partition per Fallback (balanced kFlow)",
      };
    }
    return {
      parts: [nodes],
      reason: "SOURCE_FLOW",
      warning: "Zonen-Partition unvollständig — Fallback",
    };
  }

  return {
    parts: best,
    reason:
      best.length > 1 && kFlow > 1
        ? "SOURCE_FLOW"
        : primaryReasonForKey(nodes[0].compatibilityKey),
  };
}

function tryMergeOrphans(
  parts: HeadNode[][],
  capLpm: number,
  edges: GraphEdge[],
): HeadNode[][] | null {
  let working = parts.map((p) => [...p]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < working.length; i++) {
      if (!isOrphanZone(working[i], working, capLpm, edges)) continue;
      let bestJ = -1;
      let bestCut = -1;
      const fi = working[i].reduce((s, n) => s + n.head.flowLMin, 0);
      for (let j = 0; j < working.length; j++) {
        if (i === j) continue;
        const fj = working[j].reduce((s, n) => s + n.head.flowLMin, 0);
        if (fi + fj > capLpm + 1e-6) continue;
        const cut = couplingBetween(
          edges,
          new Set(working[i].map((n) => n.head.id)),
          new Set(working[j].map((n) => n.head.id)),
        );
        if (cut > bestCut) {
          bestCut = cut;
          bestJ = j;
        }
      }
      if (bestJ >= 0) {
        working[bestJ] = [...working[bestJ], ...working[i]];
        working.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return working.length > 0 ? working : null;
}

function formatLpm(n: number) {
  return n.toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function explanationDe(
  reason: ZoneDecision["primaryReason"],
  flowLpm: number,
  target: number,
  zoneCount: number,
): string {
  const flow = formatLpm(flowLpm);
  switch (reason) {
    case "PRECIPITATION_CLASS":
      return `Eigene Niederschlagsklasse (z. B. MP800) — ${flow} l/min.`;
    case "IRRIGATION_METHOD":
      return `Getrennte Bewässerungsart — ${flow} l/min.`;
    case "SOURCE_FLOW":
      if (zoneCount <= 1) {
        return `Eine Ventilzone reicht (${flow} l/min).`;
      }
      return `Quellfluss ausgewogen — Ziel ${formatLpm(target)} l/min, aktuell ${flow} l/min.`;
    case "DISCONNECTED_AREA":
      return `Eigene Rasenfläche (getrennt gezeichnet) — ${flow} l/min.`;
    default:
      return `${reason} — ${flow} l/min.`;
  }
}

export type DesignValveZonesResult = {
  heads: SprinklerHead[];
  zoneCount: number;
  overflow: boolean;
  decisions: ZoneDecision[];
  warnings: string[];
  assumptions: string[];
};

/**
 * Design valve zones with compatibility groups + balanced partition.
 * Falls back to v2 assignHydraulicZones only if result is empty.
 */
export function designValveZones(params: {
  heads: SprinklerHead[];
  lawns: DrawnZone[];
  obstacles: DrawnZone[];
  fixtures?: unknown;
  sourceFlowLMin: number;
  verteilerPos: LngLat;
  brand?: string;
  allZones?: DrawnZone[];
}): DesignValveZonesResult {
  const {
    heads,
    lawns,
    sourceFlowLMin,
    verteilerPos,
    allZones,
  } = params;
  const fill = CATALOG.hydraulics.zoneFillFactor;
  const cap = sourceFlowLMin * fill;
  const zonesForMa = allZones ?? lawns;
  const { areas, assumptions } = buildManagementAreas(zonesForMa);
  const distinctLawns = new Set(
    heads.map((h) => h.lawnZoneId).filter(Boolean),
  );
  if (distinctLawns.size > 1) {
    assumptions.push(
      "Getrennte Rasenflächen → jeweils eigene Ventilzone(n), auch bei gemeinsamer Wasserquelle.",
    );
  }

  if (heads.length === 0) {
    return {
      heads,
      zoneCount: 0,
      overflow: false,
      decisions: [],
      warnings: [],
      assumptions,
    };
  }

  const groups = buildHeadCompatibilityGroups(heads, areas, verteilerPos);
  const decisions: ZoneDecision[] = [];
  const warnings: string[] = [];
  let overflow = false;
  let nextZone = 0;
  const assigned = new Map<string, number>();

  // Pre-compute lawn polygon rings in local meters for bottleneck detection
  const proj = makeLocalProjection(verteilerPos);
  const lawnRingsM = new Map<string, PtM[]>();
  for (const lawn of lawns) {
    if (lawn.coordinates.length >= 3) {
      lawnRingsM.set(lawn.id, lawn.coordinates.map((c) => proj.toM(c)));
    }
  }

  // Pre-compute obstacle rings in local meters for adjacency graph
  const obstacleRingsM: PtM[][] = [];
  for (const obs of params.obstacles) {
    if (obs.coordinates.length >= 3) {
      obstacleRingsM.push(obs.coordinates.map((c) => proj.toM(c)));
    }
  }

  // Stable group order
  const groupKeys = [...groups.keys()].sort();
  const lawnIdsInGroups = new Set(
    groupKeys.map((k) => k.split("|").slice(-1)[0]),
  );
  const prefixes = groupKeys.map(hydraulicCompatPrefix);
  const hasParallelLawnSplit =
    lawnIdsInGroups.size > 1 &&
    prefixes.some(
      (p) => prefixes.filter((x) => x === p).length > 1,
    );

  for (const key of groupKeys) {
    const nodes = groups.get(key)!;
    for (const n of nodes) {
      if (n.head.flowLMin > cap) overflow = true;
    }
    const lawnId = key.split("|").slice(-1)[0];
    const lawnRingM = lawnRingsM.get(lawnId) ?? null;
    const { parts, reason, warning } = partitionCompatibilityGroup(nodes, cap, lawnRingM, obstacleRingsM);
    if (warning) warnings.push(warning);

    const groupFlow = nodes.reduce((s, n) => s + n.head.flowLMin, 0);
    const target = groupFlow / Math.max(parts.length, 1);

    for (const part of parts) {
      const flow = part.reduce((s, n) => s + n.head.flowLMin, 0);
      const zoneId = `valve-${nextZone}`;
      let primary: ZoneDecision["primaryReason"] =
        parts.length > 1
          ? "SOURCE_FLOW"
          : parts.length === 1 && groupKeys.length > 1
            ? primaryReasonForKey(key)
            : reason;

      // Product rule: separate drawn Rasen polygons → own valve zone(s)
      if (
        hasParallelLawnSplit &&
        parts.length === 1 &&
        (primary === "SOURCE_FLOW" || primary === reason)
      ) {
        const sameHydOtherLawn = groupKeys.some(
          (k) =>
            k !== key &&
            hydraulicCompatPrefix(k) === hydraulicCompatPrefix(key),
        );
        if (sameHydOtherLawn) primary = "DISCONNECTED_AREA";
      }

      decisions.push({
        zoneId,
        managementAreaIds: [
          ...new Set(part.map((n) => n.managementAreaId)),
        ],
        scheduleGroupId: part[0]?.scheduleGroupId ?? "SG-LAWN",
        primaryReason: primary,
        secondaryReasons: [],
        flowLpm: Number(flow.toFixed(2)),
        hydraulicLimitLpm: Number(cap.toFixed(2)),
        targetBalancedFlowLpm: Number(target.toFixed(2)),
        minimumPressureMarginBar: 0,
        separatedFromZoneIds: [],
        mergeRejectedBecause: [],
        explanation: explanationDe(
          primary,
          flow,
          target,
          parts.length,
        ),
      });

      for (const n of part) {
        assigned.set(n.head.id, nextZone);
      }
      nextZone += 1;
    }
  }

  if (assigned.size === 0) {
    warnings.push(
      "Professional zoning lieferte keine Zonen — Fallback auf Algorithmus v2.",
    );
    const fb = assignHydraulicZones(heads, verteilerPos, cap);
    return {
      heads: fb.heads,
      zoneCount: fb.zoneCount,
      overflow: fb.overflow,
      decisions: [],
      warnings,
      assumptions,
    };
  }

  const out = heads.map((h) => ({
    ...h,
    hydraulicZone: assigned.get(h.id) ?? 0,
  }));

  return {
    heads: out,
    zoneCount: nextZone,
    overflow,
    decisions,
    warnings,
    assumptions,
  };
}
