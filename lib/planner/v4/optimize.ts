import type { DrawnZone } from "@/lib/mapbox";
import type { SprinklerHead, PtM } from "../types";
import type { SprinklerBrand } from "../catalog";
import { estimatePlanMetrics } from "./coverage";
import {
  ensureCCW,
  makeLocalProjection,
  pointInPolygon,
  distToBoundary,
  dist,
  localWidthM,
} from "./geometry";
import { pointInSector } from "./layout";

function sortRemovalCandidates(heads: SprinklerHead[]): SprinklerHead[] {
  return [...heads].sort((a, b) => {
    const a360 = a.arcDeg >= 315 ? 1 : 0;
    const b360 = b.arcDeg >= 315 ? 1 : 0;
    if (a360 !== b360) return a360 - b360;
    if (Math.abs(a.radiusM - b.radiusM) > 0.5) return a.radiusM - b.radiusM;
    return a.arcDeg - b.arcDeg;
  });
}

/** Drop the smaller head when two sit on opposite sides of a narrow corridor. */
function pruneCorridorDuplicates(
  heads: SprinklerHead[],
  lawns: DrawnZone[],
  obstacles: DrawnZone[],
  minCov: number,
  minDu: number,
): SprinklerHead[] {
  const lawnById = new Map(lawns.map((l) => [l.id, l]));
  let current = [...heads];

  for (let pass = 0; pass < 2; pass++) {
    let removed = false;
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i];
        const b = current[j];
        if (a.lawnZoneId !== b.lawnZoneId) continue;

        const lawn = lawnById.get(a.lawnZoneId);
        if (!lawn) continue;
        const origin = lawn.coordinates[0];
        const proj = makeLocalProjection(origin);
        const ring = ensureCCW(lawn.coordinates.map((p) => proj.toM(p)));
        const ptA = proj.toM(a.position);
        const ptB = proj.toM(b.position);
        const d = dist(ptA, ptB);
        if (d > 5.5 || d < 1.5) continue;

        const mid = { x: (ptA.x + ptB.x) / 2, y: (ptA.y + ptB.y) / 2 };
        const localW = localWidthM(mid, ring);
        if (localW <= 0 || localW > 6.5) continue;

        const onEdgeA = distToBoundary(ptA, ring) < 2.2;
        const onEdgeB = distToBoundary(ptB, ring) < 2.2;
        if (!onEdgeA || !onEdgeB) continue;

        const drop =
          a.radiusM <= b.radiusM && a.arcDeg <= b.arcDeg + 10 ? a : b;
        const without = current.filter((h) => h.id !== drop.id);
        if (
          isSubsumedByOthers(drop, without, lawn) ||
          passesCoverageGate(lawns, without, obstacles, minCov, minDu)
        ) {
          current = without;
          removed = true;
          break;
        }
      }
      if (removed) break;
    }
    if (!removed) break;
  }
  return current;
}

function coversWithHead(sample: PtM, head: SprinklerHead, pt: PtM): boolean {
  if (head.kind === "strip") return false;
  return pointInSector(sample, pt, head.radiusM, head.arcDeg, head.rotationDeg);
}

function sectorSamplesOnLawn(
  head: SprinklerHead,
  pt: PtM,
  ring: PtM[],
  step = 0.55,
): PtM[] {
  const out: PtM[] = [];
  const r = head.radiusM;
  if (r <= 0) return out;
  for (let d = step; d <= r; d += step) {
    for (let a = -head.arcDeg / 2; a <= head.arcDeg / 2; a += 12) {
      const bearing = (head.rotationDeg + a + 360) % 360;
      const rad = ((90 - bearing) * Math.PI) / 180;
      const sample = { x: pt.x + d * Math.cos(rad), y: pt.y + d * Math.sin(rad) };
      if (!pointInPolygon(sample, ring)) continue;
      if (!pointInSector(sample, pt, head.radiusM, head.arcDeg, head.rotationDeg)) {
        continue;
      }
      out.push(sample);
    }
  }
  return out;
}

