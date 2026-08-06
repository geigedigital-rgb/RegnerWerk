/**
 * Build a compact planner catalog for the Sofort-Berechnung engine.
 *
 * Sources:
 *  - data/catalog/normalized/RegnerWerk_universal.json  (attrs, performance tables, prices)
 *  - data/raw/products-ai.json                          (price fallback, install-set variant prices)
 *  - data/raw/variant-prices/*.json                     (shop option prices when AI lacks price_eur)
 *
 * Output: data/planner/planner-catalog.json — small enough to import in the client bundle.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const UNIVERSAL = path.join(
  ROOT,
  "data/catalog/normalized/RegnerWerk_universal.json",
);
const AI = path.join(ROOT, "data/raw/products-ai.json");
const VARIANT_PRICES = path.join(ROOT, "data/raw/variant-prices");
const OUT = path.join(ROOT, "data/planner/planner-catalog.json");

type Product = {
  product_id?: string;
  article?: string | null;
  model?: string;
  name?: string;
  brand?: string;
  manufacturer?: string;
  group_id?: string;
  price_eur?: number | null;
  unit?: string;
  attributes?: Record<string, unknown>;
  media?: { images?: string[] };
  images?: string[];
  bom?: { price_eur?: number | null };
  performance_tables?: Array<{
    table_id?: string;
    rows?: Array<Record<string, number | string | null>>;
  }>;
  source?: { source_url?: string; source_variant?: string };
};

type AiItem = {
  title?: string;
  url?: string;
  price?: number;
  price_eur?: number;
};

type VariantOption = {
  label?: string;
  name?: string;
  price?: number;
  price_eur?: number;
};

const universal = JSON.parse(fs.readFileSync(UNIVERSAL, "utf8")) as {
  products: Product[];
};
const ai = JSON.parse(fs.readFileSync(AI, "utf8")) as AiItem[] | {
  products?: AiItem[];
};
const aiItems: AiItem[] = Array.isArray(ai) ? ai : (ai.products ?? []);

const products = universal.products;

/** Flatten shop option prices from variant-prices/*.json */
const variantOptions: Array<{ label: string; price: number }> = [];
if (fs.existsSync(VARIANT_PRICES)) {
  for (const file of fs.readdirSync(VARIANT_PRICES)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(VARIANT_PRICES, file), "utf8"),
      ) as { options?: VariantOption[] };
      for (const o of raw.options ?? []) {
        const label = o.label ?? o.name ?? "";
        const price = o.price ?? o.price_eur;
        if (label && typeof price === "number") {
          variantOptions.push({ label, price });
        }
      }
    } catch {
      /* skip corrupt files */
    }
  }
}

function byArticle(article: string): Product | undefined {
  return products.find((p) => p.article === article);
}

function productImage(p: Product | undefined): string | null {
  if (!p) return null;
  const fromMedia = p.media?.images?.[0];
  if (typeof fromMedia === "string" && fromMedia) return fromMedia;
  const fromImages = p.images?.[0];
  if (typeof fromImages === "string" && fromImages) return fromImages;
  return null;
}

function itemPrice(it: AiItem | undefined): number | null {
  if (!it) return null;
  if (typeof it.price_eur === "number") return it.price_eur;
  if (typeof it.price === "number") return it.price;
  return null;
}

function aiPrice(titleRe: RegExp): number | null {
  const hit = aiItems.find(
    (it) => itemPrice(it) != null && titleRe.test(it.title ?? ""),
  );
  return itemPrice(hit);
}

function variantPrice(labelRe: RegExp): number | null {
  const hit = variantOptions.find((o) => labelRe.test(o.label));
  return hit?.price ?? null;
}

function price(
  p: Product | undefined,
  ...fallbacks: Array<RegExp | number | null>
): number | null {
  if (typeof p?.price_eur === "number") return p.price_eur;
  for (const fb of fallbacks) {
    if (typeof fb === "number") return fb;
    if (fb == null) continue;
    const fromAi = aiPrice(fb);
    if (fromAi != null) return fromAi;
    const fromVar = variantPrice(fb);
    if (fromVar != null) return fromVar;
  }
  return null;
}

// ── Install-Set 3.191 variant prices (per nozzle, Anschluss 25 mm) ───────────
type SetVariant = {
  nozzleKey: string;
  anschluss: "tee" | "elbow";
  label: string;
  priceEur: number | null;
};

const NOZZLE_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: "R-VAN14", re: /R-VAN\s?14,/i },
  { key: "R-VAN18", re: /R-VAN\s?18,/i },
  { key: "R-VAN24", re: /R-VAN\s?24,/i },
  { key: "R-VAN14-360", re: /R-VAN\s?14-360/i },
  { key: "R-VAN18-360", re: /R-VAN\s?18-360/i },
  { key: "R-VAN24-360", re: /R-VAN\s?24-360/i },
  { key: "R-VAN-LCS", re: /R-VAN-LCS/i },
  { key: "R-VAN-RCS", re: /R-VAN-RCS/i },
  { key: "R-VAN-SST", re: /R-VAN-SST/i },
];

