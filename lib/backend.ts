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
