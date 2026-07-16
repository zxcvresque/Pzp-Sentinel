import { Bot } from "grammy";

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

export const bot = new Bot(process.env.BOT_TOKEN);

export function retainedArchivedTelegramPhoto(photoUrl: string | null | undefined) {
  return photoUrl?.startsWith("/api/avatar/") ? photoUrl : null;
}

/**
 * Capture a user's latest Telegram profile photo in the configured logs topic
 * and return a proxy URL for the exact archived group copy.
 *
 * Telegram download URLs are temporary and contain BOT_TOKEN, so only the
 * archived photo's stable file_id is persisted and sent to browsers.
 */
export async function fetchTelegramPhotoUrl(
  telegramId: string | number,
  userName?: string,
  botInstance: Bot = bot,
): Promise<string | null> {
  try {
    const photos = await botInstance.api.getUserProfilePhotos(Number(telegramId), { limit: 1 });
    if (!photos.total_count || photos.photos.length === 0) return null;

    // Pick the largest size (last in the array)
    const sizes = photos.photos[0];
    const biggest = sizes[sizes.length - 1];
    const groupId = process.env.TG_GROUP_ID;
    const topicId = process.env.TG_TOPIC_SCREENSHOTS;
    if (!groupId || !topicId) return null;

    try {
      const archived = await botInstance.api.sendPhoto(groupId, biggest.file_id, {
        message_thread_id: Number(topicId),
        caption: `📸 Avatar: ${userName || telegramId}\nID: ${telegramId}`,
      });
      const archivedSizes = archived.photo;
      const archivedFileId = archivedSizes[archivedSizes.length - 1]?.file_id;
      return archivedFileId ? `/api/avatar/${encodeURIComponent(archivedFileId)}` : null;
    } catch (error) {
      console.error(`[avatar] Failed to archive profile photo for ${telegramId}:`, error);
      return null;
    }
  } catch {
    return null;
  }
}