const setVariants: SetVariant[] = [];
for (const it of aiItems) {
  const title = it.title ?? "";
  if (!/Installation-Set Rain-Bird 1804/i.test(title)) continue;
  const tail = title.includes("—") ? title.split("—").slice(1).join("—") : title;
  // Body must be 1804-SAM 3,1 bar (PRS-45) — not parent title listing all options
  if (!/1804-SAM 3,1/i.test(tail)) continue;
  const anschluss = /T-Stück 25\b/i.test(tail)
    ? "tee"
    : /Winkel 25\b/i.test(tail)
      ? "elbow"
      : null;
  if (!anschluss) continue;
  const nozzle = NOZZLE_PATTERNS.find((n) => n.re.test(tail));
  if (!nozzle) continue;
  if (
    setVariants.some(
      (v) => v.nozzleKey === nozzle.key && v.anschluss === anschluss,
    )
  ) {
    continue;
  }
  setVariants.push({
    nozzleKey: nozzle.key,
    anschluss,
    label: tail.trim(),
    priceEur: itemPrice(it),
  });
}

// ── Emitter hydraulics from performance tables ───────────────────────────────

type PerfRow = {
  pressureBar: number;
  arcDeg?: number;
  radiusM?: number;
  widthM?: number;
  lengthM?: number;
  flowLMin: number;
  precipSquareMmH?: number;
  precipTriangleMmH?: number;
};

