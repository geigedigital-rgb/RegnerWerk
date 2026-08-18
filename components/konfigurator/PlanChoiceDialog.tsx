"use client";

import { useEffect, useId } from "react";
import { Check, Sparkles, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

export type PlanChoice = "auto" | "pro";

type Props = {
  open: boolean;
  onChoose: (choice: PlanChoice) => void;
  onCancel: () => void;
};

export function PlanChoiceDialog({ open, onChoose, onCancel }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-[40] flex items-end justify-center bg-forest/45 p-3 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-2xl overflow-y-auto rounded-[1.5rem] bg-[#eef2f6] p-4 shadow-soft sm:rounded-[1.75rem] sm:p-8"
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

        <h2
          id={titleId}
          className="pr-10 text-xl font-bold tracking-tight text-forest sm:text-2xl"
        >
          Wie möchten Sie weiterplanen?
        </h2>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-gray-600">
          Beides ist kostenlos. Sofort selbst weiterrechnen – oder die Planung
          unserem Fachteam überlassen.
        </p>

        <div className="mt-4 grid gap-3 sm:mt-6 sm:grid-cols-2">
          <div className="flex flex-col rounded-2xl bg-white p-4 shadow-soft sm:p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#dbeafe] text-[#2563eb] sm:h-12 sm:w-12">
              <Sparkles size={24} strokeWidth={2} />
            </span>
            <h3 className="mt-4 text-base font-bold text-forest">
              Sofort-Berechnung
            </h3>
            <p className="mt-1.5 flex-1 text-sm leading-snug text-gray-500">
              Der Algorithmus setzt Regner und Leitungen auf Ihre Flächen – in
              Sekunden, frei editierbar.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-forest/80">
              {[
                "Ergebnis sofort sichtbar",
                "Regner & Leitungen anpassbar",
                "Später zur Fachplanung wechselbar",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check
                    size={16}
                    className="mt-0.5 shrink-0 text-aqua-deep"
                    strokeWidth={2.5}
                  />
                  {t}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="primary"
              className="mt-5 w-full !shadow-none"
              onClick={() => onChoose("auto")}
            >
              Automatisch berechnen
            </Button>
          </div>

          <div className="flex flex-col rounded-2xl bg-white p-4 shadow-soft sm:p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#e8f5e9] text-[#2e7d32] sm:h-12 sm:w-12">
              <UserRound size={24} strokeWidth={2} />
            </span>
            <h3 className="mt-4 text-base font-bold text-forest">
              Fachplanung
            </h3>
            <p className="mt-1.5 flex-1 text-sm leading-snug text-gray-500">
              Joshua Sachs und Team planen Regner, Leitungen und Material – für
              Bestellung und Einbau.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-forest/80">
              {[
                "In der Regel innerhalb von 48 Stunden",
                "Kostenfreies Beratungsgespräch",
                "Unverbindlich, ohne Kaufpflicht",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check
                    size={16}
                    className="mt-0.5 shrink-0 text-aqua-deep"
                    strokeWidth={2.5}
                  />
                  {t}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="dark"
              className="mt-5 w-full !shadow-none"
              onClick={() => onChoose("pro")}
            >
              Fachplanung anfragen
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
