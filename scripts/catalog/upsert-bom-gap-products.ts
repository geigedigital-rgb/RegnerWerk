/**
 * Upsert shop products needed by Sofort BOM that were missing/incomplete
 * in RegnerWerk_universal.json (PTFE seal, DBRY article+price, valve box article).
 *
 * Source of truth: live scrape in data/raw/products-bom-gaps.json + zubehoer-25.
 *
 * Usage: npx tsx scripts/catalog/upsert-bom-gap-products.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "../..");
const UNIVERSAL = path.join(
  ROOT,
  "data/catalog/normalized/RegnerWerk_universal.json",
);
const AI = path.join(ROOT, "data/raw/products-ai.json");
const GAPS = path.join(ROOT, "data/raw/products-bom-gaps.json");
const ZUBE = path.join(ROOT, "data/raw/products-zubehoer-25.json");

type AnyRec = Record<string, unknown>;

function hashId(prefix: string, key: string): string {
  const h = crypto.createHash("sha1").update(key).digest("hex").slice(0, 8);
  return `${prefix}_${h}`;
}

function loadJson(p: string): AnyRec {
  return JSON.parse(fs.readFileSync(p, "utf8")) as AnyRec;
}

function asProducts(file: AnyRec): AnyRec[] {
  if (Array.isArray(file)) return file as AnyRec[];
  if (Array.isArray(file.products)) return file.products as AnyRec[];
  return [];
}

function upsertAi(aiProducts: AnyRec[], scraped: AnyRec): void {
  const url = String(scraped.url ?? "");
  const id =
    String(scraped.slug ?? scraped.id ?? "") ||
    url.split("/").pop()?.replace(/\.html.*/, "") ||
    hashId("p", url);
  const row = {
    id,
    url,
    title: scraped.title ?? scraped.slug,
    category: scraped.category ?? null,
    price: scraped.price ?? null,
    price_eur: scraped.price ?? null,
    variants: scraped.variants ?? [],
    images: scraped.images ?? [],
    pdfs: scraped.pdfs ?? [],
    text: scraped.rawText ?? scraped.text ?? "",
    scrape: "bom-gaps",
  };
  const i = aiProducts.findIndex(
    (p) =>
      p.url === url ||
      p.id === id ||
      String(p.url ?? "").replace(/-702\.html$/, ".html") === url,
  );
  if (i >= 0) aiProducts[i] = { ...aiProducts[i], ...row };
  else aiProducts.push(row);
}

function upsertUniversal(
  products: AnyRec[],
  spec: {
    match: (p: AnyRec) => boolean;
    article: string;
    model: string;
    group_id: string;
    subtype_id: string;
    series: string;
    brand?: string | null;
    manufacturer?: string | null;
    unit?: string;
    priceEur: number;
    url: string;
    images: string[];
    text?: string;
    attributes?: Record<string, unknown>;
  },
): void {
  const existing = products.find(spec.match);
  const media = {
    images: spec.images,
    documents: [] as unknown[],
  };
  const source = {
    source_record_id: spec.url.split("/").pop()?.replace(/\.html.*/, "") ?? null,
    source_name: "wasserundgruen",
    source_url: spec.url,
    source_category: null,
    source_title: spec.model,
    source_variant: null,
  };
  const bom = [
    {
      role: "primary",
      article: spec.article,
      label: spec.model,
      price_eur: spec.priceEur,
      qty: 1,
    },
  ];

  if (existing) {
    existing.article = spec.article;
    existing.model = spec.model;
    existing.bom = bom;
    existing.media = {
      ...((existing.media as object) ?? {}),
      images: spec.images.length
        ? spec.images
        : ((existing.media as AnyRec)?.images as string[]) ?? [],
    };
    existing.source = { ...(existing.source as object), ...source };
    (existing as AnyRec).price_eur = spec.priceEur;
    return;
  }

  products.push({
    product_id: hashId(spec.series, spec.article + spec.url),
    parent_product_id: null,
    article: spec.article,
    manufacturer: spec.manufacturer ?? null,
    brand: spec.brand ?? null,
    series: spec.series,
    model: spec.model,
    name: { de: spec.model },
    group_id: spec.group_id,
    subtype_id: spec.subtype_id,
    unit: spec.unit ?? "piece",
    package_quantity: 1,
    lifecycle_status: "active",
    attributes: spec.attributes ?? {},
    connections: [],
    performance_tables: [],
    compatibility: {},
    bom,
    media,
    source,
    price_eur: spec.priceEur,
    field_status: {},
    provenance: { imported_from: "upsert-bom-gap-products" },
    quality: {},
    data_readiness: "partial",
    design_selection: {},
  });
}

