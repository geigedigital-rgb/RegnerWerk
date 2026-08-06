import * as cheerio from "cheerio";
import { BASE_URL } from "./config";

export type RawProductVariant = {
  /** select name/id attribute as found in the form */
  control: string;
  label: string;
  options: string[];
};

export type RawProduct = {
  url: string;
  slug: string;
  title: string;
  /** Shop-internal Art.Nr. (dd.model-number), e.g. "3.105" */
  shopArtNr: string | null;
  /** e.g. "2,45 EUR" or "ab 1,67 EUR" */
  priceText: string | null;
  /** parsed EUR value of priceText */
  price: number | null;
  /** true when the shop shows an "ab"-price (variants) */
  priceIsFrom: boolean;
  oldPriceText: string | null;
  availabilityText: string | null;
  breadcrumb: string[];
  images: string[];
  pdfs: { title: string; url: string }[];
  variants: RawProductVariant[];
  /** All product-info content as plain text — input for AI structuring */
  rawText: string;
  /** Same region as HTML, kept for re-extraction */
  rawHtml: string;
  scrapedAt: string;
};

function parseEur(text: string): number | null {
  const m = text.replace(/\s+/g, " ").match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*EUR/);
  if (!m) return null;
  return parseFloat(m[1].replace(/\./g, "") + "." + m[2]);
}

function normalizeText(s: string): string {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseProductPage(url: string, html: string): RawProduct {
  const $ = cheerio.load(html);

  const slug = new URL(url).pathname.replace(/^\//, "").replace(/\.html$/i, "");

  const title =
    $("h1").first().text().trim() ||
    $("title").text().trim();

  const shopArtNr = $("dd.model-number").first().text().trim() || null;

  // Main price block (recommendation tiles elsewhere also use
  // .current-price-container, so scope to the attributes-calc block).
  const priceContainer = $(
    "#attributes-calc-price .current-price-container, .product-info .current-price-container",
  ).first();
  let priceText: string | null = null;
  let oldPriceText: string | null = null;
  if (priceContainer.length) {
    oldPriceText = priceContainer.find(".productOldPrice").text().trim() || null;
    const clone = priceContainer.clone();
    clone.find(".productOldPrice").remove();
    priceText = normalizeText(clone.text()).replace(/\n+/g, " ").trim() || null;
  }
  const price = priceText ? parseEur(priceText) : null;
  const priceIsFrom = /(^|\s)ab\s/i.test(priceText ?? "");

  const availabilityText =
    $(".products-shipping-time, .shipping-info-short").first().text().replace(/\s+/g, " ").trim() ||
    null;

  const breadcrumb: string[] = [];
  $("#breadcrumb_navi .breadcrumbEntry").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t) breadcrumb.push(t);
  });

  const info = $(".product-info").first();
  // Cross-selling ("Zu diesem Produkt empfehlen wir Ihnen" / "Kunden kauften
  // auch") lives inside .product-info — drop it before extracting anything.
  info.find(".product-info-listings, .product-info-share").remove();

  const images: string[] = [];
  const seenImg = new Set<string>();
  $("img[src*='product_images']").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    // Gallery images only; recommendation tiles use info/thumbnail paths.
    if (!/original_images|popup_images/.test(src)) return;
    const abs = new URL(src, BASE_URL).toString();
    const key = abs.replace(/popup_images/, "original_images");
    if (seenImg.has(key)) return;
    seenImg.add(key);
    images.push(key);
  });

  const pdfs: { title: string; url: string }[] = [];
  const seenPdf = new Set<string>();
  $("a[href*='.pdf']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = new URL(href, BASE_URL).toString();
    if (seenPdf.has(abs)) return;
    seenPdf.add(abs);
    pdfs.push({
      title:
        $(el).attr("title")?.trim() ||
        $(el).text().replace(/\s+/g, " ").trim() ||
        abs.split("/").pop()!,
      url: abs,
    });
  });

  const variants: RawProductVariant[] = [];
  info.find("select").each((_, el) => {
    const $el = $(el);
    const control = $el.attr("name") ?? $el.attr("id") ?? "select";
    // skip qty and other non-attribute controls
    if (/products_qty|language|currency|switch_country/.test(control)) return;
    const options = $el
      .find("option")
      .map((_, o) => $(o).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((t) => t && !/bitte auswählen/i.test(t));
    if (!options.length) return;
    const label =
      $el.closest(".form-group, .attribute, li, div").find("label").first().text().trim() ||
      control;
    variants.push({ control, label, options });
  });

  // Raw content region: strip noise, keep everything a human sees on the card.
  const region = info.clone();
  region.find("script, style, noscript, iframe, form .btn, .shariff").remove();
  const rawHtml = (region.html() ?? "").trim();
  region.find("br").replaceWith("\n");
  region.find("p, div, li, h1, h2, h3, h4, dt, dd, tr").each((_, el) => {
    $(el).append("\n");
  });
  const rawText = normalizeText(region.text());

  return {
    url,
    slug,
    title,
    shopArtNr,
    priceText,
    price,
    priceIsFrom,
    oldPriceText,
    availabilityText,
    breadcrumb,
    images,
    pdfs,
    variants,
    rawText,
    rawHtml,
    scrapedAt: new Date().toISOString(),
  };
}
