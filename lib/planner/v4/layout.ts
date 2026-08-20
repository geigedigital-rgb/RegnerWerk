import type { DrawnZone, LngLat } from "@/lib/mapbox";
import {
  brandEmitters,
  CATALOG,
  DEFAULT_BRAND,
  primaryNozzleOrder,
  sideStripKey,
  smallNozzleKey,
  AUTO_LAYOUT_ROTORS_ENABLED,
  nozzleOrderForArc,
  sprayConfigKey,
  largestSprayFamilySpec,
  type BrandEmitters,
  type SprinklerBrand,
} from "../catalog";
import {
  averageCompassDeg,
  bbox,
  compassToMathAngle,
  dist,
  distToBoundary,
  distToObstacles,
  ensureCCW,
  interiorAngleDeg,
  inwardBisectorDeg,
  inwardNormalDeg,
  makeLocalProjection,
  offsetPoint,
  outwardNormalDeg,
  pointInPolygon,
  polygonAreaM2Local,
  sectorClearanceM,
  narrowFraction,
  localWidthM,
  sampleLocalWidths,
  percentile,
} from "./geometry";
import type { PtM, SprinklerHead } from "../types";
import {
  DESIGN_PRESSURE_BAR,
  familyEffectiveThrowM,
  resolveSprayAtPressure,
  rotorPerformance,
  interpolatePerformance,
} from "./performance";

type LocalHead = {
  pt: PtM;
  arcDeg: number;
  rotationDeg: number;
  /** 0 corner · 1 edge · 2 near-building · 3 interior */
  priority: number;
  kind?: "spray" | "rotor" | "strip";
  stripKey?: string;
  stripWidthM?: number;
  stripLengthM?: number;
  /** Spray-axis span (corridor width), when localWidthM at edge is misleading. */
  spanWidthM?: number;
};

type Family = {
  kind: "spray" | "rotor";
  familyKey: string;
  radiusMinM: number;
  radiusMaxM: number;
  arcMinDeg: number;
  arcMaxDeg: number;
};

/** Tiny epsilon so the pin sits inside the polygon (not a design setback). */
const EDGE_EPS_M = 0.08;
/** Mounting clearance only when the head sits next to a Gebäude. */
const BUILDING_MOUNT_M = 0.2;
const BUILDING_NEAR_M = 1.8;

function designPressure(emitters: BrandEmitters, familyKey?: string): number {
  if (familyKey) {
    const nz = emitters.sprayHead.nozzles[familyKey];
    if (nz?.pressureRecommendedBar) return nz.pressureRecommendedBar;
  }
  return (
    emitters.rotor.pressureRecommendedBar ??
    DESIGN_PRESSURE_BAR
  );
}

function flowFor(
  brand: SprinklerBrand,
  emitters: BrandEmitters,
  kind: "spray" | "rotor",
  familyKey: string,
  radiusM: number,
  arcDeg: number,
  pressureBar?: number,
): number {
  const pBar = pressureBar ?? designPressure(emitters, familyKey);
  if (kind === "spray") {
    const resolved = resolveSprayAtPressure({
      brand,
      familyKey,
      pressureBar: pBar,
      arcDeg,
    });
    if (resolved) return resolved.flowLMin;
    const spec = emitters.sprayHead.nozzles[familyKey];
    const f360 = spec?.flow360LMin ?? 8;
    return (f360 * arcDeg) / 360;
  }
  const nozzle = rotorNozzleFor(emitters, radiusM, pBar);
  const curve = rotorPerformance(brand, nozzle);
  const atP = interpolatePerformance(curve, pBar);
  if (atP) return atP.flowLMin;
  const opt =
    emitters.rotor.options.find((o) => o.nozzle === nozzle) ??
    emitters.rotor.options[emitters.rotor.options.length - 1];
  return opt?.flowLMin ?? 10;
}

function rotorNozzleFor(
  emitters: BrandEmitters,
  radiusM: number,
  pressureBar = designPressure(emitters),
): string {
  // Prefer options near design pressure, then smallest that reaches radius
  const nearP = emitters.rotor.options.filter(
    (o) => Math.abs(o.pressureBar - pressureBar) <= 0.35,
  );
  const pool = nearP.length ? nearP : emitters.rotor.options;
  const opt =
    pool.find((o) => o.radiusM >= radiusM) ??
    pool[pool.length - 1] ??
    emitters.rotor.options[emitters.rotor.options.length - 1];
  return opt ? String(opt.nozzle) : "2.0";
}

/** Official manufacturer ranges — prefer practical throw at design pressure. */
function pickFamilyForNeed(
  needM: number,
  brand: SprinklerBrand,
  emitters: BrandEmitters,
  arcDeg = 180,
): Family {
  const n = emitters.sprayHead.nozzles;
  const order = nozzleOrderForArc(brand, arcDeg);
  for (const key of order) {
    const spec = n[key];
    if (!spec) continue;
    const throwMax =
      familyEffectiveThrowM(brand, key, arcDeg) ?? spec.radiusMaxM;
    if (needM >= spec.radiusMinM - 0.3 && needM <= throwMax + 0.15) {
      return {
        kind: "spray",
        familyKey: key,
        radiusMinM: spec.radiusMinM,
        radiusMaxM: spec.radiusMaxM,
        arcMinDeg: spec.arcMinDeg,
        arcMaxDeg: spec.arcMaxDeg,
      };
    }
  }
  const first = n[order[0]];
  // Hunter: prefer stretching to MP1000 min over MP800 (~20 mm/h) unless truly tiny
  if (brand === "hunter" && first && needM < first.radiusMinM && needM >= 2.2) {
    return {
      kind: "spray",
      familyKey: order[0],
      radiusMinM: first.radiusMinM,
      radiusMaxM: first.radiusMaxM,
      arcMinDeg: first.arcMinDeg,
      arcMaxDeg: first.arcMaxDeg,
    };
  }
  const smallKey = smallNozzleKey(brand);
  const small = n[smallKey] ?? first;
  if (small && first && needM < first.radiusMinM) {
    return {
      kind: "spray",
      familyKey: smallKey,
      radiusMinM: small.radiusMinM,
      radiusMaxM: small.radiusMaxM,
      arcMinDeg: small.arcMinDeg,
      arcMaxDeg: small.arcMaxDeg,
    };
  }
  const lastKey = [...order].reverse().find((k) => n[k]) ?? order[0];
  const last = n[lastKey];
  const lastThrow =
    (last &&
      (familyEffectiveThrowM(brand, lastKey, arcDeg) ?? last.radiusMaxM)) ??
    0;
  // Accept the largest spray family when need fits practical throw (+ buffer).
  if (last && needM <= lastThrow + 1.0) {
    return {
      kind: "spray",
      familyKey: lastKey,
      radiusMinM: last.radiusMinM,
      radiusMaxM: last.radiusMaxM,
      arcMinDeg: last.arcMinDeg,
      arcMaxDeg: last.arcMaxDeg,
    };
  }
  if (!AUTO_LAYOUT_ROTORS_ENABLED) {
    const fb = largestSprayFamilySpec(brand, emitters, arcDeg);
    if (fb) {
      return {
        kind: "spray",
        familyKey: fb.key.replace(/-360$/, ""),
        radiusMinM: fb.spec.radiusMinM,
        radiusMaxM: fb.spec.radiusMaxM,
        arcMinDeg: fb.spec.arcMinDeg,
        arcMaxDeg: arcDeg >= 315 ? 360 : fb.spec.arcMaxDeg,
      };
    }
  }
  const rotorKey = brand === "hunter" ? "I-20" : "3504";
  return {
    kind: "rotor",
    familyKey: rotorKey,
    radiusMinM: emitters.rotor.radiusMinM,
    radiusMaxM: Math.min(emitters.rotor.radiusMaxM, 9.5),
    arcMinDeg: emitters.rotor.arcMinDeg,
    arcMaxDeg: emitters.rotor.arcMaxDeg,
  };
}

