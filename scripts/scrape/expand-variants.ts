/**
 * Expand shop dropdown SKUs into separate catalog products.
 *
 * For each product page with modifiers[property][…] selects, calls Gambio
 * CheckStatus API per option → price + Art.Nr (model).
 *
 * Writes:
 *   data/raw/variant-prices/<id>.json  (cache)
 *   updates data/raw/products-ai.json   (one row per variant SKU)
 *
 * Usage:
 *   npx tsx scripts/scrape/expand-variants.ts
 *   npx tsx scripts/scrape/expand-variants.ts --limit 20
 *   npx tsx scripts/scrape/expand-variants.ts --force
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { AI_PRODUCTS_FILE, type AiProduct } from "./clean";
import { BASE_URL } from "./config";
import { cachedFetch } from "./fetch";

const CACHE_DIR = path.resolve("data/raw/variant-prices");
const DELAY_MS = 350;
const force = process.argv.includes("--force");
const limitArg = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();

type VariantOption = {
  property_id: string;
  option_id: string;
  label: string;
  price_eur: number | null;
  price_text: string | null;
  model: string | null;
  ok: boolean;
  error: string | null;
};

type VariantCache = {
  product_id_shop: string;
  url: string;
  source_id: string;
  fetched_at: string;
  label: string;
  options: VariantOption[];
};

type AiWithMeta = AiProduct & {
  scrape?: string;
  parent_id?: string | null;
  source_variant?: string | null;
  shop_product_id?: string | null;
  price_eur?: number | null;
  price_text?: string | null;
  shop_art_nr?: string | null;
  is_variant_parent?: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseEur(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/\s+/g, " ").match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*EUR/);
  if (!m) return null;
  return parseFloat(m[1].replace(/\./g, "") + "." + m[2]);
}

function slugVariant(label: string): string {
  return label
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

function parseModifiers(html: string): {
  productsId: string | null;
  groups: { propertyId: string; label: string; options: { id: string; label: string }[] }[];
} {
  const $ = cheerio.load(html);
  const productsId =
    $("#products-id").attr("value") ||
    $('input[name="products_id"]').first().attr("value") ||
    null;

  const groups: {
    propertyId: string;
    label: string;
    options: { id: string; label: string }[];
  }[] = [];

  $("select.js-calculate, select[name^='modifiers[property]']").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name") || "";
    const m = name.match(/modifiers\[property\]\[(\d+)\]/);
    if (!m) return;
    const propertyId = m[1];
    const label =
      $el.closest(".modifier-group, .form-group").find("label").first().text().replace(/\s+/g, " ").trim() ||
      `property_${propertyId}`;
    const options: { id: string; label: string }[] = [];
    $el.find("option").each((_, o) => {
      const $o = $(o);
      const id = ($o.attr("value") || "").trim();
      const text = $o.text().replace(/\s+/g, " ").trim();
      if (!id || id === "0" || /bitte auswählen/i.test(text)) return;
      options.push({ id, label: text });
    });
    if (options.length) groups.push({ propertyId, label, options });
  });

  return { productsId, groups };
}

/** Flatten multiple independent selects into combinations (usually 1 group). */
function optionCombos(
  groups: { propertyId: string; label: string; options: { id: string; label: string }[] }[],
): { modifiers: Record<string, string>; label: string; optionIds: string[] }[] {
  if (!groups.length) return [];
  let combos: { modifiers: Record<string, string>; label: string; optionIds: string[] }[] = [
    { modifiers: {}, label: "", optionIds: [] },
  ];
  for (const g of groups) {
    const next: typeof combos = [];
    for (const c of combos) {
      for (const opt of g.options) {
        next.push({
          modifiers: { ...c.modifiers, [g.propertyId]: opt.id },
          label: c.label ? `${c.label} | ${opt.label}` : opt.label,
          optionIds: [...c.optionIds, opt.id],
        });
      }
    }
    combos = next;
  }
  return combos;
}

