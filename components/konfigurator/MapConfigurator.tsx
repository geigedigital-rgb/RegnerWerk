"use client";

import { useEffect, useState } from "react";
import { AddressStep } from "@/components/konfigurator/AddressStep";
import { ConfigIntro } from "@/components/konfigurator/ConfigIntro";
import { PlotMap } from "@/components/konfigurator/PlotMap";
import { loadLastPlace, saveLastPlace } from "@/lib/config-storage";
import { fetchServerProject } from "@/lib/project-api";
import { ensureProject, saveProject } from "@/lib/project-storage";
import { useLockPageZoom } from "@/lib/lock-page-zoom";
import type { GeocodeFeature } from "@/lib/mapbox";

type Stage = "intro" | "address" | "map" | "loading";

export function MapConfigurator() {
  const [stage, setStage] = useState<Stage>("loading");
  const [place, setPlace] = useState<GeocodeFeature | null>(null);
  const [serverProjectId, setServerProjectId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useLockPageZoom(true);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const params = new URLSearchParams(window.location.search);
      const projectId = params.get("projectId")?.trim();

      if (projectId) {
        try {
          const remote = await fetchServerProject(projectId);
          if (cancelled) return;
          if (!remote?.payload?.place?.id) {
            setLoadError("Projekt nicht gefunden");
            setStage("intro");
            return;
          }
          const payload = remote.payload;
          saveProject({
            ...payload,
            version: 1,
            updatedAt: new Date().toISOString(),
          });
          saveLastPlace(payload.place);
          setPlace(payload.place);
          setServerProjectId(remote.id);
          setStage("map");
          // Clean query so refresh uses local draft
          const url = new URL(window.location.href);
          url.searchParams.delete("projectId");
          window.history.replaceState({}, "", url.pathname + url.search);
          return;
        } catch (e) {
          if (cancelled) return;
          setLoadError(
            e instanceof Error ? e.message : "Projekt laden fehlgeschlagen",
          );
          setStage("intro");
          return;
        }
      }

      const saved = loadLastPlace();
      if (saved) {
        ensureProject(saved);
        setPlace(saved);
        setStage("map");
      } else {
        setStage("intro");
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  if (stage === "loading") {
    return <div className="fixed inset-0 z-[60] bg-forest" />;
  }

  function openPlace(feature: GeocodeFeature) {
    ensureProject(feature);
    setPlace(feature);
    setServerProjectId(null);
    saveLastPlace(feature);
    setStage("map");
  }

  return (
    <div
      className={`fixed inset-0 z-[60] bg-forest ${
        stage === "map" ? "overflow-hidden overscroll-none" : "overflow-y-auto"
      }`}
    >
      {loadError ? (
        <div className="absolute left-1/2 top-4 z-[70] w-[min(100%-2rem,24rem)] -translate-x-1/2 rounded-2xl border border-red-200 bg-white px-4 py-3 text-center text-sm text-red-700 shadow-lg">
          {loadError}
          <button
            type="button"
            className="mt-2 block w-full text-xs font-semibold text-forest underline"
            onClick={() => setLoadError(null)}
          >
            Schließen
          </button>
        </div>
      ) : null}

      {stage === "intro" ? (
        <ConfigIntro
          lastPlace={place}
          onStart={() => setStage("address")}
          onResume={(feature) => openPlace(feature)}
        />
      ) : null}

      {stage === "address" ? (
        <AddressStep
          onBack={() => setStage("intro")}
          onSelect={(feature) => openPlace(feature)}
        />
      ) : null}

      {stage === "map" && place ? (
        <PlotMap
          place={place}
          serverProjectId={serverProjectId}
          onBack={() => setStage("address")}
        />
      ) : null}
    </div>
  );
}
