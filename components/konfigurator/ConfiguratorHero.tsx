import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

export function ConfiguratorHero() {
  return (
    <section className="relative min-h-[70svh] overflow-hidden lg:min-h-[78svh]">
      <Image
        src="https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=2000&q=80"
        alt="Garten mit Bewässerung"
        fill
        priority
        className="object-cover"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-forest/92 via-forest/72 to-forest/35" />
      <div className="absolute inset-0 bg-gradient-to-t from-forest/45 via-transparent to-forest/25" />

      <Container className="relative flex min-h-[70svh] flex-col justify-center pb-16 pt-28 lg:min-h-[78svh]">
        <div className="max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-lime">
            Fertigpaket
          </p>
          <h1 className="text-[clamp(2.25rem,5vw,3.75rem)] font-light leading-[1.05] tracking-tight text-white">
            Konfigurieren.{" "}
            <span className="font-bold">Sehen.</span>{" "}
            <span className="font-accent text-[1.12em] font-medium text-lime">
              Bestellen.
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-white/80 sm:text-lg">
            Form und Maße Ihres Grundstücks – Plan und Paketinhalt aktualisieren
            sich live. In wenigen Schritten zum passenden Fertigpaket.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button href="#konfigurator" variant="primary">
              Konfigurator starten
            </Button>
            <Button href="#nach-dem-kauf" variant="ghost">
              Nach dem Kauf
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
