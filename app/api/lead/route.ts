import { NextResponse } from "next/server";
import { sendTelegramLead } from "@/lib/telegram";
import { PRIVACY_NOTICE_VERSION } from "@/lib/consent";

export const runtime = "nodejs";

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

  const sent = await sendTelegramLead({
    source: "Konfigurator · PDF",
    name,
    email,
    phone: phone || null,
    extra: {
      Adresse: clean(body.placeName, 300) || null,
      Marke: clean(body.brand, 40) || null,
      "Fläche m²":
        typeof body.lawnAreaM2 === "number"
          ? Math.round(body.lawnAreaM2)
          : null,
      Regner: typeof body.heads === "number" ? body.heads : null,
      "Material €":
        typeof body.totalEur === "number"
          ? Math.round(body.totalEur)
          : null,
      Datenschutz: PRIVACY_NOTICE_VERSION,
    },
  });

  if (!sent) {
    return NextResponse.json(
      { error: "Senden fehlgeschlagen. Bitte später erneut." },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}
