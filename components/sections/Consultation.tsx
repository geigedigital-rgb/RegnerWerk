"use client";

import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { FadeIn } from "@/components/ui/FadeIn";
import { FormField, FormTextarea } from "@/components/ui/FormField";
import { SectionHeader } from "@/components/ui/SectionHeader";

export function Consultation() {
  return (
    <section id="beratung" className="bg-mint py-20 lg:py-28">
      <Container>
        <div className="overflow-hidden rounded-[2rem] bg-forest px-6 py-12 shadow-soft sm:px-10 lg:px-14 lg:py-16">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <FadeIn>
              <SectionHeader
                light
                align="left"
                eyebrow="Beratung"
                title="Kostenlose Beratung"
                accent="anfragen"
                description="Erzählen Sie uns kurz von Ihrer Fläche – wir melden uns mit einem klaren Vorschlag."
              />
              <ul className="mt-8 space-y-3 text-sm text-white/70">
                <li className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                  Antwort innerhalb von 1–2 Werktagen
                </li>
                <li className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                  Unverbindlich und transparent
                </li>
                <li className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                  Für Privatgärten und kleinere Gewerbe
                </li>
              </ul>
            </FadeIn>

            <FadeIn delay={0.1}>
              <form
                className="space-y-4"
                onSubmit={(e) => e.preventDefault()}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    id="name"
                    label="Name"
                    name="name"
                    placeholder="Max Mustermann"
                    required
                  />
                  <FormField
                    id="plz"
                    label="PLZ / Ort"
                    name="plz"
                    placeholder="80331 München"
                    required
                  />
                </div>
                <FormField
                  id="area"
                  label="Fläche / Typ"
                  name="area"
                  placeholder="z. B. 280 m² Rasen + Beete"
                />
                <FormTextarea
                  id="message"
                  label="Nachricht"
                  name="message"
                  placeholder="Kurzbeschreibung Ihres Projekts…"
                  rows={4}
                />
                <Button type="submit" variant="primary" className="w-full sm:w-auto">
                  Anfrage senden
                </Button>
              </form>
            </FadeIn>
          </div>
        </div>
      </Container>
    </section>
  );
}
