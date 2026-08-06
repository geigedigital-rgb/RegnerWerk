import path from "node:path";

export const BASE_URL = "https://www.wasserundgruen.de";

export const LISTING_URL =
  BASE_URL +
  "/advanced_search_result.php?view_mode=tiled&keywords=Rain+Bird&inc_subcat=0&fl_unavailable=1&listing_sort=&listing_count=192";

/** Build a listing URL for a brand keyword (starts at page 1). */
export function listingUrlFor(
  keywords: string,
  opts: { listingCount?: number; incSubcat?: 0 | 1 } = {},
): string {
  const u = new URL(BASE_URL + "/advanced_search_result.php");
  u.searchParams.set("view_mode", "tiled");
  u.searchParams.set("categories_id", "0");
  u.searchParams.set("keywords", keywords);
  u.searchParams.set("inc_subcat", String(opts.incSubcat ?? 1));
  u.searchParams.set("fl_unavailable", "1");
  u.searchParams.set("listing_sort", "");
  u.searchParams.set("listing_count", String(opts.listingCount ?? 300));
  return u.toString();
}

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Pause between live (non-cached) requests, ms */
export const REQUEST_DELAY_MS = 1000;

export const DATA_DIR = path.resolve(process.cwd(), "data");
export const HTML_CACHE_DIR = path.join(DATA_DIR, "raw", "html");
export const RAW_PRODUCTS_FILE = path.join(DATA_DIR, "raw", "products.json");
export const STRUCTURED_DIR = path.join(DATA_DIR, "raw", "structured");
export const CATALOG_FILE = path.join(DATA_DIR, "catalog", "products.json");
export const STRUCTURE_REPORT_FILE = path.join(
  DATA_DIR,
  "catalog",
  "structure-report.json",
);

export function rawProductsPath(slug: string): string {
  return path.join(DATA_DIR, "raw", `products-${slug}.json`);
}

export function aiProductsPath(slug: string): string {
  return path.join(DATA_DIR, "raw", `products-ai-${slug}.json`);
}
