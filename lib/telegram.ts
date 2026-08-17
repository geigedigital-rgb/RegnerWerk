/**
 * Server-only Telegram notify for inbound leads / forms.
 * Requires TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (never NEXT_PUBLIC_*).
 */

export type TelegramLead = {
  source: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  extra?: Record<string, string | number | boolean | null | undefined>;
};

function line(label: string, value: string | number | boolean | null | undefined) {
  if (value == null || value === "") return null;
  return `${label}: ${value}`;
}

export function isTelegramConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() &&
      process.env.TELEGRAM_CHAT_ID?.trim(),
  );
}

export async function sendTelegramLead(lead: TelegramLead): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    console.error("[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing");
    return false;
  }

  const extraLines = Object.entries(lead.extra ?? {})
    .map(([k, v]) => line(k, v))
    .filter(Boolean);

  const text = [
    `RegnerWerk · ${lead.source}`,
    line("Name", lead.name),
    line("E-Mail", lead.email),
    line("Telefon", lead.phone),
    ...extraLines,
    lead.message ? `Nachricht:\n${lead.message}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 3900),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[telegram] send failed", res.status, body.slice(0, 300));
    return false;
  }
  return true;
}
