import plannerCatalog from "@/data/planner/planner-catalog.json";

export type SprinklerBrand = "hunter" | "rainbird";

export type PerformancePoint = {
  pressureBar: number;
  arcDeg?: number;
  radiusM?: number;
  widthM?: number;
  lengthM?: number;
  flowLMin: number;
  precipSquareMmH?: number;
  precipTriangleMmH?: number;
};

export type NozzleSpec = {
  radiusMinM: number;
  radiusMaxM: number;
  arcMinDeg: number;
  arcMaxDeg: number;
  flow360LMin: number | null;
  /** Representative pressure for flow360LMin (compat). */
  pressureBar: number;
  pressureMinBar?: number | null;
  pressureRecommendedBar?: number | null;
  pressureMaxBar?: number | null;
  precipMmH?: number | null;
  matchedPrecipitation?: boolean | null;
  precipitationFamily?: string | null;
  hydraulicZoneGroup?: string | null;
  patternType?: string | null;
  /** Full published performance rows — do not collapse to one pressure. */
  performance?: PerformancePoint[];
};

export type StripSpec = {
  pattern: "left_corner_strip" | "right_corner_strip" | "side_strip" | string;
  patternType?: string;
  widthM: number;
  lengthM: number;
  flowLMin: number | null;
  pressureBar: number;
  pressureMinBar?: number | null;
  pressureRecommendedBar?: number | null;
  pressureMaxBar?: number | null;
  precipMmH?: number | null;
  precipSquareMmH?: number | null;
  precipTriangleMmH?: number | null;
  matchedPrecipitation?: boolean | null;
  precipitationFamily?: string | null;
  hydraulicZoneGroup?: string | null;
  performance?: PerformancePoint[];
};

export type SetVariant = {
  nozzleKey: string;
  anschluss: "tee" | "elbow";
  label: string;
  priceEur: number | null;
};

export type RollSpec = {
  article: string | null;
  label: string;
  lengthM: number;
  priceEur: number | null;
  imageUrl?: string | null;
};

export type SimplePart = {
  article: string | null;
  label: string;
  priceEur: number | null;
  imageUrl?: string | null;
};

export type BrandEmitters = {
  sprayHead: {
    setArticle: string;
    bodyLabel: string;
    variants: SetVariant[];
    nozzles: Record<string, NozzleSpec>;
    strips: Record<string, StripSpec>;
  };
  rotor: {
    article: string;
    label: string;
    priceEur: number | null;
    imageUrl?: string | null;
    radiusMinM: number;
    radiusMaxM: number;
    arcMinDeg: number;
    arcMaxDeg: number;
    pressureMinBar?: number | null;
    pressureRecommendedBar?: number | null;
    pressureMaxBar?: number | null;
    precipitationFamily?: string | null;
    hydraulicZoneGroup?: string | null;
    options: Array<{
      nozzle: string;
      pressureBar: number;
      radiusM: number;
      flowLMin: number;
      precipSquareMmH?: number;
      precipTriangleMmH?: number;
    }>;
    accessories: SimplePart[];
  };
};

export type PlannerCatalog = {
  /** Product photos from RegnerWerk_universal.json (build-planner-catalog). */
  images?: Record<string, string>;
  defaultBrand?: SprinklerBrand;
  brands?: Record<SprinklerBrand, BrandEmitters>;
  sprayHead: BrandEmitters["sprayHead"];
  rotor: BrandEmitters["rotor"];
  pipes: {
    pe25Rolls: RollSpec[];
    pe32Rolls: RollSpec[];
    /** PE Klemmwinkel 90° (route bends), Wasser&Grün 1.00-W03 / 1.00-W04 */
    elbowPe25?: SimplePart;
    elbowPe32?: SimplePart;
    /** PE Klemmkupplung gerade (roll joins), 1.03-K55 / 1.03-K56 */
    couplingPe25?: SimplePart;
    couplingPe32?: SimplePart;
  };
  hydraulics: {
    defaultSourceFlowM3h: number;
    zoneFillFactor: number;
    recommendedPressureBar: number;
    assumedVerteilerPressureBar: number;
    pe25InternalDiameterMm: number;
    pe32InternalDiameterMm: number;
    hazenWilliamsC: number;
    /** v2: max design velocity m/s */
    maxVelocityMps?: number;
    /** v2: spacingFactor ≤ 1 (head-to-head); default 1.0 without wind */
    spacingFactor?: number;
    /** Catalog revision for v2 output */
    catalogVersion?: string;
  };
  /** Optional PE size ladder for v2 diameter selection */
  pipeSizes?: Array<{
    odMm: number;
    idMm: number;
    rollsKey: "pe25Rolls" | "pe32Rolls" | string;
  }>;
  zoneParts: {
    valve: SimplePart;
    adapterPe25Valve: SimplePart;
    adapterPe32Valve: SimplePart;
    verteiler: Array<SimplePart & { outlets: number }>;
    /** Default / legacy single box (smallest common). Prefer valveBoxes. */
    valveBox: SimplePart;
    /** Sized boxes: pick smallest with maxValveCount ≥ zones. */
    valveBoxes?: Array<SimplePart & { maxValveCount: number }>;
  };
  controls: {
    controllers: Array<SimplePart & { stations: number }>;
    wirePerMeter: Array<{
      article: string | null;
      label: string;
      cores: number;
      priceEurPerM: number | null;
      imageUrl?: string | null;
    }>;
    splice: SimplePart;
  };
  sourceParts: {
    ballValve: SimplePart;
    checkValve: SimplePart;
    /** PE Klemm × 1″ AG — into Kugelhahn IG (matches main OD). */
    adapterPe25Source: SimplePart;
    adapterPe32Source: SimplePart;
    /** Winter blow-out / drain tee with ball valve (catalog). */
    winterDrain: SimplePart;
    /** PTFE thread seal tape (DVGW), shop Art. Teflon_1. */
    threadSeal: SimplePart;
    /** Disc filter with PE25 / PE32 unions (match main OD). */
    discFilterPe25: SimplePart;
    discFilterPe32: SimplePart;
  };
  drip: {
    tube: SimplePart & { emitterSpacingM: number; emitterFlowLh: number };
    controlKit: SimplePart;
    rowSpacingM: number;
  };
};

