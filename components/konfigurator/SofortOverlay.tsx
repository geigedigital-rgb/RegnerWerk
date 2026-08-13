"use client";

import Image from "next/image";
import type mapboxgl from "mapbox-gl";
import { useId, useRef, useState } from "react";
import type { DrawnZone, LngLat } from "@/lib/mapbox";
import {
  headScreenLabel,
  resolveHeadProduct,
  zoneColor,
  type SofortPlan,
} from "@/lib/planner";

type Props = {
  map: mapboxgl.Map | null;
  plan: SofortPlan;
  lawns: DrawnZone[];
  renderTick: number;
  selectedHeadId: string | null;
  onSelectHead: (id: string | null) => void;
  onHeadMove: (id: string, pos: LngLat) => void;
  onEditCommit: () => void;
  isCanvas: boolean;
};

/** Open sector outline (no pie fill) — readable plan style. */
function sectorOutlinePath(
  cx: number,
  cy: number,
  rPx: number,
  arcDeg: number,
  rotationDeg: number,
): string {
  if (arcDeg >= 360) return "";
  const half = arcDeg / 2;
  const a0 = ((rotationDeg - half - 90) * Math.PI) / 180;
  const a1 = ((rotationDeg + half - 90) * Math.PI) / 180;
  const x0 = cx + rPx * Math.cos(a0);
  const y0 = cy + rPx * Math.sin(a0);
  const x1 = cx + rPx * Math.cos(a1);
  const y1 = cy + rPx * Math.sin(a1);
  const large = arcDeg > 180 ? 1 : 0;
  return `M ${x0} ${y0} L ${cx} ${cy} L ${x1} ${y1} A ${rPx} ${rPx} 0 ${large} 0 ${x0} ${y0}`;
}

