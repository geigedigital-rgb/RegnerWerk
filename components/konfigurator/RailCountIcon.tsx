"use client";

import type { ReactNode } from "react";

/** Icon with a count badge in the corner — used on the left drawing rail. */
export function RailCountIcon({
  count,
  lit,
  children,
}: {
  count: number;
  /** Selected / armed row (lime or white) — badge inverts for contrast. */
  lit: boolean;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center">
      {children}
      {count > 0 ? (
        <span
          className={`absolute -right-1.5 -top-1.5 flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full px-0.5 text-[9px] font-bold leading-none tabular-nums ${
            lit
              ? "bg-forest text-lime ring-2 ring-white/80"
              : "bg-lime text-forest ring-2 ring-forest/40"
          }`}
        >
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </span>
  );
}
