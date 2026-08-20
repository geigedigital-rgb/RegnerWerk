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
  AUTO_LAYOUT_ROTORS_ENABLED,
  largestSprayFamilySpec,
  sprayConfigKey,
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
  SofortPlanV4,
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
export type { SofortPlanV4 } from "./types";

const ALGORITHM_BUILD = "v4.compact-zones-2026.08";

/**
 * Extract the spray family key from a configKey (e.g. "R-VAN18" → "R-VAN18",
 * "R-VAN14-360" → "R-VAN14", "3504@2.0" → "3504").
 */
function headFamilyKey(h: SprinklerHead): string {
  const ck = h.configKey;
  // "R-VAN14-360" → "R-VAN14", "MP3000" → "MP3000", "3504@2.0" → "3504"
  const atIdx = ck.indexOf("@");
  const base = atIdx >= 0 ? ck.slice(0, atIdx) : ck;
  // Strip trailing angle suffix like "-360", "-180"
  const match = base.match(/^(.+?)-\d{2,3}$/);
  return match ? match[1] : base;
}

/**
 * Pre-zoning pass: convert all rotor heads to the largest spray family
 * when their radius is within range. Runs before zoning so the zone
 * partitioning never sees mixed rotor/spray.
 */
function convertRotorHeadToSpray<T extends {
  kind: string;
  configKey: string;
  radiusM: number;
  arcDeg: number;
  flowLMin: number;
}>(h: T, brand: SprinklerBrand): T {
  const emitters = brandEmitters(brand);
  const fb = largestSprayFamilySpec(brand, emitters, h.arcDeg);
  if (!fb) return h;
  const baseKey = fb.key.replace(/-360$/, "");
  const arcClamped =
    h.arcDeg >= 315
      ? 360
      : Math.max(
          fb.spec.arcMinDeg,
          Math.min(fb.spec.arcMaxDeg, h.arcDeg),
        );
  const clampedRadius = Math.max(
    fb.spec.radiusMinM,
    Math.min(fb.spec.radiusMaxM, h.radiusM),
  );
  return {
    ...h,
    kind: "spray",
    configKey: sprayConfigKey(baseKey, arcClamped),
    radiusM: clampedRadius,
    arcDeg: arcClamped,
    flowLMin:
      fb.spec.flow360LMin != null
        ? (fb.spec.flow360LMin * arcClamped) / 360
        : h.flowLMin,
  };
}

function convertRotorsToSpray<T extends { kind: string; configKey: string; radiusM: number; arcDeg: number; flowLMin: number }>(
  heads: T[],
  brand: SprinklerBrand,
): T[] {
  if (!AUTO_LAYOUT_ROTORS_ENABLED) {
    return heads.map((h) =>
      h.kind === "rotor" ? convertRotorHeadToSpray(h, brand) : h,
    );
  }

  const emitters = brandEmitters(brand);
  const nozzles = emitters.sprayHead.nozzles;

  let largestKey = "";
  let largestMax = 0;
  for (const [key, spec] of Object.entries(nozzles)) {
    if (spec.radiusMaxM > largestMax) {
      largestMax = spec.radiusMaxM;
      largestKey = key;
    }
  }
  const spec = nozzles[largestKey];
  if (!spec) return heads;

  const BUFFER = 1.0;
  return heads.map((h): T => {
    if (h.kind !== "rotor") return h;
    if (h.radiusM > spec.radiusMaxM + BUFFER) {
      return convertRotorHeadToSpray(h, brand);
    }
    if (h.arcDeg > spec.arcMaxDeg) {
      return convertRotorHeadToSpray(h, brand);
    }
    const clampedRadius = Math.max(spec.radiusMinM, Math.min(spec.radiusMaxM, h.radiusM));
    const arcClamped = Math.max(spec.arcMinDeg, Math.min(spec.arcMaxDeg, h.arcDeg));
    return {
      ...h,
      kind: "spray",
      configKey: sprayConfigKey(largestKey, arcClamped),
      radiusM: clampedRadius,
      arcDeg: arcClamped,
      flowLMin: spec.flow360LMin != null ? (spec.flow360LMin * arcClamped) / 360 : h.flowLMin,
    };
  });
}

/**
 * After zoning, enforce that each valve zone uses a single spray family.
 * If the dominant family is a spray (R-VAN*), rotors (3504/I-20) are converted
 * when their radius fits. If no spray nozzle spec is found for the dominant key,
 * we fall back to the largest available spray family for conversions.
 */
