#!/usr/bin/env tsx
/**
 * Dev tool: read .calc-logs.json + .calc-snapshots/, replay v4, compare to reference 603 m².
 *
 * Usage:
 *   npm run calc:logs              # summary of last 10 runs
 *   npm run calc:logs -- --latest  # last run detail
 *   npm run calc:logs -- --replay  # replay latest snapshot with v4
 *   npm run calc:logs -- --ref603   # run reference fixture only
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CalcLogEntry, CalcLogSnapshot } from "../../lib/planner/calcLog";
import { computeSofortPlanV4Raw } from "../../lib/planner/v4/index";
import { estimatePlanMetrics } from "../../lib/planner/v4/coverage";
import { matchesReference603 } from "../../lib/planner/geometryFingerprint";
import {
  plan603m2Fixtures,
  plan603m2Reference,
  plan603m2Zones,
} from "../../lib/planner/fixtures/plan603m2";

const ROOT = process.cwd();
const LOG_FILE = path.join(ROOT, ".calc-logs.json");
const SNAPSHOT_DIR = path.join(ROOT, ".calc-snapshots");

function looksLike603(entry: CalcLogEntry): boolean {
  if (entry.geometry && matchesReference603(entry.geometry)) return true;
  return (
    entry.lawnCount === 1 &&
    entry.totalAreaM2 >= 598 &&
    entry.totalAreaM2 <= 610
  );
}

function fmtEntry(e: CalcLogEntry, i?: number): string {
  const prefix = i != null ? `${String(i + 1).padStart(2, " ")}. ` : "";
  const geo = e.geometry;
  const refTag = looksLike603(e) ? " [≈603m² ref]" : "";
  const build = e.algorithmBuild ?? "—";
  const cov = e.coveragePct != null ? `${e.coveragePct}%` : "—";
  const dry = e.dryPatchM2 != null ? `${e.dryPatchM2}m² dry` : "";
  const n360 =
    e.head360Count != null ? e.head360Count : "—";
  return [
    `${prefix}${e.timestamp.slice(0, 19)}`,
    `   ${e.algorithm}/${build} · ${e.brand} · ${e.headCount} heads (${n360}×360)`,
    `   families: ${Object.entries(e.headsByFamily)
      .map(([k, v]) => `${k}×${v}`)
      .join(", ") || "—"}`,
    `   area ${e.totalAreaM2} m² · cov ${cov} · ${dry}`,
    geo
      ? `   geo fp=${geo.fingerprint}${refTag} · lawn ${geo.lawns[0]?.areaM2 ?? "?"} m²`
      : "   geo: (no snapshot — recalc in dev to capture)",
    e.placeLabel ? `   place: ${e.placeLabel}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function readLogs(): Promise<CalcLogEntry[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readSnapshot(
  key: "latest" | string,
): Promise<CalcLogSnapshot | null> {
  const file =
    key === "latest"
      ? path.join(SNAPSHOT_DIR, "latest.json")
      : path.join(SNAPSHOT_DIR, `${key}.json`);
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as CalcLogSnapshot;
  } catch {
    return null;
  }
}

function replay(
  label: string,
  zones: CalcLogSnapshot["zones"],
  fixtures: CalcLogSnapshot["fixtures"],
  brand: "hunter" | "rainbird" = "hunter",
) {
  const plan = computeSofortPlanV4Raw(zones, fixtures, { brand });
  const heads = plan.heads.map((h) => ({
    ...h,
    configKey: h.sku,
    radiusM: h.actualRadiusM,
    flowLMin: h.flowLpm,
    kind: h.kind,
  }));
  const lawns = zones.filter((z) => z.type === "rasen");
  const obstacles = zones.filter(
    (z) => z.type === "gebaeude" || z.type === "trocken",
  );
  const m = estimatePlanMetrics(lawns, heads, obstacles);
  const fam: Record<string, number> = {};
  for (const h of plan.heads) {
    const k = h.sku.replace(/-360$/, "");
    fam[k] = (fam[k] ?? 0) + 1;
  }
  const n360 = plan.heads.filter((h) => h.arcDeg >= 315).length;

  console.log(`\n=== REPLAY ${label} ===`);
  console.log(`build: ${plan.algorithmBuild}`);
  console.log(
    `heads: ${plan.heads.length} (${n360}×360) · families: ${Object.entries(fam)
      .map(([k, v]) => `${k}×${v}`)
      .join(", ")}`,
  );
  console.log(
    `coverage: ${m.binaryCoveragePct?.toFixed(1)}% · dry patch: ${m.largestDryPatchM2?.toFixed(1)} m² · DU ${m.predictedDUlq?.toFixed(2) ?? "—"}`,
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has("--ref603")) {
    replay("reference 603 m² fixture", plan603m2Zones, plan603m2Fixtures);
    console.log(
      `\nreference targets: ${plan603m2Reference.headCount} heads (${plan603m2Reference.interior360Count}×360), R ${plan603m2Reference.targetRadiusMinM}–${plan603m2Reference.targetRadiusMaxM} m (geometry only)`,
    );
    return;
  }

  const logs = await readLogs();

  if (args.has("--replay")) {
    const snap = await readSnapshot("latest");
    if (!snap) {
      console.error(
        "No .calc-snapshots/latest.json — run Sofort-Berechnung in dev (npm run dev) first.",
      );
      process.exit(1);
    }
    replay(
      snap.placeLabel ?? snap.fingerprint,
      snap.zones,
      snap.fixtures,
    );
    return;
  }

  if (args.has("--latest")) {
    const last = logs.at(-1);
    if (!last) {
      console.log("No entries in .calc-logs.json");
      return;
    }
    console.log(fmtEntry(last));
    const snap = await readSnapshot("latest");
    if (snap) {
      console.log(`\nSnapshot: .calc-snapshots/latest.json (fp ${snap.fingerprint})`);
    }
    return;
  }

  if (logs.length === 0) {
    console.log("No .calc-logs.json yet.");
    console.log("Start dev server, open /konfigurator, run Sofort-Berechnung.");
    console.log("Or: npm run calc:logs -- --ref603");
    return;
  }

  console.log(`Calc logs (${logs.length} entries)\n`);
  const tail = logs.slice(-10);
  tail.forEach((e, i) => console.log(fmtEntry(e, logs.length - tail.length + i)));

  const last = logs.at(-1)!;
  if (looksLike603(last)) {
    console.log("\n→ Latest run matches ~603 m² reference geometry.");
    console.log("  Compare: npm run calc:logs -- --replay");
    console.log("  Reference: npm run calc:logs -- --ref603");
  }

  console.log("\nCommands:");
  console.log("  npm run calc:logs -- --latest");
  console.log("  npm run calc:logs -- --replay");
  console.log("  npm run calc:logs -- --ref603");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
