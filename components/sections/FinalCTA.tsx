import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { FadeIn } from "@/components/ui/FadeIn";

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-20 lg:py-28">
      <Image
        src="https://images.unsplash.com/photo-1466692476866-aef1dfb1e735?auto=format&fit=crop&w=1800&q=80"
        alt="Grüner Garten"
        fill
        className="object-cover"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-forest/80" />
      <Container className="relative">
        <FadeIn className="mx-auto max-w-2xl text-center">
          <h2 className="text-[clamp(1.75rem,3vw,2.75rem)] font-bold leading-tight tracking-tight text-white">
            Bereit für einen Garten, der sich selbst pflegt?
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            Starten Sie mit einer kostenlosen Beratung – wir zeigen Ihnen den
            klarsten Weg zur smarten Bewässerung.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="#beratung" variant="primary">
              Kostenlose Beratung
            </Button>
            <Button href="#leistungen" variant="ghost">
              Leistungen ansehen
            </Button>
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
