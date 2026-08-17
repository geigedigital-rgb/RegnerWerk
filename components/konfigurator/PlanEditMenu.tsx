"use client";

import { Droplets, Layers, Spline } from "lucide-react";
import type { ReactNode } from "react";

/** Exclusive plan view modes — no combining. */
export type PlanLayerMode = "gesamt" | "rohre" | "regner";

export type PlanLayers = {
  overview: boolean;
  pipes: boolean;
  heads: boolean;
};

export const DEFAULT_PLAN_LAYER_MODE: PlanLayerMode = "gesamt";

export function layersFromMode(mode: PlanLayerMode): PlanLayers {
  switch (mode) {
    case "rohre":
      return { overview: false, pipes: true, heads: false };
    case "regner":
      return { overview: false, pipes: false, heads: true };
    case "gesamt":
    default:
      return { overview: true, pipes: true, heads: true };
  }
}

export const DEFAULT_PLAN_LAYERS: PlanLayers = layersFromMode(
  DEFAULT_PLAN_LAYER_MODE,
);

type Props = {
  mode: PlanLayerMode;
  onMode: (mode: PlanLayerMode) => void;
};

function ModeButton({
  on,
  label,
  icon,
  onClick,
}: {
  on: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left text-[12px] font-semibold transition ${
        on
          ? "bg-lime text-forest"
          : "bg-forest/5 text-forest/50 hover:bg-forest/10"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </button>
  );
}

/** Exclusive Ebenen — Plan view only. One mode at a time. */
export function PlanEditMenu({ mode, onMode }: Props) {
  return (
    <div
      className="pointer-events-auto w-[9.5rem] rounded-3xl border border-forest/10 bg-white/95 p-2 shadow-soft backdrop-blur-md sm:w-[10.5rem] sm:p-2.5"
      onWheel={(e) => {
        if (e.ctrlKey) e.preventDefault();
      }}
    >
      <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-forest/40">
        Ebenen
      </p>
      <div className="mt-1.5 flex flex-col gap-1" role="radiogroup" aria-label="Ebenen">
        <ModeButton
          on={mode === "gesamt"}
          label="Gesamt"
          icon={<Layers size={16} />}
          onClick={() => onMode("gesamt")}
        />
        <ModeButton
          on={mode === "rohre"}
          label="Rohre"
          icon={<Spline size={16} />}
          onClick={() => onMode("rohre")}
        />
        <ModeButton
          on={mode === "regner"}
          label="Regner"
          icon={<Droplets size={16} />}
          onClick={() => onMode("regner")}
        />
      </div>
    </div>
  );
}