/** Smallest spray family whose practical throw ≥ minThrowM. */
function pickFamilyForMinThrow(
  minThrowM: number,
  brand: SprinklerBrand,
  emitters: BrandEmitters,
  arcDeg = 180,
): Family {
  const n = emitters.sprayHead.nozzles;
  const order = nozzleOrderForArc(brand, arcDeg);
  for (const key of order) {
    const spec = n[key];
    if (!spec) continue;
    const throwM =
      familyEffectiveThrowM(brand, key, arcDeg) ?? spec.radiusMaxM;
    if (throwM + 0.1 >= minThrowM) {
      return {
        kind: "spray",
        familyKey: key,
        radiusMinM: spec.radiusMinM,
        radiusMaxM: spec.radiusMaxM,
        arcMinDeg: spec.arcMinDeg,
        arcMaxDeg: spec.arcMaxDeg,
      };
    }
  }
  const lastKey = [...order].reverse().find((k) => n[k]) ?? order[0];
  const last = n[lastKey];
  if (last) {
    return {
      kind: "spray",
      familyKey: lastKey.replace(/-360$/, ""),
      radiusMinM: last.radiusMinM,
      radiusMaxM: last.radiusMaxM,
      arcMinDeg: last.arcMinDeg,
      arcMaxDeg: arcDeg >= 315 ? 360 : last.arcMaxDeg,
    };
  }
  if (!AUTO_LAYOUT_ROTORS_ENABLED) {
    const fb = largestSprayFamilySpec(brand, emitters, arcDeg);
    if (fb) {
      return {
        kind: "spray",
        familyKey: fb.key.replace(/-360$/, ""),
        radiusMinM: fb.spec.radiusMinM,
        radiusMaxM: fb.spec.radiusMaxM,
        arcMinDeg: fb.spec.arcMinDeg,
        arcMaxDeg: arcDeg >= 315 ? 360 : fb.spec.arcMaxDeg,
      };
    }
  }
  const rotorKey = brand === "hunter" ? "I-20" : "3504";
  return {
    kind: "rotor",
    familyKey: rotorKey,
    radiusMinM: emitters.rotor.radiusMinM,
    radiusMaxM: Math.min(emitters.rotor.radiusMaxM, 9.5),
    arcMinDeg: emitters.rotor.arcMinDeg,
    arcMaxDeg: emitters.rotor.arcMaxDeg,
  };
}

function clampArc(arcDeg: number, fam: Family): number {
  if (arcDeg >= 315) return 360;
  // Prefer nearest 5° — Math.ceil systematically widened sectors past the lawn.
  const rounded = Math.round(arcDeg / 5) * 5;
  return Math.min(
    fam.arcMaxDeg,
    Math.max(fam.arcMinDeg, rounded),
  );
}

/**
 * Aim a corner head so both adjacent edges stay in the sector.
 * No positive oversweep — that pushed ≥180° sprays outside the lawn.
 */
function cornerAim(
  ring: PtM[],
  vertexIdx: number,
  pt: PtM,
  obstacles: PtM[][],
): { arcDeg: number; rotationDeg: number } {
  const measured = lawnFacingSector(pt, ring, obstacles, 0.85);
  if (measured && measured.arcDeg >= 40) {
    const pad = measured.arcDeg >= 160 ? -4 : measured.arcDeg >= 120 ? -2 : 0;
    const adjusted = measured.arcDeg + pad;
    return {
      arcDeg: capPerimeterArc(adjusted),
      rotationDeg: measured.rotationDeg,
    };
  }

  const n = ring.length;
  const prev = ring[(vertexIdx - 1 + n) % n];
  const cur = ring[vertexIdx];
  const next = ring[(vertexIdx + 1) % n];
  const bearingTo = (q: PtM) => {
    const dx = q.x - pt.x;
    const dy = q.y - pt.y;
    return ((90 - (Math.atan2(dy, dx) * 180) / Math.PI) + 360) % 360;
  };
  const samples = [
    bearingTo(cur),
    bearingTo({
      x: cur.x + (prev.x - cur.x) * 0.45,
      y: cur.y + (prev.y - cur.y) * 0.45,
    }),
    bearingTo({
      x: cur.x + (next.x - cur.x) * 0.45,
      y: cur.y + (next.y - cur.y) * 0.45,
    }),
  ];
  let bestArc = 360;
  let bestMid = samples[0];
  for (let i = 0; i < samples.length; i++) {
    const start = samples[i];
    const span = Math.max(
      ...samples.map((b) => (b - start + 360) % 360),
    );
    if (span < bestArc) {
      bestArc = span;
      bestMid = (start + span / 2 + 360) % 360;
    }
  }
  return {
    arcDeg: capPerimeterArc(bestArc),
    rotationDeg: bestMid,
  };
}

/** Smaller angle between two compass bearings (0–180°). */
function angleBetweenCompass(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180);
}

/**
 * Aim at a convex building corner so the sector wraps the lawn around the house.
 * Façade normals span the small exterior tip wedge (= building interior angle for
 * a rectangle ≈ 90°). Lawn occupies the complement → arc ≈ 360° − wedge (270°),
 * mid = exterior bisector. Sector flanks then lie along the two walls.
 */
function buildingCornerAim(
  bldg: PtM[],
  vertexIdx: number,
): { arcDeg: number; rotationDeg: number } {
  const n = bldg.length;
  const nPrev = outwardNormalDeg(bldg, (vertexIdx - 1 + n) % n);
  const nNext = outwardNormalDeg(bldg, vertexIdx);
  const rotationDeg = averageCompassDeg(nPrev, nNext);
  const façadeWedge = angleBetweenCompass(nPrev, nNext);
  const wrapArc = 360 - façadeWedge;
  // Keep flanks on the walls: never shrink to the tip wedge (90°).
  const arcDeg = Math.max(180, Math.min(270, Math.round(wrapArc / 5) * 5));
  return { arcDeg, rotationDeg };
}