function isSubsumedByOthers(
  candidate: SprinklerHead,
  others: SprinklerHead[],
  lawn: DrawnZone,
): boolean {
  if (others.length === 0) return false;
  const origin = lawn.coordinates[0];
  const proj = makeLocalProjection(origin);
  const ring = ensureCCW(lawn.coordinates.map((p) => proj.toM(p)));
  const pt = proj.toM(candidate.position);
  const samples = sectorSamplesOnLawn(candidate, pt, ring);
  if (samples.length === 0) return true;

  const otherLocal = others
    .filter((h) => h.lawnZoneId === lawn.id)
    .map((h) => ({ head: h, pt: proj.toM(h.position) }));

  for (const sample of samples) {
    const covered = otherLocal.some(({ head, pt: opt }) =>
      coversWithHead(sample, head, opt),
    );
    if (!covered) return false;
  }
  return true;
}

function passesCoverageGate(
  lawns: DrawnZone[],
  heads: SprinklerHead[],
  obstacles: DrawnZone[],
  minCov: number,
  minDu: number,
): boolean {
  const m = estimatePlanMetrics(lawns, heads, obstacles);
  return (
    m.binaryCoveragePct >= minCov &&
    (m.predictedDUlq == null || m.predictedDUlq >= minDu) &&
    (m.largestDryPatchM2 ?? 0) < 4
  );
}

/**
 * Remove redundant heads after layout. No radius/arc patching — layout must
 * already place correct families and equal edge spacing (algo4 §8–9).
 *
 * Refines each lawn independently. A global pass would let a dense zone
 * “carry” coverage metrics while stripping mid-edge H2H heads from a
 * neighbouring elongated bed (classic 3×9 m bald centre).
 */
export function refineHeadSet(
  heads: SprinklerHead[],
  lawns: DrawnZone[],
  obstacles: DrawnZone[],
  opts?: { minCoveragePct?: number; minDUlq?: number; brand?: SprinklerBrand },
): SprinklerHead[] {
  const minCov = opts?.minCoveragePct ?? 98;
  const minDu = opts?.minDUlq ?? 0.55;
  if (heads.length <= 1) return heads;

  const byLawn = new Map<string, SprinklerHead[]>();
  const orphan: SprinklerHead[] = [];
  for (const h of heads) {
    if (!h.lawnZoneId) {
      orphan.push(h);
      continue;
    }
    const list = byLawn.get(h.lawnZoneId) ?? [];
    list.push(h);
    byLawn.set(h.lawnZoneId, list);
  }

  const out: SprinklerHead[] = [...orphan];
  for (const lawn of lawns) {
    const zoneHeads = byLawn.get(lawn.id);
    if (!zoneHeads || zoneHeads.length === 0) continue;
    out.push(
      ...refineLawnHeadSet(zoneHeads, lawn, lawns, obstacles, minCov, minDu),
    );
  }
  // Heads whose lawn id is missing from `lawns` (shouldn’t happen)
  for (const [lawnId, zoneHeads] of byLawn) {
    if (lawns.some((l) => l.id === lawnId)) continue;
    out.push(...zoneHeads);
  }
  return out;
}

function refineLawnHeadSet(
  heads: SprinklerHead[],
  lawn: DrawnZone,
  _allLawns: DrawnZone[],
  obstacles: DrawnZone[],
  minCov: number,
  minDu: number,
): SprinklerHead[] {
  if (heads.length <= 4) return heads;

  let current = [...heads];
  let changed = true;
  const lawnOnly = [lawn];

  while (changed) {
    changed = false;
    // Perimeter corners / H2H edges are layout-owned. Only drop redundant
    // interior 360° heads — otherwise elongated beds lose mid-edge points or
    // corners and look "bald" while global coverage still scrapes through.
    const order = sortRemovalCandidates(current).filter((h) => h.arcDeg >= 315);
    if (order.length === 0) break;

    for (const candidate of order) {
      const without = current.filter((h) => h.id !== candidate.id);
      if (passesCoverageGate(lawnOnly, without, obstacles, minCov, minDu)) {
        current = without;
        changed = true;
        break;
      }
    }
  }

  return current;
}
