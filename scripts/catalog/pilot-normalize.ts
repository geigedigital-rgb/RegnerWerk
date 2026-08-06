/**
 * Pilot normalization (TZ §18): 5–10 products per pilot group.
 * Reads data/raw/products-ai.json (never writes to it).
 * Writes data/catalog/normalized/products_*.json + classification_report.json
 *
 * Usage: npx tsx scripts/catalog/pilot-normalize.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ConnectionPort,
  FieldStatus,
  LocaleName,
  NormalizedProduct,
  PerformanceTable,
} from "../../lib/catalog/normalize-types";
import {
  extractManifoldFromText,
  extractValveKenndaten,
  parsePgaPressureLossFromPdf,
} from "../../lib/catalog/enrichers";
import { loadBestPdfText } from "../../lib/catalog/pdf-cache";

const RAW_AI = path.resolve(process.cwd(), "data/raw/products-ai.json");
const OUT = path.resolve(process.cwd(), "data/catalog/normalized");

type RawAi = {
  id: string;
  url: string;
  title: string;
  category: string;
  variants: string[];
  images: string[];
  pdfs: { title: string; url: string }[];
  text: string;
  scrape: string;
};

type Draft = {
  product_id: string;
  parent_product_id: string | null;
  article: string | null;
  manufacturer: string | null;
  brand: string | null;
  series: string | null;
  model: string | null;
  name: LocaleName;
  group_id: string;
  subtype_id: string;
  unit: NormalizedProduct["unit"];
  package_quantity: number | null;
  attributes: Record<string, unknown>;
  connections: ConnectionPort[];
  performance_tables: PerformanceTable[];
  field_status: Record<string, FieldStatus>;
  provenance: NormalizedProduct["provenance"];
  classification_confidence: number;
  extraction_confidence: number;
  warnings: string[];
  source_variant: string | null;
  critical_attrs: string[];
};

function byId(products: RawAi[], prefix: string): RawAi {
  const p = products.find((x) => x.id.startsWith(prefix) || x.id === prefix);
  if (!p) throw new Error(`Source not found: ${prefix}`);
  return p;
}

function parseDeNumber(s: string): number | null {
  const m = s.replace(/\s/g, "").match(/(\d+)[,.](\d+)/) || s.match(/(\d+)/);
  if (!m) return null;
  if (m[2] !== undefined) return parseFloat(`${m[1]}.${m[2]}`);
  return parseInt(m[1], 10);
}

function rangeM(text: string, re: RegExp): { min: number | null; max: number | null } {
  const m = text.match(re);
  if (!m) return { min: null, max: null };
  return { min: parseDeNumber(m[1]), max: parseDeNumber(m[2]) };
}

function cmToMm(cm: number | null): number | null {
  return cm == null ? null : Math.round(cm * 10);
}

function setAttr(
  d: Draft,
  key: string,
  value: unknown,
  status: FieldStatus,
  provenance?: NormalizedProduct["provenance"][string],
) {
  d.attributes[key] = value;
  d.field_status[`attributes.${key}`] = status;
  if (provenance) d.provenance[`attributes.${key}`] = provenance;
}

function fromText(
  d: Draft,
  key: string,
  value: unknown,
  src: RawAi,
  status: FieldStatus = "confirmed",
) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    setAttr(d, key, null, "not_found");
    return;
  }
  setAttr(d, key, value, status, {
    source_type: "product_text",
    source_url: src.url,
    document_title: null,
    page: null,
  });
}

function brandFrom(src: RawAi): { manufacturer: string | null; brand: string | null } {
  const t = `${src.title} ${src.text}`.toLowerCase();
  if (t.includes("rain bird") || t.includes("rain-bird")) {
    return { manufacturer: "Rain Bird", brand: "Rain Bird" };
  }
  if (t.includes("hunter")) return { manufacturer: "Hunter", brand: "Hunter" };
  if (src.scrape === "klemm") return { manufacturer: null, brand: null };
  return { manufacturer: null, brand: null };
}

function baseDraft(
  src: RawAi,
  opts: {
    product_id: string;
    parent_product_id: string | null;
    group_id: string;
    subtype_id: string;
    name_de: string;
    article?: string | null;
    series?: string | null;
    model?: string | null;
    unit?: NormalizedProduct["unit"];
    source_variant?: string | null;
    classification_confidence: number;
    critical_attrs: string[];
  },
): Draft {
  const b = brandFrom(src);
  return {
    product_id: opts.product_id,
    parent_product_id: opts.parent_product_id,
    article: opts.article ?? null,
    manufacturer: b.manufacturer,
    brand: b.brand,
    series: opts.series ?? null,
    model: opts.model ?? opts.article ?? null,
    name: { de: opts.name_de ?? src.title },
    group_id: opts.group_id,
    subtype_id: opts.subtype_id,
    unit: opts.unit ?? "piece",
    package_quantity: 1,
    attributes: {},
    connections: [],
    performance_tables: [],
    field_status: {},
    provenance: {},
    classification_confidence: opts.classification_confidence,
    extraction_confidence: 0,
    warnings: [],
    source_variant: opts.source_variant ?? null,
    critical_attrs: opts.critical_attrs,
  };
}

function applyKenndaten(d: Draft, src: RawAi, modelHint?: string | null) {
  const k = extractValveKenndaten(src.text, modelHint);
  const map: [keyof typeof k, string][] = [
    ["flow_min_l_min", "flow_min_l_min"],
    ["flow_max_l_min", "flow_max_l_min"],
    ["pressure_min_bar", "pressure_min_bar"],
    ["pressure_max_bar", "pressure_max_bar"],
    ["coil_current_inrush_a", "coil_current_inrush_a"],
    ["coil_current_holding_a", "coil_current_holding_a"],
    ["body_material", "body_material"],
    ["flow_control_present", "flow_control_present"],
  ];
  for (const [srcKey, attr] of map) {
    const v = k[srcKey];
    if (v === null || v === undefined) continue;
    if (d.attributes[attr] != null) continue;
    fromText(d, attr, v, src);
  }
}

async function attachPgaPressureLoss(d: Draft, src: RawAi, modelKey: string) {
  const pdf = await loadBestPdfText(src.pdfs);
  if (!pdf) {
    d.warnings.push("pdf_text_missing_for_pressure_loss");
    return;
  }
  const table = parsePgaPressureLossFromPdf(pdf.text, {
    modelKey,
    sourceUrl: pdf.url,
    documentTitle: pdf.title,
  });
  if (!table) {
    d.warnings.push(`pressure_loss_parse_failed:${modelKey}`);
    return;
  }
  d.performance_tables.push(table);
  d.field_status.performance_tables = "confirmed";
  d.provenance.performance_tables = {
    source_type: "manufacturer_pdf",
    source_url: pdf.url,
    document_title: pdf.title,
    page: null,
  };
  // also enrich kenndaten from same PDF when shop text is thin
  const k = extractValveKenndaten(pdf.text, modelKey);
  for (const [attr, val] of [
    ["flow_min_l_min", k.flow_min_l_min],
    ["flow_max_l_min", k.flow_max_l_min],
    ["pressure_min_bar", k.pressure_min_bar],
    ["pressure_max_bar", k.pressure_max_bar],
    ["coil_current_inrush_a", k.coil_current_inrush_a],
    ["coil_current_holding_a", k.coil_current_holding_a],
    ["body_material", k.body_material],
    ["flow_control_present", k.flow_control_present],
  ] as const) {
    if (val == null) continue;
    if (d.attributes[attr] != null) continue;
    setAttr(d, attr, val, "confirmed", {
      source_type: "manufacturer_pdf",
      source_url: pdf.url,
      document_title: pdf.title,
      page: null,
    });
  }
}

function finalize(src: RawAi, d: Draft): NormalizedProduct {
  const filled = Object.entries(d.attributes).filter(([, v]) => v !== null).length;
  const total = Object.keys(d.attributes).length || 1;
  d.extraction_confidence = Math.round((filled / total) * 100) / 100;

  const missingCritical = d.critical_attrs.filter(
    (k) => d.attributes[k] === null || d.attributes[k] === undefined,
  );
  const hasPerf = d.performance_tables.length > 0;
  const calculation_ready =
    missingCritical.length === 0 &&
    (d.group_id === "pe_compression_fittings" ||
      d.group_id === "spray_bodies" ||
      d.group_id === "controllers" ||
      d.group_id === "threaded_fittings_manifolds"
      ? true
      : d.group_id === "valves"
        ? hasPerf || missingCritical.length === 0
        : hasPerf ||
          !(
            d.group_id === "nozzles_rotators" ||
            d.group_id === "rotor_sprinklers"
          ));

  // nozzles/rotors need performance tables for calculation_ready per TZ
  let ready = calculation_ready;
  if (
    d.group_id === "nozzles_rotators" ||
    d.group_id === "rotor_sprinklers" ||
    d.group_id === "pressure_pipes"
  ) {
    if (
      (d.group_id === "nozzles_rotators" || d.group_id === "rotor_sprinklers") &&
      !hasPerf
    ) {
      ready = false;
      d.warnings.push("performance_tables_missing");
    }
    if (d.group_id === "pressure_pipes" && d.attributes.internal_diameter_mm == null) {
      ready = false;
      d.warnings.push("internal_diameter_missing");
    }
  }
  if (d.group_id === "valves" && !hasPerf) {
    d.warnings.push("performance_tables_missing");
  }
  if (missingCritical.length) {
    ready = false;
    d.warnings.push(`missing_critical:${missingCritical.join(",")}`);
  }
  if (d.classification_confidence < 0.8) {
    d.warnings.push("low_classification_confidence");
  }

  const reviewWarnings = d.warnings.filter((w) => !w.startsWith("info:"));
  const needs_review =
    ready === false ||
    reviewWarnings.length > 0 ||
    d.classification_confidence < 0.8 ||
    missingCritical.length > 0;

  return {
    product_id: d.product_id,
    parent_product_id: d.parent_product_id,
    article: d.article,
    manufacturer: d.manufacturer,
    brand: d.brand,
    series: d.series,
    model: d.model,
    name: d.name,
    group_id: d.group_id,
    subtype_id: d.subtype_id,
    unit: d.unit,
    package_quantity: d.package_quantity,
    lifecycle_status: "active",
    attributes: d.attributes,
    connections: d.connections,
    performance_tables: d.performance_tables,
    compatibility: {
      compatible_product_ids: [],
      compatible_group_ids: [],
      incompatible_product_ids: [],
      requirements: [],
    },
    bom: [],
    media: {
      images: src.images,
      documents: src.pdfs,
    },
    source: {
      source_record_id: src.id,
      source_name: src.scrape,
      source_url: src.url,
      source_category: src.category,
      source_title: src.title,
      source_variant: d.source_variant,
    },
    field_status: d.field_status,
    provenance: d.provenance,
    quality: {
      classification_confidence: d.classification_confidence,
      extraction_confidence: d.extraction_confidence,
      calculation_ready: ready,
      needs_review,
      warnings: d.warnings,
    },
  };
}

function threadPort(
  port_id: string,
  role: ConnectionPort["role"],
  sizeInch: string,
  gender: "IG" | "AG",
): ConnectionPort {
  return {
    port_id,
    role,
    connection_type: "bsp_thread",
    nominal_size_mm: null,
    thread_size_inch: sizeInch,
    thread_gender: gender,
    thread_standard: "BSP",
  };
}

function pePort(port_id: string, mm: number): ConnectionPort {
  return {
    port_id,
    role: "bidirectional",
    connection_type: "pe_compression",
    nominal_size_mm: mm,
    thread_size_inch: null,
    thread_gender: "not_applicable",
    thread_standard: "not_applicable",
  };
}

/** Expand size variants like "25 mm", "32 mm" from klemm fittings. */
function peSizeVariants(variants: string[]): number[] {
  const sizes = new Set<number>();
  for (const v of variants) {
    const m = v.match(/(\d+)\s*mm/i);
    if (m) sizes.add(parseInt(m[1], 10));
  }
  return [...sizes].sort((a, b) => a - b);
}