/** Edge / façade: measured lawn-facing arc, hard-capped at 180° (no 195° inflate). */
function edgeArcDeg(
  face: { arcDeg: number; rotationDeg: number } | null,
  fallback = 180,
): number {
  if (!face) return fallback;
  // Shrink a few degrees so sector flanks don't leave the polygon
  return Math.min(180, Math.max(90, face.arcDeg - 3));
}

function mountInset(nearBuilding: boolean): number {
  return nearBuilding ? BUILDING_MOUNT_M : EDGE_EPS_M;
}

/** algo4 §7.3: equal spacing along edge including endpoints. */
function distributeChainPoints(
  a: PtM,
  b: PtM,
  maxSpacingM: number,
  startInset = 0,
  endInset = 0,
): PtM[] {
  const L = dist(a, b);
  const usable = Math.max(0, L - startInset - endInset);
  if (usable < 0.12) return [a, b].filter((_, i) => (i === 0 ? startInset <= 0.05 : endInset <= 0.05));
  const intervalCount = Math.max(1, Math.ceil(usable / maxSpacingM));
  const step = usable / intervalCount;
  const out: PtM[] = [];
  for (let k = 0; k <= intervalCount; k++) {
    const d = startInset + k * step;
    const t = L > 0 ? Math.min(1, d / L) : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Mid-edge points only (legacy helper). */
function distributeEdgePoints(a: PtM, b: PtM, spacingM: number): PtM[] {
  const chain = distributeChainPoints(a, b, spacingM);
  if (chain.length <= 2) return [];
  return chain.slice(1, -1);
}

function isCorridorSpan(spanM: number): boolean {
  return spanM >= 2.8 && spanM < 9.5;
}

function corridorThrowNeed(spanM: number): number {
  return Math.max(4.2, Math.min(spanM * 0.55, 9.2));
}

function pushCorridorPair(
  onFacade: PtM,
  outwardDeg: number,
  ring: PtM[],
  obstacles: PtM[][],
  tryPush: (h: LocalHead, minSep?: number) => boolean,
  tooClose: (pt: PtM, minSep?: number) => boolean,
  minSep: number,
): void {
  const ptIn = offsetPoint(onFacade, outwardDeg, BUILDING_MOUNT_M);
  const aimIn = corridorRowAim(outwardDeg, "building");
  const spanIn = rayWidthM(ptIn, aimIn.rotationDeg, ring, obstacles);
  tryPush({
    pt: ptIn,
    arcDeg: aimIn.arcDeg,
    rotationDeg: aimIn.rotationDeg,
    priority: 2,
    spanWidthM: spanIn,
  });
  const ptOut = outerCorridorPoint(onFacade, outwardDeg, ring, obstacles);
  if (ptOut && !tooClose(ptOut, minSep * 0.42)) {
    const aimOut = corridorRowAim(outwardDeg, "outer");
    const spanOut = rayWidthM(ptOut, aimOut.rotationDeg, ring, obstacles);
    tryPush({
      pt: ptOut,
      arcDeg: aimOut.arcDeg,
      rotationDeg: aimOut.rotationDeg,
      priority: 1,
      spanWidthM: spanOut,
    });
  }
}

/** Distance along bearing until lawn/obstacle boundary (true corridor span). */
function rayWidthM(
  origin: PtM,
  bearingDeg: number,
  ring: PtM[],
  obstacles: PtM[][],
): number {
  for (let d = 0.12; d < 26; d += 0.06) {
    const p = offsetPoint(origin, bearingDeg, d);
    if (!pointInPolygon(p, ring)) return Math.max(0.15, d - 0.08);
    if (obstacles.some((o) => pointInPolygon(p, o))) return Math.max(0.15, d - 0.08);
  }
  return 26;
}

function headSpanWidth(
  h: LocalHead,
  ring: PtM[],
  obstacles: PtM[][],
): number {
  if (h.spanWidthM != null && h.spanWidthM > 0) return h.spanWidthM;
  if (h.arcDeg >= 315) return localWidthM(h.pt, ring);
  const rayW = rayWidthM(h.pt, h.rotationDeg, ring, obstacles);
  if (rayW >= 2.5 && rayW < 12) return rayW;
  return localWidthM(h.pt, ring);
}

/** Head-to-head spacing from span at a point. */
function spacingAtPoint(
  pt: PtM,
  ring: PtM[],
  obstacles: PtM[][],
  brand: SprinklerBrand,
  emitters: BrandEmitters,
  bearingDeg?: number,
): number {
  const span =
    bearingDeg != null
      ? rayWidthM(pt, bearingDeg, ring, obstacles)
      : localWidthM(pt, ring);
  const isCorridor = isCorridorSpan(span);
  const minThrow = Math.max(2.4, span * (isCorridor ? 0.55 : 0.48));
  const fam = pickFamilyForMinThrow(minThrow, brand, emitters, 180);
  return (
    familyEffectiveThrowM(brand, fam.familyKey, 180) ?? fam.radiusMaxM
  );
}

function spacingAlongEdge(
  a: PtM,
  b: PtM,
  ring: PtM[],
  obstacles: PtM[][],
  brand: SprinklerBrand,
  emitters: BrandEmitters,
  bearingDeg?: number,
): number {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return spacingAtPoint(mid, ring, obstacles, brand, emitters, bearingDeg);
}

function pickFamilyForHead(
  span: number,
  arcDeg: number,
  brand: SprinklerBrand,
  emitters: BrandEmitters,
): Family {
  const isInterior360 = arcDeg >= 315;
  const isCorridor = isCorridorSpan(span);
  if (isCorridor || isInterior360) {
    const minThrow = isInterior360
      ? Math.max(2.4, span * 0.42)
      : corridorThrowNeed(span);
    return pickFamilyForMinThrow(minThrow, brand, emitters, arcDeg);
  }
  return pickFamilyForNeed(
    Math.max(2.4, Math.min(span * 0.52, 9.5)),
    brand,
    emitters,
    arcDeg,
  );
}

/**
 * Minimum throw to cover span (corridor head-to-head or open-field interior).
 */
function throwNeedForFamily(
  pt: PtM,
  ring: PtM[],
  obstacles: PtM[][],
  arcDeg: number,
  rotationDeg: number,
  spanWidthM?: number,
): number {
  const span =
    spanWidthM ??
    (arcDeg >= 315
      ? localWidthM(pt, ring)
      : rayWidthM(pt, rotationDeg, ring, obstacles));
  const isCorridor = isCorridorSpan(span);
  if (arcDeg >= 315) {
    return Math.max(2.4, Math.min(span * 0.42, 9.5));
  }
  if (isCorridor) {
    return Math.max(2.4, Math.min(span * 0.55, 9.5));
  }
  const clearance = sectorClearanceM(
    pt,
    rotationDeg,
    Math.max(45, arcDeg),
    ring,
    obstacles,
  );
  const intoLawn =
    clearance > 0.5
      ? Math.min(clearance * 0.98, span * 0.52)
      : span * 0.52;
  return Math.max(2.4, Math.min(intoLawn, 9.5));
}

/** 180° sectors facing each other across a corridor (algo4 §6.1). */
function corridorRowAim(
  outwardDeg: number,
  side: "building" | "outer",
): { arcDeg: number; rotationDeg: number } {
  return {
    arcDeg: 180,
    rotationDeg: side === "building" ? outwardDeg : (outwardDeg + 180) % 360,
  };
}

/** Walk from building side to outer boundary along corridor axis. */
function outerCorridorPoint(
  fromOnFacade: PtM,
  outwardDeg: number,
  ring: PtM[],
  obstacles: PtM[][],
): PtM | null {
  let lastInside: PtM | null = null;
  for (let d = BUILDING_MOUNT_M + 0.35; d < 14; d += 0.2) {
    const p = offsetPoint(fromOnFacade, outwardDeg, d);
    if (!pointInPolygon(p, ring)) break;
    if (obstacles.some((o) => pointInPolygon(p, o))) continue;
    lastInside = p;
    if (distToBoundary(p, ring) < 0.4) {
      return offsetPoint(p, (outwardDeg + 180) % 360, EDGE_EPS_M);
    }
  }
  return lastInside;
}

function nearestBoundaryInfo(
  p: PtM,
  ring: PtM[],
): { pt: PtM; inwardDeg: number; dist: number } {
  let bestDist = Infinity;
  let bestPt = p;
  let bestInward = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = dist(p, q);
    if (d < bestDist) {
      bestDist = d;
      bestPt = q;
      bestInward = inwardNormalDeg(ring, i);
    }
  }
  return { pt: bestPt, inwardDeg: bestInward, dist: bestDist };
}

function findDrySamples(
  kept: LocalHead[],
  ring: PtM[],
  obstacles: PtM[][],
  brand: SprinklerBrand,
  emitters: BrandEmitters,
  box: ReturnType<typeof bbox>,
  step: number,
): PtM[] {
  const dry: PtM[] = [];
  for (let y = box.minY + step / 2; y <= box.maxY; y += step) {
    for (let x = box.minX + step / 2; x <= box.maxX; x += step) {
      const p = { x, y };
      if (!pointInPolygon(p, ring)) continue;
      if (obstacles.some((o) => pointInPolygon(p, o))) continue;
      if (!sampleCovered(p, kept, ring, obstacles, brand, emitters)) {
        dry.push(p);
      }
    }
  }
  return dry;
}

function sampleCovered(
  p: PtM,
  kept: LocalHead[],
  ring: PtM[],
  obstacles: PtM[][],
  brand: SprinklerBrand,
  emitters: BrandEmitters,
): boolean {
  for (const h of kept) {
    const arc = h.arcDeg >= 315 ? 360 : h.arcDeg;
    const span = headSpanWidth(h, ring, obstacles);
    const fam = pickFamilyForHead(span, arc, brand, emitters);
    const throwM =
      familyEffectiveThrowM(brand, fam.familyKey, arc) ?? fam.radiusMaxM;
    if (pointInSector(p, h.pt, throwM * 0.95, h.arcDeg, h.rotationDeg)) {
      return true;
    }
  }
  return false;
}

/** Perimeter heads never use full 360° — only partial sectors along boundaries. */
function capPerimeterArc(arcDeg: number, interiorAngle?: number): number {
  if (arcDeg >= 315) {
    return interiorAngle != null && interiorAngle < 120 ? interiorAngle : 180;
  }
  return Math.min(270, Math.max(45, arcDeg));
}

function isNearBuilding(pt: PtM, obstacles: PtM[][]): boolean {
  return distToObstacles(pt, obstacles) < BUILDING_NEAR_M;
}

/**
 * Measure which directions from `pt` still see lawn (not Gebäude).
 * Returns the longest contiguous lawn-facing sector — used at building
 * corners and concave lawn notches (Bewässerungsbox-style).
 */
function lawnFacingSector(
  pt: PtM,
  lawn: PtM[],
  obstacles: PtM[][],
  probeM = 0.7,
): { arcDeg: number; rotationDeg: number } | null {
  const N = 72; // 5°
  const hit: boolean[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const bearing = (i * 360) / N;
    const q = offsetPoint(pt, bearing, probeM);
    hit[i] =
      pointInPolygon(q, lawn) &&
      !obstacles.some((o) => pointInPolygon(q, o));
  }

  // Longest circular true-run
  let bestStart = 0;
  let bestLen = 0;
  let i = 0;
  while (i < N) {
    if (!hit[i]) {
      i += 1;
      continue;
    }
    let len = 0;
    while (len < N && hit[(i + len) % N]) len += 1;
    if (len > bestLen) {
      bestLen = len;
      bestStart = i;
    }
    i += Math.max(1, len);
    if (bestLen >= N) break;
  }
  // Also check wrap that starts in the middle of a run crossing 0
  if (hit[0] && hit[N - 1]) {
    let a = 0;
    while (a < N && hit[a]) a += 1;
    let b = 0;
    while (b < N && hit[N - 1 - b]) b += 1;
    const wrap = a + b;
    if (wrap < N && wrap > bestLen) {
      bestLen = wrap;
      bestStart = (N - b) % N;
    }
  }

  if (bestLen === 0) return null;
  if (bestLen >= N - 1) return { arcDeg: 360, rotationDeg: 0 };

  const rawArc = Math.round(((bestLen * 360) / N) / 5) * 5;
  // Allow 360° when the open sector is wide enough (≥ 315°)
  const arcDeg = rawArc >= 315
    ? 360
    : Math.max(45, rawArc);
  const mid = bestStart + bestLen / 2;
  const rotationDeg = (((mid * 360) / N) % 360 + 360) % 360;
  return { arcDeg, rotationDeg };
}

/**
 * v2 §7.5: clearance is an upper bound, not the target.
 * Choose radius to satisfy head-to-head to neighbours, then clamp to
 * manufacturer range and safe clearance.
 */
function resolveRadius(
  h: LocalHead,
  fam: Family,
  nearestNeighborM: number,
  ring: PtM[],
  obstacles: PtM[][],
  brand: SprinklerBrand,
): { radiusM: number; mayOvershoot: boolean; h2hOk: boolean } {
  const arcUse = h.arcDeg >= 315 ? 360 : h.arcDeg;
  const clearance = sectorClearanceM(
    h.pt,
    h.rotationDeg,
    arcUse,
    ring,
    obstacles,
  );
  const maxSafe = Math.max(0, clearance * 0.995);
  const onEdge = distToBoundary(h.pt, ring) < 2.0;
  const perfMax =
    fam.kind === "spray"
      ? (familyEffectiveThrowM(brand, fam.familyKey, arcUse) ??
        fam.radiusMaxM)
      : fam.radiusMaxM;
  const throwMax = Math.min(fam.radiusMaxM, perfMax);
  const span = headSpanWidth(h, ring, obstacles);
  const isCorridor = isCorridorSpan(span);

  const minDesired = fam.radiusMinM + (throwMax - fam.radiusMinM) * 0.7;
  let desired: number;
  if (h.arcDeg >= 315) {
    desired = Math.min(throwMax, Math.max(minDesired, maxSafe * 0.98));
  } else if (onEdge && h.arcDeg < 200 && isCorridor) {
    desired = Math.min(
      throwMax,
      maxSafe * 0.98,
      Math.max(minDesired, span * 0.55),
    );
  } else if (onEdge && h.arcDeg < 200) {
    desired = Math.min(
      throwMax,
      maxSafe * 0.98,
      Math.max(minDesired, span * 0.52),
    );
  } else {
    desired = Number.isFinite(nearestNeighborM)
      ? Math.max(nearestNeighborM, minDesired)
      : Math.max((fam.radiusMinM + throwMax) / 2, minDesired);
    desired = Math.min(throwMax, Math.max(fam.radiusMinM, desired));
    if (maxSafe >= fam.radiusMinM) {
      const margin = h.arcDeg >= 170 ? 0.97 : 0.995;
      desired = Math.min(desired, maxSafe * margin);
    }
  }
  if (
    Number.isFinite(nearestNeighborM) &&
    nearestNeighborM < 9.5 &&
    h.priority !== 3
  ) {
    desired = Math.min(throwMax, Math.max(desired, nearestNeighborM));
  }

  const radiusM = Number(desired.toFixed(1));
  return {
    radiusM,
    mayOvershoot: radiusM > maxSafe + 0.05,
    h2hOk:
      !Number.isFinite(nearestNeighborM) ||
      radiusM + 0.15 >= nearestNeighborM,
  };
}

function layoutStripZone(
  ring: PtM[],
  zoneId: string,
  proj: ReturnType<typeof makeLocalProjection>,
  obstacleRings: PtM[][],
  widthM: number,
  warnings: string[],
  brand: SprinklerBrand,
  emitters: BrandEmitters,
): Omit<SprinklerHead, "hydraulicZone" | "lineEnd">[] {
  const box = bbox(ring);
  const alongX = box.w >= box.h;
  const stripKey = sideStripKey(brand);
  const spec = emitters.sprayHead.strips[stripKey];
  if (!spec) {
    warnings.push("Streifendüse nicht im Katalog — Layout übersprungen.");
    return [];
  }

  // v2 §7.7: spacing from published strip footprint length, not geometry×0.85
  const spacing = Math.max(spec.lengthM, widthM + 0.2);
  const mid = alongX ? box.minY + box.h / 2 : box.minX + box.w / 2;
  const start = alongX ? box.minX + spacing / 2 : box.minY + spacing / 2;
  const end = alongX ? box.maxX - spacing / 2 : box.maxY - spacing / 2;
  const rotationDeg = alongX ? 0 : 90;

  const local: LocalHead[] = [];
  for (let t = start; t <= end + 0.01; t += spacing) {
    const pt = alongX ? { x: t, y: mid } : { x: mid, y: t };
    if (!pointInPolygon(pt, ring)) continue;
    if (obstacleRings.some((o) => pointInPolygon(pt, o))) continue;
    local.push({
      pt,
      arcDeg: 0,
      rotationDeg,
      priority: 1,
      kind: "strip",
      stripKey,
      stripWidthM: Math.min(spec.widthM, widthM * 0.95),
      stripLengthM: spec.lengthM,
    });
  }
  if (local.length === 0) {
    const center = {
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2,
    };
    if (pointInPolygon(center, ring)) {
      local.push({
        pt: center,
        arcDeg: 0,
        rotationDeg,
        priority: 1,
        kind: "strip",
        stripKey,
        stripWidthM: Math.min(spec.widthM, widthM * 0.95),
        stripLengthM: spec.lengthM,
      });
    }
  }

  warnings.push(
    `Schmale Fläche (${widthM.toFixed(1)} m): Streifendüsen ${stripKey} eingeplant.`,
  );

  return local.map((h, idx) => ({
    id: `head-${zoneId}-${idx}`,
    position: proj.toLngLat(h.pt),
    kind: "strip" as const,
    configKey: h.stripKey!,
    radiusM: h.stripLengthM!,
    arcDeg: 0,
    rotationDeg: h.rotationDeg,
    flowLMin: Number((spec.flowLMin ?? 4).toFixed(2)),
    lawnZoneId: zoneId,
    stripWidthM: h.stripWidthM,
    stripLengthM: h.stripLengthM,
  }));
}

function finalizeHeads(
  kept: LocalHead[],
  zoneId: string,
  proj: ReturnType<typeof makeLocalProjection>,
  ring: PtM[],
  obstacles: PtM[][],
  warnings: string[],
  brand: SprinklerBrand,
  emitters: BrandEmitters,
): Omit<SprinklerHead, "hydraulicZone" | "lineEnd">[] {
  let overshoot = 0;
  let h2hFail = 0;

  // First pass: compute needM and initial family for each head
  const headInfo = kept.map((h) => {
    let nearest = Infinity;
    for (const other of kept) {
      if (other === h) continue;
      nearest = Math.min(nearest, dist(h.pt, other.pt));
    }
    const arcForThrow = h.arcDeg >= 315 ? 360 : h.arcDeg;
    const span = headSpanWidth(h, ring, obstacles);
    const needM = throwNeedForFamily(
      h.pt,
      ring,
      obstacles,
      arcForThrow,
      h.rotationDeg,
      span,
    );
    const fam = pickFamilyForHead(span, arcForThrow, brand, emitters);
    return { nearest, needM, fam, span };
  });

  // Consolidation pass: prefer one dominant spray family per lawn zone.
  // Also convert rotors back to the largest spray family when needM fits.
  const n = emitters.sprayHead.nozzles;
  const order = primaryNozzleOrder(brand);
  const largestSprayKey = [...order].reverse().find((k) => n[k]) ?? order[0];
  const largestSpraySpec = n[largestSprayKey];

  // Step 1: convert rotors to spray where the largest spray family can cover
  // but keep rotors that need arc > spray max (e.g. 360° for Rain Bird)
  if (largestSpraySpec) {
    for (let hi = 0; hi < headInfo.length; hi++) {
      const info = headInfo[hi];
      if (info.fam.kind !== "rotor") continue;
      const headArc = kept[hi].arcDeg;
      if (headArc > largestSpraySpec.arcMaxDeg) continue;
      const largestThrow =
        familyEffectiveThrowM(brand, largestSprayKey, kept[hi].arcDeg) ??
        largestSpraySpec.radiusMaxM;
      const canFit =
        info.needM >= largestSpraySpec.radiusMinM - 0.5 &&
        info.needM <= largestThrow + 0.15;
      if (canFit) {
        info.fam = {
          kind: "spray",
          familyKey: largestSprayKey,
          radiusMinM: largestSpraySpec.radiusMinM,
          radiusMaxM: largestSpraySpec.radiusMaxM,
          arcMinDeg: largestSpraySpec.arcMinDeg,
          arcMaxDeg: largestSpraySpec.arcMaxDeg,
        };
      }
    }
  }

  // Step 2: spray family per head comes from needM (no forced merge to dominant)

  return kept.map((h, idx) => {
    const { nearest, fam } = headInfo[idx];
    const { radiusM, mayOvershoot, h2hOk } = resolveRadius(
      h,
      fam,
      nearest,
      ring,
      obstacles,
      brand,
    );
    if (mayOvershoot) overshoot += 1;
    if (!h2hOk) h2hFail += 1;

    const arc = clampArc(h.arcDeg, fam);
    const isFull = arc >= 360;
    const pBar = designPressure(emitters, fam.familyKey);
    const rotorPrefix = brand === "hunter" ? "I-20" : "3504";
    const configKey =
      fam.kind === "spray"
        ? isFull
          ? `${fam.familyKey}-360`
          : fam.familyKey
        : `${rotorPrefix}@${rotorNozzleFor(emitters, radiusM, pBar)}`;

    // Prefer table radius at design pressure when available (within clearance)
    let finalRadius = radiusM;
    if (fam.kind === "spray") {
      const atP = resolveSprayAtPressure({
        brand,
        familyKey: fam.familyKey,
        pressureBar: pBar,
        arcDeg: arc,
      });
      if (atP?.radiusM) {
        finalRadius = Number(
          Math.min(
            fam.radiusMaxM,
            Math.max(fam.radiusMinM, Math.min(radiusM, atP.radiusM)),
          ).toFixed(1),
        );
      }
    } else {
      const nozzle = rotorNozzleFor(emitters, radiusM, pBar);
      const atP = interpolatePerformance(
        rotorPerformance(brand, nozzle),
        pBar,
      );
      if (atP?.radiusM) {
        finalRadius = Number(
          Math.min(fam.radiusMaxM, Math.max(fam.radiusMinM, atP.radiusM)).toFixed(
            1,
          ),
        );
      }
    }

    if (idx === kept.length - 1) {
      if (overshoot > 0) {
        warnings.push(
          `${overshoot} Regner: Hersteller-Mindestwurf größer als freier Rasen — leichter Überwurf möglich.`,
        );
      }
      if (h2hFail > 0) {
        warnings.push(
          `${h2hFail} Regner: Abstand zur Nachbarkopf größer als sicherer Wurf — Abdeckung prüfen.`,
        );
      }
    }

    return {
      id: `head-${zoneId}-${idx}`,
      position: proj.toLngLat(h.pt),
      kind: fam.kind,
      configKey,
      radiusM: finalRadius,
      arcDeg: arc,
      rotationDeg: Math.round(h.rotationDeg),
      flowLMin: Number(
        flowFor(
          brand,
          emitters,
          fam.kind,
          fam.familyKey,
          finalRadius,
          arc,
          pBar,
        ).toFixed(2),
      ),
      lawnZoneId: zoneId,
      designPressureBar: pBar,
    };
  });
}

function fillInteriorFromDeficit(
  kept: LocalHead[],
  ring: PtM[],
  obstacles: PtM[][],
  box: ReturnType<typeof bbox>,
  brand: SprinklerBrand,
  emitters: BrandEmitters,
  spacingFactor: number,
  tryPush: (h: LocalHead, minSep?: number) => boolean,
): number {
  const widths = sampleLocalWidths(ring, obstacles);
  if (widths.length === 0) return 0;
  const sorted = [...widths].sort((a, b) => a - b);
  const p75 = percentile(sorted, 75);
  const p90 = percentile(sorted, 90);
  const maxW = sorted[sorted.length - 1] ?? 0;
  const openEnough = p75 >= 5.5 || p90 >= 6.5 || maxW >= 7.5;
  if (!openEnough) return 0;

  const gridFam = pickFamilyForMinThrow(
    Math.max(4.2, p75 * 0.48),
    brand,
    emitters,
    360,
  );
  const gridR =
    familyEffectiveThrowM(brand, gridFam.familyKey, 360) ?? gridFam.radiusMaxM;
  const minSep = gridR * spacingFactor * 0.82;
  let totalAdded = 0;
  const maxInterior = 8;

  for (let pass = 0; pass < 4 && totalAdded < maxInterior; pass++) {
    const step = Math.max(1.0, Math.min(box.w, box.h) / 22);
    const dry = findDrySamples(kept, ring, obstacles, brand, emitters, box, step);
    if (dry.length === 0) break;

    type Cand = { p: PtM; lw: number; score: number };
    const candidates: Cand[] = [];
    for (const p of dry) {
      const lw = localWidthM(p, ring);
      if (lw < 5) continue;
      const clr = sectorClearanceM(p, 0, 360, ring, obstacles);
      if (clr < 3.2) continue;
      const dtb = distToBoundary(p, ring);
      if (dtb < 1.6) continue;
      const score = lw * 1.8 + Math.min(dtb, 7) * 0.55 + clr * 0.25;
      candidates.push({ p, lw, score });
    }
    if (candidates.length === 0) break;
    candidates.sort((a, b) => b.score - a.score);

    let passAdded = 0;
    for (const c of candidates) {
      if (totalAdded >= maxInterior) break;
      const clr = sectorClearanceM(c.p, 0, 360, ring, obstacles);
      const needM = Math.max(2.4, Math.min(clr * 0.92, c.lw * 0.45));
      const fam = pickFamilyForMinThrow(needM, brand, emitters, 360);
      const R =
        familyEffectiveThrowM(brand, fam.familyKey, 360) ?? fam.radiusMaxM;
      if (clr < R * 0.72) continue;
      if (kept.some((k) => dist(k.pt, c.p) < minSep * 0.55)) continue;

      if (
        tryPush(
          {
            pt: c.p,
            arcDeg: 360,
            rotationDeg: 0,
            priority: 3,
            spanWidthM: c.lw,
          },
          minSep * 0.45,
        )
      ) {
        totalAdded += 1;
        passAdded += 1;
        break;
      }
    }
    if (passAdded === 0) break;
  }
  return totalAdded;
}

/**
 * Place sprinkler heads on one lawn polygon.
 *
 * Order: corners → building façades → long edges (equal spacing).
 * Interior heads only via refineHeadSet if coverage allows removal.
 */
export function layoutLawnZone(
  zone: DrawnZone,
  obstacles: DrawnZone[],
  brand: SprinklerBrand = DEFAULT_BRAND,
): {
  heads: Omit<SprinklerHead, "hydraulicZone" | "lineEnd">[];
  areaM2: number;
  warnings: string[];
} {
  const emitters = brandEmitters(brand);
  const warnings: string[] = [];
  if (zone.coordinates.length < 3) return { heads: [], areaM2: 0, warnings };

  const origin = zone.coordinates[0];
  const proj = makeLocalProjection(origin);
  let ring = ensureCCW(zone.coordinates.map((p) => proj.toM(p)));
  if (ring.length > 1 && dist(ring[0], ring[ring.length - 1]) < 0.05) {
    ring = ring.slice(0, -1);
  }
  const areaM2 = polygonAreaM2Local(ring);
  if (areaM2 < 2) return { heads: [], areaM2, warnings };

  const obstacleRings = obstacles
    .filter((o) => o.coordinates.length >= 3)
    .map((o) => o.coordinates.map((p) => proj.toM(p)));

  const box = bbox(ring);
  const minSide = Math.min(box.w, box.h);

  let maxDtb = 0;
  const sampleStep = Math.max(0.5, minSide / 24);
  for (let gy = box.minY; gy <= box.maxY; gy += sampleStep) {
    for (let gx = box.minX; gx <= box.maxX; gx += sampleStep) {
      const p = { x: gx, y: gy };
      if (!pointInPolygon(p, ring)) continue;
      if (obstacleRings.some((o) => pointInPolygon(p, o))) continue;
      maxDtb = Math.max(maxDtb, distToBoundary(p, ring));
    }
  }
  const widthM = Math.min(minSide, 2 * maxDtb || minSide);

  // Strip only for true ribbons: narrow across AND elongated along.
  // Edge-biased localWidth samples make compact squares look "mostly narrow"
  // (median ≈ 1.2 m) — that must not trigger Streifendüsen.
  const stripKey = sideStripKey(brand);
  const stripSpec = emitters.sprayHead.strips[stripKey];
  const stripWidthThresh = stripSpec
    ? Math.max(stripSpec.widthM * 1.35, 2.2)
    : 2.8;
  const alongM = Math.max(box.w, box.h);
  const acrossM = Math.min(box.w, box.h);
  const aspect = acrossM > 0.05 ? alongM / acrossM : 1;
  const longEnoughForStrip =
    alongM >= (stripSpec?.lengthM ?? 9) * 0.45;
  const isRibbon =
    acrossM < stripWidthThresh && aspect >= 2.4 && longEnoughForStrip;
  const local = narrowFraction(ring, obstacleRings, stripWidthThresh);
  const mostlyStrip =
    isRibbon &&
    local.fraction >= 0.72 &&
    local.medianWidthM < stripWidthThresh;

  if (
    isRibbon &&
    (mostlyStrip ||
      (widthM < stripWidthThresh && local.p20WidthM < stripWidthThresh))
  ) {
    return {
      heads: layoutStripZone(
        ring,
        zone.id,
        proj,
        obstacleRings,
        Math.min(widthM, local.medianWidthM || widthM),
        warnings,
        brand,
        emitters,
      ),
      areaM2,
      warnings,
    };
  }

  // Working radius for spacing: p75 local width (mixed open field + corridor)
  const widthSamples = sampleLocalWidths(ring, obstacleRings);
  const sortedWidths = [...widthSamples].sort((a, b) => a - b);
  const p75Width = percentile(sortedWidths, 75) || widthM;
  const spacingNeed = Math.max(2.4, Math.min(p75Width * 0.48, 9.5));
  const spacingFam = pickFamilyForNeed(spacingNeed, brand, emitters, 180);
  const S =
    familyEffectiveThrowM(brand, spacingFam.familyKey, 180) ??
    spacingFam.radiusMaxM;
  const spacingFactor = CATALOG.hydraulics.spacingFactor ?? 1.0;
  const SDefault = S * Math.min(1, spacingFactor);

  const kept: LocalHead[] = [];

  function tooClose(pt: PtM, minSep = SDefault * 0.7): boolean {
    return kept.some((k) => dist(k.pt, pt) < minSep);
  }

  function tryPush(h: LocalHead, minSep = SDefault * 0.7): boolean {
    if (!pointInPolygon(h.pt, ring)) return false;
    if (obstacleRings.some((o) => pointInPolygon(h.pt, o))) return false;
    if (tooClose(h.pt, minSep)) return false;
    kept.push(h);
    return true;
  }

  // ——— 1. Significant lawn corners only (algo4 §4.3 — skip digital noise) ———
  for (let i = 0; i < ring.length; i++) {
    const ang = interiorAngleDeg(ring, i);
    if (ang < 40 || ang > 320) continue;
    const nearBldg = isNearBuilding(ring[i], obstacleRings);
    // Nearly straight outer boundary — not a real corner
    if (!nearBldg && ang > 168 && ang < 192) continue;
    const bis = inwardBisectorDeg(ring, i);
    const pt = offsetPoint(ring[i], bis, mountInset(nearBldg));

    const aim = cornerAim(ring, i, pt, obstacleRings);
    const concave = ang > 185;
    // Concave notch at building — two façade heads in step 2 (algo4 §9.4)
    if (concave && nearBldg) continue;
    tryPush(
      {
        pt,
        arcDeg: capPerimeterArc(aim.arcDeg, ang),
        rotationDeg: aim.rotationDeg,
        priority: nearBldg || concave ? 2 : 0,
      },
      concave ? SDefault * 0.42 : SDefault * 0.7,
    );
  }

  // ——— 2. Building façades & corners (Bewässerungsbox-style) ———
  // When Gebäude sit on/inside the lawn, heads go on the lawn side of every
  // façade corner and along long walls — spray points away from the building.
  for (const rawBldg of obstacleRings) {
    const bldg = ensureCCW(rawBldg);
    if (bldg.length < 3) continue;

    // 2a. Building corners that touch irrigable lawn
    for (let i = 0; i < bldg.length; i++) {
      const bldgAng = interiorAngleDeg(bldg, i);
      // Concave/reflex corner — two façade heads in step 2b, not one wide sector
      if (bldgAng > 185) continue;

      const n = bldg.length;
      const nPrev = outwardNormalDeg(bldg, (i - 1 + n) % n);
      const nNext = outwardNormalDeg(bldg, i);
      const intoLawn = averageCompassDeg(nPrev, nNext);
      const pt = offsetPoint(bldg[i], intoLawn, BUILDING_MOUNT_M);
      if (!pointInPolygon(pt, ring)) continue;
      if (obstacleRings.some((o) => pointInPolygon(pt, o))) continue;
      if (kept.some((k) => dist(k.pt, pt) < SDefault * 0.45)) continue;

      const aim = buildingCornerAim(bldg, i);
      // Do not pass bldgAng into capPerimeterArc — that would collapse wrap (270°)
      // back toward the building interior angle (90°).
      tryPush({
        pt,
        arcDeg: Math.min(270, Math.max(180, aim.arcDeg)),
        rotationDeg: aim.rotationDeg,
        priority: 2,
      });
    }

    // 2b. Long building edges that abut lawn → ≤180° away from façade
    for (let i = 0; i < bldg.length; i++) {
      const a = bldg[i];
      const b = bldg[(i + 1) % bldg.length];
      const L = dist(a, b);
      const out = outwardNormalDeg(bldg, i);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const probe = offsetPoint(mid, out, BUILDING_MOUNT_M + 0.1);
      if (!pointInPolygon(probe, ring)) continue;
      if (obstacleRings.some((o) => pointInPolygon(probe, o))) continue;

      // Corners already cover short façades — avoid redundant mid-edge heads
      const corridorW = rayWidthM(probe, out, ring, obstacleRings);
      const corridorEdge =
        isCorridorSpan(corridorW) && L / Math.max(corridorW, 1) >= 2;
      const throwNeed = corridorThrowNeed(corridorW);
      const edgeS =
        (corridorEdge
          ? familyEffectiveThrowM(
              brand,
              pickFamilyForMinThrow(throwNeed, brand, emitters, 180).familyKey,
              180,
            ) ?? throwNeed
          : spacingAtPoint(probe, ring, obstacleRings, brand, emitters, out)) *
        spacingFactor;

      if (L <= edgeS * 1.05 && !corridorEdge) continue;

      const chainPts = distributeChainPoints(
        a,
        b,
        edgeS,
        BUILDING_MOUNT_M * 0.5,
        BUILDING_MOUNT_M * 0.5,
      );

      for (const onEdge of chainPts) {
        if (corridorEdge) {
          pushCorridorPair(
            onEdge,
            out,
            ring,
            obstacleRings,
            tryPush,
            tooClose,
            edgeS,
          );
          continue;
        }

        const pt = offsetPoint(onEdge, out, BUILDING_MOUNT_M);
        const face = lawnFacingSector(pt, ring, obstacleRings, 0.7);
        const span = rayWidthM(pt, out, ring, obstacleRings);
        tryPush({
          pt,
          arcDeg: edgeArcDeg(face, 180),
          rotationDeg: face?.rotationDeg ?? out,
          priority: 2,
          spanWidthM: span >= 2.5 ? span : undefined,
        });
      }
    }
  }

  // ——— 3. Long lawn edges → ≤180° inward (head-to-head spacing ≤ R) ———
  // Skip mid-edge only when the rectangle is so small that corner throws
  // already meet on every side (true compact pad). Elongated beds still need
  // H2H midpoints even when area is small (e.g. 3×9 m / 31 m²).
  const aspectNow = acrossM > 0.05 ? alongM / acrossM : 1;
  const compactCornersOnly =
    alongM <= SDefault * 1.85 && aspectNow <= 1.35 && areaM2 <= 28;
  if (!compactCornersOnly) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const L = dist(a, b);
    const normal = inwardNormalDeg(ring, i);
    const edgeS =
      spacingAlongEdge(a, b, ring, obstacleRings, brand, emitters, normal) *
      spacingFactor;
    if (L <= edgeS * 1.05) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const outProbe = offsetPoint(mid, (normal + 180) % 360, 0.35);
    const alongBuilding = obstacleRings.some((o) => pointInPolygon(outProbe, o));
    if (alongBuilding) continue;

    // Skip only when enough heads already sit on this edge for H2H spacing.
    // Do NOT floor at 2 — two corner heads alone leave the mid-edge bald
    // whenever L ≳ 2× throw (typical 3×9 m bed).
    let nearEdge = 0;
    for (const k of kept) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((k.pt.x - a.x) * dx + (k.pt.y - a.y) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const q = { x: a.x + t * dx, y: a.y + t * dy };
      if (dist(k.pt, q) < 2.4) nearEdge += 1;
    }
    const neededOnEdge = Math.ceil(L / Math.max(edgeS, 0.5)) + 1;
    if (nearEdge >= neededOnEdge) continue;

    const spanMid = rayWidthM(mid, normal, ring, obstacleRings);
    let chainSpacing = edgeS;
    if (L > 12 && spanMid > 10) {
      const wideFam = pickFamilyForMinThrow(
        Math.max(5.5, spanMid * 0.48),
        brand,
        emitters,
        180,
      );
      const wideR =
        familyEffectiveThrowM(brand, wideFam.familyKey, 180) ??
        wideFam.radiusMaxM;
      chainSpacing = Math.max(chainSpacing, wideR * spacingFactor);
    }

    const chainPts = distributeChainPoints(
      a,
      b,
      chainSpacing,
      EDGE_EPS_M,
      EDGE_EPS_M,
    );
    for (let ci = 0; ci < chainPts.length; ci++) {
      if (ci === 0 || ci === chainPts.length - 1) continue;
      const onEdge = chainPts[ci];
      const nearBldg = isNearBuilding(onEdge, obstacleRings);
      const pt = offsetPoint(onEdge, normal, mountInset(nearBldg));
      const face = lawnFacingSector(pt, ring, obstacleRings, 0.7);
      const rot = face?.rotationDeg ?? normal;
      const span = rayWidthM(pt, rot, ring, obstacleRings);
      tryPush({
        pt,
        arcDeg: edgeArcDeg(face, 180),
        rotationDeg: rot,
        priority: nearBldg ? 2 : 1,
        spanWidthM: span >= 2.5 ? span : undefined,
      });
    }
  }
  } else {
    warnings.push(
      "Kompakte Rasenfläche: nur Eckregner — Mittelkanten-180° entfallen.",
    );
  }

  // ——— 4. Open field: 360° grid where width > 2× perimeter throw ———
  const interiorAdded = fillInteriorFromDeficit(
    kept,
    ring,
    obstacleRings,
    box,
    brand,
    emitters,
    spacingFactor,
    tryPush,
  );
  if (interiorAdded > 0) {
    warnings.push(
      `${interiorAdded} Innenregner 360° nach Abdeckungsdefizit (offenes Feld).`,
    );
  }

  kept.sort((a, b) => a.priority - b.priority);

  const heads = finalizeHeads(
    kept,
    zone.id,
    proj,
    ring,
    obstacleRings,
    warnings,
    brand,
    emitters,
  );

  return { heads, areaM2, warnings };
}

