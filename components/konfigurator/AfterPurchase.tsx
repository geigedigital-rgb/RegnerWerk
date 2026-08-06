import {
  BookOpen,
  Droplets,
  Smartphone,
  Wrench,
} from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "@/components/ui/SectionHeader";

const tips = [
  {
    icon: BookOpen,
    title: "Lieferung prüfen",
    text: "Checkliste mit dem Paket – fehlende Teile melden Sie innerhalb von 48 Stunden.",
  },
  {
    icon: Wrench,
    title: "Installation",
    text: "Schritt-für-Schritt-Anleitung oder unseren Installationspartner – beides ist möglich.",
  },
  {
    icon: Smartphone,
    title: "App verbinden",
    text: "Controller koppeln, Zonen benennen, ersten Zeitplan in unter 10 Minuten setzen.",
  },
  {
    icon: Droplets,
    title: "Erster Lauf",
    text: "Testzyklus bei Tageslicht – Abdeckung prüfen, Düsen feinjustieren, fertig.",
  },
];

export function AfterPurchase() {
  return (
    <section id="nach-dem-kauf" className="bg-white py-16 lg:py-20">
      <Container>
        <SectionHeader
          eyebrow="Nach dem Kauf"
          title="Was Sie mit dem Paket tun"
          description="Kurze, klare Schritte – damit Ihr System vom Tag der Lieferung an zuverlässig läuft."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tips.map((tip) => (
            <article
              key={tip.title}
              className="rounded-3xl border border-gray-100 bg-mint/40 p-5"
            >
              <tip.icon
                className="text-aqua-deep"
                size={26}
                strokeWidth={1.75}
                aria-hidden
              />
              <h3 className="mt-4 text-base font-bold tracking-tight text-forest">
                {tip.title}
              </h3>
              <p className="mt-2 text-sm leading-snug text-gray-600">
                {tip.text}
              </p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
