import { escapeTelegramHtml } from "./telegram-format";

export const BMC_FEEDBACK_TEXT_LIMIT = 1500;

export class FeedbackError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function feedbackText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new FeedbackError("Please enter a response.");
  const text = value.trim();
  if (text.length > BMC_FEEDBACK_TEXT_LIMIT) throw new FeedbackError(`Please use ${BMC_FEEDBACK_TEXT_LIMIT} characters or fewer.`);
  return text;
}

export function feedbackAnswers(body: Record<string, unknown>) {
  if (typeof body.wantedToDonate !== "boolean") throw new FeedbackError("Choose whether you wanted to continue donating.");
  if (!body.wantedToDonate && typeof body.deliberateCancellation !== "boolean") throw new FeedbackError("Choose whether you deliberately cancelled.");
  return {
    wantedToDonate: body.wantedToDonate,
    deliberateCancellation: body.wantedToDonate ? null : body.deliberateCancellation as boolean,
    reason: feedbackText(body.reason),
  };
}

export function fullBmcResponse(feedback: {
  wantedToDonate: boolean | null; deliberateCancellation: boolean | null;
  reason: string | null; additionalInfo: string | null;
}) {
  return [
    `Wanted to continue donating: ${feedback.wantedToDonate ? "Yes" : "No"}`,
    `Deliberately cancelled: ${feedback.deliberateCancellation === null ? "Not asked" : feedback.deliberateCancellation ? "Yes" : "No"}`,
    `Reason: ${feedback.reason || ""}`,
    ...(feedback.additionalInfo ? [`Additional information: ${feedback.additionalInfo}`] : []),
  ].join("\n\n");
}


export function formatBmcFeedbackReceipt(feedback: {
  wantedToDonate: boolean | null; deliberateCancellation: boolean | null;
  reason: string | null; additionalInfo: string | null; responseSource: string | null;
}) {
  const wanted = feedback.wantedToDonate ? "Yes" : "No";
  const deliberate = feedback.deliberateCancellation === null ? "Not asked" : feedback.deliberateCancellation ? "Yes" : "No";
  return [
    "<blockquote><b>BMC recurring-support response</b></blockquote>",
    `<b>Your response was recorded in ${feedback.responseSource === "APP" ? "the Sentinel app" : "Telegram"}:</b>`,
    "",
    `<b>Wanted to continue donating:</b> ${wanted}`,
    `<b>Deliberately cancelled:</b> ${deliberate}`,
    "",
    "<b>Reason</b>",
    `<blockquote>${escapeTelegramHtml(feedback.reason || "")}</blockquote>`,
    ...(feedback.additionalInfo ? ["", "<b>Additional information</b>", `<blockquote>${escapeTelegramHtml(feedback.additionalInfo)}</blockquote>`] : []),
    "",
    feedback.additionalInfo
      ? "<i>Your additional information has been recorded. This form is complete.</i>"
      : "<i>You can add additional information once using the button below.</i>",
  ].join("\n");
}