function enforceZoneFamilyConsistency(
  heads: SprinklerHead[],
  brand: SprinklerBrand,
): SprinklerHead[] {
  const emitters = brandEmitters(brand);
  const nozzles = emitters.sprayHead.nozzles;

  // Find the largest spray family by radiusMaxM for fallback
  let largestSprayKey = "";
  let largestSprayMax = 0;
  for (const [key, spec] of Object.entries(nozzles)) {
    if (spec.radiusMaxM > largestSprayMax) {
      largestSprayMax = spec.radiusMaxM;
      largestSprayKey = key;
    }
  }

  // Global pass first: if project-wide dominant is a spray, convert all rotors
  const globalFamilyCounts = new Map<string, number>();
  const globalSprayCounts = new Map<string, number>();
  for (const h of heads) {
    const fk = headFamilyKey(h);
    globalFamilyCounts.set(fk, (globalFamilyCounts.get(fk) ?? 0) + 1);
    if (h.kind === "spray") {
      globalSprayCounts.set(fk, (globalSprayCounts.get(fk) ?? 0) + 1);
    }
  }
  let globalTargetKey = largestSprayKey;
  let globalMaxSprayCount = 0;
  for (const [fk, count] of globalSprayCounts) {
    if (count > globalMaxSprayCount) { globalMaxSprayCount = count; globalTargetKey = fk; }
  }
  const globalTargetSpec = nozzles[globalTargetKey];

  const isRotorKey = (fk: string) =>
    fk === "3504" || fk === "I-20" || fk.startsWith("3504") || fk.startsWith("I-20");

  // Convert rotors globally before per-zone enforcement
  const preProcessed: SprinklerHead[] = [];
  if (globalTargetSpec) {
    const GLOBAL_BUFFER = AUTO_LAYOUT_ROTORS_ENABLED ? 1.0 : Infinity;
    for (const h of heads) {
      const fk = headFamilyKey(h);
      if (
        isRotorKey(fk) &&
        (!AUTO_LAYOUT_ROTORS_ENABLED ||
          (h.radiusM <= globalTargetSpec.radiusMaxM + GLOBAL_BUFFER &&
            h.arcDeg <= globalTargetSpec.arcMaxDeg))
      ) {
        preProcessed.push(
          AUTO_LAYOUT_ROTORS_ENABLED
            ? {
                ...h,
                kind: "spray",
                configKey: sprayConfigKey(
                  globalTargetKey,
                  Math.max(
                    globalTargetSpec.arcMinDeg,
                    Math.min(globalTargetSpec.arcMaxDeg, h.arcDeg),
                  ),
                ),
                radiusM: Math.max(
                  globalTargetSpec.radiusMinM,
                  Math.min(globalTargetSpec.radiusMaxM, h.radiusM),
                ),
                arcDeg: Math.max(
                  globalTargetSpec.arcMinDeg,
                  Math.min(globalTargetSpec.arcMaxDeg, h.arcDeg),
                ),
                flowLMin:
                  globalTargetSpec.flow360LMin != null
                    ? (globalTargetSpec.flow360LMin *
                        Math.max(
                          globalTargetSpec.arcMinDeg,
                          Math.min(globalTargetSpec.arcMaxDeg, h.arcDeg),
                        )) /
                      360
                    : h.flowLMin,
              }
            : convertRotorHeadToSpray(h, brand),
        );
      } else {
        preProcessed.push(h);
      }
    }
  } else {
    preProcessed.push(...heads);
  }

  // Regroup after global pass
  const zoneHeadsPost = new Map<number, SprinklerHead[]>();
  for (const h of preProcessed) {
    const z = h.hydraulicZone;
    if (!zoneHeadsPost.has(z)) zoneHeadsPost.set(z, []);
    zoneHeadsPost.get(z)!.push(h);
  }

  const result: SprinklerHead[] = [];

  for (const [, zh] of zoneHeadsPost) {
    const familyCounts = new Map<string, number>();
    const sprayCounts = new Map<string, number>();
    for (const h of zh) {
      const fk = headFamilyKey(h);
      familyCounts.set(fk, (familyCounts.get(fk) ?? 0) + 1);
      if (h.kind === "spray") {
        sprayCounts.set(fk, (sprayCounts.get(fk) ?? 0) + 1);
      }
    }

    if (familyCounts.size <= 1) {
      result.push(...zh);
      continue;
    }

    // Dominant = most common family overall
    let dominantFamily = "";
    let maxCount = 0;
    for (const [fk, count] of familyCounts) {
      if (count > maxCount) { maxCount = count; dominantFamily = fk; }
    }

    // If dominant is a rotor, prefer the most common spray instead
    // (rotors should only dominate if there are no sprays at all)
    if (isRotorKey(dominantFamily) && sprayCounts.size > 0) {
      let bestSpray = "";
      let bestCount = 0;
      for (const [fk, count] of sprayCounts) {
        if (count > bestCount) { bestCount = count; bestSpray = fk; }
      }
      if (bestSpray) dominantFamily = bestSpray;
    }

    // Resolve nozzle spec: try dominant key, then fall back to largest spray
    let targetKey = dominantFamily;
    let targetSpec = nozzles[targetKey];
    if (!targetSpec && largestSprayKey) {
      targetKey = largestSprayKey;
      targetSpec = nozzles[targetKey];
    }
    if (!targetSpec) {
      result.push(...zh);
      continue;
    }

    const BUFFER = 1.0;
    for (const h of zh) {
      const fk = headFamilyKey(h);
      if (fk === targetKey) {
        result.push(h);
        continue;
      }

      const sourceSpec = nozzles[fk];
      // Never downgrade spray family (e.g. MP2000 → MP1000) — kills throw & coverage.
      if (
        h.kind === "spray" &&
        sourceSpec &&
        !isRotorKey(fk)
      ) {
        result.push(h);
        continue;
      }

      // Convert rotors (or missing spec) to target spray when radius/arc fit
      if (
        h.radiusM >= targetSpec.radiusMinM - BUFFER &&
        h.radiusM <= targetSpec.radiusMaxM + BUFFER &&
        h.arcDeg <= targetSpec.arcMaxDeg
      ) {
        const clampedRadius = Math.max(
          targetSpec.radiusMinM,
          Math.min(targetSpec.radiusMaxM, h.radiusM),
        );
        const arcClamped = Math.max(
          targetSpec.arcMinDeg,
          Math.min(targetSpec.arcMaxDeg, h.arcDeg),
        );
        result.push({
          ...h,
          kind: "spray",
          configKey: targetKey,
          radiusM: clampedRadius,
          arcDeg: arcClamped,
          flowLMin: targetSpec.flow360LMin != null
            ? (targetSpec.flow360LMin * arcClamped) / 360
            : h.flowLMin,
        });
      } else {
        result.push(h);
      }
    }
  }

  return result;
}

