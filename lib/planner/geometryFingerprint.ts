import type { DrawnZone } from "@/lib/mapbox";
import { polygonAreaM2 } from "@/lib/mapbox";

export type GeometrySummary = {
  fingerprint: string;
  lawnCount: number;
  buildingCount: number;
  lawns: Array<{ id: string; areaM2: number; vertexCount: number }>;
  buildings: Array<{ id: string; areaM2: number; vertexCount: number }>;
};

/** Stable id from Rasen + Gebäude coordinates (6 decimal deg ≈ 0.1 m). */
export function geometryFingerprint(zones: DrawnZone[]): string {
  const parts = zones
    .filter((z) => z.type === "rasen" || z.type === "gebaeude")
    .sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`))
    .map(
      (z) =>
        `${z.type}:${z.coordinates
          .map((c) => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`)
          .join(";")}`,
    )
    .join("|");

  let h = 5381;
  for (let i = 0; i < parts.length; i++) {
    h = (Math.imul(33, h) + parts.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function geometrySummary(zones: DrawnZone[]): GeometrySummary {
  const lawns = zones.filter((z) => z.type === "rasen");
  const buildings = zones.filter((z) => z.type === "gebaeude");
  return {
    fingerprint: geometryFingerprint(zones),
    lawnCount: lawns.length,
    buildingCount: buildings.length,
    lawns: lawns.map((z) => ({
      id: z.id,
      areaM2: Math.round(polygonAreaM2(z.coordinates) * 10) / 10,
      vertexCount: z.coordinates.length,
    })),
    buildings: buildings.map((z) => ({
      id: z.id,
      areaM2: Math.round(polygonAreaM2(z.coordinates) * 10) / 10,
      vertexCount: z.coordinates.length,
    })),
  };
}

/** Match reference fixture ~603 m² L + Gebäude (±3 m²). */
export function matchesReference603(summary: GeometrySummary): boolean {
  if (summary.lawnCount !== 1 || summary.buildingCount !== 1) return false;
  const lawn = summary.lawns[0]?.areaM2 ?? 0;
  const bldg = summary.buildings[0]?.areaM2 ?? 0;
  return lawn >= 598 && lawn <= 610 && bldg >= 655 && bldg <= 690;
}
