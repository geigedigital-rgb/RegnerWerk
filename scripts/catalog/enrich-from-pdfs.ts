/**
 * Match product PDFs → extract metrics → fill attributes / performance_tables.
 * Reads/writes data/catalog/normalized/products_normalized.json
 * Does NOT touch data/raw/products-ai.json
 *
 * Usage: npx tsx scripts/catalog/enrich-from-pdfs.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  FieldStatus,
  NormalizedProduct,
  PerformanceTable,
} from "../../lib/catalog/normalize-types";
import {
  extractDripSpecs,
  extractFilterPrvSpecs,
  extractHvDvOperatingRange,
  extractMpRotatorSpecs,
  extractPePipeSpecs,
  extractRotorKenndaten,
  extractShopSprinklerKenndaten,
  extractValveBoxSpecs,
  extractValveKenndaten,
  parse3500LeistungsdatenFromPdf,
  parsePgaPressureLossFromPdf,
  parsePgpLeistungsdatenFromPdf,
  parseRvanPerformanceFromPdf,
  summarizeRadiusFlowTable,
} from "../../lib/catalog/enrichers";
import { loadPdfTextByUrl, type CachedPdfText } from "../../lib/catalog/pdf-cache";

const OUT = path.resolve("data/catalog/normalized");
const PRODUCTS_FILE = path.join(OUT, "products_normalized.json");
const REPORT_FILE = path.join(OUT, "enrichment_report.json");
const AI_FILE = path.resolve("data/raw/products-ai.json");

type AiProduct = { id: string; title: string; text: string; pdfs?: { url: string; title: string }[] };

let aiById = new Map<string, AiProduct>();

async function loadAiIndex() {
  const raw = JSON.parse(await fs.readFile(AI_FILE, "utf8")) as { products: AiProduct[] };
  aiById = new Map(raw.products.map((p) => [p.id, p]));
}

function shopText(p: NormalizedProduct): string {
  const ai = aiById.get(p.source.source_record_id);
  const parts = [p.source.source_title, p.name?.de, p.model, ai?.title, ai?.text].filter(Boolean);
  return parts.join("\n");
}

type FileShape = {
  schema_version: string;
  generated_at: string;
  products: NormalizedProduct[];
};

type Touch = {
  product_id: string;
  attrs_filled: string[];
  tables_added: string[];
  pdf_used: string | null;
  notes: string[];
};

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined;
}

function fillAttr(
  p: NormalizedProduct,
  key: string,
  value: unknown,
  pdf: CachedPdfText | null,
  touch: Touch,
) {
  if (value === null || value === undefined || Number.isNaN(value)) return;
  if (!isEmpty(p.attributes[key])) return;
  p.attributes[key] = value;
  p.field_status[`attributes.${key}`] = "confirmed" satisfies FieldStatus;
  p.provenance[`attributes.${key}`] = {
    source_type: pdf ? "manufacturer_pdf" : "product_text",
    source_url: pdf?.url ?? p.source.source_url,
    document_title: pdf?.title ?? null,
    page: null,
  };
  touch.attrs_filled.push(key);
}

function addTable(p: NormalizedProduct, table: PerformanceTable, touch: Touch) {
  if (p.performance_tables.some((t) => t.table_id === table.table_id)) return;
  p.performance_tables.push(table);
  p.field_status.performance_tables = "confirmed";
  p.provenance.performance_tables = {
    source_type: table.provenance.source_type,
    source_url: table.provenance.source_url,
    document_title: table.provenance.document_title,
    page: table.provenance.page,
  };
  touch.tables_added.push(table.table_id);
}

function rvanModelKey(p: NormalizedProduct): string | null {
  const m = (p.model || p.article || "").toUpperCase().replace(/\s+/g, "");
  if (/R-?VAN-?LCS/i.test(m) || /LCS/i.test(p.product_id)) return "R-VAN-LCS";
  if (/R-?VAN-?RCS/i.test(m)) return "R-VAN-RCS";
  if (/R-?VAN-?SST/i.test(m)) return "R-VAN-SST";
  if (/R-?VAN.?14/i.test(m) || /r_van_14/i.test(p.product_id)) return "R-VAN14";
  if (/R-?VAN.?18/i.test(m) || /r_van_18/i.test(p.product_id)) return "R-VAN18";
  if (/R-?VAN.?24/i.test(m) || /r_van_24/i.test(p.product_id)) return "R-VAN24";
  return null;
}

function mpModelKey(p: NormalizedProduct): string | null {
  const blob = `${p.model} ${p.article} ${p.product_id}`.toUpperCase();
  const m = blob.match(/\b(MP\d{3,4})\b/);
  return m ? m[1] : null;
}

function pgaModelKey(p: NormalizedProduct): string | null {
  const blob = `${p.model} ${p.article} ${p.product_id}`.toUpperCase();
  if (/150.?PGA/.test(blob)) return "150-PGA";
  if (/200.?PGA/.test(blob)) return "200-PGA";
  if (/100.?PGA/.test(blob)) return "100-PGA";
  return null;
}

function seriesFallbackRe(p: NormalizedProduct): RegExp | null {
  const blob = `${p.series} ${p.model} ${p.product_id} ${p.source.source_title}`;
  if (/r-?van/i.test(blob)) return /r-?van/i;
  if (/pgp/i.test(blob)) return /pgp/i;
  if (/\bi-?20\b/i.test(blob)) return /\bi-?20\b/i;
  if (/\bpgj\b/i.test(blob)) return /\bpgj\b/i;
  if (/xfs-?cv|xfs\b|xfd\b/i.test(blob)) return /xfs-?cv|xfs\b|xfd\b/i;
  if (/accu.?sync/i.test(blob)) return /accu.?sync/i;
  if (/prf|rby/i.test(blob)) return /prf|rby/i;
  if (/psi-?m\d*/i.test(blob)) return /psi-?m/i;
  if (/350[04]|3500/i.test(blob)) return /350[04]|3500/i;
  if (/500[046]/i.test(blob)) return /500[046]/i;
  return null;
}

