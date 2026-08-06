import type { ReactNode } from "react";

export function IconCircle({
  children,
  className = "",
  tone = "lime",
}: {
  children: ReactNode;
  className?: string;
  tone?: "lime" | "mint" | "white";
}) {
  const tones = {
    lime: "bg-lime text-forest",
    mint: "bg-mint text-forest",
    white: "bg-white text-forest shadow-soft",
  };

  return (
    <span
      className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
