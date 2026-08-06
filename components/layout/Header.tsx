"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { nav, site } from "@/lib/content";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/85 shadow-soft backdrop-blur-md"
          : "bg-transparent"
      }`}
    >
      <Container className="flex h-16 items-center justify-between lg:h-20">
        <Link
          href="/"
          className={`text-lg font-bold tracking-tight transition-colors ${
            scrolled ? "text-forest" : "text-white"
          }`}
        >
          Regner<span className="text-lime">Werk</span>
        </Link>

        <nav className="hidden items-center gap-8 lg:flex">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`text-sm font-medium transition-colors ${
                scrolled
                  ? "text-forest-mid hover:text-forest"
                  : "text-white/85 hover:text-white"
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-4 lg:flex">
          <a
            href={`tel:${site.phone.replace(/\s/g, "")}`}
            className={`text-sm font-medium ${
              scrolled ? "text-forest-mid" : "text-white/85"
            }`}
          >
            {site.phone}
          </a>
          <Button href="#beratung" variant="primary">
            Kostenlose Beratung
          </Button>
        </div>

        <button
          type="button"
          className={`lg:hidden rounded-full p-2 ${
            scrolled ? "text-forest" : "text-white"
          }`}
          aria-label={open ? "Menü schließen" : "Menü öffnen"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
            {open ? (
              <path
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                d="M6 6l12 12M18 6L6 18"
              />
            ) : (
              <path
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                d="M4 7h16M4 12h16M4 17h16"
              />
            )}
          </svg>
        </button>
      </Container>

      {open ? (
        <div className="border-t border-gray-100 bg-white lg:hidden">
          <Container className="flex flex-col gap-4 py-6">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-base font-medium text-forest"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <Button href="#beratung" variant="primary" className="w-full">
              Kostenlose Beratung
            </Button>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
