/**
 * A3 — AI-Strukturierung der gescrapten Produkte.
 *
 * NUR MANUELL STARTEN — macht LLM-API-Calls (Kosten!).
 *
 * Liest data/raw/products.json, schickt rawText jedes Produkts an ein
 * OpenAI-kompatibles Chat-API und validiert die Antwort gegen die
 * Zod-Schema (scripts/scrape/schema.ts). Ergebnisse werden pro Produkt in
 * data/raw/structured/<id>.json gecacht — ein Neustart kostet nur die
 * fehlenden/invaliden Produkte. Am Ende wird data/catalog/products.json
 * plus ein Report (data/catalog/structure-report.json) geschrieben.
 *
 * Env:
 *   OPENAI_API_KEY   (erforderlich)
 *   OPENAI_BASE_URL  (default https://api.openai.com/v1)
 *   STRUCTURE_MODEL  (default gpt-4o-mini)
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx scripts/scrape/structure.ts             # alle
 *   OPENAI_API_KEY=sk-... npx tsx scripts/scrape/structure.ts --limit 5   # Probelauf
 *   npx tsx scripts/scrape/structure.ts --assemble-only                   # nur Katalog aus Cache bauen
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  CATALOG_FILE,
  RAW_PRODUCTS_FILE,
  STRUCTURED_DIR,
  STRUCTURE_REPORT_FILE,
} from "./config";
import type { RawProduct } from "./product";
import { cleanRawText } from "./clean";
import { extractionSchema, type Extraction } from "./schema";
import type { Catalog, Product } from "../../lib/catalog/types";

const BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = process.env.STRUCTURE_MODEL ?? "gpt-4o-mini";
const API_KEY = process.env.OPENAI_API_KEY;

const args = process.argv.slice(2);
const assembleOnly = args.includes("--assemble-only");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

const SYSTEM_PROMPT = `Du bist ein Datenextraktions-Experte für Bewässerungstechnik (Rain Bird, Hunter usw.).
Du bekommst den Rohtext einer Shop-Produktseite und gibst GENAU EIN JSON-Objekt zurück (kein Markdown, keine Erklärung) mit diesen Feldern:

{
  "displayName": string,        // kurzer Produktname für UI, z.B. "Rain Bird 1804 Versenkregner"
  "kind": string,               // eine der Kategorien unten
  "manufacturerNr": string|null,// Hersteller-Art.Nr. wie "A44120", "Y34001" (NICHT die Shop-Nr. wie "3.105")
  "series": string|null,        // Produktserie: "1800", "3500", "5000", "ESP-ME3", "XFD", "DV", ...
  "brand": string,              // "Rain Bird", "Hunter", "Netafim", ...
  "ports": PortSpec[],          // physische Anschlüsse, siehe unten
  "specs": Specs,               // nur Felder, die der Text belegt — NICHTS raten!
  "summary": string             // 1-2 Sätze Deutsch für Produktkarte
}

kind: "rotor" (Getrieberegner), "spray" (Versenkregner/Sprüher-Gehäuse Typenreihe 1800), "nozzle" (Düse), "valve" (Magnetventil), "controller" (Steuergerät), "controller-module" (Erweiterungsmodul SM3/SM6), "wifi-module" (LNK), "sensor", "decoder", "pipe" (PE-/Blu-Lock-Rohr), "flex-pipe" (SPX-FLEX/Funny Pipe), "swing-joint", "drip-line" (Tropfrohr), "drip-accessory" (Micro-Verbinder, Erdspieße, Tropfer), "fitting" (Verbinder/Winkel/T-Stück/Klemm-/Lock-Anschlussstück), "valve-box" (Ventilkasten), "filter", "pressure-regulator" (Druckminderer), "pump", "tool" (Werkzeug), "accessory" (Schellen, Vlies, Kappen), "other".

PortSpec (ein Objekt pro Anschluss; "count" wenn mehrfach identisch):
- Gewinde: {"type":"thread","size":"1/2\\""|"3/4\\""|"1\\""|"1 1/4\\""|"1 1/2\\""|"2\\"","gender":"IG"|"AG","role":"inlet"|"outlet"|"side"|"universal","count":N}
- PE-Klemm/Lock-Verschraubung: {"type":"pe-clamp","diameterMm":16|20|25|32,...}
- Flexschlauch-Steckanschluss: {"type":"barb","diameterMm":Zahl,...}
- Tropfrohr-Lock 16/20mm: {"type":"drip-lock","diameterMm":16|20,...}
Beispiel: Versenkregner 1804 hat unten 1/2" IG → [{"type":"thread","size":"1/2\\"","gender":"IG","role":"inlet"}]. Ein T-Stück Lock 16mm → [{"type":"drip-lock","diameterMm":16,"count":3}].

Specs (alle optional, NUR wenn im Text belegt; Zahlen als Zahl, Komma→Punkt):
riserHeightCm, throwRadiusMinM, throwRadiusMaxM ("Abstand 0,6 m bis 5,5 m" → 0.6/5.5), arcMinDeg, arcMaxDeg, fullCircle, pressureMinBar, pressureMaxBar ("1,0 bis 2,1 bar"), flowMinM3h, flowMaxM3h, hasSAM (Auslaufsperrventil), hasPRS (Druckregulierung), stainlessRiser (Edelstahl-Aufsteiger), nozzlesIncluded, precipRateMmH, voltage ("24VAC"|"9VDC"), withFlowControl, stationsBase, stationsMax, stationsAdded, wifi, outdoor, compatibleWith (["ESP-ME3",...]), diameterMm, pressureRatingBar, lengthM (Rollenlänge; Meterware → 1 und soldByMeter=true), soldByMeter, emitterSpacingCm, emitterFlowLh, fittingShape ("elbow"|"tee"|"coupler"|"adapter"|"end-cap"|"reducer"|"manifold"|"other"), boxValveCapacity, boxDiameterMm, boxLengthMm, boxWidthMm, boxHeightMm, material, seriesCompatibility.

Regeln:
- Erfinde KEINE Werte. Fehlt eine Angabe im Text, lass das Feld weg.
- Aufsteigerhöhe: "1804: 10cm" → riserHeightCm: 10.
- Preise, Lieferzeit, Versand, MwSt ignorieren.
- Bei Varianten-Produkten (mehrere Größen) beschreibe den Grundtyp und nutze seriesCompatibility/summary für die Varianten.`;

type StructuredCacheEntry = {
  id: string;
  model: string;
  extractedAt: string;
  extraction: Extraction;
};

async function callLlm(raw: RawProduct): Promise<Extraction> {
  const userContent = [
    `Titel: ${raw.title}`,
    `Kategorie-Pfad: ${raw.breadcrumb.slice(1, -1).join(" > ") || "-"}`,
    raw.variants.length
      ? `Varianten: ${raw.variants
          .map((v) => `${v.label}: ${v.options.join(" | ")}`)
          .join("; ")}`
      : "",
    "",
    "--- Produktseiten-Text ---",
    cleanRawText(raw.rawText, raw.pdfs.map((p) => p.title)).slice(0, 7000),
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = data.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(content);
  return extractionSchema.parse(parsed);
}

function toProduct(raw: RawProduct, ex: Extraction): Product {
  return {
    id: raw.slug,
    url: raw.url,
    title: raw.title,
    displayName: ex.displayName,
    kind: ex.kind,
    shopArtNr: raw.shopArtNr,
    manufacturerNr: ex.manufacturerNr,
    series: ex.series,
    brand: ex.brand,
    price: raw.price,
    priceIsFrom: raw.priceIsFrom,
    variantOptions: raw.variants.flatMap((v) => v.options),
    images: raw.images,
    docs: raw.pdfs,
    ports: ex.ports,
    specs: ex.specs,
    summary: ex.summary,
  };
}

async function main() {
  const rawFile = JSON.parse(await fs.readFile(RAW_PRODUCTS_FILE, "utf8")) as {
    source: string;
    products: RawProduct[];
  };
  const rawProducts = rawFile.products;
  await fs.mkdir(STRUCTURED_DIR, { recursive: true });

  const failures: { id: string; error: string }[] = [];
  let processed = 0;

  if (!assembleOnly) {
    if (!API_KEY) {
      console.error(
        "OPENAI_API_KEY fehlt. Start:\n  OPENAI_API_KEY=sk-... npx tsx scripts/scrape/structure.ts [--limit N]\n" +
          "Oder nur Katalog aus vorhandenem Cache bauen:\n  npx tsx scripts/scrape/structure.ts --assemble-only",
      );
      process.exit(1);
    }

    for (const raw of rawProducts) {
      if (processed >= limit) break;
      const cachePath = path.join(STRUCTURED_DIR, `${raw.slug}.json`);
      try {
        await fs.access(cachePath);
        continue; // already structured
      } catch {
        /* not cached yet */
      }

      processed++;
      try {
        const extraction = await callLlm(raw);
        const entry: StructuredCacheEntry = {
          id: raw.slug,
          model: MODEL,
          extractedAt: new Date().toISOString(),
          extraction,
        };
        await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), "utf8");
        console.log(`[ok] ${raw.slug} -> ${extraction.kind}`);
      } catch (err) {
        failures.push({ id: raw.slug, error: String(err).slice(0, 500) });
        console.error(`[fail] ${raw.slug}: ${String(err).slice(0, 200)}`);
      }
    }
  }

  // Assemble catalog from cache
  const products: Product[] = [];
  const missing: string[] = [];
  for (const raw of rawProducts) {
    const cachePath = path.join(STRUCTURED_DIR, `${raw.slug}.json`);
    try {
      const entry = JSON.parse(
        await fs.readFile(cachePath, "utf8"),
      ) as StructuredCacheEntry;
      const extraction = extractionSchema.parse(entry.extraction);
      products.push(toProduct(raw, extraction));
    } catch {
      missing.push(raw.slug);
    }
  }

  const catalog: Catalog = {
    generatedAt: new Date().toISOString(),
    source: rawFile.source,
    products,
  };
  await fs.mkdir(path.dirname(CATALOG_FILE), { recursive: true });
  await fs.writeFile(CATALOG_FILE, JSON.stringify(catalog, null, 2), "utf8");

  const kindCounts: Record<string, number> = {};
  for (const p of products) kindCounts[p.kind] = (kindCounts[p.kind] ?? 0) + 1;

  const report = {
    generatedAt: catalog.generatedAt,
    model: MODEL,
    total: rawProducts.length,
    structured: products.length,
    missing,
    failures,
    kindCounts,
  };
  await fs.writeFile(STRUCTURE_REPORT_FILE, JSON.stringify(report, null, 2), "utf8");

  console.log(
    `\nKatalog: ${products.length}/${rawProducts.length} Produkte -> ${CATALOG_FILE}`,
  );
  console.log(`Fehlend/invalid: ${missing.length} (siehe ${STRUCTURE_REPORT_FILE})`);
  console.log("Nach kind:", kindCounts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
