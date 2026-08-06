"use client";

import { useEffect, useId, useState } from "react";
import {
  Check,
  ChevronLeft,
  Cylinder,
  Droplets,
  Gauge,
  ShoppingCart,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  WASSERQUELLE_TYPES,
  type PumpeChoice,
  type WasserquelleMengeMode,
  type WasserquelleTypeId,
} from "@/lib/mapbox";

export type WasserquelleResult = {
  type: WasserquelleTypeId;
  menge?: WasserquelleMengeMode;
  /** m³/h — for later project calculations */
  wassermengeM3h?: number;
  zisternenpumpe?: PumpeChoice;
  brunnenpumpe?: PumpeChoice;
};

type Props = {
  open: boolean;
  onConfirm: (result: WasserquelleResult) => void;
  onCancel: () => void;
};

type Step =
  | "art"
  | "menge"
  | "mengeEingabe"
  | "eimerTest"
  | "zisternenpumpe"
  | "brunnenpumpe";

function parsePositiveNumber(raw: string): number | null {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Bucket test: (Liter / Sekunden) × 3,6 = m³/h */
function eimerTestM3h(liter: number, sekunden: number): number {
  return (liter / sekunden) * 3.6;
}

function formatM3hDe(n: number): string {
  return n.toLocaleString("de-DE", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

export function WasserquelleDialog({ open, onConfirm, onCancel }: Props) {
  const titleId = useId();
  const [step, setStep] = useState<Step>("art");
  const [value, setValue] = useState<WasserquelleTypeId | "">("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [m3hInput, setM3hInput] = useState("");
  const [eimerSekunden, setEimerSekunden] = useState("");
  const [eimerLiter, setEimerLiter] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep("art");
    setValue("");
    setMenuOpen(false);
    setM3hInput("");
    setEimerSekunden("");
    setEimerLiter("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (step === "mengeEingabe" || step === "eimerTest") {
        setStep("menge");
        return;
      }
      if (step !== "art") {
        setStep("art");
        return;
      }
      onCancel();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel, step]);

  if (!open) return null;

  const selectedLabel =
    WASSERQUELLE_TYPES.find((t) => t.id === value)?.label ?? "Bitte auswählen…";
  const parsedM3h = parsePositiveNumber(m3hInput);
  const parsedSekunden = parsePositiveNumber(eimerSekunden);
  const parsedLiter = parsePositiveNumber(eimerLiter);
  const eimerM3h =
    parsedSekunden != null && parsedLiter != null
      ? eimerTestM3h(parsedLiter, parsedSekunden)
      : null;

  function goNextFromArt() {
    if (!value) return;
    if (value === "leitungswasser") setStep("menge");
    else if (value === "zisterne") setStep("zisternenpumpe");
    else setStep("brunnenpumpe");
  }

  function pickMenge(menge: WasserquelleMengeMode) {
    if (!value) return;
    if (menge === "bekannt") {
      setM3hInput("");
      setStep("mengeEingabe");
      return;
    }
    setEimerSekunden("20");
    setEimerLiter("10");
    setStep("eimerTest");
  }

  function placeWithM3h() {
    if (!value || parsedM3h == null) return;
    onConfirm({
      type: value,
      menge: "bekannt",
      wassermengeM3h: parsedM3h,
    });
  }

  function placeWithEimerTest() {
    if (!value || eimerM3h == null) return;
    onConfirm({
      type: value,
      menge: "unbekannt",
      wassermengeM3h: Math.round(eimerM3h * 1000) / 1000,
    });
  }

  function pickZisternenpumpe(choice: PumpeChoice) {
    if (!value) return;
    onConfirm({ type: value, zisternenpumpe: choice });
  }

  function pickBrunnenpumpe(choice: PumpeChoice) {
    if (!value) return;
    onConfirm({ type: value, brunnenpumpe: choice });
  }

  const wide = step === "menge" || step === "zisternenpumpe" || step === "brunnenpumpe";
  const medium = step === "eimerTest";
  const narrowInput = step === "mengeEingabe";

  return (
    <div
      className="absolute inset-0 z-[40] flex items-center justify-center bg-forest/45 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full rounded-[1.75rem] bg-[#eef2f6] p-6 shadow-soft sm:p-8 ${
          narrowInput
            ? "max-w-md"
            : medium
              ? "max-w-lg"
              : wide
                ? "max-w-xl"
                : "max-w-md"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onCancel}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white text-forest/50 shadow-soft hover:text-forest"
          aria-label="Schließen"
        >
          <X size={18} />
        </button>

        {step === "art" ? (
          <>
            <h2
              id={titleId}
              className="pr-10 text-2xl font-bold tracking-tight text-forest"
            >
              Art der Wasserquelle
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Ihr Außenwasserhahn oder Ihre Pumpe – wählen Sie Ihre
              Wasserquelle aus.
            </p>

            <div className="mt-6">
              <span
                id={`${titleId}-field`}
                className="mb-2 block text-sm font-semibold text-forest"
              >
                Wasserquelle
              </span>
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={menuOpen}
                  aria-labelledby={`${titleId}-field`}
                  onClick={() => setMenuOpen((o) => !o)}
                  className="flex w-full items-center justify-between rounded-2xl border border-white bg-white px-4 py-3.5 text-left text-sm shadow-soft outline-none ring-lime/30 focus-visible:ring-2"
                >
                  <span
                    className={
                      value ? "font-medium text-forest" : "text-gray-400"
                    }
                  >
                    {selectedLabel}
                  </span>
                  <span className="text-gray-400" aria-hidden>
                    ▾
                  </span>
                </button>

                {menuOpen ? (
                  <ul
                    role="listbox"
                    className="absolute inset-x-0 top-[calc(100%+6px)] z-10 overflow-hidden rounded-2xl border border-gray-100 bg-white py-1 shadow-soft"
                  >
                    <li role="option" aria-selected={!value}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setValue("");
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-gray-400 hover:bg-mint/50"
                      >
                        <Check
                          size={16}
                          className={
                            !value ? "text-forest opacity-100" : "opacity-0"
                          }
                        />
                        Bitte auswählen…
                      </button>
                    </li>
                    {WASSERQUELLE_TYPES.map((t) => (
                      <li
                        key={t.id}
                        role="option"
                        aria-selected={value === t.id}
                      >
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setValue(t.id);
                            setMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-forest hover:bg-mint/50"
                        >
                          <Check
                            size={16}
                            className={
                              value === t.id
                                ? "text-forest opacity-100"
                                : "opacity-0"
                            }
                          />
                          {t.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                className="!shadow-none"
                onClick={onCancel}
              >
                Abbrechen
              </Button>
              <Button
                type="button"
                variant="primary"
                className="!shadow-none"
                disabled={!value}
                onClick={goNextFromArt}
              >
                Weiter
              </Button>
            </div>
          </>
        ) : null}

        {step === "menge" ? (
          <>
            <h2
              id={titleId}
              className="pr-10 text-2xl font-bold tracking-tight text-forest"
            >
              Wassermenge bestimmen
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Ist Ihnen die Wassermenge in m³/h bekannt?
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => pickMenge("unbekannt")}
                className="flex flex-col items-start gap-3 rounded-2xl bg-white p-5 text-left shadow-soft transition hover:ring-2 hover:ring-lime/50"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#dbeafe] text-[#2563eb]">
                  <Droplets size={28} strokeWidth={2} />
                </span>
                <span>
                  <span className="block text-base font-bold text-forest">
                    Unbekannt
                  </span>
                  <span className="mt-1 block text-sm leading-snug text-gray-500">
                    Mithilfe des Eimertests schnell &amp; einfach bestimmen
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => pickMenge("bekannt")}
                className="flex flex-col items-start gap-3 rounded-2xl bg-white p-5 text-left shadow-soft transition hover:ring-2 hover:ring-lime/50"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e0e7ff] text-[#4f46e5]">
                  <Gauge size={28} strokeWidth={2} />
                </span>
                <span>
                  <span className="block text-base font-bold text-forest">
                    Bekannt
                  </span>
                  <span className="mt-1 block text-sm leading-snug text-gray-500">
                    Exakte Angabe der Wassermenge in m³/h
                  </span>
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setStep("art")}
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-forest/70 hover:text-forest"
            >
              <ChevronLeft size={16} />
              Wasserquelle ändern
            </button>
          </>
        ) : null}

        {step === "mengeEingabe" ? (
          <>
            <h2
              id={titleId}
              className="pr-10 text-2xl font-bold tracking-tight text-forest"
            >
              Wassermenge eingeben
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Geben Sie Ihre Wassermenge in m³/h ein.
            </p>

            <label className="mt-6 block">
              <span className="mb-2 block text-sm font-semibold text-forest">
                Wassermenge in m³/h
              </span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="z.B. 2,3"
                value={m3hInput}
                onChange={(e) => setM3hInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && parsedM3h != null) {
                    e.preventDefault();
                    placeWithM3h();
                  }
                }}
                className="w-full rounded-2xl border border-white bg-white px-4 py-3.5 text-sm text-forest shadow-soft outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-lime/40"
                autoFocus
              />
            </label>

            <Button
              type="button"
              variant="primary"
              className="mt-5 w-full !shadow-none disabled:bg-gray-400 disabled:text-white disabled:opacity-100"
              disabled={parsedM3h == null}
              onClick={placeWithM3h}
            >
              Platzieren
            </Button>

            <button
              type="button"
              onClick={() => setStep("menge")}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-forest/70 hover:text-forest"
            >
              <ChevronLeft size={16} />
              Zurück
            </button>
          </>
        ) : null}

        {step === "eimerTest" ? (
          <>
            <h2
              id={titleId}
              className="pr-10 text-2xl font-bold tracking-tight text-forest"
            >
              Eimer-Test
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Messen Sie kinderleicht &amp; schnell die Wassermenge.
            </p>
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm leading-snug text-gray-600">
              <li>Eimer unter den Hahn oder Auslauf stellen.</li>
              <li>Hahn voll aufdrehen und gleichzeitig die Zeit stoppen.</li>
              <li>
                Wenn der Eimer voll ist (oder nach einer festen Zeit), Sekunden
                und Liter eintragen.
              </li>
            </ol>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-forest">
                  Messdauer in Sekunden
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="20"
                  value={eimerSekunden}
                  onChange={(e) => setEimerSekunden(e.target.value)}
                  className="w-full rounded-2xl border border-white bg-white px-4 py-3.5 text-sm text-forest shadow-soft outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-lime/40"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-forest">
                  Menge in Litern
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="10"
                  value={eimerLiter}
                  onChange={(e) => setEimerLiter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && eimerM3h != null) {
                      e.preventDefault();
                      placeWithEimerTest();
                    }
                  }}
                  className="w-full rounded-2xl border border-white bg-white px-4 py-3.5 text-sm text-forest shadow-soft outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-lime/40"
                />
              </label>
            </div>

            <div className="mt-4 rounded-2xl bg-white px-4 py-4 shadow-soft">
              <p className="text-sm font-semibold text-forest">
                Berechnete Wassermenge (m³/h)
              </p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-forest">
                {eimerM3h != null ? formatM3hDe(eimerM3h) : "—"}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Formel: Liter ÷ Sekunden × 3,6
              </p>
            </div>

            <Button
              type="button"
              variant="primary"
              className="mt-5 w-full !shadow-none disabled:bg-gray-400 disabled:text-white disabled:opacity-100"
              disabled={eimerM3h == null}
              onClick={placeWithEimerTest}
            >
              Platzieren
            </Button>

            <button
              type="button"
              onClick={() => setStep("menge")}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-forest/70 hover:text-forest"
            >
              <ChevronLeft size={16} />
              Zurück
            </button>
          </>
        ) : null}

        {step === "zisternenpumpe" ? (
          <>
            <h2
              id={titleId}
              className="pr-10 text-2xl font-bold tracking-tight text-forest"
            >
              Zisternenpumpe
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Benötigen Sie eine Zisternenpumpe oder haben Sie bereits eine
              verbaut?
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => pickZisternenpumpe("kaufen")}
                className="flex flex-col items-start gap-3 rounded-2xl bg-white p-5 text-left shadow-soft transition hover:ring-2 hover:ring-lime/50"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#dbeafe] text-[#2563eb]">
                  <ShoppingCart size={28} strokeWidth={2} />
                </span>
                <span>
                  <span className="block text-base font-bold text-forest">
                    Zisternenpumpe kaufen
                  </span>
                  <span className="mt-1 block text-sm leading-snug text-gray-500">
                    Die Wassermenge wird automatisch berechnet
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => pickZisternenpumpe("vorhanden")}
                className="flex flex-col items-start gap-3 rounded-2xl bg-white p-5 text-left shadow-soft transition hover:ring-2 hover:ring-lime/50"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e5e7eb] text-[#4b5563]">
                  <Cylinder size={28} strokeWidth={2} />
                </span>
                <span>
                  <span className="block text-base font-bold text-forest">
                    Ich habe bereits eine Zisternenpumpe
                  </span>
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setStep("art")}
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-forest/70 hover:text-forest"
            >
              <ChevronLeft size={16} />
              Wasserquelle ändern
            </button>
          </>
        ) : null}

        {step === "brunnenpumpe" ? (
          <>
            <h2
              id={titleId}
              className="pr-10 text-2xl font-bold tracking-tight text-forest"
            >
              Brunnenpumpe
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Benötigen Sie eine Brunnenpumpe oder haben Sie bereits eine
              verbaut?
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => pickBrunnenpumpe("kaufen")}
                className="flex flex-col items-start gap-3 rounded-2xl bg-white p-5 text-left shadow-soft transition hover:ring-2 hover:ring-lime/50"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#dbeafe] text-[#2563eb]">
                  <ShoppingCart size={28} strokeWidth={2} />
                </span>
                <span>
                  <span className="block text-base font-bold text-forest">
                    Brunnenpumpe kaufen
                  </span>
                  <span className="mt-1 block text-sm leading-snug text-gray-500">
                    Die Wassermenge wird automatisch berechnet
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => pickBrunnenpumpe("vorhanden")}
                className="flex flex-col items-start gap-3 rounded-2xl bg-white p-5 text-left shadow-soft transition hover:ring-2 hover:ring-lime/50"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#dbeafe] text-[#2563eb]">
                  <Cylinder size={28} strokeWidth={2} />
                </span>
                <span>
                  <span className="block text-base font-bold text-forest">
                    Bereits vorhanden
                  </span>
                  <span className="mt-1 block text-sm leading-snug text-gray-500">
                    Bitte auswählen, wenn Sie bereits einen Brunnen &amp; Pumpe
                    verbaut haben
                  </span>
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setStep("art")}
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-forest/70 hover:text-forest"
            >
              <ChevronLeft size={16} />
              Wasserquelle ändern
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
