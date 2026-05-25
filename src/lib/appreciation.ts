// Normal donation messages (when amount is at or below the donor's average)
const NORMAL_MESSAGES = [
  "Every bit counts — thank you for keeping the lights on!",
  "Appreciate the steady support, it means a lot to the team.",
  "Thanks for the contribution — PzP grows because of people like you.",
  "Your support keeps the wheels turning. Thank you!",
  "Another one in the books — grateful for your continued support.",
];

// Generous donation messages (when amount is significantly above their average)
const GENEROUS_MESSAGES = [
  "Wow, that's incredibly generous — the whole team felt this one. Thank you!",
  "Above and beyond! This kind of support makes big things possible.",
  "Massive contribution — you just moved the needle for PzP. Thank you!",
  "This is huge. Genuinely grateful for your generosity.",
  "You really came through with this one — PzP is lucky to have supporters like you.",
];

/**
 * Pick a random appreciation message based on donation amount vs donor's history.
 * "Generous" = amount is 2x or more of their average approved donation.
 */
export function getAppreciation(amount: number, avgDonation: number | null): string {
  const isGenerous = avgDonation !== null && avgDonation > 0 && amount >= avgDonation * 2;
  const pool = isGenerous ? GENEROUS_MESSAGES : NORMAL_MESSAGES;
  return pool[Math.floor(Math.random() * pool.length)];
}