type RotorOpt = {
  nozzle: string;
  pressureBar: number;
  radiusM: number;
  flowLMin: number;
  precipSquareMmH?: number;
  precipTriangleMmH?: number;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function pressureBand(p: Product | undefined): {
  pressureMinBar: number | null;
  pressureRecommendedBar: number | null;
  pressureMaxBar: number | null;
} {
  const a = p?.attributes ?? {};
  return {
    pressureMinBar: num(a.pressure_min_bar),
    pressureRecommendedBar: num(a.pressure_recommended_bar),
    pressureMaxBar: num(a.pressure_max_bar),
  };
}

function precipMeta(p: Product | undefined): {
  precipMmH: number | null;
  matchedPrecipitation: boolean | null;
  precipitationFamily: string | null;
  hydraulicZoneGroup: string | null;
} {
  const a = p?.attributes ?? {};
  return {
    precipMmH: num(a.precipitation_rate_mm_h),
    matchedPrecipitation:
      typeof a.matched_precipitation === "boolean"
        ? a.matched_precipitation
        : null,
    precipitationFamily:
      typeof a.precipitation_family === "string"
        ? a.precipitation_family
        : null,
    hydraulicZoneGroup:
      typeof a.hydraulic_zone_group === "string"
        ? a.hydraulic_zone_group
        : null,
  };
}

/** Keep all published performance rows — do not collapse to a single 2.8 bar point. */
function extractSectorPerformance(p: Product | undefined): PerfRow[] {
  const out: PerfRow[] = [];
  for (const t of p?.performance_tables ?? []) {
    for (const r of t.rows ?? []) {
      const pressureBar = num(r.pressure_bar);
      const flowLMin = num(r.flow_l_min);
      if (pressureBar == null || flowLMin == null) continue;
      const arcDeg = num(r.arc_deg) ?? undefined;
      const radiusM = num(r.radius_m) ?? undefined;
      const precipSquareMmH = num(r.precipitation_square_mm_h) ?? undefined;
      const precipTriangleMmH = num(r.precipitation_triangle_mm_h) ?? undefined;
      out.push({
        pressureBar,
        ...(arcDeg != null ? { arcDeg } : {}),
        ...(radiusM != null ? { radiusM } : {}),
        flowLMin: Number(flowLMin.toFixed(3)),
        ...(precipSquareMmH != null ? { precipSquareMmH } : {}),
        ...(precipTriangleMmH != null ? { precipTriangleMmH } : {}),
      });
    }
  }
  out.sort(
    (a, b) =>
      a.pressureBar - b.pressureBar ||
      (a.arcDeg ?? 0) - (b.arcDeg ?? 0) ||
      (a.radiusM ?? 0) - (b.radiusM ?? 0),
  );
  return out;
}

function extractStripPerformance(p: Product | undefined): PerfRow[] {
  const out: PerfRow[] = [];
  for (const t of p?.performance_tables ?? []) {
    for (const r of t.rows ?? []) {
      const pressureBar = num(r.pressure_bar);
      const flowLMin = num(r.flow_l_min);
      if (pressureBar == null || flowLMin == null) continue;
      out.push({
        pressureBar,
        widthM: num(r.strip_width_m) ?? undefined,
        lengthM: num(r.strip_length_m) ?? undefined,
        radiusM: num(r.radius_m) ?? undefined,
        flowLMin: Number(flowLMin.toFixed(3)),
        precipSquareMmH: num(r.precipitation_square_mm_h) ?? undefined,
        precipTriangleMmH: num(r.precipitation_triangle_mm_h) ?? undefined,
      });
    }
  }
  out.sort((a, b) => a.pressureBar - b.pressureBar);
  return out;
}

function flow360AtRecommended(performance: PerfRow[], preferBar: number): {
  flow360LMin: number | null;
  pressureBar: number;
} {
  if (performance.length === 0) {
    return { flow360LMin: null, pressureBar: preferBar };
  }
  let best: PerfRow | null = null;
  for (const row of performance) {
    if (row.arcDeg == null || row.arcDeg <= 0) continue;
    if (
      !best ||
      Math.abs(row.pressureBar - preferBar) <
        Math.abs(best.pressureBar - preferBar) ||
      (Math.abs(row.pressureBar - preferBar) ===
        Math.abs(best.pressureBar - preferBar) &&
        (row.arcDeg ?? 0) > (best.arcDeg ?? 0))
    ) {
      best = row;
    }
  }
  if (!best || best.arcDeg == null) {
    const near = performance.reduce((a, b) =>
      Math.abs(a.pressureBar - preferBar) <= Math.abs(b.pressureBar - preferBar)
        ? a
        : b,
    );
    return { flow360LMin: near.flowLMin, pressureBar: near.pressureBar };
  }
  return {
    flow360LMin: Number(((best.flowLMin * 360) / best.arcDeg).toFixed(2)),
    pressureBar: best.pressureBar,
  };
}

function meanPrecip(performance: PerfRow[]): number | null {
  const vals = performance
    .map((r) => r.precipSquareMmH)
    .filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return null;
  return Number(
    (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1),
  );
}

function rotatorByModel(modelKey: string): Product | undefined {
  return products.find(
    (x) => x.group_id === "nozzles_rotators" && x.model === modelKey,
  );
}

function nozzleSpecFromProduct(
  p: Product | undefined,
  defaults: {
    radiusMinM: number;
    radiusMaxM: number;
    arcMinDeg: number;
    arcMaxDeg: number;
    precipitationFamily?: string;
    hydraulicZoneGroup?: string;
    patternType?: string;
  },
) {
  const performance = extractSectorPerformance(p);
  const band = pressureBand(p);
  const meta = precipMeta(p);
  const recBar = band.pressureRecommendedBar ?? 2.8;
  const { flow360LMin, pressureBar } = flow360AtRecommended(
    performance,
    recBar,
  );
  const precipMmH =
    meta.precipMmH ?? meanPrecip(performance) ?? undefined;
  return {
    radiusMinM: Number(p?.attributes?.radius_min_m ?? defaults.radiusMinM),
    radiusMaxM: Number(p?.attributes?.radius_max_m ?? defaults.radiusMaxM),
    arcMinDeg: Number(p?.attributes?.arc_min_deg ?? defaults.arcMinDeg),
    arcMaxDeg: Number(p?.attributes?.arc_max_deg ?? defaults.arcMaxDeg),
    flow360LMin,
    pressureBar,
    pressureMinBar: band.pressureMinBar,
    pressureRecommendedBar: band.pressureRecommendedBar ?? recBar,
    pressureMaxBar: band.pressureMaxBar,
    precipMmH: precipMmH ?? null,
    matchedPrecipitation: meta.matchedPrecipitation,
    precipitationFamily:
      meta.precipitationFamily ?? defaults.precipitationFamily ?? null,
    hydraulicZoneGroup:
      meta.hydraulicZoneGroup ?? defaults.hydraulicZoneGroup ?? null,
    patternType: defaults.patternType ?? "sector",
    performance,
  };
}

function stripSpec(
  modelKey: string,
  pattern: string,
  findProduct: (key: string) => Product | undefined,
) {
  const p = findProduct(modelKey);
  const performance = extractStripPerformance(p);
  const band = pressureBand(p);
  const meta = precipMeta(p);
  const recBar = band.pressureRecommendedBar ?? 2.8;
  let best: PerfRow | null = null;
  for (const row of performance) {
    if (
      !best ||
      Math.abs(row.pressureBar - recBar) < Math.abs(best.pressureBar - recBar)
    ) {
      best = row;
    }
  }
  const widthM = Number(
    best?.widthM ?? p?.attributes?.strip_width_m ?? 1.5,
  );
  const lengthM = Number(
    best?.lengthM ?? p?.attributes?.strip_length_m ?? 4.6,
  );
  return {
    pattern,
    patternType: pattern,
    widthM,
    lengthM,
    flowLMin: best ? Number(best.flowLMin.toFixed(2)) : null,
    pressureBar: best?.pressureBar ?? recBar,
    pressureMinBar: band.pressureMinBar,
    pressureRecommendedBar: band.pressureRecommendedBar ?? recBar,
    pressureMaxBar: band.pressureMaxBar,
    precipMmH: meta.precipMmH ?? meanPrecip(performance),
    precipSquareMmH: best?.precipSquareMmH ?? meanPrecip(performance),
    precipTriangleMmH:
      best?.precipTriangleMmH ??
      (performance.map((r) => r.precipTriangleMmH).find((v) => v != null) ??
        null),
    matchedPrecipitation: meta.matchedPrecipitation,
    precipitationFamily: meta.precipitationFamily,
    hydraulicZoneGroup: meta.hydraulicZoneGroup,
    performance,
  };
}

function rotorOptions(article: string): RotorOpt[] {
  const p = products.find((x) => x.article === article);
  const out: RotorOpt[] = [];
  for (const t of p?.performance_tables ?? []) {
    for (const r of t.rows ?? []) {
      const pr = num(r.pressure_bar);
      const rad = num(r.radius_m);
      const fl = num(r.flow_l_min);
      const nz = String(r.nozzle_size ?? r.nozzle ?? "");
      if (pr == null || rad == null || fl == null || !nz) continue;
      out.push({
        nozzle: nz,
        pressureBar: pr,
        radiusM: rad,
        flowLMin: fl,
        precipSquareMmH: num(r.precipitation_square_mm_h) ?? undefined,
        precipTriangleMmH: num(r.precipitation_triangle_mm_h) ?? undefined,
      });
    }
  }
  out.sort(
    (a, b) =>
      Number(a.nozzle) - Number(b.nozzle) ||
      a.pressureBar - b.pressureBar ||
      a.radiusM - b.radiusM,
  );
  return out;
}

/**
 * Hunter I-20 / PGP Ultra blue standard nozzle rack (official metric chart).
 * Universal currently only stores an envelope row — enrich from manufacturer.
 * Source: https://www.hunterirrigation.com/en-metric/node/50806
 */
const I20_BLUE_STANDARD: RotorOpt[] = (
  [
    // nozzle, bar, radius_m, flow_l_min, precip_sq, precip_tri (180°)
    ["1.5", 1.7, 8.8, 4.5, 7, 8],
    ["1.5", 2.0, 9.1, 4.8, 7, 8],
    ["1.5", 2.5, 9.4, 5.4, 7, 8],
    ["1.5", 3.0, 9.8, 5.9, 7, 9],
    ["1.5", 3.5, 9.8, 6.4, 8, 9],
    ["1.5", 4.0, 9.8, 6.8, 9, 10],
    ["1.5", 4.5, 9.4, 7.2, 10, 11],
    ["2.0", 1.7, 10.1, 5.4, 6, 7],
    ["2.0", 2.0, 10.1, 5.8, 7, 8],
    ["2.0", 2.5, 10.1, 6.5, 8, 9],
    ["2.0", 3.0, 10.4, 7.2, 8, 9],
    ["2.0", 3.5, 10.4, 7.8, 9, 10],
    ["2.0", 4.0, 10.4, 8.3, 9, 11],
    ["2.0", 4.5, 10.4, 8.8, 10, 11],
    ["2.5", 1.7, 10.1, 6.6, 8, 9],
    ["2.5", 2.0, 10.4, 7.1, 8, 9],
    ["2.5", 2.5, 10.7, 8.0, 8, 10],
    ["2.5", 3.0, 10.7, 8.9, 9, 11],
    ["2.5", 3.5, 10.7, 9.7, 10, 12],
    ["2.5", 4.0, 10.7, 10.4, 11, 13],
    ["2.5", 4.5, 10.7, 11.1, 12, 13],
    ["3.0", 1.7, 10.7, 8.4, 9, 10],
    ["3.0", 2.0, 10.7, 9.1, 10, 11],
    ["3.0", 2.5, 11.0, 10.2, 10, 12],
    ["3.0", 3.0, 11.6, 11.4, 10, 12],
    ["3.0", 3.5, 11.9, 12.3, 10, 12],
    ["3.0", 4.0, 11.9, 13.2, 11, 13],
    ["3.0", 4.5, 11.9, 14.0, 12, 14],
    ["4.0", 1.7, 11.3, 11.3, 11, 12],
    ["4.0", 2.0, 11.6, 12.2, 11, 13],
    ["4.0", 2.5, 11.9, 13.6, 12, 13],
    ["4.0", 3.0, 12.2, 15.0, 12, 14],
    ["4.0", 3.5, 12.2, 16.2, 13, 15],
    ["4.0", 4.0, 12.5, 17.3, 13, 15],
    ["4.0", 4.5, 12.5, 18.3, 14, 16],
    ["5.0", 1.7, 11.3, 14.0, 13, 15],
    ["5.0", 2.0, 11.6, 15.2, 14, 16],
    ["5.0", 2.5, 11.9, 17.1, 15, 17],
    ["5.0", 3.0, 12.8, 19.0, 14, 16],
    ["5.0", 3.5, 12.8, 20.6, 15, 17],
    ["5.0", 4.0, 12.8, 22.1, 16, 19],
    ["5.0", 4.5, 12.8, 23.4, 17, 20],
    ["6.0", 1.7, 11.6, 16.8, 15, 17],
    ["6.0", 2.0, 11.9, 18.2, 15, 18],
    ["6.0", 2.5, 12.2, 20.4, 16, 19],
    ["6.0", 3.0, 13.1, 22.7, 16, 18],
    ["6.0", 3.5, 13.1, 24.5, 17, 20],
    ["6.0", 4.0, 13.4, 26.2, 18, 20],
    ["6.0", 4.5, 13.4, 27.9, 19, 21],
    ["8.0", 1.7, 11.3, 22.5, 21, 25],
    ["8.0", 2.0, 11.9, 24.3, 21, 24],
    ["8.0", 2.5, 12.5, 27.2, 21, 24],
    ["8.0", 3.0, 13.4, 30.2, 20, 23],
    ["8.0", 3.5, 13.7, 32.6, 21, 24],
    ["8.0", 4.0, 14.0, 34.8, 21, 25],
    ["8.0", 4.5, 14.0, 36.9, 23, 26],
  ] as Array<[string, number, number, number, number, number]>
).map(([nozzle, pressureBar, radiusM, flowLMin, sq, tri]) => ({
  nozzle,
  pressureBar,
  radiusM,
  flowLMin,
  precipSquareMmH: sq,
  precipTriangleMmH: tri,
}));

// ── Component lookups ────────────────────────────────────────────────────────
const pe25Rolls = products
  .filter(
    (p) =>
      p.group_id === "pressure_pipes" &&
      p.attributes?.outer_diameter_mm === 25 &&
      typeof p.attributes?.length_m === "number",
  )
  .map((p) => ({
    article: p.article ?? null,
    label: p.model ?? "",
    lengthM: Number(p.attributes?.length_m),
    priceEur: price(p),
    imageUrl: productImage(p),
  }))
  .sort((a, b) => a.lengthM - b.lengthM);

const pe32Rolls = products
  .filter(
    (p) =>
      p.group_id === "pressure_pipes" &&
      p.attributes?.outer_diameter_mm === 32 &&
      typeof p.attributes?.length_m === "number" &&
      !/DVGW/i.test(p.model ?? ""),
  )
  .map((p) => ({
    article: p.article ?? null,
    label: p.model ?? "",
    lengthM: Number(p.attributes?.length_m),
    priceEur: price(p),
    imageUrl: productImage(p),
  }))
  .sort((a, b) => a.lengthM - b.lengthM);

const controllers = products
  .filter(
    (p) =>
      p.group_id === "controllers" &&
      /ESP-TM2/i.test(p.model ?? "") &&
      typeof p.attributes?.station_count === "number",
  )
  .map((p) => ({
    article: p.article ?? null,
    label: p.model ?? "",
    stations: Number(p.attributes?.station_count),
    priceEur: price(p),
    imageUrl: productImage(p),
  }))
  .sort((a, b) => a.stations - b.stations);

const wirePerMeter = products
  .filter(
    (p) =>
      p.group_id === "electrical_accessories" &&
      p.unit === "meter" &&
      /Adern Kabel/i.test(p.model ?? ""),
  )
  .map((p) => ({
    article: p.article ?? null,
    label: p.model ?? "",
    cores: Number((p.model ?? "").match(/(\d+)\s*Adern/i)?.[1] ?? 0),
    priceEurPerM: price(p),
    imageUrl: productImage(p),
  }))
  .filter((w) => w.cores > 0)
  .sort((a, b) => a.cores - b.cores);

const verteiler = ["2.00-P07", "2.00-P08", "2.00-P09"]
  .map((a) => byArticle(a))
  .filter(Boolean)
  .map((p) => ({
    article: p!.article ?? null,
    label: p!.model ?? "",
    outlets: Number((p!.model ?? "").match(/Verteiler (\d+) Fach/i)?.[1] ?? 0),
    priceEur: price(p!),
    imageUrl: productImage(p!),
  }));

function simple(article: string, ...fallbacks: Array<RegExp | number | null>) {
  const p = byArticle(article);
  return {
    article,
    label: p?.model ?? p?.name ?? article,
    priceEur: price(p, ...fallbacks),
    imageUrl: productImage(p),
  };
}

const valveBoxP = products.find((p) => p.group_id === "valve_boxes");
const dbryP = products.find((p) => /DBRY/i.test(p.model ?? p.name ?? ""));
const rotor3504 = products.find((p) => p.article === "Y34500");
const dripTube = products.find(
  (p) =>
    p.group_id === "drip_irrigation" &&
    /Tropfrohr|Tropfschlauch/i.test((p.model ?? "") + (p.name ?? "")) &&
    p.attributes?.pressure_compensating &&
    /25 m/i.test(p.model ?? ""),
) ?? products.find(
  (p) =>
    p.group_id === "drip_irrigation" &&
    /Tropfrohr|Tropfschlauch/i.test((p.model ?? "") + (p.name ?? "")) &&
    p.attributes?.pressure_compensating,
);

// Valve body (ohne Spule) + 24V coil from Ersatzteile options
const valveBody = variantPrice(/DV-MM AG\s*\/\s*AG.*OHNE SPULE/i) ?? 14.9;
const valveCoil = variantPrice(/DV Ersatzspule 24V/i) ?? 18.99;
const valveComplete = Number((valveBody + valveCoil).toFixed(2));

// Rotor install-set SAM + T-Stück 25 (includes swing joint)
const rotorSetPrice =
  variantPrice(/3504-PC-SAM \+ Swing-Joint \| T-Stück 25/i) ??
  aiPrice(/3504-PC-SAM \+ Swing-Joint \| T-Stück 25/i);

// Drip: shop has 50 m / 100 m rolls — convert to €/m for BOM meter qty
const drip50 = variantPrice(/HydroPC Tropfrohr 16mm.*50m/i);
const drip100 = variantPrice(/HydroPC Tropfrohr 16mm.*100m/i);
const dripPerM =
  drip50 != null
    ? Number((drip50 / 50).toFixed(3))
    : drip100 != null
      ? Number((drip100 / 100).toFixed(3))
      : null;

const splicePrice =
  price(dbryP, /DBRY-6/i) ??
  aiPrice(/DBM und Gel-Kabelverbinder/i) ??
  variantPrice(/DBM|Kabelverbinder/i);

type BrandPack = {
  sprayHead: {
    setArticle: string;
    bodyLabel: string;
    variants: SetVariant[];
    nozzles: Record<string, ReturnType<typeof nozzleSpecFromProduct>>;
    strips: Record<string, ReturnType<typeof stripSpec>>;
  };
  rotor: {
    article: string;
    label: string;
    priceEur: number | null;
    imageUrl: string | null;
    radiusMinM: number;
    radiusMaxM: number;
    arcMinDeg: number;
    arcMaxDeg: number;
    pressureMinBar?: number | null;
    pressureRecommendedBar?: number | null;
    pressureMaxBar?: number | null;
    precipitationFamily?: string | null;
    hydraulicZoneGroup?: string | null;
    options: RotorOpt[];
    accessories: Array<{
      article: string | null;
      label: string;
      priceEur: number | null;
      imageUrl: string | null;
    }>;
  };
};

function bomPrice(p: Product | undefined): number | null {
  const bom = (p as { bom?: { price_eur?: number } } | undefined)?.bom;
  if (typeof bom?.price_eur === "number") return bom.price_eur;
  return price(p);
}

function hunterByModel(model: string): Product | undefined {
  return products.find(
    (x) =>
      x.model === model &&
      /hunter/i.test(String((x as { brand?: string }).brand ?? "")),
  );
}

const rainbirdPack: BrandPack = {
  sprayHead: {
    setArticle: "3.191",
    bodyLabel: "Rain-Bird 1804-SAM 3,1 bar + Swing-Joint",
    variants: setVariants,
    nozzles: {
      "R-VAN14": nozzleSpecFromProduct(rotatorByModel("R-VAN14"), {
        radiusMinM: 2.4,
        radiusMaxM: 4.6,
        arcMinDeg: 45,
        arcMaxDeg: 270,
        precipitationFamily: "rvan",
        hydraulicZoneGroup: "rvan_matched",
        patternType: "sector",
      }),
      "R-VAN18": nozzleSpecFromProduct(rotatorByModel("R-VAN18"), {
        radiusMinM: 4.0,
        radiusMaxM: 5.5,
        arcMinDeg: 45,
        arcMaxDeg: 270,
        precipitationFamily: "rvan",
        hydraulicZoneGroup: "rvan_matched",
        patternType: "sector",
      }),
      "R-VAN24": nozzleSpecFromProduct(rotatorByModel("R-VAN24"), {
        radiusMinM: 5.2,
        radiusMaxM: 7.3,
        arcMinDeg: 45,
        arcMaxDeg: 270,
        precipitationFamily: "rvan",
        hydraulicZoneGroup: "rvan_matched",
        patternType: "sector",
      }),
    },
    strips: {
      "R-VAN-LCS": stripSpec(
        "R-VAN-LCS",
        "left_corner_strip",
        rotatorByModel,
      ),
      "R-VAN-RCS": stripSpec(
        "R-VAN-RCS",
        "right_corner_strip",
        rotatorByModel,
      ),
      "R-VAN-SST": stripSpec("R-VAN-SST", "side_strip", rotatorByModel),
    },
  },
  rotor: {
    article: rotor3504?.article ?? "Y34500",
    label: rotor3504?.model ?? "3504-PC-SAM",
    priceEur: price(rotor3504, rotorSetPrice, /3504-PC-SAM \+ Swing-Joint/i),
    imageUrl: productImage(rotor3504),
    radiusMinM: 4.6,
    radiusMaxM: 10.7,
    arcMinDeg: 40,
    arcMaxDeg: 360,
    ...pressureBand(rotor3504),
    precipitationFamily: "rotor_3504",
    hydraulicZoneGroup: "rotor",
    options: rotorOptions("Y34500"),
    accessories: [
      {
        article: "1.06-T02",
        label: byArticle("1.06-T02")?.model ?? "T-Stück 25 mm (im Rotor-Set)",
        priceEur: null,
        imageUrl: productImage(byArticle("1.06-T02")),
      },
      {
        article: null,
        label: 'SBE-075 Flexanschluss ¾" AG (im Rotor-Set)',
        priceEur: null,
        imageUrl: productImage(rotor3504),
      },
    ],
  },
};

const HUNTER_NOZZLE_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: "MP800SR", re: /MP800\b/i },
  { key: "MP815", re: /MP815/i },
  { key: "MP1000", re: /MP1000/i },
  { key: "MP2000", re: /MP2000/i },
  { key: "MP3000", re: /MP3000/i },
  { key: "MP3500", re: /MP3500/i },
  { key: "MPSS530", re: /MPSS530/i },
  { key: "MPLCS515", re: /MPLCS515/i },
  { key: "MPRCS515", re: /MPRCS515/i },
  { key: "MPCORNER", re: /MPCORNER/i },
];

