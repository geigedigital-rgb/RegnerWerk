import Image from "next/image";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { processSteps } from "@/lib/content";

export function Process() {
  return (
    <section id="ablauf" className="bg-forest py-14 text-white lg:py-16">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="relative order-2 aspect-[4/5] overflow-hidden rounded-3xl sm:aspect-[5/6] lg:order-1 lg:aspect-auto lg:min-h-[480px]">
            <Image
              src="https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1000&q=80"
              alt="Professionelle Bewässerungsinstallation im Garten"
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-forest/50 via-transparent to-transparent" />
            <p className="absolute bottom-5 left-5 right-5 text-sm font-medium text-white/90">
              Vor Ort vermessen. Sauber installiert. Per App gesteuert.
            </p>
          </div>

          <div className="order-1 lg:order-2">
            <SectionHeader
              light
              align="left"
              eyebrow="Ablauf"
              title="Vier Schritte."
              accent="Klar."
              description="Von der Anfrage bis zum Smart Start – ohne Überraschungen."
            />

            <ol className="mt-8 space-y-0">
              {processSteps.map((step, i) => (
                <li
                  key={step.number}
                  className="relative grid grid-cols-[2.5rem_1fr] gap-x-4"
                >
                  <div className="flex flex-col items-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-lime text-sm font-bold text-forest">
                      {step.number}
                    </span>
                    {i < processSteps.length - 1 ? (
                      <span
                        className="mt-1 w-px flex-1 bg-white/20"
                        aria-hidden
                      />
                    ) : null}
                  </div>
                  <div
                    className={
                      i < processSteps.length - 1 ? "pb-6" : "pb-0"
                    }
                  >
                    <h3 className="pt-1.5 text-base font-semibold tracking-tight text-white">
                      {step.title}
                    </h3>
                    <p className="mt-1 text-sm leading-snug text-white/60">
                      {step.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Container>
    </section>
  );
}
