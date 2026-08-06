/**
 * Import missing shop-dropdown siblings into RegnerWerk_universal.json.
 * Source: products-ai.json (prices/variant) + products_normalized.json (base card).
 *
 * Usage: npx tsx scripts/catalog/import-universal-siblings.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "../..");
const UNIVERSAL = path.join(ROOT, "data/catalog/normalized/RegnerWerk_universal.json");
const AI = path.join(ROOT, "data/raw/products-ai.json");
const NORM = path.join(ROOT, "data/catalog/normalized/products_normalized.json");

type AnyRec = Record<string, unknown>;

function baseUrl(url: string | undefined | null): string {
  return (url || "").replace(/#v=.*$/, "").split("?")[0];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

/** Fractions before bare integers — never treat the "2" in "1/2"" as 2". */
function parseInch(s: string): string | null {
  if (/1\s*1\/2|1½|11\/2/i.test(s)) return '1 1/2"';
  if (/1\s*1\/4|1¼|11\/4/i.test(s)) return '1 1/4"';
  if (/2\s*1\/2|2½/i.test(s)) return '2 1/2"';
  if (/3\/4|¾/i.test(s)) return '3/4"';
  if (/1\/2|½/i.test(s)) return '1/2"';
  if (/(?:^|[^\d\/])2\s*(?:"|Zoll|“|”)/i.test(s)) return '2"';
  if (/(?:^|[^\d\/])1\s*(?:"|Zoll|“|”)/i.test(s) && !/1\s*1\//.test(s))
    return '1"';
  return null;
}

/** Explicit shop cues only — never bare /AG/ (matches "Schlag"). */
function genderFromText(v: string): "female" | "male" | "mixed" | null {
  if (/IG\s*\/\s*IG|Innengewinde\s*x\s*Innengewinde/i.test(v)) return "female";
  if (
    /AG\s*\/\s*AG|Außengewinde\s*x\s*Außengewinde|Aussengewinde\s*x\s*Aussengewinde/i.test(
      v,
    )
  )
    return "male";
  if (
    /IG\s*x\s*AG|Innengewinde\s*x\s*Außengewinde|Innengewinde\s*x\s*Aussengewinde/i.test(
      v,
    )
  )
    return "mixed";
  if (
    /AG\s*x\s*IG|Außengewinde\s*x\s*Innengewinde|Aussengewinde\s*x\s*Innengewinde/i.test(
      v,
    )
  )
    return "mixed";
  const female = /\bIG\b|Innengewinde/i.test(v);
  const male = /\bAG\b|Außengewinde|Aussengewinde/i.test(v);
  if (female && !male) return "female";
  if (male && !female) return "male";
  return null;
}

function parsePeMm(s: string): number | null {
  const m = s.match(/\b(16|20|25|32|40|50|63)\s*mm\b/i) || s.match(/\b(16|20|25|32|40|50|63)\s*x\s*/i);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function classifyVariant(variant: string, parentGroup: string): { group_id: string; subtype_id: string; series: string } {
  const v = variant;
  if (/Kugelhahn/i.test(v)) return { group_id: "valves", subtype_id: "manual_ball_valve", series: "kugelhahn" };
  if (/Druckminderer/i.test(v)) return { group_id: "filters_pressure_regulators", subtype_id: "pressure_regulator", series: "druckminderer" };
  if (/Scheibenfilter|RBY|PRF-|Filter/i.test(v) && !/Magnetventil/i.test(v))
    return { group_id: "filters_pressure_regulators", subtype_id: /RBY|PRF|Druck/i.test(v) ? "filter_regulator" : "filter", series: "filter" };
  if (/Rückschlag/i.test(v)) return { group_id: "pe_compression_fittings", subtype_id: "check_valve", series: "klemm" };
  if (/Anbohrschelle/i.test(v)) return { group_id: "pe_compression_fittings", subtype_id: "saddle", series: "klemm" };
  if (/Verteiler\s*\d/i.test(v)) return { group_id: "threaded_fittings_manifolds", subtype_id: "manifold", series: "verteiler" };
  if (/Überwurf|WINKEL|T-STÜCK|X-STÜCK|Kappe|Stopfen|Nippel|Doppelnippel/i.test(v))
    return {
      group_id: "threaded_fittings_manifolds",
      subtype_id: /Verteiler/i.test(v)
        ? "manifold"
        : /WINKEL|Winkel/i.test(v)
          ? "elbow"
          : /T-STÜCK|T-Stück/i.test(v)
            ? "tee"
            : /Kappe|Stopfen/i.test(v)
              ? "cap"
              : /Reduz/i.test(v)
                ? "reducing_nipple"
                : "union",
      series: "pvc_fitting",
    };
  if (/Winkel|T-Stück|Kupplung|Endkappe|Reduzier/i.test(v) && /\d{2}\s*mm|Klemm/i.test(v))
    return {
      group_id: "pe_compression_fittings",
      subtype_id: /Winkel/i.test(v) ? "elbow" : /T-Stück/i.test(v) ? "tee" : /Endkappe/i.test(v) ? "end_cap" : /Reduz/i.test(v) ? "reducer" : "coupling",
      series: "klemm",
    };
  if (/Adern Kabel/i.test(v)) return { group_id: "electrical_accessories", subtype_id: "control_cable", series: "cable" };
  if (/XCZ-|PRF-075-Alternative/i.test(v)) return { group_id: "preassembled_modules", subtype_id: "valve_filter_kit", series: "kit" };
  if (/1804-SAM|PRS-30|PRS-45/i.test(v)) return { group_id: "spray_bodies", subtype_id: "spray_body_prs", series: "spray_body" };
  if (/Düsensatz|MPR-/i.test(v)) return { group_id: "sprinkler_accessories", subtype_id: "rotor_nozzle_set", series: "nozzle_set" };
  if (/PE-Rohr|m\/Rolle PE/i.test(v)) return { group_id: "pressure_pipes", subtype_id: "pe_pipe", series: "pe_pipe" };
  if (/Messing/i.test(v)) return { group_id: "mounting_accessories", subtype_id: "brass_fitting", series: "messing" };
  return { group_id: parentGroup || "mounting_accessories", subtype_id: "other", series: "other" };
}

function buildConnections(variant: string, group_id: string): AnyRec[] {
  const v = variant;
  const ports: AnyRec[] = [];
  const pe = parsePeMm(v);

  // PE clamp + thread adapters
  if (/Klemm|Anbohrschelle|PE/i.test(v) && (/AG|IG|Zoll|"/i.test(v) || pe)) {
    if (pe) {
      ports.push({
        port_id: "pipe",
        role: "bidirectional",
        connection_type: "pe_compression",
        nominal_size_mm: pe,
        thread_size_inch: null,
        thread_gender: "not_applicable",
        thread_standard: "not_applicable",
      });
    }
    const inch = parseInch(v);
    if (inch) {
      ports.push({
        port_id: "thread",
        role: "bidirectional",
        connection_type: "threaded",
        nominal_size_mm: null,
        thread_size_inch: inch,
        thread_gender: genderFromText(v) === "male" ? "male" : genderFromText(v) === "female" ? "female" : null,
        thread_standard: "BSP",
      });
    }
    if (ports.length) return ports;
  }

  // Pure threaded (ball valve, check valve, PVC fittings, brass)
  if (
    /\bIG\b|\bAG\b|Innengewinde|Außengewinde|Aussengewinde|Zoll|"|Gewinde/i.test(
      v,
    ) ||
    group_id.includes("threaded") ||
    group_id === "valves"
  ) {
    if (/Reduz|x\s*3\/4|x\s*1\s*"/i.test(v) && /Nippel|Muffe/i.test(v)) {
      if (/3\/4/.test(v) && /1"/.test(v)) {
        const first = /1"\s*x\s*3\/4/i.test(v) ? '1"' : parseInch(v);
        const gRaw = genderFromText(v);
        const g = gRaw === "male" ? "male" : gRaw === "female" ? "female" : null;
        ports.push({
          port_id: "side_a",
          role: "bidirectional",
          connection_type: "threaded",
          nominal_size_mm: null,
          thread_size_inch: first || '1"',
          thread_gender: g,
          thread_standard: "BSP",
        });
        ports.push({
          port_id: "side_b",
          role: "bidirectional",
          connection_type: "threaded",
          nominal_size_mm: null,
          thread_size_inch: '3/4"',
          thread_gender: g,
          thread_standard: "BSP",
        });
        return ports;
      }
    }

    const inch = parseInch(v);
    const gender = genderFromText(v);
    // Do not invent a size when the label has none
    if (!inch && !/Fach/i.test(v)) {
      return ports;
    }

    const fach = v.match(/(\d)\s*Fach/i);
    if (fach && inch) {
      const n = parseInt(fach[1], 10);
      ports.push({
        port_id: "main_inlet",
        role: "inlet",
        connection_type: "threaded",
        nominal_size_mm: null,
        thread_size_inch: inch,
        thread_gender: "male",
        thread_standard: "BSP",
      });
      for (let i = 1; i <= n; i++) {
        ports.push({
          port_id: `zone_${i}`,
          role: "outlet",
          connection_type: "threaded",
          nominal_size_mm: null,
          thread_size_inch: inch,
          thread_gender: "female",
          thread_standard: "BSP",
        });
      }
      return ports;
    }

    if (!inch) return ports;

    const g =
      gender === "mixed" ? "female" : gender === "male" || gender === "female" ? gender : null;
    const isCheck = /Rückschlag/i.test(v);
    ports.push({
      port_id: "inlet",
      role: isCheck ? "inlet" : "bidirectional",
      connection_type: "threaded",
      nominal_size_mm: null,
      thread_size_inch: inch,
      thread_gender: g,
      thread_standard: "BSP",
    });
    if (!/Kappe|Stopfen|Endkappe|Blind/i.test(v)) {
      ports.push({
        port_id: "outlet",
        role: isCheck ? "outlet" : "bidirectional",
        connection_type: "threaded",
        nominal_size_mm: null,
        thread_size_inch: inch,
        thread_gender: gender === "mixed" ? "male" : g,
        thread_standard: "BSP",
      });
    }
    return ports;
  }

  // PE only coupling
  if (pe) {
    ports.push({
      port_id: "a",
      role: "bidirectional",
      connection_type: "pe_compression",
      nominal_size_mm: pe,
      thread_size_inch: null,
      thread_gender: "not_applicable",
      thread_standard: "not_applicable",
    });
  }
  return ports;
}

function buildAttributes(variant: string, group_id: string, subtype: string): AnyRec {
  const v = variant;
  if (group_id === "valves") {
    return {
      actuation_type: "manual",
      normal_state: null,
      coil_voltage_v: null,
      pressure_min_bar: null,
      pressure_max_bar: 16,
      flow_control_present: false,
      manual_opening: true,
      body_material: /Messing|brass/i.test(v) ? "brass" : "plastic",
    };
  }
  if (group_id === "filters_pressure_regulators") {
    const bar = v.match(/([\d,]+)\s*bar/i);
    return {
      filtration_mesh: /Scheiben|Filter/i.test(v) ? 120 : null,
      filtration_micron: null,
      filter_element_type: /Scheiben/i.test(v) ? "disc" : /RBY|Sieb/i.test(v) ? "screen" : null,
      regulated_pressure_bar: bar ? parseFloat(bar[1].replace(",", ".")) : /Druckminderer/i.test(v) ? null : null,
      flow_max_l_min: /1\s*"/.test(v) ? 83.33 : /3\/4/.test(v) ? 66.67 : null,
      pressure_min_bar: null,
      pressure_max_bar: null,
    };
  }
  if (group_id === "pressure_pipes") {
    const od = parsePeMm(v) || 25;
    const len = v.match(/(\d+)\s*m\s*\/\s*Rolle/i);
    const sdr11 = od === 25;
    return {
      material: "PE100",
      outer_diameter_mm: od,
      wall_thickness_mm: sdr11 ? 2.27 : od === 32 ? 1.88 : null,
      internal_diameter_mm: sdr11 ? 20.46 : od === 32 ? 28.24 : null,
      sdr: sdr11 ? "11" : od === 32 ? "17" : null,
      pressure_rating_bar: 10,
      length_m: len ? parseInt(len[1], 10) : null,
      potable_water_approved: true,
    };
  }
  if (group_id === "electrical_accessories") {
    const c = v.match(/(\d+)\s*Adern/i);
    return {
      conductor_count: c ? parseInt(c[1], 10) : null,
      conductor_cross_section_mm2: null,
      length_m: null,
      direct_burial_allowed: true,
      waterproof: false,
      voltage_rating_v: null,
    };
  }
  if (group_id === "pe_compression_fittings") {
    return {
      shape: subtype === "elbow" ? "elbow" : subtype === "tee" ? "tee" : subtype === "end_cap" ? "end_cap" : subtype === "reducer" ? "reducer" : subtype === "saddle" ? "adapter" : subtype === "check_valve" ? "straight" : "straight",
      angle_deg: subtype === "elbow" ? 90 : null,
      pressure_rating_bar: /PN16|16\s*bar/i.test(v) ? 16 : 10,
      body_material: /Messing/i.test(v) ? "brass" : "pp",
      seal_material: /NBR/i.test(v) ? "NBR" : null,
      uv_resistant: true,
      potable_water_approved: true,
    };
  }
  if (group_id === "threaded_fittings_manifolds" || group_id === "threaded_fittings") {
    const fach = v.match(/(\d)\s*Fach/i);
    return {
      shape: subtype === "manifold" ? "manifold" : subtype === "elbow" ? "elbow" : subtype === "tee" ? "tee" : "straight",
      outlet_count: fach ? parseInt(fach[1], 10) : null,
      union_present: /Überwurf/i.test(v),
      pressure_rating_bar: 10,
      body_material: /Messing/i.test(v) ? "brass" : /PP /i.test(v) ? "PP" : "PVC",
      seal_material: null,
      seal_included: /O-Ring|Überwurf/i.test(v) ? true : null,
    };
  }
  if (group_id === "spray_bodies") {
    return {
      pop_up_height_mm: 100,
      check_valve_present: /SAM/i.test(v),
      pressure_regulation_bar: /PRS-?45|3[,.]1/i.test(v) ? 3.1 : /PRS-?30|2[,.]1/i.test(v) ? 2.1 : null,
      inlet_thread_inch: '1/2"',
    };
  }
  if (group_id === "preassembled_modules") {
    return {
      function: /XCZ|Filter|Druckmind/i.test(v) ? "drip_control_zone" : "valve_manifold",
      preassembled: true,
      installation_ready: true,
      included_filter: /Filter/i.test(v),
      included_pressure_regulator: /Druckmind|PRF|RBY/i.test(v),
      included_winterization: false,
    };
  }
  return { material: /Messing/i.test(v) ? "brass" : null };
}

function designSelection(group_id: string, attrs: AnyRec, connections: AnyRec[]): AnyRec {
  const connector = ![
    "rotor_sprinklers",
    "nozzles_rotators",
    "spray_bodies",
    "controllers",
  ].includes(group_id);
  const role = group_id === "valves" || group_id === "controllers" ? "hydraulic_control" : connector ? "hydraulic_connector" : "emitter";
  const keys = Object.keys(attrs).filter((k) => attrs[k] != null);
  return {
    component_role: role,
    configuration_mode: "fixed_component",
    selection_summary_ru:
      role === "hydraulic_connector"
        ? "Соединительный компонент. Геометрию полива не формирует; для автоматического подбора используются отдельные нормализованные порты."
        : role === "hydraulic_control"
          ? "Гидравлический управляющий компонент. Геометрию полива не формирует; выбирается по портам и подтверждённым рабочим параметрам."
          : "Компонент ассортимента.",
    automatic_layout_eligible: false,
    automatic_option_selection_eligible: false,
    selection_data_status: "not_a_geometry_emitter",
    selection_inputs: {
      available_attribute_keys: keys,
      confirmed_attribute_keys: keys,
      port_ids: connections.map((c) => c.port_id),
      performance_table_ids: [],
    },
    configuration_options: [],
    selection_blockers: [],
  };
}

function dataReadiness(connections: AnyRec[]): AnyRec {
  return {
    reviewed_at: new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
    connection_status: connections.length ? "ports_present" : "missing_ports",
    automatic_layout_status: "not_eligible",
    blockers: connections.length ? [] : ["missing_ports"],
  };
}

async function main() {
  const [uRaw, aiRaw, nRaw] = await Promise.all([
    fs.readFile(UNIVERSAL, "utf8"),
    fs.readFile(AI, "utf8"),
    fs.readFile(NORM, "utf8"),
  ]);
  const universal = JSON.parse(uRaw) as { products: AnyRec[]; generated_at?: string };
  const ai = (JSON.parse(aiRaw) as { products: AnyRec[] }).products;
  const norm = (JSON.parse(nRaw) as { products: AnyRec[] }).products;

  const byArt = new Map(
    universal.products.filter((p) => p.article).map((p) => [String(p.article), p]),
  );
  const aiByArt = new Map(
    ai.filter((p) => p.shop_art_nr).map((p) => [String(p.shop_art_nr), p]),
  );
  const normByArt = new Map(
    norm.filter((p) => p.article).map((p) => [String(p.article), p]),
  );

  type Miss = {
    article: string;
    variant: string;
    price_eur: number | null;
    url: string;
    parentGroup: string;
    template: AnyRec | null;
  };
  const missing = new Map<string, Miss>();

  for (const p of universal.products) {
    const src = (p.source || {}) as AnyRec;
    for (const s of (src.sibling_variants as AnyRec[]) || []) {
      const art = s.article ? String(s.article) : "";
      if (!art || byArt.has(art) || missing.has(art)) continue;
      missing.set(art, {
        article: art,
        variant: String(s.variant || ""),
        price_eur: typeof s.price_eur === "number" ? s.price_eur : null,
        url: String(src.source_url || ""),
        parentGroup: String(p.group_id || ""),
        template: p,
      });
    }
  }

  console.log("missing siblings to import:", missing.size);
  const added: string[] = [];

  for (const m of missing.values()) {
    const aiP = aiByArt.get(m.article);
    const nP = normByArt.get(m.article);
    const variant = m.variant || String(aiP?.source_variant || nP?.model || m.article);
    const cls = classifyVariant(variant, m.parentGroup);
    const connections = buildConnections(variant, cls.group_id);
    const attributes = buildAttributes(variant, cls.group_id, cls.subtype_id);

    // Prefer richer attrs from normalized when present
    if (nP?.attributes && typeof nP.attributes === "object") {
      for (const [k, v] of Object.entries(nP.attributes as AnyRec)) {
        if (v != null && attributes[k] == null) attributes[k] = v;
      }
    }
    // Prefer normalized connections if they have thread sizes
    let finalConn = connections;
    if (Array.isArray(nP?.connections) && (nP.connections as AnyRec[]).length) {
      const nc = nP.connections as AnyRec[];
      if (nc.some((c) => c.thread_size_inch || c.nominal_size_mm)) {
        finalConn = nc.map((c) => ({
          ...c,
          thread_standard:
            c.connection_type === "threaded" &&
            (!c.thread_standard ||
              c.thread_standard === "source_not_specified" ||
              c.thread_standard === "variant_not_resolved")
              ? "BSP"
              : c.thread_standard,
        }));
      }
    }

    const hash = crypto.createHash("sha1").update(m.article + variant).digest("hex").slice(0, 8);
    const product_id =
      String(nP?.product_id || "") ||
      `${slugify(cls.series)}_${slugify(variant)}_${hash}`;

    const media = (nP?.media as AnyRec) || {
      images: (aiP?.images as string[]) || (m.template?.media as AnyRec)?.images || [],
      documents: (aiP as AnyRec)?.pdfs || [],
    };

    const nameDe =
      String((nP?.name as AnyRec)?.de || "") ||
      `${String((m.template?.source as AnyRec)?.source_title || "").split("—")[0].trim()} — ${variant}`;

    const card: AnyRec = {
      product_id,
      parent_product_id: null,
      article: m.article,
      manufacturer: nP?.manufacturer ?? m.template?.manufacturer ?? null,
      brand: nP?.brand ?? m.template?.brand ?? null,
      series: cls.series,
      model: variant.slice(0, 80),
      name: { de: nameDe },
      group_id: cls.group_id,
      subtype_id: cls.subtype_id,
      unit: "piece",
      package_quantity: 1,
      lifecycle_status: "active",
      attributes,
      connections: finalConn,
      performance_tables: [],
      compatibility: {
        schema_version: "1.0.0",
        status: finalConn.length ? "ready" : "blocked_missing_ports",
        selection_policy:
          "Use port_matches and requirements. compatible_product_ids alone never proves that an entire assembly is valid.",
        compatible_product_ids: [],
        compatible_group_ids: [],
        conditional_product_ids: [],
        incompatible_product_ids: [],
        direct_product_ids: [],
        functional_product_ids: [],
        port_matches: [],
        requirements: [],
      },
      bom: [],
      media,
      source: {
        source_record_id: String(aiP?.id || nP?.source?.source_record_id || m.article),
        source_name: String(aiP?.scrape || "wasserundgruen"),
        source_url: baseUrl(String(aiP?.url || m.url)),
        source_category: String(
          aiP?.category || (m.template?.source as AnyRec)?.source_category || "",
        ),
        source_title: nameDe,
        source_variant: variant,
      },
      field_status: {},
      provenance: {
        "import": {
          source_type: "shop_variant_expand",
          source_url: baseUrl(m.url),
          document_title: "Imported missing sibling into universal assortment",
          page: null,
        },
      },
      quality: {
        classification_confidence: 0.88,
        extraction_confidence: 0.65,
        calculation_ready: finalConn.length > 0 || cls.group_id === "electrical_accessories" || cls.group_id === "pressure_pipes",
        needs_review: false,
        warnings: [],
        automatic_layout_ready: false,
        automatic_layout_scope: "not_eligible_or_blocked_see_design_selection",
      },
      price_eur: m.price_eur ?? (typeof aiP?.price_eur === "number" ? aiP.price_eur : null),
      price_text:
        typeof aiP?.price_text === "string"
          ? aiP.price_text
          : m.price_eur != null
            ? `${m.price_eur} EUR`
            : null,
      design_selection: designSelection(cls.group_id, attributes, finalConn),
      data_readiness: dataReadiness(finalConn),
    };

    for (const [k, v] of Object.entries(attributes)) {
      (card.field_status as AnyRec)[`attributes.${k}`] = v == null ? "not_found" : "confirmed";
    }

    universal.products.push(card);
    byArt.set(m.article, card);
    added.push(m.article);
  }

  // Relink all sibling_variants across catalog
  let relinked = 0;
  for (const p of universal.products) {
    const src = (p.source || {}) as AnyRec;
    const sibs = src.sibling_variants as AnyRec[] | undefined;
    if (!Array.isArray(sibs)) continue;

    // Rebuild sibling list from same URL family in AI if thin
    const url = baseUrl(String(src.source_url || ""));
    const family = ai.filter((a) => baseUrl(String(a.url || "")) === url && a.shop_art_nr);
    if (family.length > 1) {
      src.sibling_articles = [...new Set(family.map((a) => String(a.shop_art_nr)))];
      src.sibling_variants = family.map((a) => {
        const art = String(a.shop_art_nr);
        const hit = byArt.get(art);
        return {
          article: art,
          variant: a.source_variant || hit?.model || art,
          price_eur: typeof a.price_eur === "number" ? a.price_eur : null,
          product_id: hit ? hit.product_id : null,
          in_assortment: Boolean(hit),
        };
      });
      src.variant_family_url = url;
      if (src.sibling_variants.length > 20) {
        src.sibling_variants_truncated = true;
        src.sibling_variants_total = src.sibling_variants.length;
        src.sibling_variants_preview = (src.sibling_variants as AnyRec[]).slice(0, 12);
      } else {
        delete src.sibling_variants_truncated;
        delete src.sibling_variants_preview;
        delete src.sibling_variants_total;
      }
      relinked++;
    } else {
      for (const s of sibs) {
        const art = s.article ? String(s.article) : "";
        const hit = art ? byArt.get(art) : null;
        s.in_assortment = Boolean(hit);
        s.product_id = hit ? hit.product_id : null;
        relinked++;
      }
    }
    p.source = src;
  }

  // Lightweight port compatibility within universal (same inch + complementary gender + BSP)
  function threadKey(c: AnyRec): string | null {
    if (c.connection_type !== "threaded") return null;
    if (!c.thread_size_inch) return null;
    return `${c.thread_size_inch}|${c.thread_standard || "BSP"}`;
  }

  const portIndex = new Map<string, { pid: string; port: string; gender: string }[]>();
  for (const p of universal.products) {
    for (const c of (p.connections as AnyRec[]) || []) {
      const k = threadKey(c);
      if (!k) continue;
      if (!portIndex.has(k)) portIndex.set(k, []);
      portIndex.get(k)!.push({
        pid: String(p.product_id),
        port: String(c.port_id),
        gender: String(c.thread_gender || ""),
      });
    }
  }

  const complement = (g: string) =>
    g === "male" ? "female" : g === "female" ? "male" : null;

  for (const p of universal.products) {
    const compat = (p.compatibility || {}) as AnyRec;
    const matches: AnyRec[] = [];
    const compatible = new Set<string>();
    for (const c of (p.connections as AnyRec[]) || []) {
      const k = threadKey(c);
      if (!k) continue;
      const want = complement(String(c.thread_gender || ""));
      if (!want) continue;
      for (const t of portIndex.get(k) || []) {
        if (t.pid === p.product_id) continue;
        if (t.gender !== want && t.gender !== "bidirectional" && want !== "bidirectional") continue;
        compatible.add(t.pid);
        matches.push({
          local_port_id: c.port_id,
          target_product_id: t.pid,
          target_port_id: t.port,
          domain: "hydraulic",
          relation_type: "confirmed_threaded_joint",
          status: "confirmed",
          directness: "direct",
          reason_code: "size_gender_bsp_match",
          requirements: ["Both sides BSP with matching size and complementary gender."],
        });
      }
    }
    // keep existing functional matches? replace port_matches for imported hygiene
    if (matches.length) {
      compat.port_matches = matches.slice(0, 80); // cap
      compat.compatible_product_ids = [...compatible].slice(0, 40);
      compat.conditional_product_ids = [];
      compat.status = "ready";
      p.compatibility = compat;
    }
  }

  universal.generated_at = new Date().toISOString();
  await fs.writeFile(UNIVERSAL, JSON.stringify(universal, null, 2) + "\n");

  // Verify no missing siblings left
  const byArt2 = new Map(
    universal.products.filter((p) => p.article).map((p) => [String(p.article), p]),
  );
  let still = 0;
  for (const p of universal.products) {
    for (const s of ((p.source as AnyRec)?.sibling_variants as AnyRec[]) || []) {
      if (s.article && !byArt2.has(String(s.article))) still++;
    }
  }

  console.log(
    JSON.stringify(
      {
        added: added.length,
        total_products: universal.products.length,
        still_missing_sibling_refs: still,
        sample_added: added.slice(0, 20),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
