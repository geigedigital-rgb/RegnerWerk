import {
  distMeters,
  polygonAreaM2,
  type DrawnZone,
  type PlotFixture,
} from "@/lib/mapbox";
import { CATALOG, DEFAULT_BRAND, type SprinklerBrand } from "../catalog";
import { buildBom } from "./bom";
import { estimateCoveragePct } from "./coverage";
import {
  assignHydraulicZones,
  buildZoneInfos,
  pressureWarnings,
  routePipes,
  sourceFlowLMin,
} from "./hydraulics";
import { layoutLawnZone } from "./layout";
import type { SofortPlan, SprinklerHead } from "../types";

export { ZONE_COLORS, ZONE_COLORS_CANVAS, zoneColor } from "./hydraulics";
export { headScreenLabel } from "./layout";
export { resolveHeadProduct, type HeadProductInfo } from "./headProduct";

/**
 * Sofort-Berechnung v1 (frozen): place sprinklers and pipes on the drawn plot
 * and derive a material list from the RegnerWerk assortment.
 */
export function computeSofortPlanV1(
  zones: DrawnZone[],
  fixtures: PlotFixture[],
  opts?: { brand?: SprinklerBrand },
): SofortPlan {
  const brand = opts?.brand ?? DEFAULT_BRAND;
  const warnings: string[] = [];
  const assumptions: string[] = [];

  const verteiler = fixtures.find((f) => f.kind === "wasserverteiler") ?? null;
  const quelle = fixtures.find((f) => f.kind === "wasserquelle") ?? null;
  const smart = fixtures.find((f) => f.kind === "smarthome") ?? null;

  const lawns = zones.filter((z) => z.type === "rasen");
  const dripZones = zones.filter((z) => z.type === "beet" || z.type === "hecke");
  const obstacles = zones.filter((z) => z.type === "gebaeude");

  if (lawns.length === 0) {
    warnings.push("Keine Rasenfläche gezeichnet — es wurden keine Regner gesetzt.");
  }

  let rawHeads: Omit<SprinklerHead, "hydraulicZone" | "lineEnd">[] = [];
  let lawnAreaM2 = 0;
  for (const lawn of lawns) {
    const res = layoutLawnZone(lawn, obstacles, brand);
    rawHeads = rawHeads.concat(res.heads);
    lawnAreaM2 += res.areaM2;
    warnings.push(...res.warnings);
  }

  const { flowLMin, assumed } = sourceFlowLMin(fixtures);
  if (assumed) {
    assumptions.push(
      `Wassermenge unbekannt — angenommen: ${CATALOG.hydraulics.defaultSourceFlowM3h.toLocaleString("de-DE")} m³/h. Eimer-Test verbessert das Ergebnis.`,
    );
  }
  const cap = flowLMin * CATALOG.hydraulics.zoneFillFactor;

  const seeded: SprinklerHead[] = rawHeads.map((h) => ({
    ...h,
    hydraulicZone: 0,
  }));

  const verteilerPos = verteiler?.position ?? quelle?.position ?? null;
  let heads: SprinklerHead[] = seeded;
  let zoneCount = 0;
  if (verteilerPos && seeded.length > 0) {
    const z = assignHydraulicZones(seeded, verteilerPos, cap);
    heads = z.heads;
    zoneCount = z.zoneCount;
    if (z.overflow) {
      warnings.push(
        "Mindestens ein Regner braucht mehr Wasser als die Quelle liefert — Quelle prüfen.",
      );
    }
  } else if (seeded.length > 0) {
    warnings.push("Kein Wasserverteiler gesetzt — Zonen/Leitungen nicht berechnet.");
  }

  let pipes: SofortPlan["pipes"] = [];
  if (verteilerPos && heads.length > 0) {
    const routed = routePipes(
      heads,
      verteilerPos,
      quelle?.position ?? null,
      obstacles,
    );
    pipes = routed.pipes;
    heads = routed.headsWithLineEnd;
    warnings.push(...routed.warnings);
    warnings.push(...pressureWarnings(heads, pipes));
  }

  const zoneInfos = buildZoneInfos(heads, pipes);
  const coveragePct = estimateCoveragePct(lawns, heads, obstacles);

  let dripAreaM2 = 0;
  for (const dz of dripZones) dripAreaM2 += polygonAreaM2(dz.coordinates);
  const dripTubeLengthM =
    dripAreaM2 > 0 ? Math.ceil(dripAreaM2 / CATALOG.drip.rowSpacingM) : 0;
  if (dripAreaM2 > 0) {
    assumptions.push(
      `Beet/Hecke (${Math.round(dripAreaM2)} m²): Tropfrohr-Schätzung mit ${CATALOG.drip.rowSpacingM} m Reihenabstand.`,
    );
  }

  const wireLengthM =
    smart && verteilerPos
      ? distMeters(smart.position, verteilerPos) + 5
      : zoneCount > 0
        ? 10
        : 0;

  const { bom, totalKnownEur, hasUnknownPrices } = buildBom({
    heads,
    pipes,
    zoneCount,
    wireLengthM,
    dripTubeLengthM,
    brand,
  });

  assumptions.push(
    `Regner-Marke: ${brand === "hunter" ? "Hunter MP / I-20" : "Rain Bird R-VAN / 3504"}.`,
  );
  assumptions.push(
    `Auslegung bei ${CATALOG.hydraulics.recommendedPressureBar.toLocaleString("de-DE")} bar am Regner, Kopf-zu-Kopf-Überdeckung.`,
  );
  assumptions.push(
    `Druck am Verteiler angenommen: ${CATALOG.hydraulics.assumedVerteilerPressureBar.toLocaleString("de-DE")} bar (Hazen-Williams-Check).`,
  );

  return {
    version: 1,
    algorithmVersion: "v1",
    createdAt: new Date().toISOString(),
    brand,
    heads,
    pipes,
    zones: zoneInfos,
    bom,
    totalKnownEur,
    hasUnknownPrices,
    warnings: [...new Set(warnings)],
    assumptions,
    sourceFlowLMin: Number(flowLMin.toFixed(1)),
    lawnAreaM2: Math.round(lawnAreaM2),
    dripAreaM2: Math.round(dripAreaM2),
    coveragePct,
  };
}

