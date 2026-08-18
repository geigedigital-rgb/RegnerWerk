"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { siteDatenschutzUrl } from "@/lib/consent";

export type PdfLeadPayload = {
  name: string;
  email: string;
  phone?: string;
};

type Props = {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onSubmit: (data: PdfLeadPayload) => void | Promise<void>;
  onCancel: () => void;
};

const fieldClass =
  "mt-1 w-full rounded-xl border border-white bg-white px-3.5 py-2.5 text-sm text-forest shadow-soft outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-lime/40";

export function PdfLeadDialog({
  open,
  busy = false,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocalErr(null);
    const id = window.setTimeout(() => nameRef.current?.focus(), 40);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (busy) return;
      onCancel();
    }
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, busy, onCancel]);

  if (!open || typeof document === "undefined") return null;

  const shownErr = localErr || error || null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!privacy) {
      setLocalErr("Bitte die Datenschutzerklärung bestätigen.");
      return;
    }
    setLocalErr(null);
    await onSubmit({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
    });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-forest/50 p-4 backdrop-blur-[3px]"
      role="presentation"
      onMouseDown={(e) => {
        if (busy) return;
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(e) => void handleSubmit(e)}
        className="relative w-full max-w-[22rem] overflow-hidden rounded-[1.5rem] bg-[#eef2f6] p-5 shadow-soft"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-forest/50 shadow-soft hover:text-forest disabled:opacity-40"
          aria-label="Schließen"
        >
          <X size={16} />
        </button>

        <h2
          id={titleId}
          className="pr-9 text-lg font-bold tracking-tight text-forest"
        >
          Plan als PDF
        </h2>
        <p className="mt-1 text-sm leading-snug text-gray-600">
          Name und E-Mail — dann startet der Download. Unverbindlich.
        </p>

        <div className="mt-4 space-y-2.5">
          <label className="block text-[0.8125rem] font-semibold text-forest">
            Name
            <input
              ref={nameRef}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldClass}
              autoComplete="name"
              placeholder="Vor- und Nachname"
            />
          </label>
          <label className="block text-[0.8125rem] font-semibold text-forest">
            E-Mail
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldClass}
              autoComplete="email"
              placeholder="name@email.de"
            />
          </label>
          <label className="block text-[0.8125rem] font-semibold text-forest">
            Telefon{" "}
            <span className="font-medium text-forest/40">(optional)</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={fieldClass}
              autoComplete="tel"
              placeholder="Für Rückfragen"
            />
          </label>
        </div>

        <label className="mt-3.5 flex cursor-pointer items-start gap-2.5 rounded-xl bg-white px-3 py-2.5">
          <input
            type="checkbox"
            required
            checked={privacy}
            onChange={(e) => {
              setPrivacy(e.target.checked);
              if (e.target.checked) setLocalErr(null);
            }}
            className="mt-0.5 h-4 w-4 shrink-0 accent-aqua-deep"
          />
          <span className="text-[0.8125rem] font-medium leading-snug text-forest">
            Ich willige in die Verarbeitung zur Anfrage und Kontaktaufnahme ein.
          </span>
        </label>
        <p className="mt-1.5 px-0.5 text-[11px] leading-snug text-forest/50">
          Kontakt auch durch Mitarbeitende oder KI-Systeme. Kein Vertrag.
          Widerruf: hallo@regnerwerk.de.{" "}
          <a
            href={siteDatenschutzUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-aqua-deep underline-offset-2 hover:underline"
          >
            Datenschutz
          </a>
        </p>

        {shownErr ? (
          <p className="mt-2 text-sm font-medium text-red-600">{shownErr}</p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          disabled={busy || !privacy}
          className="mt-4 w-full !shadow-none disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Download size={18} />
          )}
          {busy ? "PDF wird vorbereitet…" : "Senden und PDF laden"}
        </Button>
      </form>
    </div>,
    document.body,
  );
}
