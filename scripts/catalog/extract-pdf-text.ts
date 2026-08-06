/**
 * Extracts text (+ tables when available) from cached PDFs.
 * Output: data/raw/pdf-text/<hash>.json
 *
 * Usage: npx tsx scripts/catalog/extract-pdf-text.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";

const PDF_DIR = path.resolve("data/raw/pdfs");
const OUT_DIR = path.resolve("data/raw/pdf-text");

type Index = {
  pdfs: { url: string; title: string; hash: string; file: string; ok: boolean }[];
};

async function main() {
  const index = JSON.parse(
    await fs.readFile(path.join(PDF_DIR, "index.json"), "utf8"),
  ) as Index;
  await fs.mkdir(OUT_DIR, { recursive: true });

  let ok = 0;
  let empty = 0;
  for (const pdf of index.pdfs.filter((p) => p.ok)) {
    const outFile = path.join(OUT_DIR, `${pdf.hash}.json`);
    try {
      await fs.access(outFile);
      ok++;
      continue;
    } catch {
      /* extract */
    }

    try {
      const buf = await fs.readFile(pdf.file);
      const parser = new PDFParse({ data: buf });
      const textResult = await parser.getText();
      let tables: unknown = null;
      try {
        tables = await parser.getTable();
      } catch {
        tables = null;
      }
      const text = textResult.text ?? "";
      await fs.writeFile(
        outFile,
        JSON.stringify(
          {
            hash: pdf.hash,
            url: pdf.url,
            title: pdf.title,
            chars: text.length,
            text,
            tables,
            extractedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      if (text.trim().length < 80) {
        empty++;
        console.log(`[image?] ${pdf.hash} ${pdf.title.slice(0, 50)} chars=${text.length}`);
      } else {
        ok++;
        console.log(`[ok] ${pdf.hash} chars=${text.length} ${pdf.title.slice(0, 40)}`);
      }
    } catch (e) {
      console.log(`[fail] ${pdf.hash} ${e}`);
    }
  }
  console.log(`Extracted usable: ${ok}, likely image-only: ${empty}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
