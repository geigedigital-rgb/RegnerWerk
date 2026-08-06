import { tickerItems } from "@/lib/content";

export function Ticker() {
  const items = [...tickerItems, ...tickerItems];

  return (
    <div className="overflow-hidden bg-lime py-3" aria-hidden="true">
      <div className="animate-marquee flex w-max gap-10 whitespace-nowrap">
        {items.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="text-sm font-semibold tracking-wide text-forest"
          >
            {item}
            <span className="ml-10 opacity-40">•</span>
          </span>
        ))}
      </div>
    </div>
  );
}
