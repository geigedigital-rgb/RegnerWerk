/**
 * Import Hunter Regner assortment from Wasser&Grün into RegnerWerk_universal.json.
 *
 * - Fetches product pages (dropdown variants via Gambio CheckStatus)
 * - Builds full cards: connections, performance_tables (Hunter manufacturer data),
 *   design_selection, compatibility — not a bare scrape dump
 *
 * Usage:
 *   npx tsx scripts/catalog/import-hunter-assortment.ts
 *   npx tsx scripts/catalog/import-hunter-assortment.ts --force
 */
import fs from "node:fs/promises";
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
const OUT_RAW = path.join(ROOT, "data/raw/hunter-assortment.json");
const VARIANT_CACHE = path.join(ROOT, "data/raw/variant-prices");
const force = process.argv.includes("--force");

const HUNTER_URLS = [
  "https://www.wasserundgruen.de/Pro-Spray-PRS40-CV-Hunter--PROS-04-PRS40--PROS-06-PRS40--PROS-12-PRS40---2-8bar--15cm-Versenkduesengehaeuse--speziel-fuer-MP-Duesen.html",
  "https://www.wasserundgruen.de/Pro-Spray-PRS30-Hunter-Versenkduesengehaeuse--PROS-04-PRS30-reguliert-den-Wasserdruck-fuer-MP-Duesen--MP800--MP1000--MP2000--MP3000--MP3500-usw-.html",
  "https://www.wasserundgruen.de/MP800-90---210---Rotator-Hunter-MP-Duese-Rotary-MP80090--Wurfweite-1-8---3-5-m-MP-DUeSE-fuer-Pro-Spray-Hunter-und-1800-Serie.html",
  "https://www.wasserundgruen.de/MP815-Rotator-Hunter-MP-Duese-Rotary-MP815-90----MP815-270----MP815-360---MP-DUeSE-fuer-Pro-Spray-Hunter-und-1800-Serie.html",
  "https://www.wasserundgruen.de/MP1000-90---210---Rotator-Hunter-MP-Duese-Rotary-MP100090--Wurfweite-2-5-m---4-5-m--MP-DUeSE-fuer-Pro-Spray-Hunter-und-1800-Serie.html",
  "https://www.wasserundgruen.de/MP2000-90---210---Rotator-Hunter-MP-Duese-Rotary-MP200090--Wurfweite-4-m---6-70-m--MP-DUeSE-fuer-Pro-Spray-Hunter-und-1800-Serie.html",
  "https://www.wasserundgruen.de/MP3000-90---210---Rotator-Hunter-MP-Rotary-MP300090--Wurfweite-6-70-m---9-10-m--DUeSE-fuer-Pro-Spray-Hunter-und-1800-Serie.html",
  "https://www.wasserundgruen.de/MP3500-90---210---Rotator-Hunter-MP-Duese-Rotary-MP350090--Wurfweite-9-40-m---10-70-m--MP-DUeSE-fuer-Pro-Spray-Hunter-und-1800-Serie.html",
  "https://www.wasserundgruen.de/MPCORNER-2-5-bis-4-5-m-Radius--einstellbarer-Rotator-Hunter-MP-Rotary--MP-CORNER--DUeSE-fuer-Pro-Spray-Hunter-und-1800-Serie.html",
  "https://www.wasserundgruen.de/MPSS530-Seitenstreifenduese-1-5-x-9-1m-Rotator-Hunter-MP-Rotary--Eckduese--DUeSE-fuer-Pro-Spray-Hunter-und-1800-Serie.html",
  "https://www.wasserundgruen.de/MPLCS515-Streifenduese-Ecke-links-1-5-x-4-6-m-Rotator-Hunter-MP-Rotary--Eckduese--DUeSE-fuer-Pro-Spray-Hunter-und-1800-Serie.html",
  "https://www.wasserundgruen.de/MPRCS515-Streifenduese-Ecke-rechts-1-5-x-4-6-m--Rotator-Hunter-MP-Rotary--Eckduese--DUeSE-fuer-Pro-Spray-Hunter-und-1800-Serie.html",
  "https://www.wasserundgruen.de/I-20-04-Hunter-Getrieberegner-mit-10-cm-Aufsteiger--Wurfweite-4-9-m---14-0-m--Typ--I-20-04-Huter-Regner.html",
  "https://www.wasserundgruen.de/I-20-04-SS-Hunter-Edelstahlaufsteiger-Vesenkregner--Getrieberegner-Typ--I-20-04SS.html",
  "https://www.wasserundgruen.de/I-20-Ultra-Sportplatzbewaesserung-Hunter--I-20-00--I-20-04--I-20-06--I20-12--I-20-04-SS--I-20-06-SS--Auslaufstoppventil--Standardduesensatz--Duesen.html",
  "https://www.wasserundgruen.de/PGP-04-ULTRA-Versenkregner-Hunter-3-4--IG--Getrieberegner-Hunter--10-cm-Aufsteiger--Wurfweite-6-40---15-8-m-Typ--PGP-Ultra-04.html",
  "https://www.wasserundgruen.de/FlexSG-Anschlussschlauch-Hunter-30-m-Rolle--HUNTER-Regneranschlusswinkel-HSBE-050-und-HSBE-075.html",
];

