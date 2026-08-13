/**
 * Enrich Sofort source parts from shop dropdowns (with per-variant images):
 *  1) Scheibenfilter 5.02-SF15..SF24
 *  2) Einwinterung 9.15-DRGE/DRWS/DRTS
 *  3) Ventilkästen VBA02675, VENT-EK, VENT-EG, VENT-EJ
 *
 * No Systemtrenner.
 *
 * Usage: npx tsx scripts/catalog/enrich-source-variants.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { cachedFetch } from "../scrape/fetch";
import { parseProductPage } from "../scrape/product";
import { BASE_URL } from "../scrape/config";

const ROOT = path.resolve(import.meta.dirname, "../..");
const UNIVERSAL = path.join(
  ROOT,
  "data/catalog/normalized/RegnerWerk_universal.json",
);
const CACHE_DIR = path.join(ROOT, "data/raw/variant-prices");

type AnyRec = Record<string, unknown>;

type ShopOption = {
  propertyId: string;
  optionId: string;
  label: string;
  article: string | null;
  priceEur: number | null;
  images: string[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseEur(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text
    .replace(/\s+/g, " ")
    .match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*EUR/);
  if (!m) return null;
  return parseFloat(m[1].replace(/\./g, "") + "." + m[2]);
}

function hashId(prefix: string, key: string): string {
  return `${prefix}_${crypto.createHash("sha1").update(key).digest("hex").slice(0, 8)}`;
}

function cleanLabel(s: string): string {
  return s.replace(/1""/g, '1"').replace(/\s+/g, " ").trim();
}

async function checkStatusFull(
  productsId: string,
  propertyId: string,
  optionId: string,
): Promise<{
  priceEur: number | null;
  article: string | null;
  images: string[];
  ok: boolean;
}> {
  const params = new URLSearchParams();
  params.set("do", "CheckStatus");
  params.set("products_id", productsId);
  params.set("products_qty", "1");
  params.set("target", "check");
  params.set("isProductInfo", "1");
  params.set(`modifiers[property][${propertyId}]`, optionId);
  params.set("_", String(Date.now()));
  const url = `${BASE_URL}/shop.php?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RegnerWerkBot/1.0)",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*",
    },
  });
  if (!res.ok) return { priceEur: null, article: null, images: [], ok: false };
  const data = (await res.json()) as {
    success?: boolean;
    content?: {
      price?: { value?: string };
      model?: { value?: string };
      imageList?: { images?: Array<{ webFilePath?: string }> };
      imageGallery?: string | { value?: string };
    };
  };
  if (!data.success) return { priceEur: null, article: null, images: [], ok: false };
  const content = data.content ?? {};
  const fromList = (content.imageList?.images ?? [])
    .map((i) => i.webFilePath)
    .filter((x): x is string => !!x);
  const galleryRaw = content.imageGallery as unknown;
  const galleryHtml =
    typeof galleryRaw === "string"
      ? galleryRaw
      : typeof galleryRaw === "object" &&
          galleryRaw &&
          "value" in (galleryRaw as object)
        ? String((galleryRaw as { value?: string }).value ?? "")
        : "";
  const fromGallery: string[] = [];
  const re = /(?:src|href)=["']([^"']*product_images[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(galleryHtml))) fromGallery.push(m[1]);
  const normalize = (u: string): string => {
    let out = u.replace(/\\/g, "");
    if (out.startsWith("images/")) out = "/" + out;
    if (out.startsWith("/")) out = `${BASE_URL}${out}`;
    out = out
      .replace(/popup_images/g, "original_images")
      .replace(/info_images/g, "original_images")
      .replace(/gallery_images/g, "original_images");
    try {
      const url = new URL(out);
      url.pathname = url.pathname
        .split("/")
        .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
        .join("/");
      return url.toString();
    } catch {
      return out.replace(/ /g, "%20");
    }
  };
  const images = [...new Set([...fromList, ...fromGallery].map(normalize))];
  return {
    priceEur: parseEur(content.price?.value ?? null),
    article: content.model?.value?.trim() || null,
    images,
    ok: true,
  };
}

function parseSelectOptions(html: string): {
  productsId: string | null;
  propertyId: string | null;
  options: { id: string; label: string }[];
} {
  const $ = cheerio.load(html);
  const productsId =
    $("#products-id").attr("value") ||
    $('input[name="products_id"]').first().attr("value") ||
    null;
  const $sel = $("select.js-calculate, select[name^='modifiers[property]']").first();
  const name = $sel.attr("name") || "";
  const m = name.match(/modifiers\[property\]\[(\d+)\]/);
  const propertyId = m?.[1] ?? null;
  const options: { id: string; label: string }[] = [];
  $sel.find("option").each((_, o) => {
    const $o = $(o);
    const id = ($o.attr("value") || "").trim();
    const label = cleanLabel($o.text());
    if (!id || id === "0" || /bitte auswählen/i.test(label)) return;
    options.push({ id, label });
  });
  return { productsId, propertyId, options };
}

async function expandPage(pageUrl: string): Promise<{
  url: string;
  title: string;
  shopArt: string | null;
  options: ShopOption[];
  fallbackImages: string[];
  rawText: string;
}> {
  const { html } = await cachedFetch(pageUrl, { force: true });
  const raw = parseProductPage(pageUrl, html);
  const { productsId, propertyId, options } = parseSelectOptions(html);
  if (!productsId || !propertyId) {
    throw new Error(`No modifiers on ${pageUrl}`);
  }
  const out: ShopOption[] = [];
  for (const opt of options) {
    await sleep(350);
    const st = await checkStatusFull(productsId, propertyId, opt.id);
    out.push({
      propertyId,
      optionId: opt.id,
      label: cleanLabel(opt.label),
      article: st.article,
      priceEur: st.priceEur,
      images: st.images.length ? st.images : raw.images,
    });
    console.log(
      `  ${st.article ?? "?"} ${opt.label.slice(0, 50)} €${st.priceEur} imgs=${st.images.length}`,
    );
  }
  return {
    url: pageUrl,
    title: raw.title,
    shopArt: raw.shopArtNr,
    options: out,
    fallbackImages: raw.images,
    rawText: raw.rawText,
  };
}

function peMmFromLabel(label: string): number | null {
  const m = label.match(/PE(?:-|\s)?Anschluss\s+(\d+)\s*mm/i) || label.match(/PE[-\s]?(\d+)\s*mm/i);
  return m ? Number(m[1]) : null;
}

function threadInchFromLabel(label: string): string | null {
  if (/1\s*1\/2|1½/i.test(label)) return '1 1/2"';
  if (/3\/4|¾/i.test(label)) return '3/4"';
  if (/(?:^|[^\d\/])1\s*"|1\s*Zoll|1""/i.test(label)) return '1"';
  return null;
}

function flowM3hFromLabel(label: string): number | null {
  const m = label.match(/(\d+(?:[.,]\d+)?)\s*m[³3]\s*\/\s*h/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

function upsertFilter(products: AnyRec[], page: Awaited<ReturnType<typeof expandPage>>) {
  for (const opt of page.options) {
    if (!opt.article) continue;
    const peMm = peMmFromLabel(opt.label);
    const thread = threadInchFromLabel(opt.label);
    const flowM3h =
      flowM3hFromLabel(opt.label) ??
      (thread === '3/4"' ? 4 : thread === '1"' ? 5 : thread === '1 1/2"' ? 10 : null);
    const model = cleanLabel(opt.label);
    const connections: AnyRec[] = [];
    if (peMm) {
      connections.push(
        {
          port_id: "inlet",
          role: "inlet",
          connection_type: "pe_compression",
          nominal_size_mm: peMm,
          thread_size_inch: null,
          thread_gender: "not_applicable",
          thread_standard: "not_applicable",
        },
        {
          port_id: "outlet",
          role: "outlet",
          connection_type: "pe_compression",
          nominal_size_mm: peMm,
          thread_size_inch: null,
          thread_gender: "not_applicable",
          thread_standard: "not_applicable",
        },
      );
    } else if (thread) {
      connections.push({
        port_id: "thread",
        role: "bidirectional",
        connection_type: "threaded",
        nominal_size_mm: null,
        thread_size_inch: thread,
        thread_gender: "male",
        thread_standard: "BSP",
      });
    }
    const attrs = {
      filtration_mesh: 120,
      filtration_micron: 130, // ~120 mesh
      filter_element_type: "disc",
      flow_max_l_min:
        flowM3h != null ? Number(((flowM3h * 1000) / 60).toFixed(2)) : null,
      flow_max_m3h: flowM3h,
      pe_od_mm: peMm,
      thread_size_inch: thread,
      unions_included: /Verschraubung|PE Anschluss/i.test(opt.label),
      pressure_min_bar: null as number | null,
      pressure_max_bar: null as number | null,
      regulated_pressure_bar: null as number | null,
    };
    upsertProduct(products, {
      match: (p) => p.article === opt.article,
      article: opt.article,
      model,
      group_id: "filters_pressure_regulators",
      subtype_id: "disc_filter",
      series: "scheibenfilter",
      priceEur: opt.priceEur ?? 0,
      url: `${page.url}#v=${opt.optionId}`,
      images: opt.images,
      attributes: attrs,
      connections,
      compatibilityStatus: "ready",
      text: page.rawText,
    });
  }
}

function upsertWinter(products: AnyRec[], page: Awaited<ReturnType<typeof expandPage>>) {
  for (const opt of page.options) {
    if (!opt.article) continue;
    const isTee = /T-Stück/i.test(opt.label);
    const isWinkel = /WINKEL/i.test(opt.label);
    const isGekaOnly = /Geka/i.test(opt.label) && !/Kugelhahn/i.test(opt.label);
    const connections: AnyRec[] = [
      {
        port_id: "line",
        role: "bidirectional",
        connection_type: "threaded",
        nominal_size_mm: null,
        thread_size_inch: '1"',
        thread_gender: isTee ? "female" : "mixed",
        thread_standard: "BSP",
        note: isTee
          ? "Überwurf T-Stück 1″ IG/IG/AG"
          : isWinkel
            ? "Überwurf Winkel 1″ IG/AG"
            : "Geka Schnellkupplung",
      },
      {
        port_id: "blowout",
        role: "outlet",
        connection_type: "geka_coupling",
        nominal_size_mm: null,
        thread_size_inch: null,
        thread_gender: "not_applicable",
        thread_standard: "not_applicable",
      },
    ];
    upsertProduct(products, {
      match: (p) => p.article === opt.article,
      article: opt.article,
      model: cleanLabel(opt.label),
      group_id: "valves",
      subtype_id: "winter_blowout",
      series: "einwinterung",
      priceEur: opt.priceEur ?? 0,
      url: `${page.url}#v=${opt.optionId}`,
      images: opt.images,
      attributes: {
        actuation_type: "manual",
        body_material: isGekaOnly ? "mixed" : "brass_pvc",
        has_ball_valve: /Kugelhahn/i.test(opt.label),
        has_geka: true,
        fitting_shape: isTee ? "tee" : isWinkel ? "elbow" : "straight",
        thread_size_inch: '1"',
        flow_control_present: true,
        manual_opening: true,
        pressure_min_bar: null,
        pressure_max_bar: null,
        coil_voltage_v: null,
        normal_state: null,
      },
      connections,
      compatibilityStatus: "ready",
      text: page.rawText,
    });
  }
}

function upsertValveBox(
  products: AnyRec[],
  raw: ReturnType<typeof parseProductPage>,
  extras: {
    article: string;
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    maxValveCount: number;
    lidLoadClass?: string;
  },
) {
  upsertProduct(products, {
    match: (p) =>
      p.article === extras.article ||
      /Ventilkasten/i.test(String(p.model)) &&
        String(p.model).includes(String(extras.lengthMm)),
    article: extras.article,
    model: cleanLabel(raw.title),
    group_id: "valve_boxes",
    subtype_id: "rectangular_valve_box",
    series: "valve_box",
    brand: /Rain-Bird|Rain Bird/i.test(raw.title) ? "Rain Bird" : null,
    manufacturer: /Rain-Bird|Rain Bird/i.test(raw.title) ? "Rain Bird" : null,
    priceEur: raw.price ?? 0,
    url: raw.url,
    images: raw.images,
    attributes: {
      outer_length_mm: extras.lengthMm,
      outer_width_mm: extras.widthMm,
      outer_height_mm: extras.heightMm,
      max_valve_count: extras.maxValveCount,
      body_material: "pp",
      material: "polypropylene",
      cover_included: true,
      lid_load_class: extras.lidLoadClass ?? "A15",
      shape: "rectangular",
      manufacturer_model_canonical: extras.article,
    },
    connections: [],
    compatibilityStatus: "ready",
    text: raw.rawText,
  });
}

function upsertProduct(
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
    priceEur: number;
    url: string;
    images: string[];
    attributes: Record<string, unknown>;
    connections: AnyRec[];
    compatibilityStatus: string;
    text?: string;
  },
) {
  const existing = products.find(spec.match);
  const media = { images: spec.images, documents: [] as unknown[] };
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
  const compatibility = {
    schema_version: "1.0.0",
    status: spec.compatibilityStatus,
    selection_policy:
      "Use port_matches and requirements. compatible_product_ids alone never proves that an entire assembly is valid.",
    compatible_product_ids: (existing?.compatibility as AnyRec)?.compatible_product_ids ?? [],
  };

  if (existing) {
    existing.article = spec.article;
    existing.model = spec.model;
    existing.name = { de: spec.model };
    existing.group_id = spec.group_id;
    existing.subtype_id = spec.subtype_id;
    existing.attributes = { ...(existing.attributes as object), ...spec.attributes };
    existing.connections = spec.connections.length
      ? spec.connections
      : existing.connections;
    existing.bom = bom;
    existing.media = media;
    existing.source = { ...(existing.source as object), ...source };
    existing.compatibility = compatibility;
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
    unit: "piece",
    package_quantity: 1,
    lifecycle_status: "active",
    attributes: spec.attributes,
    connections: spec.connections,
    performance_tables: [],
    compatibility,
    bom,
    media,
    source,
    price_eur: spec.priceEur,
    field_status: {},
    provenance: { imported_from: "enrich-source-variants" },
    quality: {},
    data_readiness: "enriched",
    design_selection: {},
  });
}

async function main() {
  const uni = JSON.parse(fs.readFileSync(UNIVERSAL, "utf8")) as {
    products: AnyRec[];
  };
  const products = uni.products;

  console.log("=== Scheibenfilter variants ===");
  const filterPage = await expandPage(
    "https://www.wasserundgruen.de/Scheibenfilter-3-4---1--und-1-1-2--auch-mit-Uebergang-auf-PE-25-mm--PE-32-mm--PE-40-mm-Anschluss-inkl--Verschraubung.html",
  );
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(
      CACHE_DIR,
      "Scheibenfilter-3-4---1--und-1-1-2--auch-mit-Uebergang-auf-PE-25-mm--PE-32-mm--PE-40-mm-Anschluss-inkl--Verschraubung.json",
    ),
    JSON.stringify(
      {
        product_id_shop: "594",
        url: filterPage.url,
        fetched_at: new Date().toISOString(),
        options: filterPage.options.map((o) => ({
          property_id: o.propertyId,
          option_id: o.optionId,
          label: o.label,
          price_eur: o.priceEur,
          model: o.article,
          images: o.images,
          ok: true,
        })),
      },
      null,
      2,
    ),
  );
  upsertFilter(products, filterPage);

  console.log("=== Einwinterung variants ===");
  const winterPage = await expandPage(
    "https://www.wasserundgruen.de/Einwinterungseinheit---Druckluftanschluss-mit-Ueberwurf--Winkel--Druckluftanschluss-mit-Ueberwurf-T-Stueck-mit-Sys--Geka--Einwinterung.html",
  );
  fs.writeFileSync(
    path.join(
      CACHE_DIR,
      "Einwinterungseinheit---Druckluftanschluss-mit-Ueberwurf--Winkel--Druckluftanschluss-mit-Ueberwurf-T-Stueck-mit-Sys--Geka--Einwinterung.json",
    ),
    JSON.stringify(
      {
        product_id_shop: "474",
        url: winterPage.url,
        fetched_at: new Date().toISOString(),
        options: winterPage.options.map((o) => ({
          property_id: o.propertyId,
          option_id: o.optionId,
          label: o.label,
          price_eur: o.priceEur,
          model: o.article,
          images: o.images,
          ok: true,
        })),
      },
      null,
      2,
    ),
  );
  upsertWinter(products, winterPage);

  console.log("=== Ventilkästen ===");
  const boxes = [
    {
      url: "https://www.wasserundgruen.de/Rain-Bird-Ventilkasten-Standard-gross-eckig--Masse--600-x-430-x-300-mm--Original-Rain-Bird-VBA02675.html",
      article: "VBA02675",
      lengthMm: 600,
      widthMm: 430,
      heightMm: 300,
      // user table: Boden ~66cm for 5–12 outlets → VBA 60cm is tight; use for ≤4 as today, also allow ≤6 with note
      maxValveCount: 4,
    },
    {
      url: "https://www.wasserundgruen.de/ventilkasten-standart-eckig-klein-eckig-masse-520-x-400-x-330-mm-kompatibel-mit-rain-bird-hunter-magnetventilen.html",
      article: "VENT-EK",
      lengthMm: 520,
      widthMm: 400,
      heightMm: 330,
      // user table 2–4 outlets: Bodenlänge 52 cm, Höhe 33 cm
      maxValveCount: 4,
    },
    {
      url: "https://www.wasserundgruen.de/Ventilkasten-Standart-gross-eckig-mit-Loechern--gross-eckig--Masse--660-x-555-x-330-mm-VENT-EG-Kompatibel-mit-Rain-Bird---Hunter-Magnetventilen.html",
      article: "VENT-EG",
      lengthMm: 660,
      widthMm: 555,
      heightMm: 330,
      // user table 5–12 outlets: Boden ~66×67 × H33
      maxValveCount: 12,
    },
    {
      url: "https://www.wasserundgruen.de/ventilkasten-standart-eckig-klein-eckig-masse-520-x-400-x-330-mm-kompatibel-mit-rain-bird-hunter-magnetventilen-125-126.html",
      article: "VENT-EJ",
      lengthMm: 810,
      widthMm: 590,
      heightMm: 415,
      // Jumbo fallback when footprint exceeds VENT-EG
      maxValveCount: 12,
    },
  ];

  for (const b of boxes) {
    const { html } = await cachedFetch(b.url, { force: true });
    const raw = parseProductPage(b.url, html);
    console.log(`  ${b.article} €${raw.price} imgs=${raw.images.length}`);
    upsertValveBox(products, raw, b);
  }

  uni.products = products;
  fs.writeFileSync(UNIVERSAL, JSON.stringify(uni, null, 2) + "\n");
  console.log("universal products:", products.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
