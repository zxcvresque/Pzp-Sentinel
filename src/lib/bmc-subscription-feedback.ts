export function isBmcCancellationEvent(type: string) {
  return type === "recurring_donation.cancelled" || type === "membership.cancelled";
}

export function shouldPromptBmcDonor(type: string, liveMode: boolean, donorId?: string | null) {
  return isBmcCancellationEvent(type) && liveMode && Boolean(donorId);
}

export function bmcFeedbackKeyboard(feedbackId: string) {
  return {
    inline_keyboard: [[
      { text: "Yes", callback_data: `bmcfb:wanted:yes:${feedbackId}` },
      { text: "No", callback_data: `bmcfb:wanted:no:${feedbackId}` },
    ], [{
      text: "Respond in Sentinel",
      web_app: { url: new URL(`/notifications/feedback/${encodeURIComponent(feedbackId)}`, process.env.WEBAPP_URL || "https://sentinel.piratezparty.com").toString() },
    }]],
  };
}