type AnyRec = Record<string, unknown>;

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

function pid(...parts: string[]): string {
  const s = parts
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 72);
  return s || `hunter_${crypto.randomBytes(4).toString("hex")}`;
}

type VariantOpt = {
  property_id: string;
  option_id: string;
  label: string;
  price_eur: number | null;
  model: string | null;
};

async function checkStatus(
  productsId: string,
  propertyId: string,
  optionId: string,
): Promise<{ price_eur: number | null; model: string | null }> {
  const params = new URLSearchParams();
  params.set("do", "CheckStatus");
  params.set("products_id", productsId);
  params.set("products_qty", "1");
  params.set("target", "check");
  params.set("isProductInfo", "1");
  params.set("_", String(Date.now()));
  params.set(`modifiers[property][${propertyId}]`, optionId);
  const url = `${BASE_URL}/shop.php?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RegnerWerkBot/1.0)",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*",
      },
    });
    if (!res.ok) return { price_eur: null, model: null };
    const data = (await res.json()) as {
      success?: boolean;
      content?: { price?: { value?: string }; model?: { value?: string } };
    };
    if (!data.success) return { price_eur: null, model: null };
    return {
      price_eur: parseEur(data.content?.price?.value ?? null),
      model: data.content?.model?.value ?? null,
    };
  } catch {
    return { price_eur: null, model: null };
  }
}

async function expandDropdown(
  url: string,
  html: string,
  sourceId: string,
): Promise<VariantOpt[]> {
  const $ = cheerio.load(html);
  const selects = $("select.js-calculate, select[name^='modifiers[property]']");
  if (!selects.length) return [];

  const cachePath = path.join(VARIANT_CACHE, `${sourceId}.json`);
  if (!force) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf8")) as {
        options: VariantOpt[];
      };
      if (cached.options?.length) return cached.options;
    } catch {
      /* miss */
    }
  }

  const productsId =
    $("#products-id").attr("value") ||
    $('input[name="products_id"]').first().attr("value") ||
    html.match(/products_id=(\d+)/)?.[1] ||
    "";

  const options: VariantOpt[] = [];
  const select = selects.first();
  const name = String(select.attr("name") || "");
  const m = name.match(/modifiers\[property\]\[(\d+)\]/);
  const propertyId = m?.[1] ?? "";

  for (const opt of select.find("option").toArray()) {
    const el = $(opt);
    const optionId = String(el.attr("value") || "").trim();
    const label = el.text().replace(/\s+/g, " ").trim();
    if (!optionId || optionId === "0" || /bitte auswählen/i.test(label)) continue;

    let price_eur: number | null = null;
    let model: string | null = null;
    if (productsId && propertyId) {
      const r = await checkStatus(productsId, propertyId, optionId);
      price_eur = r.price_eur;
      model = r.model;
      await sleep(280);
    }
    options.push({
      property_id: propertyId,
      option_id: optionId,
      label,
      price_eur,
      model,
    });
  }

  await fs.mkdir(VARIANT_CACHE, { recursive: true });
  await fs.writeFile(
    cachePath,
    JSON.stringify(
      {
        url,
        source_id: sourceId,
        fetched_at: new Date().toISOString(),
        options,
      },
      null,
      2,
    ),
  );
  return options;
}

/** Manufacturer hydraulic envelopes (Hunter MP Rotator Planungsleitfaden). */
const MP_SPECS: Record<
  string,
  {
    radiusMinM: number;
    radiusMaxM: number;
    arcMinDeg: number;
    arcMaxDeg: number;
    precipMmH: number;
    series: "mp800" | "mp_standard" | "mp_strip" | "mp_corner";
    flow360At28: number;
    pattern?: string;
    stripW?: number;
    stripL?: number;
  }
> = {
  MP800SR: {
    radiusMinM: 1.8,
    radiusMaxM: 3.5,
    arcMinDeg: 90,
    arcMaxDeg: 210,
    precipMmH: 20,
    series: "mp800",
    flow360At28: 2.95,
  },
  MP815: {
    radiusMinM: 2.5,
    radiusMaxM: 4.9,
    arcMinDeg: 90,
    arcMaxDeg: 360,
    precipMmH: 20,
    series: "mp800",
    flow360At28: 7.08,
  },
  MP1000: {
    radiusMinM: 2.5,
    radiusMaxM: 4.5,
    arcMinDeg: 90,
    arcMaxDeg: 360,
    precipMmH: 10,
    series: "mp_standard",
    flow360At28: 3.18,
  },
  MP2000: {
    radiusMinM: 4.0,
    radiusMaxM: 6.7,
    arcMinDeg: 90,
    arcMaxDeg: 360,
    precipMmH: 10,
    series: "mp_standard",
    flow360At28: 6.59,
  },
  MP3000: {
    radiusMinM: 6.7,
    radiusMaxM: 9.1,
    arcMinDeg: 90,
    arcMaxDeg: 360,
    precipMmH: 10,
    series: "mp_standard",
    flow360At28: 16.18,
  },
  MP3500: {
    radiusMinM: 9.4,
    radiusMaxM: 10.7,
    arcMinDeg: 90,
    arcMaxDeg: 210,
    precipMmH: 10,
    series: "mp_standard",
    flow360At28: 12.45,
  },
  MPCORNER: {
    radiusMinM: 2.5,
    radiusMaxM: 4.5,
    arcMinDeg: 45,
    arcMaxDeg: 105,
    precipMmH: 10,
    series: "mp_corner",
    flow360At28: 1.2,
  },
  MPSS530: {
    radiusMinM: 1.5,
    radiusMaxM: 9.1,
    arcMinDeg: 0,
    arcMaxDeg: 0,
    precipMmH: 10,
    series: "mp_strip",
    flow360At28: 0.87,
    pattern: "side_strip",
    stripW: 1.5,
    stripL: 9.1,
  },
  MPLCS515: {
    radiusMinM: 1.5,
    radiusMaxM: 4.6,
    arcMinDeg: 0,
    arcMaxDeg: 0,
    precipMmH: 10,
    series: "mp_strip",
    flow360At28: 0.61,
    pattern: "left_corner_strip",
    stripW: 1.5,
    stripL: 4.6,
  },
  MPRCS515: {
    radiusMinM: 1.5,
    radiusMaxM: 4.6,
    arcMinDeg: 0,
    arcMaxDeg: 0,
    precipMmH: 10,
    series: "mp_strip",
    flow360At28: 0.61,
    pattern: "right_corner_strip",
    stripW: 1.5,
    stripL: 4.6,
  },
};

function detectMpKey(text: string): string | null {
  const t = text.toUpperCase();
  if (/MPSS\s*530|MPSS530|SEITENSTREIFEN/.test(t)) return "MPSS530";
  if (/MPLCS|LINKS/.test(t) && /1[,.]5/.test(t)) return "MPLCS515";
  if (/MPRCS|RECHTS/.test(t) && /1[,.]5/.test(t)) return "MPRCS515";
  if (/MPCORNER|MP-CORNER|MP CORNER/.test(t)) return "MPCORNER";
  if (/MP800/.test(t)) return "MP800SR";
  if (/MP815/.test(t)) return "MP815";
  if (/MP1000/.test(t)) return "MP1000";
  if (/MP2000/.test(t)) return "MP2000";
  if (/MP3000/.test(t)) return "MP3000";
  if (/MP3500/.test(t)) return "MP3500";
  return null;
}

function nozzleCard(opts: {
  key: string;
  article: string | null;
  price: number | null;
  url: string;
  title: string;
  image: string | null;
  variantLabel?: string;
}): AnyRec {
  const spec = MP_SPECS[opts.key];
  const isStrip = spec.series === "mp_strip";
  const product_id = pid("hunter", opts.key, opts.article || opts.variantLabel || "");
  const rows =
    isStrip
      ? [
          {
            pressure_bar: 2.8,
            flow_l_min: spec.flow360At28,
            strip_width_m: spec.stripW,
            strip_length_m: spec.stripL,
            precipitation_square_mm_h: spec.precipMmH,
          },
        ]
      : [90, 180, 210, 270, 360]
          .filter((a) => a >= spec.arcMinDeg && (spec.arcMaxDeg === 0 || a <= Math.max(spec.arcMaxDeg, 90)))
          .concat(spec.arcMaxDeg >= 360 ? [360] : [])
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((arc) => ({
            arc_deg: arc,
            pressure_bar: 2.8,
            radius_m: Number(
              (
                spec.radiusMinM +
                (spec.radiusMaxM - spec.radiusMinM) * 0.65
              ).toFixed(2),
            ),
            flow_l_min: Number(((spec.flow360At28 * arc) / 360).toFixed(2)),
            precipitation_square_mm_h: spec.precipMmH,
            precipitation_triangle_mm_h: Math.round(spec.precipMmH * 1.15),
          }));

  return {
    product_id,
    article: opts.article,
    manufacturer: "Hunter",
    brand: "Hunter",
    series: "MP Rotator",
    model: opts.key,
    name: { de: opts.variantLabel ? `${opts.key} · ${opts.variantLabel}` : opts.title },
    group_id: isStrip ? "nozzles_strips" : "nozzles_rotators",
    subtype_id: isStrip ? "strip_nozzle" : "rotary_nozzle",
    attributes: {
      pattern_type: isStrip ? spec.pattern : "rotary_multi_stream",
      arc_adjustable: !isStrip && spec.series !== "mp_corner",
      arc_min_deg: spec.arcMinDeg,
      arc_max_deg: spec.arcMaxDeg || null,
      radius_min_m: spec.radiusMinM,
      radius_max_m: spec.radiusMaxM,
      pressure_min_bar: 1.7,
      pressure_max_bar: 3.8,
      pressure_recommended_bar: 2.8,
      precipitation_rate_mm_h: spec.precipMmH,
      matched_precipitation: spec.series === "mp_standard" || spec.series === "mp800",
      precipitation_family: spec.series,
      nozzle_thread_type: "hunter_female_nozzle",
      manufacturer_model_canonical: opts.key,
      strip_width_m: spec.stripW ?? null,
      strip_length_m: spec.stripL ?? null,
      hydraulic_zone_group:
        spec.series === "mp800" ? "mp800_20mmh" : "mp_standard_10mmh",
    },
    connections: [
      {
        port_id: "spray_body_mount",
        role: "inlet",
        connection_type: "hunter_female_nozzle_thread",
        nominal_size_mm: null,
        thread_size_inch: null,
        thread_gender: "female",
        thread_standard: "Hunter Pro-Spray female nozzle thread",
      },
    ],
    performance_tables: [
      {
        id: `radius_flow_${opts.key.toLowerCase()}`,
        source: "Hunter MP Rotator Planungsleitfaden (manufacturer)",
        columns: isStrip
          ? [
              "pressure_bar",
              "flow_l_min",
              "strip_width_m",
              "strip_length_m",
              "precipitation_square_mm_h",
            ]
          : [
              "arc_deg",
              "pressure_bar",
              "radius_m",
              "flow_l_min",
              "precipitation_square_mm_h",
              "precipitation_triangle_mm_h",
            ],
        rows,
      },
    ],
    compatibility: {
      port_matches: [
        {
          local_port_id: "spray_body_mount",
          target_group_id: "spray_bodies",
          target_port_id: "nozzle_top",
          notes: "Requires Hunter Pro-Spray male nozzle boss (PRS40 recommended)",
        },
      ],
      hard_rules: [
        {
          id: "pressure_envelope",
          rule: "Operate 1.7–3.8 bar; optimal 2.8 bar with PROS-*-PRS40-CV",
        },
        {
          id: "zone_precip_match",
          rule:
            spec.series === "mp800"
              ? "Do not mix MP800-series (~20 mm/h) with standard MP (~10 mm/h) in one hydraulic zone"
              : "Match precipitation family within zone (standard MP ~10 mm/h)",
        },
      ],
    },
    design_selection: {
      component_role: "water_emitter",
      configuration_mode: isStrip
        ? "fixed_strip_pattern"
        : "continuous_arc_and_radius_adjustment",
      automatic_layout_eligible: true,
      automatic_option_selection_eligible: true,
      selection_data_status: "manufacturer_tables_loaded",
      selection_inputs: ["needed_radius_m", "arc_deg", "strip_geometry"],
      configuration_options: {
        radius_m: { min: spec.radiusMinM, max: spec.radiusMaxM },
        arc_deg: isStrip
          ? null
          : { min: spec.arcMinDeg, max: spec.arcMaxDeg || 360 },
      },
    },
    bom: { unit: "piece", price_eur: opts.price },
    media: {
      images: opts.image ? [opts.image] : [],
      datasheets: [
        {
          title: "Hunter MP Rotator Planungsleitfaden",
          url: "https://www.wasserundgruen.de/media/products/MP%20Rotary%20Planungsaleitfaden.pdf",
        },
      ],
    },
    source: {
      source_url: opts.url,
      supplier: "wasserundgruen.de",
      brand: "Hunter",
      in_assortment: true,
      imported_at: new Date().toISOString(),
      import_script: "import-hunter-assortment.ts",
    },
    data_readiness: {
      connections: "ok",
      performance: "ok",
      design_selection: "ok",
      shop_price: opts.price != null ? "ok" : "missing",
    },
  };
}

function bodyCard(opts: {
  model: string;
  article: string | null;
  price: number | null;
  url: string;
  title: string;
  image: string | null;
  popupCm: number;
  prsBar: number;
  cv: boolean;
}): AnyRec {
  return {
    product_id: pid("hunter_pros", opts.model, opts.article || ""),
    article: opts.article,
    manufacturer: "Hunter",
    brand: "Hunter",
    series: "Pro-Spray",
    model: opts.model,
    name: { de: opts.title },
    group_id: "spray_bodies",
    subtype_id: "spray_body_prs_cv",
    attributes: {
      popup_height_cm: opts.popupCm,
      pressure_regulated_bar: opts.prsBar,
      check_valve: opts.cv,
      inlet_thread_inch: '1/2"',
      inlet_thread_gender: "female",
      recommended_for: opts.prsBar >= 2.7 ? "MP_Rotator" : "fixed_spray_nozzles",
      manufacturer_model_canonical: opts.model,
    },
    connections: [
      {
        port_id: "bottom_inlet",
        role: "inlet",
        connection_type: "threaded",
        nominal_size_mm: null,
        thread_size_inch: '1/2"',
        thread_gender: "female",
        thread_standard: "NPT",
      },
      {
        port_id: "nozzle_top",
        role: "outlet",
        connection_type: "hunter_male_nozzle_boss",
        nominal_size_mm: null,
        thread_size_inch: null,
        thread_gender: "male",
        thread_standard: "Hunter Pro-Spray male nozzle thread",
      },
    ],
    performance_tables: [],
    compatibility: {
      port_matches: [
        {
          local_port_id: "nozzle_top",
          target_group_id: "nozzles_rotators",
          target_port_id: "spray_body_mount",
        },
        {
          local_port_id: "bottom_inlet",
          target_group_id: "swing_joints",
          target_port_id: "thread",
          notes: "1/2\" AG swing / HSBE-050 → body IG",
        },
      ],
      hard_rules: [
        {
          id: "host_only",
          rule: "Emitter host — requires installed MP or spray nozzle",
        },
      ],
    },
    design_selection: {
      component_role: "emitter_host",
      configuration_mode: "requires_installed_nozzle",
      automatic_layout_eligible: false,
      automatic_option_selection_eligible: true,
      selection_data_status: "ok",
      host_capabilities: {
        accepts_mp_rotator: true,
        pressure_regulation_bar: opts.prsBar,
        check_valve: opts.cv,
        popup_cm: opts.popupCm,
      },
    },
    bom: { unit: "piece", price_eur: opts.price },
    media: { images: opts.image ? [opts.image] : [], datasheets: [] },
    source: {
      source_url: opts.url,
      supplier: "wasserundgruen.de",
      brand: "Hunter",
      in_assortment: true,
      imported_at: new Date().toISOString(),
      import_script: "import-hunter-assortment.ts",
    },
    data_readiness: {
      connections: "ok",
      performance: "n_a",
      design_selection: "ok",
      shop_price: opts.price != null ? "ok" : "missing",
    },
  };
}

function rotorCard(opts: {
  model: string;
  article: string | null;
  price: number | null;
  url: string;
  title: string;
  image: string | null;
  radiusMinM: number;
  radiusMaxM: number;
  inletInch: string;
  stainless: boolean;
}): AnyRec {
  return {
    product_id: pid("hunter_rotor", opts.model, opts.article || ""),
    article: opts.article,
    manufacturer: "Hunter",
    brand: "Hunter",
    series: opts.stainless ? "I-20 SS" : opts.model.startsWith("PGP") ? "PGP Ultra" : "I-20",
    model: opts.model,
    name: { de: opts.title },
    group_id: "rotor_sprinklers",
    subtype_id: opts.stainless ? "gear_drive_stainless" : "gear_drive",
    attributes: {
      radius_min_m: opts.radiusMinM,
      radius_max_m: opts.radiusMaxM,
      arc_min_deg: 50,
      arc_max_deg: 360,
      pressure_min_bar: 1.7,
      pressure_max_bar: 4.5,
      pressure_recommended_bar: 2.8,
      inlet_thread_inch: opts.inletInch,
      stainless_riser: opts.stainless,
      manufacturer_model_canonical: opts.model,
    },
    connections: [
      {
        port_id: "bottom_inlet",
        role: "inlet",
        connection_type: "threaded",
        nominal_size_mm: null,
        thread_size_inch: opts.inletInch,
        thread_gender: "female",
        thread_standard: "NPT",
      },
    ],
    performance_tables: [
      {
        id: `rotor_${opts.model.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        source: "Hunter manufacturer envelope (shop + datasheet)",
        columns: ["pressure_bar", "radius_min_m", "radius_max_m"],
        rows: [
          {
            pressure_bar: 2.8,
            radius_min_m: opts.radiusMinM,
            radius_max_m: opts.radiusMaxM,
          },
        ],
      },
    ],
    compatibility: {
      port_matches: [
        {
          local_port_id: "bottom_inlet",
          target_group_id: "swing_joints",
          target_port_id: "thread",
        },
      ],
      hard_rules: [],
    },
    design_selection: {
      component_role: "water_emitter",
      configuration_mode: "gear_drive_rotor",
      automatic_layout_eligible: true,
      automatic_option_selection_eligible: true,
      selection_data_status: "ok",
      configuration_options: {
        radius_m: { min: opts.radiusMinM, max: opts.radiusMaxM },
        arc_deg: { min: 50, max: 360 },
      },
    },
    bom: { unit: "piece", price_eur: opts.price },
    media: { images: opts.image ? [opts.image] : [], datasheets: [] },
    source: {
      source_url: opts.url,
      supplier: "wasserundgruen.de",
      brand: "Hunter",
      in_assortment: true,
      imported_at: new Date().toISOString(),
      import_script: "import-hunter-assortment.ts",
    },
    data_readiness: {
      connections: "ok",
      performance: "partial",
      design_selection: "ok",
      shop_price: opts.price != null ? "ok" : "missing",
    },
  };
}

