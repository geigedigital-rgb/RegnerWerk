import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { FadeIn } from "@/components/ui/FadeIn";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { testimonials } from "@/lib/content";

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-1" aria-label={`${rating} von 5 Sternen`}>
      {Array.from({ length: rating }).map((_, i) => (
        <svg key={i} width="16" height="16" viewBox="0 0 16 16" fill="#E8B84A">
          <path d="M8 1.2l1.76 3.56 3.93.57-2.84 2.77.67 3.9L8 10.16l-3.52 1.84.67-3.9L2.3 5.33l3.93-.57L8 1.2z" />
        </svg>
      ))}
    </div>
  );
}

export function Testimonials() {
  return (
    <section id="stimmen" className="bg-white py-20 lg:py-28">
      <Container>
        <FadeIn>
          <SectionHeader
            eyebrow="Stimmen"
            title="Was Kundinnen und Kunden sagen"
            description="Klarheit im Ablauf und Qualität im Ergebnis – das hören wir am häufigsten."
          />
        </FadeIn>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {testimonials.map((item, i) => (
            <FadeIn key={item.name} delay={i * 0.08}>
              <Card
                className={`flex h-full flex-col p-7 ${
                  i === 1 ? "ring-2 ring-lime/40" : ""
                }`}
              >
                <div className="flex items-start justify-between">
                  <span
                    className={`text-4xl font-serif leading-none ${
                      i === 1 ? "text-lime" : "text-gray-100"
                    }`}
                  >
                    “
                  </span>
                  <Stars rating={item.rating} />
                </div>
                <p className="mt-4 flex-1 text-sm leading-relaxed text-forest-mid">
                  {item.quote}
                </p>
                <div className="mt-6 flex items-center gap-3 border-t border-gray-100 pt-5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-mint text-sm font-semibold text-forest">
                    {item.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-forest">
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-600">{item.role}</p>
                  </div>
                </div>
              </Card>
            </FadeIn>
          ))}
        </div>
      </Container>
    </section>
  );
}
