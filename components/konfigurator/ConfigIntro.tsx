"use client";

import Image from "next/image";
import { MapPinned, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { GeocodeFeature } from "@/lib/mapbox";

type Props = {
  onStart: () => void;
  onResume?: (place: GeocodeFeature) => void;
  lastPlace?: GeocodeFeature | null;
};

export function ConfigIntro({ onStart, onResume, lastPlace }: Props) {
  return (
    <div className="relative flex min-h-[100svh] w-full flex-col items-center justify-center overflow-hidden px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <Image
        src="https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=2000&q=80"
        alt=""
        fill
        priority
        className="object-cover"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-forest/85 via-forest/75 to-forest/90" />

      <div className="relative z-10 mx-auto max-w-xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-lime">
          RegnerWerk Planer
        </p>
        <h1 className="mt-4 text-[clamp(2rem,5vw,3.25rem)] font-light leading-tight tracking-tight text-white">
          Kostenlos Ihren{" "}
          <span className="font-bold">Bewässerungsplan</span>{" "}
          <span className="font-accent text-[1.12em] font-medium text-lime">
            erstellen.
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-white/75">
          Öffnen Sie Ihren Garten auf der Karte, zeichnen Sie Flächen ein – wir
          zeigen später, was Ihr System braucht.
        </p>
        <div className="mt-8 flex w-full max-w-sm flex-col items-stretch gap-3 sm:mx-auto">
          {lastPlace && onResume ? (
            <Button
              type="button"
              variant="primary"
              className="w-full !shadow-none"
              onClick={() => onResume(lastPlace)}
            >
              <RotateCcw size={18} aria-hidden />
              Letzte Adresse öffnen
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              className="w-full !shadow-none"
              onClick={onStart}
            >
              <MapPinned size={18} aria-hidden />
              Meinen Garten auf der Karte öffnen
            </Button>
          )}
        </div>
        {lastPlace ? (
          <div className="mt-4 space-y-2">
            <p className="truncate text-xs text-white/55">{lastPlace.placeName}</p>
            <button
              type="button"
              onClick={onStart}
              className="text-xs font-semibold text-lime hover:underline"
            >
              Andere Adresse wählen
            </button>
          </div>
        ) : (
          <p className="mt-4 text-xs text-white/45">
            Kein Kaufzwang · Adresse nur für die Kartendarstellung
          </p>
        )}
      </div>
    </div>
  );
}