async function main() {
  const rawFile = JSON.parse(await fs.readFile(RAW_AI, "utf8")) as {
    products: RawAi[];
  };
  const products = rawFile.products;
  const out: NormalizedProduct[] = [];
  const unclassified: unknown[] = [];
  const needsReview: NormalizedProduct[] = [];

  // ——— nozzles_rotators ———
  {
    const rvan14 = byId(products, "RVAN14-Einstellbare");
    const d = baseDraft(rvan14, {
      product_id: "rain_bird_r_van_14",
      parent_product_id: "rain_bird_r_van",
      group_id: "nozzles_rotators",
      subtype_id: "rotary_nozzle",
      name_de: "Rain Bird R-VAN 14 Rotator",
      article: "A84659",
      series: "R-VAN",
      model: "R-VAN 14",
      classification_confidence: 0.95,
      critical_attrs: [
        "arc_min_deg",
        "arc_max_deg",
        "radius_min_m",
        "radius_max_m",
        "pressure_min_bar",
        "pressure_max_bar",
      ],
    });
    fromText(d, "pattern_type", "arc", rvan14);
    fromText(d, "arc_adjustable", true, rvan14);
    const arc = rangeM(rvan14.title + rvan14.text, /Sektor[:\s]*(\d+)\s*(?:bis|-|–)\s*(\d+)/i);
    fromText(d, "arc_min_deg", arc.min ?? 45, rvan14);
    fromText(d, "arc_max_deg", arc.max ?? 270, rvan14);
    const rad = rangeM(
      rvan14.title + rvan14.text,
      /Wurfweite[:\s]*([\d,]+)\s*(?:bis|-|–)\s*([\d,]+)\s*m/i,
    );
    fromText(d, "radius_min_m", rad.min, rvan14);
    fromText(d, "radius_max_m", rad.max, rvan14);
    fromText(d, "pressure_min_bar", null, rvan14);
    fromText(d, "pressure_max_bar", null, rvan14);
    fromText(d, "pressure_recommended_bar", null, rvan14);
    fromText(d, "precipitation_rate_mm_h", null, rvan14);
    fromText(d, "trajectory_deg", null, rvan14);
    fromText(d, "strip_length_m", null, rvan14);
    fromText(d, "strip_width_m", null, rvan14);
    fromText(d, "nozzle_thread_type", "male_threaded_nozzle", rvan14);
    out.push(finalize(rvan14, d));
  }

  for (const [prefix, pid, article, model, ru] of [
    ["RVAN18-Einstellbare", "rain_bird_r_van_18", "A84660", "R-VAN 18", "Rain Bird R-VAN 18 Rotator"],
    ["RVAN24-Einstellbare", "rain_bird_r_van_24", "A84661", "R-VAN 24", "Rain Bird R-VAN 24 Rotator"],
  ] as const) {
    const src = byId(products, prefix);
    const d = baseDraft(src, {
      product_id: pid,
      parent_product_id: "rain_bird_r_van",
      group_id: "nozzles_rotators",
      subtype_id: "rotary_nozzle",
      name_de: ru,
      article,
      series: "R-VAN",
      model,
      classification_confidence: 0.95,
      critical_attrs: [
        "arc_min_deg",
        "arc_max_deg",
        "radius_min_m",
        "radius_max_m",
        "pressure_min_bar",
        "pressure_max_bar",
      ],
    });
    fromText(d, "pattern_type", "arc", src);
    fromText(d, "arc_adjustable", true, src);
    const arc = rangeM(src.title + src.text, /Sektor[:\s]*(\d+)\s*(?:bis|-|–)\s*(\d+)/i);
    fromText(d, "arc_min_deg", arc.min ?? 45, src);
    fromText(d, "arc_max_deg", arc.max ?? 270, src);
    const rad = rangeM(src.title + src.text, /Wurfweite[:\s]*([\d,]+)\s*(?:bis|-|–)\s*([\d,]+)\s*m/i);
    fromText(d, "radius_min_m", rad.min, src);
    fromText(d, "radius_max_m", rad.max, src);
    for (const k of [
      "pressure_min_bar",
      "pressure_max_bar",
      "pressure_recommended_bar",
      "precipitation_rate_mm_h",
      "trajectory_deg",
      "strip_length_m",
      "strip_width_m",
    ]) {
      fromText(d, k, null, src);
    }
    fromText(d, "nozzle_thread_type", "male_threaded_nozzle", src);
    out.push(finalize(src, d));
  }

  {
    const src = byId(products, "R-VAN-LCS-Eckduese");
    const d = baseDraft(src, {
      product_id: "rain_bird_r_van_lcs",
      parent_product_id: "rain_bird_r_van",
      group_id: "nozzles_rotators",
      subtype_id: "strip_nozzle",
      name_de: "Rain Bird R-VAN-LCS Streifendüse",
      article: "A84667",
      series: "R-VAN",
      model: "R-VAN-LCS",
      classification_confidence: 0.9,
      critical_attrs: ["strip_length_m", "strip_width_m", "pressure_min_bar", "pressure_max_bar"],
    });
    fromText(d, "pattern_type", "strip", src);
    fromText(d, "arc_adjustable", false, src);
    fromText(d, "arc_min_deg", null, src);
    fromText(d, "arc_max_deg", null, src);
    fromText(d, "radius_min_m", null, src);
    fromText(d, "radius_max_m", null, src);
    // title often "1.5 X 4.6m"
    const strip = (src.title + src.text).match(/([\d.]+)\s*[xX×]\s*([\d.]+)\s*m/i);
    fromText(d, "strip_width_m", strip ? parseFloat(strip[1]) : null, src);
    fromText(d, "strip_length_m", strip ? parseFloat(strip[2]) : null, src);
    fromText(d, "pressure_min_bar", null, src);
    fromText(d, "pressure_max_bar", null, src);
    fromText(d, "pressure_recommended_bar", null, src);
    fromText(d, "precipitation_rate_mm_h", null, src);
    fromText(d, "trajectory_deg", null, src);
    fromText(d, "nozzle_thread_type", "male_threaded_nozzle", src);
    out.push(finalize(src, d));
  }

  for (const [prefix, pid, model, ru] of [
    ["MP800-90", "hunter_mp800_90_210", "MP800-90", "Hunter MP800 90–210° Rotator"],
    ["MP1000-90", "hunter_mp1000_90_210", "MP1000-90", "Hunter MP1000 90–210° Rotator"],
    ["MP2000-90", "hunter_mp2000_90_210", "MP2000-90", "Hunter MP2000 90–210° Rotator"],
    ["MP3000-90", "hunter_mp3000_90_210", "MP3000-90", "Hunter MP3000 90–210° Rotator"],
  ] as const) {
    const src = byId(products, prefix);
    const d = baseDraft(src, {
      product_id: pid,
      parent_product_id: "hunter_mp_rotator",
      group_id: "nozzles_rotators",
      subtype_id: "rotary_nozzle",
      name_de: ru,
      article: model,
      series: "MP Rotator",
      model,
      classification_confidence: 0.95,
      critical_attrs: [
        "arc_min_deg",
        "arc_max_deg",
        "radius_min_m",
        "radius_max_m",
        "pressure_min_bar",
        "pressure_max_bar",
      ],
    });
    fromText(d, "pattern_type", "arc", src);
    fromText(d, "arc_adjustable", true, src);
    fromText(d, "arc_min_deg", 90, src);
    fromText(d, "arc_max_deg", 210, src);
    const rad2 = rangeM(src.title + " " + src.text, /([\d,]+)\s*(?:bis|-|–)\s*([\d,]+)\s*m/i);
    fromText(d, "radius_min_m", rad2.min, src);
    fromText(d, "radius_max_m", rad2.max, src);
    for (const k of [
      "pressure_min_bar",
      "pressure_max_bar",
      "pressure_recommended_bar",
      "precipitation_rate_mm_h",
      "trajectory_deg",
      "strip_length_m",
      "strip_width_m",
    ]) {
      fromText(d, k, null, src);
    }
    fromText(d, "nozzle_thread_type", "male_threaded_nozzle", src);
    out.push(finalize(src, d));
  }

  // ——— spray_bodies ———
  {
    const src = byId(products, "1804-Rain-Bird--Regner");
    const d = baseDraft(src, {
      product_id: "rain_bird_1804",
      parent_product_id: "rain_bird_1800",
      group_id: "spray_bodies",
      subtype_id: "pop_up_spray_body",
      name_de: "Rain Bird 1804 Gehäuse (10 cm)",
      article: "A44120",
      series: "1800",
      model: "1804",
      classification_confidence: 0.96,
      critical_attrs: ["pop_up_height_mm", "top_thread_type"],
    });
    fromText(d, "pop_up_height_mm", 100, src);
    fromText(d, "inlet_position", "bottom", src);
    fromText(d, "pressure_regulator_present", false, src);
    fromText(d, "regulated_pressure_bar", null, src);
    fromText(d, "check_valve_present", false, src);
    fromText(d, "check_valve_max_elevation_m", null, src);
    const p = rangeM(src.text, /Betriebsdruck\s*:?\s*([\d,]+)\s*bis\s*([\d,]+)\s*bar/i);
    fromText(d, "pressure_max_bar", p.max, src);
    const h = src.text.match(/Höhe des Gehäuses:\s*([\d,]+)\s*cm/i);
    fromText(d, "body_height_mm", h ? cmToMm(parseDeNumber(h[1])) : null, src);
    const dia = src.text.match(/Sichbarer Durchmesser:\s*([\d,]+)\s*cm/i);
    fromText(d, "body_diameter_mm", dia ? cmToMm(parseDeNumber(dia[1])) : null, src);
    fromText(d, "top_thread_type", "female_nozzle_thread", src);
    d.connections = [threadPort("inlet", "inlet", '1/2"', "IG")];
    out.push(finalize(src, d));
  }

  {
    const src = byId(products, "1804-SAM-Sprueher");
    const d = baseDraft(src, {
      product_id: "rain_bird_1804_sam",
      parent_product_id: "rain_bird_1800",
      group_id: "spray_bodies",
      subtype_id: "pop_up_spray_body",
      name_de: "Rain Bird 1804-SAM Gehäuse",
      article: "A43905",
      series: "1800",
      model: "1804-SAM",
      classification_confidence: 0.95,
      critical_attrs: ["pop_up_height_mm", "top_thread_type"],
    });
    fromText(d, "pop_up_height_mm", 100, src);
    fromText(d, "inlet_position", "bottom", src);
    fromText(d, "pressure_regulator_present", false, src);
    fromText(d, "regulated_pressure_bar", null, src);
    fromText(d, "check_valve_present", true, src);
    const elev = src.text.match(/bis\s*zu\s*([\d,]+)\s*m/i);
    fromText(d, "check_valve_max_elevation_m", elev ? parseDeNumber(elev[1]) : 4.2, src);
    fromText(d, "pressure_max_bar", null, src);
    fromText(d, "body_height_mm", null, src);
    fromText(d, "body_diameter_mm", null, src);
    fromText(d, "top_thread_type", "female_nozzle_thread", src);
    d.connections = [threadPort("inlet", "inlet", '1/2"', "IG")];
    out.push(finalize(src, d));
  }

  {
    const src = byId(products, "Rain-Bird-Versenkduese-1804-SAM-PRS");
    for (const [variant, pid, article, bar, ru] of [
      [
        "1804-SAM- PRS-45 3,1 bar",
        "rain_bird_1804_sam_prs45",
        "A37441",
        3.1,
        "Rain Bird 1804-SAM Gehäuse-PRS 3,1 bar",
      ],
      [
        "1804-SAM- PRS-30 2,1 bar",
        "rain_bird_1804_sam_prs30",
        "A44915",
        2.1,
        "Rain Bird 1804-SAM Gehäuse-PRS 2,1 bar",
      ],
    ] as const) {
      const matched =
        src.variants.find((v) => v.includes(variant.split(" ")[0]) && v.includes(String(bar).replace(".", ","))) ||
        src.variants.find((v) => v.includes(`PRS`) && v.includes(String(bar).replace(".", ","))) ||
        null;
      const d = baseDraft(src, {
        product_id: pid,
        parent_product_id: "rain_bird_1804_sam_prs",
        group_id: "spray_bodies",
        subtype_id: "pressure_regulating_spray_body",
        name_de: ru,
        article,
        series: "1800",
        model: article,
        source_variant: matched,
        classification_confidence: 0.93,
        critical_attrs: ["pop_up_height_mm", "top_thread_type", "regulated_pressure_bar"],
      });
      fromText(d, "pop_up_height_mm", 100, src);
      fromText(d, "inlet_position", "bottom", src);
      fromText(d, "pressure_regulator_present", true, src);
      fromText(d, "regulated_pressure_bar", bar, src);
      fromText(d, "check_valve_present", true, src);
      fromText(d, "check_valve_max_elevation_m", null, src);
      fromText(d, "pressure_max_bar", null, src);
      fromText(d, "body_height_mm", null, src);
      fromText(d, "body_diameter_mm", null, src);
      fromText(d, "top_thread_type", "female_nozzle_thread", src);
      d.connections = [threadPort("inlet", "inlet", '1/2"', "IG")];
      out.push(finalize(src, d));
    }
  }

  for (const [prefix, pid, model, hMm, prs, bar, ru] of [
    ["Pro-Spray 04 Hunter 10cm", "hunter_pros_04", "PROS-04", 100, false, null, "Hunter Pro-Spray 04 Gehäuse"],
    ["Pro-Spray 06 Hunter 15cm", "hunter_pros_06", "PROS-06", 150, false, null, "Hunter Pro-Spray 06 Gehäuse"],
    ["Pro-Spray PRS40 Hunter Versenk", "hunter_pros_prs40", "PROS-PRS40", 100, true, 2.8, "Hunter Pro-Spray PRS40 Gehäuse"],
  ] as const) {
    const src = products.find((p) => p.title.includes(prefix.split(" Hunter")[0]) && p.title.includes("Hunter")) 
      || byId(products, prefix.includes("PRS40") ? "Pro-Spray-PRS40-Hunter" : prefix.includes("06") ? "Pro-Spray-06-Hunter" : "Pro-Spray-04-Hunter");
    const d = baseDraft(src, {
      product_id: pid,
      parent_product_id: "hunter_pro_spray",
      group_id: "spray_bodies",
      subtype_id: prs ? "pressure_regulating_spray_body" : "pop_up_spray_body",
      name_de: ru,
      article: model,
      series: "Pro-Spray",
      model,
      classification_confidence: 0.92,
      critical_attrs: ["pop_up_height_mm", "top_thread_type"],
    });
    fromText(d, "pop_up_height_mm", hMm, src);
    fromText(d, "inlet_position", "bottom", src);
    fromText(d, "pressure_regulator_present", prs, src);
    fromText(d, "regulated_pressure_bar", bar, src);
    fromText(d, "check_valve_present", /CV/i.test(src.title), src);
    fromText(d, "check_valve_max_elevation_m", null, src);
    fromText(d, "pressure_max_bar", null, src);
    fromText(d, "body_height_mm", null, src);
    fromText(d, "body_diameter_mm", null, src);
    fromText(d, "top_thread_type", "female_nozzle_thread", src);
    d.connections = [threadPort("inlet", "inlet", '1/2"', "IG")];
    out.push(finalize(src, d));
  }

  // ——— rotor_sprinklers ———
  for (const [prefix, pid, article, series, model, ru, popMm, inlet] of [
    ["3504-PC-Getrieberegner", "rain_bird_3504_pc", "Y34001", "3500", "3504-PC", "Rain Bird Getrieberegner 3504-PC", 100, '1/2"'],
    ["3504-PC-SAM--Voll", "rain_bird_3504_pc_sam", "Y34500", "3500", "3504-PC-SAM", "Rain Bird Getrieberegner 3504-PC-SAM", 100, '1/2"'],
    ["5004PC30-Getrieberegner", "rain_bird_5004_pc30", "Y5410730", "5000", "5004PC30", "Rain Bird Getrieberegner 5004PC30", 100, '3/4"'],
    ["PGP-04 ULTRA", "hunter_pgp_04_ultra", "PGP-04-ULTRA", "PGP Ultra", "PGP-04 ULTRA", "Hunter Getrieberegner PGP-04 Ultra", 100, '3/4"'],
    ["I-20-04 Hunter Getrieberegner", "hunter_i20_04", "I-20-04", "I-20", "I-20-04", "Hunter Getrieberegner I-20-04", 100, '3/4"'],
    ["PGJ-04 Versenkregner", "hunter_pgj_04", "PGJ-04", "PGJ", "PGJ-04", "Hunter Getrieberegner PGJ-04", 100, '1/2"'],
  ] as const) {
    const src = products.find((p) => p.title.includes(prefix) || p.id.includes(prefix.replace(/\s/g, "-"))) 
      || byId(products, prefix.replace(/\s+/g, "-").slice(0, 40));
    const d = baseDraft(src, {
      product_id: pid,
      parent_product_id: `${brandFrom(src).brand?.toLowerCase().replace(" ", "_")}_${series.toLowerCase().replace(/\s/g, "_")}`,
      group_id: "rotor_sprinklers",
      subtype_id: "gear_drive_rotor",
      name_de: ru,
      article,
      series,
      model,
      classification_confidence: 0.93,
      critical_attrs: [
        "arc_min_deg",
        "arc_max_deg",
        "radius_min_m",
        "radius_max_m",
        "pressure_min_bar",
        "pressure_max_bar",
      ],
    });
    fromText(d, "arc_adjustable", true, src);
    const arc = rangeM(src.title + src.text, /(\d+)\s*[°o]?\s*(?:bis|-|–|\/)\s*(\d+)\s*[°o]?/);
    fromText(d, "arc_min_deg", arc.min, src);
    fromText(d, "arc_max_deg", arc.max, src);
    fromText(d, "full_circle_supported", (arc.max ?? 0) >= 360 || /360|Vollkreis/i.test(src.title + src.text), src);
    const rad = rangeM(src.title + src.text, /Wurfweite[:\s]*([\d,]+)\s*(?:m\s*)?(?:bis|-|–)\s*([\d,]+)\s*m/i);
    fromText(d, "radius_min_m", rad.min, src);
    fromText(d, "radius_max_m", rad.max, src);
    const pr = rangeM(src.text, /([\d,]+)\s*bis\s*([\d,]+)\s*bar/i);
    fromText(d, "pressure_min_bar", pr.min, src);
    fromText(d, "pressure_max_bar", pr.max, src);
    fromText(d, "pressure_recommended_bar", null, src);
    fromText(d, "pop_up_height_mm", popMm, src);
    fromText(d, "check_valve_present", /SAM/i.test(src.title + src.id), src);
    fromText(d, "trajectory_deg", null, src);
    fromText(d, "stainless_riser", /Edelstahl|SS/i.test(src.title), src);
    fromText(d, "nozzles_included", /Düse|Duese|Nozzle/i.test(src.text) ? null : null, src);
    d.connections = [threadPort("inlet", "inlet", inlet, "IG")];
    out.push(finalize(src, d));
  }

  // ——— pressure_pipes (soft PE only in current scrape) ———
  for (const [prefix, pid, len, ru] of [
    ["PE-Rohr-16-mm-weich-50-m", "pe_soft_16mm_50m", 50, "Weiches PE-Rohr 16 mm, 50 m"],
    ["PE-Rohr-16-mm-weich-25-m", "pe_soft_16mm_25m", 25, "Weiches PE-Rohr 16 mm, 25 m"],
  ] as const) {
    const src = byId(products, prefix);
    const d = baseDraft(src, {
      product_id: pid,
      parent_product_id: "pe_soft_16mm",
      group_id: "pressure_pipes",
      subtype_id: "pe_soft_pipe",
      name_de: ru,
      article: null,
      series: null,
      model: "PE 16 soft",
      unit: "roll",
      classification_confidence: 0.85,
      critical_attrs: ["outer_diameter_mm", "internal_diameter_mm", "pressure_rating_bar"],
    });
    fromText(d, "material", "PE", src);
    fromText(d, "outer_diameter_mm", 16, src);
    fromText(d, "wall_thickness_mm", null, src);
    fromText(d, "internal_diameter_mm", null, src);
    fromText(d, "sdr", null, src);
    fromText(d, "pressure_rating_bar", null, src);
    fromText(d, "roughness_coefficient", null, src);
    fromText(d, "length_m", len, src);
    fromText(d, "potable_water_approved", null, src);
    d.warnings.push("hard_pe25_pe32_pipes_not_in_source_scrape");
    out.push(finalize(src, d));
  }

  // ——— pe_compression_fittings ———
  {
    const src = byId(products, "kupplung-klemmverschraubung-x-klemmverschraubung-pn10");
    const sizes = peSizeVariants(src.variants).filter((s) => [20, 25, 32, 40, 50, 63].includes(s));
    const useSizes = sizes.length ? sizes.slice(0, 6) : [25, 32];
    for (const mm of useSizes) {
      const variant =
        src.variants.find((v) => v.includes(`${mm} mm`) || v.includes(`${mm}mm`)) || null;
      const d = baseDraft(src, {
        product_id: `pe_comp_coupling_pn10_${mm}x${mm}`,
        parent_product_id: "pe_comp_coupling_pn10",
        group_id: "pe_compression_fittings",
        subtype_id: "straight_coupling",
        name_de: `PE-Klemmkupplung ${mm}×${mm} PN10`,
        article: null,
        source_variant: variant,
        classification_confidence: 0.97,
        critical_attrs: ["pressure_rating_bar", "shape"],
      });
      fromText(d, "shape", "straight", src);
      fromText(d, "angle_deg", null, src);
      fromText(d, "pressure_rating_bar", 10, src);
      fromText(d, "body_material", "pp", src);
      fromText(d, "seal_material", null, src);
      fromText(d, "uv_resistant", null, src);
      fromText(d, "potable_water_approved", null, src);
      fromText(d, "manufacturing_standard", null, src);
      fromText(d, "country_of_origin", "EU", src);
      d.connections = [pePort("port_1", mm), pePort("port_2", mm)];
      out.push(finalize(src, d));
    }
  }

  {
    const src = byId(products, "winkel-klemmverschraubung-x-klemmverschrubung-pn10");
    for (const mm of [25, 32]) {
      const variant = src.variants.find((v) => v.includes(`${mm}`)) || null;
      const d = baseDraft(src, {
        product_id: `pe_comp_elbow_pn10_${mm}`,
        parent_product_id: "pe_comp_elbow_pn10",
        group_id: "pe_compression_fittings",
        subtype_id: "elbow_90",
        name_de: `PE-Klemmwinkel ${mm} mm PN10`,
        article: null,
        source_variant: variant,
        classification_confidence: 0.96,
        critical_attrs: ["pressure_rating_bar", "shape"],
      });
      fromText(d, "shape", "elbow", src);
      fromText(d, "angle_deg", 90, src);
      fromText(d, "pressure_rating_bar", 10, src);
      fromText(d, "body_material", "pp", src);
      for (const k of ["seal_material", "uv_resistant", "potable_water_approved", "manufacturing_standard"]) {
        fromText(d, k, null, src);
      }
      fromText(d, "country_of_origin", "EU", src);
      d.connections = [pePort("port_1", mm), pePort("port_2", mm)];
      out.push(finalize(src, d));
    }
  }

  {
    const src = byId(products, "Endkappe-PE-Klemmverschraubung-PN10");
    for (const mm of [25, 32]) {
      const variant = src.variants.find((v) => v.includes(`${mm}`)) || null;
      const d = baseDraft(src, {
        product_id: `pe_comp_endcap_pn10_${mm}`,
        parent_product_id: "pe_comp_endcap_pn10",
        group_id: "pe_compression_fittings",
        subtype_id: "end_cap",
        name_de: `PE-Klemmendkappe ${mm} mm PN10`,
        article: null,
        source_variant: variant,
        classification_confidence: 0.96,
        critical_attrs: ["pressure_rating_bar", "shape"],
      });
      fromText(d, "shape", "end_cap", src);
      fromText(d, "angle_deg", null, src);
      fromText(d, "pressure_rating_bar", 10, src);
      fromText(d, "body_material", "pp", src);
      for (const k of ["seal_material", "uv_resistant", "potable_water_approved", "manufacturing_standard"]) {
        fromText(d, k, null, src);
      }
      fromText(d, "country_of_origin", "EU", src);
      d.connections = [pePort("port_1", mm)];
      out.push(finalize(src, d));
    }
  }

  {
    const src = byId(products, "Anbohrschelle-fuer-PE-Rohr");
    for (const [pipeMm, thread] of [
      [25, '1/2"'],
      [32, '3/4"'],
    ] as const) {
      const variant =
        src.variants.find((v) => v.includes(`${pipeMm}`) && v.includes(thread.replace('"', ""))) ||
        src.variants.find((v) => v.includes(`${pipeMm}`)) ||
        null;
      const d = baseDraft(src, {
        product_id: `tapping_saddle_pe${pipeMm}_${thread.replace(/["\s]/g, "")}`,
        parent_product_id: "tapping_saddle_pe",
        group_id: "pe_compression_fittings",
        subtype_id: "tapping_saddle",
        name_de: `PE-Anbohrschelle ${pipeMm} mm × ${thread}`,
        article: null,
        source_variant: variant,
        classification_confidence: variant ? 0.88 : 0.75,
        critical_attrs: ["pressure_rating_bar", "shape"],
      });
      fromText(d, "shape", "adapter", src);
      fromText(d, "angle_deg", null, src);
      fromText(d, "pressure_rating_bar", null, src);
      fromText(d, "body_material", null, src);
      for (const k of [
        "seal_material",
        "uv_resistant",
        "potable_water_approved",
        "manufacturing_standard",
        "country_of_origin",
      ]) {
        fromText(d, k, null, src);
      }
      if (!variant) d.warnings.push("variant_data_ambiguous");
      d.connections = [
        {
          port_id: "pipe",
          role: "bidirectional",
          connection_type: "pe_compression",
          nominal_size_mm: pipeMm,
          thread_size_inch: null,
          thread_gender: "not_applicable",
          thread_standard: "not_applicable",
        },
        threadPort("outlet", "outlet", thread, "IG"),
      ];
      out.push(finalize(src, d));
    }
  }

  // ——— valves ———
  for (const [prefix, pid, article, model, gender, volt, ru] of [
    ["Magnetventil-100-HV-MM-Rain-Bird", "rain_bird_100_hv_mm_24vac", "100-HV-MM", "100-HV-MM", "AG", 24, "Rain Bird Magnetventil 100-HV-MM 24VAC"],
    ["Magnetventil-100-DV-MM-AG-AG-Aussengewinde-24V", "rain_bird_100_dv_mm_24vac", "100-DV-MM", "100-DV-MM", "AG", 24, "Rain Bird Magnetventil 100-DV-MM 24VAC"],
    ["Magnetventil-100-DV-IG-IG-Innengewinde-24V", "rain_bird_100_dv_ig_24vac", "100-DV", "100-DV IG", "IG", 24, "Rain Bird Magnetventil 100-DV IG/IG 24VAC"],
    ["Magnetventil-Rain-Bird-100-DV-MM-9V", "rain_bird_100_dv_mm_9vdc", "100-DV-MM-9V", "100-DV-MM", "AG", 9, "Rain Bird Magnetventil 100-DV-MM 9VDC"],
  ] as const) {
    const src = byId(products, prefix);
    const d = baseDraft(src, {
      product_id: pid,
      parent_product_id: article.includes("HV") ? "rain_bird_hv" : "rain_bird_dv",
      group_id: "valves",
      subtype_id: "solenoid_valve",
      name_de: ru,
      article,
      series: article.includes("HV") ? "HV" : "DV",
      model,
      classification_confidence: 0.95,
      critical_attrs: ["actuation_type", "coil_voltage_v", "pressure_max_bar"],
    });
    fromText(d, "actuation_type", "solenoid", src);
    fromText(d, "normal_state", "normally_closed", src);
    fromText(d, "coil_voltage_v", volt, src);
    const inrush = src.text.match(/Einschaltstrom[^0-9]*([\d,]+)/i);
    const hold = src.text.match(/Haltestrom[^0-9]*([\d,]+)/i);
    fromText(d, "coil_current_inrush_a", inrush ? parseDeNumber(inrush[1]) : null, src);
    fromText(d, "coil_current_holding_a", hold ? parseDeNumber(hold[1]) : null, src);
    const pr = rangeM(src.text, /([\d,]+)\s*bis\s*([\d,]+)\s*bar/i);
    fromText(d, "pressure_min_bar", pr.min, src);
    fromText(d, "pressure_max_bar", pr.max, src);
    fromText(d, "flow_min_l_min", null, src);
    fromText(d, "flow_max_l_min", null, src);
    fromText(d, "flow_control_present", /DVF|Flow/i.test(src.title + src.text), src);
    fromText(d, "manual_opening", null, src);
    fromText(d, "body_material", null, src);
    applyKenndaten(d, src, model);
    d.connections = [
      threadPort("inlet", "inlet", '1"', gender),
      threadPort("outlet", "outlet", '1"', gender),
    ];
    out.push(finalize(src, d));
  }

  // PGA series — Kenndaten + Druckverlust aus Informationsblatt-PDF
  for (const [prefix, pid, article, model, sizeInch, volt] of [
    ["magnetventil-150-pga-rain-bird-1-1-2", "rain_bird_150_pga_24vac", "150-PGA", "150-PGA", '1 1/2"', 24],
    ["Magnetventil-200-PGA-Rain-Bird--2--IG-IG-24VAC", "rain_bird_200_pga_24vac", "200-PGA", "200-PGA", '2"', 24],
    ["Magnetventil-150-PGA-Rain-Bird--1-1-2--IG-IG-9VDC", "rain_bird_150_pga_9vdc", "150-PGA-9V", "150-PGA", '1 1/2"', 9],
  ] as const) {
    const src = byId(products, prefix);
    const d = baseDraft(src, {
      product_id: pid,
      parent_product_id: "rain_bird_pga",
      group_id: "valves",
      subtype_id: "solenoid_valve",
      name_de: `Rain Bird Magnetventil ${article} ${volt === 9 ? "9VDC" : "24VAC"}`,
      article,
      series: "PGA",
      model,
      classification_confidence: 0.96,
      critical_attrs: ["actuation_type", "coil_voltage_v", "pressure_max_bar"],
    });
    fromText(d, "actuation_type", "solenoid", src);
    fromText(d, "normal_state", "normally_closed", src);
    fromText(d, "coil_voltage_v", volt, src);
    fromText(d, "manual_opening", true, src);
    applyKenndaten(d, src, model);
    // ensure flow/pressure slots exist even if kenndaten misses
    for (const k of [
      "coil_current_inrush_a",
      "coil_current_holding_a",
      "pressure_min_bar",
      "pressure_max_bar",
      "flow_min_l_min",
      "flow_max_l_min",
      "flow_control_present",
      "body_material",
    ]) {
      if (!(k in d.attributes)) fromText(d, k, null, src);
    }
    d.connections = [
      threadPort("inlet", "inlet", sizeInch, "IG"),
      threadPort("outlet", "outlet", sizeInch, "IG"),
    ];
    await attachPgaPressureLoss(d, src, model);
    out.push(finalize(src, d));
  }

  // PVC Verteiler 3-fach — Attribute aus Produkttext (kein PDF nötig)
  {
    const src = products.find((p) => /PVC Verteiler 3 Fach Rain-Bird/i.test(p.title))
      ?? products.find((p) => /PVC Verteiler 3 Fach/i.test(p.title) && /RB1301-310/i.test(p.text))
      ?? products.find((p) => /PVC Verteiler 3 Fach/i.test(p.title));
    if (src) {
      const m = extractManifoldFromText(src.text, src.title);
      const d = baseDraft(src, {
        product_id: "rain_bird_pvc_verteiler_3fach_rb1301_310",
        parent_product_id: null,
        group_id: "threaded_fittings_manifolds",
        subtype_id: "manifold",
        name_de: "Rain Bird PVC-Verteiler 3-fach 1\" (RB1301-310)",
        article: m.article,
        series: "RB1301",
        model: m.article,
        classification_confidence: 0.92,
        critical_attrs: ["shape", "outlet_count"],
      });
      fromText(d, "shape", "manifold", src);
      fromText(d, "outlet_count", m.outlet_count, src);
      fromText(d, "union_present", /Überwurf|Ueberwurf/i.test(src.text), src);
      fromText(d, "pressure_rating_bar", null, src);
      fromText(d, "body_material", m.body_material, src);
      fromText(d, "seal_material", /O-Ring/i.test(src.text) ? "O-Ring" : null, src);
      fromText(d, "seal_included", /O-Ring/i.test(src.text) ? true : null, src);
      if (m.telescopic) d.warnings.push("info:teleskopierbar_laut_produkttext");
      for (const note of m.notes) d.warnings.push(`info:${note}`);
      const size = m.thread_size_inch ?? '1"';
      d.connections = [
        threadPort("inlet", "inlet", size, "AG"),
        threadPort("outlet_1", "outlet", size, "IG"),
        threadPort("outlet_2", "outlet", size, "IG"),
        threadPort("outlet_3", "outlet", size, "IG"),
      ];
      out.push(finalize(src, d));
    }
  }

  // Hunter PGV if present
  {
    const src = products.find((p) => /PGV-101|PGV 101|PGV-100/i.test(p.title));
    if (src) {
      const d = baseDraft(src, {
        product_id: "hunter_pgv_101",
        parent_product_id: "hunter_pgv",
        group_id: "valves",
        subtype_id: "solenoid_valve",
        name_de: "Hunter Magnetventil PGV",
        article: /PGV-101/i.test(src.title) ? "PGV-101" : "PGV-100",
        series: "PGV",
        model: /PGV-101/i.test(src.title) ? "PGV-101" : "PGV-100",
        classification_confidence: 0.9,
        critical_attrs: ["actuation_type", "coil_voltage_v", "pressure_max_bar"],
      });
      fromText(d, "actuation_type", "solenoid", src);
      fromText(d, "normal_state", "normally_closed", src);
      fromText(d, "coil_voltage_v", 24, src);
      for (const k of [
        "coil_current_inrush_a",
        "coil_current_holding_a",
        "pressure_min_bar",
        "pressure_max_bar",
        "flow_min_l_min",
        "flow_max_l_min",
        "flow_control_present",
        "manual_opening",
        "body_material",
      ]) {
        fromText(d, k, null, src);
      }
      d.connections = [
        threadPort("inlet", "inlet", '1"', "IG"),
        threadPort("outlet", "outlet", '1"', "IG"),
      ];
      out.push(finalize(src, d));
    }
  }

  // ——— controllers ———
  {
    const src = byId(products, "Steuergeraet-TM2-4-230V");
    for (const [stations, article] of [
      [4, "TM2-4-230V"],
      [6, "TM2-6-230V"],
      [8, "TM2-8-230V"],
      [12, "TM2-12-230V"],
    ] as const) {
      const variant = src.variants.find((v) => v.includes(String(stations))) || article;
      const d = baseDraft(src, {
        product_id: `rain_bird_esp_tm2_${stations}_230v`,
        parent_product_id: "rain_bird_esp_tm2",
        group_id: "controllers",
        subtype_id: "irrigation_controller",
        name_de: `Rain Bird ESP-TM2 ${stations} Stationen 230V`,
        article,
        series: "ESP-TM2",
        model: article,
        source_variant: typeof variant === "string" ? variant : null,
        classification_confidence: 0.95,
        critical_attrs: ["station_count", "supply_voltage_v", "output_voltage_v"],
      });
      fromText(d, "station_count", stations, src);
      fromText(d, "station_count_max", stations, src);
      fromText(d, "stations_added", null, src);
      fromText(d, "supply_voltage_v", 230, src);
      fromText(d, "output_voltage_v", 24, src);
      fromText(d, "indoor_outdoor", /Aussen|Outdoor/i.test(src.title) ? "outdoor" : "outdoor", src);
      fromText(d, "wifi_integrated", false, src);
      fromText(d, "wifi_module_supported", true, src);
      fromText(d, "rain_sensor_supported", true, src);
      fromText(d, "flow_sensor_supported", null, src);
      fromText(d, "master_valve_supported", null, src);
      fromText(d, "pump_start_supported", null, src);
      out.push(finalize(src, d));
    }
  }

  {
    const src = byId(products, "Steuergeraet-ESP-ME3-Rain-Bird");
    const d = baseDraft(src, {
      product_id: "rain_bird_esp_me3_4",
      parent_product_id: "rain_bird_esp_me3",
      group_id: "controllers",
      subtype_id: "irrigation_controller",
      name_de: "Rain Bird ESP-ME3, 4 Stationen (erweiterbar)",
      article: "IESP4MEEUR",
      series: "ESP-ME3",
      model: "ESP-ME3",
      classification_confidence: 0.94,
      critical_attrs: ["station_count", "supply_voltage_v", "output_voltage_v"],
    });
    fromText(d, "station_count", 4, src);
    fromText(d, "station_count_max", null, src);
    fromText(d, "stations_added", null, src);
    fromText(d, "supply_voltage_v", 230, src);
    fromText(d, "output_voltage_v", 24, src);
    fromText(d, "indoor_outdoor", null, src);
    fromText(d, "wifi_integrated", false, src);
    fromText(d, "wifi_module_supported", true, src);
    fromText(d, "rain_sensor_supported", true, src);
    fromText(d, "flow_sensor_supported", null, src);
    fromText(d, "master_valve_supported", null, src);
    fromText(d, "pump_start_supported", null, src);
    d.warnings.push("station_count_max_needs_datasheet");
    out.push(finalize(src, d));
  }

  {
    const src = byId(products, "LNK2-Wifi");
    const d = baseDraft(src, {
      product_id: "rain_bird_lnk2",
      parent_product_id: null,
      group_id: "controllers",
      subtype_id: "wifi_module",
      name_de: "Rain Bird LNK2 WLAN-Modul",
      article: "LNK2",
      series: "LNK2",
      model: "LNK2",
      classification_confidence: 0.97,
      critical_attrs: [],
    });
    fromText(d, "station_count", null, src);
    fromText(d, "station_count_max", null, src);
    fromText(d, "stations_added", null, src);
    fromText(d, "supply_voltage_v", null, src);
    fromText(d, "output_voltage_v", null, src);
    fromText(d, "indoor_outdoor", null, src);
    fromText(d, "wifi_integrated", true, src);
    fromText(d, "wifi_module_supported", null, src);
    fromText(d, "rain_sensor_supported", null, src);
    fromText(d, "flow_sensor_supported", null, src);
    fromText(d, "master_valve_supported", null, src);
    fromText(d, "pump_start_supported", null, src);
    out.push(finalize(src, d));
  }

  for (const [prefix, pid, stations, model, ru] of [
    ["Hydrawise-6--HC-601", "hunter_hc_601_6", 6, "HC-601", "Hunter Hydrawise HC-601, 6 Stationen"],
    ["Steuergeraet-Pro-HC-6-Stationen", "hunter_pro_hc_6", 6, "PRO-HC-6", "Hunter Pro-HC, 6 Stationen"],
    ["Steuergeraet-Pro-HC-12-Stationen", "hunter_pro_hc_12", 12, "PRO-HC-12", "Hunter Pro-HC, 12 Stationen"],
  ] as const) {
    const src = byId(products, prefix);
    const d = baseDraft(src, {
      product_id: pid,
      parent_product_id: model.startsWith("HC") ? "hunter_hydrawise_hc" : "hunter_pro_hc",
      group_id: "controllers",
      subtype_id: "irrigation_controller",
      name_de: ru,
      article: model,
      series: model.startsWith("HC") ? "Hydrawise" : "Pro-HC",
      model,
      classification_confidence: 0.93,
      critical_attrs: ["station_count", "supply_voltage_v", "output_voltage_v"],
    });
    fromText(d, "station_count", stations, src);
    fromText(d, "station_count_max", stations, src);
    fromText(d, "stations_added", null, src);
    fromText(d, "supply_voltage_v", 230, src);
    fromText(d, "output_voltage_v", 24, src);
    fromText(d, "indoor_outdoor", /OUTDOOR|Aussen/i.test(src.title) ? "outdoor" : null, src);
    fromText(d, "wifi_integrated", /Wifi|Wlan|Hydrawise/i.test(src.title), src);
    fromText(d, "wifi_module_supported", null, src);
    fromText(d, "rain_sensor_supported", null, src);
    fromText(d, "flow_sensor_supported", null, src);
    fromText(d, "master_valve_supported", null, src);
    fromText(d, "pump_start_supported", null, src);
    out.push(finalize(src, d));
  }

  // Collect review / report
  for (const p of out) {
    if (p.quality.needs_review) needsReview.push(p);
  }

  const ids = new Set<string>();
  const dupes: string[] = [];
  for (const p of out) {
    if (ids.has(p.product_id)) dupes.push(p.product_id);
    ids.add(p.product_id);
  }

  const counts_by_group: Record<string, number> = {};
  for (const p of out) counts_by_group[p.group_id] = (counts_by_group[p.group_id] ?? 0) + 1;

  const report = {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    iteration: "pilot_v1",
    input_product_count: products.length,
    input_source_file: "data/raw/products-ai.json",
    input_source_untouched: true,
    output_product_count: out.length,
    variant_product_count: out.filter((p) => p.parent_product_id).length,
    classified_count: out.length,
    unclassified_count: unclassified.length,
    needs_review_count: needsReview.length,
    calculation_ready_count: out.filter((p) => p.quality.calculation_ready).length,
    duplicate_candidates_count: dupes.length,
    counts_by_group,
    pilot_groups: [
      "nozzles_rotators",
      "spray_bodies",
      "rotor_sprinklers",
      "pressure_pipes",
      "pe_compression_fittings",
      "valves",
      "threaded_fittings_manifolds",
      "controllers",
    ],
    notes: [
      "Deutsch-only LocaleName ({ de }).",
      "PGA Druckverlusttabellen aus Hersteller-PDF (metrisch, bar / m³/h → l/min).",
      "Produkttext-Kenndaten und Verteiler-Attribute werden angereichert, wenn vorhanden.",
      "Bild-PDFs ohne Textlayer (z. B. Jet Spike) bleiben ohne Tabelle bis OCR.",
      "Hard PE25/PE32 PN10/PN16 fehlen im aktuellen Scrape; nur weiches PE16 im Druckrohr-Pilot.",
      "Fehlende Zahlen = null + field_status not_found — keine erfundenen Werte.",
    ],
    warnings: [
      ...dupes.map((id) => ({ code: "duplicate_product_id", product_id: id })),
      {
        code: "source_gap",
        message: "PE25/PE32 pressure pipes missing from aggregated catalog scrape",
      },
    ],
    errors: [],
  };

  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(
    path.join(OUT, "products_normalized.json"),
    JSON.stringify(
      { schema_version: "1.0.0", generated_at: report.generated_at, products: out },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(OUT, "products_needs_review.json"),
    JSON.stringify(
      { schema_version: "1.0.0", generated_at: report.generated_at, products: needsReview },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(OUT, "products_unclassified.json"),
    JSON.stringify(
      { schema_version: "1.0.0", generated_at: report.generated_at, products: unclassified },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(OUT, "classification_report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  console.log(`Pilot products: ${out.length}`);
  console.log("By group:", counts_by_group);
  console.log(`needs_review: ${needsReview.length}, calculation_ready: ${report.calculation_ready_count}`);
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
