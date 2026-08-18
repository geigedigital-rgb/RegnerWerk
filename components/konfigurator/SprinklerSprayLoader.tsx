type Props = {
  size?: "sm" | "lg";
  className?: string;
  label?: string;
};

export function SprinklerSprayLoader({
  size = "lg",
  className = "",
  label = "Berechnung läuft",
}: Props) {
  const sm = size === "sm";

  return (
    <div
      className={`relative ${sm ? "h-10 w-10" : "h-16 w-16"} ${className}`}
      role="status"
      aria-label={label}
    >
      <svg viewBox="0 0 48 48" className="h-full w-full" aria-hidden>
        <circle
          cx="24"
          cy="24"
          r="18"
          fill="none"
          stroke="#0B2414"
          strokeOpacity="0.1"
          strokeWidth="3"
        />
        <g className="rw-spin">
          <circle
            cx="24"
            cy="24"
            r="18"
            fill="none"
            stroke="#00FFCF"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="28 85"
          />
        </g>
      </svg>
    </div>
  );
}
