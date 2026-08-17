import { NextRequest, NextResponse } from "next/server";
import { getMapboxToken, type GeocodeFeature } from "@/lib/mapbox";
import { mapboxGetJson } from "@/lib/mapbox-geocode";

export const runtime = "nodejs";

function pageOrigin(req: NextRequest): string {
  const origin = req.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* ignore */
    }
  }
  const host = (
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    ""
  )
    .split(",")[0]
    .trim();
  const forwarded = (
    req.headers.get("x-forwarded-proto") || ""
  )
    .split(",")[0]
    .trim();
  const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = forwarded || (local ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) {
    return NextResponse.json({ features: [] as GeocodeFeature[] });
  }

  let token: string;
  try {
    token = getMapboxToken();
  } catch {
    return NextResponse.json(
      { error: "Mapbox token missing" },
      { status: 500 },
    );
  }

  const origin = pageOrigin(req);
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`,
  );
  url.searchParams.set("access_token", token);
  url.searchParams.set("country", "de");
  url.searchParams.set("language", "de");
  url.searchParams.set("types", "address,place");
  url.searchParams.set("limit", "6");
  url.searchParams.set("autocomplete", "true");

  const { status, body } = await mapboxGetJson(url.toString(), origin);
  if (status < 200 || status >= 300) {
    return NextResponse.json(
      { error: "Geocoding fehlgeschlagen", mapboxStatus: status },
      { status: 502 },
    );
  }

  const data = body as {
    features?: Array<{
      id: string;
      place_name: string;
      center: [number, number];
      text?: string;
      address?: string;
      context?: Array<{ text: string }>;
    }>;
  };

  const features: GeocodeFeature[] = (data.features ?? []).map((f) => ({
    id: f.id,
    placeName: f.place_name,
    center: f.center,
    address: [f.address, f.text].filter(Boolean).join(" "),
    context: f.context?.map((c) => c.text).join(", "),
  }));

  return NextResponse.json({ features });
}
