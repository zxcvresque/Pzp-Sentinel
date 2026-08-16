import "dotenv/config";
import { reconcileDonationAnnouncements } from "../src/lib/donation-announcement";
import { prisma } from "../src/lib/db";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const lookbackDays = positiveInteger(process.argv[2], 7);
  const limit = positiveInteger(process.argv[3], 50);
  const result = await reconcileDonationAnnouncements(lookbackDays, limit);
  console.log(JSON.stringify({ lookbackDays, limit, ...result }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