function sectorFillPath(
  cx: number,
  cy: number,
  rPx: number,
  arcDeg: number,
  rotationDeg: number,
): string {
  if (arcDeg >= 360) return "";
  const half = arcDeg / 2;
  const a0 = ((rotationDeg - half - 90) * Math.PI) / 180;
  const a1 = ((rotationDeg + half - 90) * Math.PI) / 180;
  const x0 = cx + rPx * Math.cos(a0);
  const y0 = cy + rPx * Math.sin(a0);
  const x1 = cx + rPx * Math.cos(a1);
  const y1 = cy + rPx * Math.sin(a1);
  const large = arcDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${rPx} ${rPx} 0 ${large} 1 ${x1} ${y1} Z`;
}

function stripRectPoints(
  cx: number,
  cy: number,
  widthPx: number,
  lengthPx: number,
  rotationDeg: number,
): string {
  const a = ((rotationDeg - 90) * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const vx = -Math.sin(a);
  const vy = Math.cos(a);
  const hw = widthPx / 2;
  const corners = [
    { x: cx + 0 * ux - hw * vx, y: cy + 0 * uy - hw * vy },
    { x: cx + lengthPx * ux - hw * vx, y: cy + lengthPx * uy - hw * vy },
    { x: cx + lengthPx * ux + hw * vx, y: cy + lengthPx * uy + hw * vy },
    { x: cx + 0 * ux + hw * vx, y: cy + 0 * uy + hw * vy },
  ];
  return corners.map((p) => `${p.x},${p.y}`).join(" ");
}

export function SofortOverlay({
  map,
  plan,
  lawns,
  renderTick: _renderTick,
  selectedHeadId,
  onSelectHead,
  onHeadMove,
  onEditCommit,
  isCanvas,
}: Props) {
  const clipId = useId().replace(/:/g, "");
  const [hoveredHeadId, setHoveredHeadId] = useState<string | null>(null);
  const dragRef = useRef<{
    headId: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  if (!map) return null;

  function eventToLngLat(e: PointerEvent | React.PointerEvent): LngLat | null {
    const m = map;
    if (!m) return null;
    const rect = m.getContainer().getBoundingClientRect();
    const ll = m.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    return { lng: ll.lng, lat: ll.lat };
  }

  function startDrag(e: React.PointerEvent, headId: string) {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      headId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    map?.dragPan.disable();
    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (
        !drag.moved &&
        Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 4
      ) {
        return;
      }
      drag.moved = true;
      const pos = eventToLngLat(ev);
      if (pos) onHeadMove(drag.headId, pos);
    };
    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      map?.dragPan.enable();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (drag?.moved) {
        onEditCommit();
      } else if (drag) {
        onSelectHead(selectedHeadId === drag.headId ? null : drag.headId);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const project = (lng: number, lat: number) => map.project([lng, lat]);
  const c = map.getCenter();
  const p0 = project(c.lng, c.lat);
  const meterLng =
    c.lng + 1 / (111320 * Math.cos((c.lat * Math.PI) / 180));
  const p1 = project(meterLng, c.lat);
  const pxPerM = Math.abs(p1.x - p0.x);

  const ink = isCanvas ? "#0b2414" : "#ffffff";
  const colorFor = (zone: number) => zoneColor(zone, isCanvas);
  const strokeBase = isCanvas ? 1.75 : 1.4;
  const strokeFocus = isCanvas ? 2.5 : 2;
  const outlineOpacity = isCanvas ? 0.92 : 0.72;

  const lawnScreenPaths = lawns
    .filter((z) => z.coordinates.length >= 3)
    .map((z) => ({
      id: z.id,
      points: z.coordinates
        .map((pt) => {
          const s = project(pt.lng, pt.lat);
          return `${s.x},${s.y}`;
        })
        .join(" "),
    }));

  const focusId = selectedHeadId ?? hoveredHeadId;
  const selectedHead = selectedHeadId
    ? plan.heads.find((h) => h.id === selectedHeadId)
    : null;
  const selectedProduct = selectedHead
    ? resolveHeadProduct(selectedHead, plan.brand ?? "hunter")
    : null;
  const selectedScreen = selectedHead
    ? project(selectedHead.position.lng, selectedHead.position.lat)
    : null;

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 z-[7] h-full w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <clipPath id={`lawn-clip-${clipId}`} clipPathUnits="userSpaceOnUse">
            {lawnScreenPaths.map((p) => (
              <polygon key={p.id} points={p.points} />
            ))}
          </clipPath>
        </defs>

        {plan.heads.map((h) => {
          if (h.id !== focusId) return null;
          const s = project(h.position.lng, h.position.lat);
          const color = colorFor(h.hydraulicZone);
          const rPx = h.radiusM * pxPerM;
          if (h.kind === "strip") {
            const wPx = (h.stripWidthM ?? 1.5) * pxPerM;
            const lPx = (h.stripLengthM ?? h.radiusM) * pxPerM;
            return (
              <polygon
                key={`full-${h.id}`}
                points={stripRectPoints(s.x, s.y, wPx, lPx, h.rotationDeg)}
                fill="none"
                stroke={color}
                strokeOpacity={0.55}
                strokeWidth={1.25}
                strokeDasharray="4 3"
              />
            );
          }
          if (h.arcDeg >= 360) {
            return (
              <circle
                key={`full-${h.id}`}
                cx={s.x}
                cy={s.y}
                r={rPx}
                fill="none"
                stroke={color}
                strokeOpacity={0.55}
                strokeWidth={1.25}
                strokeDasharray="4 3"
              />
            );
          }
          return (
            <path
              key={`full-${h.id}`}
              d={sectorOutlinePath(s.x, s.y, rPx, h.arcDeg, h.rotationDeg)}
              fill="none"
              stroke={color}
              strokeOpacity={0.55}
              strokeWidth={1.25}
              strokeDasharray="4 3"
            />
          );
        })}

        <g clipPath={`url(#lawn-clip-${clipId})`}>
          {plan.heads.map((h) => {
            const s = project(h.position.lng, h.position.lat);
            const color = colorFor(h.hydraulicZone);
            const focused = h.id === focusId;
            const rPx = h.radiusM * pxPerM;
            const fillOp = isCanvas ? 0.1 : 0.14;

            if (h.kind === "strip") {
              const wPx = (h.stripWidthM ?? 1.5) * pxPerM;
              const lPx = (h.stripLengthM ?? h.radiusM) * pxPerM;
              const pts = stripRectPoints(s.x, s.y, wPx, lPx, h.rotationDeg);
              return (
                <g key={`cov-${h.id}`}>
                  {focused ? (
                    <polygon
                      points={pts}
                      fill={color}
                      fillOpacity={fillOp}
                      stroke="none"
                    />
                  ) : null}
                  <polygon
                    points={pts}
                    fill="none"
                    stroke={color}
                    strokeOpacity={focused ? 0.98 : outlineOpacity}
                    strokeWidth={focused ? strokeFocus : strokeBase}
                  />
                </g>
              );
            }

            if (h.arcDeg >= 360) {
              return (
                <g key={`cov-${h.id}`}>
                  {focused ? (
                    <circle
                      cx={s.x}
                      cy={s.y}
                      r={rPx}
                      fill={color}
                      fillOpacity={fillOp}
                      stroke="none"
                    />
                  ) : null}
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={rPx}
                    fill="none"
                    stroke={color}
                    strokeOpacity={focused ? 0.98 : outlineOpacity}
                    strokeWidth={focused ? strokeFocus : strokeBase}
                  />
                </g>
              );
            }

            return (
              <g key={`cov-${h.id}`}>
                {focused ? (
                  <path
                    d={sectorFillPath(s.x, s.y, rPx, h.arcDeg, h.rotationDeg)}
                    fill={color}
                    fillOpacity={fillOp}
                    stroke="none"
                  />
                ) : null}
                <path
                  d={sectorOutlinePath(s.x, s.y, rPx, h.arcDeg, h.rotationDeg)}
                  fill="none"
                  stroke={color}
                  strokeOpacity={focused ? 0.98 : outlineOpacity}
                  strokeWidth={focused ? strokeFocus : strokeBase}
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
        </g>

        {lawnScreenPaths.map((p) => (
          <polygon
            key={`lawn-edge-${p.id}`}
            points={p.points}
            fill="none"
            stroke={ink}
            strokeOpacity={isCanvas ? 0.75 : 0.4}
            strokeWidth={isCanvas ? 2 : 1.5}
          />
        ))}

        {plan.pipes.map((p) => {
          const pts = p.points
            .map((pt) => {
              const s = project(pt.lng, pt.lat);
              return `${s.x},${s.y}`;
            })
            .join(" ");
          const isMain = p.kind === "main";
          const zc =
            p.hydraulicZone == null
              ? ink
              : colorFor(p.hydraulicZone);
          return (
            <g key={p.id}>
              <polyline
                points={pts}
                fill="none"
                stroke={isCanvas ? "#ffffff" : "#0b2414"}
                strokeWidth={isMain ? 4.5 : 3.5}
                strokeOpacity={isCanvas ? 0.9 : 0.35}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <polyline
                points={pts}
                fill="none"
                stroke={zc}
                strokeWidth={isMain ? (isCanvas ? 2.5 : 2) : isCanvas ? 2 : 1.5}
                strokeDasharray={isMain ? undefined : "0.5 5"}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeOpacity={isCanvas ? 1 : 0.95}
              />
            </g>
          );
        })}
      </svg>

      <div className="absolute inset-0 z-[8]" style={{ pointerEvents: "none" }}>
        {plan.heads.map((h) => {
          const s = project(h.position.lng, h.position.lat);
          const color = colorFor(h.hydraulicZone);
          const selected = h.id === selectedHeadId;
          const hovered = h.id === hoveredHeadId;
          const focused = selected || hovered;
          return (
            <button
              key={h.id}
              type="button"
              data-head-id={h.id}
              onPointerDown={(e) => startDrag(e, h.id)}
              onPointerEnter={() => setHoveredHeadId(h.id)}
              onPointerLeave={() =>
                setHoveredHeadId((cur) => (cur === h.id ? null : cur))
              }
              className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full focus-visible:outline-none active:cursor-grabbing"
              style={{
                left: s.x,
                top: s.y,
                pointerEvents: "auto",
                touchAction: "none",
              }}
              title={`${headScreenLabel(h.configKey)} · ${h.radiusM} m`}
            >
              <span
                className="relative block rounded-full"
                style={{
                  width: focused ? 18 : 14,
                  height: focused ? 18 : 14,
                  backgroundColor: isCanvas ? "#fff" : "#fff",
                  border: `2.5px solid ${color}`,
                  boxShadow: `0 0 0 1px ${isCanvas ? "rgba(11,36,20,0.45)" : "rgba(0,0,0,0.25)"}`,
                }}
              >
                <span
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    width: focused ? 7 : 5,
                    height: focused ? 7 : 5,
                    backgroundColor: color,
                  }}
                />
              </span>
              {hovered && !selected ? (
                <span className="absolute left-1/2 top-[-2.2rem] -translate-x-1/2 whitespace-nowrap rounded-md bg-forest/95 px-2 py-1 text-[10px] font-bold leading-tight text-lime shadow-soft">
                  {headScreenLabel(h.configKey)}
                  {h.kind === "strip"
                    ? ` · ${(h.stripWidthM ?? 1.5).toLocaleString("de-DE")}×${(h.stripLengthM ?? h.radiusM).toLocaleString("de-DE")} m`
                    : ` · ${h.radiusM.toLocaleString("de-DE")} m · ${h.arcDeg}°`}
                </span>
              ) : null}
            </button>
          );
        })}

        {selectedHead && selectedProduct && selectedScreen ? (
          <div
            className="pointer-events-auto absolute z-[9] w-[15.5rem] -translate-x-1/2 rounded-2xl border border-forest/15 bg-white p-2.5 shadow-soft"
            style={{
              left: selectedScreen.x,
              top: selectedScreen.y + 18,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex gap-2.5">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-mint ring-1 ring-forest/10">
                {selectedProduct.imageUrl ? (
                  <Image
                    src={selectedProduct.imageUrl}
                    alt={selectedProduct.title}
                    fill
                    className="object-contain p-1"
                    sizes="64px"
                    unoptimized
                  />
                ) : (
                  <span className="flex h-full items-center justify-center text-[10px] text-forest/40">
                    —
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-forest">
                  {selectedProduct.title}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-forest/55">
                  {selectedHead.kind === "strip"
                    ? `${(selectedHead.stripWidthM ?? 1.5).toLocaleString("de-DE")}×${(selectedHead.stripLengthM ?? selectedHead.radiusM).toLocaleString("de-DE")} m`
                    : `${selectedHead.radiusM.toLocaleString("de-DE")} m · ${selectedHead.arcDeg}°`}
                  {" · "}
                  Zone {selectedHead.hydraulicZone + 1}
                </p>
                {selectedHead.kind === "strip" ? (
                  <p className="mt-1 text-[10px] leading-snug text-forest/70">
                    Hersteller:{" "}
                    {(
                      selectedProduct.stripWidthM ??
                      selectedHead.stripWidthM ??
                      1.5
                    ).toLocaleString("de-DE")}
                    ×
                    {(
                      selectedProduct.stripLengthM ??
                      selectedHead.stripLengthM ??
                      selectedHead.radiusM
                    ).toLocaleString("de-DE")}{" "}
                    m (Streifen, kein Kreis)
                  </p>
                ) : selectedProduct.radiusMinM != null &&
                  selectedProduct.radiusMaxM != null ? (
                  <p className="mt-1 text-[10px] leading-snug text-forest/70">
                    Hersteller: {selectedProduct.radiusMinM.toLocaleString("de-DE")}–
                    {selectedProduct.radiusMaxM.toLocaleString("de-DE")} m
                    {selectedProduct.arcMinDeg != null &&
                    selectedProduct.arcMaxDeg != null &&
                    selectedProduct.arcMinDeg !== 360
                      ? ` · ${selectedProduct.arcMinDeg}–${selectedProduct.arcMaxDeg}°`
                      : selectedProduct.arcMinDeg === 360
                        ? " · 360°"
                        : ""}
                  </p>
                ) : null}
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-forest/55">
              {selectedProduct.note}
            </p>
            {!selectedProduct.radiusInSpec || !selectedProduct.arcInSpec ? (
              <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-900 ring-1 ring-amber-200/80">
                Geplanter Wert außerhalb Herstellerblatt — bitte Neu berechnen.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => onSelectHead(null)}
              className="mt-2 w-full rounded-xl bg-forest/5 py-1.5 text-[11px] font-semibold text-forest hover:bg-forest/10"
            >
              Schließen
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
