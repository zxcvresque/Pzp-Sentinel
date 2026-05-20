import { Bot } from "grammy";

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

export const bot = new Bot(process.env.BOT_TOKEN);

/**
 * Fetch a user's Telegram profile photo URL via Bot API.
 * Returns the highest-res photo URL, or null if none / error.
 */
export async function fetchTelegramPhotoUrl(telegramId: string | number): Promise<string | null> {
  try {
    const photos = await bot.api.getUserProfilePhotos(Number(telegramId), { limit: 1 });
    if (!photos.total_count || photos.photos.length === 0) return null;

    // Pick the largest size (last in the array)
    const sizes = photos.photos[0];
    const biggest = sizes[sizes.length - 1];

    const file = await bot.api.getFile(biggest.file_id);
    if (!file.file_path) return null;

    return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
  } catch {
    return null;
  }
}
