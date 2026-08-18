"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  DraftingCompass,
  Satellite,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FixtureCursor,
  FixtureMarker,
  FixtureStepIcon,
} from "@/components/konfigurator/FixtureMarker";
import { WasserquelleDialog, type WasserquelleResult } from "@/components/konfigurator/WasserquelleDialog";
import {
  PlanChoiceDialog,
  type PlanChoice,
} from "@/components/konfigurator/PlanChoiceDialog";
import {
  distMeters,
  findZoneAtPoint,
  FIXTURE_STEPS,
  formatAreaM2,
  formatMeters,
  getMapboxToken,
  perimeterMeters,
  PLOT_STAGE_ORDER,
  polygonAreaM2,
  polygonCentroid,
  WASSERQUELLE_TYPES,
  ZONE_TYPES,
  type DrawnZone,
  type FixtureKind,
  type GeocodeFeature,
  type LngLat,
  type PlotFixture,
  type PlotStage,
  type ZoneTypeId,
} from "@/lib/mapbox";
import {
  resolveDrawSnap,
  type SnapGuide,
  type SnapKind,
} from "@/lib/plot-snap";
import {
  computeSofortPlan,
  clampHeadGeometry,
  CLIENT_ALGORITHM,
  DEFAULT_BRAND,
  normalizeLoadedPlan,
  recomputeAfterEdit,
  type SofortPlan,
  type SprinklerBrand,
} from "@/lib/planner";
import {
  SofortOverlay,
  type PipeSelection,
} from "@/components/konfigurator/SofortOverlay";
import { SofortPanel } from "@/components/konfigurator/SofortPanel";
import { SofortCalcLoader } from "@/components/konfigurator/SofortCalcLoader";
import { RailCountIcon } from "@/components/konfigurator/RailCountIcon";
import {
  DEFAULT_PLAN_LAYER_MODE,
  layersFromMode,
  PlanEditMenu,
  type PlanLayerMode,
} from "@/components/konfigurator/PlanEditMenu";
import {
  ensureProject,
  loadProject,
  patchProject,
  type SavedPlotProject,
} from "@/lib/project-storage";
import {
  downloadProjectPdf,
  submitProject,
} from "@/lib/project-api";

type Props = {
  place: GeocodeFeature;
  onBack: () => void;
  /** Server project id when opened from admin (?projectId=). */
  serverProjectId?: string | null;
};

type ViewMode = "satellite" | "canvas";

const STYLE_SAT = "mapbox://styles/mapbox/satellite-streets-v12";
/** Max. Abstand Wasserverteiler ↔ Smarthome-Steuerung (Strom/Steuerleitung). */
const VERTEILER_MAX_FROM_SMART_M = 10;

type ScreenPt = { x: number; y: number; lng: number; lat: number };

function projectAll(map: mapboxgl.Map, points: LngLat[]): ScreenPt[] {
  return points.map((p) => {
    const { x, y } = map.project([p.lng, p.lat]);
    return { x, y, lng: p.lng, lat: p.lat };
  });
}

function loadZones(placeId: string): DrawnZone[] {
  return loadProject(placeId)?.zones ?? [];
}

function saveZones(place: GeocodeFeature, zones: DrawnZone[]) {
  ensureProject(place);
  patchProject(place.id, { zones });
}

function loadFixtures(placeId: string): PlotFixture[] {
  return loadProject(placeId)?.fixtures ?? [];
}

function saveFixtures(place: GeocodeFeature, fixtures: PlotFixture[]) {
  ensureProject(place);
  patchProject(place.id, { fixtures });
}

function loadSofortPlan(placeId: string): SofortPlan | null {
  const plan = loadProject(placeId)?.sofortPlan ?? null;
  if (!plan || plan.version !== 1 || !Array.isArray(plan.heads)) return null;
  return normalizeLoadedPlan(plan);
}

function saveSofortPlan(place: GeocodeFeature, plan: SofortPlan | null) {
  ensureProject(place);
  const cur = loadProject(place.id);
  patchProject(place.id, {
    sofortPlan: plan,
    plotStage: plan
      ? "ergebnis"
      : cur?.plotStage === "ergebnis"
        ? "technik"
        : (cur?.plotStage ?? "zones"),
  });
}

function loadPlotStage(placeId: string): PlotStage {
  const p = loadProject(placeId);
  if (p?.plotStage) return p.plotStage;
  return p?.sofortPlan ? "ergebnis" : "zones";
}

function isTechnikStage(stage: PlotStage): boolean {
  return stage === "technik";
}

function nearestSmarthome(
  pos: LngLat,
  fixtures: PlotFixture[],
): { smart: PlotFixture; meters: number } | null {
  const smarts = fixtures.filter((f) => f.kind === "smarthome");
  if (smarts.length === 0) return null;
  let best: { smart: PlotFixture; meters: number } | null = null;
  for (const s of smarts) {
    const meters = distMeters(pos, s.position);
    if (!best || meters < best.meters) best = { smart: s, meters };
  }
  return best;
}

function nearestSmarthomeMeters(
  pos: LngLat,
  fixtures: PlotFixture[],
): number | null {
  return nearestSmarthome(pos, fixtures)?.meters ?? null;
}

