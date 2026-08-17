"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ChevronDown,
  Download,
  Droplets,
  Loader2,
  X,
} from "lucide-react";
import type { FixtureKind, PlotFixture } from "@/lib/mapbox";
import { type BomLine, type SofortPlan } from "@/lib/planner";
import { siteDatenschutzUrl } from "@/lib/consent";

type Props = {
  plan: SofortPlan;
  fixtures?: PlotFixture[];
  selectedHeadId?: string | null;
  selectedFixtureId?: string | null;
  onSelectHead?: (id: string | null) => void;
  onSelectFixture?: (id: string | null) => void;
  isCanvas?: boolean;
  serverProjectId?: string | null;
  onSubmitEmail?: (data: {
    name: string;
    email: string;
    phone?: string;
    privacyAccepted: true;
  }) => Promise<void>;
  onDownloadPdf?: () => Promise<void>;
  onChangeBrand?: (brand: "hunter" | "rainbird") => void;
};

const GROUP_LABELS: Record<BomLine["group"], string> = {
  regner: "Regner",
  rohr: "Rohr & Leitungen",
  ventile: "Ventile & Verteiler",
  steuerung: "Steuerung",
  quelle: "Wasserquelle",
  tropf: "Tropfbewässerung",
};

const GROUP_ORDER: BomLine["group"][] = [
  "regner",
  "rohr",
  "ventile",
  "steuerung",
  "quelle",
  "tropf",
];

