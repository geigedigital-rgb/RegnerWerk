import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { FadeIn } from "@/components/ui/FadeIn";
import { IconCircle } from "@/components/ui/IconCircle";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { site, usps } from "@/lib/content";

export function Why() {
  return (
    <section className="bg-white py-20 lg:py-28">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <FadeIn className="relative">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] sm:aspect-[5/6]">
              <Image
                src="https://images.unsplash.com/photo-1592419044706-39796d40f98c?auto=format&fit=crop&w=1000&q=80"
                alt="Bewässerungssystem im Garten"
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
            <div className="absolute bottom-6 left-6 right-6 rounded-3xl bg-white p-5 shadow-soft sm:left-auto sm:right-6 sm:w-72">
              <p className="text-sm text-gray-600">Direkt sprechen</p>
              <a
                href={`tel:${site.phone.replace(/\s/g, "")}`}
                className="mt-2 inline-flex rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-forest"
              >
                {site.phone}
              </a>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <SectionHeader
              align="left"
              eyebrow="Warum RegnerWerk"
              title="Besser durch Klarheit"
              accent="& Präzision"
              description="Wir verkaufen keine Schläuche – wir liefern ein ruhiges, smartes System, das Wasser spart und Ihren Alltag entlastet."
            />

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {usps.map((usp) => (
                <div
                  key={usp.title}
                  className="rounded-3xl border border-gray-100 bg-mint/60 p-5"
                >
                  <IconCircle tone="lime" className="h-10 w-10">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <path
                        d="M4 9.5l3 3 7-7"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </IconCircle>
                  <h3 className="mt-4 font-semibold tracking-tight text-forest">
                    {usp.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    {usp.description}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-8">
              <Button href="#beratung" variant="primary">
                Kostenlose Beratung
              </Button>
            </div>
          </FadeIn>
        </div>
      </Container>
    </section>
  );
}
