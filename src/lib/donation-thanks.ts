// Donation thank-you + donate-reminder message templates.
// Group posts use {user} (=@username) and {amount} (=₹X / $X). The tier is
// chosen by amount + currency (INR thresholds, with USD equivalents).

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

// Public group thank-you templates by tier.
const GROUP_TEMPLATES: Record<DonationTier, string[]> = {
  everyBit: [
    "🏴‍☠️ {user} chipped in {amount} — every coin counts, thank you! 🙏",
    "Ahoy {user}! {amount} added to the treasury. Small waves make big tides 🌊",
    "{user} pitched in {amount} 💛 grateful for every bit that keeps PzP afloat!",
  ],
  decent: [
    "🙌 {user} dropped {amount} into the chest! Solid support — thank you!",
    "Big thanks to {user} for {amount}! 💪 Exactly what keeps the ship sailing.",
    "{user} just donated {amount} 🏴‍☠️ appreciate you standing with the crew!",
    "Cheers {user}! {amount} received with gratitude — keeping the lights on 🔆",
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
    "🚀 WHOA — {user} donated {amount}! A massive lift for PzP. Thank you, legend!",
    "🏴‍☠️ {user} dropped a hefty {amount}! The whole crew is cheering!",
    "Standing ovation for {user} 👏👏 {amount} donated — this moves the needle!",
    "🔥🔥 {user} contributed {amount}! Generosity like this keeps the dream alive.",
    "{user} powered up the treasury with {amount} ⚡ absolute champion!",
    "Big love to {user} for {amount} 💛🏴‍☠️ a pillar of this crew. Thank you!",
  ],
  epic: [
    "🚨 LEGEND ALERT 🚨 {user} donated {amount}! The crew is speechless. 🏴‍☠️",
    "🤯 {user} dropped a mighty {amount}! Huge for PzP — deepest gratitude!",
    "👑 {user} gave {amount}! Royalty status unlocked — thank you!",
    "🔥 Hats off to {user} — {amount} donated! This changes everything. THANK YOU!",
    "{user} made it rain {amount} 💸 the whole party owes you one!",
    "🙌 {user} backed PzP with a massive {amount}! You keep us sailing, captain!",
  ],
  legendary: [
    "🏆🏴‍☠️ HALL OF FAME — {user} donated {amount}!! The entire crew bows.",
    "🚨🔥 {user} DROPPED {amount}!! Monumental for PzP. An absolute legend! 👑",
    "🤯 We're floored — {user} gave {amount}! Patrons like you make the impossible possible.",
    "👑👑 ALL HAIL {user} — {amount}!! The treasury sings your name.",
    "🎆 {user} powered PzP with a colossal {amount}! Eternal respect 🏴‍☠️",
    "🙇 {user} contributed an epic {amount}!! You're carrying PzP. THANK YOU, legend!",
  ],
};

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
];

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
  const u = username?.replace(/^@/, "").trim();
  const n = name?.trim();
  if (n && u) return `${n} (@${u})`;
  if (u) return `@${u}`;
  if (n) return n;
  return "A generous supporter";
}

/** Public group thank-you. `handle` should be "@username" (or a fallback name). */
export function groupThanks(handle: string, amount: number, currency: string): string {
  const tier = tierFor(amount, currency);
  return pick(GROUP_TEMPLATES[tier])
    .replaceAll("{user}", handle)
    .replaceAll("{amount}", formatAmount(amount, currency));
}

/** Personal DM thank-you. */
export function dmThanks(name: string, amount: number, currency: string): string {
  const tier = tierFor(amount, currency);
  return pick(DM_TEMPLATES[tier])
    .replaceAll("{name}", name)
    .replaceAll("{amount}", formatAmount(amount, currency));
}

/** Donate-reminder nudge DM. First reminder asks about frequency; later ones point to Profile. */
export function donateReminderMessage(name: string, isFirst: boolean): string {
  const base = pick(REMINDER_TEMPLATES).replaceAll("{name}", name);
  const suffix = isFirst
    ? "\n\n<i>This is your first reminder — want these more or less often, or off? Set your preference anytime in your Profile → Donation reminders.</i>"
    : "\n\n<i>Change how often you get these in your Profile → Donation reminders.</i>";
  return base + suffix;
}
