/**
 * Repair threaded connections in RegnerWerk_universal.json using ONLY cues
 * confirmed in product title / source_variant / model (shop page text).
 *
 * Known parser bugs this fixes:
 *  - parseInch matched "2" inside "1/2"" → wrong size 2"
 *  - /AG/i matched "ag" inside "Rückschlagventil" → wrong male gender
 *
 * Policy: if title confirms size/gender, overwrite wrong values.
 * If title has no cue, leave existing manufacturer/datasheet values alone
 * unless they came from the broken sibling import (empty provenance).
 *
 * Usage: npx tsx scripts/catalog/repair-connections-from-source.ts
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const UNIVERSAL = path.join(
  ROOT,
  "data/catalog/normalized/RegnerWerk_universal.json",
);

type Conn = {
  port_id?: string;
  role?: string;
  connection_type?: string;
  nominal_size_mm?: number | null;
  thread_size_inch?: string | null;
  thread_gender?: string | null;
  thread_standard?: string | null;
};

type Product = {
  article?: string | null;
  model?: string;
  name?: string;
  connections?: Conn[];
  provenance?: Record<string, unknown>;
  field_status?: Record<string, string>;
  quality?: { needs_review?: boolean; notes?: string[] };
  source?: { source_url?: string; source_variant?: string };
  data_readiness?: Record<string, unknown>;
};

/** Parse inch size from confirmed shop text. Fractions before bare integers. */
export function parseInchConfirmed(s: string): string | null {
  if (/1\s*1\/2|1½|11\/2/i.test(s)) return '1 1/2"';
  if (/1\s*1\/4|1¼|11\/4/i.test(s)) return '1 1/4"';
  if (/2\s*1\/2|2½|21\/2/i.test(s)) return '2 1/2"';
  if (/3\/4|¾/i.test(s)) return '3/4"';
  if (/1\/2|½/i.test(s)) return '1/2"';
  // bare 2" — must not match the "2" inside 1/2"
  if (/(?:^|[^\d\/])2\s*(?:"|Zoll|“|”)/i.test(s)) return '2"';
  if (/(?:^|[^\d\/])1\s*(?:"|Zoll|“|”)/i.test(s) && !/1\s*1\//.test(s))
    return '1"';
  return null;
}

/** Normalize decimal inch notations to fractional shop form. */
function normalizeInch(s: string | null | undefined): string | null {
  if (s == null) return null;
  const map: Record<string, string> = {
    '0.5"': '1/2"',
    '0.50"': '1/2"',
    '0.75"': '3/4"',
    '1.25"': '1 1/4"',
    '1.5"': '1 1/2"',
    '1.50"': '1 1/2"',
    '2.5"': '2 1/2"',
  };
  return map[s] ?? s;
}

/**
 * Gender from explicit shop cues only.
 * Never match bare /AG/ (hits "Schlag") or bare /IG/ inside unrelated words.
 */
export function genderFromConfirmedText(
  s: string,
): "female" | "male" | "mixed" | null {
  const igIg = /IG\s*\/\s*IG|Innengewinde\s*x\s*Innengewinde/i.test(s);
  const agAg =
    /AG\s*\/\s*AG|Außengewinde\s*x\s*Außengewinde|Aussengewinde\s*x\s*Aussengewinde/i.test(
      s,
    );
  const igAg =
    /IG\s*x\s*AG|Innengewinde\s*x\s*Außengewinde|Innengewinde\s*x\s*Aussengewinde/i.test(
      s,
    );
  const agIg =
    /AG\s*x\s*IG|Außengewinde\s*x\s*Innengewinde|Aussengewinde\s*x\s*Innengewinde/i.test(
      s,
    );

  if (igIg) return "female";
  if (agAg) return "male";
  if (igAg || agIg) return "mixed";

  const female = /\bIG\b|Innengewinde/i.test(s);
  const male = /\bAG\b|Außengewinde|Aussengewinde/i.test(s);
  // Rain Bird / Hunter model suffix MM = male×male, FF would be female
  const mmSuffix = /(?:^|[^A-Za-z])MM(?:$|[^A-Za-z])/i.test(s) || /-MM\b/i.test(s);
  const ffSuffix = /(?:^|[^A-Za-z])FF(?:$|[^A-Za-z])/i.test(s) || /-FF\b/i.test(s);

  if (female && !male) return "female";
  if (male && !female) return "male";
  if (mmSuffix && !female) return "male";
  if (ffSuffix && !male) return "female";
  return null;
}

function sourceText(p: Product): string {
  return [p.model, p.name, p.source?.source_variant, p.article]
    .filter(Boolean)
    .join(" | ");
}

function markProvenance(p: Product, field: string, url?: string) {
  p.provenance = p.provenance || {};
  p.provenance[field] = {
    source_type: "retailer_page",
    source_url: url ?? p.source?.source_url ?? null,
    document_title: "Shop product title / variant label",
    page: null,
    note: "Confirmed from product title/variant text only; parser bugs repaired",
  };
  p.field_status = p.field_status || {};
  p.field_status[field] = "confirmed";
}

const raw = JSON.parse(fs.readFileSync(UNIVERSAL, "utf8")) as {
  products: Product[];
  generated_at?: string;
};
const products = raw.products;

const stats = {
  sizeFixed: 0,
  genderFixed: 0,
  sizeNormalized: 0,
  roleFixed: 0,
  productsTouched: 0,
};

for (const p of products) {
  const text = sourceText(p);
  const conns = p.connections;
  if (!conns?.length) continue;

  const confirmedSize = parseInchConfirmed(text);
  const confirmedGender = genderFromConfirmedText(text);
  const isReducing = /Reduz|\d\s*"?\s*x\s*\d/i.test(text);
  let touched = false;

  for (const c of conns) {
    if (c.connection_type !== "threaded") continue;

    // Normalize decimal sizes always (format only, same meaning)
    const norm = normalizeInch(c.thread_size_inch);
    if (norm && norm !== c.thread_size_inch) {
      c.thread_size_inch = norm;
      stats.sizeNormalized++;
      touched = true;
    }

    // Size: overwrite only when title confirms a single size and stored differs
    if (
      confirmedSize &&
      !isReducing &&
      c.thread_size_inch &&
      c.thread_size_inch !== confirmedSize
    ) {
      c.thread_size_inch = confirmedSize;
      stats.sizeFixed++;
      touched = true;
      markProvenance(p, "connections.thread_size_inch");
    }

    // Gender: overwrite when title confirms and stored contradicts
    if (confirmedGender === "female" || confirmedGender === "male") {
      if (c.thread_gender !== confirmedGender) {
        c.thread_gender = confirmedGender;
        stats.genderFixed++;
        touched = true;
        markProvenance(p, "connections.thread_gender");
      }
    } else if (confirmedGender === "mixed") {
      // IG x AG: first port female, second male (or reverse for AG x IG)
      const agFirst = /AG\s*x\s*IG|Außengewinde\s*x\s*Innen/i.test(text);
      const idx = conns.indexOf(c);
      const want = agFirst
        ? idx === 0
          ? "male"
          : "female"
        : idx === 0
          ? "female"
          : "male";
      if (c.thread_gender !== want) {
        c.thread_gender = want;
        stats.genderFixed++;
        touched = true;
        markProvenance(p, "connections.thread_gender");
      }
    }

    // Check valves / directional valves with IG both sides: inlet/outlet roles
    if (
      /Rückschlag/i.test(text) &&
      confirmedGender === "female" &&
      (c.port_id === "inlet" || c.port_id === "outlet")
    ) {
      if (c.role === "bidirectional") {
        c.role = c.port_id;
        stats.roleFixed++;
        touched = true;
      }
    }
  }

  if (touched) {
    stats.productsTouched++;
    // Clear stale port_matches that assumed wrong gender/size — force re-eval
    // Keep structure; compatibility engine should not trust old matches
    const compat = (p as { compatibility?: { port_matches?: unknown[]; status?: string } })
      .compatibility;
    if (compat?.port_matches?.length) {
      compat.port_matches = [];
      compat.status = "needs_recompute_after_connection_repair";
    }
  }
}

raw.generated_at = new Date().toISOString();
fs.writeFileSync(UNIVERSAL, JSON.stringify(raw, null, 2) + "\n");

console.log(JSON.stringify(stats, null, 2));

// Re-audit critical RV family
for (const a of [
  "40_4-RV50",
  "40_4-RV52",
  "40_4-RV53",
  "40_4-RV54",
  "40_4-RV55",
  "40_4-RV56",
  "4.03-KH42",
]) {
  const p = products.find((x) => x.article === a);
  console.log(
    a,
    p?.connections?.map(
      (c) =>
        `${c.port_id}:${c.thread_size_inch}:${c.thread_gender}:${c.role}`,
    ),
  );
}
