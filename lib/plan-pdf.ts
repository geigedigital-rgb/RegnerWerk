import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { SavedPlotProject } from "@/lib/project-storage";

type ProjectPayload = SavedPlotProject & {
  sofortPlan: NonNullable<SavedPlotProject["sofortPlan"]>;
};

const FOREST = rgb(0.043, 0.141, 0.078);
const FOREST_MID = rgb(0.12, 0.28, 0.18);
const AQUA = rgb(0, 1, 0.812);
const MINT = rgb(0.93, 0.97, 0.95);
const GRAY = rgb(0.35, 0.4, 0.38);
const LINE = rgb(0.75, 0.82, 0.78);
const WHITE = rgb(1, 1, 1);

/** A4 landscape points */
const W = 841.89;
const H = 595.28;
const MARGIN = 36;

type PdfMeta = {
  projectId: string;
  customerName?: string | null;
  customerEmail?: string | null;
};

type Pt = { x: number; y: number };

function placeLabel(payload: ProjectPayload): string {
  const p = payload.place as Record<string, unknown>;
  return String(
    p.placeName || p.place_name || p.text || p.address || payload.place.id,
  );
}

/** Helvetica/WinAnsi-safe text (pdf-lib throws on arrows, em-dash, etc.). */
function winAnsi(text: string): string {
  return text
    .replace(/\u2192|\u2190|\u21D2|\u21D0/g, "->") // → ← ⇒ ⇐
    .replace(/\u2248|\u2243/g, "~") // ≈ ≃
    .replace(/\u00D7|\u2715/g, "x") // × ✕
    .replace(/\u00B7|\u2022|\u2023/g, "-") // · •
    .replace(/[\u2013\u2014\u2212]/g, "-") // – — −
    .replace(/\u2026/g, "...") // …
    .replace(/\u00A0/g, " ")
    .replace(/\u2265/g, ">=") // ≥
    .replace(/\u2264/g, "<=") // ≤
    .replace(/\u00B3/g, "3") // ³ (m³ often ok in WinAnsi actually)
    .replace(/\u00B2/g, "2")
    .replace(/[^\x00-\xFF]/g, "?");
}

function euro(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "-";
  return (
    v.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " EUR"
  );
}

function drawSafeText(
  page: PDFPage,
  text: string,
  opts: Parameters<PDFPage["drawText"]>[1],
) {
  page.drawText(winAnsi(text), opts);
}

/** Approximate meters from lng/lat relative to origin (equirectangular). */
function toMeters(lng: number, lat: number, oLng: number, oLat: number): Pt {
  const cos = Math.cos((oLat * Math.PI) / 180);
  const x = (lng - oLng) * 111_320 * cos;
  const y = (lat - oLat) * 110_540;
  return { x, y };
}

function drawHeader(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  title: string,
  subtitle: string,
) {
  page.drawRectangle({
    x: 0,
    y: H - 48,
    width: W,
    height: 48,
    color: FOREST,
  });
  drawSafeText(page, "RegnerWerk", {
    x: MARGIN,
    y: H - 30,
    size: 14,
    font: bold,
    color: AQUA,
  });
  drawSafeText(page, title, {
    x: MARGIN + 110,
    y: H - 22,
    size: 11,
    font: bold,
    color: WHITE,
  });
  drawSafeText(page, subtitle, {
    x: MARGIN + 110,
    y: H - 36,
    size: 8,
    font,
    color: rgb(0.7, 0.85, 0.8),
  });
  drawSafeText(page, "Sofort-Berechnung - Planungsexpose", {
    x: W - MARGIN - 160,
    y: H - 28,
    size: 8,
    font,
    color: rgb(0.65, 0.8, 0.75),
  });
}