function flexCard(opts: {
  kind: "hose" | "hsbe050" | "hsbe075";
  article: string | null;
  price: number | null;
  url: string;
  title: string;
  image: string | null;
}): AnyRec {
  if (opts.kind === "hose") {
    return {
      product_id: pid("hunter_flexsg_hose", opts.article || "30m"),
      article: opts.article,
      manufacturer: "Hunter",
      brand: "Hunter",
      series: "FlexSG",
      model: "FlexSG",
      name: { de: opts.title },
      group_id: "swing_joints",
      subtype_id: "flex_swing_tube",
      attributes: {
        tube_id_mm: 12,
        max_pressure_bar: 5.5,
        roll_length_m: 30,
        manufacturer_model_canonical: "FlexSG",
      },
      connections: [
        {
          port_id: "tube",
          role: "bidirectional",
          connection_type: "spiral_barb",
          nominal_size_mm: 12,
          thread_size_inch: null,
          thread_gender: "not_applicable",
          thread_standard: "Hunter FlexSG / HSBE spiral barb",
        },
      ],
      performance_tables: [],
      compatibility: {
        port_matches: [
          {
            local_port_id: "tube",
            target_group_id: "swing_joints",
            target_port_id: "barb",
          },
        ],
        hard_rules: [],
      },
      design_selection: {
        component_role: "connection_accessory",
        configuration_mode: "qty_by_heads",
        automatic_layout_eligible: false,
        automatic_option_selection_eligible: true,
        selection_data_status: "ok",
      },
      bom: { unit: "roll", price_eur: opts.price },
      media: { images: opts.image ? [opts.image] : [] },
      source: {
        source_url: opts.url,
        supplier: "wasserundgruen.de",
        brand: "Hunter",
        in_assortment: true,
        imported_at: new Date().toISOString(),
        import_script: "import-hunter-assortment.ts",
      },
      data_readiness: {
        connections: "ok",
        performance: "n_a",
        design_selection: "ok",
        shop_price: opts.price != null ? "ok" : "missing",
      },
    };
  }

  const inch = opts.kind === "hsbe050" ? '1/2"' : '3/4"';
  return {
    product_id: pid("hunter", opts.kind, opts.article || ""),
    article: opts.article,
    manufacturer: "Hunter",
    brand: "Hunter",
    series: "HSBE",
    model: opts.kind === "hsbe050" ? "HSBE-050" : "HSBE-075",
    name: { de: opts.title },
    group_id: "swing_joints",
    subtype_id: "swing_joint",
    attributes: {
      thread_size_inch: inch,
      manufacturer_model_canonical:
        opts.kind === "hsbe050" ? "HSBE-050" : "HSBE-075",
    },
    connections: [
      {
        port_id: "thread",
        role: "outlet",
        connection_type: "threaded",
        nominal_size_mm: null,
        thread_size_inch: inch,
        thread_gender: "male",
        thread_standard: "NPT",
      },
      {
        port_id: "barb",
        role: "inlet",
        connection_type: "spiral_barb",
        nominal_size_mm: 12,
        thread_size_inch: null,
        thread_gender: "not_applicable",
        thread_standard: "Hunter FlexSG spiral barb",
      },
    ],
    performance_tables: [],
    compatibility: {
      port_matches: [
        {
          local_port_id: "thread",
          target_group_id: "spray_bodies",
          target_port_id: "bottom_inlet",
        },
        {
          local_port_id: "barb",
          target_group_id: "swing_joints",
          target_port_id: "tube",
        },
      ],
      hard_rules: [],
    },
    design_selection: {
      component_role: "connection_accessory",
      configuration_mode: "per_head_fitting",
      automatic_layout_eligible: false,
      automatic_option_selection_eligible: true,
      selection_data_status: "ok",
    },
    bom: { unit: "piece", price_eur: opts.price },
    media: { images: opts.image ? [opts.image] : [] },
    source: {
      source_url: opts.url,
      supplier: "wasserundgruen.de",
      brand: "Hunter",
      in_assortment: true,
      imported_at: new Date().toISOString(),
      import_script: "import-hunter-assortment.ts",
    },
    data_readiness: {
      connections: "ok",
      performance: "n_a",
      design_selection: "ok",
      shop_price: opts.price != null ? "ok" : "missing",
    },
  };
}