async function checkStatus(
  productsId: string,
  modifiers: Record<string, string>,
): Promise<{ price_text: string | null; model: string | null; ok: boolean; error: string | null }> {
  const params = new URLSearchParams();
  params.set("do", "CheckStatus");
  params.set("products_id", productsId);
  params.set("products_qty", "1");
  params.set("target", "check");
  params.set("isProductInfo", "1");
  params.set("btn-add-to-cart", "In den Warenkorb");
  params.set("_", String(Date.now()));
  for (const [pid, oid] of Object.entries(modifiers)) {
    params.set(`modifiers[property][${pid}]`, oid);
  }
  const url = `${BASE_URL}/shop.php?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RegnerWerkBot/1.0)",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*",
      },
    });
    if (!res.ok) return { price_text: null, model: null, ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as {
      success?: boolean;
      content?: { price?: { value?: string }; model?: { value?: string } };
    };
    if (!data.success) return { price_text: null, model: null, ok: false, error: "success=false" };
    return {
      price_text: data.content?.price?.value ?? null,
      model: data.content?.model?.value ?? null,
      ok: true,
      error: null,
    };
  } catch (e) {
    return { price_text: null, model: null, ok: false, error: String(e) };
  }
}

async function resolveVariantsForUrl(
  sourceId: string,
  url: string,
  title: string,
): Promise<VariantCache | null> {
  const cacheFile = path.join(CACHE_DIR, `${sourceId}.json`);
  if (!force) {
    try {
      const cached = JSON.parse(await fs.readFile(cacheFile, "utf8")) as VariantCache;
      if (cached.options?.length) return cached;
    } catch {
      /* miss */
    }
  }

  const { html } = await cachedFetch(url, { force: false });
  const { productsId, groups } = parseModifiers(html);
  if (!productsId || !groups.length) return null;

  const combos = optionCombos(groups);
  const options: VariantOption[] = [];
  for (const combo of combos) {
    const primaryProperty = Object.keys(combo.modifiers)[0];
    const primaryOption = combo.modifiers[primaryProperty];
    await sleep(DELAY_MS);
    const st = await checkStatus(productsId, combo.modifiers);
    options.push({
      property_id: primaryProperty,
      option_id: combo.optionIds.join("_"),
      label: combo.label,
      price_eur: parseEur(st.price_text),
      price_text: st.price_text,
      model: st.model,
      ok: st.ok,
      error: st.error,
    });
    // keep last option id for single-group (most common)
    if (combo.optionIds.length === 1) {
      options[options.length - 1].option_id = primaryOption;
    }
  }

  const cache: VariantCache = {
    product_id_shop: productsId,
    url,
    source_id: sourceId,
    fetched_at: new Date().toISOString(),
    label: title,
    options,
  };
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2), "utf8");
  return cache;
}

function expandProduct(parent: AiWithMeta, cache: VariantCache): AiWithMeta[] {
  if (!cache.options.length) return [parent];
  const out: AiWithMeta[] = [];
  for (const opt of cache.options) {
    const vid = `${parent.id}__v${opt.option_id}`;
    out.push({
      id: vid,
      url: `${parent.url}#v=${opt.option_id}`,
      title: `${parent.title} — ${opt.label}`,
      category: parent.category,
      variants: [],
      images: parent.images,
      pdfs: parent.pdfs,
      text: parent.text,
      scrape: parent.scrape,
      parent_id: parent.id,
      source_variant: opt.label,
      shop_product_id: cache.product_id_shop,
      price_eur: opt.price_eur,
      price_text: opt.price_text,
      shop_art_nr: opt.model,
      is_variant_parent: false,
    });
  }
  return out;
}

async function main() {
  const file = JSON.parse(await fs.readFile(AI_PRODUCTS_FILE, "utf8")) as {
    generatedAt?: string;
    counts?: Record<string, unknown>;
    products: AiWithMeta[];
  };

  // Skip already-expanded children; work on base pages only
  const bases = file.products.filter((p) => !p.parent_id && !String(p.url).includes("#v="));
  const alreadyChildren = file.products.filter((p) => p.parent_id || String(p.url).includes("#v="));

  const multi = bases.filter((p) => (p.variants?.length ?? 0) > 1);
  console.log(
    `Bases: ${bases.length}, already children: ${alreadyChildren.length}, multi-variant candidates: ${multi.length}`,
  );

  const toProcess = multi.slice(0, Number.isFinite(limitArg) ? limitArg : multi.length);
  const processIds = new Set(toProcess.map((p) => p.id));

  let expandedParents = 0;
  let skuCount = 0;
  let failed = 0;
  const expandedIds = new Set<string>();
  const newChildren: AiWithMeta[] = [];
  const unexpandedProcessed: AiWithMeta[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const p = toProcess[i];
    process.stdout.write(`[${i + 1}/${toProcess.length}] ${p.title.slice(0, 55)}… `);
    try {
      const cache = await resolveVariantsForUrl(p.id, p.url, p.title);
      if (!cache || cache.options.length < 2) {
        console.log("skip (no multi modifiers)");
        unexpandedProcessed.push(p);
        continue;
      }
      const kids = expandProduct(p, cache);
      console.log(`→ ${kids.length} SKUs (ok=${cache.options.filter((o) => o.ok).length})`);
      expandedParents++;
      skuCount += kids.length;
      expandedIds.add(p.id);
      newChildren.push(...kids);
    } catch (e) {
      failed++;
      console.log(`FAIL ${e}`);
      unexpandedProcessed.push(p);
    }
  }

  const untouchedBases = bases.filter((p) => !processIds.has(p.id));
  const remainingOldChildren = alreadyChildren.filter((c) => !expandedIds.has(c.parent_id || ""));

  const products = [...untouchedBases, ...unexpandedProcessed, ...remainingOldChildren, ...newChildren];
  const seen = new Set<string>();
  const deduped: AiWithMeta[] = [];
  for (const p of products) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    deduped.push(p);
  }

  const byScrape: Record<string, number> = {};
  for (const p of deduped) byScrape[p.scrape || "unknown"] = (byScrape[p.scrape || "unknown"] || 0) + 1;

  const payload = {
    generatedAt: new Date().toISOString(),
    counts: {
      total: deduped.length,
      by_scrape: byScrape,
      variant_parents_expanded: expandedParents,
      variant_skus: skuCount,
      variant_fetch_failed: failed,
    },
    products: deduped,
  };
  await fs.writeFile(AI_PRODUCTS_FILE, JSON.stringify(payload, null, 1), "utf8");
  console.log(
    `\nDone → ${AI_PRODUCTS_FILE}: ${deduped.length} products (${expandedParents} parents → ${skuCount} SKUs, failed=${failed})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
