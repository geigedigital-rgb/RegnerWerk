import { NextRequest, NextResponse } from "next/server";
import { getMapboxToken, type GeocodeFeature } from "@/lib/mapbox";

export const runtime = "nodejs";

/**
 * Server-side Mapbox geocode so browser Origin/Referer URL restrictions
 * on the public token do not block address search (403).
 */
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

  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`,
  );
  url.searchParams.set("access_token", token);
  url.searchParams.set("country", "de");
  url.searchParams.set("language", "de");
  url.searchParams.set("types", "address,place");
  url.searchParams.set("limit", "6");
  url.searchParams.set("autocomplete", "true");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json(
      {
        error: "Geocoding fehlgeschlagen",
        mapboxStatus: res.status,
      },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    features: Array<{
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