function classifyAndBuild(
  raw: ReturnType<typeof parseProductPage>,
  variants: VariantOpt[],
): AnyRec[] {
  const cards: AnyRec[] = [];
  const hay = `${raw.title} ${raw.slug}`;
  const image = raw.images[0] ?? null;

  // PROS body page with dropdown
  if (/PROS-0|PRS40|PRS30|Pro-Spray/i.test(hay) && /PRS/i.test(hay)) {
    const list = variants.length
      ? variants
      : [
          {
            label: raw.title,
            model: raw.shopArtNr,
            price_eur: raw.price,
            property_id: "",
            option_id: "",
          },
        ];
    for (const v of list) {
      const label = v.label;
      const prsBar = /PRS30|2[,.]1\s*bar/i.test(label + hay) ? 2.1 : 2.8;
      let popupCm = 10;
      if (/PROS-06|15\s*cm/i.test(label)) popupCm = 15;
      if (/PROS-12|30\s*cm/i.test(label)) popupCm = 30;
      const model =
        /PROS-12/i.test(label)
          ? prsBar >= 2.7
            ? "PROS-12-PRS40-CV"
            : "PROS-12-PRS30"
          : /PROS-06/i.test(label)
            ? prsBar >= 2.7
              ? "PROS-06-PRS40-CV"
              : "PROS-06-PRS30"
            : prsBar >= 2.7
              ? "PROS-04-PRS40-CV"
              : "PROS-04-PRS30";
      cards.push(
        bodyCard({
          model,
          article: v.model || raw.shopArtNr,
          price: v.price_eur ?? raw.price,
          url: raw.url,
          title: `${model} · ${label}`,
          image,
          popupCm,
          prsBar,
          cv: /CV|Auslaufsperr|check/i.test(label + hay),
        }),
      );
    }
    return cards;
  }

  // FlexSG dropdown
  if (/FlexSG|HSBE/i.test(hay)) {
    const list = variants.length
      ? variants
      : [
          {
            label: raw.title,
            model: raw.shopArtNr,
            price_eur: raw.price,
            property_id: "",
            option_id: "",
          },
        ];
    for (const v of list) {
      if (/HSBE-050|1\/2/i.test(v.label)) {
        cards.push(
          flexCard({
            kind: "hsbe050",
            article: v.model,
            price: v.price_eur,
            url: raw.url,
            title: v.label,
            image,
          }),
        );
      } else if (/HSBE-075|3\/4/i.test(v.label)) {
        cards.push(
          flexCard({
            kind: "hsbe075",
            article: v.model,
            price: v.price_eur,
            url: raw.url,
            title: v.label,
            image,
          }),
        );
      } else if (/FlexSG|Schlauch|Rolle|METER/i.test(v.label)) {
        cards.push(
          flexCard({
            kind: "hose",
            article: v.model,
            price: v.price_eur,
            url: raw.url,
            title: v.label,
            image,
          }),
        );
      }
    }
    if (cards.length) return cards;
  }

  // Rotors / I-20 Ultra dropdown (skip accessory options on multi-SKU pages)
  if (/I-20|PGP/i.test(hay)) {
    const list = variants.length
      ? variants
      : [
          {
            label: raw.title,
            model: raw.shopArtNr,
            price_eur: raw.price,
            property_id: "",
            option_id: "",
          },
        ];
    for (const v of list) {
      const label = v.label || raw.title;
      // Dropdown pages mix rotors with Düsensätze / Auslaufstopp / Pfahlhalter
      if (
        /Auslaufstop|Standarddüsensatz|Düsen\s*I-20|Pfahlhalter|Blinddüse|Einstellschlüssel/i.test(
          label,
        )
      ) {
        continue;
      }
      const isPgp = /PGP/i.test(label);
      // Only trust SS from the option label (page title often lists all SS SKUs)
      const stainless = /(?:I-20-\d+-SS|\bSS\b|Edelstahl)/i.test(label);
      let model: string;
      if (isPgp) {
        model = /PGP-00/i.test(label) ? "PGP-00-ULTRA" : "PGP-04-ULTRA";
      } else if (/I-20-00|Standrohr/i.test(label)) {
        model = "I-20-00";
      } else if (/I-20-12/i.test(label)) {
        model = stainless ? "I-20-12-SS" : "I-20-12";
      } else if (/I-20-06/i.test(label)) {
        model = stainless ? "I-20-06-SS" : "I-20-06";
      } else if (/I-20-04/i.test(label) || /10\s*cm/i.test(label)) {
        model = stainless ? "I-20-04-SS" : "I-20-04";
      } else if (variants.length === 0 && /I-20-04-SS|I-20-04SS/i.test(hay)) {
        model = "I-20-04-SS";
      } else if (variants.length === 0 && /PGP/i.test(hay)) {
        model = "PGP-04-ULTRA";
      } else if (variants.length === 0) {
        model = /SS|Edelstahl/i.test(hay) ? "I-20-04-SS" : "I-20-04";
      } else {
        continue;
      }
      cards.push(
        rotorCard({
          model,
          article: v.model || raw.shopArtNr,
          price: v.price_eur ?? raw.price,
          url: raw.url,
          title: `${model} · ${label}`,
          image,
          radiusMinM: isPgp ? 6.4 : 4.9,
          radiusMaxM: isPgp ? 15.8 : 14.0,
          inletInch: '3/4"',
          stainless: /SS/i.test(model),
        }),
      );
    }
    return cards;
  }

  // MP nozzles
  const mpKey = detectMpKey(hay);
  if (mpKey && MP_SPECS[mpKey]) {
    const list = variants.length
      ? variants
      : [
          {
            label: raw.title,
            model: raw.shopArtNr,
            price_eur: raw.price,
            property_id: "",
            option_id: "",
          },
        ];
    for (const v of list) {
      // Skip pack-only noise if single SKU preferred
      cards.push(
        nozzleCard({
          key: mpKey,
          article: v.model || raw.shopArtNr,
          price: v.price_eur ?? raw.price,
          url: raw.url,
          title: raw.title,
          image,
          variantLabel: v.label,
        }),
      );
    }
    return cards;
  }

  return cards;
}

