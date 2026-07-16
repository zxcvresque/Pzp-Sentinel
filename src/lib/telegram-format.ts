export function escapeTelegramHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatTelegramIdentity(identity: {
  name?: string | null;
  username?: string | null;
  telegramId: string;
}) {
  const username = identity.username?.trim().replace(/^@/, "");
  return [
    identity.name ? `Name: <b>${escapeTelegramHtml(identity.name)}</b>` : null,
    username ? `Username: @${escapeTelegramHtml(username)}` : null,
    `ID: <code>${escapeTelegramHtml(identity.telegramId)}</code>`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}