function drawFooter(page: PDFPage, font: PDFFont, pageNo: number, total: number) {
  page.drawLine({
    start: { x: MARGIN, y: 28 },
    end: { x: W - MARGIN, y: 28 },
    thickness: 0.5,
    color: LINE,
  });
  drawSafeText(page, "Vertraulich - RegnerWerk Planung", {
    x: MARGIN,
    y: 14,
    size: 7,
    font,
    color: GRAY,
  });
  drawSafeText(page, `Seite ${pageNo} / ${total}`, {
    x: W - MARGIN - 50,
    y: 14,
    size: 7,
    font,
    color: GRAY,
  });
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  // Sanitise first — widthOfTextAtSize also WinAnsi-encodes and throws on → etc.
  const safe = winAnsi(text);
  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawTableRow(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  y: number,
  cols: { text: string; x: number; w: number }[],
  opts?: { header?: boolean; alt?: boolean },
) {
  if (opts?.alt) {
    page.drawRectangle({
      x: MARGIN,
      y: y - 3,
      width: W - 2 * MARGIN,
      height: 14,
      color: MINT,
    });
  }
  const f = opts?.header ? bold : font;
  const size = opts?.header ? 8 : 7.5;
  for (const c of cols) {
    const t = c.text.length > 60 ? c.text.slice(0, 57) + "..." : c.text;
    drawSafeText(page, t, {
      x: c.x,
      y,
      size,
      font: f,
      color: FOREST,
      maxWidth: c.w,
    });
  }
  return y - 14;
}

export async function buildProjectPdf(
  payload: ProjectPayload,
  meta: PdfMeta,
): Promise<Uint8Array> {
  const plan = payload.sofortPlan;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const address = placeLabel(payload);
  const dateStr = new Date().toLocaleDateString("de-DE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const pages: PDFPage[] = [];

  // -- 1. Deckblatt --
  {
    const page = doc.addPage([W, H]);
    pages.push(page);
    drawHeader(page, font, bold, "Projektübersicht", address);

    drawSafeText(page, "Bewässerungsplanung", {
      x: MARGIN,
      y: H - 100,
      size: 22,
      font: bold,
      color: FOREST,
    });
    drawSafeText(page, address, {
      x: MARGIN,
      y: H - 128,
      size: 12,
      font,
      color: FOREST_MID,
      maxWidth: W - 2 * MARGIN,
    });

    const infoY = H - 180;
    const boxW = (W - 2 * MARGIN - 24) / 4;
    const stats: [string, string][] = [
      ["Rasenfläche", `${Math.round(plan.lawnAreaM2)} m²`],
      ["Regner", String(plan.heads.length)],
      ["Hydraulikzonen", String(plan.zones.length)],
      ["Abdeckung", `${Math.round(plan.coveragePct)} %`],
    ];
    stats.forEach(([label, value], i) => {
      const x = MARGIN + i * (boxW + 8);
      page.drawRectangle({
        x,
        y: infoY - 40,
        width: boxW,
        height: 56,
        color: MINT,
        borderColor: LINE,
        borderWidth: 0.8,
      });
      drawSafeText(page, label, {
        x: x + 10,
        y: infoY + 2,
        size: 8,
        font,
        color: GRAY,
      });
      drawSafeText(page, value, {
        x: x + 10,
        y: infoY - 22,
        size: 16,
        font: bold,
        color: FOREST,
      });
    });

    let y = infoY - 80;
    drawSafeText(page, "Projektdaten", {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
      color: FOREST,
    });
    y -= 20;
    const rows: [string, string][] = [
      ["Datum", dateStr],
      ["Projekt-ID", meta.projectId],
      ["Kunde", meta.customerName || "-"],
      ["E-Mail", meta.customerEmail || "-"],
      ["Quellfluss", `${plan.sourceFlowLMin.toFixed(1)} l/min`],
      ["Tropffläche", `${Math.round(plan.dripAreaM2)} m²`],
      [
        "Material (bekannt)",
        (plan.hasUnknownPrices ? "ab " : "") + euro(plan.totalKnownEur),
      ],
      ["Zonen (Zeichnung)", String(payload.zones.length)],
      ["Technik-Punkte", String(payload.fixtures.length)],
    ];
    for (const [k, v] of rows) {
      drawSafeText(page, k, { x: MARGIN, y, size: 9, font, color: GRAY });
      drawSafeText(page, v, {
        x: MARGIN + 160,
        y,
        size: 9,
        font: bold,
        color: FOREST,
        maxWidth: 400,
      });
      y -= 16;
    }

    page.drawRectangle({
      x: MARGIN,
      y: 48,
      width: W - 2 * MARGIN,
      height: 36,
      color: FOREST,
    });
    drawSafeText(page, 
      "Hinweis: Sofort-Berechnung zur Orientierung. Fachplanung auf Anfrage.",
      {
        x: MARGIN + 12,
        y: 62,
        size: 8,
        font,
        color: WHITE,
      },
    );
  }

  // -- 2. Lageplan --
  {
    const page = doc.addPage([W, H]);
    pages.push(page);
    drawHeader(page, font, bold, "Lageplan", "Maßstäblicher Übersichtsplan (lokal, Meter)");

    const origin =
      payload.zones[0]?.coordinates[0] ??
      plan.heads[0]?.position ??
      ({ lng: 0, lat: 0 } as { lng: number; lat: number });

    const allPts: Pt[] = [];
    for (const z of payload.zones) {
      for (const c of z.coordinates) {
        allPts.push(toMeters(c.lng, c.lat, origin.lng, origin.lat));
      }
    }
    for (const h of plan.heads) {
      allPts.push(toMeters(h.position.lng, h.position.lat, origin.lng, origin.lat));
    }
    if (allPts.length === 0) allPts.push({ x: 0, y: 0 });

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of allPts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const pad = 2;
    minX -= pad;
    maxX += pad;
    minY -= pad;
    maxY += pad;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);

    const plotX = MARGIN;
    const plotY = 48;
    const plotW = W - 2 * MARGIN - 140;
    const plotH = H - 48 - 56;
    const scale = Math.min(plotW / spanX, plotH / spanY);

    const mapPt = (p: Pt) => ({
      x: plotX + (p.x - minX) * scale,
      y: plotY + (p.y - minY) * scale,
    });

    page.drawRectangle({
      x: plotX,
      y: plotY,
      width: plotW,
      height: plotH,
      color: rgb(0.97, 0.98, 0.97),
      borderColor: LINE,
      borderWidth: 1,
    });

    // Grid every ~5 m
    const step = spanX > 40 ? 10 : 5;
    for (let gx = Math.ceil(minX / step) * step; gx <= maxX; gx += step) {
      const a = mapPt({ x: gx, y: minY });
      const b = mapPt({ x: gx, y: maxY });
      page.drawLine({
        start: a,
        end: b,
        thickness: 0.3,
        color: rgb(0.85, 0.9, 0.87),
      });
    }
    for (let gy = Math.ceil(minY / step) * step; gy <= maxY; gy += step) {
      const a = mapPt({ x: minX, y: gy });
      const b = mapPt({ x: maxX, y: gy });
      page.drawLine({
        start: a,
        end: b,
        thickness: 0.3,
        color: rgb(0.85, 0.9, 0.87),
      });
    }

    const zoneColors: Record<string, ReturnType<typeof rgb>> = {
      rasen: rgb(0.45, 0.75, 0.45),
      gebaeude: rgb(0.55, 0.55, 0.55),
      tropf: rgb(0.35, 0.55, 0.75),
      weg: rgb(0.7, 0.65, 0.5),
    };

    for (const z of payload.zones) {
      const pts = z.coordinates.map((c) =>
        mapPt(toMeters(c.lng, c.lat, origin.lng, origin.lat)),
      );
      if (pts.length < 2) continue;
      const color = zoneColors[z.type] ?? rgb(0.6, 0.7, 0.6);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        page.drawLine({
          start: a,
          end: b,
          thickness: z.type === "rasen" ? 1.2 : 0.8,
          color,
        });
      }
    }

    // Heads + arcs
    // rotationDeg = CW from north; local meters are Y-north (same as planner).
    // Use compass→math: a = (90 - bearing) → x=cos(a), y=sin(a).
    // (SVG overlay uses Y-down, so it uses bearing-90 — do NOT copy that here.)
    for (const h of plan.heads) {
      const c = mapPt(
        toMeters(h.position.lng, h.position.lat, origin.lng, origin.lat),
      );
      const r = h.radiusM * scale;
      if (r > 1 && h.kind !== "strip") {
        const startDeg = h.rotationDeg - h.arcDeg / 2;
        const steps = Math.max(8, Math.round(h.arcDeg / 8));
        const ray = (bearingDeg: number): Pt => {
          const a = ((90 - bearingDeg) * Math.PI) / 180;
          return {
            x: c.x + r * Math.cos(a),
            y: c.y + r * Math.sin(a),
          };
        };
        let prev: Pt | null = null;
        for (let i = 0; i <= steps; i++) {
          const bearing = startDeg + (h.arcDeg * i) / steps;
          const p = ray(bearing);
          if (prev) {
            page.drawLine({
              start: prev,
              end: p,
              thickness: 0.5,
              color: rgb(0.1, 0.55, 0.85),
              opacity: 0.55,
            });
          }
          prev = p;
        }
        if (h.arcDeg < 360) {
          const p0 = ray(startDeg);
          const p1 = ray(startDeg + h.arcDeg);
          page.drawLine({
            start: c,
            end: p0,
            thickness: 0.4,
            color: rgb(0.1, 0.55, 0.85),
            opacity: 0.4,
          });
          page.drawLine({
            start: c,
            end: p1,
            thickness: 0.4,
            color: rgb(0.1, 0.55, 0.85),
            opacity: 0.4,
          });
        }
      }
      page.drawCircle({
        x: c.x,
        y: c.y,
        size: 2.2,
        color: FOREST,
      });
    }

    // Fixtures with kind labels
    const fixtureMeta: Record<
      string,
      { label: string; color: ReturnType<typeof rgb> }
    > = {
      wasserquelle: { label: "Wasser", color: AQUA },
      smarthome: { label: "Elektrik", color: rgb(0.36, 0.55, 0.94) },
      wasserverteiler: { label: "Ventilkasten", color: rgb(0.91, 0.72, 0.29) },
    };
    for (const f of payload.fixtures) {
      const c = mapPt(
        toMeters(f.position.lng, f.position.lat, origin.lng, origin.lat),
      );
      const meta = fixtureMeta[f.kind] ?? {
        label: f.kind,
        color: AQUA,
      };
      page.drawRectangle({
        x: c.x - 3.5,
        y: c.y - 3.5,
        width: 7,
        height: 7,
        color: meta.color,
        borderColor: FOREST,
        borderWidth: 0.6,
      });
      drawSafeText(page, meta.label, {
        x: c.x + 6,
        y: c.y - 2,
        size: 7,
        font: bold,
        color: FOREST,
      });
    }

    // Legend
    const lx = plotX + plotW + 16;
    let ly = H - 80;
    drawSafeText(page, "Legende", { x: lx, y: ly, size: 10, font: bold, color: FOREST });
    ly -= 18;
    const legend: [string, ReturnType<typeof rgb>][] = [
      ["Rasen", zoneColors.rasen],
      ["Gebäude", zoneColors.gebaeude],
      ["Tropf", zoneColors.tropf],
      ["Regner + Wurf", rgb(0.1, 0.55, 0.85)],
      ["Wasser", fixtureMeta.wasserquelle.color],
      ["Elektrik", fixtureMeta.smarthome.color],
      ["Ventilkasten", fixtureMeta.wasserverteiler.color],
    ];
    for (const [label, col] of legend) {
      page.drawRectangle({
        x: lx,
        y: ly - 2,
        width: 10,
        height: 10,
        color: col,
      });
      drawSafeText(page, label, {
        x: lx + 16,
        y: ly,
        size: 8,
        font,
        color: FOREST,
      });
      ly -= 16;
    }
    drawSafeText(page, `Maßstab ~ 1:${Math.round(1000 / scale)}`, {
      x: lx,
      y: ly - 8,
      size: 7,
      font,
      color: GRAY,
    });
    drawSafeText(page, `Raster ${step} m`, {
      x: lx,
      y: ly - 22,
      size: 7,
      font,
      color: GRAY,
    });
  }

  // -- 2b. Detailseiten je Hydraulikzone --
  {
    const ZONE_PALETTE = [
      rgb(0, 1, 0.812),
      rgb(1, 0.69, 0.125),
      rgb(0.49, 0.61, 1),
      rgb(1, 0.48, 0.69),
      rgb(0.61, 0.91, 0.38),
      rgb(0.3, 0.85, 0.91),
      rgb(0.85, 0.63, 1),
      rgb(1, 0.6, 0.38),
    ];
    function zoneRgb(z: { index?: number; color?: string }, i: number) {
      const hex = z.color;
      if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
        const n = parseInt(hex.slice(1), 16);
        return rgb(
          ((n >> 16) & 255) / 255,
          ((n >> 8) & 255) / 255,
          (n & 255) / 255,
        );
      }
      return ZONE_PALETTE[i % ZONE_PALETTE.length];
    }

    const zones = (plan.zones ?? []) as Array<{
      index?: number;
      headIds?: string[];
      flowLMin?: number;
      pipeLengthM?: number;
      color?: string;
    }>;

    const origin =
      payload.zones[0]?.coordinates[0] ??
      plan.heads[0]?.position ??
      ({ lng: 0, lat: 0 } as { lng: number; lat: number });

    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi];
      const zoneIndex = z.index ?? zi;
      const zoneHeads = plan.heads.filter(
        (h) => h.hydraulicZone === zoneIndex,
      );
      type PipeLike = {
        hydraulicZone?: number | null;
        kind?: string;
        points?: Array<{ lng: number; lat: number }>;
      };
      const zonePipes = ((plan.pipes ?? []) as PipeLike[]).filter(
        (p) => p.hydraulicZone === zoneIndex,
      );
      const zColor = zoneRgb(z, zi);

      const page = doc.addPage([W, H]);
      pages.push(page);
      drawHeader(
        page,
        font,
        bold,
        `Zone ${zoneIndex + 1} - Detail`,
        `${zoneHeads.length} Regner · ${(z.flowLMin ?? 0).toFixed(1)} l/min · PE ${(z.pipeLengthM ?? 0).toFixed(1)} m`,
      );

      // Stats strip
      let sy = H - 64;
      const stats = [
        `Regner: ${zoneHeads.length}`,
        `Durchfluss: ${(z.flowLMin ?? 0).toFixed(1)} l/min`,
        `Leitung: ${(z.pipeLengthM ?? 0).toFixed(1)} m PE`,
      ];
      page.drawRectangle({
        x: MARGIN,
        y: sy - 4,
        width: 14,
        height: 14,
        color: zColor,
        borderColor: FOREST,
        borderWidth: 0.5,
      });
      drawSafeText(page, stats.join("   ·   "), {
        x: MARGIN + 22,
        y: sy,
        size: 9,
        font: bold,
        color: FOREST,
      });

      // Focused map
      const allPts: Pt[] = [];
      for (const h of zoneHeads) {
        allPts.push(
          toMeters(h.position.lng, h.position.lat, origin.lng, origin.lat),
        );
      }
      for (const p of zonePipes) {
        for (const pt of p.points ?? []) {
          allPts.push(toMeters(pt.lng, pt.lat, origin.lng, origin.lat));
        }
      }
      for (const dz of payload.zones) {
        if (dz.type !== "rasen") continue;
        for (const c of dz.coordinates) {
          allPts.push(toMeters(c.lng, c.lat, origin.lng, origin.lat));
        }
      }
      if (allPts.length === 0) allPts.push({ x: 0, y: 0 });

      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const p of allPts) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const pad = 1.5;
      minX -= pad;
      maxX += pad;
      minY -= pad;
      maxY += pad;
      const spanX = Math.max(maxX - minX, 1);
      const spanY = Math.max(maxY - minY, 1);

      const plotX = MARGIN;
      const plotY = 48;
      const plotW = W - 2 * MARGIN - 260;
      const plotH = H - 48 - 70;
      const scale = Math.min(plotW / spanX, plotH / spanY);
      const mapPt = (p: Pt) => ({
        x: plotX + (p.x - minX) * scale,
        y: plotY + (p.y - minY) * scale,
      });

      page.drawRectangle({
        x: plotX,
        y: plotY,
        width: plotW,
        height: plotH,
        color: rgb(0.97, 0.98, 0.97),
        borderColor: LINE,
        borderWidth: 1,
      });

      for (const dz of payload.zones) {
        const pts = dz.coordinates.map((c) =>
          mapPt(toMeters(c.lng, c.lat, origin.lng, origin.lat)),
        );
        if (pts.length < 2) continue;
        const outline =
          dz.type === "rasen"
            ? rgb(0.55, 0.72, 0.55)
            : dz.type === "gebaeude"
              ? rgb(0.6, 0.6, 0.6)
              : LINE;
        for (let i = 0; i < pts.length; i++) {
          page.drawLine({
            start: pts[i],
            end: pts[(i + 1) % pts.length],
            thickness: dz.type === "rasen" ? 1.1 : 0.6,
            color: outline,
            opacity: dz.type === "rasen" ? 0.9 : 0.5,
          });
        }
      }

      for (const pipe of zonePipes) {
        const pts = (pipe.points ?? []).map((c) =>
          mapPt(toMeters(c.lng, c.lat, origin.lng, origin.lat)),
        );
        for (let i = 0; i < pts.length - 1; i++) {
          page.drawLine({
            start: pts[i],
            end: pts[i + 1],
            thickness: pipe.kind === "main" ? 1.6 : 1.1,
            color: zColor,
            opacity: 0.85,
          });
        }
      }

      for (const h of zoneHeads) {
        const c = mapPt(
          toMeters(h.position.lng, h.position.lat, origin.lng, origin.lat),
        );
        const rPx = Math.max(4, (h.radiusM ?? 0) * scale);
        if (h.arcDeg >= 359) {
          page.drawCircle({
            x: c.x,
            y: c.y,
            size: rPx,
            borderColor: zColor,
            borderWidth: 0.7,
            color: zColor,
            opacity: 0.08,
          });
        } else if ((h.arcDeg ?? 0) > 0 && h.kind !== "strip") {
          const half = (h.arcDeg ?? 180) / 2;
          const startDeg = (h.rotationDeg ?? 0) - half;
          const steps = Math.max(8, Math.round((h.arcDeg ?? 180) / 8));
          const ray = (bearingDeg: number): Pt => {
            const a = ((90 - bearingDeg) * Math.PI) / 180;
            return {
              x: c.x + rPx * Math.cos(a),
              y: c.y + rPx * Math.sin(a),
            };
          };
          for (let s = 0; s < steps; s++) {
            const b0 = startDeg + (s / steps) * (h.arcDeg ?? 180);
            const b1 = startDeg + ((s + 1) / steps) * (h.arcDeg ?? 180);
            page.drawLine({
              start: ray(b0),
              end: ray(b1),
              thickness: 0.7,
              color: zColor,
              opacity: 0.55,
            });
          }
          page.drawLine({
            start: c,
            end: ray(startDeg),
            thickness: 0.4,
            color: zColor,
            opacity: 0.4,
          });
          page.drawLine({
            start: c,
            end: ray(startDeg + (h.arcDeg ?? 180)),
            thickness: 0.4,
            color: zColor,
            opacity: 0.4,
          });
        }
        page.drawCircle({
          x: c.x,
          y: c.y,
          size: 2.4,
          color: FOREST,
        });
      }

      // Fixtures (small, labeled)
      for (const f of payload.fixtures) {
        const c = mapPt(
          toMeters(f.position.lng, f.position.lat, origin.lng, origin.lat),
        );
        const label =
          f.kind === "wasserquelle"
            ? "Wasser"
            : f.kind === "smarthome"
              ? "Elektrik"
              : f.kind === "wasserverteiler"
                ? "Kasten"
                : f.kind;
        page.drawRectangle({
          x: c.x - 2.5,
          y: c.y - 2.5,
          width: 5,
          height: 5,
          color: AQUA,
          borderColor: FOREST,
          borderWidth: 0.4,
        });
        drawSafeText(page, label, {
          x: c.x + 5,
          y: c.y - 1.5,
          size: 6,
          font,
          color: FOREST,
        });
      }

      // Head list panel
      const listX = plotX + plotW + 14;
      let listY = H - 88;
      drawSafeText(page, "Regner in dieser Zone", {
        x: listX,
        y: listY,
        size: 10,
        font: bold,
        color: FOREST,
      });
      listY -= 16;
      zoneHeads.forEach((h, i) => {
        if (listY < 40) return;
        const line = `#${i + 1}  ${h.configKey}  ${h.radiusM.toFixed(1)} m  ${h.arcDeg}°  ${h.flowLMin.toFixed(1)} l/min`;
        drawSafeText(page, line, {
          x: listX,
          y: listY,
          size: 7,
          font,
          color: FOREST_MID,
          maxWidth: 240,
        });
        listY -= 12;
      });
      if (zoneHeads.length === 0) {
        drawSafeText(page, "Keine Regner in dieser Zone.", {
          x: listX,
          y: listY,
          size: 8,
          font,
          color: GRAY,
        });
      }
    }
  }

  // -- 3. Regner-Positionen: cards with sector schematics --
  {
    const CARD_W = 248;
    const CARD_H = 108;
    const GAP_X = 10;
    const GAP_Y = 10;
    const COLS = 3;
    const ICON = 52;

    function drawSectorSchematic(
      pg: PDFPage,
      cx: number,
      cy: number,
      size: number,
      arcDeg: number,
      rotationDeg: number,
      fill: ReturnType<typeof rgb>,
    ) {
      const r = size / 2 - 2;
      // Outer ring
      pg.drawCircle({
        x: cx,
        y: cy,
        size: r + 1.5,
        borderColor: LINE,
        borderWidth: 0.6,
        color: WHITE,
      });

      const ray = (bearingDeg: number, dist: number): Pt => {
        const a = ((90 - bearingDeg) * Math.PI) / 180;
        return {
          x: cx + dist * Math.cos(a),
          y: cy + dist * Math.sin(a),
        };
      };

      const arc = Math.min(360, Math.max(0, arcDeg));
      if (arc >= 359.5) {
        // Full circle hatch
        const steps = 24;
        for (let i = 0; i < steps; i++) {
          const b = (i * 360) / steps;
          const p = ray(b, r * 0.92);
          pg.drawLine({
            start: { x: cx, y: cy },
            end: p,
            thickness: 0.35,
            color: fill,
            opacity: 0.35,
          });
        }
        pg.drawCircle({
          x: cx,
          y: cy,
          size: r,
          borderColor: fill,
          borderWidth: 1.1,
        });
      } else if (arc < 1) {
        // Strip / unknown: small rectangle along Ausrichtung
        const a = ((90 - rotationDeg) * Math.PI) / 180;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const len = r * 0.85;
        const halfW = r * 0.28;
        const px = -dy * halfW;
        const py = dx * halfW;
        const corners: Pt[] = [
          { x: cx - dx * len + px, y: cy - dy * len + py },
          { x: cx + dx * len + px, y: cy + dy * len + py },
          { x: cx + dx * len - px, y: cy + dy * len - py },
          { x: cx - dx * len - px, y: cy - dy * len - py },
        ];
        for (let i = 0; i < 4; i++) {
          pg.drawLine({
            start: corners[i],
            end: corners[(i + 1) % 4],
            thickness: 1.1,
            color: fill,
          });
        }
      } else {
        const start = rotationDeg - arc / 2;
        const end = rotationDeg + arc / 2;
        const steps = Math.max(10, Math.round(arc / 6));
        // Hatch rays
        for (let i = 0; i <= steps; i++) {
          const b = start + (arc * i) / steps;
          const p = ray(b, r * 0.92);
          pg.drawLine({
            start: { x: cx, y: cy },
            end: p,
            thickness: 0.4,
            color: fill,
            opacity: 0.4,
          });
        }
        // Arc outline
        let prev: Pt | null = null;
        for (let i = 0; i <= steps; i++) {
          const b = start + (arc * i) / steps;
          const p = ray(b, r);
          if (prev) {
            pg.drawLine({
              start: prev,
              end: p,
              thickness: 1.1,
              color: fill,
            });
          }
          prev = p;
        }
        // Bounding radii
        const p0 = ray(start, r);
        const p1 = ray(end, r);
        pg.drawLine({
          start: { x: cx, y: cy },
          end: p0,
          thickness: 1.1,
          color: fill,
        });
        pg.drawLine({
          start: { x: cx, y: cy },
          end: p1,
          thickness: 1.1,
          color: fill,
        });
      }

      // Center nozzle
      pg.drawCircle({
        x: cx,
        y: cy,
        size: 2.4,
        color: WHITE,
        borderColor: FOREST,
        borderWidth: 0.8,
      });
    }

    const kindColor = (kind: string) => {
      if (kind === "rotor") return rgb(0.75, 0.45, 0.15);
      if (kind === "strip") return rgb(0.35, 0.55, 0.75);
      return rgb(0.15, 0.55, 0.85); // spray
    };

    let page = doc.addPage([W, H]);
    pages.push(page);
    drawHeader(
      page,
      font,
      bold,
      "Regner-Positionen",
      "Sektor-Schema, Radius, Ausrichtung",
    );

    let col = 0;
    let rowY = H - 70 - CARD_H;

    plan.heads.forEach((h, i) => {
      if (rowY < 40) {
        page = doc.addPage([W, H]);
        pages.push(page);
        drawHeader(
          page,
          font,
          bold,
          "Regner-Positionen (Forts.)",
          "Sektor-Schema, Radius, Ausrichtung",
        );
        col = 0;
        rowY = H - 70 - CARD_H;
      }

      const x = MARGIN + col * (CARD_W + GAP_X);
      const y = rowY;

      // Card chrome
      page.drawRectangle({
        x,
        y,
        width: CARD_W,
        height: CARD_H,
        color: i % 2 === 0 ? WHITE : MINT,
        borderColor: LINE,
        borderWidth: 0.8,
      });

      // Index badge
      page.drawRectangle({
        x: x + 8,
        y: y + CARD_H - 22,
        width: 28,
        height: 14,
        color: FOREST,
      });
      drawSafeText(page, `#${i + 1}`, {
        x: x + 12,
        y: y + CARD_H - 18,
        size: 8,
        font: bold,
        color: WHITE,
      });

      drawSafeText(page, h.configKey, {
        x: x + 42,
        y: y + CARD_H - 18,
        size: 9,
        font: bold,
        color: FOREST,
        maxWidth: 120,
      });

      // Sector schematic (left)
      const iconCx = x + 8 + ICON / 2;
      const iconCy = y + 12 + ICON / 2;
      page.drawRectangle({
        x: x + 8,
        y: y + 12,
        width: ICON,
        height: ICON,
        color: WHITE,
        borderColor: LINE,
        borderWidth: 0.5,
      });
      drawSectorSchematic(
        page,
        iconCx,
        iconCy,
        ICON,
        h.kind === "strip" ? 0 : h.arcDeg,
        h.rotationDeg,
        kindColor(h.kind),
      );

      // Arc label under icon
      const arcLabel =
        h.kind === "strip"
          ? "Strip"
          : h.arcDeg >= 359
            ? "360°"
            : `${Math.round(h.arcDeg)}°`;
      drawSafeText(page, arcLabel, {
        x: x + 8 + (ICON - 20) / 2,
        y: y + 2,
        size: 7,
        font: bold,
        color: FOREST,
      });

      // Specs to the right of icon
      const tx = x + 8 + ICON + 12;
      const lines: [string, string][] = [
        ["Radius", `${h.radiusM.toFixed(2)} m`],
        ["Sektor", arcLabel],
        ["Ausrichtung", `${Math.round(h.rotationDeg)}° (N CW)`],
        ["Zone", String(h.hydraulicZone)],
        ["Durchfluss", `${h.flowLMin.toFixed(1)} l/min`],
        ["Art", h.kind],
      ];
      let ty = y + CARD_H - 36;
      for (const [k, v] of lines) {
        drawSafeText(page, k, {
          x: tx,
          y: ty,
          size: 6.5,
          font,
          color: GRAY,
        });
        drawSafeText(page, v, {
          x: tx + 62,
          y: ty,
          size: 7,
          font: bold,
          color: FOREST,
          maxWidth: 100,
        });
        ty -= 11;
      }

      col += 1;
      if (col >= COLS) {
        col = 0;
        rowY -= CARD_H + GAP_Y;
      }
    });
  }

  // -- 4. Hydraulik / Annahmen --
  {
    const page = doc.addPage([W, H]);
    pages.push(page);
    drawHeader(page, font, bold, "Hydraulik & Berechnungsgrundlagen", "");

    let y = H - 72;
    drawSafeText(page, "Hydraulikzonen", {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
      color: FOREST,
    });
    y -= 18;

    const zoneHeader = [
      { text: "Zone", x: MARGIN, w: 40 },
      { text: "Regner", x: MARGIN + 50, w: 50 },
      { text: "Durchfluss l/min", x: MARGIN + 120, w: 100 },
      { text: "PE-Länge m", x: MARGIN + 240, w: 80 },
    ];
    y = drawTableRow(page, font, bold, y, zoneHeader, { header: true });

    const zones = plan.zones as Array<{
      index?: number;
      headIds?: string[];
      flowLMin?: number;
      pipeLengthM?: number;
    }>;
    zones.forEach((z, i) => {
      y = drawTableRow(
        page,
        font,
        bold,
        y,
        [
          { text: String(z.index ?? i + 1), x: MARGIN, w: 40 },
          { text: String(z.headIds?.length ?? 0), x: MARGIN + 50, w: 50 },
          {
            text: (z.flowLMin ?? 0).toFixed(1),
            x: MARGIN + 120,
            w: 100,
          },
          {
            text: (z.pipeLengthM ?? 0).toFixed(1),
            x: MARGIN + 240,
            w: 80,
          },
        ],
        { alt: i % 2 === 1 },
      );
    });

    y -= 20;
    drawSafeText(page, "Annahmen & Hinweise", {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
      color: FOREST,
    });
    y -= 16;

    const notes = [
      ...plan.assumptions.slice(0, 12),
      ...plan.warnings.slice(0, 8),
    ];
    if (notes.length === 0) {
      drawSafeText(page, "Keine besonderen Hinweise.", {
        x: MARGIN,
        y,
        size: 9,
        font,
        color: GRAY,
      });
    } else {
      for (const note of notes) {
        const lines = wrapText(`- ${note}`, font, 8, W - 2 * MARGIN);
        for (const line of lines) {
          if (y < 48) break;
          drawSafeText(page, line, {
            x: MARGIN,
            y,
            size: 8,
            font,
            color: FOREST_MID,
          });
          y -= 11;
        }
      }
    }

    y -= 12;
    if (y > 80) {
      drawSafeText(page, "Rohrkonzept", {
        x: MARGIN,
        y,
        size: 11,
        font: bold,
        color: FOREST,
      });
      y -= 14;
      const pipeNotes = [
        "PE 25: Zonenleitungen (Laterale) von Verteiler zu Regnern.",
        "PE 32: Hauptleitung Quelle -> Verteiler.",
        "Ventile und Klemmverbinder gemäß Stückliste.",
      ];
      for (const n of pipeNotes) {
        drawSafeText(page, `- ${n}`, {
          x: MARGIN,
          y,
          size: 8,
          font,
          color: FOREST_MID,
        });
        y -= 12;
      }
    }
  }

  // -- 5. Stückliste --
  {
    let page = doc.addPage([W, H]);
    pages.push(page);
    drawHeader(page, font, bold, "Stückliste", "Material nach Gruppen");

    const groupOrder = [
      "regner",
      "rohr",
      "ventile",
      "steuerung",
      "quelle",
      "tropf",
    ];
    const groupLabels: Record<string, string> = {
      regner: "Regner",
      rohr: "Rohr & Leitungen",
      ventile: "Ventile & Verteiler",
      steuerung: "Steuerung",
      quelle: "Wasserquelle",
      tropf: "Tropfbewässerung",
    };

    let y = H - 70;
    const bomHeader = [
      { text: "Menge", x: MARGIN, w: 50 },
      { text: "Artikel", x: MARGIN + 55, w: 90 },
      { text: "Bezeichnung", x: MARGIN + 150, w: 380 },
      { text: "Einzel EUR", x: MARGIN + 540, w: 60 },
      { text: "Summe EUR", x: MARGIN + 620, w: 70 },
    ];

    for (const g of groupOrder) {
      const lines = plan.bom.filter((l) => l.group === g);
      if (!lines.length) continue;
      if (y < 80) {
        page = doc.addPage([W, H]);
        pages.push(page);
        drawHeader(page, font, bold, "Stückliste (Forts.)", "");
        y = H - 70;
      }
      drawSafeText(page, groupLabels[g] ?? g, {
        x: MARGIN,
        y,
        size: 10,
        font: bold,
        color: FOREST,
      });
      y -= 14;
      y = drawTableRow(page, font, bold, y, bomHeader, { header: true });

      lines.forEach((l, i) => {
        if (y < 48) {
          page = doc.addPage([W, H]);
          pages.push(page);
          drawHeader(page, font, bold, "Stückliste (Forts.)", "");
          y = H - 70;
          y = drawTableRow(page, font, bold, y, bomHeader, { header: true });
        }
        const qty =
          l.unit === "meter"
            ? `${l.qty} m`
            : l.unit === "roll"
              ? `${l.qty} Rol.`
              : `${l.qty}x`;
        y = drawTableRow(
          page,
          font,
          bold,
          y,
          [
            { text: qty, x: MARGIN, w: 50 },
            { text: l.article ?? "-", x: MARGIN + 55, w: 90 },
            { text: l.label, x: MARGIN + 150, w: 380 },
            { text: euro(l.priceEur), x: MARGIN + 540, w: 60 },
            { text: euro(l.totalEur), x: MARGIN + 620, w: 70 },
          ],
          { alt: i % 2 === 1 },
        );
      });
      y -= 10;
    }

    if (y > 60) {
      drawSafeText(page, 
        `Material gesamt (bekannte Preise): ${(plan.hasUnknownPrices ? "ab " : "") + euro(plan.totalKnownEur)}`,
        {
          x: MARGIN,
          y: y - 4,
          size: 11,
          font: bold,
          color: FOREST,
        },
      );
    }
  }

  const total = pages.length;
  pages.forEach((p, i) => drawFooter(p, font, i + 1, total));

  return doc.save();
}

export async function buildPlanPdf(
  payload: SavedPlotProject,
  meta?: {
    customerName?: string | null;
    customerEmail?: string | null;
    projectId?: string;
  },
): Promise<Uint8Array> {
  if (!payload.sofortPlan) throw new Error("Kein Sofort-Plan vorhanden");
  return buildProjectPdf(
    { ...payload, sofortPlan: payload.sofortPlan },
    {
      projectId: meta?.projectId || "lokal",
      customerName: meta?.customerName,
      customerEmail: meta?.customerEmail,
    },
  );
}
