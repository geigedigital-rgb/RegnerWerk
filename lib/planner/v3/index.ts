import {
  distMeters,
  polygonAreaM2,
  type DrawnZone,
  type PlotFixture,
} from "@/lib/mapbox";
import {
  CATALOG,
  DEFAULT_BRAND,
  brandEmitters,
  type SprinklerBrand,
} from "../catalog";
import { buildBom } from "./bom";
import { estimatePlanMetrics } from "./coverage";
import { designDripLayouts } from "./drip";
import {
  buildZoneInfos,
  iteratePressureFlowRadius,
  pressureWarnings,
  routePipes,
  sizePipesAndSolveHydraulics,
} from "./hydraulics";
import { layoutLawnZone } from "./layout";
import { refineHeadSet } from "./optimize";
import type { SofortPlan, SprinklerHead } from "../types";
import type {
  LandscapeHydrozone,
  SofortPlanV3,
  ValveZone,
  WarningItem,
  ZoneDecision,
} from "./types";
import {
  assertHonestLevel,
  classifyProjectLevel,
  computeConfidence,
  defaultAssumptions,
  extractSourceCurve,
} from "./validation";
import { adaptV2ToViewModel } from "../adapt";
import { designValveZones } from "./zoning";

export { ZONE_COLORS, ZONE_COLORS_CANVAS, zoneColor } from "./hydraulics";
export { headScreenLabel } from "./layout";
export { resolveHeadProduct, type HeadProductInfo } from "./headProduct";
export type { SofortPlanV3 } from "./types";

const ALGORITHM_BUILD = "v3.stage1-zoning-2026.08";

/**
 * Sofort-Berechnung v3 — iterative engineering pipeline per spec.
 * Returns UI view model via adapter; use computeSofortPlanV3Raw for full model.
 */
export function computeSofortPlanV3(
  zones: DrawnZone[],
  fixtures: PlotFixture[],
  opts?: { brand?: SprinklerBrand },
): SofortPlan {
  return adaptV2ToViewModel(computeSofortPlanV3Raw(zones, fixtures, opts));
}