/**
 * Sofort-Berechnung v3 — iterative engineering pipeline per spec.
 * Returns UI view model via adapter; use computeSofortPlanV4Raw for full model.
 */
export function computeSofortPlanV4(
  zones: DrawnZone[],
  fixtures: PlotFixture[],
  opts?: { brand?: SprinklerBrand },
): SofortPlan {
  return adaptV2ToViewModel(computeSofortPlanV4Raw(zones, fixtures, opts));
}

export function computeSofortPlanV4Raw(
  zones: DrawnZone[],
  fixtures: PlotFixture[],
  opts?: { brand?: SprinklerBrand },
): SofortPlanV4 {
  const brand = opts?.brand ?? DEFAULT_BRAND;
  const emitters = brandEmitters(brand);
  const warningItems: WarningItem[] = [];
  const blockers: WarningItem[] = [];

  const verteiler = fixtures.find((f) => f.kind === "wasserverteiler") ?? null;
  const quelle = fixtures.find((f) => f.kind === "wasserquelle") ?? null;
  const smart = fixtures.find((f) => f.kind === "smarthome") ?? null;

  const lawns = zones.filter((z) => z.type === "rasen");
  const dripZones = zones.filter((z) => z.type === "beet" || z.type === "hecke");
  const obstacles = zones.filter((z) => z.type === "gebaeude" || z.type === "trocken");

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
    const refined = refineHeadSet(seededTmp, lawns, obstacles, { brand });
    rawHeads = refined;
  }

  const source = extractSourceCurve(fixtures);
  const assumptions = defaultAssumptions({
    assumedFlow: source.assumedFlow,
    sourceCurveUsed: source.sourceCurveUsed,
    brand,
  });

  // Pre-zoning: convert all rotors to the largest spray family when radius allows.
  // This ensures zoning never sees mixed rotor/spray families.
  const preZoning = convertRotorsToSpray(rawHeads, brand);

  const seeded: SprinklerHead[] = preZoning.map((h) => ({
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
    heads = enforceZoneFamilyConsistency(zoned.heads, brand);
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
    algorithmVersion: "v4",
    algorithmBuild: ALGORITHM_BUILD,
    requiresBackflowProtectionReview,
    createdAt: new Date().toISOString(),
    zoneDecisions,
    manifoldSummary,
  };
}

/** Recompute after drag/delete — reuse v3 professional zoning + pipe sizing. */
export function recomputeAfterEditV4(
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
    const obstacles = zones.filter((oz) => oz.type === "gebaeude" || oz.type === "trocken");
    heads = convertRotorsToSpray(heads, brand);
    const zoned = designValveZones({
      heads,
      lawns,
      obstacles,
      sourceFlowLMin: source.flowLMin,
      verteilerPos,
      brand,
      allZones: zones,
    });
    heads = enforceZoneFamilyConsistency(zoned.heads, brand);
    zoneCount = zoned.zoneCount;
    zoneDecisions = zoned.decisions.map((d) => ({
      zoneId: d.zoneId,
      primaryReason: d.primaryReason,
      explanation: d.explanation,
      flowLpm: d.flowLpm,
      targetBalancedFlowLpm: d.targetBalancedFlowLpm,
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
  const obstacles = zones.filter((z) => z.type === "gebaeude" || z.type === "trocken");
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
    algorithmVersion: "v4",
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
