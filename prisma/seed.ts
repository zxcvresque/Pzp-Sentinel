import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const admin = await prisma.user.upsert({
    where: { telegramId: "REPLACE_WITH_YOUR_TG_ID" },
    update: {},
    create: {
      telegramId: "REPLACE_WITH_YOUR_TG_ID",
      telegramUser: "REPLACE_WITH_YOUR_TG_USERNAME",
      name: "Admin",
      roles: ["ADMIN", "DONOR", "DEV"],
    },
  });

  console.log("Seeded admin user:", admin.id, admin.name);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
