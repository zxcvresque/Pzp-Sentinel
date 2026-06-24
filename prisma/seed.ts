import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Wiping all data...");

  // Delete in FK-safe order
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.service.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.vpsServer.deleteMany();
  await prisma.trackedRepo.deleteMany();
  await prisma.loginToken.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.user.deleteMany({
    where: { telegramId: { not: "1800754304" } },
  });

  console.log("All tables cleared.");

  // Keep Varad as the sole admin
  const varad = await prisma.user.upsert({
    where: { telegramId: "1800754304" },
    update: { roles: ["ADMIN", "DEV", "DONOR"] },
    create: {
      telegramId: "1800754304",
      telegramUser: "varad",
      name: "Varad",
      roles: ["ADMIN", "DEV", "DONOR"],
    },
  });
  console.log(`User: ${varad.name} (${varad.telegramId}) — roles: ${varad.roles.join(", ")}`);

  // Seed default tags (useful for task creation later)
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
  console.log(`Tags: ${tagData.map((t) => t.name).join(", ")}`);

  console.log("\nClean slate ready.");
}

main()
  .then(() => { prisma.$disconnect(); pool.end(); })
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    pool.end();
    process.exit(1);
  });