const hunterSetVariants: SetVariant[] = [];
for (const it of aiItems) {
  const title = it.title ?? "";
  if (!/Installation-Set Hunter Pro-Spray/i.test(title)) continue;
  const tail = title.includes("—") ? title.split("—").slice(1).join("—") : title;
  if (!/Pros-04-PRS40 CV/i.test(tail)) continue;
  const anschluss = /T-Stück 25\b/i.test(tail)
    ? "tee"
    : /Winkel 25\b/i.test(tail)
      ? "elbow"
      : null;
  if (!anschluss) continue;
  const nozzle = HUNTER_NOZZLE_PATTERNS.find((n) => n.re.test(tail));
  if (!nozzle) continue;
  if (
    hunterSetVariants.some(
      (v) => v.nozzleKey === nozzle.key && v.anschluss === anschluss,
    )
  ) {
    continue;
  }
  hunterSetVariants.push({
    nozzleKey: nozzle.key,
    anschluss,
    label: tail.trim(),
    priceEur: itemPrice(it),
  });
}

function mpNozzle(
  model: string,
  defaults: {
    radiusMinM: number;
    radiusMaxM: number;
    arcMinDeg: number;
    arcMaxDeg: number;
    precipitationFamily?: string;
    hydraulicZoneGroup?: string;
  },
) {
  return nozzleSpecFromProduct(hunterByModel(model), {
    ...defaults,
    patternType: "sector",
  });
}

