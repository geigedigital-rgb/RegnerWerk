"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

const FULL_STEPS = [
  "Flächen prüfen",
  "Wasseranschluss einbeziehen",
  "Regner platzieren",
  "Leitungen legen",
  "Zonen ausgleichen",
  "Materialliste bauen",
] as const;

const BRAND_STEPS = [
  "Düsen wählen",
  "Wurfweiten anpassen",
  "Stückliste aktualisieren",
] as const;

type Props = {
  mode: "full" | "brand";
  brandLabel?: string;
  onFinished: () => void;
};

export function SofortCalcLoader({ mode, brandLabel, onFinished }: Props) {
  const steps = mode === "full" ? FULL_STEPS : BRAND_STEPS;
  const stepMs = mode === "full" ? 420 : 280;
  const [doneCount, setDoneCount] = useState(0);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    setDoneCount(0);
    let n = 0;
    let t = 0;
    const tick = () => {
      n += 1;
      setDoneCount(n);
      if (n >= steps.length) {
        t = window.setTimeout(() => onFinishedRef.current(), 180);
      } else {
        t = window.setTimeout(tick, stepMs);
      }
    };
    t = window.setTimeout(tick, stepMs);
    return () => window.clearTimeout(t);
  }, [mode, stepMs, steps.length]);

  if (mode === "brand") {
    const current = Math.min(doneCount, steps.length - 1);
    return (
      <div
        className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur-[2px]"
        role="status"
        aria-live="polite"
        aria-label="Variante wird berechnet"
      >
        <div className="mx-4 w-full max-w-[16rem] rounded-2xl border border-forest/10 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <Loader2 size={16} className="shrink-0 animate-spin text-aqua-deep" />
            <p className="text-sm font-semibold text-forest">
              {brandLabel ?? "Variante"} wird berechnet
            </p>
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {steps.map((label, i) => {
              const done = i < doneCount;
              const active = i === current && doneCount < steps.length;
              return (
                <li
                  key={label}
                  className={`flex items-center gap-2 text-xs ${
                    done
                      ? "text-forest"
                      : active
                        ? "font-medium text-forest"
                        : "text-forest/35"
                  }`}
                >
                  {done ? (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-lime text-forest">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  ) : (
                    <span
                      className={`h-4 w-4 rounded-full border ${
                        active
                          ? "border-aqua-deep bg-mint"
                          : "border-forest/15"
                      }`}
                    />
                  )}
                  {label}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  const current = Math.min(doneCount, steps.length - 1);

  return (
    <div
      className="absolute inset-0 z-[45] flex items-center justify-center bg-forest/50 p-4 backdrop-blur-[3px]"
      role="status"
      aria-live="polite"
      aria-label="Sofort-Berechnung läuft"
    >
      <div className="w-full max-w-sm rounded-[1.75rem] border border-white/15 bg-white p-6 shadow-soft sm:p-7">
        <p className="text-[0.8125rem] font-semibold uppercase tracking-[0.16em] text-aqua-deep">
          Sofort-Berechnung
        </p>
        <h2 className="mt-2 text-xl font-bold tracking-tight text-forest">
          Plan wird erstellt
        </h2>
        <p className="mt-1.5 text-sm leading-snug text-forest/55">
          Flächen, Wasser und Technik nacheinander – dann liegt der Entwurf vor.
        </p>
        <ul className="mt-5 space-y-2.5">
          {steps.map((label, i) => {
            const done = i < doneCount;
            const active = i === current && doneCount < steps.length;
            return (
              <li key={label} className="flex items-center gap-3">
                {done ? (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-lime text-forest">
                    <Check size={14} strokeWidth={2.75} />
                  </span>
                ) : active ? (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-aqua-deep bg-mint">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-aqua-deep" />
                  </span>
                ) : (
                  <span className="h-6 w-6 rounded-full border border-forest/12 bg-ice" />
                )}
                <span
                  className={`text-sm ${
                    done
                      ? "font-medium text-forest"
                      : active
                        ? "font-semibold text-forest"
                        : "text-forest/35"
                  }`}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
