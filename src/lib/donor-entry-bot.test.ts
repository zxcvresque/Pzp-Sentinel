import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Context } from "grammy";
const db = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { oneTimeDonationInvite: db } }));
import { handleDonorEntry } from "./donor-entry-bot";
const token="a".repeat(43);
function ctx() { return { chat:{type:"private"},from:{id:12345,username:"example"},reply:vi.fn() }; }
beforeEach(() => { vi.clearAllMocks();vi.stubEnv("WEBAPP_URL","https://sentinel.example"); });
afterEach(() => vi.unstubAllEnvs());
it("leaves monthly and normal start to Sentinel's existing role gate", async () => {
  expect(await handleDonorEntry(ctx() as unknown as Context,"monthly")).toBe(false);
  expect(db.findUnique).not.toHaveBeenCalled();
});
it("does not reveal payment options to a different Telegram account", async () => {
  db.findUnique.mockResolvedValue({id:"invite",expiresAt:new Date(Date.now()+3600000)});
  db.updateMany.mockResolvedValue({count:0});const context=ctx();
  await handleDonorEntry(context as unknown as Context,"donate_"+token);
  expect(context.reply).toHaveBeenCalledWith("This payment invitation belongs to another Telegram account.");
});
it("reveals checkout only after the Telegram identity claim succeeds", async () => {
  db.findUnique.mockResolvedValue({id:"invite",expiresAt:new Date(Date.now()+3600000)});
  db.updateMany.mockResolvedValue({count:1});const context=ctx();
  await handleDonorEntry(context as unknown as Context,"donate_"+token);
  expect(db.updateMany.mock.calls[0][0].where.OR).toEqual([{telegramId:null},{telegramId:"12345"}]);
  expect(context.reply.mock.calls[0][1].reply_markup.inline_keyboard[0][0].web_app.url).toBe("https://sentinel.example/donate/"+token);
});
it("rejects used or expired invitations", async () => {
  db.findUnique.mockResolvedValue({id:"invite",expiresAt:new Date(0)});const context=ctx();
  await handleDonorEntry(context as unknown as Context,"donate_"+token);
  expect(db.updateMany).not.toHaveBeenCalled();
});
