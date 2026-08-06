export type PlotShape = "quadrat" | "l" | "u" | "bogen";

export type Control = "timer" | "wifi" | "sensor";

export type ConfigState = {
  step: number;
  shape: PlotShape | null;
  dims: Record<string, number>;
  control: Control | null;
};

export const BASE_PRICE = 2490;

export const STEPS = [
  { id: 1, label: "Form" },
  { id: 2, label: "Maße" },
  { id: 3, label: "Steuerung" },
] as const;

export const SHAPES: {
  id: PlotShape;
  title: string;
  detail: string;
  delta: number;
  sides: { key: string; label: string; default: number }[];
}[] = [
  {
    id: "quadrat",
    title: "Quadrat / Rechteck",
    detail: "Klassische klare Fläche",
    delta: 0,
    sides: [
      { key: "a", label: "Seite A (Länge)", default: 12 },
      { key: "b", label: "Seite B (Breite)", default: 8 },
    ],
  },
  {
    id: "l",
    title: "L-Form",
    detail: "Um die Hausecke",
    delta: 180,
    sides: [
      { key: "a", label: "Langer Schenkel", default: 14 },
      { key: "b", label: "Kurzer Schenkel", default: 8 },
      { key: "c", label: "Breite A", default: 4 },
      { key: "d", label: "Breite B", default: 4 },
    ],
  },
  {
    id: "u",
    title: "U-Form",
    detail: "Hof / Innenhof",
    delta: 320,
    sides: [
      { key: "a", label: "Außenlänge", default: 16 },
      { key: "b", label: "Außenbreite", default: 12 },
      { key: "c", label: "Innenbreite", default: 6 },
      { key: "d", label: "Armbreite", default: 3.5 },
    ],
  },
  {
    id: "bogen",
    title: "Bogen / Rund",
    detail: "Organische Kante",
    delta: 240,
    sides: [
      { key: "a", label: "Länge", default: 14 },
      { key: "b", label: "Breite max.", default: 9 },
      { key: "r", label: "Bogenradius", default: 4 },
    ],
  },
];

export const CONTROLS: {
  id: Control;
  title: string;
  detail: string;
  delta: number;
}[] = [
  {
    id: "timer",
    title: "Timer",
    detail: "Einfache Zeitsteuerung",
    delta: 0,
  },
  {
    id: "wifi",
    title: "Wi‑Fi App",
    detail: "Steuerung per Smartphone",
    delta: 190,
  },
  {
    id: "sensor",
    title: "Sensor + App",
    detail: "Bodenfeuchte & Wetter",
    delta: 380,
  },
];

export const DIM_MIN = 0.5;
export const DIM_MAX = 1000;

/** Digits + one decimal separator (`,` or `.`). Letters stripped. */
export function sanitizeDimInput(raw: string): string {
  let s = raw.replace(/[^\d.,]/g, "");

  const commaIdx = s.indexOf(",");
  const dotIdx = s.indexOf(".");
  let sep = -1;
  let sepChar = "";
  if (commaIdx !== -1 && (dotIdx === -1 || commaIdx < dotIdx)) {
    sep = commaIdx;
    sepChar = ",";
  } else if (dotIdx !== -1) {
    sep = dotIdx;
    sepChar = ".";
  }

  if (sep !== -1) {
    const intPart = s.slice(0, sep).replace(/[.,]/g, "");
    // one decimal place is enough for meters
    const fracPart = s.slice(sep + 1).replace(/[.,]/g, "").slice(0, 1);
    s = intPart + sepChar + fracPart;
  } else {
    s = s.replace(/[.,]/g, "");
  }

  const n = parseFloat(s.replace(",", "."));
  if (Number.isFinite(n) && n > DIM_MAX) {
    return formatDim(DIM_MAX);
  }
  return s;
}

export function commitDim(raw: string, fallback: number): number {
  const n = parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(DIM_MAX, Math.max(DIM_MIN, n));
  return Math.round(clamped * 10) / 10;
}

/** Display with German decimal comma */
export function formatDim(n: number): string {
  return n.toLocaleString("de-DE", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}

export function formatDelta(delta: number) {
  if (delta === 0) return "Basis";
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${Math.abs(delta).toLocaleString("de-DE")} €`;
}

export function approxArea(shape: PlotShape | null, dims: Record<string, number>) {
  if (!shape) return 0;
  const a = dims.a || 0;
  const b = dims.b || 0;
  const c = dims.c || 0;
  const d = dims.d || 0;
  if (shape === "quadrat") return a * b;
  if (shape === "l") return a * c + (b - c) * d;
  if (shape === "u") return a * b - (a - 2 * d) * c;
  if (shape === "bogen") return a * b * 0.85;
  return 0;
}

/** Placeholder pricing — real formula later */
export function calcTotal(state: Pick<ConfigState, "shape" | "dims" | "control">) {
  const shapeDelta = SHAPES.find((s) => s.id === state.shape)?.delta ?? 0;
  const controlDelta = CONTROLS.find((c) => c.id === state.control)?.delta ?? 0;
  const area = approxArea(state.shape, state.dims);
  const areaSurcharge = area > 120 ? Math.round((area - 120) * 8) : 0;
  return BASE_PRICE + shapeDelta + controlDelta + areaSurcharge;
}

const PRODUCT_IMAGES = {
  ctrl: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=400&q=80",
  noz: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=400&q=80",
  pipe: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=400&q=80",
  valve: "https://images.unsplash.com/photo-1592419044706-39796d40f98c?auto=format&fit=crop&w=400&q=80",
  fit: "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=400&q=80",
  sensor:
    "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?auto=format&fit=crop&w=400&q=80",
} as const;

export function kitItems(state: Pick<ConfigState, "shape" | "dims" | "control">) {
  const area = Math.max(40, Math.round(approxArea(state.shape, state.dims) || 80));
  const nozzles = Math.max(6, Math.round(area / 12));
  const pipeM = Math.max(20, Math.round(area * 0.9));
  const hasWifi = state.control === "wifi" || state.control === "sensor";
  const hasSensor = state.control === "sensor";

  const items: {
    id: string;
    name: string;
    qty: string;
    price: number;
    image: string;
  }[] = [
    {
      id: "ctrl",
      name: hasWifi ? "Wi‑Fi Controller" : "Timer-Controller",
      qty: "1×",
      price: hasWifi ? 189 : 79,
      image: PRODUCT_IMAGES.ctrl,
    },
    {
      id: "noz",
      name: "Versenkdüsen",
      qty: `${nozzles}×`,
      price: nozzles * 18,
      image: PRODUCT_IMAGES.noz,
    },
    {
      id: "pipe",
      name: "PE-Leitung",
      qty: `${pipeM} m`,
      price: pipeM * 2.4,
      image: PRODUCT_IMAGES.pipe,
    },
    {
      id: "valve",
      name: "Magnetventile",
      qty: hasWifi ? "3×" : "2×",
      price: hasWifi ? 120 : 80,
      image: PRODUCT_IMAGES.valve,
    },
    {
      id: "fit",
      name: "Fitting-Set",
      qty: "1×",
      price: 45,
      image: PRODUCT_IMAGES.fit,
    },
  ];

  if (hasSensor) {
    items.push({
      id: "sensor",
      name: "Bodenfeuchte-Sensor",
      qty: "1×",
      price: 129,
      image: PRODUCT_IMAGES.sensor,
    });
  }

  return items;
}
