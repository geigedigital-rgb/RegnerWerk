import type { LngLat } from "@/lib/mapbox";
import type {
  BomLine,
  HydraulicSummary,
  PlanMetrics,
  ProjectLevel,
  SprinklerHead,
} from "../types";

export type FlowPressurePoint = {
  flowLpm: number;
  dynamicPressureBar: number;
};

export type Assumption = {
  code: string;
  message: string;
};

export type WarningItem = {
  code: string;
  severity: "BLOCKER" | "WARNING" | "INFO";
  message: string;
};

export type LandscapeHydrozone = {
  id: string;
  lawnZoneId: string;
  plantWaterNeed: "lawn" | "shrub" | "drip" | "unknown";
  irrigationMethod: "spray" | "rotor" | "strip" | "drip";
  areaM2: number;
};

export type ValveZone = {
  id: string;
  index: number;
  headIds: string[];
  flowLpm: number;
  precipitationClass: string;
  pipeLengthM: number;
};

export type HydraulicPipeSegment = {
  id: string;
  kind: "main" | "lateral";
  valveZoneId: string | null;
  points: LngLat[];
  lengthM: number;
  flowLpm: number;
  odMm: number;
  idMm: number;
  velocityMps: number;
  frictionLossBar: number;
  minorLossBar: number;
  startPressureBar: number;
  endPressureBar: number;
};

export type DripNetwork = {
  zoneId: string;
  tubeLengthM: number;
  emitterCount: number;
  flowLpm: number;
  estimated: boolean;
};

/** Full v2 engineering output (§15). Adapted to SofortPlan for UI. */
export type SofortPlanV2 = {
  projectLevel: ProjectLevel;
  confidence: number;
  assumptions: Assumption[];
  blockers: WarningItem[];
  warnings: WarningItem[];
  hydrozones: LandscapeHydrozone[];
  valveZones: ValveZone[];
  heads: Array<{
    id: string;
    position: LngLat;
    sku: string;
    bodySku: string;
    kind: SprinklerHead["kind"];
    arcDeg: number;
    rotationDeg: number;
    designPressureBar: number;
    actualRadiusM: number;
    flowLpm: number;
    precipitationClass: string;
    adjustmentPct: number;
    lawnZoneId: string;
    hydraulicZone: number;
    lineEnd?: boolean;
    stripWidthM?: number;
    stripLengthM?: number;
  }>;
  dripNetworks: DripNetwork[];
  pipeSegments: HydraulicPipeSegment[];
  metrics: PlanMetrics;
  hydraulicSummary: HydraulicSummary;
  bom: BomLine[];
  totalKnownEur: number;
  hasUnknownPrices: boolean;
  sourceFlowLMin: number;
  lawnAreaM2: number;
  dripAreaM2: number;
  brand: "hunter" | "rainbird";
  catalogVersion: string;
  algorithmVersion: "v2";
  algorithmBuild: string;
  requiresBackflowProtectionReview: boolean;
  createdAt: string;
};
