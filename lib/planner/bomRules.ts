import { CATALOG, type SimplePart } from "./catalog";
import type { PipeRun } from "./types";

/** Extra PE / cable allowance for cuts, scrap, and site routing. */
export const MATERIAL_SPARE_FACTOR = 1.1;

/**
 * Direct-bury splices for multi-wire valve wiring (3M DBR/Y-6):
 * one hermetic splice per zone control wire + one for the common wire
 * that joins all valves. One DBRY-6 may join several compatible conductors.
 */
export function spliceConnectorQty(zoneCount: number): number {
  if (zoneCount <= 0) return 0;
  return zoneCount + 1;
}

/** Prefer main-line OD; else largest OD present; default PE25 for small systems. */
export function mainOdFromPipes(pipes: PipeRun[]): number {
  const mains = pipes.filter((p) => p.kind === "main");
  const pool = mains.length > 0 ? mains : pipes;
  if (pool.length === 0) return 25;
  return Math.max(...pool.map((p) => p.odMm ?? (p.kind === "main" ? 32 : 25)));
}

export function manifoldInletAdapter(mainOdMm: number): {
  part: SimplePart;
  odMm: number;
  label: string;
} {
  const zp = CATALOG.zoneParts;
  if (mainOdMm >= 32) {
    return {
      part: zp.adapterPe32Valve,
      odMm: 32,
      label: "Kupplung PE 32 → Verteiler",
    };
  }
  return {
    part: zp.adapterPe25Valve,
    odMm: 25,
    label: "Kupplung PE 25 → Verteiler",
  };
}

/** PE Klemm × 1″ AG into 1″ IG Kugelhahn (matches main OD). */
export function sourcePeAdapter(mainOdMm: number): {
  part: SimplePart;
  odMm: number;
  label: string;
} {
  const sp = CATALOG.sourceParts;
  if (mainOdMm >= 32) {
    return {
      part: sp.adapterPe32Source,
      odMm: 32,
      label: "Kupplung PE 32 × 1″ AG → Kugelhahn",
    };
  }
  return {
    part: sp.adapterPe25Source,
    odMm: 25,
    label: "Kupplung PE 25 × 1″ AG → Kugelhahn",
  };
}

export function wireMetersWithSpare(wireLengthM: number): number {
  return Math.max(5, Math.ceil(wireLengthM * MATERIAL_SPARE_FACTOR));
}

/** Scheibenfilter with PE unions matching mainline OD (25 → SF19, 32 → SF20). */
export function sourceDiscFilter(mainOdMm: number): SimplePart {
  const sp = CATALOG.sourceParts;
  if (mainOdMm >= 32) return sp.discFilterPe32;
  return sp.discFilterPe25;
}

/**
 * Valve box for N zones / manifold outlets.
 * Mapping from vormontierte-Einheit footprints (user table) ↔ shop sizes:
 *  ≤4 → VENT-EK 520×400×330; 5–12 → VENT-EG 660×555×330; overflow → VENT-EJ Jumbo.
 */
export function selectValveBox(zoneCount: number): {
  part: SimplePart;
  maxValveCount: number;
  qty: number;
} {
  const zp = CATALOG.zoneParts;
  const boxes =
    zp.valveBoxes && zp.valveBoxes.length > 0
      ? [...zp.valveBoxes].sort((a, b) => a.maxValveCount - b.maxValveCount)
      : [{ ...zp.valveBox, maxValveCount: 4 }];

  if (zoneCount <= 0) {
    return { part: boxes[0], maxValveCount: boxes[0].maxValveCount, qty: 0 };
  }

  const fit =
    boxes.find((b) => b.maxValveCount >= zoneCount) ?? boxes[boxes.length - 1];
  const qty = Math.ceil(zoneCount / fit.maxValveCount);
  return { part: fit, maxValveCount: fit.maxValveCount, qty };
}

/** Turning angle at B for path A→B→C (0° = straight, 90° = right angle). */
function turningAngleDeg(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const d1 = Math.hypot(v1x, v1y);
  const d2 = Math.hypot(v2x, v2y);
  if (d1 < 0.05 || d2 < 0.05) return 0;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (d1 * d2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Count PE Klemmwinkel needed for trench bends (not head Swing T/Winkel).
 * Uses polyline waypoints on each sized pipe run (obstacle detours, L-mains).
 */
export function countRouteElbowsByOd(
  pipes: PipeRun[],
  minTurnDeg = 35,
): Map<number, number> {
  const byOd = new Map<number, number>();
  for (const p of pipes) {
    const od = p.odMm ?? (p.kind === "main" ? 32 : 25);
    const pts = p.points;
    if (!pts || pts.length < 3) continue;
    // Equirectangular around first point — garden-scale OK for angles
    const origin = pts[0];
    const R = 6371000;
    const toRad = Math.PI / 180;
    const cosLat = Math.cos(origin.lat * toRad);
    const local = pts.map((q) => ({
      x: (q.lng - origin.lng) * toRad * R * cosLat,
      y: (q.lat - origin.lat) * toRad * R,
    }));
    let n = 0;
    for (let i = 1; i < local.length - 1; i++) {
      if (turningAngleDeg(local[i - 1], local[i], local[i + 1]) >= minTurnDeg) {
        n += 1;
      }
    }
    if (n > 0) byOd.set(od, (byOd.get(od) ?? 0) + n);
  }
  return byOd;
}

export function peElbowPart(odMm: number): SimplePart | null {
  const pipes = CATALOG.pipes;
  if (odMm >= 32) return pipes.elbowPe32 ?? null;
  return pipes.elbowPe25 ?? null;
}

export function peCouplingPart(odMm: number): SimplePart | null {
  const pipes = CATALOG.pipes;
  if (odMm >= 32) return pipes.couplingPe32 ?? null;
  return pipes.couplingPe25 ?? null;
}
