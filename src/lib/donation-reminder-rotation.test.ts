import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { reserveDonationReminderVariant } from "./donation-reminder-rotation";

// Durable backing store is separate from each client/process instance.
function client(rows = new Map<string, number>()) {
  return {
    rows,
    db: {
      donationReminderMessageState: {
        async upsert({ where, create, update }: {
          where: { key: string };
          create: { key: string; lastVariant: number };
          update: { lastVariant: number | { increment: number } };
        }) {
          const previous = rows.get(where.key);
          const lastVariant = previous === undefined ? create.lastVariant
            : typeof update.lastVariant === "number" ? update.lastVariant
              : previous + update.lastVariant.increment;
          rows.set(where.key, lastVariant);
          return { key: where.key, lastVariant };
        },
        async findUnique({ where }: { where: { key: string } }) {
          const lastVariant = rows.get(where.key);
          return lastVariant === undefined ? null : { key: where.key, lastVariant };
        },
        async update({ where, data }: {
          where: { key: string };
          data: { lastVariant: { increment: number } };
        }) {
          const lastVariant = rows.get(where.key)! + data.lastVariant.increment;
          rows.set(where.key, lastVariant);
          return { key: where.key, lastVariant };
        },
      },
    } as unknown as Pick<Prisma.TransactionClient, "donationReminderMessageState">,
  };
}

describe.each(["dm", "group"] as const)("%s reminder rotation", (channel) => {
  it("uses all 15 variants before wrapping for new donors, without adjacent repeats", async () => {
    const { db } = client();
    const variants = [];
    for (let i = 0; i < 31; i++) {
      variants.push(await reserveDonationReminderVariant(db, channel, `donor-${i}`));
    }
    expect(new Set(variants.slice(0, 15)).size).toBe(15);
    expect(new Set(variants.slice(15, 30)).size).toBe(15);
    for (let i = 1; i < variants.length; i++) expect(variants[i]).not.toBe(variants[i - 1]);
    expect(variants[15]).toBe(variants[0]);
  });

  it("skips a donor's previous variant even when the global rotation wraps back to it", async () => {
    const { db } = client();
    const first = await reserveDonationReminderVariant(db, channel, "returning-donor");
    for (let i = 0; i < 14; i++) {
      await reserveDonationReminderVariant(db, channel, `other-${i}`);
    }
    const next = await reserveDonationReminderVariant(db, channel, "returning-donor");
    expect(next).not.toBe(first);
    expect(next).toBe((first + 1) % 15);
  });

  it("retains both channel and donor history when a new process/client starts", async () => {
    const { db, rows } = client();
    const first = await reserveDonationReminderVariant(db, channel, "donor");
    const restarted = client(rows);
    expect(await reserveDonationReminderVariant(restarted.db, channel, "other"))
      .toBe((first + 1) % 15);
    for (let i = 0; i < 13; i++) {
      await reserveDonationReminderVariant(restarted.db, channel, `other-${i}`);
    }
    expect(await reserveDonationReminderVariant(client(rows).db, channel, "donor"))
      .not.toBe(first);
  });

  it("avoids repeated wording for each donor in a mixed stream of reminders", async () => {
    const { db } = client();
    const previous = new Map<string, number>();
    let lastGlobal: number | undefined;
    for (let i = 0; i < 180; i++) {
      const donor = `donor-${(i * i + i) % 17}`;
      const variant = await reserveDonationReminderVariant(db, channel, donor);
      expect(variant).not.toBe(lastGlobal);
      expect(variant).not.toBe(previous.get(donor));
      expect(variant).toBeGreaterThanOrEqual(0);
      expect(variant).toBeLessThan(15);
      previous.set(donor, variant);
      lastGlobal = variant;
    }
  });
});

it("keeps DM and group rotation independent and moves off the legacy group copy", async () => {
  const { db } = client();
  expect(await reserveDonationReminderVariant(db, "dm", "donor")).toBe(0);
  expect(await reserveDonationReminderVariant(db, "dm", "donor")).toBe(1);
  expect(await reserveDonationReminderVariant(db, "group", "donor")).toBe(1);
  expect(await reserveDonationReminderVariant(db, "group", "donor")).toBe(2);
});
