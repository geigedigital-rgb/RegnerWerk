"use client";

import Image from "next/image";
import { formatEuro } from "@/lib/content";
import { kitItems, type ConfigState } from "@/lib/configurator";

type Props = {
  state: Pick<ConfigState, "shape" | "dims" | "control">;
};

export function KitContents({ state }: Props) {
  const items = kitItems(state);

  return (
    <div className="rounded-3xl border border-gray-100 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold tracking-tight text-forest">
            Das ist drin
          </h3>
          <p className="mt-0.5 text-xs text-gray-400">
            {items.length} Positionen
          </p>
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-snug text-gray-600">
        Passt sich live an Ihre Auswahl an — jedes Teil aufeinander abgestimmt,
        mit 5 Jahren Garantie.
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {items.map((item) => (
          <li
            key={item.id}
            className="overflow-hidden rounded-2xl border border-gray-100 bg-mint/30"
          >
            <div className="relative aspect-[4/3] bg-gray-50">
              <Image
                src={item.image}
                alt={item.name}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 50vw, 200px"
              />
            </div>
            <div className="p-3">
              <p className="truncate text-sm font-semibold text-forest">
                {item.name}
              </p>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-xs text-gray-400">{item.qty}</span>
                <span className="text-sm font-bold tabular-nums text-forest">
                  {formatEuro(Math.round(item.price))}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
