import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const admin = await prisma.user.upsert({
    where: { telegramId: "1800754304" },
    update: { roles: ["ADMIN", "DONOR", "DEV"] },
    create: {
      telegramId: "1800754304",
      telegramUser: "varad",
      name: "Varad",
      roles: ["ADMIN", "DONOR", "DEV"],
    },
  });

  console.log("Seeded admin:", admin.id, admin.name, admin.roles);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
