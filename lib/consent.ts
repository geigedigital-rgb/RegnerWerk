/** Shared DE consent copy for contact / PDF lead forms (DSGVO Art. 6 Abs. 1 lit. a). */
export const PRIVACY_NOTICE_VERSION = "2026-08-17";

export function siteDatenschutzUrl(): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${base}/datenschutz/`;
}
