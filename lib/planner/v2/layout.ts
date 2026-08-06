import type { DrawnZone, LngLat } from "@/lib/mapbox";
import {
  brandEmitters,
  CATALOG,
  DEFAULT_BRAND,
  primaryNozzleOrder,
  sideStripKey,
  smallNozzleKey,
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
} from "./geometry";
import type { PtM, SprinklerHead } from "../types";
import {
  DESIGN_PRESSURE_BAR,
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

/** Official manufacturer ranges — never invent outside them. */
function pickFamilyForNeed(
  needM: number,
  brand: SprinklerBrand,
  emitters: BrandEmitters,
): Family {
  const n = emitters.sprayHead.nozzles;
  const order = primaryNozzleOrder(brand);
  for (const key of order) {
    const spec = n[key];
    if (!spec) continue;
    if (needM >= spec.radiusMinM && needM <= spec.radiusMaxM) {
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
  if (last && needM <= last.radiusMaxM) {
    return {
      kind: "spray",
      familyKey: lastKey,
      radiusMinM: last.radiusMinM,
      radiusMaxM: last.radiusMaxM,
      arcMinDeg: last.arcMinDeg,
      arcMaxDeg: last.arcMaxDeg,
    };
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
  // Round up to 5° so corner wedges aren't left dry after inset
  const rounded = Math.ceil(arcDeg / 5) * 5;
  return Math.min(
    fam.arcMaxDeg,
    Math.max(fam.arcMinDeg, rounded),
  );
}

/**
 * Aim a corner head so both adjacent edges (and the vertex) stay in the
 * sector — accounts for mount inset which widens the needed angle.
 */
function cornerAim(
  ring: PtM[],
  vertexIdx: number,
  pt: PtM,
  obstacles: PtM[][],
): { arcDeg: number; rotationDeg: number } {
  const measured = lawnFacingSector(pt, ring, obstacles, 0.85);
  if (measured && measured.arcDeg >= 40) {
    // Slight oversweep so white corner wedges disappear
    return {
      arcDeg: Math.min(270, measured.arcDeg + 4),
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
    arcDeg: Math.min(270, Math.max(45, bestArc + 10)),
    rotationDeg: bestMid,
  };
}

function mountInset(nearBuilding: boolean): number {
  return nearBuilding ? BUILDING_MOUNT_M : EDGE_EPS_M;
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

  const arcDeg = Math.min(
    270,
    Math.max(45, Math.round(((bestLen * 360) / N) / 5) * 5),
  );
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
): { radiusM: number; mayOvershoot: boolean; h2hOk: boolean } {
  const clearance = sectorClearanceM(
    h.pt,
    h.rotationDeg,
    h.arcDeg >= 315 ? 360 : h.arcDeg,
    ring,
    obstacles,
  );
  const maxSafe = Math.max(0, clearance * 0.995);

  // Target: reach neighbour (head-to-head), else mid-family throw
  let desired = Number.isFinite(nearestNeighborM)
    ? nearestNeighborM
    : (fam.radiusMinM + fam.radiusMaxM) / 2;
  desired = Math.min(fam.radiusMaxM, Math.max(fam.radiusMinM, desired));
  if (maxSafe >= fam.radiusMinM) {
    desired = Math.min(desired, maxSafe);
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

function coversPoint(
  sample: PtM,
  h: LocalHead,
  radiusM: number,
): boolean {
  if (h.kind === "strip") {
    const a = compassToMathAngle(h.rotationDeg);
    const dx = sample.x - h.pt.x;
    const dy = sample.y - h.pt.y;
    const along = dx * Math.cos(a) + dy * Math.sin(a);
    const across = -dx * Math.sin(a) + dy * Math.cos(a);
    const len = h.stripLengthM ?? radiusM;
    const w = h.stripWidthM ?? 1.5;
    return along >= 0 && along <= len && Math.abs(across) <= w / 2;
  }
  const d = dist(sample, h.pt);
  if (d > radiusM) return false;
  if (h.arcDeg >= 360) return true;
  const bearing = ((90 - (Math.atan2(sample.y - h.pt.y, sample.x - h.pt.x) * 180) / Math.PI) + 360) % 360;
  const half = h.arcDeg / 2;
  const delta = ((bearing - h.rotationDeg + 540) % 360) - 180;
  return Math.abs(delta) <= half + 0.5;
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

  return kept.map((h, idx) => {
    let nearest = Infinity;
    for (const other of kept) {
      if (other === h) continue;
      nearest = Math.min(nearest, dist(h.pt, other.pt));
    }

    // Clearance on the geometric sector (ignore a few degrees of oversweep)
    // so radius isn't artificially starved by corner padding.
    const arcForThrow = Math.max(45, (h.arcDeg >= 315 ? 360 : h.arcDeg) - 4);
    const clearance = sectorClearanceM(
      h.pt,
      h.rotationDeg,
      arcForThrow,
      ring,
      obstacles,
    );
    // Pick nozzle for available throw (clearance), not only neighbour spacing —
    // larger families cover more when the lawn allows it.
    const needM = Math.max(
      2.4,
      clearance > 0.5 ? Math.min(clearance, 9.5) : 2.4,
    );
    const fam = pickFamilyForNeed(needM, brand, emitters);
    const { radiusM, mayOvershoot, h2hOk } = resolveRadius(
      h,
      fam,
      nearest,
      ring,
      obstacles,
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

/**
 * Place sprinkler heads on one lawn polygon.
 *
 * Order: corners → long edges → near-building edges → dry-spot 360°.
 * Hard rule: radius capped so spray stays on lawn and off Gebäude.
 * Spacing aims for head-to-head (distance ≤ working radius).
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

  // v2 §7.1: classify by local width vs strip footprint — not global 2.8 m
  const stripKey = sideStripKey(brand);
  const stripSpec = emitters.sprayHead.strips[stripKey];
  const stripWidthThresh = stripSpec
    ? Math.max(stripSpec.widthM * 1.35, 2.2)
    : 2.8;
  const local = narrowFraction(ring, obstacleRings, stripWidthThresh);
  const mostlyStrip =
    local.fraction >= 0.72 && local.medianWidthM < stripWidthThresh;

  if (mostlyStrip || (widthM < stripWidthThresh && local.p20WidthM < stripWidthThresh)) {
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

  // Working radius for spacing: cover toward mid-lawn from edges (≈ half width)
  const spacingNeed = Math.max(2.4, Math.min(widthM * 0.55, 7.3));
  const spacingFam = pickFamilyForNeed(spacingNeed, brand, emitters);
  const R = Math.max(
    spacingFam.radiusMinM,
    Math.min(spacingNeed, spacingFam.radiusMaxM),
  );
  // v2 §7.4: spacing ≤ actual throw (spacingFactor ≤ 1; default 1.0)
  const spacingFactor = CATALOG.hydraulics.spacingFactor ?? 1.0;
  const S = R * Math.min(1, spacingFactor);

  const kept: LocalHead[] = [];

  function tooClose(pt: PtM, minSep = S * 0.7): boolean {
    return kept.some((k) => dist(k.pt, pt) < minSep);
  }

  function tryPush(h: LocalHead): boolean {
    if (!pointInPolygon(h.pt, ring)) return false;
    if (obstacleRings.some((o) => pointInPolygon(h.pt, o))) return false;
    if (tooClose(h.pt)) return false;
    kept.push(h);
    return true;
  }

  // ——— 1. Lawn corners (convex outer + concave notches) ———
  for (let i = 0; i < ring.length; i++) {
    const ang = interiorAngleDeg(ring, i);
    if (ang < 40 || ang > 320) continue;
    const bis = inwardBisectorDeg(ring, i);
    const nearBldg = isNearBuilding(ring[i], obstacleRings);
    const pt = offsetPoint(ring[i], bis, mountInset(nearBldg));

    const aim = cornerAim(ring, i, pt, obstacleRings);
    tryPush({
      pt,
      arcDeg: aim.arcDeg,
      rotationDeg: aim.rotationDeg,
      priority: nearBldg || ang > 185 ? 2 : 0,
    });
  }

  // ——— 2. Building façades & corners (Bewässerungsbox-style) ———
  // When Gebäude sit on/inside the lawn, heads go on the lawn side of every
  // façade corner and along long walls — spray points away from the building.
  for (const rawBldg of obstacleRings) {
    const bldg = ensureCCW(rawBldg);
    if (bldg.length < 3) continue;

    // 2a. Building corners that touch irrigable lawn
    for (let i = 0; i < bldg.length; i++) {
      const n = bldg.length;
      const nPrev = outwardNormalDeg(bldg, (i - 1 + n) % n);
      const nNext = outwardNormalDeg(bldg, i);
      const intoLawn = averageCompassDeg(nPrev, nNext);
      const pt = offsetPoint(bldg[i], intoLawn, BUILDING_MOUNT_M);
      if (!pointInPolygon(pt, ring)) continue;
      if (obstacleRings.some((o) => pointInPolygon(pt, o))) continue;

      const sector = lawnFacingSector(pt, ring, obstacleRings);
      if (!sector || sector.arcDeg < 40) continue;
      // Skip near-full circles at building corners — those belong in the center
      if (sector.arcDeg >= 315) continue;

      tryPush({
        pt,
        arcDeg: Math.min(270, sector.arcDeg + 4),
        rotationDeg: sector.rotationDeg,
        priority: 2,
      });
    }

    // 2b. Long building edges that abut lawn → 180° away from façade
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
      if (L <= S * 1.35) continue;
      const nSeg = Math.max(2, Math.ceil(L / (S * 1.1)));
      for (let k = 1; k < nSeg; k++) {
        const t = k / nSeg;
        const onEdge = {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        };
        const pt = offsetPoint(onEdge, out, BUILDING_MOUNT_M);
        const face = lawnFacingSector(pt, ring, obstacleRings, 0.7);
        tryPush({
          pt,
          arcDeg: face
            ? Math.min(195, Math.max(165, face.arcDeg + 3))
            : 180,
          rotationDeg: face?.rotationDeg ?? out,
          priority: 2,
        });
      }
    }
  }

  // ——— 3. Long lawn edges → 180° inward (head-to-head spacing ≤ R) ———
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const L = dist(a, b);
    if (L <= S * 1.2) continue;

    const normal = inwardNormalDeg(ring, i);
    // Skip edges that run along a building (already handled in step 2)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const outProbe = offsetPoint(mid, (normal + 180) % 360, 0.35);
    const alongBuilding = obstacleRings.some((o) => pointInPolygon(outProbe, o));
    if (alongBuilding) continue;

    const nSeg = Math.max(2, Math.ceil(L / (S * 1.05)));
    for (let k = 1; k < nSeg; k++) {
      const t = k / nSeg;
      const onEdge = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
      const nearBldg = isNearBuilding(onEdge, obstacleRings);
      const pt = offsetPoint(onEdge, normal, mountInset(nearBldg));
      const face = lawnFacingSector(pt, ring, obstacleRings, 0.7);
      tryPush({
        pt,
        arcDeg: face
          ? Math.min(195, Math.max(165, face.arcDeg + 3))
            : 180,
        rotationDeg: face?.rotationDeg ?? normal,
        priority: nearBldg ? 2 : 1,
      });
    }
  }

  // ——— 4. Dry pockets → interior 360° (often small radius)
  // Perimeter heads are capped by buildings/boundaries and often cannot
  // reach the middle. Detect dry cells with *effective* throw, then place
  // full-circle heads even when only the smallest spray clearance exists.
  const step = Math.max(0.45, Math.min(box.w, box.h) / 18);
  const smallMin =
    emitters.sprayHead.nozzles[smallNozzleKey(brand)]?.radiusMinM ??
    emitters.sprayHead.nozzles[primaryNozzleOrder(brand)[0]]?.radiusMinM ??
    2.4;

  function effectiveRadius(h: LocalHead): number {
    const clearance = sectorClearanceM(
      h.pt,
      h.rotationDeg,
      h.arcDeg >= 315 ? 360 : h.arcDeg,
      ring,
      obstacleRings,
    );
    const need = Math.min(R, Math.max(0, clearance * 0.98));
    const fam = pickFamilyForNeed(Math.max(need, smallMin), brand, emitters);
    return Math.min(
      fam.radiusMaxM,
      Math.max(fam.radiusMinM, Math.min(need || fam.radiusMinM, fam.radiusMaxM)),
    );
  }

  function isCoveredByKept(p: PtM): boolean {
    return kept.some((h) => coversPoint(p, h, effectiveRadius(h)));
  }

  function uncoveredSamples(): PtM[] {
    const dry: PtM[] = [];
    for (let y = box.minY + step / 2; y <= box.maxY; y += step) {
      for (let x = box.minX + step / 2; x <= box.maxX; x += step) {
        const p = { x, y };
        if (!pointInPolygon(p, ring)) continue;
        if (obstacleRings.some((o) => pointInPolygon(p, o))) continue;
        // Keep mid-lawn samples; only skip a thin strip on the boundary
        if (distToBoundary(p, ring) < 0.4) continue;
        if (!isCoveredByKept(p)) dry.push(p);
      }
    }
    return dry;
  }

  /** v2 §7.6: 360° only if dist to NO_SPRAY ≥ actualRadius − tolerance */
  function blocksInterior(pt: PtM, plannedRadiusM = smallMin): boolean {
    const tol = 0.15;
    if (distToBoundary(pt, ring) < plannedRadiusM - tol) return true;
    const obst = distToObstacles(pt, obstacleRings);
    if (Number.isFinite(obst) && obst < plannedRadiusM - tol) return true;
    for (const h of kept) {
      const d = dist(h.pt, pt);
      if (d < Math.max(plannedRadiusM * 0.55, S * 0.55)) return true;
      if (h.arcDeg >= 315 && d < Math.max(2.2, effectiveRadius(h) * 0.5)) {
        return true;
      }
    }
    return false;
  }

  function countLawnSamples(): number {
    let total = 0;
    for (let y = box.minY + step / 2; y <= box.maxY; y += step) {
      for (let x = box.minX + step / 2; x <= box.maxX; x += step) {
        const p = { x, y };
        if (!pointInPolygon(p, ring)) continue;
        if (obstacleRings.some((o) => pointInPolygon(p, o))) continue;
        total += 1;
      }
    }
    return total;
  }

  let dry = uncoveredSamples();
  const maxInterior = 6;
  let added = 0;
  while (dry.length > 0 && added < maxInterior) {
    let best: PtM | null = null;
    let bestScore = -1;

    for (const p of dry) {
      if (obstacleRings.some((o) => pointInPolygon(p, o))) continue;

      const clearance = sectorClearanceM(p, 0, 360, ring, obstacleRings);
      // v2 §7.6: room for planned 360° radius
      if (clearance < smallMin * 1.05) continue;
      const plannedR = Math.min(clearance * 0.98, Math.max(R, smallMin));
      if (blocksInterior(p, plannedR)) continue;

      let localDry = 0;
      const reach = Math.min(clearance, Math.max(R, smallMin));
      for (const q of dry) {
        if (dist(p, q) <= reach) localDry += 1;
      }
      // Prefer deeper interior points
      const score = localDry * 20 + clearance + distToBoundary(p, ring);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    if (!best || bestScore < 25) break;

    if (!pointInPolygon(best, ring)) break;
    if (obstacleRings.some((o) => pointInPolygon(best, o))) break;
    kept.push({
      pt: best,
      arcDeg: 360,
      rotationDeg: 0,
      priority: 3,
    });
    added += 1;
    dry = uncoveredSamples();
  }
  if (added > 0) {
    warnings.push(
      `${added} Innenregner 360° für Trockeninsel(n) gesetzt (Kantenreichweite durch Gebäude/Grenze begrenzt).`,
    );
  }

  // Self-check: remaining dry fraction (layout audit)
  dry = uncoveredSamples();
  const totalSamples = countLawnSamples();
  if (totalSamples > 0) {
    const dryPct = (100 * dry.length) / totalSamples;
    if (dryPct >= 4) {
      warnings.push(
        `Layout-Audit: noch ≈${dryPct.toFixed(0)} % Trockenfläche — Abdeckung prüfen.`,
      );
    }
  }

  // ——— 5. Prune: only if head-to-head + coverage + dry patch stay ok (§8.1) ———
  if (kept.length > 4) {
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].priority < 1) continue;
      const without = kept.filter((_, j) => j !== i);
      const saved = [...kept];
      kept.length = 0;
      kept.push(...without);
      const dryWithout = uncoveredSamples();
      const total = countLawnSamples();
      // Head-to-head among remaining: each pair of near heads should reach
      let h2hOk = true;
      for (let a = 0; a < without.length; a++) {
        for (let b = a + 1; b < without.length; b++) {
          const d = dist(without[a].pt, without[b].pt);
          if (d > S * 1.8) continue;
          const ra = effectiveRadius(without[a]);
          const rb = effectiveRadius(without[b]);
          if (ra + 0.2 < d && rb + 0.2 < d) {
            h2hOk = false;
            break;
          }
        }
        if (!h2hOk) break;
      }
      kept.length = 0;
      kept.push(...saved);
      const dryFrac = total > 0 ? dryWithout.length / total : 1;
      if (h2hOk && dryFrac <= 0.02) {
        kept.splice(i, 1);
      }
    }
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
