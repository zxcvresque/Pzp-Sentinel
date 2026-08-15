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
    ]],
  };
}
