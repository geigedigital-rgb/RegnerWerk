import type { DrawnZone } from "@/lib/mapbox";
import {
  bbox,
  ensureCCW,
  makeLocalProjection,
  pointInPolygon,
} from "./geometry";
import { pointInSector, pointInStrip } from "./layout";
import type { SprinklerHead } from "../types";

/**
 * Sample lawn polygons and estimate the fraction of area covered by at least
 * one head (sector or strip). Returns 0–100.
 */
export function estimateCoveragePct(
  lawns: DrawnZone[],
  heads: SprinklerHead[],
  obstacles: DrawnZone[] = [],
): number {
  if (lawns.length === 0 || heads.length === 0) return 0;

  let hit = 0;
  let total = 0;

  for (const lawn of lawns) {
    if (lawn.coordinates.length < 3) continue;
    const origin = lawn.coordinates[0];
    const proj = makeLocalProjection(origin);
    let ring = ensureCCW(lawn.coordinates.map((p) => proj.toM(p)));
    const obstacleRings = obstacles
      .filter((o) => o.coordinates.length >= 3)
      .map((o) => o.coordinates.map((p) => proj.toM(p)));

    const box = bbox(ring);
    const step = Math.max(0.4, Math.min(box.w, box.h) / 20);
    const lawnHeads = heads.filter((h) => h.lawnZoneId === lawn.id);
    const headLocal = lawnHeads.map((h) => ({
      head: h,
      pt: proj.toM(h.position),
    }));

    for (let y = box.minY; y <= box.maxY; y += step) {
      for (let x = box.minX; x <= box.maxX; x += step) {
        const p = { x, y };
        if (!pointInPolygon(p, ring)) continue;
        if (obstacleRings.some((o) => pointInPolygon(p, o))) continue;
        total += 1;
        const covered = headLocal.some(({ head, pt }) => {
          if (head.kind === "strip") {
            return pointInStrip(
              p,
              pt,
              head.stripWidthM ?? 1.5,
              head.stripLengthM ?? head.radiusM,
              head.rotationDeg,
            );
          }
          return pointInSector(
            p,
            pt,
            head.radiusM,
            head.arcDeg,
            head.rotationDeg,
          );
        });
        if (covered) hit += 1;
      }
    }
  }

  if (total === 0) return 0;
  return Math.round((100 * hit) / total);
}
