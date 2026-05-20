import { Bot } from "grammy";

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

export const bot = new Bot(process.env.BOT_TOKEN);
