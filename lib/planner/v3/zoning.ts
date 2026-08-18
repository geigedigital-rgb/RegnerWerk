/**
 * Professional valve zoning for Sofort v3.
 * Spec: Sofort_v2_professional_zoning_algorithm_ru.md (stage 1 + stage 2 core).
 */
import type { DrawnZone, LngLat } from "@/lib/mapbox";
import { CATALOG, isMp800Family } from "../catalog";
import { dist, makeLocalProjection } from "./geometry";
import { assignHydraulicZones } from "./hydraulics";
import type { SprinklerHead } from "../types";
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

/** Light adjacency graph: neighbors within max(R_i, R_j), weight by distance + same lawn. */
export function buildHeadAdjacencyGraph(nodes: HeadNode[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const d = dist({ x: a.x, y: a.y }, { x: b.x, y: b.y });
      const maxR = Math.max(a.head.radiusM, b.head.radiusM);
      if (d > maxR + 0.5) continue;
      const sameLawn = a.lawnComponentId === b.lawnComponentId ? 1 : 0.35;
      const h2h = maxR > 0 ? Math.max(0, 1 - d / maxR) : 0;
      const couplingScore = sameLawn * (0.4 + 0.6 * h2h);
      edges.push({ a: a.head.id, b: b.head.id, couplingScore });
    }
  }
  return edges;
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

function neighborsOf(id: string, edges: GraphEdge[]): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (e.a === id) out.push(e.b);
    else if (e.b === id) out.push(e.a);
  }
  return out;
}

/**
 * Balanced region growing toward targetFlow = total/k.
 * Prefers low cut cost and low imbalance over greedy pack-to-cap.
 */