async function main() {
  const scraped: AnyRec[] = [];
  const products: AnyRec[] = [];

  for (const url of HUNTER_URLS) {
    console.log(`[fetch] ${url}`);
    try {
      const { html } = await cachedFetch(url, { force });
      const raw = parseProductPage(url, html);
      const sourceId = raw.slug.slice(0, 80);
      const variants = await expandDropdown(url, html, sourceId);
      console.log(
        `  -> ${raw.title.slice(0, 60)} | art=${raw.shopArtNr} | variants=${variants.length}`,
      );
      scraped.push({
        url,
        shopArtNr: raw.shopArtNr,
        title: raw.title,
        price: raw.price,
        variants,
      });
      products.push(...classifyAndBuild(raw, variants));
      await sleep(200);
    } catch (e) {
      console.error(`  FAIL ${url}`, e instanceof Error ? e.message : e);
    }
  }

  // Deduplicate by product_id (keep first with price)
  const byId = new Map<string, AnyRec>();
  for (const p of products) {
    const id = String(p.product_id);
    const prev = byId.get(id);
    if (!prev) byId.set(id, p);
    else {
      const prevPrice = (prev.bom as AnyRec)?.price_eur;
      const nextPrice = (p.bom as AnyRec)?.price_eur;
      if (prevPrice == null && nextPrice != null) byId.set(id, p);
    }
  }
  const unique = [...byId.values()];

  await fs.writeFile(
    OUT_RAW,
    JSON.stringify({ scraped_at: new Date().toISOString(), scraped, products: unique }, null, 2),
  );
  console.log(`Wrote ${unique.length} cards → ${OUT_RAW}`);

  const universal = JSON.parse(await fs.readFile(UNIVERSAL, "utf8")) as {
    products: AnyRec[];
    [k: string]: unknown;
  };

  // Replace previous run of this importer (IDs can change when dropdown parsing improves)
  const before = universal.products.length;
  universal.products = universal.products.filter(
    (x) =>
      (x.source as AnyRec)?.import_script !== "import-hunter-assortment.ts",
  );
  const removed = before - universal.products.length;

  const existingIds = new Set(universal.products.map((p) => String(p.product_id)));
  let added = 0;
  for (const p of unique) {
    const id = String(p.product_id);
    if (existingIds.has(id)) continue;
    // Prefer importer cards over sparse legacy Hunter stubs with same article
    const art = p.article as string | null;
    if (art) {
      const legacyIdx = universal.products.findIndex(
        (x) =>
          x.article === art &&
          /hunter/i.test(String(x.brand || x.manufacturer || "")),
      );
      if (legacyIdx >= 0) {
        const legacy = universal.products[legacyIdx];
        if (!legacy.connections || !(legacy.connections as unknown[]).length) {
          universal.products[legacyIdx] = p;
          existingIds.add(id);
          existingIds.delete(String(legacy.product_id));
          added += 1;
          continue;
        }
      }
    }
    universal.products.push(p);
    existingIds.add(id);
    added += 1;
  }
  const updated = removed; // reported as replaced count

  await fs.writeFile(UNIVERSAL, JSON.stringify(universal, null, 2) + "\n");
  console.log(
    `Universal: +${added} added, ${removed} prior-import removed, total ${universal.products.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
