"use client";

import Image from "next/image";
import {
  Droplets,
  Leaf,
  Map,
  Package,
  Radar,
  Shield,
  Smartphone,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { FadeIn } from "@/components/ui/FadeIn";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { formatEuro, packages } from "@/lib/content";

const fertigIcons: Record<string, LucideIcon> = {
  package: Package,
  smartphone: Smartphone,
  shield: Shield,
  zap: Zap,
};

const individualIcons: Record<string, LucideIcon> = {
  droplets: Droplets,
  radar: Radar,
  map: Map,
  leaf: Leaf,
};

export function Packages() {
  const fertig = packages.fertig;
  const individuell = packages.individuell;

  return (
    <section id="pakete" className="bg-mint/40 py-16 lg:py-20">
      <Container>
        <FadeIn>
          <SectionHeader
            eyebrow="Pakete"
            title="Wählen. Preis sehen."
            accent="Anfragen."
            description="Fertigpaket im Konfigurator – oder individuelle Planung für optimalen Wasserverbrauch."
          />
        </FadeIn>

        <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-2">
          <FadeIn className="h-full">
            <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white">
              <div className="relative aspect-[16/9] shrink-0 overflow-hidden bg-gray-50">
                <Image
                  src={fertig.image}
                  alt={fertig.imageAlt}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
                <span className="absolute left-4 top-4 rounded-full bg-white px-3 py-1 text-xs font-semibold text-forest">
                  {fertig.badge}
                </span>
              </div>

              <div className="flex flex-1 flex-col p-5 sm:p-6">
                <h3 className="text-xl font-bold tracking-tight text-forest">
                  {fertig.title}
                </h3>
                <p className="mt-1.5 text-sm leading-snug text-gray-600">
                  {fertig.description}
                </p>

                <ul className="mt-5 grid grid-cols-2 gap-2.5">
                  {fertig.advantages.map((item) => {
                    const Icon = fertigIcons[item.icon];
                    return (
                      <li
                        key={item.label}
                        className="flex items-center gap-2.5 rounded-2xl border border-gray-100 bg-mint/50 px-3 py-2.5"
                      >
                        {Icon ? (
                          <Icon
                            className="shrink-0 text-aqua-deep"
                            size={18}
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        ) : null}
                        <span className="text-xs font-semibold text-forest">
                          {item.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-5 border-t border-gray-100 pt-4">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                    Preis
                  </p>
                  <p className="mt-0.5 text-3xl font-bold tracking-tight text-forest tabular-nums">
                    <span className="mr-1 text-base font-semibold text-gray-400">
                      ab
                    </span>
                    {formatEuro(fertig.priceFrom)}
                  </p>
                  <p className="text-xs text-gray-400">
                    im Konfigurator nach Form & Maßen
                  </p>
                </div>

                <div className="mt-auto pt-5">
                  <Button
                    href={fertig.href}
                    variant="primary"
                    className="w-full !shadow-none"
                  >
                    {fertig.cta}
                  </Button>
                </div>
              </div>
            </article>
          </FadeIn>

          <FadeIn delay={0.06} className="h-full">
            <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-forest bg-forest text-white">
              <div className="relative aspect-[16/9] shrink-0 overflow-hidden">
                <Image
                  src={individuell.image}
                  alt={individuell.imageAlt}
                  fill
                  className="object-cover opacity-75"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-forest via-forest/40 to-transparent" />
                <span className="absolute left-4 top-4 rounded-full bg-lime px-3 py-1 text-xs font-semibold text-forest">
                  {individuell.badge}
                </span>
              </div>

              <div className="flex flex-1 flex-col p-5 sm:p-6">
                <h3 className="text-xl font-bold tracking-tight text-white">
                  {individuell.title}
                </h3>
                <p className="mt-1.5 text-sm leading-snug text-white/70">
                  {individuell.description}
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  {individuell.advantages.map((item) => {
                    const Icon = individualIcons[item.icon];
                    return (
                      <div
                        key={item.title}
                        className="rounded-2xl border border-white/10 bg-white/5 p-3.5"
                      >
                        {Icon ? (
                          <Icon
                            className="mb-2.5 text-lime"
                            size={28}
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        ) : null}
                        <p className="text-sm font-semibold leading-snug text-white">
                          {item.title}
                        </p>
                        <p className="mt-1 text-xs leading-snug text-white/55">
                          {item.detail}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 border-t border-white/10 pt-4">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-white/45">
                    Preis
                  </p>
                  <p className="mt-0.5 text-3xl font-bold tracking-tight text-white tabular-nums">
                    <span className="mr-1 text-base font-semibold text-lime">
                      ab
                    </span>
                    {formatEuro(individuell.priceFrom)}
                  </p>
                  <p className="text-xs text-white/45">
                    mind. wie Fertigpaket · nach Analyse
                  </p>
                </div>

                <div className="mt-auto pt-5">
                  <Button
                    href={individuell.href}
                    variant="primary"
                    className="w-full !shadow-none"
                  >
                    {individuell.cta} · ab {formatEuro(individuell.priceFrom)}
                  </Button>
                </div>
              </div>
            </article>
          </FadeIn>
        </div>
      </Container>
    </section>
  );
}
