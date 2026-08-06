# Normalized catalog

## Source of truth (ready characteristics)

**[`products_normalized.json`](./products_normalized.json)** — full normalized catalog (all SKUs) with extracted attributes and performance tables.

**[`products_universal_up_to_500m2.json`](./products_universal_up_to_500m2.json)** — key products for the universal assortment / Fertig packs up to ~500 m² (subset curated for Sofort-Berechnung).

Built from `data/raw/products-ai.json` via:

```bash
npm run scrape:variants   # expand shop dropdowns → 1 SKU each (price + Art.Nr via CheckStatus)
npm run catalog:expand    # rebuild all SKUs from AI scrape
npm run catalog:enrich    # fill attrs/tables from PDF + shop text
```

Multi-SKU shop pages (e.g. Scheibenfilter size/PE options) are expanded into separate cards with `source.source_variant`, `article` (shop Art.Nr), and prices stored in the AI scrape.

Supporting files:

- `group_schemas.json` / `catalog_taxonomy.json` — attribute schemas
- `enrichment_report.json` / `expand_report.json` — last run stats
- `products_needs_review.json` — cards still flagged for review
