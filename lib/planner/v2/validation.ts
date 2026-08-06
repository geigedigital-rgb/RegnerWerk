import type { PlotFixture } from "@/lib/mapbox";
import { CATALOG } from "../catalog";
import type { ProjectLevel } from "../types";
import type {
  Assumption,
  FlowPressurePoint,
  SofortPlanV2,
  WarningItem,
} from "./types";

export function extractSourceCurve(fixtures: PlotFixture[]): {
  flowLMin: number;
  assumedFlow: boolean;
  curve: FlowPressurePoint[];
  sourceCurveUsed: boolean;
  dynamicPressureBar: number | null;
} {
  const quelle = fixtures.find((f) => f.kind === "wasserquelle");
  const m3h = quelle?.wassermengeM3h;
  const hasFlow = typeof m3h === "number" && m3h > 0;
  const flowLMin = hasFlow
    ? (m3h! * 1000) / 60
    : (CATALOG.hydraulics.defaultSourceFlowM3h * 1000) / 60;

  const pDyn =
    typeof quelle?.dynamicPressureBar === "number" &&
    quelle.dynamicPressureBar > 0
      ? quelle.dynamicPressureBar
      : null;

  const curve: FlowPressurePoint[] = [];
  if (hasFlow && pDyn != null) {
    curve.push({ flowLpm: flowLMin, dynamicPressureBar: pDyn });
  }

  return {
    flowLMin,
    assumedFlow: !hasFlow,
    curve,
    sourceCurveUsed: curve.length > 0,
    dynamicPressureBar: pDyn,
  };
}

export function classifyProjectLevel(input: {
  assumedFlow: boolean;
  sourceCurveUsed: boolean;
  hasHeights: boolean;
  scaleConfirmed: boolean;
  blockers: WarningItem[];
  backflowApproved: boolean;
}): ProjectLevel {
  if (input.blockers.some((b) => b.severity === "BLOCKER")) {
    return "ESTIMATE";
  }
  if (input.assumedFlow || !input.sourceCurveUsed) {
    return "ESTIMATE";
  }
  if (!input.hasHeights || !input.scaleConfirmed || !input.backflowApproved) {
    return "PRELIMINARY_ENGINEERING";
  }
  return "INSTALL_READY_CANDIDATE";
}

export function computeConfidence(input: {
  projectLevel: ProjectLevel;
  assumedFlow: boolean;
  sourceCurveUsed: boolean;
  predictedDUlq?: number;
  pressureMarginBar?: number;
  complexGeometry: boolean;
}): number {
  let c = 0.85;
  if (input.assumedFlow) c -= 0.25;
  if (!input.sourceCurveUsed) c -= 0.2;
  if (input.predictedDUlq != null && input.predictedDUlq < 0.65) c -= 0.1;
  if (input.pressureMarginBar != null && input.pressureMarginBar < 0.3) c -= 0.1;
  if (input.complexGeometry) c -= 0.05;
  if (input.projectLevel === "ESTIMATE") c = Math.min(c, 0.55);
  if (input.projectLevel === "PRELIMINARY_ENGINEERING") c = Math.min(c, 0.75);
  return Math.max(0.15, Math.min(0.95, Number(c.toFixed(2))));
}

export function defaultAssumptions(opts: {
  assumedFlow: boolean;
  sourceCurveUsed: boolean;
  brand: string;
}): Assumption[] {
  const out: Assumption[] = [];
  if (opts.assumedFlow) {
    out.push({
      code: "DEFAULT_FLOW",
      message: `Wassermenge unbekannt — angenommen: ${CATALOG.hydraulics.defaultSourceFlowM3h.toLocaleString("de-DE")} m³/h. Eimer-Test verbessert das Ergebnis.`,
    });
  }
  if (!opts.sourceCurveUsed) {
    out.push({
      code: "NO_Q_P_CURVE",
      message:
        "Kein dynamischer Druck bei bekanntem Durchfluss — Zonenzahl, Rohrdurchmesser und Regnerfunktion sind nicht bestätigt. Vor Montage Rest-/Betriebsdruck messen.",
    });
  }
  out.push({
    code: "BRAND",
    message: `Regner-Marke: ${opts.brand === "hunter" ? "Hunter MP / I-20" : "Rain Bird R-VAN / 3504"}.`,
  });
  return out;
}

/** Ensure INSTALL_READY is never claimed without curve + specialist backflow. */
export function assertHonestLevel(plan: Pick<SofortPlanV2, "projectLevel" | "hydraulicSummary" | "requiresBackflowProtectionReview">): ProjectLevel {
  if (
    plan.projectLevel === "INSTALL_READY_CANDIDATE" &&
    (!plan.hydraulicSummary.sourceCurveUsed ||
      plan.requiresBackflowProtectionReview)
  ) {
    return "PRELIMINARY_ENGINEERING";
  }
  return plan.projectLevel;
}
