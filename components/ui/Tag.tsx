import type { ButtonHTMLAttributes, ReactNode } from "react";

type TagProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  soft?: boolean;
  children: ReactNode;
  className?: string;
};

export function Tag({
  active = false,
  soft = false,
  children,
  className = "",
  ...props
}: TagProps) {
  const base =
    "inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200";

  const tone = active
    ? "bg-lime text-forest"
    : soft
      ? "bg-white/15 text-white border border-white/20"
      : "bg-mint text-forest-mid hover:bg-gray-100";

  return (
    <button type="button" className={`${base} ${tone} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Pill({
  children,
  tone = "mint",
  className = "",
}: {
  children: ReactNode;
  tone?: "mint" | "lime" | "white" | "forest";
  className?: string;
}) {
  const tones = {
    mint: "bg-mint text-forest",
    lime: "bg-lime text-forest",
    white: "bg-white text-forest shadow-soft",
    forest: "bg-forest-mid text-white",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
