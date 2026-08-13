import type { Metadata } from "next";
import { Caveat, Plus_Jakarta_Sans } from "next/font/google";
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
    default: "RegnerWerk Konfigurator",
    template: "%s | RegnerWerk",
  },
  description:
    "Sofort-Bewässerungsplan: Garten auf der Karte öffnen, Flächen einzeichnen, Materialliste erhalten.",
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
      <body className="min-h-full font-sans text-forest">{children}</body>
    </html>
  );
}
