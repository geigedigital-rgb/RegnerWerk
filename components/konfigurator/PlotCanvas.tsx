"use client";

import { useEffect, useRef, useState } from "react";
import {
  commitDim,
  formatDim,
  sanitizeDimInput,
  type PlotShape,
} from "@/lib/configurator";

type Label = {
  key: string;
  x: number;
  y: number;
  value: number;
};

type Props = {
  shape: PlotShape | null;
  dims: Record<string, number>;
  onDimChange?: (key: string, value: number) => void;
  editable?: boolean;
};

const W = 320;
const H = 240;

function pathFor(
  shape: PlotShape,
  dims: Record<string, number>,
): { d: string; labels: Label[] } {
  const pad = 28;
  const a = Math.max(1, dims.a || 10);
  const b = Math.max(1, dims.b || 8);
  const c = Math.max(1, dims.c || 4);
  const d = Math.max(1, dims.d || 3.5);
  const r = Math.max(1, dims.r || 4);

  if (shape === "quadrat") {
    const scale = Math.min((W - pad * 2) / a, (H - pad * 2) / b);
    const w = a * scale;
    const h = b * scale;
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    return {
      d: `M ${x} ${y} h ${w} v ${h} h ${-w} Z`,
      labels: [
        { key: "a", x: x + w / 2, y: y - 6, value: a },
        { key: "b", x: x + w + 14, y: y + h / 2 + 4, value: b },
      ],
    };
  }

  if (shape === "l") {
    const maxX = a;
    const maxY = b;
    const scale = Math.min((W - pad * 2) / maxX, (H - pad * 2) / maxY);
    const x0 = (W - maxX * scale) / 2;
    const y0 = (H - maxY * scale) / 2;
    const aw = a * scale;
    const bh = b * scale;
    const cw = c * scale;
    const dw = d * scale;
    const dPath = [
      `M ${x0} ${y0}`,
      `h ${aw}`,
      `v ${cw}`,
      `h ${-(aw - dw)}`,
      `v ${bh - cw}`,
      `h ${-dw}`,
      `Z`,
    ].join(" ");
    return {
      d: dPath,
      labels: [
        { key: "a", x: x0 + aw / 2, y: y0 - 6, value: a },
        { key: "b", x: x0 - 12, y: y0 + bh / 2 + 4, value: b },
        { key: "c", x: x0 + aw + 12, y: y0 + cw / 2 + 4, value: c },
        { key: "d", x: x0 + dw / 2, y: y0 + bh + 14, value: d },
      ],
    };
  }

  if (shape === "u") {
    const maxX = a;
    const maxY = b;
    const scale = Math.min((W - pad * 2) / maxX, (H - pad * 2) / maxY);
    const x0 = (W - maxX * scale) / 2;
    const y0 = (H - maxY * scale) / 2;
    const aw = a * scale;
    const bh = b * scale;
    const ch = c * scale;
    const dw = d * scale;
    const dPath = [
      `M ${x0} ${y0}`,
      `h ${dw}`,
      `v ${bh - ch}`,
      `h ${aw - 2 * dw}`,
      `v ${-(bh - ch)}`,
      `h ${dw}`,
      `v ${bh}`,
      `h ${-aw}`,
      `Z`,
    ].join(" ");
    return {
      d: dPath,
      labels: [
        { key: "a", x: x0 + aw / 2, y: y0 + bh + 14, value: a },
        { key: "b", x: x0 + aw + 12, y: y0 + bh / 2 + 4, value: b },
        { key: "c", x: x0 + aw / 2, y: y0 + (bh - ch) + ch / 2 + 4, value: c },
        { key: "d", x: x0 + dw / 2, y: y0 - 6, value: d },
      ],
    };
  }

  const scale = Math.min((W - pad * 2) / a, (H - pad * 2) / b);
  const w = a * scale;
  const h = b * scale;
  const rr = Math.min(r * scale, h * 0.45, w * 0.35);
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  const dPath = [
    `M ${x + rr} ${y}`,
    `H ${x + w - rr}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `V ${y + h - rr}`,
    `Q ${x + w} ${y + h} ${x + w - rr} ${y + h}`,
    `H ${x + rr}`,
    `Q ${x} ${y + h} ${x} ${y + h - rr}`,
    `V ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `Z`,
  ].join(" ");
  return {
    d: dPath,
    labels: [
      { key: "a", x: x + w / 2, y: y - 6, value: a },
      { key: "b", x: x + w + 14, y: y + h / 2 + 4, value: b },
      { key: "r", x: x + w * 0.82, y: y + h - 8, value: r },
    ],
  };
}

