/**
 * Bereinigt rawText für die AI-Strukturierung: Shop-Boilerplate raus,
 * nur die eigentliche Produktbeschreibung bleibt.
 *
 * CLI:
 *   npx tsx scripts/scrape/clean.ts
 *   npx tsx scripts/scrape/clean.ts --in hunter          # data/raw/products-hunter.json
 *   npx tsx scripts/scrape/clean.ts --in data/raw/x.json --out data/raw/y.json
 *
 * structure.ts importiert cleanRawText() und nutzt denselben Filter.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  DATA_DIR,
  RAW_PRODUCTS_FILE,
  aiProductsPath,
  rawProductsPath,
} from "./config";
import type { RawProduct } from "./product";

export const AI_PRODUCTS_FILE = path.join(DATA_DIR, "raw", "products-ai.json");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function resolveIo(): { inFile: string; outFile: string } {
  const inArg = argValue("--in");
  const outArg = argValue("--out");
  if (!inArg) {
    return { inFile: RAW_PRODUCTS_FILE, outFile: outArg ?? AI_PRODUCTS_FILE };
  }
  const inFile = inArg.includes("/") || inArg.endsWith(".json")
    ? path.resolve(inArg)
    : rawProductsPath(inArg);
  const defaultOut = inArg.includes("/") || inArg.endsWith(".json")
    ? path.join(DATA_DIR, "raw", "products-ai.json")
    : aiProductsPath(inArg);
  return { inFile, outFile: outArg ? path.resolve(outArg) : defaultOut };
}

/** Zeilen, die reines Shop-Boilerplate sind. */
const DROP_LINE = [
  /^(Beschreibung|Video|Dokumente)$/i,
  /^(NEU|TOP)$/,
  /^-\d+%$/,
  /^Art\.?\s?Nr\.?:?$/i,
  /^Lieferzeit:?$/i,
  /^ca\.\s*\d+\s*-\s*\d+\s*Werktage.*$/i,
  /^\(Ausland abweichend\)$/i,
  /^Lagerbestand:?$/i,
  /^Stück:?$/i,
  /^(ab\s*)?\d{1,3}(\.\d{3})*,\d{2}\s*EUR$/,
  /^Alter Preis.*EUR$/i,
  /^Nur \d.*EUR$/i,
  /^inkl\.\s*19\s*%?\s*MwSt.*$/i,
  /^Versand$/i,
  /^Bitte auswählen\.{0,3}$/i,
  /^\(\d+[.,]?\d*\s*[KM]B\)$/i,
  /^Frage zum Produkt$/i,
  /^Auf den Merkzettel$/i,
  /^In den Warenkorb$/i,
  /^Für weitere Informationen besuchen Sie bitte die Homepage.*$/i,
];

function normalizeChars(s: string): string {
  return s
    .replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, "") // soft hyphen, zero-width
    .replace(/[™®©]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * rawText → kompakter Beschreibungstext.
 * Schneidet die Kopfzone (Titel-Dublette, Preis, Lieferzeit, Varianten-Select —
 * alles schon in strukturierten Feldern) bis zur ersten "Beschreibung"-Zeile ab,
 * entfernt Boilerplate-Zeilen, Dokumentgrößen und den "Hersteller
 * Informationen"-Schwanz, dedupliziert aufeinanderfolgende Zeilen.
 */
export function cleanRawText(rawText: string, pdfTitles: string[] = []): string {
  let lines = rawText.split("\n").map(normalizeChars);

  // Header bis zur Tab-Leiste "Beschreibung" abschneiden
  const descIdx = lines.findIndex((l) => /^Beschreibung$/i.test(l));
  if (descIdx !== -1) lines = lines.slice(descIdx);

  // Schwanz "Hersteller Informationen" + Markenname abschneiden
  const tailIdx = lines.findIndex((l) => /^Hersteller Informationen$/i.test(l));
  if (tailIdx !== -1) lines = lines.slice(0, tailIdx);

  const pdfSet = new Set(pdfTitles.map((t) => normalizeChars(t)));

  const out: string[] = [];
  for (const line of lines) {
    if (!line) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (DROP_LINE.some((re) => re.test(line))) continue;
    if (pdfSet.has(line)) continue; // Dokumenttitel stehen schon in `pdfs`
    if (out.length && out[out.length - 1] === line) continue; // Dubletten
    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Kompakter Datensatz je Produkt — Input für die AI-Strukturierung. */
export type AiProduct = {
  id: string;
  url: string;
  title: string;
  category: string;
  variants: string[];
  /** Galerie-Bilder (Original-URLs) */
  images: string[];
  /** Datenblätter / Anleitungen */
  pdfs: { title: string; url: string }[];
  text: string;
};

export function toAiProduct(raw: RawProduct): AiProduct {
  return {
    id: raw.slug,
    url: raw.url,
    title: raw.title,
    category: raw.breadcrumb.slice(1, -1).join(" > "),
    variants: raw.variants.flatMap((v) => v.options),
    images: raw.images,
    pdfs: raw.pdfs,
    text: cleanRawText(raw.rawText, raw.pdfs.map((p) => p.title)),
  };
}

async function main() {
  const { inFile, outFile } = resolveIo();
  const rawFile = JSON.parse(await fs.readFile(inFile, "utf8")) as {
    source: string;
    products: RawProduct[];
  };

  const aiProducts = rawFile.products.map(toAiProduct);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(
    outFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: rawFile.source,
        products: aiProducts,
      },
      null,
      1,
    ),
    "utf8",
  );

  const before = rawFile.products.reduce((s, p) => s + p.rawText.length, 0);
  const after = aiProducts.reduce((s, p) => s + p.text.length, 0);
  const short = aiProducts.filter((p) => p.text.length < 100);

  console.log(`AI-Datei: ${aiProducts.length} Produkte`);
  console.log(`  in:  ${inFile}`);
  console.log(`  out: ${outFile}`);
  console.log(
    `Text: ${before} -> ${after} Zeichen (−${Math.round((1 - after / before) * 100)}%), ~${Math.round(after / 4)} Tokens gesamt`,
  );
  console.log(
    `Medien: ${aiProducts.filter((p) => p.images.length).length} mit Bild, ${aiProducts.filter((p) => p.pdfs.length).length} mit PDF`,
  );
  if (short.length) {
    console.log(`Achtung, sehr kurzer Text (<100 Zeichen) bei ${short.length}:`);
    for (const p of short.slice(0, 15)) console.log(`  - ${p.id}`);
    if (short.length > 15) console.log(`  … +${short.length - 15} more`);
  }
}

// CLI-Modus nur bei direktem Aufruf, nicht beim Import aus structure.ts
if (process.argv[1]?.endsWith("clean.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
