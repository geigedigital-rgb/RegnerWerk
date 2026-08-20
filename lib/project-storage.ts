import type { DrawnZone, GeocodeFeature, PlotFixture, PlotStage } from "@/lib/mapbox";
import type { SofortPlan } from "@/lib/planner";
import type { CalcLogEntry } from "@/lib/planner/calcLog";

/**
 * Persisted garden project: address + drawing + Sofort plan.
 * Stored in localStorage so returning to the same address resumes work.
 */
export type SavedPlotProject = {
  version: 1;
  updatedAt: string;
  place: GeocodeFeature;
  zones: DrawnZone[];
  fixtures: PlotFixture[];
  sofortPlan: SofortPlan | null;
  plotStage: PlotStage;
  calcHistory?: CalcLogEntry[];
};

const INDEX_KEY = "rw-projects-index";

function projectKey(placeId: string) {
  return `rw-project:${placeId}`;
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* ignore */
  }
}

export function loadProject(placeId: string): SavedPlotProject | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(projectKey(placeId));
    if (!raw) {
      // Migrate legacy sessionStorage keys once
      return migrateLegacySession(placeId);
    }
    const parsed = JSON.parse(raw) as SavedPlotProject;
    if (!parsed || parsed.version !== 1 || !parsed.place?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function migrateLegacySession(placeId: string): SavedPlotProject | null {
  try {
    const zonesRaw = sessionStorage.getItem(`rw-plot-zones:${placeId}`);
    const fixturesRaw = sessionStorage.getItem(`rw-plot-fixtures:${placeId}`);
    const sofortRaw = sessionStorage.getItem(`rw-plot-sofort:${placeId}`);
    if (!zonesRaw && !fixturesRaw && !sofortRaw) return null;

    const zones = zonesRaw ? (JSON.parse(zonesRaw) as DrawnZone[]) : [];
    const fixtures = fixturesRaw
      ? (JSON.parse(fixturesRaw) as PlotFixture[])
      : [];
    const sofortPlan = sofortRaw
      ? (JSON.parse(sofortRaw) as SofortPlan)
      : null;
    const placeRaw = localStorage.getItem("rw-config-place");
    const place = placeRaw
      ? (JSON.parse(placeRaw) as GeocodeFeature)
      : null;
    if (!place || place.id !== placeId) return null;

    const project: SavedPlotProject = {
      version: 1,
      updatedAt: new Date().toISOString(),
      place,
      zones: Array.isArray(zones) ? zones : [],
      fixtures: Array.isArray(fixtures) ? fixtures : [],
      sofortPlan:
        sofortPlan && sofortPlan.version === 1 ? sofortPlan : null,
      plotStage: sofortPlan?.version === 1 ? "ergebnis" : "zones",
    };
    saveProject(project);
    return project;
  } catch {
    return null;
  }
}

export function saveProject(project: SavedPlotProject) {
  if (typeof window === "undefined") return;
  try {
    const next: SavedPlotProject = {
      ...project,
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(projectKey(project.place.id), JSON.stringify(next));
    const idx = readIndex();
    if (!idx.includes(project.place.id)) writeIndex([project.place.id, ...idx]);
    // Keep last place pointer in sync
    localStorage.setItem("rw-config-place", JSON.stringify(project.place));
  } catch {
    /* ignore quota */
  }
}

/** Create or refresh project shell when user picks an address. */
export function ensureProject(place: GeocodeFeature): SavedPlotProject {
  const existing = loadProject(place.id);
  if (existing) {
    const merged = { ...existing, place };
    saveProject(merged);
    return merged;
  }
  const fresh: SavedPlotProject = {
    version: 1,
    updatedAt: new Date().toISOString(),
    place,
    zones: [],
    fixtures: [],
    sofortPlan: null,
    plotStage: "zones",
  };
  saveProject(fresh);
  return fresh;
}

export function patchProject(
  placeId: string,
  patch: Partial<
    Pick<
      SavedPlotProject,
      "zones" | "fixtures" | "sofortPlan" | "plotStage" | "place"
    >
  >,
): SavedPlotProject | null {
  const cur = loadProject(placeId);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  saveProject(next);
  return next;
}