export function computeSofortPlanV3Raw(
  zones: DrawnZone[],
  fixtures: PlotFixture[],
  opts?: { brand?: SprinklerBrand },
): SofortPlanV3 {
  const brand = opts?.brand ?? DEFAULT_BRAND;
  const emitters = brandEmitters(brand);
  const warningItems: WarningItem[] = [];
  const blockers: WarningItem[] = [];

  const verteiler = fixtures.find((f) => f.kind === "wasserverteiler") ?? null;
  const quelle = fixtures.find((f) => f.kind === "wasserquelle") ?? null;
  const smart = fixtures.find((f) => f.kind === "smarthome") ?? null;

  const lawns = zones.filter((z) => z.type === "rasen");
  const dripZones = zones.filter((z) => z.type === "beet" || z.type === "hecke");
  const obstacles = zones.filter((z) => z.type === "gebaeude");

  if (lawns.length === 0) {
    warningItems.push({
      code: "NO_LAWN",
      severity: "WARNING",
      message: "Keine Rasenfläche gezeichnet — es wurden keine Regner gesetzt.",
    });
  }

  let rawHeads: Omit<SprinklerHead, "hydraulicZone" | "lineEnd">[] = [];
  let lawnAreaM2 = 0;
  const hydrozones: LandscapeHydrozone[] = [];

  for (const lawn of lawns) {
    const res = layoutLawnZone(lawn, obstacles, brand);
    rawHeads = rawHeads.concat(res.heads);
    lawnAreaM2 += res.areaM2;
    for (const w of res.warnings) {
      warningItems.push({ code: "LAYOUT", severity: "WARNING", message: w });
    }
    hydrozones.push({
      id: `hz-${lawn.id}`,
      lawnZoneId: lawn.id,
      plantWaterNeed: "lawn",
      irrigationMethod: "spray",
      areaM2: res.areaM2,
    });
  }

  // Stage 2: local set refinement across all lawns
  {
    const seededTmp: SprinklerHead[] = rawHeads.map((h, i) => ({
      ...h,
      hydraulicZone: 0,
      id: h.id || `tmp-${i}`,
    }));
    const refined = refineHeadSet(seededTmp, lawns, obstacles);
    rawHeads = refined;
  }

  const source = extractSourceCurve(fixtures);
  const assumptions = defaultAssumptions({
    assumedFlow: source.assumedFlow,
    sourceCurveUsed: source.sourceCurveUsed,
    brand,
  });

  const seeded: SprinklerHead[] = rawHeads.map((h) => ({
    ...h,
    hydraulicZone: 0,
    designPressureBar: CATALOG.hydraulics.recommendedPressureBar,
  }));

  const verteilerPos = verteiler?.position ?? quelle?.position ?? null;
  let heads: SprinklerHead[] = seeded;
  let zoneCount = 0;
  let zoneDecisions: ZoneDecision[] = [];
  if (verteilerPos && seeded.length > 0) {
    const zoned = designValveZones({
      heads: seeded,
      lawns,
      obstacles,
      sourceFlowLMin: source.flowLMin,
      verteilerPos,
      brand,
      allZones: zones,
    });
    heads = zoned.heads;
    zoneCount = zoned.zoneCount;
    zoneDecisions = zoned.decisions;
    for (const a of zoned.assumptions) {
      assumptions.push({ code: "MANAGEMENT_AREA", message: a });
    }
    for (const w of zoned.warnings) {
      warningItems.push({ code: "ZONING", severity: "WARNING", message: w });
    }
    if (zoned.overflow) {
      warningItems.push({
        code: "SOURCE_OVERFLOW",
        severity: "WARNING",
        message:
          "Mindestens ein Regner braucht mehr Wasser als die Quelle liefert — Quelle prüfen.",
      });
    }
  } else if (seeded.length > 0) {
    warningItems.push({
      code: "NO_VERTEILER",
      severity: "WARNING",
      message: "Kein Wasserverteiler gesetzt — Zonen/Leitungen nicht berechnet.",
    });
  }

  let pipes: SofortPlan["pipes"] = [];
  const sourcePressure =
    source.dynamicPressureBar ??
    CATALOG.hydraulics.assumedVerteilerPressureBar;

  let hydraulicSized: ReturnType<typeof sizePipesAndSolveHydraulics> | undefined;

  if (verteilerPos && heads.length > 0) {
    const routed = routePipes(
      heads,
      verteilerPos,
      quelle?.position ?? null,
      obstacles,
    );
    pipes = routed.pipes;
    heads = routed.headsWithLineEnd;
    for (const w of routed.warnings) {
      warningItems.push({ code: "PIPE", severity: "WARNING", message: w });
    }

    const iterated = iteratePressureFlowRadius(
      heads,
      pipes,
      sourcePressure,
      brand,
    );
    heads = iterated.heads;
    if (!iterated.converged) {
      warningItems.push({
        code: "HYDRAULICS_NOT_CONVERGED",
        severity: "WARNING",
        message: `Hydraulischer Solver nicht konvergiert nach ${iterated.iterations} Iterationen — Ergebnis prüfen.`,
      });
    }

    hydraulicSized = sizePipesAndSolveHydraulics(heads, pipes, sourcePressure);
    pipes = hydraulicSized.pipes;
    for (const w of pressureWarnings(heads, pipes)) {
      warningItems.push({ code: "PRESSURE", severity: "WARNING", message: w });
    }
  }

  const metrics = estimatePlanMetrics(lawns, heads, obstacles);
  if (metrics.predictedDUlq != null && metrics.predictedDUlq < 0.55) {
    warningItems.push({
      code: "LOW_DU",
      severity: "WARNING",
      message: `Predicted DU_lq ≈ ${metrics.predictedDUlq.toFixed(2)} unter Schwelle — Layout prüfen.`,
    });
  }
  if ((metrics.buildingOversprayPct ?? 0) > 0.5) {
    warningItems.push({
      code: "BUILDING_OVERSPRAY",
      severity: "WARNING",
      message: "Berechneter Gebäude-Überspray — Sektoren/Radien prüfen.",
    });
  }

  const drip = designDripLayouts(dripZones);
  for (const w of drip.warnings) {
    warningItems.push({ code: "DRIP", severity: "WARNING", message: w });
  }
  let dripAreaM2 = 0;
  for (const dz of dripZones) dripAreaM2 += polygonAreaM2(dz.coordinates);
  if (dripAreaM2 > 0) {
    assumptions.push({
      code: "DRIP_ESTIMATE",
      message: `Beet/Hecke (${Math.round(dripAreaM2)} m²): Tropfnetz geschätzt (${CATALOG.drip.rowSpacingM} m Reihenabstand).`,
    });
  }

  const wireLengthM =
    smart && verteilerPos
      ? distMeters(smart.position, verteilerPos) + 5
      : zoneCount > 0
        ? 10
        : 0;

  const { bom, totalKnownEur, hasUnknownPrices, manifoldSummary } = buildBom({
    heads,
    pipes,
    zoneCount,
    wireLengthM,
    dripTubeLengthM: drip.tubeLengthM,
    brand,
  });

  const requiresBackflowProtectionReview = true;

  const projectLevel = assertHonestLevel({
    projectLevel: classifyProjectLevel({
      assumedFlow: source.assumedFlow,
      sourceCurveUsed: source.sourceCurveUsed,
      hasHeights: false,
      scaleConfirmed: false,
      blockers,
      backflowApproved: false,
    }),
    hydraulicSummary: {
      sourceCurveUsed: source.sourceCurveUsed,
    },
    requiresBackflowProtectionReview,
  });

  if (projectLevel === "ESTIMATE") {
    assumptions.push({
      code: "ESTIMATE_ONLY",
      message:
        "Ergebnisstufe ESTIMATE — Zonenzahl, Rohrdurchmesser und Regnerfunktion ohne bestätigte Q–P-Kurve nicht verifiziert. Vor Montage messen.",
    });
  }

  const hydraulicSummary = {
    sourceCurveUsed: source.sourceCurveUsed,
    criticalZoneId: hydraulicSized?.criticalZoneId,
    requiredSourcePressureBar: hydraulicSized?.requiredSourcePressureBar,
    availableSourcePressureBar: sourcePressure,
    minimumPressureMarginBar: hydraulicSized?.minimumPressureMarginBar,
    maxVelocityMps: hydraulicSized?.maxVelocityMps,
  };

  const confidence = computeConfidence({
    projectLevel,
    assumedFlow: source.assumedFlow,
    sourceCurveUsed: source.sourceCurveUsed,
    predictedDUlq: metrics.predictedDUlq,
    pressureMarginBar: hydraulicSummary.minimumPressureMarginBar,
    complexGeometry: lawns.length > 1 || obstacles.length > 0,
  });

  const valveZones: ValveZone[] = buildZoneInfos(heads, pipes).map((z) => ({
    id: `valve-${z.index}`,
    index: z.index,
    headIds: z.headIds,
    flowLpm: z.flowLMin,
    precipitationClass: "matched",
    pipeLengthM: z.pipeLengthM,
  }));

  const bodySku = emitters.sprayHead.bodyLabel;

  return {
    projectLevel,
    confidence,
    assumptions,
    blockers,
    warnings: warningItems,
    hydrozones,
    valveZones,
    heads: heads.map((h) => ({
      id: h.id,
      position: h.position,
      sku: h.configKey,
      bodySku,
      kind: h.kind,
      arcDeg: h.arcDeg,
      rotationDeg: h.rotationDeg,
      designPressureBar:
        h.designPressureBar ?? CATALOG.hydraulics.recommendedPressureBar,
      actualRadiusM: h.radiusM,
      flowLpm: h.flowLMin,
      precipitationClass: h.configKey.startsWith("MP8")
        ? "mp800"
        : h.kind === "rotor"
          ? "rotor"
          : h.kind === "strip"
            ? "strip"
            : "spray",
      adjustmentPct: 0,
      lawnZoneId: h.lawnZoneId,
      hydraulicZone: h.hydraulicZone,
      lineEnd: h.lineEnd,
      stripWidthM: h.stripWidthM,
      stripLengthM: h.stripLengthM,
    })),
    dripNetworks: drip.networks,
    pipeSegments: pipes.map((p) => ({
      id: p.id,
      kind: p.kind,
      valveZoneId:
        p.hydraulicZone != null ? `valve-${p.hydraulicZone}` : null,
      points: p.points,
      lengthM: p.lengthM,
      flowLpm: p.flowLMin ?? 0,
      odMm: p.odMm ?? (p.kind === "main" ? 32 : 25),
      idMm:
        p.idMm ??
        (p.kind === "main"
          ? CATALOG.hydraulics.pe32InternalDiameterMm
          : CATALOG.hydraulics.pe25InternalDiameterMm),
      velocityMps: p.velocityMps ?? 0,
      frictionLossBar: p.frictionLossBar ?? 0,
      minorLossBar: 0,
      startPressureBar: p.startPressureBar ?? sourcePressure,
      endPressureBar: p.endPressureBar ?? sourcePressure,
    })),
    metrics: {
      ...metrics,
      binaryCoveragePct: metrics.binaryCoveragePct,
    },
    hydraulicSummary,
    bom,
    totalKnownEur,
    hasUnknownPrices,
    sourceFlowLMin: Number(source.flowLMin.toFixed(1)),
    lawnAreaM2: Math.round(lawnAreaM2),
    dripAreaM2: Math.round(dripAreaM2),
    brand,
    catalogVersion: CATALOG.hydraulics.catalogVersion ?? "planner",
    algorithmVersion: "v3",
    algorithmBuild: ALGORITHM_BUILD,
    requiresBackflowProtectionReview,
    createdAt: new Date().toISOString(),
    zoneDecisions,
    manifoldSummary,
  };
}