async function allPdfTexts(
  p: NormalizedProduct,
  allProducts: NormalizedProduct[],
): Promise<CachedPdfText[]> {
  const docs = [...(p.media.documents ?? [])];
  const re = seriesFallbackRe(p);
  if (re) {
    const donor = allProducts.find(
      (x) =>
        x.product_id !== p.product_id &&
        re.test(`${x.series} ${x.model} ${x.product_id} ${x.source.source_title}`) &&
        (x.media.documents?.length ?? 0) > 0,
    );
    if (donor?.media.documents) {
      for (const d of donor.media.documents) {
        if (!docs.some((x) => x.url === d.url)) docs.push(d);
      }
    }
  }
  // Also pull PDFs listed on the AI scrape record (may be richer than normalized media)
  const ai = aiById.get(p.source.source_record_id);
  if (ai?.pdfs?.length) {
    for (const d of ai.pdfs) {
      if (!docs.some((x) => x.url === d.url)) docs.push({ url: d.url, title: d.title });
    }
  }
  const out: CachedPdfText[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    if (seen.has(d.url)) continue;
    seen.add(d.url);
    const t = await loadPdfTextByUrl(d.url);
    if (t && t.chars >= 80) out.push(t);
  }
  return out;
}

function recomputeQuality(p: NormalizedProduct) {
  const filled = Object.entries(p.attributes).filter(([, v]) => v !== null).length;
  const total = Object.keys(p.attributes).length || 1;
  p.quality.extraction_confidence = Math.round((filled / total) * 100) / 100;

  const hasPerf = p.performance_tables.length > 0;

  // Drop stale enrichment-related warnings; rebuild below
  p.quality.warnings = p.quality.warnings.filter(
    (w) =>
      w !== "performance_tables_missing" &&
      !w.startsWith("missing_critical:") &&
      !w.startsWith("enrich:"),
  );

  if (
    (p.group_id === "nozzles_rotators" || p.group_id === "rotor_sprinklers") &&
    !hasPerf
  ) {
    p.quality.warnings.push("performance_tables_missing");
  }
  if (p.group_id === "valves" && !hasPerf) {
    p.quality.warnings.push("performance_tables_missing");
  }

  // Critical attrs = those marked not_found OR still null with required-looking names
  const nullAttrs = Object.entries(p.attributes)
    .filter(([, v]) => v === null || v === undefined)
    .map(([k]) => k);
  // Prefer critical from existing missing list pattern used in pilot
  const criticalCandidates = [
    "pressure_min_bar",
    "pressure_max_bar",
    "radius_min_m",
    "radius_max_m",
    "actuation_type",
    "coil_voltage_v",
    "station_count",
    "supply_voltage_v",
    "output_voltage_v",
    "outer_diameter_mm",
    "shape",
  ].filter((k) => {
    // Strip nozzles use strip_* instead of radius_*
    if (
      p.subtype_id === "strip_nozzle" &&
      (k === "radius_min_m" || k === "radius_max_m")
    ) {
      return false;
    }
    return true;
  });
  const missingCritical = criticalCandidates.filter((k) => nullAttrs.includes(k) && k in p.attributes);
  if (missingCritical.length) {
    p.quality.warnings.push(`missing_critical:${missingCritical.join(",")}`);
  }

  let ready = true;
  if (p.group_id === "nozzles_rotators" || p.group_id === "rotor_sprinklers") {
    ready = hasPerf;
  }
  if (p.group_id === "pressure_pipes" && p.attributes.internal_diameter_mm == null) {
    ready = false;
  }
  if (missingCritical.length && (p.group_id === "valves" || p.group_id === "controllers")) {
    // valves/controllers: only block if core critical still missing
    const core = missingCritical.filter((k) =>
      ["actuation_type", "coil_voltage_v", "pressure_max_bar", "station_count", "supply_voltage_v", "output_voltage_v"].includes(k),
    );
    if (core.length) ready = false;
  }

  const reviewWarnings = p.quality.warnings.filter((w) => !w.startsWith("info:"));
  p.quality.calculation_ready = ready;
  p.quality.needs_review =
    !p.quality.calculation_ready ||
    reviewWarnings.some((w) => w === "performance_tables_missing" || w.startsWith("missing_critical:")) ||
    p.quality.classification_confidence < 0.8;
}

