export const ZONE_TYPES = [
  { id: "rasen", label: "Rasen", color: "#00FFCF" },
  { id: "hecke", label: "Hecke", color: "#1B5E3B" },
  { id: "gebaeude", label: "Gebäude", color: "#FF5C45" },
  { id: "trocken", label: "Trockenfläche", color: "#D4A574" },
  { id: "beet", label: "Beet", color: "#8B5A2B" },
] as const;

export type ZoneTypeId = (typeof ZONE_TYPES)[number]["id"];

export type LngLat = { lng: number; lat: number };

export type DrawnZone = {
  id: string;
  type: ZoneTypeId;
  coordinates: LngLat[]; // closed ring (first === last optional; we store open + close on finish)
};

/** After Flächen: place all Technik icons in one stage, then the result. */
export type PlotStage = "zones" | "technik" | "ergebnis";

export type FixtureKind = "wasserquelle" | "smarthome" | "wasserverteiler";

export const WASSERQUELLE_TYPES = [
  { id: "leitungswasser", label: "Leitungswasser" },
  { id: "zisterne", label: "Zisterne" },
  { id: "brunnen", label: "Brunnen" },
] as const;

export type WasserquelleTypeId = (typeof WASSERQUELLE_TYPES)[number]["id"];

export type WasserquelleMengeMode = "unbekannt" | "bekannt";
export type PumpeChoice = "kaufen" | "vorhanden";

export type PlotFixture = {
  id: string;
  kind: FixtureKind;
  position: LngLat;
  /** Only for wasserquelle — kept for later project calculations */
  wasserquelleType?: WasserquelleTypeId;
  wasserquelleMenge?: WasserquelleMengeMode;
  /** Flow rate in m³/h (bekannt or via Eimer-Test) */
  wassermengeM3h?: number;
  /** Dynamic residual pressure (bar) at known flow — one Q–P point for v2 */
  dynamicPressureBar?: number;
  zisternenpumpe?: PumpeChoice;
  brunnenpumpe?: PumpeChoice;
};

export const FIXTURE_STEPS: {
  id: FixtureKind;
  label: string;
  short: string;
  hint: string;
}[] = [
  {
    id: "wasserquelle",
    label: "Wasserquelle",
    short: "Quelle",
    hint: "Tippen Sie auf den Plan, um die Wasserquelle zu setzen (Hahn, Brunnen, Hausanschluss).",
  },
  {
    id: "smarthome",
    label: "Elektrik / Smarthome",
    short: "Elektrik",
    hint: "Platzieren Sie den Stromanschluss / die Smarthome-Steuerung (Controller).",
  },
  {
    id: "wasserverteiler",
    label: "Ventilkasten",
    short: "Kasten",
    hint: "Platzieren Sie den Ventilkasten (Verteilereinheit).",
  },
];

export const PLOT_STAGE_ORDER: PlotStage[] = ["zones", "technik", "ergebnis"];

export const PLOT_STAGE_META: {
  id: PlotStage;
  label: string;
  short: string;
}[] = [
  { id: "zones", label: "Flächen", short: "Flächen" },
  { id: "technik", label: "Technik", short: "Technik" },
  { id: "ergebnis", label: "Ergebnis", short: "Plan" },
];
export type GeocodeFeature = {
  id: string;
  placeName: string;
  center: [number, number]; // [lng, lat]
  address?: string;
  context?: string;
};

export function getMapboxToken(): string {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN is missing");
  }
  return token;
}

export async function searchAddresses(params: {
  street: string;
  number: string;
  plz: string;
  city: string;
}): Promise<GeocodeFeature[]> {
  const token = getMapboxToken();
  const query = [params.street, params.number, params.plz, params.city]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

  if (query.length < 3) return [];

  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
  );
  url.searchParams.set("access_token", token);
  url.searchParams.set("country", "de");
  url.searchParams.set("language", "de");
  url.searchParams.set("types", "address,place");
  url.searchParams.set("limit", "6");
  url.searchParams.set("autocomplete", "true");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error("Geocoding fehlgeschlagen");
  }

  const data = (await res.json()) as {
    features: Array<{
      id: string;
      place_name: string;
      center: [number, number];
      text?: string;
      address?: string;
      context?: Array<{ text: string }>;
    }>;
  };

  return (data.features ?? []).map((f) => ({
    id: f.id,
    placeName: f.place_name,
    center: f.center,
    address: [f.address, f.text].filter(Boolean).join(" "),
    context: f.context?.map((c) => c.text).join(", "),
  }));
}

export function distMeters(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function midpoint(a: LngLat, b: LngLat): LngLat {
  return { lng: (a.lng + b.lng) / 2, lat: (a.lat + b.lat) / 2 };
}

export function perimeterMeters(points: LngLat[], closed = false): number {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += distMeters(points[i], points[i + 1]);
  }
  if (closed && points.length >= 3) {
    sum += distMeters(points[points.length - 1], points[0]);
  }
  return sum;
}

/** Spherical excess approximation (m²) for a ring of lng/lat points. */
export function polygonAreaM2(points: LngLat[]): number {
  if (points.length < 3) return 0;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const lat1 = toRad(points[i].lat);
    const lat2 = toRad(points[j].lat);
    const lng1 = toRad(points[i].lng);
    const lng2 = toRad(points[j].lng);
    area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs((area * R * R) / 2);
}

export function formatMeters(m: number): string {
  if (m < 10) return `${m.toFixed(1).replace(".", ",")} m`;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2).replace(".", ",")} km`;
}

export function formatAreaM2(m2: number): string {
  if (m2 < 10000) return `${Math.round(m2).toLocaleString("de-DE")} m²`;
  return `${(m2 / 10000).toFixed(2).replace(".", ",")} a`;
}

export function polygonCentroid(points: LngLat[]): LngLat {
  if (points.length === 0) return { lng: 0, lat: 0 };
  let lng = 0;
  let lat = 0;
  for (const p of points) {
    lng += p.lng;
    lat += p.lat;
  }
  return { lng: lng / points.length, lat: lat / points.length };
}

/** Ray-cast point-in-polygon (lng/lat). Fine for garden-scale rings. */
export function pointInRing(pt: LngLat, ring: LngLat[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat;
    const yj = ring[j].lat;
    const xi = ring[i].lng;
    const xj = ring[j].lng;
    const denom = yj - yi || 1e-12;
    const intersect =
      yi > pt.lat !== yj > pt.lat &&
      pt.lng < ((xj - xi) * (pt.lat - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Topmost (last drawn) zone containing the point, or null. */
export function findZoneAtPoint(
  zones: DrawnZone[],
  pt: LngLat,
): DrawnZone | null {
  for (let i = zones.length - 1; i >= 0; i--) {
    if (pointInRing(pt, zones[i].coordinates)) return zones[i];
  }
  return null;
}