const i20 = hunterByModel("I-20-04");
const hsbe075 = hunterByModel("HSBE-075");
const flexHose = hunterByModel("FlexSG");
const i20Band = pressureBand(i20);

const hunterPack: BrandPack = {
  sprayHead: {
    setArticle: "3.131-RG65",
    bodyLabel: "Hunter PROS-04-PRS40-CV + Swing-Joint",
    variants: hunterSetVariants,
    nozzles: {
      MP800SR: mpNozzle("MP800SR", {
        radiusMinM: 1.8,
        radiusMaxM: 3.5,
        arcMinDeg: 90,
        arcMaxDeg: 210,
        precipitationFamily: "mp800",
        hydraulicZoneGroup: "mp800_20mmh",
      }),
      MP815: mpNozzle("MP815", {
        radiusMinM: 2.5,
        radiusMaxM: 4.9,
        arcMinDeg: 90,
        arcMaxDeg: 360,
        precipitationFamily: "mp800",
        hydraulicZoneGroup: "mp800_20mmh",
      }),
      MP1000: mpNozzle("MP1000", {
        radiusMinM: 2.5,
        radiusMaxM: 4.5,
        arcMinDeg: 90,
        arcMaxDeg: 360,
        precipitationFamily: "mp_standard",
        hydraulicZoneGroup: "mp_standard_10mmh",
      }),
      MP2000: mpNozzle("MP2000", {
        radiusMinM: 4.0,
        radiusMaxM: 6.7,
        arcMinDeg: 90,
        arcMaxDeg: 360,
        precipitationFamily: "mp_standard",
        hydraulicZoneGroup: "mp_standard_10mmh",
      }),
      MP3000: mpNozzle("MP3000", {
        radiusMinM: 6.7,
        radiusMaxM: 9.1,
        arcMinDeg: 90,
        arcMaxDeg: 360,
        precipitationFamily: "mp_standard",
        hydraulicZoneGroup: "mp_standard_10mmh",
      }),
      MP3500: mpNozzle("MP3500", {
        radiusMinM: 9.4,
        radiusMaxM: 10.7,
        arcMinDeg: 90,
        arcMaxDeg: 210,
        precipitationFamily: "mp_standard",
        hydraulicZoneGroup: "mp_standard_10mmh",
      }),
    },
    strips: {
      MPLCS515: stripSpec("MPLCS515", "left_corner_strip", hunterByModel),
      MPRCS515: stripSpec("MPRCS515", "right_corner_strip", hunterByModel),
      MPSS530: stripSpec("MPSS530", "side_strip", hunterByModel),
    },
  },
  rotor: {
    article: i20?.article ?? "3.146",
    label: "I-20-04",
    priceEur: bomPrice(i20),
    imageUrl: productImage(i20),
    radiusMinM: Number(i20?.attributes?.radius_min_m ?? 4.9),
    radiusMaxM: Number(i20?.attributes?.radius_max_m ?? 14.0),
    arcMinDeg: 50,
    arcMaxDeg: 360,
    pressureMinBar: i20Band.pressureMinBar ?? 1.7,
    pressureRecommendedBar: i20Band.pressureRecommendedBar ?? 2.8,
    pressureMaxBar: i20Band.pressureMaxBar ?? 4.5,
    precipitationFamily: "rotor_i20",
    hydraulicZoneGroup: "rotor",
    // Prefer manufacturer chart enrichment — universal envelope alone is insufficient
    options: I20_BLUE_STANDARD,
    accessories: [
      {
        article: hsbe075?.article ?? "2.61-HSBE-075",
        label: 'HSBE-075 Flexanschluss ¾"',
        priceEur: bomPrice(hsbe075),
        imageUrl: productImage(hsbe075),
      },
      {
        article: flexHose?.article ?? "2.61-FlexSG",
        label: "FlexSG Anschlussschlauch (Meterware)",
        priceEur: null,
        imageUrl: productImage(flexHose),
      },
    ],
  },
};


