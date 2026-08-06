import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { FadeIn } from "@/components/ui/FadeIn";
import { IconCircle } from "@/components/ui/IconCircle";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { services } from "@/lib/content";

export function Services() {
  return (
    <section id="leistungen" className="bg-mint py-20 lg:py-28">
      <Container>
        <FadeIn>
          <SectionHeader
            eyebrow="Leistungen"
            title="Alles für smarte Bewässerung"
            description="Von der ersten Messung bis zur App-Steuerung – ein System, ein Team, ein klarer Weg."
          />
        </FadeIn>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service, i) => (
            <FadeIn key={service.title} delay={i * 0.06}>
              <Card className="group flex h-full flex-col overflow-hidden">
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image
                    src={service.image}
                    alt={service.title}
                    fill
                    className="object-cover transition duration-500 group-hover:scale-105"
                    sizes="(max-width: 768px) 100vw, 25vw"
                  />
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <h3 className="text-lg font-semibold tracking-tight text-forest">
                    {service.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">
                    {service.description}
                  </p>
                  <div className="mt-5 flex items-center justify-between">
                    <a
                      href="#beratung"
                      className="text-sm font-semibold text-forest hover:text-aqua-deep"
                    >
                      Mehr erfahren
                    </a>
                    <IconCircle className="h-9 w-9">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M3 8h10M9 4l4 4-4 4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </IconCircle>
                  </div>
                </div>
              </Card>
            </FadeIn>
          ))}
        </div>

        <FadeIn className="mt-10 flex justify-center">
          <Button href="#beratung" variant="dark">
            Angebot anfragen
          </Button>
        </FadeIn>
      </Container>
    </section>
  );
}
