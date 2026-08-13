"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ChevronDown,
  Download,
  Droplets,
  Loader2,
  Mail,
  X,
} from "lucide-react";
import type { FixtureKind, PlotFixture } from "@/lib/mapbox";
import { type AlgorithmVersion, type BomLine, type SofortPlan } from "@/lib/planner";

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
  }) => Promise<void>;
  onDownloadPdf?: () => Promise<void>;
  onChangeBrand?: (brand: "hunter" | "rainbird") => void;
  onChangeAlgorithm?: (version: AlgorithmVersion) => void;
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
  onChangeAlgorithm,
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
  const [busy, setBusy] = useState<"email" | "pdf" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const brand = plan.brand ?? "hunter";
  const algorithmVersion = plan.algorithmVersion ?? "v1";

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

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!onSubmitEmail) return;
    setBusy("email");
    setErr(null);
    try {
      await onSubmitEmail({ name: name.trim(), email: email.trim() });
      setEmailOpen(false);
      setFlash("Projekt gespeichert. PDF liegt bereit.");
      setTimeout(() => setFlash(null), 4000);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  }

  async function handlePdf() {
    if (!onDownloadPdf) return;
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
          {onChangeAlgorithm ? (
            <div
              className="inline-flex rounded-xl border border-forest/10 bg-mint/30 p-0.5"
              role="group"
              aria-label="Algorithmus"
            >
              {(
                [
                  ["v1", "Algo v1"],
                  ["v2", "Algo v2"],
                  ["v3", "Algo v3"],
                ] as const
              ).map(([id, label]) => {
                const active = algorithmVersion === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onChangeAlgorithm(id)}
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
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-forest/15 bg-white px-3 py-2.5 text-xs font-semibold text-forest hover:bg-white/80 disabled:opacity-50"
              >
                {busy === "pdf" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                PDF herunterladen
              </button>
            ) : null}
            {onSubmitEmail ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setEmailOpen(true);
                  setErr(null);
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-3 py-2.5 text-xs font-semibold text-white hover:bg-forest/90 disabled:opacity-50"
              >
                <Mail size={14} className="text-lime" />
                Projekt per E-Mail senden
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
            {err ? (
              <p className="text-center text-[11px] text-red-600">{err}</p>
            ) : null}
          </div>
        )}
      </div>

      {emailOpen ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-forest/40 p-3 sm:items-center">
          <form
            onSubmit={(e) => void handleEmailSubmit(e)}
            className="w-full max-w-sm rounded-2xl border border-forest/10 bg-white p-4 shadow-lg"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-forest">
                  Projekt senden
                </h3>
                <p className="mt-1 text-[11px] text-forest/50">
                  Wird gespeichert (E-Mail folgt später). PDF wird erzeugt.
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
            {err ? (
              <p className="mt-2 text-[11px] text-red-600">{err}</p>
            ) : null}
            <button
              type="submit"
              disabled={busy === "email"}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy === "email" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Mail size={14} />
              )}
              Speichern
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
