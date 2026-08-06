/**
 * Expand products_normalized.json from products-ai.json:
 *  - all scrape=gaps (PE-Rohr, Druckminderer, Filter, Kugelhähne)
 *  - BOM-critical families if present in AI
 *
 * Does not remove existing pilot cards. Dedupes by source_record_id.
 *
 * Usage: npx tsx scripts/catalog/expand-normalize.ts
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ConnectionPort,
  FieldStatus,
  NormalizedProduct,
} from "../../lib/catalog/normalize-types";

const RAW_AI = path.resolve("data/raw/products-ai.json");
const OUT = path.resolve("data/catalog/normalized");
const PRODUCTS_FILE = path.join(OUT, "products_normalized.json");

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
  parent_id?: string | null;
  source_variant?: string | null;
  shop_art_nr?: string | null;
  price_eur?: number | null;
  price_text?: string | null;
  shop_product_id?: string | null;
};

type Classified = {
  group_id: string;
  subtype_id: string;
  unit: NormalizedProduct["unit"];
  confidence: number;
  family: string;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

function parseDeNumber(s: string): number | null {
  const m = s.replace(/\s/g, "").match(/(\d+)[,.](\d+)/) || s.match(/(\d+)/);
  if (!m) return null;
  if (m[2] !== undefined) return parseFloat(`${m[1]}.${m[2]}`);
  return parseInt(m[1], 10);
}

function brandOf(src: RawAi): { manufacturer: string | null; brand: string | null } {
  const t = `${src.title} ${src.text}`.toLowerCase();
  if (t.includes("rain bird") || t.includes("rain-bird")) {
    return { manufacturer: "Rain Bird", brand: "Rain Bird" };
  }
  if (t.includes("hunter")) return { manufacturer: "Hunter", brand: "Hunter" };
  if (t.includes("netafim")) return { manufacturer: "Netafim", brand: "Netafim" };
  return { manufacturer: null, brand: null };
}

/**
 * Classify a split SKU from its shop dropdown label (mixed parent pages).
 * Returns null when the variant alone is ambiguous → fall through to title rules.
 */
function classifyVariantLabel(variant: string, parentTitle: string): Classified | null {
  const v = variant;

  // Preassembled kits (spray body + swing + nozzle) — before nozzle/rotor matches
  if (
    /Installation.?Set|1804\s*\+\s*Swing|Swing-?Joint\s*\|.*(?:MP|R-?VAN)|PROS-?\d+\s*\+|PG[PJ].*\+|3504.*\+|5004.*\+/i.test(
      v,
    ) ||
    /XCZ-|Ventil\s*\+.*(?:Druckmind|Filter)|Magnetventil.*(?:Druckmind|Filter)|Filter.*Magnetventil/i.test(v) ||
    /\d+\s*Station(?:en)?\s*\|.*(?:DV-|PGV|HV|Magnetventil)/i.test(v) ||
    /Vormontierte?\s+Einheit/i.test(v)
  ) {
    return {
      group_id: "preassembled_modules",
      subtype_id: /XCZ|Filter|Druckmind/i.test(v)
        ? "valve_filter_kit"
        : /Station|Vormontiert|DV-|PGV/i.test(v)
          ? "valve_manifold"
          : "spray_assembly",
      unit: "piece",
      confidence: 0.9,
      family: "kit",
    };
  }

  // Tools / screwdriver (Falcon Rotortool etc.)
  if (/Rotortool|Schraubendreher|Einstellschlüssel|Werkzeug|Tool\b/i.test(v)) {
    return {
      group_id: "mounting_accessories",
      subtype_id: "installation_tool",
      unit: "piece",
      confidence: 0.95,
      family: "tool",
    };
  }

  // Nozzles by size/color (Falcon Düsen Gr. 04…, Eagle Düse 18 WEISS …)
  // Avoid matching "2-fach" / "4-fach" valve manifolds via bubbler codes 2-H/2-Q
  if (
    /Düsen?\s*Gr\.|Düse\s+\d+|Düse\s+(?:Typ|Gr\.|#)|MSBN|Bubbler|Streifen|Blinddüse|Verschlussdüse|R-?VAN|MP\s?\d{3,4}|MPR\s|Rotator|Rotary.?Düse|Pro-?\s*einstellbar/i.test(
      v,
    ) ||
    (/\b(?:2|4)-[FHQ]\b/i.test(v) && /Düse|Bubbler|Nozzle|MSBN/i.test(v + parentTitle))
  ) {
    return {
      group_id: "nozzles_rotators",
      subtype_id: /Streifen|SST|LCS|RCS/i.test(v)
        ? "strip_nozzle"
        : /Blind|Verschluss/i.test(v)
          ? "blank_nozzle"
          : /Bubbler|MSBN/i.test(v)
            ? "bubbler_nozzle"
            : /MP|R-?VAN|Rotator|Rotary/i.test(v)
              ? "rotary_nozzle"
              : /einstell/i.test(v)
                ? "adjustable_spray_nozzle"
                : "fixed_spray_nozzle",
      unit: "piece",
      confidence: 0.94,
      family: "nozzle",
    };
  }

  // Rotor body variants (Falcon-PC/FC/SS, PGP Ultra, …)
  if (
    /^(?:Falcon|PGP|PGJ|I-?\d{2}|3504|5004|8005|SRM|Eagle|I-40|I-25)(?:-|$|\s)/i.test(v) ||
    (/Falcon-(?:SS-)?(?:PC|FC)|Getrieberegner|Versenkregner/i.test(v) &&
      !/Düse|Rotortool|Gelenk|Zubehör/i.test(v))
  ) {
    return {
      group_id: "rotor_sprinklers",
      subtype_id: "gear_drive_rotor",
      unit: "piece",
      confidence: 0.95,
      family: "rotor",
    };
  }

  // Swing joints / sprinkler riser fittings
  if (/Gelenkanschluss|Swing.?Joint|SPX-?FLEX|Funny.?Pipe|Verlegerohr|Regnergelenk/i.test(v)) {
    return {
      group_id: "sprinkler_connections",
      subtype_id: /Gelenk|Swing/i.test(v) ? "swing_joint" : "funny_pipe",
      unit: "piece",
      confidence: 0.93,
      family: "connection",
    };
  }

  // Water meters
  if (/Wasserzähler|Impulswasser|Flow-B|Durchflussmesser/i.test(v)) {
    return {
      group_id: "sensors",
      subtype_id: "flow_sensor",
      unit: "piece",
      confidence: 0.95,
      family: "meter",
    };
  }

  // Multicore control cable
  if (
    /\d+\s*Adern?\s*Kabel|Steuerkabel|Irricable|Bewässerungskabel/i.test(v) ||
    (/\d+\s*x\s*\d+[,\.]\d+\s*mm/i.test(v) && /Kabel|Ader/i.test(v + parentTitle))
  ) {
    return {
      group_id: "electrical_accessories",
      subtype_id: "control_cable",
      unit: "meter",
      confidence: 0.93,
      family: "cable",
    };
  }

  // Filter / PR (standalone option, not valve+filter kit)
  if (
    (/Scheibenfilter|Siebfilter|Basket|PRF-|Druckminder|PSI-|ACCU-?SYNC|RBY/i.test(v) ||
      /Filter\s+\d/.test(v)) &&
    !/Magnetventil|Ventil\s*\+|100-DV|PGV|DV\s*\+/i.test(v)
  ) {
    return {
      group_id: "filters_pressure_regulators",
      subtype_id: /Druckminder|PSI-|RBY|ACCU/i.test(v) ? "pressure_regulator" : "filter",
      unit: "piece",
      confidence: 0.92,
      family: "filter_pr",
    };
  }

  // PE compression fittings (Winkel/T/Kupplung with mm) — not drip / not valve kits
  if (
    /(?:Winkel|T-Stück|Kupplung|Endkappe|Reduzier|Muffe|Übergang).{0,40}\d{2}\s*mm/i.test(v) &&
    !/Tropf|LDPE|Steck\s*x\s*Steck.*16\s*mm|16\s*mm.*Barbed/i.test(v) &&
    !/Ventil|Magnetventil|100-DV|PGV|Swing|1804|MP\d|Station|Vormontiert|Schutz-Vlies/i.test(v)
  ) {
    return {
      group_id: "pe_compression_fittings",
      subtype_id: /Winkel/i.test(v)
        ? "elbow"
        : /T-Stück/i.test(v)
          ? "tee"
          : /Endkappe|Stopfen/i.test(v)
            ? "end_cap"
            : "coupling",
      unit: "piece",
      confidence: 0.9,
      family: "pe_fitting",
    };
  }

  return null;
}