async function enrichProduct(
  p: NormalizedProduct,
  allProducts: NormalizedProduct[],
): Promise<Touch> {
  const touch: Touch = {
    product_id: p.product_id,
    attrs_filled: [],
    tables_added: [],
    pdf_used: null,
    notes: [],
  };
  const pdfs = await allPdfTexts(p, allProducts);
  const best = pdfs[0] ?? null;
  if (best) touch.pdf_used = best.title;

  // ——— nozzles / R-VAN ———
  if (p.group_id === "nozzles_rotators") {
    const rvan = rvanModelKey(p);
    if (rvan) {
      for (const pdf of pdfs) {
        const table = parseRvanPerformanceFromPdf(pdf.text, {
          modelKey: rvan,
          sourceUrl: pdf.url,
          documentTitle: pdf.title,
        });
        if (table) {
          addTable(p, table, touch);
          const sum = summarizeRadiusFlowTable(table);
          fillAttr(p, "pressure_min_bar", sum.pressure_min_bar, pdf, touch);
          fillAttr(p, "pressure_max_bar", sum.pressure_max_bar, pdf, touch);
          fillAttr(p, "radius_min_m", sum.radius_min_m, pdf, touch);
          fillAttr(p, "radius_max_m", sum.radius_max_m, pdf, touch);
          fillAttr(p, "precipitation_rate_mm_h", sum.precipitation_rate_mm_h, pdf, touch);
          const widths = table.rows
            .map((r) => r.strip_width_m)
            .filter((x): x is number => typeof x === "number");
          const lengths = table.rows
            .map((r) => r.strip_length_m)
            .filter((x): x is number => typeof x === "number");
          if (widths.length) {
            fillAttr(p, "strip_width_m", Math.max(...widths), pdf, touch);
          }
          if (lengths.length) {
            fillAttr(p, "strip_length_m", Math.max(...lengths), pdf, touch);
          }
          // recommended PRS pressure from datasheet note
          if (/3[,.]1\s*bar\s*Druckregulierung|Druckregulierung[^.]{0,40}3[,.]1\s*bar/i.test(pdf.text)) {
            fillAttr(p, "pressure_recommended_bar", 3.1, pdf, touch);
          }
          if (/Strahlanstieg[^\d]{0,40}(\d+)\s*und\s*(\d+)/i.test(pdf.text)) {
            // trajectory range — store mid as not schema-friendly; skip inventing single value
          }
          touch.notes.push(`rvan_table_rows=${table.rows.length}`);
          break;
        }
      }
    }

    const mp = mpModelKey(p);
    if (mp) {
      for (const pdf of pdfs) {
        const spec = extractMpRotatorSpecs(pdf.text, mp);
        if (!spec.sources.length) continue;
        fillAttr(p, "radius_min_m", spec.radius_min_m, pdf, touch);
        fillAttr(p, "radius_max_m", spec.radius_max_m, pdf, touch);
        fillAttr(p, "precipitation_rate_mm_h", spec.precipitation_rate_mm_h, pdf, touch);
        fillAttr(p, "pressure_recommended_bar", spec.pressure_recommended_bar, pdf, touch);
        touch.notes.push(`mp_specs:${pdf.title.slice(0, 40)}=${spec.sources.join(",")}`);
      }
    }
  }

  // ——— rotors / 3500 ———
  if (p.group_id === "rotor_sprinklers") {
    if (/3504|3500/i.test(`${p.model} ${p.series} ${p.product_id}`)) {
      for (const pdf of pdfs) {
        const parsed = parse3500LeistungsdatenFromPdf(pdf.text, {
          modelKey: p.model || "3504-PC",
          sourceUrl: pdf.url,
          documentTitle: pdf.title,
        });
        if (parsed) {
          addTable(p, parsed.table, touch);
          const k = parsed.kenndaten;
          fillAttr(p, "radius_min_m", k.radius_min_m, pdf, touch);
          fillAttr(p, "radius_max_m", k.radius_max_m, pdf, touch);
          fillAttr(p, "pressure_min_bar", k.pressure_min_bar, pdf, touch);
          fillAttr(p, "pressure_max_bar", k.pressure_max_bar, pdf, touch);
          fillAttr(p, "arc_min_deg", k.arc_min_deg, pdf, touch);
          fillAttr(p, "arc_max_deg", k.arc_max_deg, pdf, touch);
          fillAttr(p, "pop_up_height_mm", k.pop_up_height_mm, pdf, touch);
          fillAttr(p, "check_valve_max_elevation_m", k.check_valve_max_elevation_m, pdf, touch);
          touch.notes.push(`3500_rows=${parsed.table.rows.length}`);
          break;
        }
      }
    } else {
      // PGP / I-20 Leistungsdaten tables
      if (/pgp|i-?20|i20/i.test(`${p.series} ${p.model} ${p.product_id}`)) {
        for (const pdf of pdfs) {
          const table = parsePgpLeistungsdatenFromPdf(pdf.text, {
            modelKey: p.model || p.series || "rotor",
            sourceUrl: pdf.url,
            documentTitle: pdf.title,
          });
          if (table) {
            addTable(p, table, touch);
            const sum = summarizeRadiusFlowTable(table);
            fillAttr(p, "pressure_min_bar", sum.pressure_min_bar, pdf, touch);
            fillAttr(p, "pressure_max_bar", sum.pressure_max_bar, pdf, touch);
            fillAttr(p, "radius_min_m", sum.radius_min_m, pdf, touch);
            fillAttr(p, "radius_max_m", sum.radius_max_m, pdf, touch);
            touch.notes.push(`pgp_rows=${table.rows.length}`);
            break;
          }
        }
      }
      // generic rotor kenndaten from PDF + shop text
      for (const pdf of pdfs) {
        const k = extractRotorKenndaten(pdf.text);
        if (k.sources.length) {
          fillAttr(p, "radius_min_m", k.radius_min_m, pdf, touch);
          fillAttr(p, "radius_max_m", k.radius_max_m, pdf, touch);
          fillAttr(p, "pressure_min_bar", k.pressure_min_bar, pdf, touch);
          fillAttr(p, "pressure_max_bar", k.pressure_max_bar, pdf, touch);
          fillAttr(p, "arc_min_deg", k.arc_min_deg, pdf, touch);
          fillAttr(p, "arc_max_deg", k.arc_max_deg, pdf, touch);
          fillAttr(p, "pop_up_height_mm", k.pop_up_height_mm, pdf, touch);
          touch.notes.push(`rotor_kenndaten=${k.sources.join(",")}`);
          break;
        }
      }
      const shop = extractShopSprinklerKenndaten(shopText(p));
      if (shop.sources.length) {
        fillAttr(p, "radius_min_m", shop.radius_min_m, null, touch);
        fillAttr(p, "radius_max_m", shop.radius_max_m, null, touch);
        fillAttr(p, "pressure_min_bar", shop.pressure_min_bar, null, touch);
        fillAttr(p, "pressure_max_bar", shop.pressure_max_bar, null, touch);
        fillAttr(p, "arc_min_deg", shop.arc_min_deg, null, touch);
        fillAttr(p, "arc_max_deg", shop.arc_max_deg, null, touch);
        fillAttr(p, "pop_up_height_mm", shop.pop_up_height_mm, null, touch);
        touch.notes.push(`shop_rotor=${shop.sources.join(",")}`);
      }
    }
  }

  // ——— valves ———
  if (p.group_id === "valves") {
    const pga = pgaModelKey(p);
    if (pga) {
      for (const pdf of pdfs) {
        const table = parsePgaPressureLossFromPdf(pdf.text, {
          modelKey: pga,
          sourceUrl: pdf.url,
          documentTitle: pdf.title,
        });
        if (table) {
          addTable(p, table, touch);
          const k = extractValveKenndaten(pdf.text, pga);
          fillAttr(p, "flow_min_l_min", k.flow_min_l_min, pdf, touch);
          fillAttr(p, "flow_max_l_min", k.flow_max_l_min, pdf, touch);
          fillAttr(p, "pressure_min_bar", k.pressure_min_bar, pdf, touch);
          fillAttr(p, "pressure_max_bar", k.pressure_max_bar, pdf, touch);
          fillAttr(p, "coil_current_inrush_a", k.coil_current_inrush_a, pdf, touch);
          fillAttr(p, "coil_current_holding_a", k.coil_current_holding_a, pdf, touch);
          fillAttr(p, "body_material", k.body_material, pdf, touch);
          fillAttr(p, "flow_control_present", k.flow_control_present, pdf, touch);
          touch.notes.push(`pga_rows=${table.rows.length}`);
          break;
        }
      }
    }

    if (/HV|DV/i.test(`${p.series} ${p.model} ${p.product_id}`)) {
      for (const pdf of pdfs) {
        const op = extractHvDvOperatingRange(pdf.text);
        if (op.sources.length) {
          fillAttr(p, "flow_min_l_min", op.flow_min_l_min, pdf, touch);
          fillAttr(p, "flow_max_l_min", op.flow_max_l_min, pdf, touch);
          fillAttr(p, "pressure_min_bar", op.pressure_min_bar, pdf, touch);
          fillAttr(p, "pressure_max_bar", op.pressure_max_bar, pdf, touch);
          touch.notes.push(`hv_dv=${op.sources.join(",")}`);
          break;
        }
      }
      for (const pdf of pdfs) {
        const k = extractValveKenndaten(pdf.text, p.model);
        fillAttr(p, "coil_current_inrush_a", k.coil_current_inrush_a, pdf, touch);
        fillAttr(p, "coil_current_holding_a", k.coil_current_holding_a, pdf, touch);
        fillAttr(p, "body_material", k.body_material, pdf, touch);
        fillAttr(p, "flow_control_present", k.flow_control_present, pdf, touch);
      }
    }
  }

  // ——— spray bodies: dimensions / pressure from PDF if present ———
  if (p.group_id === "spray_bodies") {
    for (const pdf of pdfs) {
      const maxP = pdf.text.match(/(?:max\.?\s*)?[Dd]ruck[:\s]*([\d,]+)\s*bar|([\d,]+)\s*bar\s*max/i);
      if (maxP) fillAttr(p, "pressure_max_bar", parseFloat((maxP[1] || maxP[2]).replace(",", ".")), pdf, touch);
      const pop = pdf.text.match(/Aufsteiger[^0-9]{0,20}([\d,]+)\s*cm|([\d,]+)\s*cm\s*Aufsteiger/i);
      if (pop) {
        const cm = parseFloat((pop[1] || pop[2]).replace(",", "."));
        fillAttr(p, "pop_up_height_mm", Math.round(cm * 10), pdf, touch);
      }
    }
    const shop = extractShopSprinklerKenndaten(shopText(p));
    fillAttr(p, "pop_up_height_mm", shop.pop_up_height_mm, null, touch);
    fillAttr(p, "pressure_max_bar", shop.pressure_max_bar, null, touch);
  }

  // ——— drip / tropfrohr ———
  if (p.group_id === "drip_irrigation") {
    const apply = (spec: ReturnType<typeof extractDripSpecs>, pdf: CachedPdfText | null, tag: string) => {
      if (!spec.sources.length) return;
      fillAttr(p, "outer_diameter_mm", spec.outer_diameter_mm, pdf, touch);
      fillAttr(p, "emitter_flow_l_h", spec.emitter_flow_l_h, pdf, touch);
      fillAttr(p, "emitter_spacing_m", spec.emitter_spacing_m, pdf, touch);
      fillAttr(p, "pressure_min_bar", spec.pressure_min_bar, pdf, touch);
      fillAttr(p, "pressure_max_bar", spec.pressure_max_bar, pdf, touch);
      fillAttr(p, "pressure_compensating", spec.pressure_compensating, pdf, touch);
      fillAttr(p, "coil_length_m", spec.coil_length_m, pdf, touch);
      touch.notes.push(`${tag}=${spec.sources.join(",")}`);
    };
    for (const pdf of pdfs) apply(extractDripSpecs(pdf.text), pdf, "drip_pdf");
    apply(extractDripSpecs(shopText(p)), null, "drip_shop");
  }

  // ——— filters / PRV ———
  if (p.group_id === "filters_pressure_regulators") {
    const titleBlob = `${p.source.source_title} ${p.name?.de ?? ""} ${p.model ?? ""}`;
    const looksFilter = /filter|sieb|schmutzf[aä]nger|rby|prf|scheibenfilter|basket/i.test(titleBlob);
    const looksPrv =
      /druckminder|regulator|accu.?sync|psi-?m|pmr-|druckreduz/i.test(titleBlob) || looksFilter;

    // Drop filtration_* wrongly copied from a filter datasheet onto a pure PRV
    if (!looksFilter) {
      for (const key of ["filtration_mesh", "filtration_micron", "filter_element_type"] as const) {
        if (p.attributes[key] == null) continue;
        const prov = p.provenance[`attributes.${key}`];
        if (prov?.document_title && /prf|rby|filter/i.test(String(prov.document_title))) {
          p.attributes[key] = null;
          delete p.provenance[`attributes.${key}`];
          delete p.field_status[`attributes.${key}`];
          touch.notes.push(`cleared_bad_${key}`);
        }
      }
    }

    const apply = (spec: ReturnType<typeof extractFilterPrvSpecs>, pdf: CachedPdfText | null, tag: string) => {
      if (!spec.sources.length) return;
      if (looksFilter) {
        fillAttr(p, "filtration_micron", spec.filtration_micron, pdf, touch);
        fillAttr(p, "filtration_mesh", spec.filtration_mesh, pdf, touch);
        fillAttr(p, "filter_element_type", spec.filter_element_type, pdf, touch);
      }
      if (looksPrv || looksFilter) {
        fillAttr(p, "pressure_min_bar", spec.pressure_min_bar, pdf, touch);
        fillAttr(p, "pressure_max_bar", spec.pressure_max_bar, pdf, touch);
        fillAttr(p, "regulated_pressure_bar", spec.regulated_pressure_bar, pdf, touch);
        fillAttr(p, "flow_max_l_min", spec.flow_max_l_min, pdf, touch);
      }
      touch.notes.push(`${tag}=${spec.sources.join(",")}`);
    };
    for (const pdf of pdfs) apply(extractFilterPrvSpecs(pdf.text), pdf, "filter_pdf");
    apply(extractFilterPrvSpecs(shopText(p)), null, "filter_shop");
  }

  // ——— PE pressure pipes ———
  if (p.group_id === "pressure_pipes") {
    const apply = (spec: ReturnType<typeof extractPePipeSpecs>, pdf: CachedPdfText | null, tag: string) => {
      if (!spec.sources.length) return;
      fillAttr(p, "material", spec.material, pdf, touch);
      fillAttr(p, "outer_diameter_mm", spec.outer_diameter_mm, pdf, touch);
      fillAttr(p, "wall_thickness_mm", spec.wall_thickness_mm, pdf, touch);
      fillAttr(p, "internal_diameter_mm", spec.internal_diameter_mm, pdf, touch);
      fillAttr(p, "sdr", spec.sdr, pdf, touch);
      fillAttr(p, "pressure_rating_bar", spec.pressure_rating_bar, pdf, touch);
      fillAttr(p, "length_m", spec.length_m, pdf, touch);
      fillAttr(p, "potable_water_approved", spec.potable_water_approved, pdf, touch);
      touch.notes.push(`${tag}=${spec.sources.join(",")}`);
    };
    for (const pdf of pdfs) apply(extractPePipeSpecs(pdf.text), pdf, "pipe_pdf");
    apply(extractPePipeSpecs(shopText(p)), null, "pipe_shop");
  }

  // ——— valve boxes ———
  if (p.group_id === "valve_boxes") {
    const apply = (spec: ReturnType<typeof extractValveBoxSpecs>, pdf: CachedPdfText | null, tag: string) => {
      if (!spec.sources.length) return;
      fillAttr(p, "outer_length_mm", spec.outer_length_mm, pdf, touch);
      fillAttr(p, "outer_width_mm", spec.outer_width_mm, pdf, touch);
      fillAttr(p, "outer_height_mm", spec.outer_height_mm, pdf, touch);
      fillAttr(p, "outer_diameter_mm", spec.outer_diameter_mm, pdf, touch);
      fillAttr(p, "max_valve_count", spec.max_valve_count, pdf, touch);
      fillAttr(p, "body_material", spec.body_material, pdf, touch);
      touch.notes.push(`${tag}=${spec.sources.join(",")}`);
    };
    for (const pdf of pdfs) apply(extractValveBoxSpecs(pdf.text), pdf, "vbox_pdf");
    apply(extractValveBoxSpecs(shopText(p)), null, "vbox_shop");
  }

  // ——— PE Klemm: potable / seal from PDF/text if present ———
  if (p.group_id === "pe_compression_fittings") {
    const blob = `${shopText(p)}\n${pdfs.map((x) => x.text).join("\n")}`;
    if (/Trinkwasser|DVGW|potable/i.test(blob)) {
      fillAttr(p, "potable_water_approved", true, pdfs[0] ?? null, touch);
    }
    if (/NBR|EPDM/i.test(blob)) {
      const seal = /EPDM/i.test(blob) ? "EPDM" : "NBR";
      fillAttr(p, "seal_material", seal, pdfs[0] ?? null, touch);
    }
    if (/UV/i.test(blob)) fillAttr(p, "uv_resistant", true, pdfs[0] ?? null, touch);
  }

  recomputeQuality(p);
  return touch;
}

