import https from "node:https";
import type { IncomingMessage } from "node:http";

/**
 * URL-restricted Mapbox pk tokens 403 without a matching Origin.
 * Next.js `fetch` strips Origin/Referer (forbidden headers) — use Node https.
 */
export function mapboxGetJson(
  url: string,
  origin: string,
): Promise<{ status: number; body: unknown }> {
  const u = new URL(url);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (origin) {
    headers.Origin = origin;
    headers.Referer = `${origin}/`;
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: unknown = text;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            /* keep raw */
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
