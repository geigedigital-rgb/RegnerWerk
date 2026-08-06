"use client";

import { Check } from "lucide-react";
import { STEPS } from "@/lib/configurator";

type Props = {
  step: number;
  onGo: (step: number) => void;
};

export function ConfigStepper({ step, onGo }: Props) {
  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  return (
    <div className="mb-8">
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-lime transition-all duration-300"
          style={{ width: `${Math.max(progress, step === 1 ? 12 : progress)}%` }}
        />
      </div>
      <ol className="grid grid-cols-3 gap-2">
        {STEPS.map((s) => {
          const done = s.id < step;
          const active = s.id === step;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => (done || active) && onGo(s.id)}
                disabled={!done && !active}
                className={`flex w-full items-center gap-1.5 rounded-full px-2 py-1.5 text-left text-xs font-semibold transition sm:gap-2 sm:px-3 sm:text-sm ${
                  active
                    ? "bg-forest text-white"
                    : done
                      ? "bg-mint text-forest hover:bg-lime/40"
                      : "bg-gray-50 text-gray-400"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                    active
                      ? "bg-lime text-forest"
                      : done
                        ? "bg-forest text-lime"
                        : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {done ? <Check size={12} strokeWidth={3} /> : s.id}
                </span>
                <span className="truncate">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
