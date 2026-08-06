import fs from "node:fs/promises";
import path from "node:path";
import { HTML_CACHE_DIR, REQUEST_DELAY_MS, USER_AGENT } from "./config";

let lastRequestAt = 0;

async function politeDelay() {
  const wait = lastRequestAt + REQUEST_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/** Stable cache filename from a URL (page slug, query flattened). */
export function cacheKeyFor(url: string): string {
  const u = new URL(url);
  const base = (u.pathname.replace(/^\//, "") || "index")
    .replace(/\.html?$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_");
  const query = u.search
    ? "_" + u.search.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80)
    : "";
  return `${base}${query}`.slice(0, 180) + ".html";
}

/**
 * Fetch a page, serving from data/raw/html cache when present.
 * Live requests are rate-limited via REQUEST_DELAY_MS.
 */
export async function cachedFetch(
  url: string,
  opts: { force?: boolean } = {},
): Promise<{ html: string; fromCache: boolean }> {
  const file = path.join(HTML_CACHE_DIR, cacheKeyFor(url));

  if (!opts.force) {
    try {
      const html = await fs.readFile(file, "utf8");
      return { html, fromCache: true };
    } catch {
      /* cache miss */
    }
  }

  await politeDelay();
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "de-DE,de;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const html = await res.text();
  await fs.mkdir(HTML_CACHE_DIR, { recursive: true });
  await fs.writeFile(file, html, "utf8");
  return { html, fromCache: false };
}