async function main() {
  await loadAiIndex();
  const file = JSON.parse(await fs.readFile(PRODUCTS_FILE, "utf8")) as FileShape;
  const touches: Touch[] = [];
  let attrs = 0;
  let tables = 0;

  for (const p of file.products) {
    const t = await enrichProduct(p, file.products);
    if (t.attrs_filled.length || t.tables_added.length) {
      touches.push(t);
      attrs += t.attrs_filled.length;
      tables += t.tables_added.length;
    }
  }

  file.generated_at = new Date().toISOString();
  await fs.writeFile(PRODUCTS_FILE, JSON.stringify(file, null, 2), "utf8");

  // refresh needs_review
  const needs = file.products.filter((p) => p.quality.needs_review);
  await fs.writeFile(
    path.join(OUT, "products_needs_review.json"),
    JSON.stringify(
      {
        schema_version: "1.0.0",
        generated_at: file.generated_at,
        count: needs.length,
        products: needs,
      },
      null,
      2,
    ),
    "utf8",
  );

  const report = {
    schema_version: "1.0.0",
    generated_at: file.generated_at,
    products_total: file.products.length,
    products_touched: touches.length,
    attributes_filled: attrs,
    tables_added: tables,
    calculation_ready: file.products.filter((p) => p.quality.calculation_ready).length,
    with_performance_tables: file.products.filter((p) => p.performance_tables.length > 0).length,
    touches,
  };
  await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2), "utf8");

  console.log(
    `Enriched ${touches.length}/${file.products.length} products; +${attrs} attrs, +${tables} tables; calculation_ready=${report.calculation_ready}; with_tables=${report.with_performance_tables}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
