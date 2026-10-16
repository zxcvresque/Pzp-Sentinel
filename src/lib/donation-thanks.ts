// Donation thank-you + donate-reminder message templates.
// Group posts use {user} (=@username) and {amount} (=₹X / $X). The tier is
// chosen by amount + currency (INR thresholds, with USD equivalents).

import { escapeTelegramHtml } from "./telegram-format";

export type DonationTier = "everyBit" | "decent" | "good" | "great" | "epic" | "legendary";

// Descending thresholds per currency — first match wins.
const THRESHOLDS: Record<"INR" | "USD", { tier: DonationTier; min: number }[]> = {
  INR: [
    { tier: "legendary", min: 2000 },
    { tier: "epic", min: 1000 },
    { tier: "great", min: 500 },
    { tier: "good", min: 200 },
    { tier: "decent", min: 100 },
    { tier: "everyBit", min: 0 },
  ],
  USD: [
    { tier: "legendary", min: 50 },
    { tier: "epic", min: 20 },
    { tier: "great", min: 10 },
    { tier: "good", min: 5 },
    { tier: "decent", min: 2 },
    { tier: "everyBit", min: 0 },
  ],
};

export function tierFor(amount: number, currency: string): DonationTier {
  const table = currency === "USD" ? THRESHOLDS.USD : THRESHOLDS.INR;
  return table.find((t) => amount >= t.min)?.tier ?? "everyBit";
}

export function formatAmount(amount: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : "₹";
  const n = Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);
  return `${symbol}${n}`;
}

type GroupTemplate = string | { callout: string; message: string };

// Public group thank-you templates by tier. A callout is rendered as its own
// bold quote above the thank-you copy.
const GROUP_TEMPLATES: Record<DonationTier, GroupTemplate[]> = {
  everyBit: [
    "🏴‍☠️ {user} chipped in {amount} — every coin counts, thank you! 🙏",
    "Ahoy {user} — {amount} added to the treasury! Small waves make big tides 🌊",
    "{user} pitched in {amount} 💛 grateful for every bit that keeps PzP afloat!",
  ],
  decent: [
    "🙌 {user} dropped {amount} into the chest! Solid support — thank you!",
    "Big thanks to {user} for {amount}! 💪 Exactly what keeps the ship sailing.",
    "{user} just donated {amount} 🏴‍☠️ appreciate you standing with the crew!",
    "Cheers {user} — {amount} received with gratitude! Keeping the lights on 🔆",
    "🎉 {user} contributed {amount}! Members like you make PzP stronger.",
    "{user} backed us with {amount} 💛 respect from the whole crew!",
  ],
  good: [
    "🔥 {user} donated {amount}! A serious boost — thank you for fueling PzP!",
    "Huge thanks to {user} for {amount}! 💪 This carries us through the month.",
    "{user} dropped {amount} into the war chest ⚔️ the crew salutes you!",
    "👏 {user} came through with {amount}! Real support — thank you!",
    "Massive respect to {user} for {amount} 🏴‍☠️ you're powering the mission!",
    "{user} just gave {amount} 💛 generous and appreciated — thank you!",
  ],
  great: [
    { callout: "🚀 WHOA", message: "{user} donated {amount}! A massive lift for PzP. Thank you, legend!" },
    "🏴‍☠️ {user} dropped a hefty {amount}! The whole crew is cheering!",
    "Standing ovation for {user} 👏👏 {amount} donated — this moves the needle!",
    "🔥🔥 {user} contributed {amount}! Generosity like this keeps the dream alive.",
    "{user} powered up the treasury with {amount} ⚡ absolute champion!",
    "Big love to {user} for {amount} 💛🏴‍☠️ a pillar of this crew. Thank you!",
  ],
  epic: [
    { callout: "🚨 LEGEND ALERT 🚨", message: "{user} donated {amount}! The crew is speechless. 🏴‍☠️" },
    "🤯 {user} dropped a mighty {amount}! Huge for PzP — deepest gratitude!",
    "👑 {user} gave {amount}! Royalty status unlocked — thank you!",
    "🔥 Hats off to {user} — {amount} donated! This changes everything. THANK YOU!",
    "{user} made it rain {amount} 💸 the whole party owes you one!",
    "🙌 {user} backed PzP with a massive {amount}! You keep us sailing, captain!",
  ],
  legendary: [
    { callout: "🏆🏴‍☠️ HALL OF FAME", message: "{user} donated {amount}!! The entire crew bows." },
    "🚨🔥 {user} DROPPED {amount}!! Monumental for PzP. An absolute legend! 👑",
    { callout: "🤯 WE'RE FLOORED", message: "{user} gave {amount}! Patrons like you make the impossible possible." },
    { callout: "👑👑 ALL HAIL", message: "{user} donated {amount}!! The treasury sings your name." },
    "🎆 {user} powered PzP with a colossal {amount}! Eternal respect 🏴‍☠️",
    "🙇 {user} contributed an epic {amount}!! You're carrying PzP. THANK YOU, legend!",
  ],
};

