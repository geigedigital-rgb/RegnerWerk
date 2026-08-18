/**
 * RegnerWerk Backend (admin / CRM API).
 * Server-only — do not point this at the configurator itself.
 */

const SELF_HOSTS = new Set([
  "localhost:3002",
  "127.0.0.1:3002",
  "konfigurator.regnerwerk.de",
]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function railwaySelfHost(): string | null {
  const raw =
    process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL || "";
  if (!raw) return null;
  const withProto = raw.includes("://") ? raw : `https://${raw}`;
  return hostOf(withProto);
}

export function isSelfBackendUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return true;
  if (SELF_HOSTS.has(host)) return true;
  const railway = railwaySelfHost();
  if (railway && host === railway) return true;
  return false;
}

export function getBackendUrl(): string {
  const candidates = [process.env.BACKEND_URL, process.env.NEXT_PUBLIC_API_URL];
  for (const raw of candidates) {
    const url = (raw ?? "").trim().replace(/\/$/, "");
    if (!url) continue;
    if (isSelfBackendUrl(url)) {
      console.error("[backend] ignoring self URL (would loop)", url);
      continue;
    }
    return url;
  }
  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3001";
  }
  return "";
}

export function backendForwardHeaders(req?: Request): Headers {
  const headers = new Headers();
  const contentType = req?.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const token =
    process.env.PROJECTS_SUBMIT_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_PROJECTS_SUBMIT_TOKEN?.trim();
  if (token) headers.set("X-Projects-Token", token);
  return headers;
}

/** Marketing site origins to try when Telegram/CRM are missing here. */
export function siteLeadBases(): string[] {
  const fromEnv = (process.env.NEXT_PUBLIC_SITE_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  const list = [fromEnv, fromEnv.replace("://www.", "://"), "https://regnerwerk.de"];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const base = raw.replace(/\/$/, "");
    if (!base || !base.startsWith("http")) continue;
    if (isSelfBackendUrl(base)) continue;
    if (
      process.env.NODE_ENV === "production" &&
      /localhost|127\.0\.0\.1/.test(base)
    ) {
      continue;
    }
    if (seen.has(base)) continue;
    seen.add(base);
    out.push(base);
  }
  return out;
}
