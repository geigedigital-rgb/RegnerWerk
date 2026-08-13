/**
 * Enrich Sofort BOM source parts from shop dropdowns (per-variant CheckStatus images):
 *  1) PE×AG Klemm (1.04-*) — pe_od_mm + thread_size_inch + images
 *  2) PE×IG Klemm (1.05-*) — pe_od_mm + thread_size_inch + images
 *  3) Steuerkabel Irricable (4.29-S119..S123)
 *  4) Messing-Kugelhahn IG/IG (4.03-KH*)
 *  5) Rückschlagventil IG (40_4-RV*)
 *
 * Does NOT touch Teflon_1.
 *
 * Usage: npx tsx scripts/catalog/enrich-bom-source-variants.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { cachedFetch } from "../scrape/fetch";
import { parseProductPage } from "../scrape/product";
import { BASE_URL } from "../scrape/config";

const ROOT = path.resolve(import.meta.dirname, "../..");
const UNIVERSAL = path.join(
  ROOT,
  "data/catalog/normalized/RegnerWerk_universal.json",
);
const CACHE_DIR = path.join(ROOT, "data/raw/variant-prices");

type AnyRec = Record<string, unknown>;

type ShopOption = {
  propertyId: string;
  optionId: string;
  label: string;
  article: string | null;
  priceEur: number | null;
  images: string[];
  checkStatusImageCount: number;
  imageListCount: number;
};

function sleep(ms: number) {
  return Promise.resolve().then(
    () => new Promise<void>((r) => setTimeout(r, ms)),
  );
}

function parseEur(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text
    .replace(/\s+/g, " ")
    .match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*EUR/);
  if (!m) return null;
  return parseFloat(m[1].replace(/\./g, "") + "." + m[2]);
}

function hashId(prefix: string, key: string): string {
  return `${prefix}_${crypto.createHash("sha1").update(key).digest("hex").slice(0, 8)}`;
}

function cleanLabel(s: string): string {
  return s.replace(/1""/g, '1"').replace(/\s+/g, " ").trim();
}

function cacheSlug(pageUrl: string): string {
  return (
    pageUrl
      .replace(/^https?:\/\/[^/]+\//, "")
      .replace(/\.html?$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 160) + ".json"
  );
}

async function checkStatusFull(
  productsId: string,
  propertyId: string,
  optionId: string,
): Promise<{
  priceEur: number | null;
  article: string | null;
  images: string[];
  imageListCount: number;
  listImages: string[];
  ok: boolean;
}> {
  const params = new URLSearchParams();
  params.set("do", "CheckStatus");
  params.set("products_id", productsId);
  params.set("products_qty", "1");
  params.set("target", "check");
  params.set("isProductInfo", "1");
  params.set(`modifiers[property][${propertyId}]`, optionId);
  params.set("_", String(Date.now()));
  const url = `${BASE_URL}/shop.php?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RegnerWerkBot/1.0)",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*",
    },
  });
  if (!res.ok)
    return {
      priceEur: null,
      article: null,
      images: [],
      imageListCount: 0,
      listImages: [],
      ok: false,
    };
  const data = (await res.json()) as {
    success?: boolean;
    content?: {
      price?: { value?: string };
      model?: { value?: string };
      imageList?: { images?: Array<{ webFilePath?: string }> };
      imageGallery?: string | { value?: string };
    };
  };
  if (!data.success)
    return {
      priceEur: null,
      article: null,
      images: [],
      imageListCount: 0,
      listImages: [],
      ok: false,
    };
  const content = data.content ?? {};
  const fromList = (content.imageList?.images ?? [])
    .map((i) => i.webFilePath)
    .filter((x): x is string => !!x);
  // Older Gambio responses omit imageList and only send imageGallery HTML
  // (sometimes as a bare string, sometimes as { value: html }).
  const galleryRaw = content.imageGallery as unknown;
  const galleryHtml =
    typeof galleryRaw === "string"
      ? galleryRaw
      : typeof galleryRaw === "object" &&
          galleryRaw &&
          "value" in (galleryRaw as object)
        ? String((galleryRaw as { value?: string }).value ?? "")
        : "";
  const fromGallery: string[] = [];
  const re =
    /(?:src|href)=["']([^"']*product_images[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(galleryHtml))) {
    fromGallery.push(m[1]);
  }
  const normalize = (u: string): string => {
    let out = u.replace(/\\/g, "");
    if (out.startsWith("images/")) out = "/" + out;
    if (out.startsWith("/")) out = `${BASE_URL}${out}`;
    out = out
      .replace(/popup_images/g, "original_images")
      .replace(/info_images/g, "original_images")
      .replace(/gallery_images/g, "original_images");
    // encode spaces in path
    try {
      const url = new URL(out);
      url.pathname = url.pathname
        .split("/")
        .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
        .join("/");
      return url.toString();
    } catch {
      return out.replace(/ /g, "%20");
    }
  };
  const listImages = [...new Set(fromList.map(normalize))];
  const images = [...new Set([...listImages, ...fromGallery.map(normalize)])];
  return {
    priceEur: parseEur(content.price?.value ?? null),
    article: content.model?.value?.trim() || null,
    images,
    imageListCount: listImages.length,
    listImages,
    ok: true,
  };
}

function parseSelectOptions(html: string): {
  productsId: string | null;
  propertyId: string | null;
  options: { id: string; label: string }[];
} {
  const $ = cheerio.load(html);
  const productsId =
    $("#products-id").attr("value") ||
    $('input[name="products_id"]').first().attr("value") ||
    null;
  const $sel = $(
    "select.js-calculate, select[name^='modifiers[property]']",
  ).first();
  const name = $sel.attr("name") || "";
  const m = name.match(/modifiers\[property\]\[(\d+)\]/);
  const propertyId = m?.[1] ?? null;
  const options: { id: string; label: string }[] = [];
  $sel.find("option").each((_, o) => {
    const $o = $(o);
    const id = ($o.attr("value") || "").trim();
    const label = cleanLabel($o.text());
    if (!id || id === "0" || /bitte auswählen/i.test(label)) return;
    options.push({ id, label });
  });
  return { productsId, propertyId, options };
}

async function expandPage(pageUrl: string): Promise<{
  url: string;
  title: string;
  shopArt: string | null;
  options: ShopOption[];
  fallbackImages: string[];
  rawText: string;
  uniqueCheckStatusImages: number;
  uniqueImageListImages: number;
}> {
  const { html } = await cachedFetch(pageUrl, { force: true });
  const raw = parseProductPage(pageUrl, html);
  const { productsId, propertyId, options } = parseSelectOptions(html);
  if (!productsId || !propertyId) {
    throw new Error(`No modifiers on ${pageUrl}`);
  }
  const out: ShopOption[] = [];
  const unique = new Set<string>();
  const uniqueList = new Set<string>();
  for (const opt of options) {
    await sleep(350);
    const st = await checkStatusFull(productsId, propertyId, opt.id);
    for (const img of st.images) unique.add(img);
    for (const img of st.listImages) uniqueList.add(img);
    out.push({
      propertyId,
      optionId: opt.id,
      label: cleanLabel(opt.label),
      article: st.article,
      priceEur: st.priceEur,
      images: st.images.length ? st.images : raw.images,
      checkStatusImageCount: st.images.length,
      imageListCount: st.imageListCount,
    });
    console.log(
      `  ${st.article ?? "?"} ${opt.label.slice(0, 55)} €${st.priceEur} imgs=${st.images.length} (list=${st.imageListCount})`,
    );
  }
  return {
    url: pageUrl,
    title: raw.title,
    shopArt: raw.shopArtNr,
    options: out,
    fallbackImages: raw.images,
    rawText: raw.rawText,
    uniqueCheckStatusImages: unique.size,
    uniqueImageListImages: uniqueList.size,
  };
}

/** Parse PE OD from labels like "Kupplung 25 x 1 Zoll AG…" */
function peOdFromKupplungLabel(label: string): number | null {
  const m =
    label.match(/Kupplung\s+(\d+)\s*[x×]/i) ||
    label.match(/(?:^|\s)(\d+)\s*[x×]\s*(?:\d|½|¾)/i);
  return m ? Number(m[1]) : null;
}

