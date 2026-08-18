"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ChevronDown,
  CircleDot,
  Download,
  Droplets,
  Gauge,
  LandPlot,
  Loader2,
  Percent,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FixtureKind, PlotFixture } from "@/lib/mapbox";
import { type BomLine, type SofortPlan } from "@/lib/planner";
import { PdfLeadDialog } from "@/components/konfigurator/PdfLeadDialog";

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
  recalculating?: boolean;
  variant?: "side" | "sheet";
  sheetOpen?: boolean;
  onSheetToggle?: () => void;
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

function de1(n: number): string {
  return n.toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

const FLOW_REASON_HINT: Record<string, string> = {
  SOURCE_FLOW:
    "Zonen teilen den verfügbaren Quellfluss möglichst gleichmäßig.",
  IRRIGATION_METHOD:
    "Tropf und Regner laufen nicht in derselben Ventilzone.",
  PRECIPITATION_CLASS:
    "Düsen mit anderer Niederschlagsrate bekommen eine eigene Zone.",
  DISCONNECTED_AREA:
    "Getrennt gezeichnete Rasenflächen haben eigene Ventilzonen.",
};

function HintStat({
  icon: Icon,
  value,
  hint,
}: {
  icon: LucideIcon;
  value: string;
  hint: string;
}) {
  return (
    <span
      tabIndex={0}
      className="group relative inline-flex items-center gap-1 rounded-full bg-mint/80 px-2 py-1 text-[11px] font-semibold text-forest outline-none ring-aqua-deep/0 focus-visible:ring-2"
    >
      <Icon size={12} strokeWidth={2.25} className="shrink-0 text-aqua-deep" />
      {value}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 w-max max-w-[13.5rem] -translate-x-1/2 rounded-xl border border-white/10 bg-forest px-2.5 py-1.5 text-left text-[11px] font-medium leading-snug text-white opacity-0 shadow-none transition group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {hint}
      </span>
    </span>
  );
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
  recalculating = false,
  variant = "side",
  sheetOpen = true,
  onSheetToggle,
}: Props) {
  const presentGroups = GROUP_ORDER.filter((g) =>
    plan.bom.some((l) => l.group === g),
  );
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(presentGroups.slice(0, 1)),
  );
  const [emailOpen, setEmailOpen] = useState(false);
  const [leadDone, setLeadDone] = useState(false);
  const [busy, setBusy] = useState<"email" | "pdf" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const brand = plan.brand ?? "hunter";
  const flowDecision =
    plan.zoneDecisions?.find((d) => d.primaryReason === "SOURCE_FLOW") ??
    plan.zoneDecisions?.[0];
  const flowHintParts: string[] = [];
  if (flowDecision) {
    if (flowDecision.targetBalancedFlowLpm != null) {
      flowHintParts.push(
        `Ziel ${de1(flowDecision.targetBalancedFlowLpm)} l/min, aktuell ${de1(flowDecision.flowLpm)} l/min.`,
      );
    } else {
      flowHintParts.push(`Aktuell ${de1(flowDecision.flowLpm)} l/min je Zone.`);
    }
    const reasonHint = FLOW_REASON_HINT[flowDecision.primaryReason];
    if (reasonHint) flowHintParts.push(reasonHint);
  } else if (plan.sourceFlowLMin) {
    flowHintParts.push(
      `Quellfluss ${de1(plan.sourceFlowLMin)} l/min am Anschluss.`,
    );
  }

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

  async function handleLeadThenPdf(data: {
    name: string;
    email: string;
    phone?: string;
  }) {
    if (!onSubmitEmail || !onDownloadPdf) return;
    setBusy("pdf");
    setErr(null);
    try {
      await onSubmitEmail({
        name: data.name,
        email: data.email,
        phone: data.phone,
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

  const sheet = variant === "sheet";
  const showBody = !sheet || sheetOpen;

  return (
    <div
      className={`pointer-events-auto relative flex flex-col overflow-hidden border-forest/10 bg-white shadow-sm ${
        sheet
          ? "rounded-t-3xl border-x border-t"
          : "max-h-[min(70vh,36rem)] rounded-2xl border"
      } ${isCanvas ? "bg-white/95" : ""} ${
        sheet && sheetOpen ? "max-h-[min(72svh,36rem)]" : ""
      }`}
      onWheel={(e) => {
        if (e.ctrlKey) e.preventDefault();
      }}
    >
      <div className="border-b border-forest/8 px-4 py-3">
        {sheet ? (
          <button
            type="button"
            onClick={onSheetToggle}
            className="flex w-full items-center justify-center pb-1"
            aria-expanded={sheetOpen}
            aria-label={sheetOpen ? "Liste einklappen" : "Liste öffnen"}
          >
            <span className="h-1 w-10 rounded-full bg-forest/15" />
          </button>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex min-w-0 items-center gap-2 text-base font-bold tracking-tight text-forest">
            <Droplets size={18} className="shrink-0 text-aqua-deep" />
            Sofort-Berechnung
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            {onChangeBrand ? (
            <div
              className="inline-flex shrink-0 rounded-full border border-forest/10 bg-mint/40 p-0.5"
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
                    disabled={recalculating}
                    onClick={() => onChangeBrand(id)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${
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
          {sheet ? (
            <ChevronDown
              size={18}
              className={`text-forest/40 transition ${sheetOpen ? "rotate-180" : ""}`}
            />
          ) : null}
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <HintStat
            icon={LandPlot}
            value={`${Math.round(plan.lawnAreaM2).toLocaleString("de-DE")} m²`}
            hint="Rasenfläche, die in der Sofort-Berechnung bewässert wird."
          />
          <HintStat
            icon={CircleDot}
            value={`${plan.heads.length} Regner`}
            hint="Anzahl der platzierten Regner auf der Rasenfläche."
          />
          <HintStat
            icon={Percent}
            value={`${Math.round(plan.coveragePct)} %`}
            hint="Anteil der Rasenfläche, den die Regner abdecken."
          />
          {flowDecision || plan.sourceFlowLMin ? (
            <HintStat
              icon={Gauge}
              value={`${de1(flowDecision?.flowLpm ?? plan.sourceFlowLMin)} l/min`}
              hint={
                flowHintParts.join(" ") ||
                "Durchfluss der Ventilzone in Litern pro Minute."
              }
            />
          ) : null}
        </div>
      </div>

      {showBody ? (
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
      ) : null}

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

      <PdfLeadDialog
        open={emailOpen}
        busy={busy === "pdf"}
        error={emailOpen ? err : null}
        onCancel={() => {
          if (busy === "pdf") return;
          setEmailOpen(false);
          setErr(null);
        }}
        onSubmit={handleLeadThenPdf}
      />
    </div>
  );
}
