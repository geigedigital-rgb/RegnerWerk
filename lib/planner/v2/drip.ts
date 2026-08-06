import type { DrawnZone } from "@/lib/mapbox";
import { polygonAreaM2 } from "@/lib/mapbox";
import { CATALOG } from "../catalog";
import type { DripNetwork } from "./types";

/**
 * Stage 3 drip design — geometric drip network estimate.
 * Full emitter layout (headers/flush) is approximated; lengths are checked
 * against a max lateral guideline.
 */
export function designDripLayouts(
  dripZones: DrawnZone[],
): { networks: DripNetwork[]; tubeLengthM: number; warnings: string[] } {
  const warnings: string[] = [];
  const networks: DripNetwork[] = [];
  let tubeLengthM = 0;
  const rowSpacing = CATALOG.drip.rowSpacingM;
  const emitterSpacing = CATALOG.drip.tube.emitterSpacingM;
  const maxLateralM = 80; // conservative product guideline placeholder

  for (const z of dripZones) {
    const area = polygonAreaM2(z.coordinates);
    if (area <= 0) continue;
    const isHedge = z.type === "hecke";
    // Hedge: linear mode ≈ perimeter/2 as run length; bed: area / rowSpacing
    let lengthM: number;
    if (isHedge) {
      // Approximate centerline length from area / typical hedge width 0.6 m
      lengthM = Math.ceil(area / 0.6);
    } else {
      lengthM = Math.ceil(area / rowSpacing);
    }
    if (lengthM > maxLateralM) {
      warnings.push(
        `Tropf ${z.type}: geschätzte Lateral ${lengthM} m > ${maxLateralM} m — in Abschnitte teilen / Druck prüfen.`,
      );
    }
    const emitterCount = Math.max(
      1,
      Math.ceil(lengthM / Math.max(0.1, emitterSpacing)),
    );
    const flowLh = emitterCount * CATALOG.drip.tube.emitterFlowLh;
    const flowLpm = flowLh / 60;
    networks.push({
      zoneId: z.id,
      tubeLengthM: lengthM,
      emitterCount,
      flowLpm: Number(flowLpm.toFixed(2)),
      estimated: true,
    });
    tubeLengthM += lengthM;
  }

  return { networks, tubeLengthM, warnings };
}