/** BOM / gap families — plus full shop catalog coverage for rebuild. */
function classify(src: RawAi): Classified | null {
  const title = src.title;
  const variant = (src.source_variant || "").trim();
  // For split SKUs, classify by the dropdown option first (mixed parent pages)
  if (variant) {
    const byVar = classifyVariantLabel(variant, title);
    if (byVar) return byVar;
  }

  const blob = `${src.title}\n${src.category}\n${src.text.slice(0, 800)}`;

  // ——— Solenoid / electric valves BEFORE any Filter match ———
  if (
    /Magnetventil|solenoid|\bPGV\b|\bPGA\b|\bPEB\b|\bIBV\b|\bDVF?\b|\bHV\b/i.test(title) ||
    (/Magnetventil|Ersatzspule|Ersatzmembran/i.test(title) && /Ventil|DV|HV|PGA|PGV/i.test(title))
  ) {
    // Don't let "HC-…" flow meters / water meters hit controller via later rules only —
    // valve kits with PE coupling still valves
    const spare = /Ersatz|Spule|Membran|Hebel|Handführung|Werkzeug/i.test(title);
    return {
      group_id: "valves",
      subtype_id: spare
        ? "valve_spare_part"
        : /PGA|PEB|IBV/i.test(title)
          ? "globe_valve"
          : "solenoid_valve",
      unit: "piece",
      confidence: spare ? 0.75 : 0.93,
      family: spare ? "valve_spare" : "solenoid",
    };
  }

  // Water meters BEFORE controllers (HC-75-Flow vs HC-1201 controller)
  if (/Wasserzähler|Impulswasser|Flow-B|Durchflussmesser|Wassermengen.?Mess/i.test(title)) {
    return {
      group_id: "sensors",
      subtype_id: "flow_sensor",
      unit: "piece",
      confidence: 0.92,
      family: "meter",
    };
  }

  // Controllers
  if (
    /Steuerger|Bewässerungscomputer|Hydrawise|\bESP-|\bTM2\b|\bNode\b|\bX2\b|\bXC-?Hybrid|\bWP\d|\bHC-\d|Pro-HC|HCC-/i.test(
      title,
    ) &&
    !/Wasserzähler|Flow-B|Impuls/i.test(title)
  ) {
    return {
      group_id: "controllers",
      subtype_id: /Decoder|FD-\d/i.test(title)
        ? "decoder"
        : /Batterie|9\s*V|Node|WP|XC-?Hybrid/i.test(title)
          ? "battery_controller"
          : "controller",
      unit: "piece",
      confidence: 0.92,
      family: "controller",
    };
  }

  // Nozzles / rotators
  if (
    /R-?VAN|MP\s?\d{3,4}|MP-?Rotator|MPR\s*Düse|Pro-?\s*einstellbare\s*Düse|Rotationsdü|Rotary.?Düse|Streifendüse|Sprühdüsen-?Set|Blinddüse|Verschlussdüse|Düsen Gr\.|MSBN|Bubbler/i.test(
      title,
    )
  ) {
    return {
      group_id: "nozzles_rotators",
      subtype_id: /Streifen|SST|LCS|RCS|SS\d/i.test(title)
        ? "strip_nozzle"
        : /Blind|Verschluss/i.test(title)
          ? "blank_nozzle"
          : /Bubbler|MSBN/i.test(title)
            ? "bubbler_nozzle"
            : /MP|R-?VAN|Rotator|Rotary/i.test(title)
              ? "rotary_nozzle"
              : /einstell/i.test(title)
                ? "adjustable_spray_nozzle"
                : "fixed_spray_nozzle",
      unit: "piece",
      confidence: 0.92,
      family: "nozzle",
    };
  }

  // Rotor sprinklers
  if (
    (/Getrieberegner|Versenkregner|\bPGP\b|\bPGJ\b|\bI-?\d{2}\b|\b3504\b|\b5004\b|\b8005\b|\bSRM\b|Eagle\s*9|Falcon|I-40|I-25|I-80|702E/i.test(
      title,
    ) ||
      /^5004/i.test(title)) &&
    !/Düse|Nozzle|Gehäuse|Installation.?Set|Werkzeug|Einstell|Verschluss|Zubehör|Rotortool/i.test(title)
  ) {
    return {
      group_id: "rotor_sprinklers",
      subtype_id: "gear_drive_rotor",
      unit: "piece",
      confidence: 0.93,
      family: "rotor",
    };
  }

  // Spray bodies (incl. shop typos Versekdüse)
  if (
    (/180[0246]|1812|Pro-?Spray|PS\s*ULTRA|PSU-0|Versenkdüsengehäuse|Versenksprüh|Versekdüse|Versenkdüse/i.test(
      title,
    ) ||
      /\b1800\b/i.test(title)) &&
    !/MP\d|R-?VAN|Installation.?Set|Rotator|Rotary|Streifendüse|Düse Typ/i.test(title)
  ) {
    return {
      group_id: "spray_bodies",
      subtype_id: /PRS|SAM/i.test(title) ? "spray_body_prs" : "spray_body",
      unit: "piece",
      confidence: 0.9,
      family: "spray_body",
    };
  }

  // Hard PE pressure pipe BEFORE Tropfrohr — category crumbs often contain "Tropfrohr / PE-Rohr"
  if (
    /\bPE\s*Rohr\b|\bPE-Rohr\b/i.test(src.title) &&
    /PE100|PE80|PN\s*10|SDR\s*1[17]|Stange/i.test(src.title + src.text.slice(0, 300)) &&
    !/weich|Tropfrohr|Dripline|ohne Tropfer|Hahn|Kugelhahn|Kupplung|Klemm|Fitting/i.test(src.title)
  ) {
    return {
      group_id: "pressure_pipes",
      subtype_id: "pe_pressure_pipe",
      unit: /Stange/i.test(src.title) ? "piece" : "roll",
      confidence: 0.95,
      family: "pe_pipe",
    };
  }

  if (
    /XFD|XFS-?CV|\bXFS\b|Dripline/i.test(src.title + src.text.slice(0, 400)) ||
    (/Tropfrohr/i.test(src.title) && !/\bPE\s*Rohr\b|\bPE-Rohr\b/i.test(src.title))
  ) {
    return {
      group_id: "drip_irrigation",
      subtype_id: "dripline",
      unit: /Meterware|\/m\b/i.test(blob) ? "meter" : "roll",
      confidence: 0.9,
      family: "tropfrohr",
    };
  }

  // Micro irrigation accessories
  if (
    /JET\s*SPIKE|Micro-?Sprüher|Microschlauch|Tropfer\b|XB-?\d|XBCV|Multi-Auslass|SPB025|PFR Bodenspie|Erdspieß.*Tropf|Locherzange|XM-Tool|EMA-GPX/i.test(
      title,
    )
  ) {
    return {
      group_id: "drip_irrigation",
      subtype_id: /Tropfer|XB-|XBCV|Multi-Auslass/i.test(title)
        ? "drip_emitter"
        : /Microschlauch/i.test(title)
          ? "micro_tubing"
          : "drip_accessory",
      unit: "piece",
      confidence: 0.85,
      family: "drip_acc",
    };
  }

  if (/Anbohrschelle/i.test(blob)) {
    return {
      group_id: "pe_compression_fittings",
      subtype_id: "saddle",
      unit: "piece",
      confidence: 0.95,
      family: "anbohr",
    };
  }
  // Flow / pressure meters before any Hahn-match (Hahnanschluss ≠ Absperrhahn)
  if (
    /Wasserzähler|Wassermengen.?Mess|Druck-?\s*und\s*Wassermengen|Messgerät|Impulswasser|Durchflusssensor|Flow.?Sensor|Flow-?Clik|FG-?\d/i.test(
      title + "\n" + src.category,
    )
  ) {
    return {
      group_id: "sensors",
      subtype_id: /Druck/i.test(title) && /Wasser/i.test(title) ? "flow_pressure_meter" : "flow_sensor",
      unit: "piece",
      confidence: 0.9,
      family: "meter",
    };
  }
  if (/\bLangnippel\b|Nippel.*AG\s*x\s*AG/i.test(title)) {
    return {
      group_id: "threaded_fittings_manifolds",
      subtype_id: "nipple",
      unit: "piece",
      confidence: 0.88,
      family: "pp_fitting",
    };
  }
  if (/Kugelhahn|Absperrhahn|Absperrventil/i.test(blob)) {
    return {
      group_id: "valves",
      subtype_id: "manual_ball_valve",
      unit: "piece",
      confidence: 0.9,
      family: "kugelhahn",
    };
  }
  if (
    /Klemmverschraubung|PE.?Klemm|Klemmkupplung|Klemmwinkel|Winkel PE|Kupplung.*PE|PE.*Kupplung|T-Stück PE|PE.*T-Stück|Endkappe|Reduziermuffe|Reduzier.*Klemm|Flansch.*Klemm|Klemm.*Flansch/i.test(
      blob,
    )
  ) {
    let subtype = "coupling";
    if (/Winkel|Elbow/i.test(blob)) subtype = "elbow";
    else if (/T-Stück|T-Stueck|\bTee\b/i.test(blob)) subtype = "tee";
    else if (/Endkappe|Endstopfen|Cap/i.test(blob)) subtype = "end_cap";
    else if (/Reduz/i.test(blob)) subtype = "reducer";
    else if (/Anbohr/i.test(blob)) subtype = "saddle";
    else if (/Flansch/i.test(blob)) subtype = "adapter";
    return {
      group_id: "pe_compression_fittings",
      subtype_id: subtype,
      unit: "piece",
      confidence: 0.9,
      family: "klemm",
    };
  }
  // Soft PE / PE-Weich (not hard PE100 pressure pipe)
  if (
    (/PE-?Weich|PE Rohr weich|ohne Tropfer|Weiches PE/i.test(src.title) ||
      (/PE.?16/i.test(src.title) && /weich/i.test(src.title))) &&
    !/Fitting|Kupplung|Winkel|T-Stück|Hahn/i.test(src.title)
  ) {
    return {
      group_id: "pressure_pipes",
      subtype_id: "pe_soft_pipe",
      unit: "roll",
      confidence: 0.85,
      family: "pe16",
    };
  }
  if (/SPX-?FLEX|Funny.?Pipe|Swing.?Joint|SBE0|SBA0|SJ-\d|Blu-Lock|WING-JOINT/i.test(blob)) {
    return {
      group_id: "sprinkler_connections",
      subtype_id: /Swing|SJ-|WING/i.test(blob) ? "swing_joint" : "flexible_riser",
      unit: "piece",
      confidence: 0.9,
      family: "swing",
    };
  }
  if (/Ventilverteiler|PVC Verteiler\s*[234]\s*Fach|PVC Verschraubung/i.test(blob)) {
    return {
      group_id: "threaded_fittings_manifolds",
      subtype_id: /Verteiler/i.test(blob) ? "manifold" : "threaded_fitting",
      unit: "piece",
      confidence: 0.9,
      family: "verteiler",
    };
  }
  // Filters / PRV — title-based; ignore "Filter" only in body for non-filters
  if (
    (/Druckminder|Druckregler|PSI-M|PMR-|ACCU.?SYNC/i.test(title) || /PRF-/i.test(title)) &&
    !/Filter/i.test(title)
  ) {
    return {
      group_id: "filters_pressure_regulators",
      subtype_id: "pressure_regulator",
      unit: "piece",
      confidence: 0.9,
      family: "prv",
    };
  }
  if (
    /Filter|RBY|Scheibenfilter|Basket Filter|Schmutzfänger|Siebfilter/i.test(title) ||
    (/Filter|RBY|Scheibenfilter|Basket Filter|Schmutzfänger/i.test(blob) &&
      !/Magnetventil|Düse|Regner|Steuerger|Getriebe/i.test(title))
  ) {
    const combo = /Druckminder|PRF-|druckgeregelt/i.test(blob);
    return {
      group_id: "filters_pressure_regulators",
      subtype_id: combo ? "filter_regulator" : /Scheibe|disc/i.test(blob) ? "disc_filter" : "screen_filter",
      unit: "piece",
      confidence: 0.88,
      family: "filter",
    };
  }
  if (
    /Ventilbox|Ventilkasten/i.test(src.title) ||
    (/Ventilbox|Ventilkasten/i.test(blob) && !/Filter|PRF-|RBY|XCZ|Magnetventil/i.test(src.title))
  ) {
    return {
      group_id: "valve_boxes",
      subtype_id: /rund|round|oval/i.test(blob) ? "round_valve_box" : "rectangular_valve_box",
      unit: "piece",
      confidence: 0.93,
      family: "boxes",
    };
  }
  if (/vormontiert|Profi-Set|Ventileinheit|XCZ|Installation.?Set/i.test(blob) && /Ventil|Magnet|Regner|Spray|Swing/i.test(blob)) {
    return {
      group_id: "preassembled_modules",
      subtype_id: /XCZ|Tropf|drip/i.test(blob)
        ? "drip_control_zone_kit"
        : /Installation.?Set/i.test(title)
          ? "installation_kit"
          : "valve_manifold_assembly",
      unit: "set",
      confidence: 0.88,
      family: "preassembled",
    };
  }
  if (/Rückschlag|Check.?Valve|HCV-/i.test(blob)) {
    return {
      group_id: "valves",
      subtype_id: "check_valve",
      unit: "piece",
      confidence: 0.9,
      family: "check",
    };
  }
  if (/Entleer|Drain.?Valve|Einwinterung|Druckluftanschluss/i.test(blob)) {
    return {
      group_id: "mounting_accessories",
      subtype_id: "winterization_adapter",
      unit: "piece",
      confidence: 0.85,
      family: "winter",
    };
  }
  if (/Regensensor|Rain.?Clik|Rain.?Sensor|RSD-|Wind.?Clik|Windsensor/i.test(blob)) {
    return {
      group_id: "sensors",
      subtype_id: /Wind/i.test(title) ? "wind_sensor" : "rain_sensor",
      unit: "piece",
      confidence: 0.92,
      family: "sensors",
    };
  }
  if (/Bodenfeuchte|Soil.?Sensor|Feuchtesensor|SMRT/i.test(blob)) {
    return {
      group_id: "sensors",
      subtype_id: "soil_moisture_sensor",
      unit: "piece",
      confidence: 0.9,
      family: "sensors",
    };
  }
  // (flow meters handled earlier — before Kugelhahn)
  if (/Gel.?Kabel|DBM|Gelverbinder|wasserdichte.*Verbinder/i.test(blob)) {
    return {
      group_id: "electrical_accessories",
      subtype_id: "waterproof_connector",
      unit: "piece",
      confidence: 0.9,
      family: "cable",
    };
  }
  if (/Steuerkabel|Bewässerungskabel|Direct.?Burial|Erdkabel|Decoder|\d+\s*Adern?\s*Kabel/i.test(blob)) {
    return {
      group_id: /Decoder/i.test(title) ? "controllers" : "electrical_accessories",
      subtype_id: /Decoder/i.test(title) ? "decoder" : "control_cable",
      unit: /Kabel/i.test(title) ? "meter" : "piece",
      confidence: 0.88,
      family: /Decoder/i.test(title) ? "controller" : "cable",
    };
  }
  if (/Manometer|Druckmesser/i.test(blob)) {
    return {
      group_id: "mounting_accessories",
      subtype_id: "pressure_gauge",
      unit: "piece",
      confidence: 0.9,
      family: "meter",
    };
  }
  if (/Lock.*(Kupplung|Winkel|T-Stück|Fitting|End)|BF-\d|16 mm.*Fitting|Endverschluss/i.test(blob)) {
    return {
      group_id: "drip_irrigation",
      subtype_id: "drip_fitting",
      unit: "piece",
      confidence: 0.85,
      family: "pe16_fitting",
    };
  }

  // Tools / stakes / flags / wifi modules
  if (
    /Werkzeug|Einstellschlüssel|Rotortool|Markierungsfahne|Wifi|WLAN|LNK|Aufsteigerhalter|Zange|STAKE|Erdspieß|ECO-ID|Pumpenstart|PSR-/i.test(
      title,
    )
  ) {
    return {
      group_id: "mounting_accessories",
      subtype_id: /Wifi|WLAN|LNK/i.test(title)
        ? "controller_accessory"
        : /Werkzeug|Schlüssel|Tool|Zange/i.test(title)
          ? "installation_tool"
          : "mounting_accessory",
      unit: "piece",
      confidence: 0.8,
      family: "accessory",
    };
  }

  // Catch-all — keep every scraped SKU in the catalog
  return {
    group_id: "mounting_accessories",
    subtype_id: "other",
    unit: "piece",
    confidence: 0.55,
    family: "other",
  };
}