const catalog = {
  generated_at: new Date().toISOString(),
  source:
    "RegnerWerk_universal.json + products-ai.json + variant-prices/ + Hunter I-20 blue standard chart",
  defaultBrand: "hunter" as const,
  images: {
    "1804":
      productImage(byArticle("3.191")) ??
      "https://www.wasserundgruen.de/images/product_images/original_images/Winkel%20RainBird%201804%202%20Neu.png",
    "3504": productImage(rotor3504),
    "R-VAN14": productImage(byArticle("A84659")),
    "R-VAN18": productImage(byArticle("A84660")),
    "R-VAN24": productImage(byArticle("A84661")),
    "R-VAN-LCS": productImage(
      products.find((p) => /R-VAN-LCS/i.test(p.model ?? "")),
    ),
    "R-VAN-RCS": productImage(
      products.find((p) => /R-VAN-RCS/i.test(p.model ?? "")),
    ),
    "R-VAN-SST": productImage(
      products.find((p) => /R-VAN-SST/i.test(p.model ?? "")),
    ),
    "PROS-04": productImage(hunterByModel("PROS-04-PRS40-CV")),
    "I-20": productImage(i20),
    "I-20-04": productImage(i20),
    MP800SR: productImage(hunterByModel("MP800SR")),
    MP815: productImage(hunterByModel("MP815")),
    MP1000: productImage(hunterByModel("MP1000")),
    MP2000: productImage(hunterByModel("MP2000")),
    MP3000: productImage(hunterByModel("MP3000")),
    MP3500: productImage(hunterByModel("MP3500")),
    MPCORNER: productImage(hunterByModel("MPCORNER")),
    MPSS530: productImage(hunterByModel("MPSS530")),
    MPLCS515: productImage(hunterByModel("MPLCS515")),
    MPRCS515: productImage(hunterByModel("MPRCS515")),
  } as Record<string, string | null>,
  brands: {
    rainbird: rainbirdPack,
    hunter: hunterPack,
  },
  // Mirrors defaultBrand for callers that still read top-level sprayHead/rotor
  sprayHead: hunterPack.sprayHead,
  rotor: hunterPack.rotor,
  pipes: { pe25Rolls, pe32Rolls },
  hydraulics: {
    defaultSourceFlowM3h: 2.0,
    zoneFillFactor: 0.85,
    recommendedPressureBar: 2.8,
    assumedVerteilerPressureBar: 3.5,
    pe25InternalDiameterMm: 20.4,
    pe32InternalDiameterMm: 26.2,
    hazenWilliamsC: 150,
    maxVelocityMps: 1.5,
    spacingFactor: 1.0,
    catalogVersion: "planner-2026.08-perf",
  },
  pipeSizes: [
    { odMm: 25, idMm: 20.4, rollsKey: "pe25Rolls" },
    { odMm: 32, idMm: 26.2, rollsKey: "pe32Rolls" },
  ],
  zoneParts: {
    valve: {
      article: "100-DV-MM",
      label: 'Rain-Bird 100-DV-MM Magnetventil 1" 24 VAC',
      priceEur: price(byArticle("100-DV-MM"), valveComplete, /100-DV-MM/i),
      imageUrl: productImage(byArticle("100-DV-MM")),
    },
    adapterPe25Valve: simple("1.05-K34"),
    adapterPe32Valve: simple("1.05-K37"),
    verteiler,
    valveBox: {
      article: valveBoxP?.article ?? null,
      label: valveBoxP?.model ?? "Rain-Bird Ventilkasten Standard groß",
      priceEur: price(
        valveBoxP,
        /Ventilkasten Standard groß/i,
        /Ventilkasten.*600\s*x\s*430/i,
      ),
      imageUrl: productImage(valveBoxP),
    },
  },
  controls: {
    controllers,
    wirePerMeter,
    splice: {
      article: dbryP?.article ?? null,
      label: dbryP?.model ?? "DBRY-6 / DBM wasserdichte Kabelverbinder",
      priceEur: splicePrice,
      imageUrl: productImage(dbryP),
    },
  },
  sourceParts: {
    ballValve: simple("4.03-KH44"),
    checkValve: simple("40_4-RV53"),
  },
  drip: {
    tube: {
      article: dripTube?.article ?? null,
      label:
        dripTube?.model ??
        dripTube?.name ??
        "Tropfrohr HydroPC 16 mm druckkompensierend",
      priceEur: price(dripTube, dripPerM),
      imageUrl: productImage(dripTube),
      emitterSpacingM: Number(dripTube?.attributes?.emitter_spacing_m ?? 0.33),
      emitterFlowLh: Number(dripTube?.attributes?.emitter_flow_l_h ?? 2.3),
    },
    controlKit: {
      article: "3.18-M31",
      label:
        byArticle("3.18-M31")?.model ??
        "XCZ-075-PRF Magnetventil + Filter + Druckminderer",
      priceEur: price(byArticle("3.18-M31")),
      imageUrl: productImage(byArticle("3.18-M31")),
    },
    rowSpacingM: 0.35,
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + "\n");
console.log("planner catalog written:", OUT);
console.log("default brand: hunter");
console.log("RB set variants:", setVariants.length);
console.log("Hunter set variants:", hunterSetVariants.length);
console.log(
  "Hunter nozzles:",
  Object.keys(catalog.brands.hunter.sprayHead.nozzles).join(", "),
);
console.log(
  "Hunter rotor:",
  catalog.brands.hunter.rotor.label,
  catalog.brands.hunter.rotor.priceEur,
);
console.log("pe25:", pe25Rolls.length, "pe32:", pe32Rolls.length);
