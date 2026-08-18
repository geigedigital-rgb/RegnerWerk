import { NextResponse } from "next/server";
import { backendForwardHeaders, getBackendUrl } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const PROXY_MS = 20_000;

async function proxy(req: Request, path: string[]): Promise<NextResponse> {
  const backend = getBackendUrl();
  if (!backend) {
    return NextResponse.json(
      { error: "Backend nicht konfiguriert (BACKEND_URL)." },
      { status: 503 },
    );
  }

  const search = new URL(req.url).search;
  const target = `${backend}/api/projects/${path.map(encodeURIComponent).join("/")}${search}`;

  try {
    if (new URL(target).host === new URL(req.url).host) {
      console.error("[projects-proxy] refused self loop", target);
      return NextResponse.json(
        { error: "Backend zeigt auf diesen Dienst." },
        { status: 503 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Ungültige Backend-URL." }, { status: 503 });
  }

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
      signal: AbortSignal.timeout(PROXY_MS),
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
