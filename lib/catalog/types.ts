/**
 * Canonical catalog model. Produced from scraped raw data
 * (data/raw/products.json) by the AI structuring step
 * (scripts/scrape/structure.ts) into data/catalog/products.json.
 * Consumed by the compatibility engine and the Sofort-Berechnung planner.
 */

export type ProductKind =
  | "rotor" // Getrieberegner: 3504, 5004, 8005, Eagle 700/900
  | "spray" // Versenkregner/Sprüher-Gehäuse: Typenreihe 1800
  | "nozzle" // Düsen: VAN, HE-VAN, R-VAN, MPR, U-Serie
  | "valve" // Magnetventile: DV, DV-F, JTV, PGA
  | "controller" // Steuergeräte: ESP-ME3, ESP-TM2, ESP-RZXe, RC2
  | "controller-module" // Erweiterungsmodule: ESP-SM3, ESP-SM6
  | "wifi-module" // LNK/LNK2 WiFi
  | "sensor" // Regensensor RSD, Bodenfeuchte
  | "decoder" // Decoder-Systeme (MDC, FD)
  | "pipe" // PE-Rohr, Blu-Lock Rohr
  | "flex-pipe" // SPX-FLEX / Funny Pipe Meterware
  | "swing-joint" // vormontierte Swing Joints / Anschlüsse
  | "drip-line" // Tropfrohr XFD/XFS/Dripline
  | "drip-accessory" // Tropfer, Micro-Verbinder BF, Erdspieße
  | "fitting" // SBE/SBA, Lock-Anschlussstücke, Klemmverschraubungen, T/Winkel
  | "valve-box" // Ventilkästen
  | "filter" // Filter, Basket-Filter
  | "pressure-regulator" // Druckminderer, PRF/PSI
  | "pump" // Pumpen
  | "tool" // Werkzeuge: PTC1, Schere
  | "accessory" // Schellen, Vlies, Kappen, Zubehör
  | "other";

/** BSP-Zollgewinde wie im Shop angegeben. */
export type ThreadSize = '1/2"' | '3/4"' | '1"' | '1 1/4"' | '1 1/2"' | '2"';

export type PortRole = "inlet" | "outlet" | "side" | "universal";

/**
 * A physical connection point of a product. The compatibility engine
 * matches ports (and searches adapter chains through fittings).
 */
export type PortSpec =
  | {
      type: "thread";
      size: ThreadSize;
      /** IG = Innengewinde (female), AG = Außengewinde (male) */
      gender: "IG" | "AG";
      role?: PortRole;
      /** identical ports on the product (e.g. a tee has 2 run ports) */
      count?: number;
    }
  | {
      /** Klemm-/Lock-Verschraubung auf PE-Rohr */
      type: "pe-clamp";
      diameterMm: number;
      role?: PortRole;
      count?: number;
    }
  | {
      /** Steck-/Widerhaken-Anschluss für Flexschlauch (SPX, Funny Pipe, Blu-Lock) */
      type: "barb";
      diameterMm: number;
      role?: PortRole;
      count?: number;
    }
  | {
      /** 16/20-mm-Lock-System für Tropfrohr / Micro */
      type: "drip-lock";
      diameterMm: number;
      role?: PortRole;
      count?: number;
    };

/**
 * Flat spec bag — all fields optional; which ones are expected depends on
 * `kind`. Kept flat (instead of a discriminated union) so the AI extraction
 * step can fill in whatever the source text provides.
 */
export type ProductSpecs = {
  // sprinklers (rotor / spray) & nozzles
  riserHeightCm?: number;
  throwRadiusMinM?: number;
  throwRadiusMaxM?: number;
  arcMinDeg?: number;
  arcMaxDeg?: number;
  /** true = Vollkreis möglich (360°) */
  fullCircle?: boolean;
  pressureMinBar?: number;
  pressureMaxBar?: number;
  flowMinM3h?: number;
  flowMaxM3h?: number;
  /** SAM = Auslaufsperrventil eingebaut */
  hasSAM?: boolean;
  /** PRS = Druckregulierung eingebaut */
  hasPRS?: boolean;
  stainlessRiser?: boolean;
  nozzlesIncluded?: boolean;
  /** Niederschlagsrate, mm/h */
  precipRateMmH?: number;

  // valves
  voltage?: "24VAC" | "9VDC";
  withFlowControl?: boolean;

  // controllers & modules
  stationsBase?: number;
  stationsMax?: number;
  stationsAdded?: number;
  wifi?: boolean;
  outdoor?: boolean;
  /** kompatible Geräte/Serien, z. B. ["ESP-ME3", "ESP-ME"] */
  compatibleWith?: string[];

  // pipes / hoses / drip
  diameterMm?: number;
  pressureRatingBar?: number;
  /** Rollen-/Lieferlänge; bei Meterware = 1 */
  lengthM?: number;
  soldByMeter?: boolean;
  emitterSpacingCm?: number;
  emitterFlowLh?: number;

  // fittings
  fittingShape?:
    | "elbow"
    | "tee"
    | "coupler"
    | "adapter"
    | "end-cap"
    | "reducer"
    | "manifold"
    | "other";

  // valve boxes
  boxValveCapacity?: number;
  boxDiameterMm?: number;
  boxLengthMm?: number;
  boxWidthMm?: number;
  boxHeightMm?: number;

  // misc
  material?: string;
  seriesCompatibility?: string[];
};

export type ProductDoc = { title: string; url: string };

export type Product = {
  /** stable id = shop URL slug */
  id: string;
  url: string;
  /** original shop title */
  title: string;
  /** short human name for UI, e.g. "Rain Bird 1804 Versenkregner" */
  displayName: string;
  kind: ProductKind;
  /** Shop-Art.Nr. (wasserundgruen), e.g. "3.105" */
  shopArtNr: string | null;
  /** Hersteller-Art.Nr., e.g. "A44120", "Y34001" */
  manufacturerNr: string | null;
  /** Produktserie, e.g. "1800", "5000", "ESP-ME3", "XFD" */
  series: string | null;
  brand: string;
  /** EUR incl. MwSt; bei Varianten = "ab"-Preis */
  price: number | null;
  priceIsFrom: boolean;
  /** Variantenoptionen als Text (z. B. Längen, Düsengrößen) */
  variantOptions: string[];
  images: string[];
  docs: ProductDoc[];
  ports: PortSpec[];
  specs: ProductSpecs;
  /** kurze DE-Beschreibung (1-2 Sätze) für UI-Karten */
  summary: string;
};

export type Catalog = {
  generatedAt: string;
  source: string;
  products: Product[];
};