export function headScreenLabel(configKey: string): string {
  if (configKey.startsWith("3504")) return "3504";
  if (configKey.startsWith("I-20")) return "I-20";
  if (configKey.startsWith("MP")) return configKey.replace(/-360$/, "");
  return configKey.replace("R-VAN", "R-VAN ");
}

export type LawnLayoutResult = ReturnType<typeof layoutLawnZone>;

export function positionToLocal(origin: LngLat) {
  return makeLocalProjection(origin);
}

export function pointInSector(
  sample: PtM,
  head: PtM,
  radiusM: number,
  arcDeg: number,
  rotationDeg: number,
): boolean {
  const dx = sample.x - head.x;
  const dy = sample.y - head.y;
  const d = Math.hypot(dx, dy);
  if (d > radiusM) return false;
  if (arcDeg >= 360) return true;
  const bearing = ((90 - (Math.atan2(dy, dx) * 180) / Math.PI) + 360) % 360;
  const half = arcDeg / 2;
  const delta = ((bearing - rotationDeg + 540) % 360) - 180;
  return Math.abs(delta) <= half + 0.5;
}

export function pointInStrip(
  sample: PtM,
  head: PtM,
  widthM: number,
  lengthM: number,
  rotationDeg: number,
): boolean {
  const a = compassToMathAngle(rotationDeg);
  const dx = sample.x - head.x;
  const dy = sample.y - head.y;
  const along = dx * Math.cos(a) + dy * Math.sin(a);
  const across = -dx * Math.sin(a) + dy * Math.cos(a);
  return along >= 0 && along <= lengthM && Math.abs(across) <= widthM / 2;
}