function formatGroupTemplate(template: GroupTemplate, handle: string, amount: string) {
  const source = typeof template === "string" ? template : template.message;
  const amountTokenEnd = source.indexOf("{amount}") + "{amount}".length;
  const terminal = source.slice(amountTokenEnd).match(/^[\s\S]*?[.!?]+(?=\s|$)/);
  const firstEnd = terminal ? amountTokenEnd + terminal[0].length : source.length;
  const replaceTokens = (value: string) => value
    .replaceAll("{user}", handle)
    .replaceAll("{amount}", amount);
  const firstSentence = replaceTokens(source.slice(0, firstEnd));
  const remainder = replaceTokens(source.slice(firstEnd).trimStart());
  const message = `<b>${firstSentence}</b>${remainder ? ` ${remainder}` : ""}`;
  return typeof template === "string"
    ? message
    : `<blockquote><b>${template.callout}</b></blockquote>\n${message}`;
}

// Personal DM thank-you templates by tier (warmer, by name).
const DM_TEMPLATES: Record<DonationTier, string[]> = {
  everyBit: [
    "Hey {name} 🙏 thank you for your {amount} to PzP — every bit genuinely helps. 💛",
    "{name}, your {amount} means a lot to us. Thank you for chipping in! 🏴‍☠️",
  ],
  decent: [
    "Hey {name} 🙏 personally — thank you for your {amount} to PzP. Support like yours keeps everything running. 💛",
    "{name}, really appreciate the {amount} donation. You're keeping the crew going! 🏴‍☠️",
  ],
  good: [
    "{name}, your {amount} contribution is a real boost 🔥 thank you so much from all of us.",
    "Hey {name} — {amount} is genuinely generous. Thank you for backing PzP! 💪",
  ],
  great: [
    "{name}, your {amount} is incredible 🚀 on behalf of the whole crew — thank you. You're a big part of why PzP thrives.",
    "Wow {name} — {amount}! That's a serious gift. Deeply grateful. 🏴‍☠️💛",
  ],
  epic: [
    "{name}, {amount}?! 🤯 This is huge for us. Thank you from the bottom of our hearts — you're a legend.",
    "Hey {name} — your {amount} carries PzP forward in a real way. Endless thanks. 👑",
  ],
  legendary: [
    "{name}, your {amount} is monumental 🏆 we're floored. Thank you for believing in PzP this much — truly legendary. 🏴‍☠️",
    "{name} — {amount}! Words fall short. You have our eternal respect and gratitude. 🙇👑",
  ],
};

// Donate-reminder DM nudges.
const REMINDER_TEMPLATES: string[] = [
  "Ahoy {name}! 🏴‍☠️ PzP keeps sailing thanks to supporters like you. If you're able, a small donation this month keeps the crew going 💛",
  "Hey {name} 🙏 just a friendly nudge — even ₹200 a month makes a real difference for PzP. Every bit helps keep things running!",
  "{name}, the treasury could use a little wind in its sails ⛵ if you can chip in this month, we'd be hugely grateful. 🏴‍☠️",
  "Hi {name}! 💛 your past support means a lot. A quick donation whenever you can keeps PzP afloat — no pressure, just gratitude.",
  "{name} 🏴‍☠️ keeping PzP alive is a team effort. If this month allows, consider tossing a coin in the chest — thank you!",
  "Hey {name} ⚓ a small monthly contribution goes a long way for PzP. Whenever you're ready, the crew appreciates you!",
  "Ahoy {name} 🌊 a gentle reminder that your support helps cover PzP's running costs. If you can contribute, thank you for being part of the crew!",
  "{name}, thanks for being here 💛 if you're able to support PzP again, you can make a donation in Sentinel whenever it suits you. No pressure.",
  "Hey {name}! 🏴‍☠️ A little support from the crew keeps our shared ship moving. If now is a good time to chip in, we'd appreciate it.",
  "Hi {name} ⚓ just checking in with your donation reminder. Any contribution you're comfortable with helps PzP keep going. Thank you!",
  "{name} 💛 your support helps keep PzP's services running for everyone. If you have room to contribute, the donation page is ready in Sentinel.",
  "Ahoy {name}! ⛵ If you'd like to add a little wind to PzP's sails, here's your gentle nudge. Give when you can, and thank you either way.",
  "Hey {name} 🙌 a quick reminder about supporting PzP. Small contributions add up across the crew, and we're grateful for whatever you can manage.",
  "{name}, a friendly wave from the crew 🌊 if a donation fits your plans, you can chip in through Sentinel. Thanks for helping keep PzP afloat!",
  "Hi {name}! 🏴‍☠️ Your scheduled reminder is here. If you're in a position to contribute to PzP, we'd be grateful. It's always your choice. 💛",
];

