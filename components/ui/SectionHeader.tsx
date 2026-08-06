import type { ReactNode } from "react";

export function SectionHeader({
  eyebrow,
  title,
  accent,
  description,
  align = "center",
  light = false,
}: {
  eyebrow?: string;
  title: ReactNode;
  accent?: string;
  description?: string;
  align?: "center" | "left";
  light?: boolean;
}) {
  const alignClass = align === "center" ? "mx-auto text-center" : "text-left";
  const titleColor = light ? "text-white" : "text-forest";
  const descColor = light ? "text-white/70" : "text-gray-600";

  return (
    <div className={`max-w-2xl ${alignClass}`}>
      {eyebrow ? (
        <p
            className={`mb-3 text-sm font-semibold uppercase tracking-[0.14em] ${light ? "text-lime" : "text-aqua-deep"}`}
        >
          {eyebrow}
        </p>
      ) : null}
      <h2
        className={`text-[clamp(1.75rem,3vw,2.75rem)] font-bold leading-tight tracking-tight ${titleColor}`}
      >
        {title}
        {accent ? (
          <>
            {" "}
            <span className="font-accent text-[1.15em] font-medium text-lime">
              {accent}
            </span>
          </>
        ) : null}
      </h2>
      {description ? (
        <p className={`mt-4 text-base leading-relaxed ${descColor}`}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
