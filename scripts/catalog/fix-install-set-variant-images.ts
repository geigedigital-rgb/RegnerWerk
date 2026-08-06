/**
 * Fix Installation-Set variant images.
 *
 * Wasser&Grün dropdown pages always expose the same parent gallery (Winkel /
 * T-Stück composites). Map each shop variant to the real nozzle / body photo
 * from our catalog so Sofort, universal siblings, and admin show the right SKU.
 *
 * Usage: npx tsx scripts/catalog/fix-install-set-variant-images.ts
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const UNIVERSAL = path.join(
  ROOT,
  "data/catalog/normalized/RegnerWerk_universal.json",
);
const AI = path.join(ROOT, "data/raw/products-ai.json");
const PLANNER = path.join(ROOT, "data/planner/planner-catalog.json");

type AnyRec = Record<string, unknown>;

const WINKEL_IMG =
  "https://www.wasserundgruen.de/images/product_images/original_images/Winkel%20RainBird%201804%202%20Neu.png";
const TEE_IMG =
  "https://www.wasserundgruen.de/images/product_images/original_images/T-Stueck%20RainBird%201804%202%20Neu.png";

/** Ordered longest-first so R-VAN14-360 beats R-VAN14. */
const NOZZLE_KEYS: Array<{ key: string; re: RegExp }> = [
  { key: "R-VAN14-360", re: /R-VAN\s?14-360/i },
  { key: "R-VAN18-360", re: /R-VAN\s?18-360/i },
  { key: "R-VAN24-360", re: /R-VAN\s?24-360/i },
  { key: "R-VAN-LCS", re: /R-VAN-LCS/i },
  { key: "R-VAN-RCS", re: /R-VAN-RCS/i },
  { key: "R-VAN-SST", re: /R-VAN-SST/i },
  { key: "R-VAN14", re: /R-VAN\s?14\b/i },
  { key: "R-VAN18", re: /R-VAN\s?18\b/i },
  { key: "R-VAN24", re: /R-VAN\s?24\b/i },
  { key: "MP800SR", re: /MP800\b/i },
  { key: "MP815", re: /MP815\b/i },
  { key: "MP1000", re: /MP1000\b/i },
  { key: "MP2000", re: /MP2000\b/i },
  { key: "MP3000", re: /MP3000\b/i },
  { key: "MP3500", re: /MP3500\b/i },
  { key: "MPSS530", re: /MPSS530\b/i },
  { key: "MPLCS515", re: /MPLCS515\b/i },
  { key: "MPRCS515", re: /MPRCS515\b/i },
  { key: "MPCORNER", re: /MPCORNER|MP\s*CORNER/i },
];

function detectNozzleKey(text: string): string | null {
  for (const { key, re } of NOZZLE_KEYS) {
    if (re.test(text)) return key;
  }
  return null;
}

function fittingImage(text: string): string {
  return /T-Stück|T-Stueck|T\s*Stück/i.test(text) ? TEE_IMG : WINKEL_IMG;
}

function baseNozzleKey(key: string): string {
  return key.replace(/-360$/, "");
}

