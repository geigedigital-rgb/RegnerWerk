/**
 * Downloads all unique PDFs referenced in data/raw/products-ai.json
 * into data/raw/pdfs/<sha1>.pdf + index.json
 *
 * Usage: npx tsx scripts/catalog/download-pdfs.ts
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const RAW_AI = path.resolve("data/raw/products-ai.json");
const OUT_DIR = path.resolve("data/raw/pdfs");
const DELAY_MS = 400;

type PdfMeta = {
  url: string;
  title: string;
  hash: string;
  file: string;
  ok: boolean;
  bytes: number;
  error: string | null;
};

async function main() {
  const data = JSON.parse(await fs.readFile(RAW_AI, "utf8")) as {
    products: { pdfs?: { url: string; title: string }[] }[];
  };
  await fs.mkdir(OUT_DIR, { recursive: true });

  const seen = new Map<string, string>();
  for (const p of data.products) {
    for (const pdf of p.pdfs ?? []) {
      if (!seen.has(pdf.url)) seen.set(pdf.url, pdf.title);
    }
  }

  const urls = [...seen.entries()];
  console.log(`Unique PDFs: ${urls.length}`);
  const index: PdfMeta[] = [];

  for (let i = 0; i < urls.length; i++) {
    const [url, title] = urls[i];
    const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
    const file = path.join(OUT_DIR, `${hash}.pdf`);
    const meta: PdfMeta = { url, title, hash, file, ok: false, bytes: 0, error: null };

    try {
      const st = await fs.stat(file);
      if (st.size > 1000) {
        meta.ok = true;
        meta.bytes = st.size;
        index.push(meta);
        console.log(`[${i + 1}/${urls.length}] cache ${title.slice(0, 50)}`);
        continue;
      }
    } catch {
      /* miss */
    }

    try {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 RegnerWerkCatalogBot" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(file, buf);
      meta.ok = true;
      meta.bytes = buf.length;
      console.log(`[${i + 1}/${urls.length}] OK ${buf.length} ${title.slice(0, 50)}`);
    } catch (e) {
      meta.error = String(e);
      console.log(`[${i + 1}/${urls.length}] FAIL ${title.slice(0, 40)} ${e}`);
    }
    index.push(meta);
  }

  await fs.writeFile(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), pdfs: index }, null, 2),
  );
  console.log(`Done: ${index.filter((x) => x.ok).length}/${index.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
