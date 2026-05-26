import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // --- Clean up all tables ---
  await prisma.credential.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.service.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.tag.deleteMany();

  // --- Users ---
  await prisma.user.upsert({
    where: { telegramId: "1800754304" },
    update: { roles: ["ADMIN", "DONOR", "DEV"] },
    create: {
      telegramId: "1800754304",
      telegramUser: "varad",
      name: "Varad",
      roles: ["ADMIN", "DONOR", "DEV"],
    },
  });

  console.log("Users seeded: Varad");

  // --- Tags ---
  const tagData = [
    { name: "Backend",  color: "#6366f1" },
    { name: "Frontend", color: "#f472b6" },
    { name: "Bug",      color: "#ef4444" },
    { name: "Feature",  color: "#22d3ee" },
    { name: "DevOps",   color: "#f59e0b" },
    { name: "UI/UX",    color: "#a78bfa" },
    { name: "Security", color: "#f43f5e" },
    { name: "Docs",     color: "#34d399" },
  ];

  for (const t of tagData) {
    await prisma.tag.upsert({
      where: { name: t.name },
      update: { color: t.color },
      create: t,
    });
  }
  console.log("Tags seeded:", tagData.length);

  console.log("\nSeed complete. DB is clean for testing.");
}

main()
  .then(() => { prisma.$disconnect(); pool.end(); })
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    pool.end();
    process.exit(1);
  });
