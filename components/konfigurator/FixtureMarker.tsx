"use client";

import Image from "next/image";
import { Droplets, GitBranch, Smartphone, X } from "lucide-react";
import type { FixtureKind } from "@/lib/mapbox";

const META: Record<
  FixtureKind,
  { label: string; Icon: typeof Droplets; accent: string }
> = {
  wasserquelle: {
    label: "Wasserquelle",
    Icon: Droplets,
    accent: "#00FFCF",
  },
  smarthome: {
    label: "Smarthome",
    Icon: Smartphone,
    accent: "#5B8DEF",
  },
  wasserverteiler: {
    label: "Verteiler",
    Icon: GitBranch,
    accent: "#E8B84A",
  },
};

type Props = {
  kind: FixtureKind;
  x: number;
  y: number;
  active?: boolean;
  subtitle?: string;
  onRemove?: () => void;
  /** Small colored pin without big icon — for Ergebnis overlay. */
  compact?: boolean;
  /** Ergebnis: clickable pin + optional detail card. */
  selected?: boolean;
  onSelect?: () => void;
  cardImageUrl?: string | null;
  cardTitle?: string | null;
  cardNote?: string | null;
  onCloseCard?: () => void;
};

/** Ghost cursor before placing a fixture. */
export function FixtureCursor({
  kind,
  x,
  y,
  rangeOk,
}: {
  kind: FixtureKind;
  x: number;
  y: number;
  /** For Verteiler: distance to Smarthome within limit */
  rangeOk?: boolean | null;
}) {
  const { Icon, accent, label } = META[kind];
  const ring =
    rangeOk === true
      ? "ring-[#00FFCF]/70"
      : rangeOk === false
        ? "ring-[#FF5C45]/70"
        : "ring-forest/25";

  return (
    <div
      className="pointer-events-none absolute z-[8] -translate-x-1/2 -translate-y-1/2"
      style={{ left: x, top: y }}
    >
      <div className="flex flex-col items-center">
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-soft ring-[3px] ${ring}`}
          style={{ color: accent }}
        >
          <Icon size={26} strokeWidth={2.25} />
        </div>
        <span className="mt-1.5 rounded-full bg-forest/90 px-2.5 py-0.5 text-[10px] font-bold text-lime">
          {label}
        </span>
      </div>
    </div>
  );
}

export function FixtureMarker({
  kind,
  x,
  y,
  active,
  subtitle,
  onRemove,
  compact,
  selected,
  onSelect,
  cardImageUrl,
  cardTitle,
  cardNote,
  onCloseCard,
}: Props) {
  const { label, Icon, accent } = META[kind];
  const caption = subtitle ?? label;
  const clickable = Boolean(onSelect || onRemove);

  if (compact) {
    return (
      <div
        className={`absolute z-[9] -translate-x-1/2 -translate-y-1/2 ${
          clickable ? "pointer-events-auto" : "pointer-events-none"
        }`}
        style={{ left: x, top: y }}
      >
        <button
          type="button"
          disabled={!onSelect}
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.();
          }}
          className={`group relative block rounded-full focus-visible:outline-none ${
            onSelect ? "cursor-pointer" : "cursor-default"
          }`}
          title={caption}
        >
          {onRemove ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onRemove();
                }
              }}
              className="absolute -right-2.5 -top-2.5 z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-forest text-white shadow-soft ring-1 ring-white group-hover:flex"
              title="Entfernen"
            >
              <X size={9} strokeWidth={2.5} />
            </span>
          ) : null}
          <span
            className={`block rounded-full border-2 shadow-soft transition ${
              selected || active ? "scale-125" : ""
            }`}
            style={{
              width: selected ? 14 : 10,
              height: selected ? 14 : 10,
              backgroundColor: accent,
              borderColor: selected ? accent : "#0b2414",
              boxShadow: selected
                ? `0 0 0 2px #fff, 0 0 0 4px ${accent}`
                : `0 0 0 2px rgba(255,255,255,0.9), 0 0 0 3px ${accent}55`,
            }}
          />
        </button>

        {selected ? (
          <div
            className="pointer-events-auto absolute left-1/2 top-5 z-10 w-[14.5rem] -translate-x-1/2 rounded-2xl border border-forest/15 bg-white p-2.5 shadow-soft"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex gap-2.5">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-mint ring-1 ring-forest/10">
                {cardImageUrl ? (
                  <Image
                    src={cardImageUrl}
                    alt=""
                    fill
                    className="object-contain p-1"
                    sizes="56px"
                    unoptimized
                  />
                ) : (
                  <span
                    className="flex h-full items-center justify-center"
                    style={{ color: accent }}
                  >
                    <Icon size={22} strokeWidth={2.25} />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-forest">
                  {cardTitle ?? label}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-forest/55">
                  {caption}
                </p>
                {cardNote ? (
                  <p className="mt-1 text-[10px] leading-snug text-forest/45">
                    {cardNote}
                  </p>
                ) : null}
              </div>
            </div>
            {onCloseCard ? (
              <button
                type="button"
                onClick={onCloseCard}
                className="mt-2 w-full rounded-xl bg-forest/5 py-1.5 text-[11px] font-semibold text-forest hover:bg-forest/10"
              >
                Schließen
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`absolute z-[7] -translate-x-1/2 -translate-y-[70%] ${
        onRemove || onSelect ? "pointer-events-auto" : "pointer-events-none"
      }`}
      style={{ left: x, top: y }}
    >
      <div className="relative flex flex-col items-center">
        {onRemove ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-forest text-white shadow-soft ring-2 ring-white"
            title="Entfernen"
          >
            <X size={11} strokeWidth={2.5} />
          </button>
        ) : null}
        <button
          type="button"
          disabled={!onSelect}
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.();
          }}
          className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-soft ring-2 transition ${
            active || selected ? "scale-105 ring-forest" : "ring-white/90"
          } ${onSelect ? "cursor-pointer" : ""}`}
          style={{ color: accent }}
        >
          <Icon size={26} strokeWidth={2.25} />
        </button>
        <span
          className={`mt-1.5 max-w-[6.5rem] truncate rounded-full px-2.5 py-1 text-center text-[11px] font-bold leading-tight shadow-soft ${
            active || selected
              ? "bg-forest text-lime"
              : "bg-white/95 text-forest ring-1 ring-forest/10"
          }`}
        >
          {caption}
        </span>
        <span
          className="mt-0.5 h-2 w-2 rotate-45 rounded-[2px] bg-white ring-1 ring-forest/15"
          aria-hidden
        />
      </div>
    </div>
  );
}

export function FixtureStepIcon({
  kind,
  size = 18,
}: {
  kind: FixtureKind;
  size?: number;
}) {
  const { Icon, accent } = META[kind];
  return <Icon size={size} style={{ color: accent }} strokeWidth={2.25} />;
}

export function fixtureMeta(kind: FixtureKind) {
  return META[kind];
}
