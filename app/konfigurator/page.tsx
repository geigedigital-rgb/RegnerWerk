import type { Metadata } from "next";
import { MapConfigurator } from "@/components/konfigurator/MapConfigurator";

export const metadata: Metadata = {
  title: "Bewässerungsplan erstellen",
  description:
    "Kostenlos Ihren Garten auf der Karte öffnen und Flächen für die Bewässerung einzeichnen.",
};

export default function KonfiguratorPage() {
  return <MapConfigurator />;
}
