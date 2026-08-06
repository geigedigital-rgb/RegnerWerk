/**
 * PDF / product-text enrichers for catalog normalization.
 * Prefer metric manufacturer data; convert to schema base units.
 * Never invent values — return null/empty when parse fails.
 */

export type PerformanceTable = {
  table_id: string;
  table_type: "pressure_loss" | "radius_flow" | "precipitation" | "other";
  model_key: string | null;
  units: Record<string, string>;
  columns: string[];
  rows: Record<string, number | string | null>[];
  notes: string[];
  provenance: {
    source_type: "manufacturer_pdf" | "product_text";
    source_url: string | null;
    document_title: string | null;
    page: number | null;
  };
};

function parseDeNum(s: string): number | null {
  const t = s.trim().replace(/\s/g, "").replace(",", ".");
  if (!t || t === "-" || t === "–" || t === "—") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** m³/h → l/min */
export function m3hToLMin(m3h: number): number {
  return Math.round(((m3h * 1000) / 60) * 100) / 100;
}

function prov(
  sourceUrl: string | null,
  documentTitle: string | null,
  source_type: "manufacturer_pdf" | "product_text" = "manufacturer_pdf",
): PerformanceTable["provenance"] {
  return { source_type, source_url: sourceUrl, document_title: documentTitle, page: null };
}

/**
 * Parse Rain Bird PGA Informationsblatt metric Druckverlust table.
 */
export function parsePgaPressureLossFromPdf(
  text: string,
  opts: {
    modelKey: string;
    sourceUrl: string | null;
    documentTitle: string | null;
  },
): PerformanceTable | null {
  const key = opts.modelKey.replace(/\s+/g, "").toUpperCase();
  const keyRe = key.includes("-")
    ? key.replace("-", "[-\\s]*")
    : key.replace(/(\d+)(PGA)/, "$1[-\\s]*$2");

  const blockRe = new RegExp(
    `(${keyRe})\\s*\\n\\s*m\\s*3\\s*/\\s*h\\s*([\\s\\S]*?)(?=(?:100|150|200)[-\\s]*PGA\\b|VENTILE|TEMPERATUR|KENNDATEN|TYPENREIHE|ELEKTRISCHE|ABMESSUNGEN|$)`,
    "i",
  );
  const m = text.match(blockRe);
  if (!m) return null;

  const rows: PerformanceTable["rows"] = [];
  for (const line of m[2].split(/\n+/)) {
    const nums = [...line.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((x) => x[1]);
    if (nums.length < 3) continue;
    const flowM3h = parseDeNum(nums[0]);
    const globe = parseDeNum(nums[1]);
    const angle = parseDeNum(nums[2]);
    if (flowM3h == null || flowM3h > 200) continue;
    rows.push({
      flow_m3_h: flowM3h,
      flow_l_min: m3hToLMin(flowM3h),
      pressure_loss_bar_globe: globe,
      pressure_loss_bar_angle: angle,
      configuration: "both",
    });
  }
  if (!rows.length) return null;

  return {
    table_id: `pressure_loss_${opts.modelKey.toLowerCase().replace(/\s+/g, "_")}`,
    table_type: "pressure_loss",
    model_key: opts.modelKey,
    units: { flow: "l_min", pressure_loss: "bar" },
    columns: [
      "flow_m3_h",
      "flow_l_min",
      "pressure_loss_bar_globe",
      "pressure_loss_bar_angle",
    ],
    rows,
    notes: [
      "Druckverlust bei voll geöffneter Durchflussregulierung (Herstellerangabe).",
      "Globe = Durchgangsform, Angle = Eckform.",
    ],
    provenance: prov(opts.sourceUrl, opts.documentTitle),
  };
}

/**
 * Rain Bird R-VAN Leistungsdaten:
 *   R-VAN14 ...
 *   270°  2.1  4.0  3.18  16  19
 * → arc, pressure_bar, radius_m, flow_l_min, precip_square, precip_triangle
 */
export function parseRvanPerformanceFromPdf(
  text: string,
  opts: {
    modelKey: string; // e.g. "R-VAN14", "R-VAN-LCS"
    sourceUrl: string | null;
    documentTitle: string | null;
  },
): PerformanceTable | null {
  const key = opts.modelKey
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/^RVAN/, "R-VAN");
  const want360 = /-360$/i.test(key);
  const base = key.replace(/-360$/i, "");
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Collect candidate blocks; prefer those with metric pressure rows (2.1 / 2,1).
  const candidates: string[] = [];
  const re = new RegExp(
    `(${esc}(?:-360)?)\\b[^\\n]*\\n([\\s\\S]*?)(?=\\nR-VAN[\\w-]*\\b|\\n--\\s*\\d|Technische Daten|Kenndaten|$)`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const label = m[1].toUpperCase();
    const is360 = /-360$/i.test(label);
    if (want360 !== is360) continue;
    candidates.push(m[2]);
  }

  const score = (body: string) =>
    (body.match(/\b2[.,][148]\b/g) || []).length +
    (body.match(/\b3[.,][148]\b/g) || []).length;

  candidates.sort((a, b) => score(b) - score(a));
  const body = candidates.find((c) => score(c) >= 3) ?? null;
  if (!body) return null;

  const rows: PerformanceTable["rows"] = [];
  let currentArc: number | null = null;
  for (const raw of body.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const arcOnly = line.match(/^(\d+)\s*°/);
    const nums = [...line.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((x) => x[1]);
    if (arcOnly && nums.length >= 1) {
      currentArc = parseInt(arcOnly[1], 10);
    }
    // strip / corner: size like 1.5x4.6
    const size = line.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
    if (size && nums.length >= 3) {
      // pressure, size, flow, precip, precip — find pressure as first plain number
      const pressure = parseDeNum(nums[0]);
      const flow = parseDeNum(nums.find((n, i) => i > 0 && !n.includes("x") && parseDeNum(n)! < 50) ?? "");
      // better: after size token
      const after = line.replace(size[0], " ");
      const rest = [...after.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((x) => x[1]);
      if (rest.length >= 2) {
        const p = parseDeNum(rest[0]);
        // if first was pressure before size, rest[0] may be flow
        const flowN = parseDeNum(rest[rest.length >= 3 ? 1 : 0]);
        const precipSq = parseDeNum(rest[rest.length >= 3 ? 2 : 1]);
        const precipTri = parseDeNum(rest[rest.length >= 4 ? 3 : 2]);
        rows.push({
          arc_deg: currentArc,
          pressure_bar: pressure,
          strip_width_m: parseDeNum(size[1]),
          strip_length_m: parseDeNum(size[2]),
          radius_m: null,
          flow_l_min: flowN,
          precipitation_square_mm_h: precipSq,
          precipitation_triangle_mm_h: precipTri,
        });
      }
      continue;
    }

    // Standard: [arc°] pressure radius flow precip precip
    if (nums.length >= 5) {
      let i = 0;
      let arc = currentArc;
      if (arcOnly) {
        arc = parseInt(arcOnly[1], 10);
        currentArc = arc;
        // nums[0] is arc
        i = 1;
      }
      if (nums.length - i < 5) continue;
      const pressure = parseDeNum(nums[i]);
      const radius = parseDeNum(nums[i + 1]);
      const flow = parseDeNum(nums[i + 2]);
      const precipSq = parseDeNum(nums[i + 3]);
      const precipTri = parseDeNum(nums[i + 4]);
      if (pressure == null || radius == null || flow == null) continue;
      if (pressure < 1 || pressure > 8) continue;
      if (radius > 30) continue;
      rows.push({
        arc_deg: arc,
        pressure_bar: pressure,
        radius_m: radius,
        flow_l_min: flow,
        precipitation_square_mm_h: precipSq,
        precipitation_triangle_mm_h: precipTri,
      });
    } else if (nums.length === 4 || (nums.length === 5 && !arcOnly)) {
      // continuation without arc on line: pressure radius flow precip [precip]
      if (nums.length >= 4 && currentArc != null) {
        const pressure = parseDeNum(nums[0]);
        const radius = parseDeNum(nums[1]);
        const flow = parseDeNum(nums[2]);
        const precipSq = parseDeNum(nums[3]);
        const precipTri = nums[4] != null ? parseDeNum(nums[4]) : null;
        if (pressure == null || radius == null || flow == null) continue;
        if (pressure < 1 || pressure > 8) continue;
        rows.push({
          arc_deg: currentArc,
          pressure_bar: pressure,
          radius_m: radius,
          flow_l_min: flow,
          precipitation_square_mm_h: precipSq,
          precipitation_triangle_mm_h: precipTri,
        });
      }
    }
  }

  if (!rows.length) return null;

  const pressures = rows.map((r) => r.pressure_bar as number).filter(Number.isFinite);
  const radii = rows.map((r) => r.radius_m as number).filter((x) => x != null && Number.isFinite(x));
  const flows = rows.map((r) => r.flow_l_min as number).filter(Number.isFinite);

  return {
    table_id: `radius_flow_${opts.modelKey.toLowerCase().replace(/\s+/g, "_")}`,
    table_type: "radius_flow",
    model_key: opts.modelKey,
    units: {
      pressure: "bar",
      radius: "m",
      flow: "l_min",
      precipitation: "mm_h",
    },
    columns: [
      "arc_deg",
      "pressure_bar",
      "radius_m",
      "flow_l_min",
      "precipitation_square_mm_h",
      "precipitation_triangle_mm_h",
    ],
    rows,
    notes: [
      "Leistungsdaten Rain Bird R-VAN (metrisch).",
      "Durchfluss in l/min laut Hersteller (Spalte l/m).",
      pressures.length
        ? `Druckbereich in Tabelle: ${Math.min(...pressures)}–${Math.max(...pressures)} bar`
        : "",
      radii.length ? `Radius in Tabelle: ${Math.min(...radii)}–${Math.max(...radii)} m` : "",
      flows.length ? `Durchfluss in Tabelle: ${Math.min(...flows)}–${Math.max(...flows)} l/min` : "",
    ].filter(Boolean),
    provenance: prov(opts.sourceUrl, opts.documentTitle),
  };
}

const NOZZLE_SIZES = new Set([0.75, 1, 1.0, 1.5, 2, 2.0, 3, 3.0, 4, 4.0]);

/**
 * Rain Bird 3500 Leistungsdaten (Informationen PDF):
 * nozzle? pressure_bar radius_m flow_m3_h precip precip
 */
export function parse3500LeistungsdatenFromPdf(
  text: string,
  opts: {
    modelKey: string;
    sourceUrl: string | null;
    documentTitle: string | null;
  },
): { table: PerformanceTable; kenndaten: RotorKenndaten } | null {
  const start = text.search(/3504|LEISTUNGSDATEN|1,\s*7\s+4,\s*6/i);
  if (start < 0) return null;
  const chunk = text.slice(start, start + 1800);
  const lines = chunk.split(/\n+/);
  const rows: PerformanceTable["rows"] = [];
  let nozzle: number | null = null;
  const pending: { pressure: number; radius: number; flow: number; p1: number | null; p2: number | null }[] =
    [];

  const flushPending = (n: number) => {
    for (const p of pending) {
      rows.push({
        nozzle_size: n,
        pressure_bar: p.pressure,
        radius_m: p.radius,
        flow_m3_h: p.flow,
        flow_l_min: m3hToLMin(p.flow),
        precipitation_square_mm_h: p.p1,
        precipitation_triangle_mm_h: p.p2,
      });
    }
    pending.length = 0;
  };

  for (const line of lines) {
    if (/KENNDATEN|BESCHREIBUNG|Bestellbeispiel|Typenreihe/i.test(line) && rows.length) break;
    const nums = [...line.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((x) => parseDeNum(x[1]!));
    const vals = nums.filter((n): n is number => n != null);
    if (vals.length < 5) continue;

    if (vals.length >= 6 && NOZZLE_SIZES.has(vals[0]!)) {
      if (pending.length && nozzle != null) flushPending(nozzle);
      else if (pending.length) {
        // leading rows without nozzle → assign to this nozzle
        flushPending(vals[0]!);
      }
      nozzle = vals[0]!;
      rows.push({
        nozzle_size: nozzle,
        pressure_bar: vals[1],
        radius_m: vals[2],
        flow_m3_h: vals[3],
        flow_l_min: m3hToLMin(vals[3]!),
        precipitation_square_mm_h: vals[4],
        precipitation_triangle_mm_h: vals[5],
      });
      continue;
    }

    if (vals.length >= 5) {
      const pressure = vals[0]!;
      const radius = vals[1]!;
      const flow = vals[2]!;
      if (pressure < 1 || pressure > 6 || radius < 2 || radius > 20 || flow > 5) continue;
      const row = {
        pressure,
        radius,
        flow,
        p1: vals[3] ?? null,
        p2: vals[4] ?? null,
      };
      if (nozzle != null) {
        rows.push({
          nozzle_size: nozzle,
          pressure_bar: row.pressure,
          radius_m: row.radius,
          flow_m3_h: row.flow,
          flow_l_min: m3hToLMin(row.flow),
          precipitation_square_mm_h: row.p1,
          precipitation_triangle_mm_h: row.p2,
        });
      } else {
        pending.push(row);
      }
    }
  }
  if (pending.length && nozzle != null) flushPending(nozzle);
  if (!rows.length) return null;

  const kenndaten = extractRotorKenndaten(text);
  return {
    table: {
      table_id: `radius_flow_${opts.modelKey.toLowerCase().replace(/\s+/g, "_")}`,
      table_type: "radius_flow",
      model_key: opts.modelKey,
      units: { pressure: "bar", radius: "m", flow: "l_min", precipitation: "mm_h" },
      columns: [
        "nozzle_size",
        "pressure_bar",
        "radius_m",
        "flow_m3_h",
        "flow_l_min",
        "precipitation_square_mm_h",
        "precipitation_triangle_mm_h",
      ],
      rows,
      notes: ["Leistungsdaten Rain Bird 3500 (metrisch, bar / m / m³/h)."],
      provenance: prov(opts.sourceUrl, opts.documentTitle),
    },
    kenndaten,
  };
}

export type RotorKenndaten = {
  radius_min_m: number | null;
  radius_max_m: number | null;
  pressure_min_bar: number | null;
  pressure_max_bar: number | null;
  flow_min_l_min: number | null;
  flow_max_l_min: number | null;
  arc_min_deg: number | null;
  arc_max_deg: number | null;
  pop_up_height_mm: number | null;
  body_height_mm: number | null;
  check_valve_max_elevation_m: number | null;
  sources: string[];
};

export function extractRotorKenndaten(text: string): RotorKenndaten {
  const out: RotorKenndaten = {
    radius_min_m: null,
    radius_max_m: null,
    pressure_min_bar: null,
    pressure_max_bar: null,
    flow_min_l_min: null,
    flow_max_l_min: null,
    arc_min_deg: null,
    arc_max_deg: null,
    pop_up_height_mm: null,
    body_height_mm: null,
    check_valve_max_elevation_m: null,
    sources: [],
  };

  const wurf =
    text.match(/[Ww]urfweite[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*m/) ||
    text.match(/[Rr]adius[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*m/);
  if (wurf) {
    out.radius_min_m = parseDeNum(wurf[1]);
    out.radius_max_m = parseDeNum(wurf[2]);
    out.sources.push("wurfweite");
  }
  const druck =
    text.match(/[Dd]ruck[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*bar/) ||
    text.match(/druckbereich[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*bar/i);
  if (druck) {
    out.pressure_min_bar = parseDeNum(druck[1]);
    out.pressure_max_bar = parseDeNum(druck[2]);
    out.sources.push("druck");
  }
  const flow = text.match(
    /[Dd]urchfl\s*ussmenge[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*m\s*3\s*\/\s*h/i,
  );
  if (flow) {
    out.flow_min_l_min = m3hToLMin(parseDeNum(flow[1])!);
    out.flow_max_l_min = m3hToLMin(parseDeNum(flow[2])!);
    out.sources.push("durchfluss");
  }
  const arc =
    text.match(/Teilkreiseinstellung[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*°/) ||
    text.match(/([\d,]+)\s*bis\s*([\d,]+)\s*°/);
  if (arc) {
    out.arc_min_deg = parseDeNum(arc[1]);
    out.arc_max_deg = parseDeNum(arc[2]);
    out.sources.push("arc");
  }
  const pop = text.match(/Aufsteigerhöhe[:\s]*([\d,]+)\s*cm/i);
  if (pop) {
    out.pop_up_height_mm = Math.round((parseDeNum(pop[1]) ?? 0) * 10) || null;
    out.sources.push("pop_up");
  }
  const body = text.match(/Höhe des Gehäuses[:\s]*([\d,]+)\s*cm/i);
  if (body) {
    out.body_height_mm = Math.round((parseDeNum(body[1]) ?? 0) * 10) || null;
    out.sources.push("body_height");
  }
  const sam = text.match(/bis\s*zu\s*([\d,]+)\s*m\s*Höhenunterschied/i);
  if (sam) {
    out.check_valve_max_elevation_m = parseDeNum(sam[1]);
    out.sources.push("sam");
  }
  return out;
}

/** HV/DV operating ranges from install PDF (EN or DE blocks). */
export function extractHvDvOperatingRange(text: string): {
  flow_min_l_min: number | null;
  flow_max_l_min: number | null;
  pressure_min_bar: number | null;
  pressure_max_bar: number | null;
  sources: string[];
} {
  const out = {
    flow_min_l_min: null as number | null,
    flow_max_l_min: null as number | null,
    pressure_min_bar: null as number | null,
    pressure_max_bar: null as number | null,
    sources: [] as string[],
  };

  // English: Flow ... (0,05 - 6,81 m3/h
  const m3en = text.match(
    /Flow[^\n]*\n?[^\n]*\(([\d,]+)\s*-\s*([\d,]+)\s*m\s*3\s*\/\s*h/i,
  );
  // German DV block: 0,05 - 9,08 m3/h
  const m3de = text.match(/([\d,]+)\s*-\s*([\d,]+)\s*m\s*3\s*\/\s*h/i);
  const m3 = m3en || m3de;
  if (m3) {
    out.flow_min_l_min = m3hToLMin(parseDeNum(m3[1])!);
    out.flow_max_l_min = m3hToLMin(parseDeNum(m3[2])!);
    out.sources.push("flow_m3h");
  }

  const barEn = text.match(/Pressure[^\n]*\n?[^\n]*\(([\d,]+)\s*-\s*([\d,]+)\s*bar\)/i);
  const barDe = text.match(/([\d,]+)\s*-\s*([\d,]+)\s*Bar\b/);
  const bar = barEn || barDe;
  if (bar) {
    out.pressure_min_bar = parseDeNum(bar[1]);
    out.pressure_max_bar = parseDeNum(bar[2]);
    out.sources.push("pressure_bar");
  }
  return out;
}

/** Hunter MP Rotator radius / precip from short install PDF or marketing PDF. */
export function extractMpRotatorSpecs(
  text: string,
  modelKey: string,
): {
  radius_min_m: number | null;
  radius_max_m: number | null;
  precipitation_rate_mm_h: number | null;
  pressure_recommended_bar: number | null;
  sources: string[];
} {
  const out = {
    radius_min_m: null as number | null,
    radius_max_m: null as number | null,
    precipitation_rate_mm_h: null as number | null,
    pressure_recommended_bar: null as number | null,
    sources: [] as string[],
  };
  const key = modelKey.replace(/\s+/g, "").toUpperCase(); // MP2000

  const sane = (a: number | null, b: number | null) =>
    a != null && b != null && a >= 0.5 && a <= 20 && b >= a && b <= 35;

  // Prefer explicit "MP2000 4,0 bis 6,4 m" / "MP2000 … 4 m–6.4 m"
  const patterns = [
    new RegExp(
      `${key}[^\\n]{0,50}?(\\d+(?:[.,]\\d+)?)\\s*bis\\s*(\\d+(?:[.,]\\d+)?)\\s*m\\b`,
      "i",
    ),
    new RegExp(
      `${key}[^\\n]{0,80}?(\\d+(?:[.,]\\d+)?)\\s*m\\s*[–\\-]\\s*(\\d+(?:[.,]\\d+)?)\\s*m\\b`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const a = parseDeNum(m[1]);
    const b = parseDeNum(m[2]);
    if (!sane(a, b)) continue;
    out.radius_min_m = a;
    out.radius_max_m = b;
    out.sources.push("radius");
    break;
  }

  const precip = text.match(
    new RegExp(`${key}[\\s\\S]{0,120}?(\\d+(?:[.,]\\d+)?)\\s*mm\\s*/\\s*hr`, "i"),
  );
  if (precip) {
    const v = parseDeNum(precip[1]);
    if (v != null && v > 0 && v < 100) {
      out.precipitation_rate_mm_h = v;
      out.sources.push("precip");
    }
  }
  if (/PRS40[^\n]{0,80}?2[,.]8\s*bar|2[,.]8\s*bar[^\n]{0,40}?PRS40/i.test(text)) {
    out.pressure_recommended_bar = 2.8;
    out.sources.push("prs40");
  }
  return out;
}

/** Derive summary attrs from a radius_flow performance table. */
export function summarizeRadiusFlowTable(table: PerformanceTable): Record<string, number | null> {
  const pressures = table.rows
    .map((r) => r.pressure_bar)
    .filter((x): x is number => typeof x === "number");
  const radii = table.rows
    .map((r) => r.radius_m)
    .filter((x): x is number => typeof x === "number");
  const flows = table.rows
    .map((r) => r.flow_l_min)
    .filter((x): x is number => typeof x === "number");
  const precip = table.rows
    .map((r) => r.precipitation_square_mm_h ?? r.precipitation_triangle_mm_h)
    .filter((x): x is number => typeof x === "number" && x > 0);
  return {
    pressure_min_bar: pressures.length ? Math.min(...pressures) : null,
    pressure_max_bar: pressures.length ? Math.max(...pressures) : null,
    radius_min_m: radii.length ? Math.min(...radii) : null,
    radius_max_m: radii.length ? Math.max(...radii) : null,
    flow_min_l_min: flows.length ? Math.min(...flows) : null,
    flow_max_l_min: flows.length ? Math.max(...flows) : null,
    precipitation_rate_mm_h: precip.length
      ? Math.round((precip.reduce((a, b) => a + b, 0) / precip.length) * 10) / 10
      : null,
  };
}

export type KenndatenExtract = {
  flow_min_l_min: number | null;
  flow_max_l_min: number | null;
  pressure_min_bar: number | null;
  pressure_max_bar: number | null;
  coil_voltage_v: number | null;
  coil_current_inrush_a: number | null;
  coil_current_holding_a: number | null;
  body_material: string | null;
  flow_control_present: boolean | null;
  height_mm: number | null;
  length_mm: number | null;
  width_mm: number | null;
  sources: string[];
};

/** Extract valve Kenndaten from shop product text or PDF text. */
export function extractValveKenndaten(
  text: string,
  modelHint?: string | null,
): KenndatenExtract {
  const out: KenndatenExtract = {
    flow_min_l_min: null,
    flow_max_l_min: null,
    pressure_min_bar: null,
    pressure_max_bar: null,
    coil_voltage_v: null,
    coil_current_inrush_a: null,
    coil_current_holding_a: null,
    body_material: null,
    flow_control_present: null,
    height_mm: null,
    length_mm: null,
    width_mm: null,
    sources: [],
  };

  const flow =
    text.match(
      /[Dd]urchfl\s*ussmenge[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*m\s*3\s*\/\s*h/i,
    ) ||
    text.match(
      /durchflussmenge[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*m\s*3\s*\/\s*h/i,
    );
  if (flow) {
    const a = parseDeNum(flow[1]);
    const b = parseDeNum(flow[2]);
    if (a != null) out.flow_min_l_min = m3hToLMin(a);
    if (b != null) out.flow_max_l_min = m3hToLMin(b);
    out.sources.push("durchflussmenge");
  }

  const pr =
    text.match(/[Dd]ruckbereich[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*bar/i) ||
    text.match(/(?:^|\n)\s*[Dd]ruck[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*bar/i);
  if (pr) {
    out.pressure_min_bar = parseDeNum(pr[1]);
    out.pressure_max_bar = parseDeNum(pr[2]);
    out.sources.push("druckbereich");
  }

  const volt =
    text.match(/Magnetspule[:\s]*([\d,]+)\s*V/i) || text.match(/\b(24|9)\s*V(?:AC|DC)?\b/);
  if (volt) {
    out.coil_voltage_v = parseDeNum(volt[1]);
    out.sources.push("coil_voltage");
  }

  const inrush =
    text.match(/Anzugsstrom[:\s]*([\d,]+)\s*A/i) ||
    text.match(/Einschaltstrom[:\s]*([\d,]+)/i);
  const hold =
    text.match(/Betriebsstrom[:\s]*([\d,]+)\s*A/i) ||
    text.match(/Haltestrom[:\s]*([\d,]+)/i);
  if (inrush) {
    out.coil_current_inrush_a = parseDeNum(inrush[1]);
    out.sources.push("inrush");
  }
  if (hold) {
    out.coil_current_holding_a = parseDeNum(hold[1]);
    out.sources.push("holding");
  }

  if (/PVC/i.test(text)) {
    out.body_material = "PVC";
    out.sources.push("body_material");
  }
  if (/[Dd]urchflussregulierung|[Ff]low\s*[Cc]ontrol/i.test(text)) {
    out.flow_control_present = true;
    out.sources.push("flow_control");
  }

  if (modelHint) {
    const mk = modelHint
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "[-\\s]*");
    try {
      const dim = text.match(
        new RegExp(
          `${mk}[\\s\\S]{0,80}?Höhe[:\\s]*([\\d,]+)\\s*cm[\\s\\S]{0,40}?Länge[:\\s]*([\\d,]+)\\s*cm[\\s\\S]{0,40}?Breite[:\\s]*([\\d,]+)\\s*cm`,
          "i",
        ),
      );
      if (dim) {
        const h = parseDeNum(dim[1]);
        const l = parseDeNum(dim[2]);
        const w = parseDeNum(dim[3]);
        out.height_mm = h == null ? null : Math.round(h * 10);
        out.length_mm = l == null ? null : Math.round(l * 10);
        out.width_mm = w == null ? null : Math.round(w * 10);
        out.sources.push("dimensions");
      }
    } catch {
      /* ignore bad model hint regex */
    }
  }

  return out;
}

export type ManifoldExtract = {
  article: string | null;
  outlet_count: number | null;
  telescopic: boolean | null;
  body_material: string | null;
  thread_size_inch: string | null;
  notes: string[];
};

/** Extract PVC Verteiler / manifold facts from product text. */
export function extractManifoldFromText(text: string, title: string): ManifoldExtract {
  const blob = `${title}\n${text}`;
  const art =
    blob.match(/\b(RB\d{3,5}[-–]?\d{0,4})\b/i) ||
    blob.match(/Artikel[- ]?(?:Nummer)?[:\s]*([A-Z0-9-]+)/i);
  const outlets =
    blob.match(/(\d+)\s*Fach/i) || blob.match(/(\d+)\s*x\s*1\s*(?:["”″]|Zoll)/i);
  return {
    article: art ? art[1].replace("–", "-") : null,
    outlet_count: outlets ? parseInt(outlets[1], 10) : null,
    telescopic: /[Tt]eleskop/i.test(blob) ? true : null,
    body_material: /PVC/i.test(blob) ? "PVC" : null,
    thread_size_inch: /1\s*(?:["”″]|Zoll)/i.test(blob) ? '1"' : null,
    notes: [
      /[Oo]-?[Rr]inge/i.test(blob) ? "Große O-Ringe (Herstellerhinweis)" : null,
      /kein\s+Teflon/i.test(blob) ? "Kein Teflonband notwendig (Herstellerhinweis)" : null,
    ].filter(Boolean) as string[],
  };
}

/** Shop product text: Wurfweite / Druck / Durchfluss / Aufsteiger (DE). */
export function extractShopSprinklerKenndaten(text: string): RotorKenndaten {
  const out = extractRotorKenndaten(text);
  const blob = text.replace(/\s+/g, " ");

  if (out.radius_min_m == null || out.radius_max_m == null) {
    const w =
      blob.match(/Wur[f]?weite[:\s]*([\d,]+)\s*m\s*[-–bis]+\s*([\d,]+)\s*m/i) ||
      blob.match(/Radius[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*m/i);
    if (w) {
      out.radius_min_m = parseDeNum(w[1]);
      out.radius_max_m = parseDeNum(w[2]);
      out.sources.push("shop_wurfweite");
    }
  }

  if (out.pressure_min_bar == null || out.pressure_max_bar == null) {
    const d =
      blob.match(
        /(?:Empfohlener\s+)?Druck(?:bereich)?[:\s]*([\d,]+)\s*bis\s*([\d,]+)\s*[Bb]ar/i,
      ) ||
      blob.match(/([\d,]+)\s*bis\s*([\d,]+)\s*[Bb]ar[;,]?\s*\d+\s*bis\s*\d+\s*kPa/i);
    if (d) {
      out.pressure_min_bar = parseDeNum(d[1]);
      out.pressure_max_bar = parseDeNum(d[2]);
      out.sources.push("shop_druck");
    }
  }

  if (out.flow_min_l_min == null || out.flow_max_l_min == null) {
    const fM3 =
      blob.match(
        /Durchfluss[:\s]*([\d,]+)\s*[-–]\s*([\d,]+)\s*m\s*[³3]\s*\/\s*(?:Std|h)/i,
      ) ||
      blob.match(/([\d,]+)\s*bis\s*([\d,]+)\s*m\s*3\s*\/\s*h/i);
    if (fM3) {
      out.flow_min_l_min = m3hToLMin(parseDeNum(fM3[1])!);
      out.flow_max_l_min = m3hToLMin(parseDeNum(fM3[2])!);
      out.sources.push("shop_flow_m3h");
    } else {
      const fL =
        blob.match(/Durchfluss[:\s]*([\d,]+)\s*[-–]\s*([\d,]+)\s*l\s*\/\s*min/i) ||
        blob.match(/([\d,]+)\s*bis\s*([\d,]+)\s*l\s*\/\s*min/i);
      if (fL) {
        out.flow_min_l_min = parseDeNum(fL[1]);
        out.flow_max_l_min = parseDeNum(fL[2]);
        out.sources.push("shop_flow_lmin");
      }
    }
  }

  if (out.pop_up_height_mm == null) {
    const pop =
      blob.match(/Aufsteiger(?:höhe)?[:\s]*([\d,]+)\s*cm/i) ||
      blob.match(/([\d,]+)\s*cm\s*Aufsteiger/i);
    if (pop) {
      out.pop_up_height_mm = Math.round((parseDeNum(pop[1]) ?? 0) * 10) || null;
      out.sources.push("shop_pop");
    }
  }

  if (out.arc_min_deg == null || out.arc_max_deg == null) {
    const arc =
      blob.match(/Sektor(?:einstellung)?[:\s]*([\d,]+)\s*°?\s*bis\s*([\d,]+)\s*°/i) ||
      blob.match(/([\d,]+)\s*bis\s*([\d,]+)\s*°/);
    if (arc) {
      const a = parseDeNum(arc[1]);
      const b = parseDeNum(arc[2]);
      if (a != null && b != null && b <= 360 && a < b) {
        out.arc_min_deg = a;
        out.arc_max_deg = b;
        out.sources.push("shop_arc");
      }
    }
  }

  return out;
}

export type DripExtract = {
  outer_diameter_mm: number | null;
  emitter_flow_l_h: number | null;
  emitter_spacing_m: number | null;
  pressure_min_bar: number | null;
  pressure_max_bar: number | null;
  pressure_compensating: boolean | null;
  coil_length_m: number | null;
  sources: string[];
};

/** Tropfrohr / XFD / XFS / HydroPC from shop text or datasheet. */
export function extractDripSpecs(text: string): DripExtract {
  const blob = text.replace(/\s+/g, " ");
  const out: DripExtract = {
    outer_diameter_mm: null,
    emitter_flow_l_h: null,
    emitter_spacing_m: null,
    pressure_min_bar: null,
    pressure_max_bar: null,
    pressure_compensating: null,
    coil_length_m: null,
    sources: [],
  };

  const od =
    blob.match(/\b(\d{2})\s*mm\b/) ||
    blob.match(/Außendurchmesser[:\s]*([\d,]+)\s*mm/i);
  if (od) {
    out.outer_diameter_mm = parseDeNum(od[1]);
    out.sources.push("od");
  }

  const flow =
    blob.match(/([\d,]+)\s*l\s*\/\s*h/i) ||
    blob.match(/Tropfer(?:leistung)?[:\s]*([\d,]+)/i);
  if (flow) {
    const v = parseDeNum(flow[1]);
    if (v != null && v > 0 && v < 20) {
      out.emitter_flow_l_h = v;
      out.sources.push("emitter_flow");
    }
  }

  const sp =
    blob.match(/(?:Tropfer)?[Aa]bstand[:\s]*([\d,]+)\s*cm/i) ||
    blob.match(/Abstand\s*([\d,]+)\s*cm/i) ||
    blob.match(/([\d,]+)\s*cm\s*Tropfer/i);
  if (sp) {
    const cm = parseDeNum(sp[1]);
    if (cm != null && cm >= 10 && cm <= 100) {
      out.emitter_spacing_m = Math.round((cm / 100) * 1000) / 1000;
      out.sources.push("spacing");
    }
  }

  const pmax =
    blob.match(/[Dd]ruck[:\s]*bis\s*([\d,]+)\s*[Bb]ar/i) ||
    blob.match(/[Mm]ax\.?\s*[Dd]ruck[:\s]*([\d,]+)\s*[Bb]ar/i) ||
    blob.match(/([\d,]+)\s*[Bb]ar\s*max/i);
  if (pmax) {
    out.pressure_max_bar = parseDeNum(pmax[1]);
    out.sources.push("pmax");
  }
  const prange = blob.match(
    /[Bb]etriebsdruck[:\s]*([\d,]+)\s*[-–bis]+\s*([\d,]+)\s*[Bb]ar/i,
  );
  if (prange) {
    out.pressure_min_bar = parseDeNum(prange[1]);
    out.pressure_max_bar = parseDeNum(prange[2]);
    out.sources.push("prange");
  }

  if (/druckkompens|pressure.?compensat|PC\b|XFD|XFS|HydroPC/i.test(blob)) {
    out.pressure_compensating = true;
    out.sources.push("pc");
  }

  const len =
    blob.match(/([\d,]+)\s*m\s*\/\s*Rolle/i) ||
    blob.match(/([\d,]+)\s*m(?:\/Rolle)?[,.]?\s*(?:Abstand|Tropfer)/i) ||
    blob.match(/\b(\d{2,3})\s*m\b/);
  if (len) {
    const L = parseDeNum(len[1]);
    if (L != null && [25, 30, 50, 100, 200, 400].includes(L)) {
      out.coil_length_m = L;
      out.sources.push("coil");
    }
  }

  return out;
}

export type FilterPrvExtract = {
  filtration_micron: number | null;
  filtration_mesh: number | null;
  filter_element_type: string | null;
  pressure_min_bar: number | null;
  pressure_max_bar: number | null;
  regulated_pressure_bar: number | null;
  regulated_pressure_min_bar: number | null;
  regulated_pressure_max_bar: number | null;
  flow_min_l_min: number | null;
  flow_max_l_min: number | null;
  sources: string[];
};

/** Filter / PRV / ACCU-SYNC / RBY / PSI-M from text+PDF. */
export function extractFilterPrvSpecs(text: string): FilterPrvExtract {
  const blob = text.replace(/\s+/g, " ");
  const out: FilterPrvExtract = {
    filtration_micron: null,
    filtration_mesh: null,
    filter_element_type: null,
    pressure_min_bar: null,
    pressure_max_bar: null,
    regulated_pressure_bar: null,
    regulated_pressure_min_bar: null,
    regulated_pressure_max_bar: null,
    flow_min_l_min: null,
    flow_max_l_min: null,
    sources: [],
  };

  const mesh =
    blob.match(/(\d+)\s*mesh/i) ||
    blob.match(/Mesh[:\s]*(\d+)/i);
  if (mesh) {
    out.filtration_mesh = parseInt(mesh[1], 10);
    out.sources.push("mesh");
  }
  const micron =
    blob.match(/(\d+)\s*micron/i) ||
    blob.match(/([\d,]+)\s*µm/i) ||
    blob.match(/\((\d+)\s*micron\)/i);
  if (micron) {
    out.filtration_micron = parseDeNum(micron[1]);
    out.sources.push("micron");
  }

  if (/Sieb|screen|Edelstahl(?:sieb|gewebe)/i.test(blob)) {
    out.filter_element_type = "screen";
    out.sources.push("element_screen");
  } else if (/Scheiben|disc/i.test(blob)) {
    out.filter_element_type = "disc";
    out.sources.push("element_disc");
  }

  // Fixed outlet: PSI-M15 1,0 bar / PRF … 2,1 bar / Netafim 2,5 bar
  const fixed =
    blob.match(
      /(?:Ausgang|Ausgangdruck|Ausgangsdruck|voreingestellt(?:er)?\s+Ausgangsdruck|Druckreduzierung auf|Regulierung auf|fest\s+eingestellt\s+auf)[:\s]*([\d,]+)\s*[Bb]ar/i,
    ) ||
    blob.match(/PSI-M\d+[:\s]*([\d,]+)\s*bar/i) ||
    blob.match(/\b([\d,]+)\s*bar\s*(?:voreingestellt|Ausgang)/i);
  if (fixed) {
    out.regulated_pressure_bar = parseDeNum(fixed[1]);
    out.sources.push("regulated_fixed");
  }

  const adj =
    blob.match(
      /(?:Regulierung|einstellbar|Druckminderung)\s*(?:von\s*)?([\d,]+)\s*bis\s*([\d,]+)\s*[Bb]ar/i,
    ) ||
    blob.match(/([\d,]+)\s*bis\s*([\d,]+)\s*[Bb]ar[;,]?\s*\d+\s*bis\s*\d+\s*kPa/i);
  if (adj) {
    out.regulated_pressure_min_bar = parseDeNum(adj[1]);
    out.regulated_pressure_max_bar = parseDeNum(adj[2]);
    if (out.regulated_pressure_bar == null) {
      out.regulated_pressure_bar = out.regulated_pressure_max_bar;
    }
    out.sources.push("regulated_range");
  }

  const pmax =
    blob.match(/(?:Maximaler\s+)?Betriebsdruck[:\s]*([\d,]+)\s*[Bb]ar/i) ||
    blob.match(/Statischer\s+Druck[:\s]*([\d,]+)\s*[Bb]ar/i) ||
    blob.match(/[Mm]ax\.?\s*[Dd]ruck[:\s]*([\d,]+)\s*[Bb]ar/i);
  if (pmax) {
    out.pressure_max_bar = parseDeNum(pmax[1]);
    out.sources.push("pmax");
  }
  const pmin =
    blob.match(/Minimum\s+Reinigungsdruck[:\s]*([\d,]+)\s*[Bb]ar/i) ||
    blob.match(/[Mm]in\.?\s*[Dd]ruck[:\s]*([\d,]+)\s*[Bb]ar/i);
  if (pmin) {
    out.pressure_min_bar = parseDeNum(pmin[1]);
    out.sources.push("pmin");
  }

  // Flow: 0.20 to 12.0 gpm (0.8 to 45.4 l/m) OR 25 m³/h
  const fl =
    blob.match(/\(([\d,]+)\s*to\s*([\d,]+)\s*l\s*\/\s*m\)/i) ||
    blob.match(/([\d,]+)\s*bis\s*([\d,]+)\s*l\s*\/\s*min/i) ||
    blob.match(/Flow[:\s]*([\d,]+)\s*to\s*([\d,]+)\s*gpm[^(]*\(([\d,]+)\s*to\s*([\d,]+)/i);
  if (fl && fl[4]) {
    out.flow_min_l_min = parseDeNum(fl[3]);
    out.flow_max_l_min = parseDeNum(fl[4]);
    out.sources.push("flow_gpm_paren");
  } else if (fl) {
    out.flow_min_l_min = parseDeNum(fl[1]);
    out.flow_max_l_min = parseDeNum(fl[2]);
    out.sources.push("flow_lmin");
  } else {
    const m3 = blob.match(/(?:Maximal|bis)\s*([\d,]+)\s*m\s*[³3]\s*\/\s*h/i);
    if (m3) {
      out.flow_max_l_min = m3hToLMin(parseDeNum(m3[1])!);
      out.sources.push("flow_m3h_max");
    }
  }

  return out;
}

export type PePipeExtract = {
  material: string | null;
  outer_diameter_mm: number | null;
  wall_thickness_mm: number | null;
  internal_diameter_mm: number | null;
  sdr: string | null;
  pressure_rating_bar: number | null;
  length_m: number | null;
  potable_water_approved: boolean | null;
  sources: string[];
};

/** PE hard/soft pipe from title+text. ID from OD+SDR when both known. */
export function extractPePipeSpecs(text: string): PePipeExtract {
  const blob = text.replace(/\s+/g, " ");
  const out: PePipeExtract = {
    material: /PE100/i.test(blob) ? "PE100" : /PE80/i.test(blob) ? "PE80" : /PE/i.test(blob) ? "PE" : null,
    outer_diameter_mm: null,
    wall_thickness_mm: null,
    internal_diameter_mm: null,
    sdr: null,
    pressure_rating_bar: null,
    length_m: null,
    potable_water_approved: /Trinkwasser|DVGW|potable/i.test(blob) ? true : null,
    sources: [],
  };
  if (out.material) out.sources.push("material");
  if (out.potable_water_approved) out.sources.push("potable");

  const od = blob.match(/\bPE[-\s]?(?:Rohr)?\s*(\d{2})\s*mm\b/i) || blob.match(/\b(\d{2})\s*mm\b/);
  if (od) {
    const n = parseInt(od[1], 10);
    if ([16, 20, 25, 32, 40, 50, 63, 75, 90, 110].includes(n)) {
      out.outer_diameter_mm = n;
      out.sources.push("od");
    }
  }

  const sdr = blob.match(/\bSDR\s*(\d{2})\b/i);
  if (sdr) {
    out.sdr = sdr[1];
    out.sources.push("sdr");
  }

  const pn =
    blob.match(/\bPN\s*(\d{1,2})\b/i) ||
    blob.match(/(\d{1,2})\s*bar/i) ||
    blob.match(/Druckstufe[:\s]*([\d,]+)/i);
  if (pn) {
    const v = parseDeNum(pn[1]);
    if (v != null && v >= 4 && v <= 25) {
      out.pressure_rating_bar = v;
      out.sources.push("pn");
    }
  }

  const wall = blob.match(/Wandstärke[:\s]*([\d,]+)\s*mm/i);
  if (wall) {
    out.wall_thickness_mm = parseDeNum(wall[1]);
    out.sources.push("wall");
  } else if (out.outer_diameter_mm != null && out.sdr) {
    const s = parseInt(out.sdr, 10);
    if (s > 0) {
      out.wall_thickness_mm = Math.round((out.outer_diameter_mm / s) * 100) / 100;
      out.sources.push("wall_from_sdr");
    }
  }

  if (out.outer_diameter_mm != null && out.wall_thickness_mm != null) {
    out.internal_diameter_mm =
      Math.round((out.outer_diameter_mm - 2 * out.wall_thickness_mm) * 100) / 100;
    out.sources.push("id_computed");
  }

  const len = blob.match(/([\d,]+)\s*m\s*\/\s*Rolle/i) || blob.match(/\b(\d{2,3})\s*m\b/);
  if (len) {
    const L = parseDeNum(len[1]);
    if (L != null && [1, 1.5, 25, 50, 100, 200].includes(L)) {
      out.length_m = L;
      out.sources.push("length");
    }
  }

  return out;
}

export type ValveBoxExtract = {
  outer_length_mm: number | null;
  outer_width_mm: number | null;
  outer_height_mm: number | null;
  outer_diameter_mm: number | null;
  max_valve_count: number | null;
  body_material: string | null;
  sources: string[];
};

export function extractValveBoxSpecs(text: string): ValveBoxExtract {
  const blob = text.replace(/\s+/g, " ");
  const out: ValveBoxExtract = {
    outer_length_mm: null,
    outer_width_mm: null,
    outer_height_mm: null,
    outer_diameter_mm: null,
    max_valve_count: null,
    body_material: /Kunststoff|PP|Polypropylen|Polyethylene|PE\b/i.test(blob)
      ? "plastic"
      : null,
    sources: [],
  };
  if (out.body_material) out.sources.push("material");

  const dims =
    blob.match(
      /([\d,]+)\s*[x×]\s*([\d,]+)\s*[x×]\s*([\d,]+)\s*mm/i,
    ) ||
    blob.match(
      /(?:Maße|Abmessungen)[:\s]*([\d,]+)\s*[x×]\s*([\d,]+)\s*[x×]\s*([\d,]+)/i,
    );
  if (dims) {
    out.outer_length_mm = Math.round(parseDeNum(dims[1])!);
    out.outer_width_mm = Math.round(parseDeNum(dims[2])!);
    out.outer_height_mm = Math.round(parseDeNum(dims[3])!);
    out.sources.push("dims_lwh");
  }

  const dia = blob.match(/[Øø]\s*([\d,]+)\s*mm|Durchmesser[:\s]*([\d,]+)\s*mm/i);
  if (dia) {
    out.outer_diameter_mm = Math.round(parseDeNum(dia[1] || dia[2])!);
    out.sources.push("diameter");
  }

  const vc =
    blob.match(/(\d+)\s*Ventile?/i) ||
    blob.match(/für\s*(\d+)\s*(?:Magnet)?ventile/i);
  if (vc) {
    out.max_valve_count = parseInt(vc[1], 10);
    out.sources.push("valve_count");
  }

  return out;
}

/**
 * Hunter PGP / I-20 style Leistungsdaten blocks:
 *   PGP BLAUE DÜSE – LEISTUNGSDATEN
 *   Düse Druck Wurfweite Durchfluss ...
 *   1,5 1,7 170 8,8 0,27 4,5 ...
 * First token may be nozzle id; pressure in bar is typically 1.7–4.5.
 */
export function parsePgpLeistungsdatenFromPdf(
  text: string,
  opts: {
    modelKey: string;
    sourceUrl: string | null;
    documentTitle: string | null;
  },
): PerformanceTable | null {
  const idx = text.search(/LEISTUNGSDATEN/i);
  if (idx < 0) return null;
  const chunk = text.slice(idx, idx + 12000);
  const rows: PerformanceTable["rows"] = [];
  let currentNozzle: string | null = null;

  for (const raw of chunk.split(/\n+/)) {
    const line = raw.replace(/\t/g, " ").trim();
    if (!line || /Hinweis|Niederschlag|Besuchen|Seite|of \d/i.test(line)) continue;
    if (/LEISTUNGSDATEN|Düse\s+Druck|Wurf/i.test(line)) continue;

    // "Blau  2,5  250  9,4 ..." or "1,5 1,7 170 8,8 0,27 4,5"
    const colorNozzle = line.match(/^(Blau|Rot|Grau|Black|Blue|Red|Gray)\s+(.+)$/i);
    const body = colorNozzle ? colorNozzle[2] : line;
    if (colorNozzle) {
      // keep previous nozzle number if present on earlier line
    }

    const nums = [...body.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((x) => x[1]);
    if (nums.length < 5) {
      // nozzle-only line like "2,0" or "8,0"
      if (nums.length === 1) {
        const n = parseDeNum(nums[0]);
        if (n != null && n <= 20) currentNozzle = String(n);
      }
      continue;
    }

    // Heuristic: find bar in 1.5–5.0 then radius then m3/h then l/min
    let pressure: number | null = null;
    let radius: number | null = null;
    let flowM3: number | null = null;
    let flowL: number | null = null;
    const parsed = nums.map(parseDeNum).filter((n): n is number => n != null);

    // Pattern A: nozzle, bar, kPa, m, m3/h, l/min, precip...
    // Pattern B: bar, kPa, m, m3/h, l/min...
    let start = 0;
    if (parsed[0] != null && parsed[0] <= 12 && parsed[1] != null && parsed[1] >= 1.5 && parsed[1] <= 5.5) {
      currentNozzle = String(parsed[0]);
      start = 1;
    }
    if (parsed[start] != null && parsed[start] >= 1.5 && parsed[start] <= 5.5) {
      pressure = parsed[start];
      // skip kPa if next is ~100x
      let i = start + 1;
      if (parsed[i] != null && parsed[i] >= 100 && parsed[i] <= 600) i++;
      radius = parsed[i] ?? null;
      flowM3 = parsed[i + 1] ?? null;
      flowL = parsed[i + 2] ?? null;
    }

    if (pressure == null || radius == null || radius < 2 || radius > 30) continue;
    if (flowM3 == null || flowM3 > 20) continue;

    rows.push({
      nozzle: currentNozzle,
      pressure_bar: pressure,
      radius_m: radius,
      flow_m3_h: flowM3,
      flow_l_min: flowL ?? m3hToLMin(flowM3),
    });
  }

  if (rows.length < 8) return null;

  return {
    table_id: `radius_flow_${opts.modelKey.toLowerCase().replace(/\s+/g, "_")}`,
    table_type: "radius_flow",
    model_key: opts.modelKey,
    units: { pressure: "bar", radius: "m", flow: "l_min" },
    columns: ["nozzle", "pressure_bar", "radius_m", "flow_m3_h", "flow_l_min"],
    rows,
    notes: ["Leistungsdaten aus Hersteller-PDF (Hunter Kenndaten)."],
    provenance: prov(opts.sourceUrl, opts.documentTitle),
  };
}