export const CATALOG = plannerCatalog as unknown as PlannerCatalog;

export const DEFAULT_BRAND: SprinklerBrand =
  CATALOG.defaultBrand === "rainbird" ? "rainbird" : "hunter";

export function brandEmitters(brand: SprinklerBrand = DEFAULT_BRAND): BrandEmitters {
  const pack = CATALOG.brands?.[brand];
  if (pack) return pack;
  return { sprayHead: CATALOG.sprayHead, rotor: CATALOG.rotor };
}

export function setVariantFor(
  nozzleKey: string,
  anschluss: "tee" | "elbow",
  brand: SprinklerBrand = DEFAULT_BRAND,
): SetVariant | null {
  const { sprayHead } = brandEmitters(brand);
  return (
    sprayHead.variants.find(
      (v) => v.nozzleKey === nozzleKey && v.anschluss === anschluss,
    ) ?? null
  );
}

/** Standard-precip spray families (excludes MP800 ~20 mm/h). */
export function primaryNozzleOrder(brand: SprinklerBrand): string[] {
  if (brand === "hunter") return ["MP1000", "MP2000", "MP3000", "MP3500"];
  return ["R-VAN14", "R-VAN18", "R-VAN24"];
}

/**
 * Gear-drive / PC rotors (3504-PC-SAM, I-20) — not used in automatic layout until
 * explicitly enabled (special pressure-compensating layouts come later).
 */
export const AUTO_LAYOUT_ROTORS_ENABLED = false;

/** Spray families eligible for a target arc (includes Rain Bird 360° nozzle keys). */
export function nozzleOrderForArc(
  brand: SprinklerBrand,
  arcDeg = 180,
): string[] {
  if (brand === "rainbird" && arcDeg >= 315) {
    return ["R-VAN14-360", "R-VAN18-360", "R-VAN24-360"];
  }
  return primaryNozzleOrder(brand);
}

export function sprayConfigKey(familyKey: string, arcDeg: number): string {
  if (arcDeg >= 315 && !familyKey.endsWith("-360")) {
    return `${familyKey}-360`;
  }
  return familyKey;
}

/** Largest catalogued spray family for arc; never returns a rotor. */
export function largestSprayFamilySpec(
  brand: SprinklerBrand,
  emitters: BrandEmitters,
  arcDeg = 180,
): { key: string; spec: NozzleSpec } | null {
  const n = emitters.sprayHead.nozzles;
  const order = nozzleOrderForArc(brand, arcDeg);
  for (let i = order.length - 1; i >= 0; i--) {
    const key = order[i];
    const spec = n[key];
    if (spec) return { key, spec };
    // R-VAN24-360 may inherit performance from R-VAN24 in catalog
    if (key.endsWith("-360")) {
      const base = n[key.replace(/-360$/, "")];
      if (base) return { key, spec: base };
    }
  }
  const fallback = order[0];
  const spec = n[fallback];
  return spec ? { key: fallback, spec } : null;
}

export function smallNozzleKey(brand: SprinklerBrand): string {
  return brand === "hunter" ? "MP800SR" : "R-VAN14";
}

export function sideStripKey(brand: SprinklerBrand): string {
  return brand === "hunter" ? "MPSS530" : "R-VAN-SST";
}

export function isMp800Family(configKey: string): boolean {
  return /^MP8/i.test(configKey);
}
