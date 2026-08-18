import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SavedPlotProject } from "@/lib/project-storage";

const FOREST = rgb(0.043, 0.141, 0.078);
const LIME = rgb(0, 1, 0.812);
const GRAY = rgb(0.3, 0.4, 0.36);

function winAnsi(text: string): string {
  return text
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\u20AC/g, "EUR")
    .replace(/[^\x00-\xFF]/g, "?");
}

function euro(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "-";
  return `${Math.round(v).toLocaleString("de-DE")} EUR`;
}

export async function buildPlanPdf(
  payload: SavedPlotProject,
  meta?: { customerName?: string | null; customerEmail?: string | null },
): Promise<Uint8Array> {
  const plan = payload.sofortPlan;
  if (!plan) throw new Error("Kein Sofort-Plan vorhanden");

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  page.drawRectangle({ x: 0, y: height - 72, width, height: 72, color: FOREST });
  page.drawRectangle({ x: 0, y: height - 76, width, height: 4, color: LIME });
  page.drawText("RegnerWerk", {
    x: 40,
    y: height - 38,
    size: 18,
    font: bold,
    color: LIME,
  });
  page.drawText("Sofort-Plan", {
    x: 40,
    y: height - 56,
    size: 11,
    font,
    color: rgb(0.85, 0.95, 0.92),
  });

  let y = height - 110;
  const line = (label: string, value: string, useBold = false) => {
    page.drawText(winAnsi(label), {
      x: 40,
      y,
      size: 10,
      font,
      color: GRAY,
    });
    page.drawText(winAnsi(value).slice(0, 70), {
      x: 180,
      y,
      size: 10,
      font: useBold ? bold : font,
      color: FOREST,
    });
    y -= 18;
  };

  const place = payload.place;
  const placeName =
    (place as { placeName?: string }).placeName ||
    (place as { text?: string }).text ||
    place.id;
  const brand = plan.brand === "rainbird" ? "Rain Bird" : "Hunter";

  if (meta?.customerName) line("Name", meta.customerName);
  if (meta?.customerEmail) line("E-Mail", meta.customerEmail);
  line("Adresse", placeName);
  line("Marke", brand);
  line("Rasen", `${Math.round(plan.lawnAreaM2)} m2`);
  line("Regner", String(plan.heads.length));
  line("Zonen", String(plan.zones.length));
  line("Material", euro(plan.totalKnownEur), true);

  y -= 10;
  page.drawText("Materialliste", {
    x: 40,
    y,
    size: 12,
    font: bold,
    color: FOREST,
  });
  y -= 22;

  for (const row of plan.bom.slice(0, 28)) {
    if (y < 60) break;
    const qty =
      row.unit === "meter"
        ? `${row.qty} m`
        : row.unit === "roll"
          ? `${row.qty} Rolle`
          : `${row.qty} Stk`;
    page.drawText(winAnsi(row.label).slice(0, 42), {
      x: 40,
      y,
      size: 9,
      font,
      color: FOREST,
    });
    page.drawText(qty, { x: 340, y, size: 9, font, color: GRAY });
    page.drawText(euro(row.totalEur), {
      x: 430,
      y,
      size: 9,
      font,
      color: FOREST,
    });
    y -= 14;
  }

  page.drawText("Unverbindliche Planung. Preise ohne Montage.", {
    x: 40,
    y: 36,
    size: 8,
    font,
    color: GRAY,
  });

  return doc.save();
}
