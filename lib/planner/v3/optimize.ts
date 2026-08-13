import type { SprinklerHead } from "../types";
import type { DrawnZone } from "@/lib/mapbox";
import { estimatePlanMetrics } from "./coverage";

/**
 * Stage 2 local optimizer: try dropping low-priority heads one-by-one if
 * binary coverage and predicted DU stay within thresholds.
 * Operates on already-placed heads (post-layout).
 */
export function refineHeadSet(
  heads: SprinklerHead[],
  lawns: DrawnZone[],
  obstacles: DrawnZone[],
  opts?: { minCoveragePct?: number; minDUlq?: number },
): SprinklerHead[] {
  const minCov = opts?.minCoveragePct ?? 98;
  const minDu = opts?.minDUlq ?? 0.55;
  if (heads.length <= 4) return heads;

  let current = [...heads];
  // Prefer dropping interior (higher hydraulic zone noise) / non-corner first
  const order = [...current].sort((a, b) => {
    const pa = a.arcDeg >= 315 ? 3 : a.arcDeg >= 170 ? 1 : 0;
    const pb = b.arcDeg >= 315 ? 3 : b.arcDeg >= 170 ? 1 : 0;
    return pb - pa;
  });

  for (const candidate of order) {
    if (current.length <= 4) break;
    const without = current.filter((h) => h.id !== candidate.id);
    const m = estimatePlanMetrics(lawns, without, obstacles);
    if (
      m.binaryCoveragePct >= minCov &&
      (m.predictedDUlq == null || m.predictedDUlq >= minDu) &&
      (m.largestDryPatchM2 ?? 0) < 4
    ) {
      current = without;
    }
  }
  return current;
}
