import fs from "node:fs";
import { cachedFetch } from "./fetch";
import { parseProductPage } from "./product";

async function main() {
  const urls = [
    "https://www.wasserundgruen.de/teflon-dichtband-ptfe-gewindedichtband-1-stueck-weisser-kern-mit-gelbe-huelle-dicke-x-laenge-0-1-mm-x-12-m.html",
    "https://www.wasserundgruen.de/dbry-6-rain-bird-und-hunter-wasserdichte-anschluesse-kabelverbinder.html",
    "https://www.wasserundgruen.de/Rain-Bird-Ventilkasten-Standard-gross-eckig--Masse--600-x-430-x-300-mm--Original-Rain-Bird-VBA02675.html",
    "https://www.wasserundgruen.de/Scheibenfilter-3-4---1--und-1-1-2--auch-mit-Uebergang-auf-PE-25-mm--PE-32-mm--PE-40-mm-Anschluss-inkl--Verschraubung.html",
  ];
  const products = [];
  for (const url of urls) {
    const { html } = await cachedFetch(url, { force: true });
    const p = parseProductPage(url, html);
    products.push(p);
    console.log(p.slug, "price=", p.price);
  }
  fs.writeFileSync(
    "data/raw/products-bom-gaps.json",
    JSON.stringify(
      { scrapedAt: new Date().toISOString(), products },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
