import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Bot } from "grammy";
import { saveBmcFeedback, syncBmcFeedbackMessage } from "./bmc-feedback-service";
import { feedbackAnswers, fullBmcResponse, formatBmcFeedbackReceipt } from "./bmc-feedback-response";

function fixture() {
  const record = {
    id: "form", userId: "donor", stage: "ASK_WANTED", wantedToDonate: null as boolean | null,
    deliberateCancellation: null as boolean | null, reason: null as string | null,
    respondedAt: null as Date | null, additionalInfo: null as string | null, additionalInfoAt: null as Date | null,
    responseRevision: 0, telegramSyncedRevision: 0, telegramMessageId: 42, telegramChatId: "123",
    responseSource: "APP", user: { name: "Donor", chatId: "123" },
  };
  const notification = { createMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const db = {
    bmcSubscriptionFeedback: {
      findUnique: vi.fn(async () => ({ ...record })),
      findUniqueOrThrow: vi.fn(async () => ({ ...record })),
      updateMany: vi.fn(async ({ where, data }) => {
        if ((where.respondedAt === null && record.respondedAt) || (where.additionalInfoAt === null && record.additionalInfoAt) || (where.responseRevision !== undefined && where.responseRevision !== record.responseRevision)) return { count: 0 };
        const { responseRevision, ...rest } = data;
        Object.assign(record, rest);
        if (responseRevision) record.responseRevision += responseRevision.increment;
        return { count: 1 };
      }),
      update: vi.fn().mockResolvedValue({}),
    }, notification, user: { findMany: vi.fn().mockResolvedValue([{ id: "admin" }]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: async (run: (tx: unknown) => unknown) => run(db),
  };
  return { record, notification, db: db as unknown as PrismaClient, raw: db };
}
const body = { wantedToDonate: false, deliberateCancellation: false, reason: "My card declined.\nOctober was not paid." };
beforeEach(() => vi.clearAllMocks());

describe("BMC in-app responses", () => {
  it("saves the full response with an admin notification and a source audit", async () => {
    const f = fixture();
    await saveBmcFeedback(f.db, { id: "form", userId: "donor", source: "APP", body });
    expect(f.record).toMatchObject({ stage: "COMPLETED", reason: body.reason, responseSource: "APP", responseRevision: 1 });
    expect(f.notification.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ userId: "admin", message: expect.stringContaining(body.reason), actionUrl: "/notifications/feedback/form", telegramStatus: "PENDING_FEEDBACK" })] });
    expect(f.raw.auditLog.create).toHaveBeenCalledOnce();
  });
  it("rejects another user's form and incomplete or oversized responses", async () => {
    const f = fixture();
    await expect(saveBmcFeedback(f.db, { id: "form", userId: "intruder", source: "APP", body })).rejects.toMatchObject({ status: 404 });
    expect(() => feedbackAnswers({ reason: "text", wantedToDonate: false })).toThrow("deliberately");
    expect(() => feedbackAnswers({ ...body, reason: "x".repeat(1501) })).toThrow("1500");
    expect(f.notification.createMany).not.toHaveBeenCalled();
  });
  it("allows exactly one additional response, preserves the original and notifies admins of the addition", async () => {
    const f = fixture();
    await saveBmcFeedback(f.db, { id: "form", userId: "donor", source: "APP", body });
    const attempts = await Promise.allSettled(["New information", "Second addition"].map(additionalInfo => saveBmcFeedback(f.db, { id: "form", userId: "donor", source: "APP", body: { additionalInfo } })));
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(f.record.reason).toBe(body.reason);
    expect(f.record.additionalInfo).toBe("New information");
    expect(f.notification.createMany).toHaveBeenCalledTimes(2);
    expect(fullBmcResponse(f.record)).toContain("Additional information: New information");
    await expect(saveBmcFeedback(f.db, { id: "form", userId: "donor", source: "APP", body })).rejects.toMatchObject({ status: 409 });
  });
  it("requires the original response before an addition", async () => {
    const f = fixture();
    await expect(saveBmcFeedback(f.db, { id: "form", userId: "donor", source: "APP", body: { additionalInfo: "More" } })).rejects.toMatchObject({ status: 409 });
  });
  it("preserves user text as escaped Telegram markup and includes both complete responses", () => {
    const receipt = formatBmcFeedbackReceipt({ wantedToDonate: true, deliberateCancellation: null, reason: "<script>& My full explanation", additionalInfo: "<b>Updated</b>", responseSource: "APP" });
    expect(receipt).toContain("&lt;script&gt;&amp; My full explanation");
    expect(receipt).toContain("&lt;b&gt;Updated&lt;/b&gt;");
    expect(receipt).toContain("<b>Additional information</b>");
    expect(receipt).toContain("<i>Your additional information has been recorded.");
  });
  it("edits the original DM with the complete app response and the addition button, then removes it", async () => {
    const f = fixture();
    await saveBmcFeedback(f.db, { id: "form", userId: "donor", source: "APP", body });
    const editMessageText = vi.fn().mockResolvedValue({});
    const bot = { api: { editMessageText } } as unknown as Bot;
    await syncBmcFeedbackMessage(f.db, "form", bot);
    expect(editMessageText).toHaveBeenCalledWith("123", 42, expect.stringContaining("<b>Your response was recorded in the Sentinel app:</b>"), expect.objectContaining({ parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Add additional info?", web_app: { url: expect.stringContaining("/notifications/feedback/form") } }]] } }));
    expect(editMessageText.mock.calls[0][2]).toContain(`<blockquote>${body.reason}</blockquote>`);
    expect(editMessageText.mock.calls[0][2]).toContain("<i>You can add additional information once");
    await saveBmcFeedback(f.db, { id: "form", userId: "donor", source: "APP", body: { additionalInfo: "Card topped up" } });
    await syncBmcFeedbackMessage(f.db, "form", bot);
    expect(editMessageText.mock.calls[1][2]).toContain("Card topped up");
    expect(editMessageText.mock.calls[1][3]).toEqual({ parse_mode: "HTML", reply_markup: { inline_keyboard: [] } });
  });
  it("keeps a failed DM edit pending without losing the saved form", async () => {
    const f = fixture();
    await saveBmcFeedback(f.db, { id: "form", userId: "donor", source: "APP", body });
    await syncBmcFeedbackMessage(f.db, "form", { api: { editMessageText: vi.fn().mockRejectedValue(Error("Telegram offline")) } } as unknown as Bot);
    expect(f.record.stage).toBe("COMPLETED");
    expect(f.record.telegramSyncedRevision).toBe(0);
    expect(f.raw.bmcSubscriptionFeedback.update).toHaveBeenCalledWith(expect.objectContaining({ data: { telegramSyncError: expect.stringContaining("pending") } }));
  });
});
