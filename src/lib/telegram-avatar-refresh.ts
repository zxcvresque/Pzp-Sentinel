import { prisma } from "./db";
import { fetchTelegramPhotoUrl } from "./bot";

/**
 * Archive and persist a Telegram avatar outside authentication's critical path.
 * Authentication must never wait for Telegram downloads, Sharp conversion, or
 * the logs-topic upload.
 */
export async function refreshStoredTelegramAvatar(params: {
  userId: string;
  telegramId: string;
  userName: string;
}) {
  try {
    const photoUrl = await fetchTelegramPhotoUrl(params.telegramId, params.userName);
    if (!photoUrl) return;
    await prisma.user.update({
      where: { id: params.userId },
      data: { photoUrl },
    });
  } catch (error) {
    console.error(`[avatar] Post-login refresh failed for ${params.telegramId}:`, error);
  }
}
