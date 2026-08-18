import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { sendTelegramLead } from "@/lib/telegram";
import { PRIVACY_NOTICE_VERSION } from "@/lib/consent";
import { getBackendUrl } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  name?: string;
  email?: string;
  phone?: string;
  placeName?: string;
  brand?: string;
  lawnAreaM2?: number;
  heads?: number;
  totalEur?: number | null;
  company_website?: string;
  privacyAccepted?: boolean;
};

function clean(v: unknown, max = 500) {
  return String(v ?? "")
    .trim()
    .slice(0, max);
}

async function forwardToCrm(input: {
  name: string;
  email: string;
  phone: string;
  placeName: string;
  brand: string;
  lawnAreaM2: number | null;
  heads: number | null;
  totalEur: number | null;
}): Promise<boolean> {
  const base = getBackendUrl();
  if (!base) return false;
  const area =
    input.lawnAreaM2 != null && input.lawnAreaM2 > 0
      ? Math.round(input.lawnAreaM2)
      : null;
  const summary = [
    input.placeName || null,
    area != null ? `${area} m²` : null,
    input.heads != null ? `${input.heads} Regner` : null,
    input.brand || null,
    input.totalEur != null ? `ab ${Math.round(input.totalEur)} €` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  try {
    const res = await fetch(`${base}/api/public/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submission_id: randomUUID(),
        form_type: "contact",
        request_type: "new_installation",
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        address: input.placeName || null,
        area_m2: area,
        garden_type: input.brand ? `Sofort · ${input.brand}` : "Sofort-Plan",
        message: summary || null,
        privacy_notice_version: PRIVACY_NOTICE_VERSION,
        landing_page: "/konfigurator",
        callback_requested: true,
        callback_consent: true,
      }),
    });
    if (!res.ok) {
      const data = await res.text().catch(() => "");
      console.error("[lead] CRM forward failed", res.status, data.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[lead] CRM unreachable", err);
    return false;
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  if (clean(body.company_website, 200)) {
    return NextResponse.json({ ok: true });
  }

  const name = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone, 60);
  if (name.length < 2) {
    return NextResponse.json({ error: "Name fehlt." }, { status: 400 });
  }
  if (!email.includes("@") || !email.includes(".")) {
    return NextResponse.json({ error: "E-Mail ungültig." }, { status: 400 });
  }
  if (body.privacyAccepted !== true) {
    return NextResponse.json(
      { error: "Bitte der Datenschutzerklärung zustimmen." },
      { status: 400 },
    );
  }

  const placeName = clean(body.placeName, 300);
  const brand = clean(body.brand, 40);
  const lawnAreaM2 =
    typeof body.lawnAreaM2 === "number" ? body.lawnAreaM2 : null;
  const heads = typeof body.heads === "number" ? body.heads : null;
  const totalEur = typeof body.totalEur === "number" ? body.totalEur : null;

  const telegramOk = await sendTelegramLead({
    source: "Konfigurator · PDF",
    name,
    email,
    phone: phone || null,
    extra: {
      Adresse: placeName || null,
      Marke: brand || null,
      "Fläche m²": lawnAreaM2 != null ? Math.round(lawnAreaM2) : null,
      Regner: heads,
      "Material €": totalEur != null ? Math.round(totalEur) : null,
      Datenschutz: PRIVACY_NOTICE_VERSION,
    },
  });

  const crmOk = await forwardToCrm({
    name,
    email,
    phone,
    placeName,
    brand,
    lawnAreaM2,
    heads,
    totalEur,
  });

  if (!telegramOk && !crmOk) {
    return NextResponse.json(
      { error: "Senden fehlgeschlagen. Bitte später erneut." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    telegram: telegramOk,
    crm: crmOk,
  });
}