/**
 * Parse thread from "… x 1 Zoll …", "… x 1/2 Zoll …", "… x 1 1/4 Zoll …"
 * Order matters: prefer compound fractions before bare 1.
 */
function threadInchFromKupplungLabel(label: string): string | null {
  const m = label.match(
    /[x×]\s*((?:\d+\s+)?\d+\s*\/\s*\d+|\d+)\s*(?:Zoll|"|''|″)/i,
  );
  if (!m) {
    if (/1\s*1\/2|1½/i.test(label)) return '1 1/2"';
    if (/1\s*1\/4|1¼/i.test(label)) return '1 1/4"';
    if (/2\s*1\/2|2½/i.test(label)) return '2 1/2"';
    if (/3\/4|¾/i.test(label)) return '3/4"';
    if (/1\/2|½/i.test(label)) return '1/2"';
    return null;
  }
  const raw = m[1].replace(/\s+/g, " ").trim();
  if (/^1\s*1\s*\/\s*2$/.test(raw) || raw === "1½") return '1 1/2"';
  if (/^1\s*1\s*\/\s*4$/.test(raw) || raw === "1¼") return '1 1/4"';
  if (/^2\s*1\s*\/\s*2$/.test(raw) || raw === "2½") return '2 1/2"';
  if (/^3\s*\/\s*4$/.test(raw) || raw === "¾") return '3/4"';
  if (/^1\s*\/\s*2$/.test(raw) || raw === "½") return '1/2"';
  if (/^2$/.test(raw)) return '2"';
  if (/^1$/.test(raw)) return '1"';
  return `${raw}"`;
}

function threadInchFromSizeLabel(label: string): string | null {
  // "1\" Kugelhahn…" or "…Kunststoff 1\"" / "3/4\" …" / "1 1/2\" …"
  const cleaned = cleanLabel(label).replace(/''/g, '"');
  const m =
    cleaned.match(
      /^((?:\d+\s+)?\d+\s*\/\s*\d+|\d+)\s*("|Zoll|″)?/i,
    ) ||
    cleaned.match(
      /\b((?:\d+\s+)?\d+\s*\/\s*\d+|\d+)\s*("|Zoll|″)\s*$/i,
    ) ||
    cleaned.match(
      /\b((?:\d+\s+)?\d+\s*\/\s*\d+|\d+)\s*("|Zoll|″)\b/i,
    );
  if (!m) return threadInchFromKupplungLabel(label);
  const raw = m[1].replace(/\s+/g, " ").trim();
  if (/^1\s*1\s*\/\s*2$/.test(raw)) return '1 1/2"';
  if (/^1\s*1\s*\/\s*4$/.test(raw)) return '1 1/4"';
  if (/^2\s*1\s*\/\s*2$/.test(raw)) return '2 1/2"';
  if (/^3\s*\/\s*4$/.test(raw)) return '3/4"';
  if (/^1\s*\/\s*2$/.test(raw)) return '1/2"';
  if (/^\d+$/.test(raw)) return `${raw}"`;
  return `${raw}"`;
}

function conductorCountFromLabel(label: string): number | null {
  const m = label.match(/(\d+)\s*Adern?/i);
  return m ? Number(m[1]) : null;
}

function writeCache(
  pageUrl: string,
  page: Awaited<ReturnType<typeof expandPage>>,
  productsIdHint?: string,
) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, cacheSlug(pageUrl));
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        product_id_shop: productsIdHint ?? null,
        url: page.url,
        fetched_at: new Date().toISOString(),
        unique_checkstatus_images: page.uniqueCheckStatusImages,
        unique_imagelist_images: page.uniqueImageListImages,
        options: page.options.map((o) => ({
          property_id: o.propertyId,
          option_id: o.optionId,
          label: o.label,
          price_eur: o.priceEur,
          model: o.article,
          images: o.images,
          checkstatus_image_count: o.checkStatusImageCount,
          imagelist_count: o.imageListCount,
          ok: true,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `  cache → ${path.basename(file)} (unique imgs=${page.uniqueCheckStatusImages}, imageList unique=${page.uniqueImageListImages})`,
  );
}

function patchProduct(
  products: AnyRec[],
  spec: {
    article: string;
    model?: string;
    priceEur: number | null;
    url: string;
    images: string[];
    attributes?: Record<string, unknown>;
  },
): boolean {
  const existing = products.find((p) => p.article === spec.article);
  if (!existing) {
    console.warn(`  ! missing in universal: ${spec.article}`);
    return false;
  }
  if (spec.model) {
    existing.model = spec.model;
    const name = (existing.name as AnyRec) || {};
    // keep long parent title prefix if present
    const de = String(name.de ?? "");
    if (de.includes(" — ")) {
      name.de = `${de.split(" — ")[0]} — ${spec.model}`;
    } else if (!de) {
      name.de = spec.model;
    }
    existing.name = name;
  }
  if (spec.attributes) {
    existing.attributes = {
      ...(existing.attributes as object),
      ...spec.attributes,
    };
  }
  existing.media = {
    images: spec.images,
    documents: ((existing.media as AnyRec)?.documents as unknown[]) ?? [],
  };
  const prevSource = (existing.source as AnyRec) || {};
  existing.source = {
    ...prevSource,
    source_name: "wasserundgruen",
    source_url: spec.url,
    source_title: spec.model ?? prevSource.source_title ?? existing.model,
  };
  if (spec.priceEur != null) {
    existing.price_eur = spec.priceEur;
    const bom = existing.bom as AnyRec[] | undefined;
    if (Array.isArray(bom) && bom[0]) {
      bom[0].price_eur = spec.priceEur;
      if (spec.model) bom[0].label = spec.model;
    }
  }
  existing.data_readiness = "enriched";
  const prov = (existing.provenance as AnyRec) || {};
  existing.provenance = {
    ...prov,
    imported_from: "enrich-bom-source-variants",
  };
  return true;
}

function upsertPeCouplings(
  products: AnyRec[],
  page: Awaited<ReturnType<typeof expandPage>>,
  threadGender: "male" | "female",
) {
  let n = 0;
  for (const opt of page.options) {
    if (!opt.article) continue;
    const peOd = peOdFromKupplungLabel(opt.label);
    const thread = threadInchFromKupplungLabel(opt.label);
    const ok = patchProduct(products, {
      article: opt.article,
      model: cleanLabel(opt.label),
      priceEur: opt.priceEur,
      url: `${page.url}#v=${opt.optionId}`,
      images: opt.images,
      attributes: {
        pe_od_mm: peOd,
        thread_size_inch: thread,
        pressure_rating_bar: 10,
        shape: "straight",
        body_material: "pp",
      },
    });
    if (ok) {
      n++;
      // Keep connections in sync when we know sizes
      const existing = products.find((p) => p.article === opt.article)!;
      const conns = (existing.connections as AnyRec[]) || [];
      if (peOd != null) {
        const pipe = conns.find((c) => c.connection_type === "pe_compression");
        if (pipe) pipe.nominal_size_mm = peOd;
      }
      if (thread) {
        const th = conns.find((c) => c.connection_type === "threaded");
        if (th) {
          th.thread_size_inch = thread;
          th.thread_gender = threadGender;
          th.thread_standard = "BSP";
        }
      }
    }
  }
  console.log(`  patched ${n} PE couplings (${threadGender})`);
}

function upsertBallValves(
  products: AnyRec[],
  page: Awaited<ReturnType<typeof expandPage>>,
) {
  let n = 0;
  for (const opt of page.options) {
    if (!opt.article) continue;
    const thread = threadInchFromSizeLabel(opt.label);
    const ok = patchProduct(products, {
      article: opt.article,
      model: cleanLabel(opt.label),
      priceEur: opt.priceEur,
      url: `${page.url}#v=${opt.optionId}`,
      images: opt.images,
      attributes: {
        thread_size_inch: thread,
        actuation_type: "manual",
        body_material: "brass",
        flow_control_present: false,
        manual_opening: true,
      },
    });
    if (ok) {
      n++;
      const existing = products.find((p) => p.article === opt.article)!;
      if (thread) {
        for (const c of (existing.connections as AnyRec[]) || []) {
          if (c.connection_type === "threaded") c.thread_size_inch = thread;
        }
      }
    }
  }
  console.log(`  patched ${n} ball valves`);
}

function upsertCheckValves(
  products: AnyRec[],
  page: Awaited<ReturnType<typeof expandPage>>,
) {
  let n = 0;
  for (const opt of page.options) {
    if (!opt.article) continue;
    const thread = threadInchFromSizeLabel(opt.label);
    const ok = patchProduct(products, {
      article: opt.article,
      model: cleanLabel(opt.label),
      priceEur: opt.priceEur,
      url: `${page.url}#v=${opt.optionId}`,
      images: opt.images,
      attributes: {
        thread_size_inch: thread,
        shape: "straight",
        body_material: "pp",
      },
    });
    if (ok) {
      n++;
      const existing = products.find((p) => p.article === opt.article)!;
      if (thread) {
        for (const c of (existing.connections as AnyRec[]) || []) {
          if (c.connection_type === "threaded") c.thread_size_inch = thread;
        }
      }
    }
  }
  console.log(`  patched ${n} check valves`);
}

function upsertControlCables(
  products: AnyRec[],
  page: Awaited<ReturnType<typeof expandPage>>,
) {
  let n = 0;
  for (const opt of page.options) {
    if (!opt.article) continue;
    // Skip roll packs if they appear; focus on per-meter dropdown cores
    const cores = conductorCountFromLabel(opt.label);
    const ok = patchProduct(products, {
      article: opt.article,
      model: cleanLabel(opt.label),
      priceEur: opt.priceEur,
      url: `${page.url}#v=${opt.optionId}`,
      images: opt.images,
      attributes: {
        ...(cores != null ? { conductor_count: cores } : {}),
        direct_burial_allowed: true,
        jacket_material: "PE",
      },
    });
    if (ok) n++;
  }
  console.log(`  patched ${n} control cables`);
}

async function main() {
  const uni = JSON.parse(fs.readFileSync(UNIVERSAL, "utf8")) as {
    products: AnyRec[];
  };
  const products = uni.products;
  const teflonBefore = JSON.stringify(
    products.find((p) => p.article === "Teflon_1"),
  );

  const pages: Array<{
    name: string;
    url: string;
    apply: (page: Awaited<ReturnType<typeof expandPage>>) => void;
  }> = [
    {
      name: "PE×AG Klemm (1.04)",
      url: "https://www.wasserundgruen.de/kupplung-klemmverschraubung-x-aussengewinde-pn10-made-in-eu-nach-deutscher-qualitaetsstandard.html",
      apply: (page) => upsertPeCouplings(products, page, "male"),
    },
    {
      name: "PE×IG Klemm (1.05)",
      url: "https://www.wasserundgruen.de/kupplung-gerade-pe-klemmverschraubung-x-aussengewinde-pn10-made-in-eu-nach-deutschen-qualitaetsstandards.html",
      apply: (page) => upsertPeCouplings(products, page, "female"),
    },
    {
      name: "Steuerkabel Irricable",
      url: "https://www.wasserundgruen.de/Steuerkabel-Irricable-Rain-Bird--farbig-kodierte-Adern-fuer-Magnetventile-und-Steuergeraete-3-Adern--5-Adern--7-Adern--9-Adern--13-Adern.html",
      apply: (page) => upsertControlCables(products, page),
    },
    {
      name: "Messing-Kugelhahn IG/IG",
      url: "https://www.wasserundgruen.de/Messing-Kugelhahn-mit-Hebelgriff-IG-IG-mit-Innengewinde--Metall-Kugelhahn.html",
      apply: (page) => upsertBallValves(products, page),
    },
    {
      name: "Rückschlagventil IG",
      url: "https://www.wasserundgruen.de/Rueckschlagventil-mit-Innengewinde-aus-Kunststoff.html",
      apply: (page) => upsertCheckValves(products, page),
    },
  ];

  const report: Array<{
    name: string;
    options: number;
    uniqueImages: number;
    uniqueImageList: number;
  }> = [];

  for (const p of pages) {
    console.log(`=== ${p.name} ===`);
    const page = await expandPage(p.url);
    writeCache(p.url, page);
    p.apply(page);
    report.push({
      name: p.name,
      options: page.options.length,
      uniqueImages: page.uniqueCheckStatusImages,
      uniqueImageList: page.uniqueImageListImages,
    });
  }

  const teflonAfter = JSON.stringify(
    products.find((p) => p.article === "Teflon_1"),
  );
  if (teflonBefore !== teflonAfter) {
    throw new Error("Teflon_1 was modified — aborting write");
  }

  uni.products = products;
  fs.writeFileSync(UNIVERSAL, JSON.stringify(uni, null, 2) + "\n");

  console.log("\n=== summary ===");
  for (const r of report) {
    const fallback =
      r.uniqueImageList <= 1 && r.uniqueImages <= 1
        ? " (no per-variant photos — parent/shared gallery)"
        : "";
    console.log(
      `  ${r.name}: ${r.options} options, ${r.uniqueImages} unique imgs (imageList=${r.uniqueImageList})${fallback}`,
    );
  }
  console.log("universal products:", products.length);
  console.log("Teflon_1 untouched: yes");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
