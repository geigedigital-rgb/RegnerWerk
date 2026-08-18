import { NextResponse } from "next/server";
import { backendForwardHeaders, getBackendUrl } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: Request, path: string[]): Promise<NextResponse> {
  const backend = getBackendUrl();
  const search = new URL(req.url).search;
  const target = `${backend}/api/projects/${path.map(encodeURIComponent).join("/")}${search}`;
  const method = req.method.toUpperCase();
  const headers = backendForwardHeaders(req);

  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  let res: Response;
  try {
    res = await fetch(target, {
      method,
      headers,
      body,
    });
  } catch (err) {
    console.error("[projects-proxy] unreachable", target, err);
    return NextResponse.json(
      { error: "Dienst vorübergehend nicht erreichbar." },
      { status: 503 },
    );
  }

  const out = new Headers();
  for (const key of ["content-type", "content-disposition", "x-project-id"]) {
    const v = res.headers.get(key);
    if (v) out.set(key, v);
  }
  const buf = await res.arrayBuffer();
  return new NextResponse(buf, { status: res.status, headers: out });
}

export async function GET(req: Request, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}

export async function POST(req: Request, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}

export async function DELETE(req: Request, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
