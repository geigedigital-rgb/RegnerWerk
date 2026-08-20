import type { DrawnZone, PlotFixture } from "@/lib/mapbox";
import type { SofortPlan, AlgorithmVersion } from "./types";
import {
  geometrySummary,
  type GeometrySummary,
} from "./geometryFingerprint";

export type CalcLogEntry = {
  timestamp: string;
  algorithm: AlgorithmVersion;
  /** Planner build tag, e.g. v4.chain-deficit-603-2026.08 */
  algorithmBuild?: string;
  brand: string;
  placeId?: string;
  placeLabel?: string;
  geometry?: GeometrySummary;
  lawnCount: number;
  totalAreaM2: number;
  headCount: number;
  head360Count: number;
  zoneCount: number;
  coveragePct?: number;
  dryPatchM2?: number;
  duLq?: number;
  zones: Array<{
    id: string;
    headCount: number;
    flowLpm: number;
    families: string[];
  }>;
  headsByFamily: Record<string, number>;
  warningCount: number;
};

export type CalcLogSnapshot = {
  savedAt: string;
  placeId?: string;
  placeLabel?: string;
  fingerprint: string;
  zones: DrawnZone[];
  fixtures: PlotFixture[];
};

const STORAGE_KEY = "rw-calc-logs";
const MAX_ENTRIES = 50;

/** In-memory accumulator for the current session. */
let sessionHistory: CalcLogEntry[] = [];

function headFamily(configKey: string): string {
  const atIdx = configKey.indexOf("@");
  const base = atIdx >= 0 ? configKey.slice(0, atIdx) : configKey;
  const m = base.match(/^(.+?)-\d{2,3}$/);
  return m ? m[1] : base;
}

function buildEntry(
  plan: SofortPlan,
  lawnAreas: { id: string; areaM2: number }[],
  opts?: {
    zones?: DrawnZone[];
    placeId?: string;
    placeLabel?: string;
  },
): CalcLogEntry {
  const zoneMap = new Map<
    number,
    { ids: string[]; flow: number; families: Set<string> }
  >();
  for (const h of plan.heads) {
    const z = h.hydraulicZone;
    if (!zoneMap.has(z))
      zoneMap.set(z, { ids: [], flow: 0, families: new Set() });
    const entry = zoneMap.get(z)!;
    entry.ids.push(h.id);
    entry.flow += h.flowLMin;
    entry.families.add(headFamily(h.configKey));
  }

  const familyCounts: Record<string, number> = {};
  for (const h of plan.heads) {
    const fk = headFamily(h.configKey);
    familyCounts[fk] = (familyCounts[fk] ?? 0) + 1;
  }

  const geometry =
    opts?.zones && opts.zones.length > 0
      ? geometrySummary(opts.zones)
      : undefined;

  return {
    timestamp: new Date().toISOString(),
    algorithm: plan.algorithmVersion ?? "v1",
    algorithmBuild: plan.algorithmBuild,
    brand: plan.brand ?? "hunter",
    placeId: opts?.placeId,
    placeLabel: opts?.placeLabel,
    geometry,
    lawnCount: lawnAreas.length,
    totalAreaM2: Math.round(lawnAreas.reduce((s, l) => s + l.areaM2, 0) * 10) / 10,
    headCount: plan.heads.length,
    head360Count: plan.heads.filter((h) => h.arcDeg >= 315).length,
    zoneCount: zoneMap.size,
    coveragePct:
      plan.coveragePct != null
        ? Math.round(plan.coveragePct * 10) / 10
        : plan.metrics?.binaryCoveragePct != null
          ? Math.round(plan.metrics.binaryCoveragePct * 10) / 10
          : undefined,
    dryPatchM2:
      plan.metrics?.largestDryPatchM2 != null
        ? Math.round(plan.metrics.largestDryPatchM2 * 10) / 10
        : undefined,
    duLq:
      plan.metrics?.predictedDUlq != null
        ? Math.round(plan.metrics.predictedDUlq * 100) / 100
        : undefined,
    zones: [...zoneMap.entries()].map(([z, data]) => ({
      id: `valve-${z}`,
      headCount: data.ids.length,
      flowLpm: Math.round(data.flow * 10) / 10,
      families: [...data.families],
    })),
    headsByFamily: familyCounts,
    warningCount: plan.warnings?.length ?? 0,
  };
}

function buildSnapshot(
  entry: CalcLogEntry,
  zones: DrawnZone[],
  fixtures: PlotFixture[],
): CalcLogSnapshot | null {
  if (!entry.geometry?.fingerprint || zones.length === 0) return null;
  return {
    savedAt: entry.timestamp,
    placeId: entry.placeId,
    placeLabel: entry.placeLabel,
    fingerprint: entry.geometry.fingerprint,
    zones,
    fixtures,
  };
}

export function logCalculation(
  plan: SofortPlan,
  lawnAreas: { id: string; areaM2: number }[],
  opts?: {
    zones?: DrawnZone[];
    fixtures?: PlotFixture[];
    placeId?: string;
    placeLabel?: string;
  },
): void {
  try {
    const entry = buildEntry(plan, lawnAreas, opts);
    sessionHistory.push(entry);
    if (sessionHistory.length > MAX_ENTRIES) {
      sessionHistory = sessionHistory.slice(-MAX_ENTRIES);
    }

    const snapshot =
      opts?.zones && opts.fixtures
        ? buildSnapshot(entry, opts.zones, opts.fixtures)
        : null;

    if (typeof window !== "undefined" && window.localStorage) {
      const raw = localStorage.getItem(STORAGE_KEY);
      const logs: CalcLogEntry[] = raw ? JSON.parse(raw) : [];
      logs.push(entry);
      if (logs.length > MAX_ENTRIES) logs.splice(0, logs.length - MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    }

    if (typeof window !== "undefined") {
      fetch("/api/calc-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry, snapshot }),
      }).catch(() => {});
    }
  } catch {
    // silently ignore
  }
}

/** Get all accumulated calc logs for the current session. */
export function getCalcHistory(): CalcLogEntry[] {
  return sessionHistory;
}

/** Reset session history (e.g. when starting a new project). */
export function clearCalcHistory(): void {
  sessionHistory = [];
}
