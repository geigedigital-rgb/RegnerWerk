"use client";

import Image from "next/image";
import {
  CreditCard,
  Droplets,
  Shield,
  Star,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatEuro } from "@/lib/content";
import {
  approxArea,
  BASE_PRICE,
  CONTROLS,
  formatDelta,
  kitItems,
  SHAPES,
  type ConfigState,
} from "@/lib/configurator";

type Props = {
  state: ConfigState;
  total: number;
  mobile?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
};

export function ConfigSummary({
  state,
  total,
  mobile = false,
  expanded = true,
  onToggle,
}: Props) {
  const shape = SHAPES.find((s) => s.id === state.shape);
  const control = CONTROLS.find((c) => c.id === state.control);
  const area = Math.round(approxArea(state.shape, state.dims));
  const products = kitItems(state);

  const lines: { icon: LucideIcon; label: string; value: string }[] = [
    {
      icon: Droplets,
      label: "Basis-Paket",
      value: formatEuro(BASE_PRICE),
    },
  ];
  if (shape) {
    lines.push({
      icon: Droplets,
      label: shape.title,
      value: formatDelta(shape.delta),
    });
  }
  if (area > 0) {
    lines.push({
      icon: Droplets,
      label: `Fläche ~${area} m²`,
      value: area > 120 ? formatDelta(Math.round((area - 120) * 8)) : "inkl.",
    });
  }
  if (control) {
    lines.push({
      icon: Wifi,
      label: control.title,
      value: formatDelta(control.delta),
    });
  }

  return (
    <aside
      className={`rounded-3xl border border-gray-100 bg-white ${
        mobile ? "rounded-b-none border-b-0" : ""
      }`}
    >
      {mobile ? (
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between px-5 py-3"
        >
          <span className="text-sm text-gray-600">Zusammenfassung</span>
          <span className="text-xl font-bold tabular-nums text-forest">
            {formatEuro(total)}
          </span>
        </button>
      ) : null}

      {expanded ? (
        <div className={`space-y-4 p-5 ${mobile ? "pt-0" : ""}`}>
          {!mobile ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                Ihr Preis
              </p>
              <p className="mt-1 text-3xl font-bold tracking-tight text-forest tabular-nums">
                {formatEuro(total)}
              </p>
              <p className="text-xs text-gray-400">inkl. MwSt. · Richtwert</p>
            </div>
          ) : null}

          <ul className="space-y-2.5">
            {lines.map((line) => (
              <li
                key={line.label}
                className="flex items-center gap-3 text-sm text-forest-mid"
              >
                <line.icon
                  size={16}
                  className="shrink-0 text-aqua-deep"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="flex-1">{line.label}</span>
                <span className="font-semibold tabular-nums text-forest">
                  {line.value}
                </span>
              </li>
            ))}
          </ul>

          <div className="border-t border-gray-100 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
              Im Paket · {products.length} Positionen
            </p>
            <ul className="divide-y divide-gray-100">
              {products.map((item) => (
                <li key={item.id} className="flex items-center gap-2.5 py-2.5">
                  <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-mint">
                    <Image
                      src={item.image}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="36px"
                    />
                  </span>
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold text-forest">
                    {item.name}
                  </p>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-400">
                    {item.qty}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <Button
              href="/#beratung"
              variant="primary"
              className="w-full !shadow-none"
            >
              Paket anfragen · {formatEuro(total)}
            </Button>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-gray-400">
              <span className="inline-flex items-center gap-1">
                <Star size={12} className="text-gold" fill="#E8B84A" /> 4.9
              </span>
              <span className="inline-flex items-center gap-1">
                <Shield size={12} className="text-aqua-deep" /> 5 J. Garantie
              </span>
              <span className="inline-flex items-center gap-1">
                <CreditCard size={12} className="text-aqua-deep" /> Rechnung
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 border-t border-gray-100 px-5 py-3">
          <Button
            href="/#beratung"
            variant="primary"
            className="w-full !shadow-none"
          >
            Anfragen · {formatEuro(total)}
          </Button>
        </div>
      )}
    </aside>
  );
}