export function recomputeAfterEditV1(
  plan: SofortPlan,
  fixtures: PlotFixture[],
  zones: DrawnZone[],
): SofortPlan {
  const verteiler = fixtures.find((f) => f.kind === "wasserverteiler") ?? null;
  const quelle = fixtures.find((f) => f.kind === "wasserquelle") ?? null;
  const smart = fixtures.find((f) => f.kind === "smarthome") ?? null;
  const verteilerPos = verteiler?.position ?? quelle?.position ?? null;

  const { flowLMin } = sourceFlowLMin(fixtures);
  const cap = flowLMin * CATALOG.hydraulics.zoneFillFactor;

  let heads = plan.heads;
  let zoneCount = plan.zones.length;
  let pipes: SofortPlan["pipes"] = [];
  const warnings = [...plan.warnings.filter((w) => !w.startsWith("Zone "))];
  if (verteilerPos && heads.length > 0) {
    const z = assignHydraulicZones(heads, verteilerPos, cap);
    heads = z.heads;
    zoneCount = z.zoneCount;
    const obstacles = zones.filter((z) => z.type === "gebaeude");
    const routed = routePipes(
      heads,
      verteilerPos,
      quelle?.position ?? null,
      obstacles,
    );
    pipes = routed.pipes;
    heads = routed.headsWithLineEnd;
    warnings.push(...routed.warnings);
    warnings.push(...pressureWarnings(heads, pipes));
  }

  const lawns = zones.filter((z) => z.type === "rasen");
  const obstacles = zones.filter((z) => z.type === "gebaeude");
  const coveragePct = estimateCoveragePct(lawns, heads, obstacles);

  const dripZones = zones.filter((z) => z.type === "beet" || z.type === "hecke");
  let dripAreaM2 = 0;
  for (const dz of dripZones) dripAreaM2 += polygonAreaM2(dz.coordinates);
  const dripTubeLengthM =
    dripAreaM2 > 0 ? Math.ceil(dripAreaM2 / CATALOG.drip.rowSpacingM) : 0;

  const wireLengthM =
    smart && verteilerPos ? distMeters(smart.position, verteilerPos) + 5 : 10;

  const brand = plan.brand ?? DEFAULT_BRAND;
  const { bom, totalKnownEur, hasUnknownPrices } = buildBom({
    heads,
    pipes,
    zoneCount,
    wireLengthM,
    dripTubeLengthM,
    brand,
  });

  return {
    ...plan,
    algorithmVersion: "v1",
    createdAt: new Date().toISOString(),
    brand,
    heads,
    pipes,
    zones: buildZoneInfos(heads, pipes),
    bom,
    totalKnownEur,
    hasUnknownPrices,
    warnings: [...new Set(warnings)],
    coveragePct,
    dripAreaM2: Math.round(dripAreaM2),
  };
}
