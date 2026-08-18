"use client";

import { FixtureStepIcon } from "@/components/konfigurator/FixtureMarker";
import { RailCountIcon } from "@/components/konfigurator/RailCountIcon";
import {
  FIXTURE_STEPS,
  ZONE_TYPES,
  type DrawnZone,
  type FixtureKind,
  type PlotFixture,
  type ZoneTypeId,
} from "@/lib/mapbox";

type Props = {
  layout: "rail" | "dock";
  drawing: boolean;
  armedZone: ZoneTypeId | null;
  selectedZoneType?: ZoneTypeId;
  zones: DrawnZone[];
  fixtures: PlotFixture[];
  armedKind: FixtureKind | null;
  onToggleZone: (id: ZoneTypeId) => void;
  onToggleTechnik: (id: FixtureKind) => void;
};

export function PlotToolRail({
  layout,
  drawing,
  armedZone,
  selectedZoneType,
  zones,
  fixtures,
  armedKind,
  onToggleZone,
  onToggleTechnik,
}: Props) {
  const dock = layout === "dock";

  const btn = (lit: boolean, armed: boolean) =>
    dock
      ? `flex min-w-[4.35rem] flex-col items-center gap-1 rounded-2xl px-1.5 py-2 ${
          armed
            ? "bg-lime text-forest ring-2 ring-white/40"
            : lit
              ? "bg-white text-forest"
              : "text-white/90"
        }`
      : `flex items-center gap-2.5 rounded-2xl px-2 py-2 text-left ${
          armed
            ? "bg-lime text-forest shadow-soft ring-2 ring-white/40"
            : lit
              ? "bg-white text-forest shadow-soft"
              : "text-white/90 hover:bg-white/10"
        }`;

  return (
    <div
      className={
        dock
          ? "pointer-events-auto flex w-full gap-1 overflow-x-auto rounded-[1.35rem] border border-white/15 bg-forest/92 p-1 shadow-soft backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "pointer-events-auto flex h-fit w-[9.25rem] flex-col gap-1 rounded-3xl border border-white/15 bg-forest/92 p-1.5 shadow-soft backdrop-blur-md sm:w-[10rem] sm:p-2"
      }
    >
      {drawing
        ? ZONE_TYPES.map((z) => {
            const armed = armedZone === z.id;
            const typeSelected = !armedZone && selectedZoneType === z.id;
            const count = zones.filter((x) => x.type === z.id).length;
            const lit = armed || typeSelected;
            return (
              <button
                key={z.id}
                type="button"
                onClick={() => onToggleZone(z.id)}
                title={
                  armed
                    ? "Erneut tippen → normaler Cursor"
                    : z.id === "trocken"
                      ? "Weg — trockene Fläche, nicht bewässern"
                      : `${z.label} wählen zum Zeichnen`
                }
                className={btn(lit, armed)}
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
                <span
                  className={`font-bold leading-tight ${
                    dock ? "text-[10px]" : "min-w-0 flex-1 text-[12px] sm:text-[13px]"
                  }`}
                >
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
                onClick={() => onToggleTechnik(s.id)}
                className={btn(false, armed)}
              >
                <RailCountIcon count={count} lit={armed}>
                  <FixtureStepIcon kind={s.id} size={22} />
                </RailCountIcon>
                <span
                  className={`font-bold leading-tight ${
                    dock
                      ? "text-[10px]"
                      : "min-w-0 flex-1 text-[12px] sm:text-[13px]"
                  }`}
                >
                  {s.short}
                </span>
              </button>
            );
          })}
    </div>
  );
}