// Public monthly reminders keep payment-status context out of the general DM pool.
const MONTHLY_GROUP_REMINDER_TEMPLATES: string[] = [
  "🏴‍☠️ Friendly monthly support reminder for {user} — we haven't received your expected monthly contribution yet. If autopay didn't go through, you can check it in Sentinel. No pressure, and thank you for keeping PzP sailing!",
  "Ahoy {user}! ⚓ Your monthly contribution hasn't appeared in Sentinel yet. If you use autopay, it may be worth checking. Thank you for supporting PzP whenever you can. 💛",
  "🌊 A gentle monthly nudge for {user} — we're still waiting for your expected contribution to show up. You can review your payment in Sentinel whenever convenient. No pressure!",
  "{user} 🏴‍☠️ a quick check-in from the crew: this monthly contribution isn't recorded yet. If you were expecting an automatic payment, please take a look in Sentinel. Thanks for your support!",
  "💛 Monthly reminder for {user}: we haven't seen your expected payment come through yet. A quick check in Sentinel can help if autopay missed it. Give when you can, and thank you!",
  "Ahoy {user} ⛵ your expected monthly support hasn't reached the treasury yet. If you'd like to check the payment or contribute manually, Sentinel is ready. Always grateful, never any pressure.",
  "⚓ Friendly heads-up for {user} — your monthly contribution is still unrecorded. If autopay was meant to handle it, you can check the status in Sentinel. Thank you for being part of the PzP crew!",
  "{user}, a little wave from PzP 🌊 we haven't recorded your expected monthly support yet. When you have a moment, you can review it in Sentinel. Your support is appreciated. 💛",
  "🏴‍☠️ Monthly check-in for {user}: the expected contribution hasn't shown up yet. If an automatic payment didn't complete, Sentinel is there to help you check. No rush, and thank you!",
  "Hey {user}! 🙌 A gentle reminder that your monthly payment hasn't appeared in our records yet. You can take a look in Sentinel whenever it suits you. Thanks for helping PzP keep going!",
  "💛 A friendly treasury nudge for {user} — your expected monthly contribution hasn't been recorded. If you're using autopay, please check that it went through. No pressure; the crew appreciates you!",
  "{user} ⚓ we're checking in because your expected monthly donation hasn't shown up in Sentinel. You can review your payment there when convenient. Thank you for keeping PzP afloat!",
  "Ahoy {user}! 🏴‍☠️ It's time for a gentle monthly reminder: we haven't received the expected contribution yet. Check Sentinel if autopay needs attention, and contribute only if you're able. 💛",
  "⛵ Monthly support check for {user} — your expected payment is still missing from our records. A look in Sentinel may help you spot an autopay issue. Thank you for sailing with PzP!",
  "{user}, here's your friendly monthly reminder 🌊 the expected contribution hasn't appeared yet. If you'd like to review it, open Sentinel whenever you're ready. No pressure, and thanks from the crew!",
];

export const DONATION_REMINDER_VARIANT_COUNTS = {
  dm: REMINDER_TEMPLATES.length,
  group: MONTHLY_GROUP_REMINDER_TEMPLATES.length,
} as const;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Public display handle for group thank-yous:
 *   "Name (@username)" when both are known,
 *   "@username" / "Name" when only one is,
 *   else a generic fallback (external/unknown donor).
 * `name` comes from the donor's Telegram /start; `username` is their @handle.
 */
export function donorHandle(name?: string | null, username?: string | null): string {
  const rawUsername = username?.replace(/^@/, "").trim();
  const u = rawUsername && /^[A-Za-z0-9_]{5,32}$/.test(rawUsername)
    ? rawUsername
    : undefined;
  const n = name?.trim();
  if (n && u) return `${n} (@${u})`;
  if (u) return `@${u}`;
  if (n) return n;
  return "A generous supporter";
}

/** Public group thank-you. `handle` should be "@username" (or a fallback name). */
export function groupThanks(
  handle: string,
  amount: number,
  currency: string,
  frequency: string = "ONE_TIME",
): string {
  const tier = tierFor(amount, currency);
  const message = formatGroupTemplate(
    pick(GROUP_TEMPLATES[tier]),
    handle,
    formatAmount(amount, currency),
  );
  const hashtag = frequency === "MONTHLY" ? "#monthly" : "#onetime";
  return `${message}\n\n<blockquote>${hashtag}</blockquote>`;
}

/** Personal DM thank-you. */
export function dmThanks(name: string, amount: number, currency: string): string {
  const tier = tierFor(amount, currency);
  return pick(DM_TEMPLATES[tier])
    .replaceAll("{name}", name)
    .replaceAll("{amount}", formatAmount(amount, currency));
}

/** Donate-reminder nudge DM. First reminder asks about frequency; later ones point to Profile. */
export function donateReminderMessage(name: string, isFirst: boolean, variant: number): string {
  const base = REMINDER_TEMPLATES[variant].replaceAll("{name}", escapeTelegramHtml(name));
  const suffix = isFirst
    ? "\n\n<i>This is your first reminder — want these more or less often, or off? Set your preference anytime in your Profile → Donation reminders.</i>"
    : "\n\n<i>Change how often you get these in your Profile → Donation reminders.</i>";
  return base + suffix;
}

/** Public nudge used only for donors who explicitly selected monthly giving. */
export function monthlyDonationReminderGroupMessage(handle: string, variant: number): string {
  return `${MONTHLY_GROUP_REMINDER_TEMPLATES[variant].replaceAll("{user}", escapeTelegramHtml(handle))}\n\n#monthly`;
}