function shouldInclude(_src: RawAi, cls: Classified | null): boolean {
  return cls != null;
}

function extractAttrs(
  src: RawAi,
  cls: Classified,
): {
  attributes: Record<string, unknown>;
  field_status: Record<string, FieldStatus>;
  connections: ConnectionPort[];
  warnings: string[];
} {
  const attributes: Record<string, unknown> = {};
  const field_status: Record<string, FieldStatus> = {};
  const connections: ConnectionPort[] = [];
  const warnings: string[] = [];
  // Prefer variant label for size-specific specs (parent text lists ALL options)
  const variantFocus = [src.source_variant, src.title.split(" — ").slice(1).join(" — ")]
    .filter(Boolean)
    .join("\n");
  const blob = `${variantFocus}\n${src.title}\n${src.text}`;
  const focus = variantFocus || src.title;

  const set = (k: string, v: unknown, status: FieldStatus = "confirmed") => {
    attributes[k] = v;
    field_status[`attributes.${k}`] = v == null ? "not_found" : status;
  };

  const odFrom = (s: string) => {
    const m =
      s.match(/PE[-\s]?(?:Anschluss|Rohr)?\s*(\d{2})\s*mm/i) ||
      s.match(/\b(\d{2})\s*x\s*(?:\d{2}|1\/|\d)/i) ||
      s.match(/\b(\d{2})\s*mm\b/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return [16, 20, 25, 32, 40, 50, 63, 75, 90, 110].includes(n) ? n : null;
  };
  const od = odFrom(focus) ?? odFrom(blob);
  const bar = focus.match(/PN\s*(\d{1,2})|(\d{1,2})\s*bar/i) || blob.match(/PN\s*(\d{1,2})|(\d{1,2})\s*bar/i);
  const sdr = blob.match(/SDR\s*(1[17](?:[.,]6)?)/i);
  const mesh = blob.match(/(\d+)\s*mesh/i);
  const micron = blob.match(/(\d+)\s*Micron/i);
  const outlets = blob.match(/(\d+)\s*Fach/i);
  const stations = focus.match(/(\d+)\s*(?:Zonen|Stationen|Auslässe)/i) || blob.match(/(\d+)\s*(?:Zonen|Stationen|Auslässe)/i);

  /** Thread / size from variant (¾", 1", 1¼", 1½", 2"). */
  const threadInch = (() => {
    const s = focus;
    if (/1\s*1\/2|"\s*1\s*1\/2|1½|11\/2/i.test(s)) return 1.5;
    if (/1\s*1\/4|"\s*1\s*1\/4|1¼|11\/4/i.test(s)) return 1.25;
    if (/2\s*"|\b2\s*Zoll/i.test(s) && !/1\s*1\/[24]/.test(s)) return 2;
    if (/3\/4|"\s*3\/4|¾/i.test(s)) return 0.75;
    if (/\b1\s*"|\b1\s*Zoll|(?:^|[^\d\/])1["“]/i.test(s) && !/1\s*1\//.test(s)) return 1;
    return null;
  })();

  if (cls.group_id === "pressure_pipes") {
    set("material", /PE100/i.test(blob) ? "PE100" : /PE80/i.test(blob) ? "PE80" : "PE");
    set("outer_diameter_mm", od);
    set("wall_thickness_mm", null);
    set("internal_diameter_mm", null);
    set("sdr", sdr ? sdr[1].replace(",", ".") : null);
    set("pressure_rating_bar", bar ? parseInt(bar[1] || bar[2], 10) : null);
    set("roughness_coefficient", null);
    const len = focus.match(/(\d+)\s*m\s*\/\s*Rolle|(\d+)\s*m\/Rolle/i) || blob.match(/(\d+)\s*m\s*\/\s*Rolle|(\d+)\s*m\/Rolle|Rollenlänge[:\s]*(\d+)/i);
    set("length_m", len ? parseInt(len[1] || len[2] || len[3], 10) : null);
    set("potable_water_approved", /Trinkwasser|DVGW|blau/i.test(blob) ? true : null);
    if (attributes.outer_diameter_mm) {
      connections.push({
        port_id: "pipe",
        role: "bidirectional",
        connection_type: "pe_compression",
        nominal_size_mm: attributes.outer_diameter_mm as number,
        thread_size_inch: null,
        thread_gender: "not_applicable",
        thread_standard: "not_applicable",
      });
    }
  } else if (cls.group_id === "drip_irrigation") {
    if (cls.subtype_id === "dripline") {
      set("outer_diameter_mm", /16\s*mm|Ø\s*16/i.test(focus) ? 16 : od);
      set("inner_diameter_mm", null);
      const flow = focus.match(/([\d,]+)\s*l\s*\/\s*h/i) || blob.match(/([\d,]+)\s*l\s*\/\s*h/i);
      set("emitter_flow_l_h", flow ? parseDeNumber(flow[1]) : null);
      const spacing = blob.match(/Abstand\s*([\d,]+)\s*cm/i);
      set("emitter_spacing_m", spacing ? (parseDeNumber(spacing[1]) ?? 0) / 100 : null);
      set("pressure_compensating", /XFD|PC|druckkompens/i.test(blob) ? true : null);
      set("pressure_min_bar", null);
      set("pressure_max_bar", bar ? parseInt(bar[1] || bar[2], 10) : null);
      const coil = blob.match(/(\d+)\s*m/);
      set("coil_length_m", coil ? parseInt(coil[1], 10) : null);
      set("sold_by_meter", /Meterware/i.test(blob));
    } else {
      set("outer_diameter_mm", 16);
      set("inner_diameter_mm", null);
      set("emitter_flow_l_h", null);
      set("emitter_spacing_m", null);
      set("pressure_compensating", null);
      set("pressure_min_bar", null);
      set("pressure_max_bar", null);
      set("coil_length_m", null);
      set("sold_by_meter", null);
    }
  } else if (cls.group_id === "pe_compression_fittings") {
    set("shape", cls.subtype_id === "elbow" ? "elbow" : cls.subtype_id === "tee" ? "tee" : cls.subtype_id === "end_cap" ? "end_cap" : cls.subtype_id === "saddle" ? "adapter" : cls.subtype_id === "reducer" ? "reducer" : "straight");
    set("angle_deg", cls.subtype_id === "elbow" ? 90 : null);
    set("pressure_rating_bar", /PN16|16\s*bar/i.test(focus + blob) ? 16 : /PN10|10\s*bar/i.test(focus + blob) ? 10 : null);
    set("body_material", /Messing|brass/i.test(blob) ? "brass" : "pp");
    set("seal_material", null);
    set("uv_resistant", null);
    set("potable_water_approved", null);
    set("manufacturing_standard", null);
    set("country_of_origin", null);
    // Store OD via connection — also put on a common attr if schema had it; connections carry size
    const mm = od;
    if (mm) {
      connections.push({
        port_id: "a",
        role: "bidirectional",
        connection_type: "pe_compression",
        nominal_size_mm: mm,
        thread_size_inch: threadInch != null ? `${threadInch}"` : null,
        thread_gender: /\bIG\b|Innengewinde/i.test(focus)
          ? "female"
          : /\bAG\b|Außengewinde|Aussengewinde/i.test(focus)
            ? "male"
            : "not_applicable",
        thread_standard: threadInch != null ? "BSP" : "not_applicable",
      });
    }
  } else if (cls.group_id === "filters_pressure_regulators") {
    set("filtration_micron", micron ? parseInt(micron[1], 10) : null);
    set("filtration_mesh", mesh ? parseInt(mesh[1], 10) : null);
    set("filter_element_type", /Scheibe|disc/i.test(blob) ? "disc" : /Sieb|screen|Basket/i.test(blob) ? "screen" : null);
    set("pressure_min_bar", null);
    set("pressure_max_bar", null);

    // Regulated pressure: prefer variant label ("2,1 bar", "2,8 bar")
    const regFocus =
      focus.match(/([\d,]+)\s*bar/i) ||
      blob.match(/(?:PSI-M?|auf\s*|Druckregulierender[^0-9]{0,40})([\d,]+)\s*bar/i);
    set(
      "regulated_pressure_bar",
      cls.subtype_id.includes("regulator") || cls.subtype_id.includes("filter_regulator")
        ? regFocus
          ? parseDeNumber(regFocus[1])
          : null
        : null,
    );

    // Flow: prefer m³/h on the variant line; else map Scheibenfilter size → published flows
    let flowM3: number | null = null;
    const flowFocus = focus.match(/([\d,]+)\s*m\s*[³3]\s*\/\s*h/i);
    if (flowFocus) flowM3 = parseDeNumber(flowFocus[1]);
    if (flowM3 == null && /Scheibenfilter|disc.?filter/i.test(blob)) {
      if (threadInch === 1.5) flowM3 = 10;
      else if (threadInch === 1) flowM3 = 5;
      else if (threadInch === 0.75) flowM3 = 4;
      else if (threadInch === 2) {
        const m2 = focus.match(/([\d,]+)\s*[-–]\s*([\d,]+)\s*m/) || blob.match(/([\d,]+)\s*[-–]\s*([\d,]+)\s*m\s*[³3]/i);
        flowM3 = m2 ? parseDeNumber(m2[2]) : 20;
      }
    }
    if (flowM3 == null) {
      const flowBlob = blob.match(/([\d,]+)\s*m\s*³?\s*\/\s*h|([\d,]+)\s*m3\/h/i);
      if (flowBlob) flowM3 = parseDeNumber(flowBlob[1] || flowBlob[2]);
    }
    set(
      "flow_max_l_min",
      flowM3 != null ? Math.round(((flowM3 * 1000) / 60) * 100) / 100 : null,
    );

    if (od && /PE\s*Anschluss|PE-?\d{2}|mit PE/i.test(focus)) {
      connections.push({
        port_id: "pe",
        role: "bidirectional",
        connection_type: "pe_compression",
        nominal_size_mm: od,
        thread_size_inch: null,
        thread_gender: "not_applicable",
        thread_standard: "not_applicable",
      });
    }
    if (threadInch != null) {
      connections.push({
        port_id: "thread",
        role: "bidirectional",
        connection_type: "threaded",
        nominal_size_mm: null,
        thread_size_inch: `${threadInch}"`,
        thread_gender: /\bIG\b|Innengewinde/i.test(focus)
          ? "female"
          : /\bAG\b|Außengewinde|Aussengewinde/i.test(focus)
            ? "male"
            : null,
        thread_standard: "BSP",
      });
    }
  } else if (cls.group_id === "valves") {
    const electric = /Magnet|solenoid|24\s*V|9\s*V|VAC|VDC|PGA|PGV|HV|DV/i.test(blob);
    set("actuation_type", electric ? "electric" : "manual");
    set("normal_state", /NC|normally closed|stromlos geschlossen/i.test(blob) ? "NC" : null);
    set(
      "coil_voltage_v",
      /9\s*V/i.test(focus) ? 9 : /24\s*V/i.test(focus) ? 24 : /9\s*V/i.test(blob) ? 9 : /24\s*V/i.test(blob) ? 24 : electric ? 24 : null,
    );
    set("coil_current_inrush_a", null);
    set("coil_current_holding_a", null);
    set("pressure_min_bar", null);
    set("pressure_max_bar", /PN16|16\s*bar/i.test(blob) ? 16 : /3\s*Bar/i.test(blob) ? 3 : /10\s*bar|PN10/i.test(blob) ? 10 : null);
    set("flow_min_l_min", null);
    set("flow_max_l_min", null);
    set("flow_control_present", /Durchflussreg|Flow.?Control|DVF|PGV.*[Ff]low/i.test(blob));
    set("manual_opening", true);
    set("body_material", /Messing|brass/i.test(blob) ? "brass" : /PVC|PP|Kunststoff/i.test(blob) ? "plastic" : null);
  } else if (cls.group_id === "nozzles_rotators") {
    // Parse ONLY from variant/title focus — parent pages list ALL nozzle options
    const stripPair = focus.match(/([\d,]+)\s*[x×]\s*([\d,]+)\s*m/i);
    const radiusPair =
      !stripPair &&
      (focus.match(/Wurfweite\s*([\d,]+)\s*(?:bis|-|–)\s*([\d,]+)\s*m/i) ||
        focus.match(/([\d,]+)\s*[-–]\s*([\d,]+)\s*m(?!\s*[³3])/i));
    const arcPair =
      focus.match(/Sektor\s*([\d,]+)\s*(?:bis|-|–)\s*([\d,]+)\s*°/i) ||
      focus.match(/([\d,]+)\s*[-–]\s*([\d,]+)\s*°/) ||
      focus.match(/(\d+)\s*-\s*(\d+)\s*°/);
    const flowM3 = focus.match(/([\d,]+)\s*m\s*[³3]\s*\/\s*h/i);
    const nozzleSize =
      focus.match(/Düsen?\s*Gr\.?\s*(\d+)/i) ||
      focus.match(/Düse\s+(\d+)/i) ||
      focus.match(/\b(?:MP|R-?VAN)\s*(\d+)/i);
    const isStrip = /Streifen|strip|SST|LCS|RCS|SS\d|MPSS/i.test(focus) || !!stripPair;

    set(
      "pattern_type",
      isStrip ? "strip" : /Bubbler|MSBN/i.test(focus) ? "bubbler" : /360|Vollkreis|FC\b/i.test(focus) ? "full_circle" : "arc",
    );
    set("arc_adjustable", /einstell|adjust|45\s*(?:bis|-)|Sektor/i.test(focus) ? true : null);
    set("arc_min_deg", arcPair ? parseDeNumber(arcPair[1]) : /360/i.test(focus) ? 360 : null);
    set("arc_max_deg", arcPair ? parseDeNumber(arcPair[2]) : /360/i.test(focus) ? 360 : null);
    set("radius_min_m", radiusPair ? parseDeNumber(radiusPair[1]) : null);
    set("radius_max_m", radiusPair ? parseDeNumber(radiusPair[2]) : null);
    set("pressure_min_bar", null);
    set("pressure_max_bar", null);
    set("pressure_recommended_bar", null);
    set("precipitation_rate_mm_h", null);
    set("strip_width_m", stripPair ? parseDeNumber(stripPair[1]) : null);
    set("strip_length_m", stripPair ? parseDeNumber(stripPair[2]) : null);
    set("matched_precipitation", /MPR|matched/i.test(focus) ? true : null);
    set("nozzle_thread_type", /female|IG|Innen/i.test(focus) ? "female" : null);
    void nozzleSize;
    void flowM3;
  } else if (cls.group_id === "rotor_sprinklers") {
    // Radius only from variant/title focus — parent pages list all nozzle radii
    const radiusPair =
      focus.match(/([\d,]+)\s*[-–]\s*([\d,]+)\s*m(?!\s*[³3])/i) ||
      focus.match(/Wurfweite[:\s]*([\d,]+)\s*(?:bis|-|–)\s*([\d,]+)\s*m/i);
    const isFc = /Vollkreis|\bFC\b/i.test(focus) && !/\bPC\b|Teilkreis/i.test(focus);
    const isPc = /\bPC\b|Teilkreis|part.?circle|40\s*[°o]\s*[-–]/i.test(focus);
    set("arc_adjustable", isFc ? false : true);
    set("arc_min_deg", isFc ? 360 : isPc ? 40 : null);
    set("arc_max_deg", isFc ? 360 : isPc ? 360 : null);
    set("full_circle_supported", isFc || isPc || /360|Vollkreis|FC/i.test(focus) ? true : null);
    set("radius_min_m", radiusPair ? parseDeNumber(radiusPair[1]) : null);
    set("radius_max_m", radiusPair ? parseDeNumber(radiusPair[2]) : null);
    set("pressure_min_bar", null);
    set("pressure_max_bar", null);
    set("pressure_recommended_bar", null);
    set("pop_up_height_mm", /6504|Falcon/i.test(focus + src.title) ? 100 : null);
    set("check_valve_present", /SAM|Auslaufsperr|check/i.test(focus) ? true : null);
    set("trajectory_deg", null);
    set("stainless_riser", /Edelstahl|SS-PC|SS-FC|(?:^|[\s-])SS(?:-|$|\s)/i.test(focus) ? true : false);
    set("nozzles_included", /Düsensatz|nozzle.?set|Standarddüse/i.test(focus) ? true : /Falcon-(?:SS-)?(?:PC|FC)/i.test(focus) ? false : null);
    set("check_valve_max_elevation_m", null);

    // Official Rain Bird Falcon 6504 tech spec (rainbird.com) — body SKUs only
    if (/Falcon-(?:SS-)?(?:PC|FC)/i.test(focus) && /6504|Falcon/i.test(src.title)) {
      if (attributes.radius_min_m == null) set("radius_min_m", 11.3);
      if (attributes.radius_max_m == null) set("radius_max_m", 19.8);
      if (attributes.pressure_min_bar == null) set("pressure_min_bar", 2.1);
      if (attributes.pressure_max_bar == null) set("pressure_max_bar", 6.2);
      set("pop_up_height_mm", 100);
      set("trajectory_deg", 25);
      set("check_valve_present", true);
      set("check_valve_max_elevation_m", 3.1);
      set("nozzles_included", false);
    }
  } else if (cls.group_id === "spray_bodies") {
    set("pop_up_height_mm", /12\s*cm|1812|PROS-?12/i.test(blob) ? 120 : /15\s*cm|06\b|1806|PROS-?06/i.test(blob) ? 150 : /10\s*cm|1804|PROS-?04|PSU-?04/i.test(blob) ? 100 : null);
    set("pressure_max_bar", null);
    set("check_valve_present", /SAM|Auslaufsperr/i.test(blob));
    set("pressure_regulation_bar", /PRS.?45|3[,.]1\s*bar/i.test(blob) ? 3.1 : /PRS.?30|2[,.]1\s*bar/i.test(blob) ? 2.1 : /PRS.?40/i.test(blob) ? 2.8 : null);
    set("inlet_thread_inch", /1\/2|½/i.test(blob) ? '1/2"' : null);
    set("side_inlet", /Seitenanschluss|side.?inlet/i.test(blob) ? true : null);
  } else if (cls.group_id === "controllers") {
    set("station_count", stations ? parseInt(stations[1], 10) : null);
    set("supply_voltage_v", /230\s*V|220/i.test(blob) ? 230 : /24\s*V/i.test(blob) ? 24 : /9\s*V/i.test(blob) ? 9 : null);
    set("output_voltage_v", /24\s*V/i.test(blob) ? 24 : /9\s*V/i.test(blob) ? 9 : null);
    set("wifi", /Wifi|WLAN|Wi-?Fi|Hydrawise|LNK/i.test(blob));
    set("outdoor_rated", /Outdoor|Aussen|Außen/i.test(blob) ? true : /Indoor|Innen/i.test(blob) ? false : null);
    set("modular", /modular|Erweiter/i.test(blob) ? true : null);
    set("battery_powered", /Batterie|9\s*VDC|Node|WP/i.test(blob));
  } else if (cls.group_id === "valve_boxes") {
    const dims = blob.match(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/i);
    set("outer_length_mm", dims ? parseInt(dims[1], 10) : null);
    set("outer_width_mm", dims ? parseInt(dims[2], 10) : null);
    set("outer_height_mm", dims ? parseInt(dims[3], 10) : null);
    set("outer_diameter_mm", null);
    set("max_valve_count", null);
    set("lid_load_class", null);
    set("body_material", null);
    set("base_included", null);
  } else if (cls.group_id === "threaded_fittings_manifolds") {
    set("shape", "manifold");
    set("outlet_count", outlets ? parseInt(outlets[1], 10) : stations ? parseInt(stations[1], 10) : null);
    set("union_present", /Überwurf|Ueberwurf/i.test(blob));
    set("pressure_rating_bar", null);
    set("body_material", /PVC/i.test(blob) ? "PVC" : null);
    set("seal_material", null);
    set("seal_included", null);
  } else if (cls.group_id === "sprinkler_connections") {
    set("material", null);
    set("length_m", (() => {
      const m = blob.match(/(\d+)\s*cm/);
      return m ? parseInt(m[1], 10) / 100 : null;
    })());
    set("angle_deg", null);
    set("pressure_rating_bar", null);
    set("flexible", true);
  } else if (cls.group_id === "sensors") {
    set("measurement_type", /Wasserzähler|Flow|Durchfluss|Impuls/i.test(focus + blob) ? "flow" : cls.subtype_id.replace("_sensor", "").replace("rain", "rain"));
    set("wired", !/Funk|wireless|wireless/i.test(blob));
    set("wireless", /Funk|wireless/i.test(blob));
    set("supply_voltage_v", /24\s*V/i.test(blob) ? 24 : /9\s*V/i.test(blob) ? 9 : null);
    set("cable_length_m", null);
    if (threadInch != null) {
      connections.push({
        port_id: "meter",
        role: "bidirectional",
        connection_type: "threaded",
        nominal_size_mm: null,
        thread_size_inch: `${threadInch}"`,
        thread_gender: /\bIG\b|Innengewinde/i.test(focus)
          ? "female"
          : /\bAG\b|Außengewinde|Aussengewinde/i.test(focus)
            ? "male"
            : null,
        thread_standard: "BSP",
      });
    }
  } else if (cls.group_id === "electrical" || cls.group_id === "electrical_accessories") {
    const conductors = focus.match(/(\d+)\s*Adern?/i) || blob.match(/(\d+)\s*Adern?/i);
    const rollLen = focus.match(/(\d+)\s*m\s*\/\s*Rolle/i) || blob.match(/(\d+)\s*m\s*\/\s*Rolle/i);
    const cross = focus.match(/(\d+[,\.]\d+)\s*mm²|(\d+[,\.]\d+)\s*mm2/i);
    set("conductor_count", conductors ? parseInt(conductors[1], 10) : null);
    set("conductor_cross_section_mm2", cross ? parseDeNumber(cross[1] || cross[2]) : null);
    set("length_m", rollLen ? parseInt(rollLen[1], 10) : null);
    set("direct_burial_allowed", /Erd|Direct.?Burial|Erdverlegung/i.test(blob) ? true : null);
    set("waterproof", /Gel|wasserdicht|DBM/i.test(blob) ? true : null);
    set("voltage_rating_v", null);
  } else if (cls.group_id === "preassembled_modules") {
    set("function", /Tropf|XCZ|drip/i.test(blob) ? "drip_control_zone" : "valve_manifold");
    set("zone_count", stations ? parseInt(stations[1], 10) : outlets ? parseInt(outlets[1], 10) : null);
    set("preassembled", true);
    set("installation_ready", true);
    set("included_filter", /Filter/i.test(blob));
    set("included_pressure_regulator", /Druckminder|PRF|PRS/i.test(blob));
    set("included_winterization", false);
  } else if (cls.group_id === "mounting_accessories") {
    set("material", /Messing/i.test(blob) ? "brass" : null);
    set("compatible_diameter_mm", od);
  }

  if (cls.confidence < 0.7) warnings.push("low_classification_confidence");
  return { attributes, field_status, connections, warnings };
}

function toProduct(src: RawAi, cls: Classified): NormalizedProduct {
  const b = brandOf(src);
  const extracted = extractAttrs(src, cls);
  const filled = Object.values(extracted.attributes).filter((v) => v != null).length;
  const total = Object.keys(extracted.attributes).length || 1;
  const hash = crypto.createHash("sha1").update(src.id).digest("hex").slice(0, 8);
  const product_id = `${slugify(cls.family)}_${slugify(src.title).slice(0, 40)}_${hash}`;

  const missingCritical = Object.entries(extracted.attributes)
    .filter(([, v]) => v == null)
    .map(([k]) => k)
    .filter((k) =>
      ["outer_diameter_mm", "pressure_rating_bar", "actuation_type", "shape", "regulated_pressure_bar"].includes(k),
    );

  const warnings = [...extracted.warnings];
  if (missingCritical.length) warnings.push(`missing_critical:${missingCritical.join(",")}`);

  const calculation_ready =
    cls.confidence >= 0.8 &&
    missingCritical.filter((k) =>
      ["actuation_type", "outer_diameter_mm", "shape"].includes(k),
    ).length === 0;

  const provenance: NormalizedProduct["provenance"] = {};
  if (/Falcon-(?:SS-)?(?:PC|FC)/i.test(src.source_variant || "") && /6504|Falcon/i.test(src.title)) {
    for (const k of [
      "radius_min_m",
      "radius_max_m",
      "pressure_min_bar",
      "pressure_max_bar",
      "pop_up_height_mm",
      "trajectory_deg",
      "check_valve_present",
      "check_valve_max_elevation_m",
    ]) {
      if (extracted.attributes[k] != null) {
        provenance[`attributes.${k}`] = {
          source_type: "manufacturer_datasheet",
          source_url: "https://www.rainbird.com/products/falcon-6504-series",
          document_title: "Rain Bird Falcon 6504 Series tech spec",
          page: null,
        };
      }
    }
  }

  return {
    product_id,
    parent_product_id: null,
    article: src.shop_art_nr ?? null,
    manufacturer: b.manufacturer,
    brand: b.brand,
    series: cls.family,
    model: (src.source_variant || src.shop_art_nr || src.title).slice(0, 80),
    name: { de: src.title },
    group_id: cls.group_id,
    subtype_id: cls.subtype_id,
    unit: cls.unit,
    package_quantity: 1,
    lifecycle_status: "active",
    attributes: extracted.attributes,
    connections: extracted.connections,
    performance_tables: [],
    compatibility: {
      compatible_product_ids: [],
      compatible_group_ids: [],
      incompatible_product_ids: [],
      requirements: [],
    },
    bom: [],
    media: { images: src.images, documents: src.pdfs },
    source: {
      source_record_id: src.id,
      source_name: src.scrape,
      source_url: src.url.replace(/#v=.*$/, ""),
      source_category: src.category,
      source_title: src.title,
      source_variant: src.source_variant ?? null,
    },
    field_status: extracted.field_status,
    provenance,
    quality: {
      classification_confidence: cls.confidence,
      extraction_confidence: Math.round((filled / total) * 100) / 100,
      calculation_ready,
      needs_review: !calculation_ready || warnings.length > 0,
      warnings,
    },
  };
}

/** Copy confirmed attrs / tables from previous normalize when group matches. */
function mergeEnrichment(fresh: NormalizedProduct, prev: NormalizedProduct | undefined) {
  if (!prev) return;
  // Keep stable product_id from pilot/previous when same source
  fresh.product_id = prev.product_id;
  if (prev.article) fresh.article = prev.article;
  if (prev.series && prev.series.length < 40) fresh.series = prev.series;
  if (prev.model && prev.model.length < 40) fresh.model = prev.model;

  if (prev.group_id === fresh.group_id) {
    // Geometry / variant-derived fields: trust fresh re-parse (incl. intentional nulls)
    const freshWinsNull = new Set([
      "radius_min_m",
      "radius_max_m",
      "strip_width_m",
      "strip_length_m",
      "arc_min_deg",
      "arc_max_deg",
      "stainless_riser",
      "pattern_type",
      "matched_precipitation",
      "nozzle_thread_type",
      "pressure_min_bar",
      "pressure_max_bar",
      "pop_up_height_mm",
      "trajectory_deg",
      "check_valve_present",
      "check_valve_max_elevation_m",
      "nozzles_included",
      "conductor_count",
      "length_m",
    ]);
    for (const [k, v] of Object.entries(prev.attributes)) {
      if (v == null) continue;
      if (freshWinsNull.has(k) && k in fresh.attributes) continue;
      if (!(k in fresh.attributes) || fresh.attributes[k] == null) {
        fresh.attributes[k] = v;
        if (prev.field_status[`attributes.${k}`]) {
          fresh.field_status[`attributes.${k}`] = prev.field_status[`attributes.${k}`];
        }
        if (prev.provenance[`attributes.${k}`]) {
          fresh.provenance[`attributes.${k}`] = prev.provenance[`attributes.${k}`];
        }
      }
    }
  }
  if (prev.performance_tables?.length) {
    fresh.performance_tables = prev.performance_tables;
    if (prev.field_status.performance_tables) {
      fresh.field_status.performance_tables = prev.field_status.performance_tables;
    }
    if (prev.provenance.performance_tables) {
      fresh.provenance.performance_tables = prev.provenance.performance_tables;
    }
  }
}

async function main() {
  const ai = JSON.parse(await fs.readFile(RAW_AI, "utf8")) as { products: RawAi[] };
  let prevBySource = new Map<string, NormalizedProduct>();
  try {
    const prev = JSON.parse(await fs.readFile(PRODUCTS_FILE, "utf8")) as {
      products: NormalizedProduct[];
    };
    prevBySource = new Map(prev.products.map((p) => [p.source.source_record_id, p]));
  } catch {
    /* first run */
  }

  const products: NormalizedProduct[] = [];
  const byFamily: Record<string, number> = {};
  const byGroup: Record<string, number> = {};
  const usedIds = new Set<string>();

  for (const src of ai.products) {
    const cls = classify(src);
    if (!shouldInclude(src, cls) || !cls) continue;
    let card = toProduct(src, cls);
    mergeEnrichment(card, prevBySource.get(src.id));
    if (usedIds.has(card.product_id)) {
      card = { ...card, product_id: `${card.product_id}_${crypto.createHash("sha1").update(src.id).digest("hex").slice(0, 6)}` };
    }
    usedIds.add(card.product_id);
    products.push(card);
    byFamily[cls.family] = (byFamily[cls.family] || 0) + 1;
    byGroup[cls.group_id] = (byGroup[cls.group_id] || 0) + 1;
  }

  const generated_at = new Date().toISOString();
  const file = {
    schema_version: "1.0.0",
    generated_at,
    products,
  };
  await fs.writeFile(PRODUCTS_FILE, JSON.stringify(file, null, 2), "utf8");

  const needs = products.filter((p) => p.quality.needs_review);
  await fs.writeFile(
    path.join(OUT, "products_needs_review.json"),
    JSON.stringify(
      { schema_version: "1.0.0", generated_at, count: needs.length, products: needs },
      null,
      2,
    ),
    "utf8",
  );

  const report = {
    schema_version: "1.0.0",
    generated_at,
    iteration: "rebuild_all_v1",
    ai_total: ai.products.length,
    total_normalized: products.length,
    with_performance_tables: products.filter((p) => p.performance_tables.length > 0).length,
    by_family: byFamily,
    by_group: byGroup,
  };
  await fs.writeFile(path.join(OUT, "expand_report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
