import fs from "node:fs";
import { PDFParse } from "pdf-parse";

async function dump(file: string) {
  const parser = new PDFParse({ data: fs.readFileSync(file) });
  const result = await parser.getText();
  console.log("====", file, "chars", result.text.length);
  console.log(result.text.slice(0, 3500));
  try {
    const tables = await parser.getTable();
    console.log("--- tables ---", JSON.stringify(tables).slice(0, 2000));
  } catch (e) {
    console.log("no tables", e);
  }
}

async function main() {
  await dump("data/raw/pdfs/pga-info.pdf");
  await dump("data/raw/pdfs/jet-spike.pdf");
}

main();
