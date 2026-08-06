/**
 * Aggregates cleaned AI product lists into one file.
 *
 * Default: Rain Bird + Hunter + Klemm + Gaps (PE-Rohr/Filter/PRV/Kugelhahn)
 * → data/raw/products-ai.json
 *
 * Products sorted by scrape order, then category, then title.
 *
 * Usage:
 *   npx tsx scripts/scrape/merge-ai.ts
 *   npx tsx scripts/scrape/merge-ai.ts --out data/raw/products-ai.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  RAW_PRODUCTS_FILE,
  aiProductsPath,
  rawProductsPath,
} from "./config";
import { AI_PRODUCTS_FILE, toAiProduct, type AiProduct } from "./clean";
import type { RawProduct } from "./product";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

type AiFile = {
  generatedAt?: string;
  source?: string;
  products: (AiProduct & { brand_hint?: string; scrape?: string })[];
};

async function loadAiOrClean(
  rawPath: string,
  scrape: string,
): Promise<(AiProduct & { scrape: string })[]> {
  const raw = JSON.parse(await fs.readFile(rawPath, "utf8")) as {
    source?: string;
    products: RawProduct[];
  };
  return raw.products.map((p) => ({ ...toAiProduct(p), scrape }));
}

async function loadExistingAi(
  aiPath: string,
  scrape: string,
): Promise<(AiProduct & { scrape: string })[]> {
  const data = JSON.parse(await fs.readFile(aiPath, "utf8")) as AiFile;
  return data.products.map((p) => ({
    id: p.id,
    url: p.url,
    title: p.title,
    category: p.category,
    variants: p.variants ?? [],
    images: p.images ?? [],
    pdfs: p.pdfs ?? [],
    text: p.text ?? "",
    scrape,
  }));
}

async function loadOptional(
  scrape: string,
  preferAi: boolean,
): Promise<(AiProduct & { scrape: string })[]> {
  if (preferAi) {
    try {
      return await loadExistingAi(aiProductsPath(scrape), scrape);
    } catch {
      /* fall through */
    }
  }
  try {
    return await loadAiOrClean(rawProductsPath(scrape), scrape);
  } catch {
    return [];
  }
}

function sortProducts(list: (AiProduct & { scrape: string })[]) {
  const scrapeOrder = ["rainbird", "hunter", "klemm", "gaps"];
  return [...list].sort((a, b) => {
    const sa = scrapeOrder.indexOf(a.scrape);
    const sb = scrapeOrder.indexOf(b.scrape);
    if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
    const ca = a.category.localeCompare(b.category, "de");
    if (ca !== 0) return ca;
    return a.title.localeCompare(b.title, "de");
  });
}

async function main() {
  const outFile = argValue("--out")
    ? path.resolve(argValue("--out")!)
    : AI_PRODUCTS_FILE;

  const rainbird = await loadAiOrClean(RAW_PRODUCTS_FILE, "rainbird");
  const hunter = await loadOptional("hunter", true);
  const klemm = await loadOptional("klemm", true);
  const gaps = await loadOptional("gaps", true);

  const merged: (AiProduct & { scrape: string })[] = [];
  const seen = new Set<string>();
  const dupes: { id: string; scrapes: string[] }[] = [];

  for (const batch of [rainbird, hunter, klemm, gaps]) {
    for (const p of batch) {
      const key = p.url || p.id;
      if (seen.has(key)) {
        const existing = merged.find((x) => (x.url || x.id) === key);
        dupes.push({
          id: key,
          scrapes: [existing?.scrape ?? "?", p.scrape],
        });
        if (existing) {
          if (!existing.images.length && p.images.length) existing.images = p.images;
          if (!existing.pdfs.length && p.pdfs.length) existing.pdfs = p.pdfs;
          if (p.text.length > existing.text.length) existing.text = p.text;
          if (!existing.variants.length && p.variants.length) {
            existing.variants = p.variants;
          }
        }
        continue;
      }
      seen.add(key);
      merged.push(p);
    }
  }

  const sorted = sortProducts(merged);
  const byScrape: Record<string, number> = {};
  for (const p of sorted) byScrape[p.scrape] = (byScrape[p.scrape] ?? 0) + 1;

  const payload = {
    generatedAt: new Date().toISOString(),
    sources: {
      rainbird: RAW_PRODUCTS_FILE,
      hunter: aiProductsPath("hunter"),
      klemm: aiProductsPath("klemm"),
      gaps: rawProductsPath("gaps"),
    },
    counts: {
      total: sorted.length,
      by_scrape: byScrape,
      duplicates_skipped: dupes.length,
    },
    products: sorted,
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(payload, null, 1), "utf8");

  console.log(`Merged → ${outFile}`);
  console.log(`  rainbird: ${rainbird.length}`);
  console.log(`  hunter:   ${hunter.length}`);
  console.log(`  klemm:    ${klemm.length}`);
  console.log(`  gaps:     ${gaps.length}`);
  console.log(`  unique:   ${sorted.length} (dupes skipped: ${dupes.length})`);
  if (dupes.length) {
    console.log("  sample dupes:");
    for (const d of dupes.slice(0, 8)) {
      console.log(`    ${d.scrapes.join("+")} ${d.id.slice(0, 80)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
