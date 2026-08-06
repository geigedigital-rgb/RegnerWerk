/**
 * Resolve manufacturer PDF text from local cache (data/raw/pdfs + pdf-text).
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const PDF_DIR = path.resolve("data/raw/pdfs");
const TEXT_DIR = path.resolve("data/raw/pdf-text");

export function pdfHash(url: string): string {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
}

export type CachedPdfText = {
  hash: string;
  url: string;
  title: string;
  chars: number;
  text: string;
};

export async function loadPdfTextByUrl(url: string): Promise<CachedPdfText | null> {
  const hash = pdfHash(url);
  const file = path.join(TEXT_DIR, `${hash}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as CachedPdfText;
  } catch {
    return null;
  }
}

/** Prefer Informationsblatt / Leistungstabelle over Bedienungsanleitung. */
export async function loadBestPdfText(
  pdfs: { title: string; url: string }[],
): Promise<CachedPdfText | null> {
  const scored = [...pdfs].sort((a, b) => score(b.title) - score(a.title));
  for (const p of scored) {
    const t = await loadPdfTextByUrl(p.url);
    if (t && t.chars >= 80) return t;
  }
  return null;
}

function score(title: string): number {
  const t = title.toLowerCase();
  if (/informationsblatt|leistung|kenndaten|spec|data\s*sheet/.test(t)) return 3;
  if (/bedienung|anleitung|manual|install/.test(t)) return 1;
  return 2;
}

export async function ensurePdfDirsExist(): Promise<boolean> {
  try {
    await fs.access(path.join(PDF_DIR, "index.json"));
    return true;
  } catch {
    return false;
  }
}