function balancedPartition(
  nodes: HeadNode[],
  edges: GraphEdge[],
  k: number,
  capLpm: number,
): HeadNode[][] | null {
  if (nodes.length === 0) return [];
  if (k <= 1) return [nodes];
  if (k > nodes.length) k = nodes.length;

  const byId = new Map(nodes.map((n) => [n.head.id, n]));
  const totalFlow = nodes.reduce((s, n) => s + n.head.flowLMin, 0);
  const target = totalFlow / k;
  const seeds = pickSeeds(nodes, k);

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
      const neigh = neighborsOf(id, edges);
      for (let z = 0; z < k; z++) {
        if (zoneFlow[z] + flow > capLpm + 1e-6) continue;
        let hasNeighbor = false;
        let cutGain = 0;
        for (const nb of neigh) {
          const nz = zoneOf.get(nb);
          if (nz === undefined) continue;
          const edge = edges.find(
            (e) =>
              (e.a === id && e.b === nb) || (e.b === id && e.a === nb),
          );
          const c = edge?.couplingScore ?? 0;
          if (nz === z) {
            hasNeighbor = true;
            cutGain -= c;
          } else {
            cutGain += c;
          }
        }
        // Prefer connected growth; allow disconnected only if no connected option later
        const connectPenalty = hasNeighbor || zones[z].length === 0 ? 0 : 2.5;
        const projected = zoneFlow[z] + flow;
        const imbalance = Math.abs(projected - target) / Math.max(target, 1);
        const overFill =
          Math.max(0, projected - target) / Math.max(target, 1);
        const underBonus = projected <= target + 1e-6 ? -0.35 : 0;
        const cost =
          cutGain * 0.5 +
          imbalance * 2.2 +
          overFill * 3.5 +
          connectPenalty +
          underBonus;
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          bestId = id;
          bestZone = z;
        }
      }
    }

    // Fallback: assign to least-loaded feasible zone (even if over soft connect)
    if (bestId == null) {
      for (const id of remaining) {
        const node = byId.get(id)!;
        const flow = node.head.flowLMin;
        for (let z = 0; z < k; z++) {
          if (zoneFlow[z] + flow > capLpm + 1e-6) continue;
          const projected = zoneFlow[z] + flow;
          const imbalance = Math.abs(projected - target);
          if (imbalance < bestCost) {
            bestCost = imbalance;
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

  // Local improve: move heads toward flow balance
  for (let iter = 0; iter < 48; iter++) {
    let improved = false;
    let heavy = 0;
    let light = 0;
    for (let z = 1; z < k; z++) {
      if (zoneFlow[z] > zoneFlow[heavy]) heavy = z;
      if (zoneFlow[z] < zoneFlow[light]) light = z;
    }
    if (heavy === light) break;
    if (Math.abs(zoneFlow[heavy] - zoneFlow[light]) < target * 0.15) break;

    for (const [id, z] of zoneOf) {
      if (z !== heavy) continue;
      const n = byId.get(id)!;
      const move = n.head.flowLMin;
      const newH = zoneFlow[heavy] - move;
      const newL = zoneFlow[light] + move;
      if (newH <= 0 || newL > capLpm + 1e-6) continue;
      // Prefer moves that keep some coupling to light zone or reduce imbalance
      const before = Math.abs(zoneFlow[heavy] - target) + Math.abs(zoneFlow[light] - target);
      const after = Math.abs(newH - target) + Math.abs(newL - target);
      if (after + 1e-6 < before) {
        zoneOf.set(id, light);
        zoneFlow[heavy] = newH;
        zoneFlow[light] = newL;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }

  // Rebuild zone arrays from zoneOf
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

function scorePartition(
  parts: HeadNode[][],
  edges: GraphEdge[],
  target: number,
): number {
  let imbalance = 0;
  let orphan = 0;
  let cut = 0;
  for (const p of parts) {
    const f = p.reduce((s, n) => s + n.head.flowLMin, 0);
    imbalance += Math.abs(f - target);
    if (p.length <= ORPHAN_HEAD_COUNT) orphan += 1;
  }
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
    0.4 * (parts.length - 1) +
    0.25 * orphan +
    0.2 * (imbalance / Math.max(target, 1)) +
    0.15 * cut
  );
}

function partitionCompatibilityGroup(
  nodes: HeadNode[],
  capLpm: number,
): { parts: HeadNode[][]; reason: ZoneDecision["primaryReason"]; warning?: string } {
  if (nodes.length === 0) {
    return { parts: [], reason: "SOURCE_FLOW" };
  }
  const edges = buildHeadAdjacencyGraph(nodes);
  const totalFlow = nodes.reduce((s, n) => s + n.head.flowLMin, 0);
  const kFlow = Math.max(1, Math.ceil(totalFlow / capLpm));
  const candidatesK = [kFlow];
  if (kFlow + 1 <= nodes.length) candidatesK.push(kFlow + 1);

  let best: HeadNode[][] | null = null;
  let bestScore = Infinity;

  for (const k of candidatesK) {
    const parts = balancedPartition(nodes, edges, k, capLpm);
    if (!parts || parts.length === 0) continue;
    // Reject unexplained orphans
    let rejected = false;
    for (const z of parts) {
      if (parts.length > 1 && isOrphanZone(z, parts, capLpm, edges)) {
        rejected = true;
        break;
      }
    }
    if (rejected && k > kFlow) continue;
    if (rejected) {
      const merged = tryMergeOrphans(parts, capLpm, edges);
      if (merged && merged.length < parts.length) {
        const target = totalFlow / merged.length;
        const sc = scorePartition(merged, edges, target);
        if (sc < bestScore) {
          bestScore = sc;
          best = merged;
        }
        continue;
      }
      // Split required by flow — keep balanced parts even if one side looks small
      const target = totalFlow / parts.length;
      const sc = scorePartition(parts, edges, target) + 0.05;
      if (sc < bestScore) {
        bestScore = sc;
        best = parts;
      }
      continue;
    }
    const target = totalFlow / parts.length;
    const sc = scorePartition(parts, edges, target);
    if (sc < bestScore) {
      bestScore = sc;
      best = parts;
    }
  }

  if (!best) {
    // last resort: single zone if under cap, else force kFlow partition
    if (totalFlow <= capLpm + 1e-6) {
      return { parts: [nodes], reason: "SOURCE_FLOW" };
    }
    const forced = balancedPartition(nodes, edges, kFlow, capLpm);
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
    const { parts, reason, warning } = partitionCompatibilityGroup(nodes, cap);
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
