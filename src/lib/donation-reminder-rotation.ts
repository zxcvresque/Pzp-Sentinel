import type { Prisma } from "@/generated/prisma/client";
import { DONATION_REMINDER_VARIANT_COUNTS } from "./donation-thanks";

type Channel = keyof typeof DONATION_REMINDER_VARIANT_COUNTS;
type RotationDb = Pick<Prisma.TransactionClient, "donationReminderMessageState">;

/** Call inside the reminder-claim transaction, before contacting Telegram. */
export async function reserveDonationReminderVariant(db: RotationDb, channel: Channel, donorId: string) {
  const count = DONATION_REMINDER_VARIANT_COUNTS[channel];
  const globalKey = `${channel}:global`;
  const donorKey = `${channel}:donor:${donorId}`;

  // The atomic upsert locks this channel's row until the caller commits, so
  // concurrent bot processes cannot reserve the same next position.
  let state = await db.donationReminderMessageState.upsert({
    where: { key: globalKey },
    // Start groups at variant 1 to avoid repeating the legacy fixed variant 0.
    create: { key: globalKey, lastVariant: channel === "group" ? 1 : 0 },
    update: { lastVariant: { increment: 1 } },
  });
  const previous = await db.donationReminderMessageState.findUnique({ where: { key: donorKey } });
  if (state.lastVariant % count === previous?.lastVariant) {
    state = await db.donationReminderMessageState.update({
      where: { key: globalKey },
      data: { lastVariant: { increment: 1 } },
    });
  }
  const variant = state.lastVariant % count;
  await db.donationReminderMessageState.upsert({
    where: { key: donorKey },
    create: { key: donorKey, lastVariant: variant },
    update: { lastVariant: variant },
  });
  return variant;
}
