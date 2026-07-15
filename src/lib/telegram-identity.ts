import { prisma } from "@/lib/db";

export function normalizeTelegramUsername(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@/, "").slice(0, 64);
}

export async function resolveRegisteredTelegramUser(value: unknown) {
  const username = normalizeTelegramUsername(value);
  if (!username) return null;

  return prisma.user.findFirst({
    where: {
      telegramUser: { equals: username, mode: "insensitive" },
      status: "ACTIVE",
    },
    select: { id: true, name: true, telegramId: true, telegramUser: true },
    orderBy: { createdAt: "desc" },
  });
}
