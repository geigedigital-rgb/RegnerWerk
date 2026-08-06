import * as cheerio from "cheerio";
import { BASE_URL } from "./config";

/** Product URLs from one listing page, in page order, deduped. */
export function parseListingProducts(html: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  const seen = new Set<string>();

  $(".product-container a.product-url").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = new URL(href, BASE_URL).toString();
    if (!abs.endsWith(".html")) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    urls.push(abs);
  });

  return urls;
}

/**
 * URLs of further listing pages (pagination), absolute, deduped.
 * Works for advanced_search_result.php and category paths
 * (/klemmverschraubungen-und-pe-rohr/.../?page=2).
 */
export function parseListingPagination(html: string, currentUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  const current = new URL(currentUrl);

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let abs: URL;
    try {
      abs = new URL(href, BASE_URL);
    } catch {
      return;
    }
    if (!abs.searchParams.get("page")) return;
    // Same listing family: search result OR same category path
    const isSearch =
      abs.pathname.includes("advanced_search_result.php") &&
      current.pathname.includes("advanced_search_result.php");
    const isCategory =
      abs.pathname === current.pathname && abs.pathname.endsWith("/");
    if (!isSearch && !isCategory) return;
    abs.hash = "";
    const s = abs.toString();
    if (s !== currentUrl) urls.add(s);
  });

  return [...urls];
}

/**
 * Immediate subcategory URLs under a parent category page
 * (e.g. Klemmverschraubungen → 10 bar / 16 bar / Messing / …).
 * Only links that are one path segment deeper than the parent.
 */
export function parseSubcategories(html: string, parentUrl: string): string[] {
  const parent = new URL(parentUrl);
  const basePath = parent.pathname.replace(/\/?$/, "/");
  const $ = cheerio.load(html);
  const urls: string[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let abs: URL;
    try {
      abs = new URL(href, BASE_URL);
    } catch {
      return;
    }
    if (abs.origin !== parent.origin) return;
    const path = abs.pathname.replace(/\/?$/, "/");
    if (!path.startsWith(basePath) || path === basePath) return;
    const rest = path.slice(basePath.length).replace(/\/$/, "");
    // one segment only: "klemmverschraubung" not "a/b"
    if (!rest || rest.includes("/")) return;
    abs.hash = "";
    abs.search = "";
    const s = abs.toString().replace(/\/?$/, "/");
    if (seen.has(s)) return;
    seen.add(s);
    urls.push(s);
  });

  return urls;
}

/** Ensure listing_count is high so we get fewer pages. */
export function withListingCount(url: string, count = 192): string {
  const u = new URL(url);
  u.searchParams.set("listing_count", String(count));
  u.searchParams.delete("page");
  return u.toString();
}