function main() {
  const gaps = loadJson(GAPS);
  const zube = fs.existsSync(ZUBE) ? loadJson(ZUBE) : { products: [] };
  const scraped = [
    ...asProducts(gaps),
    ...asProducts(zube).filter((p) =>
      /Teflon|PTFE|Dichtband|SPX-FLEX|FlexSG|SBE075|Warnband/i.test(
        String(p.title ?? "") + String(p.url ?? ""),
      ),
    ),
  ];

  const aiFile = loadJson(AI);
  const aiProducts = asProducts(aiFile);
  for (const s of scraped) upsertAi(aiProducts, s);

  const uni = loadJson(UNIVERSAL);
  const products = asProducts(uni);

  const teflon = asProducts(gaps).find((p) =>
    /teflon|ptfe/i.test(String(p.url ?? "")),
  );
  const dbry = asProducts(gaps).find((p) => /dbry/i.test(String(p.url ?? "")));
  const vbox = asProducts(gaps).find((p) =>
    /ventilkasten|vba02675/i.test(String(p.url ?? "")),
  );

  if (teflon) {
    upsertUniversal(products, {
      match: (p) =>
        p.article === "Teflon_1" ||
        /PTFE-Gewindedichtband|Teflon Dichtband/i.test(String(p.model ?? "")),
      article: "Teflon_1",
      model:
        "Teflon Dichtband PTFE-Gewindedichtband DVGW 0,1 mm × 12 m (gelb)",
      group_id: "sprinkler_accessories",
      subtype_id: "thread_seal_tape",
      series: "dichtband",
      brand: null,
      manufacturer: null,
      priceEur: Number(teflon.price ?? 1.19),
      url: String(teflon.url),
      images: (teflon.images as string[]) ?? [],
      attributes: {
        width_mm: 12,
        length_m: 12,
        thickness_mm: 0.1,
        dvgw_approved: true,
        standard: "DIN EN 751-3",
      },
    });
  }

  if (dbry) {
    upsertUniversal(products, {
      match: (p) => /DBRY/i.test(String(p.model ?? "")),
      article: "6.59",
      model: "DBRY-6 Rain-Bird und Hunter Wasserdichte Anschluss, Kabelverbinder",
      group_id: "electrical_accessories",
      subtype_id: "waterproof_connector",
      series: "cable",
      brand: "Rain Bird",
      manufacturer: "Rain Bird",
      priceEur: Number(dbry.price ?? 2.69),
      url: String(dbry.url),
      images: (dbry.images as string[]) ?? [],
      attributes: {
        waterproof: true,
        direct_burial_allowed: true,
        voltage_v_max: 600,
      },
    });
  }

  if (vbox) {
    upsertUniversal(products, {
      match: (p) =>
        /VBA02675|Ventilkasten Standard groß eckig.*600/i.test(
          String(p.model ?? "") + String(p.article ?? ""),
        ),
      article: "VBA02675",
      model:
        "Rain-Bird Ventilkasten Standard groß eckig, Maße: 600 x 430 x 300 mm, Original Rain-Bird VBA02675",
      group_id: "valve_boxes",
      subtype_id: "rectangular_valve_box",
      series: "valve_box",
      brand: "Rain Bird",
      manufacturer: "Rain Bird",
      priceEur: Number(vbox.price ?? 54.99),
      url: String(vbox.url),
      images: (vbox.images as string[]) ?? [],
      attributes: {
        length_mm: 600,
        width_mm: 430,
        height_mm: 300,
        shape: "rectangular",
      },
    });
  }

  if (Array.isArray(aiFile.products)) aiFile.products = aiProducts;
  else Object.assign(aiFile, { products: aiProducts });
  fs.writeFileSync(AI, JSON.stringify(aiFile, null, 2) + "\n");

  uni.products = products;
  fs.writeFileSync(UNIVERSAL, JSON.stringify(uni, null, 2) + "\n");

  console.log("AI products:", aiProducts.length);
  console.log("Universal products:", products.length);
  console.log(
    "PTFE:",
    products.find((p) => p.article === "Teflon_1")?.article,
    products.find((p) => p.article === "Teflon_1")?.price_eur,
  );
  console.log(
    "DBRY:",
    products.find((p) => /DBRY/i.test(String(p.model)))?.article,
    products.find((p) => /DBRY/i.test(String(p.model)))?.price_eur,
  );
  console.log(
    "VBA:",
    products.find((p) => p.article === "VBA02675")?.article,
    products.find((p) => p.article === "VBA02675")?.price_eur,
  );
}

main();