async function main() {
  const universal = JSON.parse(await fs.readFile(UNIVERSAL, "utf8")) as {
    products: AnyRec[];
    [k: string]: unknown;
  };
  const planner = JSON.parse(await fs.readFile(PLANNER, "utf8")) as {
    images?: Record<string, string | null>;
  };
  const aiRaw = JSON.parse(await fs.readFile(AI, "utf8")) as
    | AnyRec[]
    | { products?: AnyRec[] };
  const aiItems: AnyRec[] = Array.isArray(aiRaw)
    ? aiRaw
    : (aiRaw.products ?? []);

  const imageByKey = new Map<string, string>();

  // Planner catalog images (already curated)
  for (const [k, v] of Object.entries(planner.images ?? {})) {
    if (typeof v === "string" && v) imageByKey.set(k, v);
  }
  // Alias 360 → base
  for (const k of ["R-VAN14", "R-VAN18", "R-VAN24"]) {
    const img = imageByKey.get(k);
    if (img) imageByKey.set(`${k}-360`, img);
  }

  // Universal product models
  for (const p of universal.products) {
    const img = (p.media as AnyRec | undefined)?.images;
    const first = Array.isArray(img) ? img[0] : null;
    if (typeof first !== "string" || !first) continue;
    const model = String(p.model ?? "");
    const detected = detectNozzleKey(model) ?? detectNozzleKey(String(p.product_id ?? ""));
    if (detected && !imageByKey.has(detected)) imageByKey.set(detected, first);
    // Exact model aliases
    if (/^R-VAN/i.test(model) || /^MP/i.test(model)) {
      imageByKey.set(model, first);
    }
  }

  function resolveImages(variantText: string): string[] {
    const nozzle = detectNozzleKey(variantText);
    const nozzleImg = nozzle
      ? imageByKey.get(nozzle) ?? imageByKey.get(baseNozzleKey(nozzle))
      : null;
    const fitImg = fittingImage(variantText);
    const out: string[] = [];
    if (nozzleImg) out.push(nozzleImg);
    if (fitImg && fitImg !== nozzleImg) out.push(fitImg);
    if (!out.length) out.push(fitImg);
    return out;
  }

  // ── Universal: enrich sibling_variants on install-set cards ───────────────
  let sibUpdated = 0;
  let cardsTouched = 0;
  for (const p of universal.products) {
    const src = (p.source as AnyRec) || {};
    const title = String(
      (p.name as AnyRec)?.de ?? src.source_title ?? p.model ?? "",
    );
    const isInstallSet =
      /Installation-Set/i.test(title) ||
      /installation_set/i.test(String(p.product_id ?? "")) ||
      p.article === "3.191" ||
      p.article === "3.178";
    const sibs = src.sibling_variants;
    if (!Array.isArray(sibs) || !sibs.length) continue;
    if (!isInstallSet && sibs.length < 50) continue;

    let changed = false;
    for (const s of sibs as AnyRec[]) {
      const label = String(s.variant ?? "");
      if (!label) continue;
      const imgs = resolveImages(label);
      if (s.image_url !== imgs[0]) {
        s.image_url = imgs[0];
        changed = true;
        sibUpdated += 1;
      }
      if (imgs[1] && s.image_url_secondary !== imgs[1]) {
        s.image_url_secondary = imgs[1];
        changed = true;
      }
    }

    // Parent card: prefer current variant nozzle image if we can detect it
    const currentVar = String(src.source_variant ?? "");
    const parentImgs = resolveImages(currentVar || title);
    const media = (p.media as AnyRec) || { images: [] };
    const prev = Array.isArray(media.images) ? (media.images as string[]) : [];
    const next = [...parentImgs];
    for (const u of prev) {
      if (typeof u === "string" && u && !next.includes(u)) next.push(u);
    }
    if (JSON.stringify(prev) !== JSON.stringify(next.slice(0, 6))) {
      media.images = next.slice(0, 6);
      p.media = media;
      changed = true;
    }

    if (Array.isArray(src.sibling_variants_preview)) {
      for (const s of src.sibling_variants_preview as AnyRec[]) {
        const label = String(s.variant ?? "");
        if (!label) continue;
        const imgs = resolveImages(label);
        s.image_url = imgs[0];
        if (imgs[1]) s.image_url_secondary = imgs[1];
      }
    }

    if (changed) cardsTouched += 1;
  }

  await fs.writeFile(UNIVERSAL, JSON.stringify(universal, null, 2) + "\n");

  // ── products-ai: fix Installation-Set Rain-Bird (and Hunter) images ───────
  let aiUpdated = 0;
  for (const it of aiItems) {
    const title = String(it.title ?? "");
    if (!/Installation-Set (Rain-Bird|Hunter)/i.test(title)) continue;
    const imgs = resolveImages(title);
    const prev = Array.isArray(it.images) ? (it.images as string[]) : [];
    if (prev[0] === imgs[0] && (prev[1] ?? null) === (imgs[1] ?? null)) {
      continue;
    }
    // Keep any extra gallery shots after our primary pair
    const rest = prev.filter((u) => typeof u === "string" && !imgs.includes(u));
    it.images = [...imgs, ...rest].slice(0, 6);
    aiUpdated += 1;
  }

  if (Array.isArray(aiRaw)) {
    await fs.writeFile(AI, JSON.stringify(aiRaw, null, 2) + "\n");
  } else {
    await fs.writeFile(AI, JSON.stringify(aiRaw, null, 2) + "\n");
  }

  // ── Planner: ensure 360 aliases + strip images stay distinct ─────────────
  const images = { ...(planner.images ?? {}) };
  for (const k of ["R-VAN14", "R-VAN18", "R-VAN24"] as const) {
    if (images[k] && !images[`${k}-360`]) images[`${k}-360`] = images[k];
  }
  planner.images = images;
  await fs.writeFile(PLANNER, JSON.stringify(planner, null, 2) + "\n");

  console.log("universal cards touched:", cardsTouched);
  console.log("sibling image_url set:", sibUpdated);
  console.log("products-ai install-set rows updated:", aiUpdated);
  console.log(
    "nozzle image keys:",
    [...imageByKey.keys()].filter((k) => /R-VAN|MP/i.test(k)).sort().join(", "),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
