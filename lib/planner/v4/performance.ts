import {
  brandEmitters,
  CATALOG,
  type PerformancePoint,
  type SprinklerBrand,
} from "../catalog";

export type { PerformancePoint };

/**
 * Interpolate radius/flow at design pressure from published points.
 * Never extrapolates outside the table — clamps to nearest endpoint.
 */
export function interpolatePerformance(
  points: PerformancePoint[],
  pressureBar: number,
  opts?: { preferArcDeg?: number },
): { radiusM: number; flowLMin: number; clamped: boolean; precipSquareMmH?: number } | null {
  if (!points.length) return null;
  const preferArc = opts?.preferArcDeg;
  let pool = points;
  if (preferArc != null) {
    const sameArc = points.filter(
      (p) => p.arcDeg != null && Math.abs(p.arcDeg - preferArc) < 1,
    );
    if (sameArc.length) pool = sameArc;
  }
  // Prefer rows that have radius when interpolating throw
  const withRadius = pool.filter((p) => p.radiusM != null);
  const use = withRadius.length ? withRadius : pool;

  const sorted = [...use].sort((a, b) => a.pressureBar - b.pressureBar);
  if (pressureBar <= sorted[0].pressureBar) {
    const row = sorted[0];
    return {
      radiusM: row.radiusM ?? 0,
      flowLMin: row.flowLMin,
      clamped: pressureBar < sorted[0].pressureBar,
      precipSquareMmH: row.precipSquareMmH,
    };
  }
  const last = sorted[sorted.length - 1];
  if (pressureBar >= last.pressureBar) {
    return {
      radiusM: last.radiusM ?? 0,
      flowLMin: last.flowLMin,
      clamped: pressureBar > last.pressureBar,
      precipSquareMmH: last.precipSquareMmH,
    };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (pressureBar >= a.pressureBar && pressureBar <= b.pressureBar) {
      const t =
        (pressureBar - a.pressureBar) / (b.pressureBar - a.pressureBar || 1);
      const radiusM =
        a.radiusM != null && b.radiusM != null
          ? a.radiusM + t * (b.radiusM - a.radiusM)
          : (a.radiusM ?? b.radiusM ?? 0);
      return {
        radiusM,
        flowLMin: a.flowLMin + t * (b.flowLMin - a.flowLMin),
        clamped: false,
        precipSquareMmH:
          a.precipSquareMmH != null && b.precipSquareMmH != null
            ? a.precipSquareMmH + t * (b.precipSquareMmH - a.precipSquareMmH)
            : a.precipSquareMmH ?? b.precipSquareMmH,
      };
    }
  }
  return {
    radiusM: last.radiusM ?? 0,
    flowLMin: last.flowLMin,
    clamped: true,
    precipSquareMmH: last.precipSquareMmH,
  };
}

/** Build performance curve for a spray family from catalog. */
export function sprayFamilyPerformance(
  brand: SprinklerBrand,
  familyKey: string,
): PerformancePoint[] {
  const emitters = brandEmitters(brand);
  const nz = emitters.sprayHead.nozzles[familyKey];
  if (!nz) return [];
  if (nz.performance?.length) return nz.performance;
  // Legacy fallback: single published point
  if (nz.flow360LMin == null) return [];
  const p = nz.pressureBar || CATALOG.hydraulics.recommendedPressureBar;
  return [
    {
      pressureBar: p,
      radiusM: (nz.radiusMinM + nz.radiusMaxM) / 2,
      flowLMin: nz.flow360LMin,
      precipSquareMmH: nz.precipMmH ?? undefined,
    },
  ];
}

export function stripFamilyPerformance(
  brand: SprinklerBrand,
  stripKey: string,
): PerformancePoint[] {
  const emitters = brandEmitters(brand);
  const spec = emitters.sprayHead.strips[stripKey];
  if (!spec) return [];
  if (spec.performance?.length) return spec.performance;
  if (spec.flowLMin == null) return [];
  return [
    {
      pressureBar: spec.pressureBar,
      widthM: spec.widthM,
      lengthM: spec.lengthM,
      flowLMin: spec.flowLMin,
      precipSquareMmH: spec.precipSquareMmH ?? spec.precipMmH ?? undefined,
      precipTriangleMmH: spec.precipTriangleMmH ?? undefined,
    },
  ];
}

export function rotorPerformance(
  brand: SprinklerBrand,
  nozzle: string,
): PerformancePoint[] {
  const emitters = brandEmitters(brand);
  return emitters.rotor.options
    .filter((o) => o.nozzle === nozzle)
    .map((o) => ({
      pressureBar: o.pressureBar,
      radiusM: o.radiusM,
      flowLMin: o.flowLMin,
      precipSquareMmH: o.precipSquareMmH,
      precipTriangleMmH: o.precipTriangleMmH,
    }));
}

/**
 * Resolve radius + flow for a spray head at design pressure.
 * flow = table flow at arc when available, else flow360 × arc/360.
 */
export function resolveSprayAtPressure(params: {
  brand: SprinklerBrand;
  familyKey: string;
  pressureBar: number;
  arcDeg: number;
}): { radiusM: number; flowLMin: number; precipSquareMmH?: number } | null {
  const points = sprayFamilyPerformance(params.brand, params.familyKey);
  if (!points.length) return null;
  const atArc = interpolatePerformance(points, params.pressureBar, {
    preferArcDeg: params.arcDeg,
  });
  if (!atArc) return null;
  // If table had arc-specific flow, scale only when we used a different arc pool
  const emitters = brandEmitters(params.brand);
  const nz = emitters.sprayHead.nozzles[params.familyKey];
  const hasArcRows = points.some((p) => p.arcDeg != null);
  let flowLMin = atArc.flowLMin;
  if (hasArcRows) {
    // Prefer exact/interpolated arc row already; if only one arc family, scale
    const arcs = [...new Set(points.map((p) => p.arcDeg).filter(Boolean))];
    if (arcs.length === 1 && arcs[0] && params.arcDeg > 0) {
      flowLMin = atArc.flowLMin * (params.arcDeg / arcs[0]);
    }
  } else if (nz?.flow360LMin != null) {
    flowLMin = nz.flow360LMin * (Math.min(360, params.arcDeg) / 360);
  }
  return {
    radiusM: atArc.radiusM,
    flowLMin: Number(flowLMin.toFixed(2)),
    precipSquareMmH: atArc.precipSquareMmH,
  };
}

export function flowForArc(
  flow360LMin: number,
  arcDeg: number,
  proportional: boolean,
): number {
  if (!proportional || arcDeg >= 360) return flow360LMin;
  return flow360LMin * (Math.min(360, Math.max(0, arcDeg)) / 360);
}

export const DESIGN_PRESSURE_BAR =
  CATALOG.hydraulics.recommendedPressureBar ?? 2.8;

export const SPACING_FACTOR = CATALOG.hydraulics.spacingFactor ?? 1.0;

/** Practical throw at design pressure (not mechanical radiusMaxM). */
export function familyEffectiveThrowM(
  brand: SprinklerBrand,
  familyKey: string,
  arcDeg = 180,
  pressureBar = DESIGN_PRESSURE_BAR,
): number | null {
  const atP = resolveSprayAtPressure({
    brand,
    familyKey,
    pressureBar,
    arcDeg,
  });
  if (atP?.radiusM) return atP.radiusM;
  const emitters = brandEmitters(brand);
  const spec = emitters.sprayHead.nozzles[familyKey];
  return spec?.radiusMaxM ?? null;
}
