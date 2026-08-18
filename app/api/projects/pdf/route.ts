import { NextResponse } from "next/server";
import { buildPlanPdf } from "@/lib/plan-pdf";
import type { SavedPlotProject } from "@/lib/project-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    payload?: SavedPlotProject;
    customerName?: string;
    customerEmail?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const payload = body.payload;
  if (!payload?.sofortPlan) {
    return NextResponse.json({ error: "Kein Sofort-Plan vorhanden." }, { status: 400 });
  }

  try {
    const bytes = await buildPlanPdf(payload, {
      customerName: body.customerName || null,
      customerEmail: body.customerEmail || null,
    });
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="RegnerWerk-Plan.pdf"',
      },
    });
  } catch (err) {
    console.error("[projects/pdf]", err);
    return NextResponse.json({ error: "PDF fehlgeschlagen." }, { status: 500 });
  }
}
