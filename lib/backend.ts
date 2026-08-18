/**
 * RegnerWerk Backend (admin / CRM API).
 * Server-only — do not expose service secrets to the browser.
 */
export function getBackendUrl(): string {
  return (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:3001"
  ).replace(/\/$/, "");
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
