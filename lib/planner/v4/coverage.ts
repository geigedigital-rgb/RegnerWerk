import type { DrawnZone } from "@/lib/mapbox";
import {
  bbox,
  ensureCCW,
  makeLocalProjection,
  pointInPolygon,
} from "./geometry";
import { pointInSector, pointInStrip } from "./layout";
import type { PlanMetrics, SprinklerHead } from "../types";

type Sample = { x: number; y: number; depthMmH: number; covered: boolean };

function headPrecipMmH(head: SprinklerHead): number {
  // Conservative uniform disc model when manufacturer profiles are absent
  if (head.kind === "strip") {
    const area = (head.stripWidthM ?? 1.5) * (head.stripLengthM ?? head.radiusM);
    if (area <= 0) return 0;
    return (head.flowLMin * 60) / area; // L/h / m² = mm/h
  }
  const area = Math.PI * head.radiusM * head.radiusM * (head.arcDeg / 360);
  if (area <= 0) return 0;
  return (head.flowLMin * 60) / area;
}

/**
 * Sample lawn polygons: binary coverage + predicted application metrics.
 */
export function estimateCoveragePct(
  lawns: DrawnZone[],
  heads: SprinklerHead[],
  obstacles: DrawnZone[] = [],
): number {
  return estimatePlanMetrics(lawns, heads, obstacles).binaryCoveragePct;
}

export function estimatePlanMetrics(
  lawns: DrawnZone[],
  heads: SprinklerHead[],
  obstacles: DrawnZone[] = [],
): PlanMetrics {
  if (lawns.length === 0 || heads.length === 0) {
    return { binaryCoveragePct: 0 };
  }

  const depths: number[] = [];
  let hit = 0;
  let total = 0;
  let overspray = 0;
  let buildingHits = 0;
  let outsideSamples = 0;
  let largestDry = 0;

  for (const lawn of lawns) {
    if (lawn.coordinates.length < 3) continue;
    const origin = lawn.coordinates[0];
    const proj = makeLocalProjection(origin);
    const ring = ensureCCW(lawn.coordinates.map((p) => proj.toM(p)));
    const obstacleRings = obstacles
      .filter((o) => o.coordinates.length >= 3)
      .map((o) => o.coordinates.map((p) => proj.toM(p)));

    const box = bbox(ring);
    const step = Math.max(0.4, Math.min(box.w, box.h) / 20);
    const lawnHeads = heads.filter((h) => h.lawnZoneId === lawn.id);
    const headLocal = lawnHeads.map((h) => ({
      head: h,
      pt: proj.toM(h.position),
      precip: headPrecipMmH(h),
    }));

    const samples: Sample[] = [];
    for (let y = box.minY; y <= box.maxY; y += step) {
      for (let x = box.minX; x <= box.maxX; x += step) {
        const p = { x, y };
        const inLawn = pointInPolygon(p, ring);
        const inBldg = obstacleRings.some((o) => pointInPolygon(p, o));

        let depth = 0;
        let covered = false;
        for (const { head, pt, precip } of headLocal) {
          let inside = false;
          if (head.kind === "strip") {
            inside = pointInStrip(
              p,
              pt,
              head.stripWidthM ?? 1.5,
              head.stripLengthM ?? head.radiusM,
              head.rotationDeg,
            );
          } else {
            inside = pointInSector(
              p,
              pt,
              head.radiusM,
              head.arcDeg,
              head.rotationDeg,
            );
          }
          if (inside) {
            covered = true;
            // Simple radial falloff toward edge
            const d = Math.hypot(p.x - pt.x, p.y - pt.y);
            const r = head.radiusM || 1;
            const fall = head.kind === "strip" ? 1 : Math.max(0.35, 1 - (d / r) * 0.5);
            depth += precip * fall;
          }
        }

        if (inBldg && covered) buildingHits += 1;
        if (!inLawn && !inBldg && covered) {
          overspray += 1;
          outsideSamples += 1;
        }
        if (!inLawn || inBldg) continue;

        total += 1;
        if (covered) hit += 1;
        depths.push(depth);
        samples.push({ x, y, depthMmH: depth, covered });
      }
    }

    // Largest connected dry patch (4-connected on sample grid)
    const dryIdx = new Set<number>();
    samples.forEach((s, i) => {
      if (!s.covered) dryIdx.add(i);
    });
    const visited = new Set<number>();
    const cellArea = step * step;
    for (const start of dryIdx) {
      if (visited.has(start)) continue;
      let count = 0;
      const stack = [start];
      visited.add(start);
      while (stack.length) {
        const i = stack.pop()!;
        count += 1;
        const s = samples[i];
        for (const j of dryIdx) {
          if (visited.has(j)) continue;
          const t = samples[j];
          if (Math.hypot(s.x - t.x, s.y - t.y) <= step * 1.5) {
            visited.add(j);
            stack.push(j);
          }
        }
      }
      largestDry = Math.max(largestDry, count * cellArea);
    }
  }

  const binaryCoveragePct = total === 0 ? 0 : Math.round((100 * hit) / total);
  let predictedDUlq: number | undefined;
  let precipitationMmH: number | undefined;
  if (depths.length > 0) {
    const avg = depths.reduce((a, b) => a + b, 0) / depths.length;
    precipitationMmH = Number(avg.toFixed(2));
    const sorted = [...depths].sort((a, b) => a - b);
    const q = Math.max(1, Math.floor(sorted.length / 4));
    const low = sorted.slice(0, q);
    const lowAvg = low.reduce((a, b) => a + b, 0) / low.length;
    predictedDUlq =
      avg > 0 ? Number(Math.min(1, lowAvg / avg).toFixed(3)) : 0;
  }

  const denom = total + overspray + buildingHits;
  return {
    binaryCoveragePct,
    predictedDUlq,
    precipitationMmH,
    oversprayPct:
      denom > 0 ? Number(((100 * overspray) / denom).toFixed(1)) : 0,
    buildingOversprayPct:
      denom > 0 ? Number(((100 * buildingHits) / denom).toFixed(1)) : 0,
    largestDryPatchM2: Number(largestDry.toFixed(1)),
  };
}
