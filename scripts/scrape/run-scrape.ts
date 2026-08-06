/**
 * Scrapes products from wasserundgruen.de into data/raw/products[-<slug>].json.
 * HTML pages are cached in data/raw/html/, so re-runs only hit missing pages.
 *
 * Usage:
 *   npx tsx scripts/scrape/run-scrape.ts
 *   npx tsx scripts/scrape/run-scrape.ts --keywords Hunter --out hunter
 *   npx tsx scripts/scrape/run-scrape.ts --url "https://...&keywords=Hunter..." --out hunter
 *   npx tsx scripts/scrape/run-scrape.ts --category https://www.wasserundgruen.de/.../klemmverschraubungen/ --out klemm
 *   npx tsx scripts/scrape/run-scrape.ts --force
 *
 * --category: parent has subcategory cards (no products) → discover children,
 * then scrape product listings from each leaf category.
 * Multiple --url flags scrape several listing pages into one output.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  LISTING_URL,
  RAW_PRODUCTS_FILE,
  listingUrlFor,
  rawProductsPath,
} from "./config";
import { cachedFetch } from "./fetch";
import {
  parseListingPagination,
  parseListingProducts,
  parseSubcategories,
  withListingCount,
} from "./listing";
import { parseProductPage, type RawProduct } from "./product";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function argValues(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) {
      out.push(process.argv[i + 1]);
    }
  }
  return out;
}

const force = process.argv.includes("--force");
const keywords = argValue("--keywords");
const outSlug = argValue("--out");
const urlArgs = argValues("--url");
const categoryArg = argValue("--category");

function resolveOutFile(): string {
  if (outSlug) return rawProductsPath(outSlug);
  if (keywords) {
    return rawProductsPath(keywords.toLowerCase().replace(/\s+/g, "-"));
  }
  if (categoryArg) return rawProductsPath("category");
  return RAW_PRODUCTS_FILE;
}

async function collectProductUrlsFromListing(listingUrl: string): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();
  // Prefer listing_count from URL if present, else 300 (shop max useful page size)
  const requested = Number(new URL(listingUrl).searchParams.get("listing_count") || 300);
  const start = withListingCount(listingUrl, Number.isFinite(requested) && requested > 0 ? requested : 300);
  const queue = [start];
  const visited = new Set<string>();

  while (queue.length) {
    const pageUrl = queue.shift()!;
    if (visited.has(pageUrl)) continue;
    visited.add(pageUrl);

    const { html, fromCache } = await cachedFetch(pageUrl, { force });
    const products = parseListingProducts(html);
    for (const u of products) {
      if (!seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    }
    for (const next of parseListingPagination(html, pageUrl)) {
      const normalized = withListingCount(next, 192);
      // keep page param from pagination
      const n = new URL(normalized);
      const p = new URL(next).searchParams.get("page");
      if (p) n.searchParams.set("page", p);
      else n.searchParams.delete("page");
      const nextUrl = n.toString();
      if (!visited.has(nextUrl)) queue.push(nextUrl);
    }
    console.log(
      `[listing] ${pageUrl} -> ${products.length} products${fromCache ? " (cache)" : ""}`,
    );
  }

  return urls;
}

async function resolveListingSeeds(): Promise<{ seeds: string[]; source: string }> {
  if (categoryArg) {
    const parent = categoryArg.replace(/\/?$/, "/");
    const { html, fromCache } = await cachedFetch(parent, { force });
    const direct = parseListingProducts(html);
    const subs = parseSubcategories(html, parent);
    console.log(
      `[category] ${parent} -> ${subs.length} subcats, ${direct.length} direct products${fromCache ? " (cache)" : ""}`,
    );
    for (const s of subs) console.log(`  - ${s}`);

    // If parent already has products and no useful subcats, scrape parent.
    // Otherwise scrape each subcategory (and parent products if any).
    const seeds =
      subs.length > 0
        ? [...(direct.length ? [parent] : []), ...subs]
        : [parent];
    return { seeds, source: parent };
  }

  if (urlArgs.length) {
    return {
      seeds: urlArgs.map((u) => {
        const url = new URL(u);
        url.searchParams.delete("page");
        return url.toString();
      }),
      source: urlArgs.join(" | "),
    };
  }

  if (keywords) {
    const u = listingUrlFor(keywords, { listingCount: 300, incSubcat: 1 });
    return { seeds: [u], source: u };
  }

  return { seeds: [LISTING_URL], source: LISTING_URL };
}

async function main() {
  const { seeds, source } = await resolveListingSeeds();
  const outFile = resolveOutFile();
  console.log(`Seeds (${seeds.length}):`);
  for (const s of seeds) console.log(`  ${s}`);
  console.log(`Output: ${outFile}`);

  const allUrls: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    const urls = await collectProductUrlsFromListing(seed);
    for (const u of urls) {
      if (!seen.has(u)) {
        seen.add(u);
        allUrls.push(u);
      }
    }
  }
  console.log(`Total product URLs: ${allUrls.length}`);

  const products: RawProduct[] = [];
  const failures: { url: string; error: string }[] = [];

  for (let i = 0; i < allUrls.length; i++) {
    const url = allUrls[i];
    try {
      const { html, fromCache } = await cachedFetch(url, { force });
      const product = parseProductPage(url, html);
      products.push(product);
      const flags = [
        fromCache ? "cache" : "live",
        product.price == null ? "NO-PRICE" : "",
        product.rawText.length < 200 ? "SHORT-TEXT" : "",
      ]
        .filter(Boolean)
        .join(",");
      console.log(`[${i + 1}/${allUrls.length}] ${product.slug} (${flags})`);
    } catch (err) {
      failures.push({ url, error: String(err) });
      console.error(`[${i + 1}/${allUrls.length}] FAILED ${url}: ${err}`);
    }
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(
    outFile,
    JSON.stringify(
      {
        scrapedAt: new Date().toISOString(),
        source,
        seeds,
        products,
        failures,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    `\nDone: ${products.length} products, ${failures.length} failures -> ${outFile}`,
  );
  const noPrice = products.filter((p) => p.price == null).length;
  const shortText = products.filter((p) => p.rawText.length < 200).length;
  console.log(`Quality: ${noPrice} without price, ${shortText} with short rawText`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
