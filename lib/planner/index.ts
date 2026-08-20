import type { DrawnZone, PlotFixture } from "@/lib/mapbox";
import { DEFAULT_BRAND, type SprinklerBrand } from "./catalog";
import type { AlgorithmVersion, SofortPlan } from "./types";
import { normalizeLoadedPlan } from "./adapt";
import {
  computeSofortPlanV1,
  recomputeAfterEditV1,
} from "./v1";
import {
  computeSofortPlanV2,
  recomputeAfterEditV2,
} from "./v2";
import {
  computeSofortPlanV3,
  recomputeAfterEditV3,
} from "./v3";
import {
  computeSofortPlanV4,
  recomputeAfterEditV4,
} from "./v4";

export type {
  SofortPlan,
  SprinklerHead,
  BomLine,
  PipeRun,
  HydraulicZoneInfo,
  AlgorithmVersion,
  ProjectLevel,
  PlanMetrics,
  HydraulicSummary,
  ZoneDecisionSummary,
  ManifoldSummary,
} from "./types";

export { ZONE_COLORS, ZONE_COLORS_CANVAS, zoneColor } from "./v1/hydraulics";
export { headScreenLabel } from "./v1/layout";
export { resolveHeadProduct, type HeadProductInfo } from "./v1/headProduct";
export { clampHeadGeometry, type HeadGeometryPatch } from "./clampHead";
export {
  patchFromDraggedEdge,
  polarScreen,
  screenBearingDeg,
  sectorEdges,
} from "./sectorEdit";
export { DEFAULT_BRAND, type SprinklerBrand } from "./catalog";
export { normalizeLoadedPlan };
export { computeSofortPlanV1, recomputeAfterEditV1 } from "./v1";
export {
  computeSofortPlanV2,
  computeSofortPlanV2Raw,
  recomputeAfterEditV2,
} from "./v2";
export {
  computeSofortPlanV3,
  computeSofortPlanV3Raw,
  recomputeAfterEditV3,
} from "./v3";
export {
  computeSofortPlanV4,
  computeSofortPlanV4Raw,
  recomputeAfterEditV4,
} from "./v4";

export type ComputeSofortOpts = {
  brand?: SprinklerBrand;
  algorithmVersion?: AlgorithmVersion;
};

/** Customer-facing Sofort planner — production default is algorithm v4. */
export const CLIENT_ALGORITHM: AlgorithmVersion = "v4";

/**
 * Public router: dispatch to v1–v4.
 * Client UI always uses CLIENT_ALGORITHM (v4); tests may pin older versions.
 */
export function computeSofortPlan(
  zones: DrawnZone[],
  fixtures: PlotFixture[],
  opts?: ComputeSofortOpts,
): SofortPlan {
  const brand = opts?.brand ?? DEFAULT_BRAND;
  const algorithmVersion = opts?.algorithmVersion ?? CLIENT_ALGORITHM;
  if (algorithmVersion === "v4") {
    return computeSofortPlanV4(zones, fixtures, { brand });
  }
  if (algorithmVersion === "v3") {
    return computeSofortPlanV3(zones, fixtures, { brand });
  }
  if (algorithmVersion === "v2") {
    return computeSofortPlanV2(zones, fixtures, { brand });
  }
  return computeSofortPlanV1(zones, fixtures, { brand });
}

export function recomputeAfterEdit(
  plan: SofortPlan,
  fixtures: PlotFixture[],
  zones: DrawnZone[],
): SofortPlan {
  const version = plan.algorithmVersion ?? "v1";
  if (version === "v4") {
    return recomputeAfterEditV4(plan, fixtures, zones);
  }
  if (version === "v3") {
    return recomputeAfterEditV3(plan, fixtures, zones);
  }
  if (version === "v2") {
    return recomputeAfterEditV2(plan, fixtures, zones);
  }
  return recomputeAfterEditV1(plan, fixtures, zones);
}