function DimChip({
  label,
  editing,
  draft,
  onStart,
  onDraft,
  onCommit,
  onCancel,
}: {
  label: Label;
  editing: boolean;
  draft: string;
  onStart: () => void;
  onDraft: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const left = `${(label.x / W) * 100}%`;
  const top = `${(label.y / H) * 100}%`;

  if (editing) {
    return (
      <div
        className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
        style={{ left, top }}
      >
        <div className="flex items-center gap-0.5 rounded-full border-2 border-forest bg-white px-1.5 py-0.5 shadow-sm">
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={draft}
            aria-label={`Maß ${label.key}`}
            onChange={(e) => onDraft(sanitizeDimInput(e.target.value))}
            onBlur={onCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommit();
              if (e.key === "Escape") onCancel();
            }}
            className="w-12 bg-transparent text-center text-xs font-bold tabular-nums text-forest outline-none"
          />
          <span className="pr-1 text-[10px] font-semibold text-gray-400">m</span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-forest/15 bg-white px-2.5 py-1 text-xs font-bold tabular-nums text-forest transition hover:border-lime hover:bg-lime"
      style={{ left, top }}
      title="Klicken zum Ändern"
    >
      {label.value.toLocaleString("de-DE", { maximumFractionDigits: 1 })} m
    </button>
  );
}

export function PlotCanvas({
  shape,
  dims,
  onDimChange,
  editable = false,
}: Props) {
  const active = shape ?? "quadrat";
  const resolved = {
    a: dims.a ?? 12,
    b: dims.b ?? 8,
    c: dims.c ?? 4,
    d: dims.d ?? 4,
    r: dims.r ?? 4,
  };
  const { d, labels } = pathFor(active, resolved);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startEdit(label: Label) {
    if (!editable || !onDimChange) return;
    setEditingKey(label.key);
    setDraft(formatDim(label.value));
  }

  function commit() {
    if (!editingKey || !onDimChange) {
      setEditingKey(null);
      return;
    }
    const fallback = resolved[editingKey as keyof typeof resolved] ?? 1;
    onDimChange(editingKey, commitDim(draft, fallback));
    setEditingKey(null);
  }

  function cancel() {
    setEditingKey(null);
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-gray-100 bg-mint/60 p-3">
      <div className="mb-1 flex items-center justify-between px-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
          Live-Plan
        </p>
        {editable && shape ? (
          <p className="text-[10px] text-gray-400">Maß antippen zum Ändern</p>
        ) : null}
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Grundriss Ihres Grundstücks"
        >
          <defs>
            <pattern
              id="grass"
              width="12"
              height="12"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1" fill="#0A9F86" opacity="0.15" />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="#EAFCF7" rx="16" />
          <path d={d} fill="url(#grass)" stroke="#0B2414" strokeWidth="2.5" />
          <path d={d} fill="#00FFCF" fillOpacity="0.18" stroke="none" />
        </svg>

        {shape
          ? labels.map((label) => (
              <DimChip
                key={label.key}
                label={label}
                editing={editingKey === label.key}
                draft={draft}
                onStart={() => startEdit(label)}
                onDraft={setDraft}
                onCommit={commit}
                onCancel={cancel}
              />
            ))
          : null}
      </div>

      {!shape ? (
        <p className="absolute inset-x-0 bottom-4 text-center text-xs text-gray-400">
          Form wählen – Plan erscheint live
        </p>
      ) : null}
    </div>
  );
}
