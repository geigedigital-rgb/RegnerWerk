import type { SofortPlan } from "./types";
import type { SofortPlanV2 } from "./v2/types";
import { ZONE_COLORS } from "./v1/hydraulics";

/** Map full v2 engineering model → shared UI / persistence SofortPlan. */
export function adaptV2ToViewModel(plan: SofortPlanV2): SofortPlan {
  return {
    version: 1,
    algorithmVersion: "v2",
    createdAt: plan.createdAt,
    brand: plan.brand,
    heads: plan.heads.map((h) => ({
      id: h.id,
      position: h.position,
      kind: h.kind,
      configKey: h.sku,
      radiusM: h.actualRadiusM,
      arcDeg: h.arcDeg,
      rotationDeg: h.rotationDeg,
      flowLMin: h.flowLpm,
      lawnZoneId: h.lawnZoneId,
      hydraulicZone: h.hydraulicZone,
      lineEnd: h.lineEnd,
      stripWidthM: h.stripWidthM,
      stripLengthM: h.stripLengthM,
      designPressureBar: h.designPressureBar,
    })),
    pipes: plan.pipeSegments.map((p) => ({
      id: p.id,
      kind: p.kind,
      hydraulicZone: p.valveZoneId
        ? Number(p.valveZoneId.replace("valve-", ""))
        : null,
      points: p.points,
      lengthM: p.lengthM,
      odMm: p.odMm,
      idMm: p.idMm,
      flowLMin: p.flowLpm,
      velocityMps: p.velocityMps,
      frictionLossBar: p.frictionLossBar,
      startPressureBar: p.startPressureBar,
      endPressureBar: p.endPressureBar,
    })),
    zones: plan.valveZones.map((z) => ({
      index: z.index,
      headIds: z.headIds,
      flowLMin: z.flowLpm,
      pipeLengthM: z.pipeLengthM,
      color: ZONE_COLORS[z.index % ZONE_COLORS.length],
    })),
    bom: plan.bom,
    totalKnownEur: plan.totalKnownEur,
    hasUnknownPrices: plan.hasUnknownPrices,
    warnings: [
      ...plan.blockers.map((b) => b.message),
      ...plan.warnings.map((w) => w.message),
    ],
    assumptions: plan.assumptions.map((a) => a.message),
    sourceFlowLMin: plan.sourceFlowLMin,
    lawnAreaM2: plan.lawnAreaM2,
    dripAreaM2: plan.dripAreaM2,
    coveragePct: plan.metrics.binaryCoveragePct,
    projectLevel: plan.projectLevel,
    confidence: plan.confidence,
    blockers: plan.blockers.map((b) => b.message),
    metrics: plan.metrics,
    hydraulicSummary: plan.hydraulicSummary,
    requiresBackflowProtectionReview: plan.requiresBackflowProtectionReview,
    catalogVersion: plan.catalogVersion,
    algorithmBuild: plan.algorithmBuild,
  };
}

/** Ensure legacy persisted plans without algorithmVersion default to v1. */
export function normalizeLoadedPlan(plan: SofortPlan): SofortPlan {
  if (!plan.algorithmVersion) {
    return { ...plan, algorithmVersion: "v1" };
  }
  return plan;
}