function euro(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function fixtureIdForKind(
  fixtures: PlotFixture[],
  kind: FixtureKind,
): string | null {
  return fixtures.find((f) => f.kind === kind)?.id ?? null;
}

export function SofortPanel({
  plan,
  fixtures = [],
  selectedHeadId = null,
  selectedFixtureId = null,
  onSelectHead,
  onSelectFixture,
  isCanvas = false,
  serverProjectId = null,
  onSubmitEmail,
  onDownloadPdf,
  onChangeBrand,
}: Props) {
  const presentGroups = GROUP_ORDER.filter((g) =>
    plan.bom.some((l) => l.group === g),
  );
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(presentGroups.slice(0, 1)),
  );
  const [emailOpen, setEmailOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [leadDone, setLeadDone] = useState(false);
  const [busy, setBusy] = useState<"email" | "pdf" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const brand = plan.brand ?? "hunter";

  function toggle(g: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  function onMaterialClick(line: BomLine) {
    if (line.headIds?.length && onSelectHead) {
      onSelectFixture?.(null);
      const pick =
        selectedHeadId && line.headIds.includes(selectedHeadId)
          ? line.headIds[
              (line.headIds.indexOf(selectedHeadId) + 1) % line.headIds.length
            ]
          : line.headIds[0];
      onSelectHead(pick);
      return;
    }
    if (line.linkFixtureKind && onSelectFixture) {
      onSelectHead?.(null);
      const id = fixtureIdForKind(fixtures, line.linkFixtureKind);
      onSelectFixture(id);
    }
  }

  async function handleLeadThenPdf(e: React.FormEvent) {
    e.preventDefault();
    if (!onSubmitEmail || !onDownloadPdf) return;
    if (!privacy) {
      setErr("Bitte die Datenschutzerklärung bestätigen.");
      return;
    }
    setBusy("pdf");
    setErr(null);
    try {
      await onSubmitEmail({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        privacyAccepted: true,
      });
      await onDownloadPdf();
      setLeadDone(true);
      setEmailOpen(false);
      setFlash("PDF wird heruntergeladen…");
      setTimeout(() => setFlash(null), 3000);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Senden fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  }

  async function handlePdf() {
    if (!onDownloadPdf) return;
    if (onSubmitEmail && !leadDone) {
      setEmailOpen(true);
      setErr(null);
      return;
    }
    setBusy("pdf");
    setErr(null);
    try {
      await onDownloadPdf();
      setFlash("PDF wird heruntergeladen…");
      setTimeout(() => setFlash(null), 3000);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "PDF fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={`pointer-events-auto relative flex max-h-[min(70vh,36rem)] flex-col overflow-hidden rounded-2xl border border-forest/10 bg-white shadow-sm ${
        isCanvas ? "bg-white/95" : ""
      }`}
      onWheel={(e) => {
        if (e.ctrlKey) e.preventDefault();
      }}
    >
      <div className="border-b border-forest/8 px-4 py-3">
        <div className="flex items-center gap-2">
          <Droplets size={16} className="text-aqua-deep" />
          <h2 className="text-sm font-bold text-forest">Sofort-Berechnung</h2>
        </div>
        <p className="mt-1 text-[11px] text-forest/45">
          {Math.round(plan.lawnAreaM2)} m² · {plan.heads.length} Regner ·{" "}
          {Math.round(plan.coveragePct)} % Abdeckung
          {plan.projectLevel ? ` · ${plan.projectLevel}` : ""}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {onChangeBrand ? (
            <div
              className="inline-flex rounded-xl border border-forest/10 bg-mint/30 p-0.5"
              role="group"
              aria-label="Regner-Marke"
            >
              {(
                [
                  ["hunter", "Hunter"],
                  ["rainbird", "Rain Bird"],
                ] as const
              ).map(([id, label]) => {
                const active = brand === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onChangeBrand(id)}
                    className={`rounded-[10px] px-2.5 py-1 text-[11px] font-semibold transition ${
                      active
                        ? "bg-forest text-lime"
                        : "text-forest/55 hover:text-forest"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {plan.zoneDecisions?.[0]?.explanation ? (
          <p className="mt-2 text-[11px] leading-snug text-forest/55">
            {plan.zoneDecisions[0].explanation}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* Material groups — unchanged structure below */}
        <div className="space-y-2">
          {presentGroups.map((g) => {
            const lines = plan.bom.filter((l) => l.group === g);
            const open = openGroups.has(g);
            const groupTotal = lines.reduce(
              (s, l) => s + (l.totalEur ?? 0),
              0,
            );
            return (
              <div
                key={g}
                className="overflow-hidden rounded-xl border border-forest/8"
              >
                <button
                  type="button"
                  onClick={() => toggle(g)}
                  className="flex w-full items-center gap-2 bg-mint/40 px-3 py-2 text-left"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-forest/40"
                  />
                  <span className="flex-1 text-xs font-semibold text-forest">
                    {GROUP_LABELS[g]}
                  </span>
                  <span className="text-[10px] tabular-nums text-forest/45">
                    {euro(groupTotal)}
                  </span>
                  <ChevronDown
                    size={14}
                    className={`text-forest/40 transition ${open ? "rotate-180" : ""}`}
                  />
                </button>
                {open ? (
                  <ul className="divide-y divide-forest/5">
                    {lines.map((l) => {
                      const clickable =
                        Boolean(l.headIds?.length) ||
                        Boolean(l.linkFixtureKind);
                      const active =
                        (l.headIds?.length &&
                          selectedHeadId &&
                          l.headIds.includes(selectedHeadId)) ||
                        (l.linkFixtureKind &&
                          selectedFixtureId &&
                          fixtureIdForKind(fixtures, l.linkFixtureKind) ===
                            selectedFixtureId);
                      return (
                        <li key={l.key}>
                          <button
                            type="button"
                            disabled={!clickable}
                            onClick={() => onMaterialClick(l)}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                              clickable ? "hover:bg-mint/50" : ""
                            } ${active ? "bg-lime/15" : ""}`}
                          >
                            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-mint/60">
                              {l.imageUrl ? (
                                <Image
                                  src={l.imageUrl}
                                  alt=""
                                  fill
                                  className="object-contain p-0.5"
                                  sizes="44px"
                                  unoptimized
                                />
                              ) : (
                                <span className="flex h-full items-center justify-center text-[9px] text-forest/30">
                                  —
                                </span>
                              )}
                            </div>
                            <span className="min-w-0 flex-1">
                              <span className="font-semibold text-forest">
                                {l.qty}
                                {l.unit === "meter" ? " m" : "×"}{" "}
                              </span>
                              <span className="text-forest/80">{l.label}</span>
                              {l.note ? (
                                <span className="mt-0.5 block text-[10px] text-forest/40">
                                  {l.note}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 tabular-nums text-forest/60">
                              {l.totalEur == null ? (
                                <span className="text-forest/35">a. A.</span>
                              ) : (
                                euro(l.totalEur)
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-forest/8 bg-mint/40 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-forest/45">
            Material gesamt
          </p>
          <p className="text-lg font-bold text-forest">
            {plan.hasUnknownPrices ? "ab " : ""}
            {euro(plan.totalKnownEur)}
          </p>
        </div>

        {(onSubmitEmail || onDownloadPdf) && (
          <div className="mt-3 flex flex-col gap-2">
            {onDownloadPdf ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void handlePdf()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-3 py-2.5 text-xs font-semibold text-white hover:bg-forest/90 disabled:opacity-50"
              >
                {busy === "pdf" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} className="text-lime" />
                )}
                PDF kostenlos
              </button>
            ) : null}
            {serverProjectId ? (
              <p className="text-center font-mono text-[9px] text-forest/35">
                ID {serverProjectId.slice(0, 8)}…
              </p>
            ) : null}
            {flash ? (
              <p className="text-center text-[11px] font-medium text-aqua-deep">
                {flash}
              </p>
            ) : null}
            {err && !emailOpen ? (
              <p className="text-center text-[11px] text-red-600">{err}</p>
            ) : null}
          </div>
        )}
      </div>

      {emailOpen ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-forest/40 p-3 sm:items-center">
          <form
            onSubmit={(e) => void handleLeadThenPdf(e)}
            className="w-full max-w-sm rounded-2xl border border-forest/10 bg-white p-4 shadow-lg"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-forest">
                  PDF kostenlos
                </h3>
                <p className="mt-1 text-[11px] leading-snug text-forest/50">
                  Kurz Kontaktdaten — danach steht der Plan zum Download bereit.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEmailOpen(false)}
                className="rounded-lg p-1 text-forest/40 hover:bg-mint"
              >
                <X size={16} />
              </button>
            </div>
            <label className="block text-[11px] font-medium text-forest/60">
              Name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-forest/15 px-3 py-2 text-sm text-forest outline-none focus:border-aqua-deep"
                autoComplete="name"
              />
            </label>
            <label className="mt-2 block text-[11px] font-medium text-forest/60">
              E-Mail
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-forest/15 px-3 py-2 text-sm text-forest outline-none focus:border-aqua-deep"
                autoComplete="email"
              />
            </label>
            <label className="mt-2 block text-[11px] font-medium text-forest/60">
              Telefon
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-xl border border-forest/15 px-3 py-2 text-sm text-forest outline-none focus:border-aqua-deep"
                autoComplete="tel"
              />
            </label>
            <label className="mt-3 flex items-start gap-2.5 text-[10px] leading-snug text-forest/65">
              <input
                type="checkbox"
                required
                checked={privacy}
                onChange={(e) => setPrivacy(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-aqua-deep"
              />
              <span>
                Ich willige ein, dass RegnerWerk meine Angaben (Name, E-Mail,
                ggf. Telefon, Adresse und Plandaten) zur Bearbeitung dieser
                Anfrage und zur Kontaktaufnahme per E-Mail, Telefon oder
                Nachricht verarbeitet. Die Kontaktaufnahme kann durch
                Mitarbeitende <em>oder KI-gestützte Systeme</em> erfolgen
                (Rückruf, Entgegennahme von Anrufen, Gesprächsführung). Der
                PDF-Download begründet keinen Vertrag. Die Einwilligung ist
                freiwillig und jederzeit mit Wirkung für die Zukunft widerrufbar
                (z.&nbsp;B. an hallo@regnerwerk.de). Details:{" "}
                <a
                  href={siteDatenschutzUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-aqua-deep underline"
                >
                  Datenschutzerklärung
                </a>
                .
              </span>
            </label>
            {err ? (
              <p className="mt-2 text-[11px] text-red-600">{err}</p>
            ) : null}
            <button
              type="submit"
              disabled={busy === "pdf" || !privacy}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy === "pdf" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} className="text-lime" />
              )}
              Senden und PDF laden
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