export function PlotMap({
  place,
  onBack,
  serverProjectId: initialServerId = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const addressMarkerRef = useRef<mapboxgl.Marker | null>(null);

  /** Armed Flächen-Typ; null = normaler Cursor (wählen/bearbeiten). */
  const [armedZone, setArmedZone] = useState<ZoneTypeId | null>(null);
  const [draftPoints, setDraftPoints] = useState<LngLat[]>([]);
  const [zones, setZones] = useState<DrawnZone[]>(() => loadZones(place.id));
  const [fixtures, setFixtures] = useState<PlotFixture[]>(() =>
    loadFixtures(place.id),
  );
  const [plotStage, setPlotStage] = useState<PlotStage>(() =>
    loadPlotStage(place.id),
  );
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("satellite");
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapEpoch, setMapEpoch] = useState(0);
  const [snapClose, setSnapClose] = useState(false);
  const [snapKind, setSnapKind] = useState<SnapKind | null>(null);
  const [snapGuide, setSnapGuide] = useState<SnapGuide | null>(null);
  const [cursor, setCursor] = useState<LngLat | null>(null);
  const [screenDraft, setScreenDraft] = useState<ScreenPt[]>([]);
  const [screenCursor, setScreenCursor] = useState<ScreenPt | null>(null);
  const [screenZones, setScreenZones] = useState<ScreenPt[][]>([]);
  const [screenFixtures, setScreenFixtures] = useState<ScreenPt[]>([]);
  const [fixtureCursor, setFixtureCursor] = useState<{
    x: number;
    y: number;
    lng: number;
    lat: number;
  } | null>(null);
  /** Selected Technik tool in left rail; null = normal cursor. */
  const [armedKind, setArmedKind] = useState<FixtureKind | null>(null);
  const [pendingWasserquelle, setPendingWasserquelle] = useState<{
    id: string;
    position: LngLat;
  } | null>(null);
  const [technikWarning, setTechnikWarning] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [planChoiceOpen, setPlanChoiceOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [calcMode, setCalcMode] = useState<"full" | "brand" | null>(null);
  const [pendingBrand, setPendingBrand] = useState<SprinklerBrand>(DEFAULT_BRAND);
  const pendingBrandRef = useRef<SprinklerBrand>(DEFAULT_BRAND);
  const [sofortPlan, setSofortPlan] = useState<SofortPlan | null>(() =>
    loadSofortPlan(place.id),
  );
  const [selectedHeadId, setSelectedHeadId] = useState<string | null>(null);
  const [selectedPipe, setSelectedPipe] = useState<PipeSelection | null>(null);
  const [planLayerMode, setPlanLayerMode] =
    useState<PlanLayerMode>(DEFAULT_PLAN_LAYER_MODE);
  const planLayers = layersFromMode(planLayerMode);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(
    null,
  );
  const [renderTick, setRenderTick] = useState(0);
  const [serverProjectId, setServerProjectId] = useState<string | null>(
    initialServerId,
  );

  const armedZoneRef = useRef(armedZone);
  const sofortPlanRef = useRef<SofortPlan | null>(null);
  const selectedHeadIdRef = useRef<string | null>(null);
  const draftRef = useRef(draftPoints);
  const zonesRef = useRef(zones);
  const fixturesRef = useRef(fixtures);
  const plotStageRef = useRef(plotStage);
  const cursorRef = useRef<LngLat | null>(null);
  const snapKindRef = useRef<SnapKind | null>(null);
  const fixtureCursorLngLatRef = useRef<LngLat | null>(null);
  const armedKindRef = useRef<FixtureKind | null>(null);
  const selectedZoneIdRef = useRef<string | null>(null);
  const selectedVertexRef = useRef<number | null>(null);
  const readyOnceRef = useRef(false);
  const lastPlaceKeyRef = useRef("");
  useEffect(() => {
    armedZoneRef.current = armedZone;
  }, [armedZone]);
  useEffect(() => {
    draftRef.current = draftPoints;
  }, [draftPoints]);
  useEffect(() => {
    zonesRef.current = zones;
    saveZones(place, zones);
  }, [zones, place]);
  useEffect(() => {
    fixturesRef.current = fixtures;
    saveFixtures(place, fixtures);
  }, [fixtures, place]);
  useEffect(() => {
    plotStageRef.current = plotStage;
    ensureProject(place);
    patchProject(place.id, { plotStage });
  }, [plotStage, place]);
  useEffect(() => {
    armedKindRef.current = armedKind;
  }, [armedKind]);
  useEffect(() => {
    selectedZoneIdRef.current = selectedZoneId;
  }, [selectedZoneId]);
  useEffect(() => {
    selectedVertexRef.current = selectedVertex;
  }, [selectedVertex]);
  useEffect(() => {
    sofortPlanRef.current = sofortPlan;
    saveSofortPlan(place, sofortPlan);
  }, [sofortPlan, place]);
  useEffect(() => {
    selectedHeadIdRef.current = selectedHeadId;
  }, [selectedHeadId]);

  useEffect(() => {
    if (!technikWarning) return;
    const id = window.setTimeout(() => setTechnikWarning(null), 7000);
    return () => window.clearTimeout(id);
  }, [technikWarning]);

  const pendingWasserquelleRef = useRef(pendingWasserquelle);
  useEffect(() => {
    pendingWasserquelleRef.current = pendingWasserquelle;
  }, [pendingWasserquelle]);

  const planChoiceOpenRef = useRef(planChoiceOpen);
  const resetConfirmOpenRef = useRef(resetConfirmOpen);
  useEffect(() => {
    planChoiceOpenRef.current = planChoiceOpen;
  }, [planChoiceOpen]);
  useEffect(() => {
    resetConfirmOpenRef.current = resetConfirmOpen;
  }, [resetConfirmOpen]);

  function clearMapCursor() {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = "";
  }

  function disarmTool() {
    armedKindRef.current = null;
    setArmedKind(null);
    fixtureCursorLngLatRef.current = null;
    setFixtureCursor(null);
    clearMapCursor();
  }

  /** ESC / cancel: drop unfinished draft + any armed tool → normal cursor */
  function cancelInteraction() {
    draftRef.current = [];
    setDraftPoints([]);
    setScreenDraft([]);
    cursorRef.current = null;
    snapKindRef.current = null;
    setCursor(null);
    setSnapClose(false);
    setSnapKind(null);
    setSnapGuide(null);
    setScreenCursor(null);
    setSelectedZoneId(null);
    setSelectedVertex(null);
    selectedZoneIdRef.current = null;
    selectedVertexRef.current = null;
    armedZoneRef.current = null;
    setArmedZone(null);
    setPendingWasserquelle(null);
    setTechnikWarning(null);
    setPlanChoiceOpen(false);
    setResetConfirmOpen(false);
    setSelectedHeadId(null);
    selectedHeadIdRef.current = null;
    setSelectedFixtureId(null);
    disarmTool();
  }

  function clearDraftOnly() {
    draftRef.current = [];
    setDraftPoints([]);
    setScreenDraft([]);
    cursorRef.current = null;
    snapKindRef.current = null;
    setCursor(null);
    setSnapClose(false);
    setSnapKind(null);
    setSnapGuide(null);
    setScreenCursor(null);
  }

  function disarmZoneTool() {
    armedZoneRef.current = null;
    setArmedZone(null);
    clearDraftOnly();
  }

  function toggleZoneTool(id: ZoneTypeId) {
    if (armedZoneRef.current === id) {
      disarmZoneTool();
      return;
    }
    clearDraftOnly();
    setSelectedZoneId(null);
    setSelectedVertex(null);
    selectedZoneIdRef.current = null;
    selectedVertexRef.current = null;
    armedZoneRef.current = id;
    setArmedZone(id);
  }

  // Leaving Flächen / entering Technik: clear draft + disarm
  useEffect(() => {
    cancelInteraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotStage]);

  // Cursor style while a Technik tool is armed
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (plotStage === "technik" && armedKind) {
      map.getCanvas().style.cursor = "none";
    } else {
      map.getCanvas().style.cursor = "";
      if (!armedKind) {
        fixtureCursorLngLatRef.current = null;
        setFixtureCursor(null);
      }
    }
  }, [armedKind, plotStage]);

  // ESC / Entf on Flächen stage
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        pendingWasserquelleRef.current ||
        planChoiceOpenRef.current ||
        resetConfirmOpenRef.current
      ) {
        if (e.key === "Escape" && resetConfirmOpenRef.current) {
          e.preventDefault();
          setResetConfirmOpen(false);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelInteraction();
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        plotStageRef.current === "ergebnis" &&
        selectedHeadIdRef.current != null
      ) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        deleteSelectedHead();
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        plotStageRef.current === "zones" &&
        !armedZoneRef.current &&
        selectedZoneIdRef.current != null &&
        selectedVertexRef.current != null
      ) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        deleteSelectedVertex();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload project when address changes
  useEffect(() => {
    ensureProject(place);
    setZones(loadZones(place.id));
    setFixtures(loadFixtures(place.id));
    setSofortPlan(loadSofortPlan(place.id));
    setPlotStage(loadPlotStage(place.id));
    cancelInteraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id]);

  const lng = place.center[0];
  const lat = place.center[1];
  const zoneColor =
    ZONE_TYPES.find((z) => z.id === armedZone)?.color ?? "#00FFCF";
  const placeKey = `${place.id}:${lng}:${lat}`;
  const isCanvas = viewMode === "canvas";
  const drawing = plotStage === "zones";
  const onTechnik = isTechnikStage(plotStage);
  const onErgebnis = plotStage === "ergebnis";
  const armedMeta = armedKind
    ? FIXTURE_STEPS.find((s) => s.id === armedKind)
    : null;
  const stageIndex = PLOT_STAGE_ORDER.indexOf(plotStage);
  const totalFixtures = fixtures.length;
  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const editingZone = drawing && !armedZone && selectedZone != null;
  const activeZoneLabel =
    ZONE_TYPES.find(
      (z) => z.id === (armedZone ?? selectedZone?.type ?? "rasen"),
    )?.label ?? "Fläche";

  const draftStats = useMemo(() => {
    const canClose = draftPoints.length >= 3;
    const periBase = perimeterMeters(draftPoints, false);
    let peri = periBase;
    if (draftPoints.length >= 1 && cursor) {
      const last = draftPoints[draftPoints.length - 1];
      const target = snapClose && canClose ? draftPoints[0] : cursor;
      peri =
        snapClose && canClose
          ? perimeterMeters(draftPoints, true)
          : periBase + distMeters(last, target);
    }
    const areaRing =
      canClose && cursor && !snapClose
        ? [...draftPoints, cursor]
        : draftPoints;
    return {
      peri,
      area: canClose ? polygonAreaM2(areaRing) : 0,
      canClose,
    };
  }, [draftPoints, cursor, snapClose]);

  const zoneSummaries = useMemo(
    () =>
      zones.map((z) => {
        const meta = ZONE_TYPES.find((t) => t.id === z.type);
        return {
          ...z,
          label: meta?.label ?? z.type,
          color: meta?.color ?? "#00FFCF",
          area: polygonAreaM2(z.coordinates),
          peri: perimeterMeters(z.coordinates, true),
        };
      }),
    [zones],
  );

  const totalArea = useMemo(
    () => zoneSummaries.reduce((s, z) => s + z.area, 0),
    [zoneSummaries],
  );

  function closeDraft(points: LngLat[]) {
    if (points.length < 3) return;
    const type = armedZoneRef.current;
    if (!type) return;
    const id = `zone-${Date.now()}`;
    setZones((prev) => [
      ...prev,
      {
        id,
        type,
        coordinates: [...points],
      },
    ]);
    setSelectedZoneId(null);
    setSelectedVertex(null);
    selectedZoneIdRef.current = null;
    selectedVertexRef.current = null;
    setDraftPoints([]);
    setScreenDraft([]);
    cursorRef.current = null;
    snapKindRef.current = null;
    setCursor(null);
    setSnapClose(false);
    setSnapKind(null);
    setSnapGuide(null);
    setScreenCursor(null);
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 2800);
  }

  function syncScreen() {
    const map = mapRef.current;
    if (!map) return;
    setScreenDraft(projectAll(map, draftRef.current));
    setScreenZones(
      zonesRef.current.map((z) => projectAll(map, z.coordinates)),
    );
    setScreenFixtures(
      projectAll(
        map,
        fixturesRef.current.map((f) => f.position),
      ),
    );
    const c = cursorRef.current;
    setScreenCursor(c ? projectAll(map, [c])[0] : null);
    const fc = fixtureCursorLngLatRef.current;
    if (fc && plotStageRef.current !== "zones") {
      const p = map.project([fc.lng, fc.lat]);
      setFixtureCursor({ x: p.x, y: p.y, lng: fc.lng, lat: fc.lat });
    }
    setRenderTick((t) => t + 1);
  }

  // ── Map lifecycle ─────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let map: mapboxgl.Map | null = null;
    let ro: ResizeObserver | null = null;
    let pollId = 0;
    let forceReadyId = 0;

    const isNewPlace = lastPlaceKeyRef.current !== placeKey;
    lastPlaceKeyRef.current = placeKey;
    if (isNewPlace) {
      readyOnceRef.current = false;
      setReady(false);
      setMapError(null);
    }

    const markReady = () => {
      if (cancelled || readyOnceRef.current) return;
      readyOnceRef.current = true;
      setReady(true);
      setMapError(null);
      map?.resize();
      syncScreen();
      setMapEpoch((n) => n + 1);
    };

    try {
      mapboxgl.accessToken = getMapboxToken();
      map = new mapboxgl.Map({
        container: el,
        style: STYLE_SAT,
        center: [lng, lat],
        zoom: 18,
        pitch: 0,
        bearing: 0,
        attributionControl: true,
        failIfMajorPerformanceCaveat: false,
      });
      mapRef.current = map;

      map.addControl(
        new mapboxgl.NavigationControl({
          visualizePitch: false,
          showCompass: true,
        }),
        "bottom-right",
      );

      addressMarkerRef.current = new mapboxgl.Marker({ color: "#00FFCF" })
        .setLngLat([lng, lat])
        .addTo(map);

      map.on("error", (e) => {
        if (cancelled || readyOnceRef.current) return;
        if (!map?.loaded()) {
          setMapError(
            e.error?.message ||
              "Karte konnte nicht geladen werden. Token-URL prüfen.",
          );
        }
      });

      map.once("load", markReady);
      map.once("idle", markReady);

      pollId = window.setInterval(() => {
        if (cancelled || !map) return;
        if (map.isStyleLoaded() || map.loaded()) {
          markReady();
          window.clearInterval(pollId);
        }
      }, 150);

      forceReadyId = window.setTimeout(() => {
        if (!cancelled) markReady();
      }, 1000);

      const onMove = () => syncScreen();
      map.on("move", onMove);
      map.on("zoom", onMove);
      map.on("resize", onMove);

      const snapAt = (raw: LngLat) => {
        const m = map;
        if (!m) return null;
        return resolveDrawSnap({
          cursor: raw,
          draft: draftRef.current,
          zones: zonesRef.current,
          project: (p) => m.project([p.lng, p.lat]),
          unproject: (x, y) => {
            const ll = m.unproject([x, y]);
            return { lng: ll.lng, lat: ll.lat };
          },
        });
      };

      const clearCursorSnap = () => {
        cursorRef.current = null;
        snapKindRef.current = null;
        setCursor(null);
        setSnapClose(false);
        setSnapKind(null);
        setSnapGuide(null);
        setScreenCursor(null);
      };

      const VERTEX_HIT_PX = 14;
      const vertexDragRef = {
        current: null as null | { zoneId: string; index: number },
      };
      const suppressClickRef = { current: false };

      const findVertexNear = (
        zoneId: string,
        screen: { x: number; y: number },
      ): number | null => {
        const z = zonesRef.current.find((x) => x.id === zoneId);
        const m = map;
        if (!z || !m) return null;
        let best: number | null = null;
        let bestD = VERTEX_HIT_PX;
        z.coordinates.forEach((p, i) => {
          const s = m.project([p.lng, p.lat]);
          const d = Math.hypot(s.x - screen.x, s.y - screen.y);
          if (d <= bestD) {
            bestD = d;
            best = i;
          }
        });
        return best;
      };

      map.on("mousemove", (e) => {
        const stage = plotStageRef.current;
        const raw: LngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        const scr = map!.project([raw.lng, raw.lat]);

        // Technik: ghost cursor only when a tool is armed from left panel
        if (stage === "technik") {
          clearCursorSnap();
          const kind = armedKindRef.current;
          if (!kind) {
            fixtureCursorLngLatRef.current = null;
            setFixtureCursor(null);
            return;
          }
          fixtureCursorLngLatRef.current = raw;
          setFixtureCursor({ x: scr.x, y: scr.y, lng: raw.lng, lat: raw.lat });
          return;
        }

        fixtureCursorLngLatRef.current = null;
        setFixtureCursor(null);

        // Edit: drag selected zone vertex
        const drag = vertexDragRef.current;
        if (drag) {
          clearCursorSnap();
          setZones((prev) =>
            prev.map((z) => {
              if (z.id !== drag.zoneId) return z;
              const coordinates = z.coordinates.map((p, i) =>
                i === drag.index ? raw : p,
              );
              return { ...z, coordinates };
            }),
          );
          return;
        }

        const armed = armedZoneRef.current;
        if (!armed) {
          clearCursorSnap();
          return;
        }

        const draft = draftRef.current;
        // Allow vertex magnet even before first point (shared corners)
        if (draft.length === 0 && zonesRef.current.length === 0) {
          clearCursorSnap();
          return;
        }
        if (draft.length === 0) {
          const snap = snapAt(raw);
          if (snap?.kind === "vertex") {
            cursorRef.current = snap.point;
            snapKindRef.current = snap.kind;
            setCursor(snap.point);
            setSnapClose(false);
            setSnapKind(snap.kind);
            setSnapGuide(null);
            setScreenCursor({
              x: snap.screen.x,
              y: snap.screen.y,
              lng: snap.point.lng,
              lat: snap.point.lat,
            });
          } else {
            clearCursorSnap();
          }
          return;
        }

        const snap = snapAt(raw);
        const next = snap?.point ?? raw;
        const nextScr = snap?.screen ?? scr;
        cursorRef.current = next;
        snapKindRef.current = snap?.kind ?? null;
        setCursor(next);
        setSnapClose(snap?.kind === "close");
        setSnapKind(snap?.kind ?? null);
        setSnapGuide(snap?.guide ?? null);
        setScreenCursor({
          x: nextScr.x,
          y: nextScr.y,
          lng: next.lng,
          lat: next.lat,
        });
      });

      map.on("mousedown", (e) => {
        if (plotStageRef.current !== "zones") return;
        if (armedZoneRef.current) return;
        const sel = selectedZoneIdRef.current;
        if (!sel) return;
        const scr = { x: e.point.x, y: e.point.y };
        const vi = findVertexNear(sel, scr);
        if (vi == null) return;
        vertexDragRef.current = { zoneId: sel, index: vi };
        setSelectedVertex(vi);
        selectedVertexRef.current = vi;
        suppressClickRef.current = false;
        map!.dragPan.disable();
        e.preventDefault();
      });

      map.on("mouseup", () => {
        if (vertexDragRef.current) {
          suppressClickRef.current = true;
          vertexDragRef.current = null;
          map!.dragPan.enable();
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
        }
      });

      map.getCanvas().addEventListener("mouseleave", () => {
        clearCursorSnap();
        fixtureCursorLngLatRef.current = null;
        setFixtureCursor(null);
        if (vertexDragRef.current) {
          vertexDragRef.current = null;
          map!.dragPan.enable();
        }
      });

      map.on("click", (e) => {
        const raw: LngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        const stage = plotStageRef.current;

        // Ergebnis: map click deselects the current head
        if (stage === "ergebnis") {
          setSelectedHeadId(null);
          selectedHeadIdRef.current = null;
          return;
        }

        // Technik-Punkte — only when tool selected in left panel
        if (stage === "technik") {
          const kind = armedKindRef.current;
          if (!kind) return;
          e.preventDefault();

          if (kind === "wasserverteiler") {
            const dist = nearestSmarthomeMeters(raw, fixturesRef.current);
            if (dist == null) {
              setTechnikWarning(
                "Zuerst Smarthome-Steuerung setzen. Der Wasserverteiler braucht Strom und Steuerleitung – max. 10 m Abstand zur Steuerung.",
              );
              return;
            }
            if (dist > VERTEILER_MAX_FROM_SMART_M) {
              setTechnikWarning(
                `Zu weit von der Smarthome-Steuerung (${formatMeters(dist)}, erlaubt max. ${VERTEILER_MAX_FROM_SMART_M} m). Der Verteiler muss nah am Controller bleiben – kurze Steuerleitung und zuverlässige Stromversorgung.`,
              );
              return;
            }
          }

          disarmTool();
          setTechnikWarning(null);
          if (kind === "wasserquelle") {
            setPendingWasserquelle({
              id: `fix-wasserquelle-${Date.now()}`,
              position: raw,
            });
            return;
          }
          setFixtures((prev) => [
            ...prev,
            {
              id: `fix-${kind}-${Date.now()}`,
              kind,
              position: raw,
            },
          ]);
          return;
        }

        if (suppressClickRef.current) return;

        const armed = armedZoneRef.current;

        // Cursor mode: select zone / vertex for editing
        if (!armed) {
          const selId = selectedZoneIdRef.current;
          if (selId) {
            const vi = findVertexNear(selId, { x: e.point.x, y: e.point.y });
            if (vi != null) {
              setSelectedVertex(vi);
              selectedVertexRef.current = vi;
              return;
            }
          }
          const hit = findZoneAtPoint(zonesRef.current, raw);
          if (hit) {
            setSelectedZoneId(hit.id);
            selectedZoneIdRef.current = hit.id;
            setSelectedVertex(null);
            selectedVertexRef.current = null;
            return;
          }
          setSelectedZoneId(null);
          setSelectedVertex(null);
          selectedZoneIdRef.current = null;
          selectedVertexRef.current = null;
          return;
        }

        // Draw mode: add points / close polygon
        const draft = draftRef.current;
        const snap = snapAt(raw);
        if (snap?.kind === "close" && draft.length >= 3) {
          closeDraft(draft);
          return;
        }
        const point = snap?.point ?? raw;
        setDraftPoints((prev) => [...prev, point]);
        setSelectedZoneId(null);
        setSelectedVertex(null);
        selectedZoneIdRef.current = null;
        selectedVertexRef.current = null;
      });

      ro = new ResizeObserver(() => {
        map?.resize();
        syncScreen();
      });
      ro.observe(el);
      requestAnimationFrame(() => {
        map?.resize();
        syncScreen();
      });

      return () => {
        cancelled = true;
        window.clearInterval(pollId);
        window.clearTimeout(forceReadyId);
        ro?.disconnect();
        map?.off("move", onMove);
        map?.off("zoom", onMove);
        map?.off("resize", onMove);
        addressMarkerRef.current?.remove();
        addressMarkerRef.current = null;
        map?.remove();
        if (mapRef.current === map) mapRef.current = null;
      };
    } catch (err) {
      setMapError(
        err instanceof Error ? err.message : "Mapbox konnte nicht starten.",
      );
      return () => {
        cancelled = true;
        window.clearInterval(pollId);
        window.clearTimeout(forceReadyId);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey]);

  // Canvas mode: hide address pin (map stays underneath for geo + pan/zoom)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    addressMarkerRef.current?.remove();
    addressMarkerRef.current = null;
    if (!isCanvas) {
      addressMarkerRef.current = new mapboxgl.Marker({ color: "#00FFCF" })
        .setLngLat([lng, lat])
        .addTo(map);
    }
  }, [isCanvas, ready, lng, lat]);

  useEffect(() => {
    syncScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftPoints, zones, fixtures, mapEpoch, ready]);

  function undoPoint() {
    setDraftPoints((prev) => prev.slice(0, -1));
    snapKindRef.current = null;
    setSnapClose(false);
    setSnapKind(null);
    setSnapGuide(null);
  }

  function cancelDraft() {
    cancelInteraction();
  }

  /** Full reset of drawing + Technik + Sofort plan (after confirm). */
  function resetAllMarking() {
    cancelInteraction();
    setZones([]);
    setFixtures([]);
    setSofortPlan(null);
    sofortPlanRef.current = null;
    setSelectedZoneId(null);
    setSelectedVertex(null);
    selectedZoneIdRef.current = null;
    selectedVertexRef.current = null;
    setSelectedHeadId(null);
    selectedHeadIdRef.current = null;
    setSelectedFixtureId(null);
    setTechnikWarning(null);
    setPlanChoiceOpen(false);
    setResetConfirmOpen(false);
    plotStageRef.current = "zones";
    setPlotStage("zones");
  }

  function closePolygon() {
    closeDraft(draftPoints);
  }

  function deleteZone(id: string) {
    setZones((prev) => prev.filter((z) => z.id !== id));
    if (selectedZoneId === id) {
      setSelectedZoneId(null);
      setSelectedVertex(null);
      selectedZoneIdRef.current = null;
      selectedVertexRef.current = null;
    }
  }

  function deleteSelectedVertex() {
    const zoneId = selectedZoneIdRef.current;
    const vi = selectedVertexRef.current;
    if (zoneId == null || vi == null) return;
    setZones((prev) => {
      const z = prev.find((x) => x.id === zoneId);
      if (!z || z.coordinates.length <= 3) return prev;
      const nextCoords = z.coordinates.filter((_, i) => i !== vi);
      return prev.map((x) =>
        x.id === zoneId ? { ...x, coordinates: nextCoords } : x,
      );
    });
    setSelectedVertex(null);
    selectedVertexRef.current = null;
  }

  function focusZone(id: string) {
    disarmZoneTool();
    setSelectedZoneId(id);
    setSelectedVertex(null);
    selectedZoneIdRef.current = id;
    selectedVertexRef.current = null;
    const z = zonesRef.current.find((x) => x.id === id);
    const map = mapRef.current;
    if (!z || !map || z.coordinates.length === 0) return;
    const c = polygonCentroid(z.coordinates);
    map.easeTo({ center: [c.lng, c.lat], duration: 450 });
  }

  function removeFixture(id: string) {
    setFixtures((prev) => prev.filter((f) => f.id !== id));
  }

  function undoLastFixture() {
    if (!onTechnik) return;
    setFixtures((prev) => {
      if (prev.length === 0) return prev;
      const kind = armedKind;
      if (kind) {
        const idx = [...prev]
          .map((f, i) => ({ f, i }))
          .reverse()
          .find((x) => x.f.kind === kind)?.i;
        if (idx == null) return prev;
        return prev.filter((_, i) => i !== idx);
      }
      return prev.slice(0, -1);
    });
  }

  function confirmWasserquelle(result: WasserquelleResult) {
    const pending = pendingWasserquelle;
    if (!pending) return;
    setFixtures((prev) => [
      ...prev,
      {
        id: pending.id,
        kind: "wasserquelle",
        position: pending.position,
        wasserquelleType: result.type,
        wasserquelleMenge: result.menge,
        wassermengeM3h: result.wassermengeM3h,
        zisternenpumpe: result.zisternenpumpe,
        brunnenpumpe: result.brunnenpumpe,
      },
    ]);
    setPendingWasserquelle(null);
  }

  function cancelWasserquelleDialog() {
    setPendingWasserquelle(null);
  }

  function openPlanChoice() {
    if (!planDone) return;
    disarmTool();
    setPlanChoiceOpen(true);
  }

  function runSofortBerechnung(brand: SprinklerBrand = DEFAULT_BRAND) {
    const plan = computeSofortPlan(zonesRef.current, fixturesRef.current, {
      brand,
      algorithmVersion: CLIENT_ALGORITHM,
    });
    setSofortPlan(plan);
    sofortPlanRef.current = plan;
    setSelectedHeadId(null);
    selectedHeadIdRef.current = null;
    setSelectedPipe(null);
    setSelectedFixtureId(null);
    plotStageRef.current = "ergebnis";
    setPlotStage("ergebnis");
  }

  function finishSofortCalc() {
    runSofortBerechnung(pendingBrandRef.current);
    setCalcMode(null);
  }

  function changeSofortBrand(brand: SprinklerBrand) {
    if (calcMode) return;
    if (brand === (sofortPlan?.brand ?? DEFAULT_BRAND)) return;
    pendingBrandRef.current = brand;
    setPendingBrand(brand);
    setCalcMode("brand");
  }

  function handlePlanChoice(choice: PlanChoice) {
    setPlanChoiceOpen(false);
    if (choice === "auto") {
      pendingBrandRef.current = DEFAULT_BRAND;
      setPendingBrand(DEFAULT_BRAND);
      setCalcMode("full");
      return;
    }
    // Fachplanung request form follows later
    setTechnikWarning(
      "Fachplanung: Anfrage-Formular folgt in Kürze. Ihre Flächen und Technik-Punkte bleiben gespeichert.",
    );
  }

  function handleHeadMove(id: string, pos: LngLat) {
    setSofortPlan((prev) => {
      if (!prev) return prev;
      const brand = prev.brand ?? DEFAULT_BRAND;
      return {
        ...prev,
        heads: prev.heads.map((h) =>
          h.id === id
            ? clampHeadGeometry(h, brand, { position: pos })
            : h,
        ),
      };
    });
  }

  function handleHeadGeometry(id: string, patch: {
    radiusM?: number;
    arcDeg?: number;
    rotationDeg?: number;
    position?: LngLat;
  }) {
    setSofortPlan((prev) => {
      if (!prev) return prev;
      const brand = prev.brand ?? DEFAULT_BRAND;
      return {
        ...prev,
        heads: prev.heads.map((h) =>
          h.id === id ? clampHeadGeometry(h, brand, patch) : h,
        ),
      };
    });
  }

  function commitHeadEdit() {
    const plan = sofortPlanRef.current;
    if (!plan) return;
    const next = recomputeAfterEdit(plan, fixturesRef.current, zonesRef.current);
    setSofortPlan(next);
    sofortPlanRef.current = next;
  }

  function deleteSelectedHead() {
    const plan = sofortPlanRef.current;
    const headId = selectedHeadIdRef.current;
    if (!plan || !headId) return;
    const stripped = {
      ...plan,
      heads: plan.heads.filter((h) => h.id !== headId),
    };
    const next = recomputeAfterEdit(
      stripped,
      fixturesRef.current,
      zonesRef.current,
    );
    setSofortPlan(next);
    sofortPlanRef.current = next;
    setSelectedHeadId(null);
    selectedHeadIdRef.current = null;
    setSelectedFixtureId(null);
  }

  function toggleTechnikTool(kind: FixtureKind) {
    if (armedKindRef.current === kind) {
      disarmTool();
      return;
    }
    armedKindRef.current = kind;
    setArmedKind(kind);
  }

  const pendingWasserquelleScreen = (() => {
    if (!pendingWasserquelle || !mapRef.current) return null;
    const { x, y } = mapRef.current.project([
      pendingWasserquelle.position.lng,
      pendingWasserquelle.position.lat,
    ]);
    return { x, y };
  })();

  function goNextStage() {
    if (drawing) {
      if (zones.length === 0 || draftPoints.length > 0) return;
    } else {
      return; // last stage — Fertig only
    }
    const next = PLOT_STAGE_ORDER[stageIndex + 1];
    if (!next) return;

    cancelInteraction();
    plotStageRef.current = next;
    setPlotStage(next);
  }

  function goPrevStage() {
    if (drawing) return;
    const prev = PLOT_STAGE_ORDER[stageIndex - 1];
    if (!prev) return;
    cancelInteraction();
    plotStageRef.current = prev;
    setPlotStage(prev);
  }

  const canGoNext = drawing && zones.length > 0 && draftPoints.length === 0;
  const isLastStage = onTechnik;
  const hasQuelle = fixtures.some((f) => f.kind === "wasserquelle");
  const hasSmart = fixtures.some((f) => f.kind === "smarthome");
  const hasVerteiler = fixtures.some((f) => f.kind === "wasserverteiler");
  const planDone = onTechnik && hasQuelle && hasSmart && hasVerteiler;

  const canResetMarking =
    zones.length > 0 ||
    fixtures.length > 0 ||
    draftPoints.length > 0 ||
    Boolean(sofortPlan);

  const showLoading = !ready && !mapError && draftPoints.length === 0;
  const canClose = Boolean(armedZone) && draftPoints.length >= 3;
  const isDrawing = Boolean(armedZone);

  const rubberTarget =
    isDrawing && canClose && snapClose
      ? screenDraft[0]
      : isDrawing && screenCursor && screenDraft.length >= 1
        ? screenCursor
        : null;

  const draftPolyline = isDrawing
    ? screenDraft.map((p) => `${p.x},${p.y}`).join(" ")
    : "";
  const rubberPolyline =
    isDrawing && screenDraft.length >= 1 && rubberTarget
      ? `${screenDraft[screenDraft.length - 1].x},${screenDraft[screenDraft.length - 1].y} ${rubberTarget.x},${rubberTarget.y}`
      : "";
  const closeHintPolyline =
    isDrawing && canClose && !snapClose && screenDraft.length >= 1
      ? `${screenDraft[screenDraft.length - 1].x},${screenDraft[screenDraft.length - 1].y} ${screenDraft[0].x},${screenDraft[0].y}`
      : "";
  const fillPoints =
    isDrawing && canClose && rubberTarget && !snapClose
      ? [...screenDraft, rubberTarget]
      : isDrawing && canClose
        ? screenDraft
        : [];
  const fillPath =
    fillPoints.length >= 3
      ? `${fillPoints.map((p) => `${p.x},${p.y}`).join(" ")} ${fillPoints[0].x},${fillPoints[0].y}`
      : "";

  const edgeLabels: { x: number; y: number; text: string }[] = [];
  if (isDrawing) {
    const labelCount = Math.min(screenDraft.length, draftPoints.length);
    for (let i = 0; i < labelCount - 1; i++) {
      const a = screenDraft[i];
      const b = screenDraft[i + 1];
      const geoA = draftPoints[i];
      const geoB = draftPoints[i + 1];
      if (!a || !b || !geoA || !geoB) continue;
      edgeLabels.push({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        text: formatMeters(distMeters(geoA, geoB)),
      });
    }

    if (
      labelCount >= 1 &&
      rubberTarget &&
      draftPoints.length >= 1 &&
      screenDraft[labelCount - 1]
    ) {
      const last = draftPoints[draftPoints.length - 1];
      const targetGeo =
        snapClose && canClose ? draftPoints[0] : (cursor ?? draftPoints[0]);
      if (last && targetGeo) {
        const d = distMeters(last, targetGeo);
        if (d > 0.5) {
          edgeLabels.push({
            x: (screenDraft[labelCount - 1].x + rubberTarget.x) / 2,
            y: (screenDraft[labelCount - 1].y + rubberTarget.y) / 2,
            text: formatMeters(d),
          });
        }
      }
    }
  }

  const zoneLabelPositions = screenZones.map((ring, i) => {
    if (ring.length < 3) return null;
    const z = zoneSummaries[i];
    if (!z) return null;
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    return { id: z.id, x: cx, y: cy, label: z.label, area: z.area, color: z.color };
  });

  const hint = (() => {
    if (onErgebnis) {
      if (selectedHeadId) {
        return "Regner gewählt — ziehen zum Verschieben · Entf oder „Regner löschen“ entfernt ihn. Leitungen passen sich an.";
      }
      return "Ihr Plan: Regner antippen (Details/verschieben/löschen) · „Neu berechnen“ setzt alles zurück · „Zurück“ ändert Flächen/Technik.";
    }
    if (!drawing && onTechnik) {
      if (planChoiceOpen) {
        return "Planung wählen oder Esc / tippen außerhalb = zurück zur Karte.";
      }
      if (planDone && !armedKind) {
        return "Technik komplett. „Fertig“ tippen – Sofort-Berechnung oder Fachplanung. Esc = Abbrechen.";
      }
      if (!planDone) {
        const missing = [
          !hasQuelle ? "Quelle" : null,
          !hasSmart ? "Smart" : null,
          !hasVerteiler ? "Verteiler" : null,
        ].filter(Boolean);
        return `Noch setzen: ${missing.join(" · ")} (je mind. 1×). Dann „Fertig“. Esc = Abbrechen.`;
      }
      if (armedKind === "wasserverteiler") {
        return `Wasserverteiler: max. ${VERTEILER_MAX_FROM_SMART_M} m zur Smarthome-Steuerung (Strom & Steuerleitung). Position tippen · Esc = Cursor.`;
      }
      if (!armedKind) {
        return "Technik: links Quelle / Smart / Verteiler wählen, dann auf den Plan tippen. Esc = Abbrechen.";
      }
      return `${armedMeta?.label ?? "Tool"} aktiv — Position tippen · nochmals in der Leiste oder Esc = Cursor.`;
    }
    if (editingZone) {
      if (selectedVertex != null) {
        return `Punkt ${selectedVertex + 1} gewählt — ziehen zum Verschieben · „Punkt löschen“ oder Entf. Esc = Cursor.`;
      }
      return `${activeZoneLabel} gewählt — Punkte ziehen, Punkt tippen + Entf löschen, oder Fläche rechts löschen. Esc = Cursor.`;
    }
    if (!armedZone) {
      return zones.length === 0
        ? "Links Flächentyp wählen zum Zeichnen (nochmals tippen = Cursor). Esc = Abbrechen."
        : "Fläche antippen zum Bearbeiten — oder links Typ wählen zum Zeichnen. Esc = Cursor.";
    }
    if (justSaved) {
      return `Fläche gespeichert. Nächste Fläche zeichnen (${activeZoneLabel}) oder Tool nochmals tippen = Cursor · „Weiter“.`;
    }
    if (draftPoints.length === 0) {
      return `Zeichnen: ${activeZoneLabel} · Ecken setzen (Magnet an Ecken/parallel). Tool nochmals = Cursor · Esc = Abbrechen.`;
    }
    if (draftPoints.length < 3) {
      return `${activeZoneLabel}: ${draftPoints.length} Punkte · noch ${3 - draftPoints.length}. Umfang: ${formatMeters(draftStats.peri)}. Esc = Abbrechen.`;
    }
    if (snapClose) {
      return `Magnet schließen · ${formatMeters(draftStats.peri)} · ${formatAreaM2(draftStats.area)}. Esc = Abbrechen.`;
    }
    if (snapKind === "vertex") {
      return `Magnet an Ecke · ${formatMeters(draftStats.peri)} · ca. ${formatAreaM2(draftStats.area)}. Esc = Abbrechen.`;
    }
    if (snapKind === "parallel") {
      return `Parallel zu vorhandener Kante · ${formatMeters(draftStats.peri)}. Esc = Abbrechen.`;
    }
    return `Zur Ecke / parallel magnetisch oder „Speichern“ · ${formatMeters(draftStats.peri)} · ca. ${formatAreaM2(draftStats.area)}. Esc = Abbrechen.`;
  })();

  const labelChip = isCanvas
    ? "bg-white text-forest ring-1 ring-forest/15 shadow-soft"
    : "bg-forest/90 text-white ring-1 ring-white/20 shadow-soft";

  type VerteilerLink = {
    key: string;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    mx: number;
    my: number;
    meters: number;
    ok: boolean;
  };

  const verteilerLinks: VerteilerLink[] = (() => {
    if (!onTechnik || !mapRef.current) return [];
    const map = mapRef.current;
    const links: VerteilerLink[] = [];

    const pushLink = (
      key: string,
      from: LngLat,
      to: LngLat,
      meters: number,
    ) => {
      const a = map.project([from.lng, from.lat]);
      const b = map.project([to.lng, to.lat]);
      links.push({
        key,
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        meters,
        ok: meters <= VERTEILER_MAX_FROM_SMART_M,
      });
    };

    for (const f of fixtures) {
      if (f.kind !== "wasserverteiler") continue;
      const near = nearestSmarthome(f.position, fixtures);
      if (!near) continue;
      pushLink(f.id, near.smart.position, f.position, near.meters);
    }

    if (
      armedKind === "wasserverteiler" &&
      fixtureCursor &&
      !pendingWasserquelle
    ) {
      const pos = { lng: fixtureCursor.lng, lat: fixtureCursor.lat };
      const near = nearestSmarthome(pos, fixtures);
      if (near) {
        pushLink(
          "preview",
          near.smart.position,
          pos,
          near.meters,
        );
      }
    }

    return links;
  })();

  const verteilerPreviewOk =
    armedKind === "wasserverteiler" && fixtureCursor
      ? (() => {
          const near = nearestSmarthome(
            { lng: fixtureCursor.lng, lat: fixtureCursor.lat },
            fixtures,
          );
          if (!near) return null;
          return near.meters <= VERTEILER_MAX_FROM_SMART_M;
        })()
      : null;

  return (
    <div
      className={`relative flex h-[100svh] w-full flex-col overflow-hidden overscroll-none ${
        isCanvas ? "bg-[#f7faf8]" : "bg-[#0b2414]"
      }`}
      style={
        isCanvas
          ? {
              // Soft blueprint: light wash + sparse grid only (no grain)
              backgroundImage: `
                linear-gradient(rgba(11, 36, 20, 0.055) 1px, transparent 1px),
                linear-gradient(90deg, rgba(11, 36, 20, 0.055) 1px, transparent 1px)
              `,
              backgroundSize: "96px 96px",
            }
          : undefined
      }
    >
      <div
        ref={containerRef}
        className={`absolute inset-0 z-0 h-full w-full ${
          isCanvas ? "rw-map-under-canvas" : ""
        }`}
        style={{ minHeight: "100svh" }}
      />

      <svg
        className="pointer-events-none absolute inset-0 z-[5] h-full w-full overflow-visible"
        aria-hidden
      >
        {isCanvas ? (
          <defs>
            <pattern
              id="rw-hatch"
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="8"
                stroke="rgba(11,36,20,0.14)"
                strokeWidth="1.25"
              />
            </pattern>
          </defs>
        ) : null}

        {screenZones.map((ring, zi) => {
          if (ring.length < 3) return null;
          const z = zones[zi];
          const color =
            ZONE_TYPES.find((t) => t.id === z?.type)?.color ?? "#00FFCF";
          const selected = z?.id === selectedZoneId;
          const pts = `${ring.map((p) => `${p.x},${p.y}`).join(" ")} ${ring[0].x},${ring[0].y}`;
          // Ergebnis: lawn almost clear so spray arcs read; Plan = blueprint hatch
          const fillOpacity = onErgebnis
            ? isCanvas
              ? z?.type === "rasen"
                ? 0.08
                : selected
                  ? 0.28
                  : 0.18
              : z?.type === "rasen"
                ? selected
                  ? 0.14
                  : 0.1
                : selected
                  ? 0.4
                  : 0.28
            : isCanvas
              ? selected
                ? 0.5
                : 0.38
              : selected
                ? 0.45
                : 0.32;
          const canvasFill =
            isCanvas && z?.type === "rasen"
              ? "#0a9f86"
              : isCanvas && z?.type === "gebaeude"
                ? "#c44a38"
                : color;
          return (
            <g key={z?.id ?? zi}>
              <polygon
                points={pts}
                fill={isCanvas ? canvasFill : color}
                fillOpacity={fillOpacity}
                stroke={isCanvas ? "#0b2414" : color}
                strokeWidth={selected ? 3.5 : isCanvas ? 2.5 : 2.5}
                strokeOpacity={isCanvas ? 0.92 : 1}
              />
              {isCanvas ? (
                <polygon points={pts} fill="url(#rw-hatch)" stroke="none" />
              ) : null}
            </g>
          );
        })}

        {fillPath ? (
          <polygon
            points={fillPath}
            fill={zoneColor}
            fillOpacity={snapClose ? 0.4 : 0.28}
            stroke="none"
          />
        ) : null}

        {closeHintPolyline ? (
          <polyline
            points={closeHintPolyline}
            fill="none"
            stroke={zoneColor}
            strokeWidth={2}
            strokeOpacity={0.45}
            strokeDasharray="6 6"
          />
        ) : null}

        {snapGuide && isDrawing ? (
          <line
            x1={snapGuide.ax}
            y1={snapGuide.ay}
            x2={snapGuide.bx}
            y2={snapGuide.by}
            stroke="#00FFCF"
            strokeWidth={1.5}
            strokeOpacity={0.55}
            strokeDasharray="4 5"
          />
        ) : null}

        {isDrawing && zones.length > 0
          ? screenZones.flatMap((ring, zi) =>
              ring.map((p, pi) => (
                <circle
                  key={`mag-${zi}-${pi}`}
                  cx={p.x}
                  cy={p.y}
                  r={
                    snapKind === "vertex" &&
                    screenCursor &&
                    Math.hypot(screenCursor.x - p.x, screenCursor.y - p.y) < 2
                      ? 8
                      : 4
                  }
                  fill={
                    snapKind === "vertex" &&
                    screenCursor &&
                    Math.hypot(screenCursor.x - p.x, screenCursor.y - p.y) < 2
                      ? "#00FFCF"
                      : "rgba(255,255,255,0.55)"
                  }
                  stroke="#0b2414"
                  strokeWidth={1.25}
                  strokeOpacity={0.35}
                />
              )),
            )
          : null}

        {editingZone
          ? screenZones.map((ring, zi) => {
              const z = zones[zi];
              if (!z || z.id !== selectedZoneId) return null;
              return ring.map((p, pi) => {
                const picked = selectedVertex === pi;
                return (
                  <g key={`edit-${z.id}-${pi}`}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={picked ? 14 : 10}
                      fill="none"
                      stroke={picked ? "#00FFCF" : "#fff"}
                      strokeOpacity={picked ? 0.9 : 0.45}
                      strokeWidth={2}
                    />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={picked ? 8 : 6.5}
                      fill={picked ? "#00FFCF" : "#fff"}
                      stroke="#0b2414"
                      strokeWidth={2}
                    />
                  </g>
                );
              });
            })
          : null}

        {isDrawing ? (
          <polyline
            points={draftPolyline}
            fill="none"
            stroke={isCanvas ? "#0b2414" : zoneColor}
            strokeWidth={3.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

        {rubberPolyline ? (
          <polyline
            points={rubberPolyline}
            fill="none"
            stroke={zoneColor}
            strokeWidth={snapClose ? 3.5 : 2.5}
            strokeOpacity={0.95}
            strokeDasharray={snapClose ? undefined : "7 5"}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

        {isDrawing
          ? screenDraft.map((p, i) => {
              const isFirst = i === 0;
              const snap = isFirst && snapClose && canClose;
              const r = snap ? 11 : isFirst ? 9 : 6.5;
              return (
                <g key={`v-${i}`}>
                  {isFirst ? (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r + 5}
                      fill="none"
                      stroke={zoneColor}
                      strokeOpacity={snap ? 0.55 : 0.3}
                      strokeWidth={2}
                    />
                  ) : null}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    fill={zoneColor}
                    stroke={isCanvas ? "#0b2414" : "#fff"}
                    strokeWidth={2.5}
                  />
                </g>
              );
            })
          : null}

        {isDrawing &&
        screenCursor &&
        (snapKind === "vertex" || snapKind === "parallel") ? (
          <circle
            cx={screenCursor.x}
            cy={screenCursor.y}
            r={snapKind === "vertex" ? 10 : 7}
            fill="none"
            stroke="#00FFCF"
            strokeWidth={2.5}
            strokeOpacity={0.95}
          />
        ) : null}
      </svg>

      <div className="pointer-events-none absolute inset-0 z-[6]">
        {edgeLabels.map((l, i) => (
          <span
            key={`lbl-${i}`}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2.5 py-1 text-xs font-semibold ${labelChip}`}
            style={{ left: l.x, top: l.y }}
          >
            {l.text}
          </span>
        ))}

        {zoneLabelPositions.map((l) => {
          if (!l) return null;
          return (
            <span
              key={`zl-${l.id}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-left text-[10px] font-semibold leading-tight ${labelChip}`}
              style={{ left: l.x, top: l.y }}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                {l.label}
              </span>
              <span
                className={`block ${isCanvas ? "text-forest/70" : "text-white/70"}`}
              >
                {formatAreaM2(l.area)}
              </span>
            </span>
          );
        })}

        {canClose && snapClose && screenDraft[0] ? (
          <span
            className="absolute -translate-x-1/2 -translate-y-[160%] rounded-full bg-lime px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-forest shadow-soft"
            style={{ left: screenDraft[0].x, top: screenDraft[0].y }}
          >
            Schließen
          </span>
        ) : null}
      </div>

      {/* Verteiler↔Smart links — above zones, under fixture icons */}
      {onTechnik && verteilerLinks.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 z-[6] h-full w-full overflow-visible"
          aria-hidden
        >
          {verteilerLinks.map((link) => {
            const color = link.ok ? "#00FFCF" : "#FF5C45";
            const label = formatMeters(link.meters);
            const chipW = Math.max(52, label.length * 7.5 + 16);
            return (
              <g key={`vlink-${link.key}`}>
                <line
                  x1={link.ax}
                  y1={link.ay}
                  x2={link.bx}
                  y2={link.by}
                  stroke={color}
                  strokeWidth={link.key === "preview" ? 2.5 : 2}
                  strokeOpacity={link.key === "preview" ? 0.55 : 0.38}
                  strokeDasharray={link.ok ? "7 8" : "4 5"}
                  strokeLinecap="round"
                />
                <rect
                  x={link.mx - chipW / 2}
                  y={link.my - 11}
                  width={chipW}
                  height={22}
                  rx={11}
                  ry={11}
                  fill={
                    link.ok
                      ? "rgba(11, 36, 20, 0.92)"
                      : "rgba(72, 18, 14, 0.92)"
                  }
                  stroke={color}
                  strokeOpacity={0.45}
                  strokeWidth={1}
                />
                <text
                  x={link.mx}
                  y={link.my + 4}
                  textAnchor="middle"
                  fill={link.ok ? "#00FFCF" : "#FFB4A8"}
                  fontSize={11}
                  fontWeight={700}
                  fontFamily="inherit"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}

      {onErgebnis && sofortPlan ? (
        <SofortOverlay
          map={mapRef.current}
          plan={sofortPlan}
          lawns={zones.filter((z) => z.type === "rasen")}
          renderTick={renderTick}
          selectedHeadId={selectedHeadId}
          onSelectHead={(id) => {
            setSelectedFixtureId(null);
            setSelectedPipe(null);
            setSelectedHeadId(id);
            selectedHeadIdRef.current = id;
          }}
          selectedPipe={selectedPipe}
          onSelectPipe={(sel) => {
            setSelectedFixtureId(null);
            selectedHeadIdRef.current = null;
            setSelectedHeadId(null);
            setSelectedPipe(sel);
          }}
          onHeadMove={handleHeadMove}
          onHeadGeometry={handleHeadGeometry}
          onEditCommit={commitHeadEdit}
          isCanvas={isCanvas}
          showOverview={isCanvas ? planLayers.overview : true}
          showPipes={isCanvas ? planLayers.pipes : true}
          showHeads={isCanvas ? planLayers.heads : true}
        />
      ) : null}

      {fixtures.map((f, i) => {
        const pt = screenFixtures[i];
        if (!pt) return null;
        const active = f.kind === armedKind;
        const selected = f.id === selectedFixtureId;
        const subtitle =
          f.kind === "wasserquelle" && f.wasserquelleType
            ? (WASSERQUELLE_TYPES.find((t) => t.id === f.wasserquelleType)
                ?.label ?? undefined)
            : undefined;
        const bomLine =
          (f.kind === "smarthome"
            ? sofortPlan?.bom.find((l) => l.key === "controller")
            : null) ??
          sofortPlan?.bom.find(
            (l) => l.linkFixtureKind === f.kind && l.imageUrl,
          );
        return (
          <FixtureMarker
            key={f.id}
            kind={f.kind}
            x={pt.x}
            y={pt.y}
            active={active || selected}
            subtitle={subtitle}
            compact={onErgebnis}
            selected={onErgebnis && selected}
            onSelect={
              onErgebnis
                ? () => {
                    setSelectedHeadId(null);
                    selectedHeadIdRef.current = null;
                    setSelectedFixtureId((cur) =>
                      cur === f.id ? null : f.id,
                    );
                  }
                : undefined
            }
            cardImageUrl={bomLine?.imageUrl}
            cardTitle={bomLine?.label}
            cardNote={
              f.kind === "smarthome"
                ? "Elektrik / Steuergerät"
                : f.kind === "wasserverteiler"
                  ? "Ventilkasten / Verteiler"
                  : "Wasseranschluss"
            }
            onCloseCard={
              selected
                ? () => setSelectedFixtureId(null)
                : undefined
            }
            onRemove={onTechnik ? () => removeFixture(f.id) : undefined}
          />
        );
      })}

      {pendingWasserquelleScreen ? (
        <FixtureMarker
          kind="wasserquelle"
          x={pendingWasserquelleScreen.x}
          y={pendingWasserquelleScreen.y}
          active
          subtitle="…"
        />
      ) : null}

      {onTechnik && armedKind && fixtureCursor && !pendingWasserquelle ? (
        <FixtureCursor
          kind={armedKind}
          x={fixtureCursor.x}
          y={fixtureCursor.y}
          rangeOk={
            armedKind === "wasserverteiler" ? verteilerPreviewOk : undefined
          }
        />
      ) : null}

      <WasserquelleDialog
        open={Boolean(pendingWasserquelle)}
        onConfirm={confirmWasserquelle}
        onCancel={cancelWasserquelleDialog}
      />

      <PlanChoiceDialog
        open={planChoiceOpen}
        onChoose={handlePlanChoice}
        onCancel={() => setPlanChoiceOpen(false)}
      />

      {calcMode === "full" ? (
        <SofortCalcLoader mode="full" onFinished={finishSofortCalc} />
      ) : null}

      {resetConfirmOpen ? (
        <div
          className="absolute inset-0 z-[40] flex items-center justify-center bg-forest/45 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setResetConfirmOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-marking-title"
            className="w-full max-w-sm rounded-3xl border border-white/15 bg-white p-5 shadow-soft"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="reset-marking-title"
                  className="text-base font-bold text-forest"
                >
                  Alles zurücksetzen?
                </h2>
                <p className="mt-1.5 text-sm leading-snug text-forest/60">
                  Flächen, Technik-Punkte und Sofort-Berechnung werden gelöscht.
                  Das lässt sich nicht rückgängig machen.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                className="rounded-full p-1.5 text-forest/40 hover:bg-mint/60 hover:text-forest"
                aria-label="Abbrechen"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={resetAllMarking}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-forest px-4 py-3 text-sm font-semibold text-lime"
              >
                <Trash2 size={16} /> Ja, alles löschen
              </button>
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                className="inline-flex flex-1 items-center justify-center rounded-full border border-forest/15 bg-mint/40 px-4 py-3 text-sm font-semibold text-forest"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mapError ? (
        <div className="absolute inset-x-4 top-28 z-30 mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-700 shadow-soft">
          <p className="font-semibold">Karte lädt nicht</p>
          <p className="mt-1 text-red-600/90">{mapError}</p>
        </div>
      ) : null}

      {showLoading ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <p className="rounded-full bg-forest/80 px-4 py-2 text-sm text-white/80">
            Karte wird geladen…
          </p>
        </div>
      ) : null}

      {technikWarning ? (
        <div className="pointer-events-none absolute inset-x-4 top-24 z-30 mx-auto max-w-md sm:top-28">
          <div
            className="pointer-events-auto overflow-hidden rounded-3xl border border-white/15 bg-forest/95 px-4 py-3.5 text-sm shadow-soft backdrop-blur-md"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-lime">
                !
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-lime">
                  Verteiler – max. {VERTEILER_MAX_FROM_SMART_M} m
                </p>
                <p className="mt-1 leading-snug text-white/75">
                  {technikWarning}
                </p>
                <button
                  type="button"
                  onClick={() => setTechnikWarning(null)}
                  className="mt-2.5 text-xs font-semibold text-lime hover:underline"
                >
                  Schließen
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Top chrome — address + view mode */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-4 sm:p-5">
        <div className="pointer-events-auto mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-3xl border border-white/15 bg-forest/92 px-4 py-3 shadow-soft backdrop-blur-md sm:gap-4 sm:px-5 sm:py-3.5">
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 text-sm font-semibold text-lime hover:underline"
          >
            ← Adresse
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-sm text-white/85 sm:text-base">
            {place.placeName}
          </p>
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 p-1">
            <button
              type="button"
              onClick={() => setViewMode("satellite")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                viewMode === "satellite"
                  ? "bg-lime text-forest"
                  : "text-white/70 hover:bg-white/10"
              }`}
              title="Satellitenkarte"
            >
              <Satellite size={15} /> Satellit
            </button>
            <button
              type="button"
              onClick={() => setViewMode("canvas")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                viewMode === "canvas"
                  ? "bg-lime text-forest"
                  : "text-white/70 hover:bg-white/10"
              }`}
              title="Zeichenfläche mit Raster"
            >
              <DraftingCompass size={15} /> Plan
            </button>
          </div>
        </div>
      </div>

      {/* Ergebnis: Ebenen only in Plan view */}
      {onErgebnis && sofortPlan && isCanvas ? (
        <div className="pointer-events-none absolute left-3 top-24 z-20 sm:left-5 sm:top-28">
          <PlanEditMenu mode={planLayerMode} onMode={setPlanLayerMode} />
        </div>
      ) : null}

      {/* Ergebnis: result panel on the right */}
      {onErgebnis && sofortPlan ? (
        <div className="pointer-events-none absolute right-3 top-24 z-20 w-[min(100%-1.5rem,21rem)] sm:right-5 sm:top-28">
          <div className="pointer-events-auto relative">
            <SofortPanel
              plan={sofortPlan}
              fixtures={fixtures}
              selectedHeadId={selectedHeadId}
              selectedFixtureId={selectedFixtureId}
              isCanvas={isCanvas}
              serverProjectId={serverProjectId}
              recalculating={calcMode === "brand"}
              onChangeBrand={changeSofortBrand}
            onSelectHead={(id) => {
              setSelectedFixtureId(null);
              setSelectedPipe(null);
              selectedHeadIdRef.current = id;
              setSelectedHeadId(id);
            }}
            onSelectFixture={(id) => {
              selectedHeadIdRef.current = null;
              setSelectedHeadId(null);
              setSelectedPipe(null);
              setSelectedFixtureId(id);
            }}
            onSubmitEmail={async ({ name, email, phone, privacyAccepted }) => {
              const leadRes = await fetch("/api/lead", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name,
                  email,
                  phone: phone || "",
                  privacyAccepted,
                  placeName: place.placeName,
                  brand: sofortPlan?.brand ?? DEFAULT_BRAND,
                  lawnAreaM2: sofortPlan?.lawnAreaM2,
                  heads: sofortPlan?.heads.length,
                  totalEur: sofortPlan?.totalKnownEur ?? null,
                }),
              });
              const leadBody = (await leadRes.json().catch(() => null)) as {
                error?: string;
              } | null;
              const leadOk = leadRes.ok;
              const local =
                loadProject(place.id) ??
                ({
                  version: 1 as const,
                  updatedAt: new Date().toISOString(),
                  place,
                  zones,
                  fixtures,
                  sofortPlan,
                  plotStage: "ergebnis" as const,
                } satisfies SavedPlotProject);
              const payload: SavedPlotProject = {
                ...local,
                place,
                zones,
                fixtures,
                sofortPlan,
                plotStage: "ergebnis",
              };
              if (!payload.sofortPlan) {
                throw new Error("Kein Sofort-Plan vorhanden");
              }
              let crmOk = false;
              try {
                const res = await submitProject({
                  payload,
                  customerName: name,
                  customerEmail: email,
                  projectId: serverProjectId ?? undefined,
                });
                setServerProjectId(res.id);
                crmOk = true;
              } catch {
                /* CRM project save is optional if Telegram / public lead already landed */
              }
              if (!leadOk && !crmOk) {
                throw new Error(leadBody?.error || "Senden fehlgeschlagen");
              }
            }}
            onDownloadPdf={async () => {
              const local =
                loadProject(place.id) ??
                ({
                  version: 1 as const,
                  updatedAt: new Date().toISOString(),
                  place,
                  zones,
                  fixtures,
                  sofortPlan,
                  plotStage: "ergebnis" as const,
                } satisfies SavedPlotProject);
              const payload: SavedPlotProject = {
                ...local,
                place,
                zones,
                fixtures,
                sofortPlan,
                plotStage: "ergebnis",
              };
              if (!payload.sofortPlan) {
                throw new Error("Kein Sofort-Plan vorhanden");
              }
              const { projectId } = await downloadProjectPdf({
                payload,
                projectId: serverProjectId ?? undefined,
              });
              if (projectId) setServerProjectId(projectId);
            }}
          />
            {calcMode === "brand" ? (
              <SofortCalcLoader
                mode="brand"
                brandLabel={pendingBrand === "rainbird" ? "Rain Bird" : "Hunter"}
                onFinished={finishSofortCalc}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Left tool rail — icon + label, count as badge on icon */}
      {onErgebnis ? null : (
      <div className="pointer-events-none absolute left-0 top-1/2 z-20 -translate-y-1/2 p-3 sm:p-4">
        <div className="pointer-events-auto flex h-fit w-[9.25rem] flex-col gap-1 rounded-3xl border border-white/15 bg-forest/92 p-1.5 shadow-soft backdrop-blur-md sm:w-[10rem] sm:p-2">
          {drawing
            ? ZONE_TYPES.map((z) => {
                const armed = armedZone === z.id;
                const typeSelected =
                  !armedZone && selectedZone?.type === z.id;
                const count = zones.filter((x) => x.type === z.id).length;
                const lit = armed || typeSelected;
                return (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => toggleZoneTool(z.id)}
                    title={
                      armed
                        ? "Erneut tippen → normaler Cursor"
                        : z.id === "trocken"
                          ? "Weg — trockene Fläche, nicht bewässern"
                          : `${z.label} wählen zum Zeichnen`
                    }
                    className={`flex items-center gap-2.5 rounded-2xl px-2 py-2 text-left transition ${
                      armed
                        ? "bg-lime text-forest shadow-soft ring-2 ring-white/40"
                        : typeSelected
                          ? "bg-white text-forest shadow-soft"
                          : "text-white/90 hover:bg-white/10"
                    }`}
                  >
                    <RailCountIcon count={count} lit={lit}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={z.icon}
                        alt=""
                        width={28}
                        height={28}
                        className={`h-7 w-7 object-contain object-center ${
                          lit ? "" : "brightness-0 invert"
                        }`}
                      />
                    </RailCountIcon>
                    <span className="min-w-0 flex-1 text-[12px] font-bold leading-tight sm:text-[13px]">
                      {z.short}
                    </span>
                  </button>
                );
              })
            : FIXTURE_STEPS.map((s) => {
                const count = fixtures.filter((f) => f.kind === s.id).length;
                const armed = armedKind === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    title={
                      armed
                        ? "Erneut tippen oder Esc → normaler Cursor"
                        : `${s.label} wählen zum Platzieren`
                    }
                    onClick={() => toggleTechnikTool(s.id)}
                    className={`flex items-center gap-2.5 rounded-2xl px-2 py-2 text-left transition ${
                      armed
                        ? "bg-lime text-forest shadow-soft ring-2 ring-white/40"
                        : "text-white/90 hover:bg-white/10"
                    }`}
                  >
                    <RailCountIcon count={count} lit={armed}>
                      <FixtureStepIcon
                        kind={s.id}
                        size={22}
                      />
                    </RailCountIcon>
                    <span className="min-w-0 flex-1 text-[12px] font-bold leading-tight sm:text-[13px]">
                      {s.short}
                    </span>
                  </button>
                );
              })}
        </div>
      </div>
      )}

      {/* Saved zones panel — vertically centered like left rail */}
      {zones.length > 0 && drawing ? (
        <div className="pointer-events-none absolute right-3 top-1/2 z-20 w-[min(100%-1.5rem,19rem)] -translate-y-1/2 sm:right-5">
          <div className="pointer-events-auto h-fit overflow-hidden rounded-3xl border border-white/15 bg-forest/92 shadow-soft backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
                Gespeicherte Flächen
              </p>
              <p className="text-xs font-semibold text-lime">
                Σ {formatAreaM2(totalArea)}
              </p>
            </div>
            <ul className="max-h-64 overflow-y-auto py-1.5">
              {zoneSummaries.map((z, i) => {
                const selected = z.id === selectedZoneId;
                return (
                  <li key={z.id}>
                    <div
                      className={`flex items-center gap-2 px-4 py-2.5 ${
                        selected ? "bg-white/10" : "hover:bg-white/5"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => focusZone(z.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="flex items-center gap-2.5 text-sm font-semibold text-white">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: z.color }}
                          />
                          <span className="truncate">
                            {i + 1}. {z.label}
                          </span>
                        </span>
                        <span className="mt-0.5 block pl-5 text-xs text-white/55">
                          {formatAreaM2(z.area)} · {formatMeters(z.peri)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteZone(z.id)}
                        className="rounded-full p-2 text-white/45 hover:bg-white/10 hover:text-white"
                        title="Fläche löschen"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      {/* Bottom chrome — full-width fade + centered actions */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-36 backdrop-blur-[6px] sm:h-40"
          style={{
            background:
              "linear-gradient(to top, rgba(11, 36, 20, 0.72) 0%, rgba(11, 36, 20, 0.35) 42%, rgba(11, 36, 20, 0) 100%)",
            WebkitMaskImage:
              "linear-gradient(to top, black 0%, black 35%, transparent 100%)",
            maskImage:
              "linear-gradient(to top, black 0%, black 35%, transparent 100%)",
          }}
          aria-hidden
        />
        <div className="pointer-events-auto relative mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2.5 px-4 py-4 sm:px-5 sm:py-5">
          <div className="group relative">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-forest/92 text-white shadow-soft backdrop-blur-md transition hover:bg-forest hover:text-lime focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime/60"
              aria-label="Hilfe anzeigen"
              title="Hilfe"
            >
              <CircleHelp size={20} strokeWidth={2.25} />
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 z-30 w-[min(90vw,22rem)] -translate-x-1/2 rounded-2xl border border-white/15 bg-forest/95 px-4 py-3 text-left text-sm leading-snug text-white/90 opacity-0 shadow-soft backdrop-blur-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              {hint}
            </div>
          </div>

          {canResetMarking ? (
            <button
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-forest/80 px-4 py-3.5 text-sm font-semibold text-white/90 shadow-soft backdrop-blur-md transition hover:border-white/40 hover:bg-forest hover:text-lime"
              title="Alle Flächen und Technik löschen"
            >
              <Trash2 size={17} /> Zurücksetzen
            </button>
          ) : null}

          {drawing ? (
            <>
              {editingZone ? (
                <>
                  <button
                    type="button"
                    onClick={deleteSelectedVertex}
                    disabled={
                      selectedVertex == null ||
                      (selectedZone?.coordinates.length ?? 0) <= 3
                    }
                    className="inline-flex items-center gap-2 rounded-full bg-white/95 px-5 py-3.5 text-sm font-semibold text-forest shadow-soft disabled:opacity-40"
                  >
                    <Trash2 size={17} /> Punkt löschen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedZoneId) deleteZone(selectedZoneId);
                    }}
                    className="inline-flex items-center gap-2 rounded-full bg-white/95 px-5 py-3.5 text-sm font-semibold text-forest shadow-soft"
                  >
                    <Trash2 size={17} /> Fläche löschen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedZoneId(null);
                      setSelectedVertex(null);
                      selectedZoneIdRef.current = null;
                      selectedVertexRef.current = null;
                    }}
                    className="inline-flex items-center gap-2 rounded-full bg-white/95 px-5 py-3.5 text-sm font-semibold text-forest shadow-soft"
                  >
                    <X size={17} /> Auswahl
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={undoPoint}
                    disabled={draftPoints.length === 0}
                    className="inline-flex items-center gap-2 rounded-full bg-white/95 px-5 py-3.5 text-sm font-semibold text-forest shadow-soft disabled:opacity-40"
                  >
                    <Undo2 size={17} /> Zurück
                  </button>
                  <button
                    type="button"
                    onClick={cancelDraft}
                    disabled={!armedZone && draftPoints.length === 0}
                    className="inline-flex items-center gap-2 rounded-full bg-white/95 px-5 py-3.5 text-sm font-semibold text-forest shadow-soft disabled:opacity-40"
                  >
                    <X size={17} /> Verwerfen
                  </button>
                  <button
                    type="button"
                    onClick={closePolygon}
                    disabled={draftPoints.length < 3}
                    className="inline-flex items-center gap-2 rounded-full bg-white/95 px-5 py-3.5 text-sm font-semibold text-forest shadow-soft disabled:opacity-40"
                  >
                    <Check size={17} /> Speichern
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={goNextStage}
                disabled={!canGoNext}
                className="inline-flex items-center gap-2 rounded-full bg-lime px-5 py-3.5 text-sm font-semibold text-forest shadow-soft disabled:opacity-40"
              >
                Weiter <ChevronRight size={17} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={goPrevStage}
                className="inline-flex items-center gap-2 rounded-full bg-white/95 px-5 py-3.5 text-sm font-semibold text-forest shadow-soft"
              >
                <ChevronLeft size={17} /> Zurück
              </button>
              <button
                type="button"
                onClick={undoLastFixture}
                disabled={totalFixtures === 0}
                className="inline-flex items-center gap-2 rounded-full bg-white/95 px-5 py-3.5 text-sm font-semibold text-forest shadow-soft disabled:opacity-40"
              >
                <Undo2 size={17} /> Letzte löschen
              </button>
              {isLastStage ? (
                <button
                  type="button"
                  onClick={openPlanChoice}
                  disabled={!planDone}
                  className="inline-flex items-center gap-2 rounded-full bg-lime px-5 py-3.5 text-sm font-semibold text-forest shadow-soft disabled:opacity-40"
                >
                  <Check size={17} /> Fertig
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNextStage}
                  disabled={!canGoNext}
                  className="inline-flex items-center gap-2 rounded-full bg-lime px-5 py-3.5 text-sm font-semibold text-forest shadow-soft disabled:opacity-40"
                >
                  Weiter <ChevronRight size={17} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
