"use client";

import { SprinklerSprayLoader } from "@/components/konfigurator/SprinklerSprayLoader";

type Props = {
  mode: "full" | "brand";
  brandLabel?: string;
};

export function SofortCalcLoader({ mode, brandLabel }: Props) {
  if (mode === "brand") {
    return (
      <div
        className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur-[2px]"
        role="status"
        aria-live="polite"
        aria-label="Variante wird berechnet"
      >
        <div className="flex flex-col items-center gap-3">
          <SprinklerSprayLoader
            size="sm"
            label={`${brandLabel ?? "Variante"} wird berechnet`}
          />
          <p className="text-sm font-semibold text-forest">
            {brandLabel ?? "Variante"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 z-[45] flex items-center justify-center bg-forest/55 p-4 backdrop-blur-[3px]"
      role="status"
      aria-live="polite"
      aria-label="Sofort-Berechnung läuft"
    >
      <div className="flex flex-col items-center rounded-[1.75rem] border border-white/12 bg-white px-8 py-7">
        <SprinklerSprayLoader size="lg" label="Plan wird erstellt" />
        <p className="mt-5 text-base font-semibold text-forest">
          Plan wird erstellt
        </p>
      </div>
    </div>
  );
}
