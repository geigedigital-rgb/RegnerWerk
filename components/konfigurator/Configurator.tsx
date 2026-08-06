"use client";

import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfigStepper } from "@/components/konfigurator/ConfigStepper";
import { ConfigSummary } from "@/components/konfigurator/ConfigSummary";
import { PlotCanvas } from "@/components/konfigurator/PlotCanvas";
import { Container } from "@/components/ui/Container";
import {
  calcTotal,
  commitDim,
  CONTROLS,
  DIM_MAX,
  DIM_MIN,
  formatDelta,
  formatDim,
  sanitizeDimInput,
  SHAPES,
  type ConfigState,
  type Control,
  type PlotShape,
} from "@/lib/configurator";

function defaultDims(shape: PlotShape) {
  const entry = SHAPES.find((s) => s.id === shape)!;
  return Object.fromEntries(entry.sides.map((s) => [s.key, s.default]));
}

export function Configurator() {
  const [step, setStep] = useState(1);
  const [shape, setShape] = useState<PlotShape | null>(null);
  const [dims, setDims] = useState<Record<string, number>>({});
  const [control, setControl] = useState<Control | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dimDrafts, setDimDrafts] = useState<Record<string, string>>({});

  const state: ConfigState = { step, shape, dims, control };
  const total = useMemo(() => calcTotal(state), [shape, dims, control]);

  const shapeMeta = SHAPES.find((s) => s.id === shape);

  function pickShape(id: PlotShape) {
    const next = defaultDims(id);
    setShape(id);
    setDims(next);
    setDimDrafts(
      Object.fromEntries(
        Object.entries(next).map(([k, v]) => [k, formatDim(v)]),
      ),
    );
    setStep(2);
  }

  function setDim(key: string, value: number) {
    setDims((prev) => ({ ...prev, [key]: value }));
    setDimDrafts((prev) => ({ ...prev, [key]: formatDim(value) }));
  }

  function pickControl(id: Control) {
    setControl(id);
  }

  const stepPanel = (
    <div className="rounded-3xl border border-gray-100 bg-white p-5 sm:p-6">
      {step === 1 ? (
        <StepBlock title="Welche Form hat Ihre Fläche?">
          <div className="grid gap-3 sm:grid-cols-2">
            {SHAPES.map((s) => (
              <ChoiceCard
                key={s.id}
                title={s.title}
                detail={s.detail}
                delta={formatDelta(s.delta)}
                active={shape === s.id}
                onClick={() => pickShape(s.id)}
              />
            ))}
          </div>
        </StepBlock>
      ) : null}

      {step === 2 && shapeMeta ? (
        <StepBlock title="Maße in Metern">
          <p className="mb-3 text-xs text-gray-400">
            Oder direkt auf dem Plan antippen. {DIM_MIN}–{DIM_MAX} m.
          </p>
          <div
            className={`grid gap-2 ${
              shapeMeta.sides.length <= 2
                ? "grid-cols-2"
                : "grid-cols-2 sm:grid-cols-4"
            }`}
          >
            {shapeMeta.sides.map((side) => (
              <label
                key={side.key}
                className="rounded-2xl border border-gray-100 bg-mint/40 px-3 py-2"
              >
                <span className="block truncate text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {side.label}
                </span>
                <div className="mt-1 flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={
                      dimDrafts[side.key] ??
                      formatDim(dims[side.key] ?? side.default)
                    }
                    onChange={(e) => {
                      const next = sanitizeDimInput(e.target.value);
                      setDimDrafts((prev) => ({
                        ...prev,
                        [side.key]: next,
                      }));
                    }}
                    onBlur={() => {
                      const fallback = dims[side.key] ?? side.default;
                      const committed = commitDim(
                        dimDrafts[side.key] ?? String(fallback),
                        fallback,
                      );
                      setDim(side.key, committed);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-full bg-transparent text-base font-bold tabular-nums text-forest outline-none"
                    aria-label={side.label}
                  />
                  <span className="text-xs font-semibold text-gray-400">m</span>
                </div>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStep(3)}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-forest px-6 py-3 text-sm font-semibold text-white transition hover:bg-forest-mid"
          >
            Weiter zur Steuerung
            <ChevronRight size={16} />
          </button>
        </StepBlock>
      ) : null}

      {step === 3 ? (
        <StepBlock title="Welche Steuerung darf es sein?">
          <div className="grid gap-3">
            {CONTROLS.map((item) => (
              <ChoiceCard
                key={item.id}
                title={item.title}
                detail={item.detail}
                delta={formatDelta(item.delta)}
                active={control === item.id}
                onClick={() => pickControl(item.id)}
              />
            ))}
          </div>
          {control ? (
            <p className="mt-4 text-sm text-gray-600">
              Fertig – prüfen Sie den Preis und senden Sie die Anfrage.
            </p>
          ) : null}
        </StepBlock>
      ) : null}
    </div>
  );

  return (
    <section
      id="konfigurator"
      className="bg-mint/30 pb-28 pt-14 lg:pb-20 lg:pt-16"
    >
      <Container>
        <div className="mb-8 max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-aqua-deep">
            Konfigurator
          </p>
          <h2 className="mt-2 text-[clamp(1.75rem,3vw,2.5rem)] font-bold tracking-tight text-forest">
            Ihr Fertigpaket.{" "}
            <span className="font-accent text-[1.1em] font-medium text-aqua-deep">
              Live.
            </span>
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-600 sm:text-base">
            Form wählen, Maße eingeben – Plan und Inhalt passen sich sofort an.
          </p>
        </div>

        <ConfigStepper step={step} onGo={setStep} />

        <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-start lg:gap-8">
          <div className="space-y-5">
            <PlotCanvas
              shape={shape}
              dims={dims}
              editable={Boolean(shape)}
              onDimChange={setDim}
            />
            {stepPanel}
          </div>

          <div className="hidden lg:block">
            <div className="sticky top-24">
              <ConfigSummary state={state} total={total} />
            </div>
          </div>
        </div>
      </Container>

      <div className="fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto border-t border-gray-100 bg-white shadow-[0_-8px_30px_rgba(11,36,20,0.08)] lg:hidden">
        <ConfigSummary
          state={state}
          total={total}
          mobile
          expanded={sheetOpen}
          onToggle={() => setSheetOpen((v) => !v)}
        />
      </div>
    </section>
  );
}

function StepBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-lg font-bold tracking-tight text-forest">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function ChoiceCard({
  title,
  detail,
  delta,
  active,
  onClick,
}: {
  title: string;
  detail: string;
  delta: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-3xl border px-4 py-4 text-left transition ${
        active
          ? "border-forest bg-forest text-white"
          : "border-gray-100 bg-mint/30 text-forest hover:border-aqua-deep/40 hover:bg-mint"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold tracking-tight">{title}</p>
          <p
            className={`mt-1 text-sm leading-snug ${active ? "text-white/65" : "text-gray-600"}`}
          >
            {detail}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
            active ? "bg-lime text-forest" : "bg-white text-aqua-deep"
          }`}
        >
          {delta}
        </span>
      </div>
    </button>
  );
}
