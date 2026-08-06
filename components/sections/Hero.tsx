import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { FadeIn } from "@/components/ui/FadeIn";

export function Hero() {
  return (
    <section className="relative min-h-[100svh] overflow-hidden">
      <Image
        src="https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=2000&q=80"
        alt="Gepflegter Garten mit Bewässerung"
        fill
        priority
        className="object-cover"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-forest/90 via-forest/70 to-forest/40" />
      <div className="absolute inset-0 bg-gradient-to-t from-forest/50 via-transparent to-forest/30" />

      <Container className="relative flex min-h-[100svh] flex-col justify-center pb-20 pt-28">
        <FadeIn className="max-w-3xl">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-lime">
            RegnerWerk
          </p>
          <h1 className="text-[clamp(2.5rem,5.5vw,4.25rem)] font-light leading-[1.05] tracking-tight text-white">
            Intelligente Bewässerung.{" "}
            <span className="font-bold">Unsichtbar.</span>{" "}
            <span className="font-accent text-[1.12em] font-medium text-lime">
              Präzise.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/80">
            Planung, Installation und Smart-Steuerung für Gärten in Deutschland
            – klar strukturiert, sparsam mit Wasser, einfach zu bestellen.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button href="#beratung" variant="primary">
              Kostenlose Beratung
            </Button>
            <Button href="#ablauf" variant="ghost">
              So funktioniert&apos;s
            </Button>
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