/** Recompute after drag/delete — reuse v3 professional zoning + pipe sizing. */
export function recomputeAfterEditV3(
  plan: SofortPlan,
  fixtures: PlotFixture[],
  zones: DrawnZone[],
): SofortPlan {
  const brand = plan.brand ?? DEFAULT_BRAND;
  const verteiler = fixtures.find((f) => f.kind === "wasserverteiler") ?? null;
  const quelle = fixtures.find((f) => f.kind === "wasserquelle") ?? null;
  const smart = fixtures.find((f) => f.kind === "smarthome") ?? null;
  const verteilerPos = verteiler?.position ?? quelle?.position ?? null;
  const source = extractSourceCurve(fixtures);
  const sourcePressure =
    source.dynamicPressureBar ??
    CATALOG.hydraulics.assumedVerteilerPressureBar;

  let heads = plan.heads;
  let zoneCount = plan.zones.length;
  let zoneDecisions = plan.zoneDecisions;
  let pipes: SofortPlan["pipes"] = [];
  const warnings = [...plan.warnings.filter((w) => !w.startsWith("Zone "))];

  if (verteilerPos && heads.length > 0) {
    const lawns = zones.filter((z) => z.type === "rasen");
    const obstacles = zones.filter((oz) => oz.type === "gebaeude");
    const zoned = designValveZones({
      heads,
      lawns,
      obstacles,
      sourceFlowLMin: source.flowLMin,
      verteilerPos,
      brand,
      allZones: zones,
    });
    heads = zoned.heads;
    zoneCount = zoned.zoneCount;
    zoneDecisions = zoned.decisions.map((d) => ({
      zoneId: d.zoneId,
      primaryReason: d.primaryReason,
      explanation: d.explanation,
      flowLpm: d.flowLpm,
    }));
    warnings.push(...zoned.warnings);
    const routed = routePipes(
      heads,
      verteilerPos,
      quelle?.position ?? null,
      obstacles,
    );
    pipes = routed.pipes;
    heads = routed.headsWithLineEnd;
    warnings.push(...routed.warnings);
    const iterated = iteratePressureFlowRadius(
      heads,
      pipes,
      sourcePressure,
      brand,
    );
    heads = iterated.heads;
    const sized = sizePipesAndSolveHydraulics(heads, pipes, sourcePressure);
    pipes = sized.pipes;
    warnings.push(...pressureWarnings(heads, pipes));
  }

  const lawns = zones.filter((z) => z.type === "rasen");
  const obstacles = zones.filter((z) => z.type === "gebaeude");
  const metrics = estimatePlanMetrics(lawns, heads, obstacles);
  const dripZones = zones.filter((z) => z.type === "beet" || z.type === "hecke");
  const drip = designDripLayouts(dripZones);
  let dripAreaM2 = 0;
  for (const dz of dripZones) dripAreaM2 += polygonAreaM2(dz.coordinates);

  const wireLengthM =
    smart && verteilerPos ? distMeters(smart.position, verteilerPos) + 5 : 10;

  const { bom, totalKnownEur, hasUnknownPrices, manifoldSummary } = buildBom({
    heads,
    pipes,
    zoneCount,
    wireLengthM,
    dripTubeLengthM: drip.tubeLengthM,
    brand,
  });

  return {
    ...plan,
    algorithmVersion: "v3",
    createdAt: new Date().toISOString(),
    brand,
    heads,
    pipes,
    zones: buildZoneInfos(heads, pipes),
    bom,
    totalKnownEur,
    hasUnknownPrices,
    warnings: [...new Set(warnings)],
    coveragePct: metrics.binaryCoveragePct,
    metrics,
    dripAreaM2: Math.round(dripAreaM2),
    requiresBackflowProtectionReview: true,
    zoneDecisions,
    manifoldSummary,
  };
}
