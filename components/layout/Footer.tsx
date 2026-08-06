"use client";

import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { nav, site } from "@/lib/content";

export function Footer() {
  return (
    <footer className="bg-forest-mid text-white">
      <Container className="py-16 lg:py-20">
        <div className="grid gap-10 rounded-3xl bg-forest px-6 py-10 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:px-10">
          <div>
            <h3 className="text-2xl font-bold tracking-tight lg:text-3xl">
              Updates zu smarter Bewässerung
            </h3>
            <p className="mt-3 max-w-md text-white/70 leading-relaxed">
              Tipps zu Wasserverbrauch, Saisonpflege und neuen Features – selten
              und relevant.
            </p>
          </div>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => e.preventDefault()}
          >
            <label className="sr-only" htmlFor="newsletter-email">
              E-Mail
            </label>
            <input
              id="newsletter-email"
              type="email"
              required
              placeholder="Ihre E-Mail"
              className="w-full flex-1 rounded-full border border-white/15 bg-white/10 px-5 py-3.5 text-white placeholder:text-white/40 focus:border-lime focus:outline-none focus:ring-2 focus:ring-lime/40"
            />
            <Button type="submit" variant="primary" className="shrink-0">
              Abonnieren
            </Button>
          </form>
        </div>

        <div className="mt-14 grid gap-10 border-t border-white/10 pt-12 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-lg font-bold">
              Regner<span className="text-lime">Werk</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/65">
              {site.tagline} Planung, Installation und Smart-Steuerung für
              Gärten in Deutschland.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-white/50">
              Navigation
            </p>
            <ul className="mt-4 space-y-2">
              {nav.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="text-sm text-white/80 hover:text-lime"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-white/50">
              Kontakt
            </p>
            <ul className="mt-4 space-y-2 text-sm text-white/80">
              <li>
                <a href={`tel:${site.phone.replace(/\s/g, "")}`}>
                  {site.phone}
                </a>
              </li>
              <li>
                <a href={`mailto:${site.email}`}>{site.email}</a>
              </li>
              <li>{site.address}</li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-white/50">
              Zeiten
            </p>
            <ul className="mt-4 space-y-2 text-sm text-white/80">
              <li>Mo–Fr: 08:00–18:00</li>
              <li>Sa: nach Vereinbarung</li>
              <li>So: geschlossen</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-8 text-sm text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} RegnerWerk. Alle Rechte vorbehalten.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white">
              Datenschutz
            </a>
            <a href="#" className="hover:text-white">
              Impressum
            </a>
          </div>
        </div>
      </Container>
    </footer>
  );
}
