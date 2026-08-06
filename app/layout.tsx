import type { Metadata } from "next";
import { Caveat, Plus_Jakarta_Sans } from "next/font/google";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "RegnerWerk – Intelligente Bewässerung",
    template: "%s | RegnerWerk",
  },
  description:
    "Planung, Installation und Smart-Steuerung von Bewässerungssystemen für Gärten in Deutschland. Klar, sparsam, unsichtbar.",
  openGraph: {
    title: "RegnerWerk – Intelligente Bewässerung",
    description:
      "Planung, Installation und Smart-Steuerung von Bewässerungssystemen für Gärten in Deutschland.",
    locale: "de_DE",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${plusJakarta.variable} ${caveat.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans text-forest">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
