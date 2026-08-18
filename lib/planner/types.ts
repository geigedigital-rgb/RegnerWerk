import type { LngLat } from "@/lib/mapbox";

/** Local planar point in meters relative to a lng/lat origin. */
export type PtM = { x: number; y: number };

export type AlgorithmVersion = "v1" | "v2" | "v3";

export type ProjectLevel =
  | "ESTIMATE"
  | "PRELIMINARY_ENGINEERING"
  | "INSTALL_READY_CANDIDATE";

export type HeadKind = "spray" | "rotor" | "strip";

export type SprinklerHead = {
  id: string;
  /** Geographic position (source of truth; meters derived per computation). */
  position: LngLat;
  kind: HeadKind;
  /** Nozzle / config key, e.g. "R-VAN18" or "R-VAN14-360" or "3504@2.0" */
  configKey: string;
  /** Wurf radius in meters (clamped to manufacturer range). Strip: length. */
  radiusM: number;
  /** Covered sector in degrees (360 = full circle). Strip heads use 0. */
  arcDeg: number;
  /** Direction of the sector bisector, degrees CW from north (0 = north). */
  rotationDeg: number;
  /** Flow at recommended pressure, l/min. */
  flowLMin: number;
  /** Drawn lawn zone this head belongs to. */
  lawnZoneId: string;
  /** Hydraulic zone index (assigned by zoning step). */
  hydraulicZone: number;
  /** True if this head sits at the end of its pipe run (elbow instead of tee). */
  lineEnd?: boolean;
  /** Strip nozzle width (m); only for kind === "strip". */
  stripWidthM?: number;
  /** Strip nozzle length (m); only for kind === "strip". */
  stripLengthM?: number;
  /** Design / solved pressure at head (v2). */
  designPressureBar?: number;
};

export type PipeRun = {
  id: string;
  kind: "main" | "lateral";
  hydraulicZone: number | null;
  /** Geographic polyline. */
  points: LngLat[];
  lengthM: number;
  /** Selected pipe OD in mm (v2 diameter sizing). */
  odMm?: number;
  /** Internal diameter mm used for hydraulics. */
  idMm?: number;
  flowLMin?: number;
  velocityMps?: number;
  frictionLossBar?: number;
  startPressureBar?: number;
  endPressureBar?: number;
};

export type HydraulicZoneInfo = {
  index: number;
  headIds: string[];
  flowLMin: number;
  pipeLengthM: number;
  color: string;
};

export type BomLine = {
  key: string;
  article: string | null;
  label: string;
  qty: number;
  unit: "piece" | "meter" | "roll";
  priceEur: number | null;
  totalEur: number | null;
  group: "regner" | "rohr" | "ventile" | "steuerung" | "quelle" | "tropf";
  note?: string;
  /** Product image from planner-catalog / universal. */
  imageUrl?: string | null;
  /** Linked sprinkler head ids (Regner lines) — click selects on map. */
  headIds?: string[];
  /** Linked Technik fixture kind (Steuerung → smarthome, etc.). */
  linkFixtureKind?: "wasserquelle" | "smarthome" | "wasserverteiler";
};

export type PlanMetrics = {
  binaryCoveragePct: number;
  predictedDUlq?: number;
  precipitationMmH?: number;
  oversprayPct?: number;
  buildingOversprayPct?: number;
  largestDryPatchM2?: number;
};

export type HydraulicSummary = {
  sourceCurveUsed: boolean;
  criticalZoneId?: string;
  requiredSourcePressureBar?: number;
  availableSourcePressureBar?: number;
  minimumPressureMarginBar?: number;
  maxVelocityMps?: number;
};

export type ZoneDecisionSummary = {
  zoneId: string;
  primaryReason: string;
  explanation: string;
  flowLpm: number;
  targetBalancedFlowLpm?: number;
};

export type ManifoldSummary = {
  outletsNeeded: number;
  articles: string[];
  valveBoxQty: number;
  note: string;
};

/**
 * UI / persistence view model — shared by v1/v2/v3 via adapter.
 * Schema version stays 1 for storage compatibility; algorithmVersion selects engine.
 */
export type SofortPlan = {
  version: 1;
  algorithmVersion: AlgorithmVersion;
  createdAt: string;
  /** Regner brand used for layout + BOM (Hunter MP / Rain Bird R-VAN). */
  brand?: "hunter" | "rainbird";
  heads: SprinklerHead[];
  pipes: PipeRun[];
  zones: HydraulicZoneInfo[];
  bom: BomLine[];
  totalKnownEur: number;
  hasUnknownPrices: boolean;
  warnings: string[];
  assumptions: string[];
  sourceFlowLMin: number;
  /** Lawn area of drawn Rasen polygons, m². */
  lawnAreaM2: number;
  dripAreaM2: number;
  /** Fraction of lawn sample points hit by at least one head (0–100). */
  coveragePct: number;
  /** v2/v3 engineering metadata */
  projectLevel?: ProjectLevel;
  confidence?: number;
  blockers?: string[];
  metrics?: PlanMetrics;
  hydraulicSummary?: HydraulicSummary;
  requiresBackflowProtectionReview?: boolean;
  catalogVersion?: string;
  algorithmBuild?: string;
  /** v3 professional zoning explanations */
  zoneDecisions?: ZoneDecisionSummary[];
  /** v3 collector kit in valve box */
  manifoldSummary?: ManifoldSummary;
};
