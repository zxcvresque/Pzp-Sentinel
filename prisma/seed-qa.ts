import "dotenv/config";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const PREFIX = "CODXQA-20260625";
const ADMIN_TELEGRAM_ID = "1800754304";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!,
  connectionTimeoutMillis: 7_000,
  idleTimeoutMillis: 1_000,
  max: 4,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function daysAgo(days: number) {
  return daysFromNow(-days);
}

async function cleanupQaData() {
  const qaTransactions = await prisma.transaction.findMany({
    where: { description: { contains: PREFIX } },
    select: { id: true },
  });
  const txIds = qaTransactions.map((tx) => tx.id);

  if (txIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { transactionId: { in: txIds } },
          { entityId: { in: txIds } },
        ],
      },
    });
    await prisma.transaction.deleteMany({ where: { id: { in: txIds } } });
  }

  await prisma.notification.deleteMany({
    where: {
      OR: [
        { title: { contains: PREFIX } },
        { message: { contains: PREFIX } },
      ],
    },
  });
  await prisma.auditLog.deleteMany({
    where: {
      entityType: "QASeed",
    },
  });
  await prisma.reminder.deleteMany({ where: { message: { contains: PREFIX } } });
  await prisma.vpsServer.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.trackedRepo.deleteMany({
    where: {
      OR: [
        { name: { startsWith: PREFIX } },
        { fullName: { contains: PREFIX } },
      ],
    },
  });

  const credentials = await prisma.credential.findMany({
    where: {
      OR: [
        { platform: { startsWith: PREFIX } },
        { label: { startsWith: PREFIX } },
      ],
    },
    select: { id: true },
  });
  const credentialIds = credentials.map((credential) => credential.id);
  if (credentialIds.length > 0) {
    await prisma.credential.deleteMany({ where: { parentId: { in: credentialIds } } });
    await prisma.credential.deleteMany({ where: { id: { in: credentialIds } } });
  }

  await prisma.service.deleteMany({ where: { name: { startsWith: PREFIX } } });

  const projects = await prisma.project.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const projectIds = projects.map((project) => project.id);
  if (projectIds.length > 0) {
    await prisma.task.deleteMany({
      where: { projectId: { in: projectIds }, parentId: { not: null } },
    });
    await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  }

  await prisma.task.deleteMany({
    where: { title: { startsWith: PREFIX }, parentId: { not: null } },
  });
  await prisma.task.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await prisma.tag.deleteMany({ where: { name: { startsWith: PREFIX } } });

  await prisma.notification.deleteMany({
    where: {
      user: {
        telegramId: { in: ["9900002501", "9900002502", "9900002503"] },
      },
    },
  });
  await prisma.user.deleteMany({
    where: { telegramId: { in: ["9900002501", "9900002502", "9900002503"] } },
  });
}

async function main() {
  console.log(`Seeding temporary QA data (${PREFIX})...`);
  await cleanupQaData();

  const admin = await prisma.user.upsert({
    where: { telegramId: ADMIN_TELEGRAM_ID },
    update: {
      telegramUser: "varad",
      name: "Varad",
      roles: ["ADMIN", "DEV", "DONOR"],
      status: "ACTIVE",
    },
    create: {
      telegramId: ADMIN_TELEGRAM_ID,
      telegramUser: "varad",
      name: "Varad",
      roles: ["ADMIN", "DEV", "DONOR"],
      status: "ACTIVE",
    },
  });

  const qaDev = await prisma.user.create({
    data: {
      telegramId: "9900002501",
      telegramUser: "codxqa_dev",
      name: `${PREFIX} Dev User`,
      roles: ["DEV"],
      status: "ACTIVE",
      createdById: admin.id,
    },
  });
  const qaDonor = await prisma.user.create({
    data: {
      telegramId: "9900002502",
      telegramUser: "codxqa_donor",
      name: `${PREFIX} Donor User`,
      roles: ["DONOR"],
      status: "ACTIVE",
      createdById: admin.id,
    },
  });
  const qaInactive = await prisma.user.create({
    data: {
      telegramId: "9900002503",
      telegramUser: "codxqa_inactive",
      name: `${PREFIX} Inactive User`,
      roles: ["DONOR"],
      status: "INACTIVE",
      createdById: admin.id,
    },
  });

  const [backendTag, frontendTag, urgentTag] = await Promise.all([
    prisma.tag.create({ data: { name: `${PREFIX} Backend`, color: "#6FD1D7" } }),
    prisma.tag.create({ data: { name: `${PREFIX} Frontend`, color: "#A78BFA" } }),
    prisma.tag.create({ data: { name: `${PREFIX} Urgent`, color: "#FB7185" } }),
  ]);

  const project = await prisma.project.create({
    data: {
      name: `${PREFIX} Mobile QA Board`,
      description: "Temporary project for mobile interaction QA.",
      repoUrl: "https://github.com/Spamverse/pzp-finance",
      members: { connect: [{ id: admin.id }, { id: qaDev.id }] },
    },
  });

  const taskSpecs = [
    {
      status: "BACKLOG",
      priority: "LOW",
      title: "Collect mobile screenshots",
      startAgo: 6,
      dueIn: 8,
      tags: [frontendTag.id],
    },
    {
      status: "TODO",
      priority: "MEDIUM",
      title: "Verify Telegram Mini App auth",
      startAgo: 4,
      dueIn: 6,
      tags: [backendTag.id],
    },
    {
      status: "IN_PROGRESS",
      priority: "HIGH",
      title: "Patch tour spotlight layout",
      startAgo: 3,
      dueIn: 3,
      tags: [frontendTag.id, urgentTag.id],
    },
    {
      status: "REVIEW",
      priority: "CRITICAL",
      title: "Confirm VPS agent metrics",
      startAgo: 2,
      dueIn: 1,
      tags: [backendTag.id, urgentTag.id],
    },
    {
      status: "DONE",
      priority: "MEDIUM",
      title: "Seed donor receipt data",
      startAgo: 10,
      dueIn: -2,
      tags: [backendTag.id],
    },
  ] as const;

  const tasks = [];
  for (const task of taskSpecs) {
    const created = await prisma.task.create({
      data: {
        projectId: project.id,
        title: `${PREFIX} ${task.title}`,
        description: `${PREFIX} seeded task in ${task.status}.`,
        status: task.status,
        priority: task.priority,
        startDate: daysAgo(task.startAgo),
        deadline: daysFromNow(task.dueIn),
        assigneeId: admin.id,
        createdById: admin.id,
        tags: { connect: task.tags.map((id) => ({ id })) },
      },
    });
    tasks.push(created);
  }

  await prisma.task.create({
    data: {
      projectId: project.id,
      title: `${PREFIX} Subtask - validate screenshot contact sheet`,
      description: `${PREFIX} seeded subtask under the in-progress task.`,
      status: "TODO",
      priority: "LOW",
      parentId: tasks[2].id,
      assigneeId: admin.id,
      createdById: admin.id,
      tags: { connect: [{ id: frontendTag.id }] },
    },
  });

  const pendingDonation = await prisma.transaction.create({
    data: {
      amount: new Prisma.Decimal("1500"),
      currency: "INR",
      method: "UPI",
      direction: "IN",
      type: "DONATION",
      description: `${PREFIX} pending UPI donation for approval controls`,
      fromUserId: qaDonor.id,
      createdById: qaDonor.id,
      status: "PENDING",
      date: daysAgo(1),
    },
  });
  const approvedDonation = await prisma.transaction.create({
    data: {
      amount: new Prisma.Decimal("4200"),
      currency: "INR",
      method: "BANK",
      direction: "IN",
      type: "DONATION",
      description: `${PREFIX} approved bank donation for receipts`,
      fromUserId: qaDonor.id,
      createdById: qaDonor.id,
      reviewedById: admin.id,
      status: "APPROVED",
      date: daysAgo(3),
      reviewNote: `${PREFIX} receipt verified`,
    },
  });
  await prisma.transaction.createMany({
    data: [
      {
        amount: new Prisma.Decimal("650"),
        currency: "INR",
        method: "UPI",
        direction: "IN",
        type: "DONATION",
        description: `${PREFIX} rejected duplicate donor entry`,
        fromUserId: qaDonor.id,
        createdById: qaDonor.id,
        reviewedById: admin.id,
        status: "REJECTED",
        date: daysAgo(4),
        reviewNote: `${PREFIX} duplicate proof`,
      },
      {
        amount: new Prisma.Decimal("1299"),
        currency: "INR",
        method: "BANK",
        direction: "OUT",
        type: "SUBSCRIPTION",
        description: `${PREFIX} approved Supabase monthly spend`,
        createdById: admin.id,
        reviewedById: admin.id,
        status: "APPROVED",
        date: daysAgo(2),
      },
      {
        amount: new Prisma.Decimal("25"),
        currency: "USD",
        method: "BMC",
        direction: "IN",
        type: "DONATION",
        description: `BMC: Codex QA Supporter - ${PREFIX} x5 coffees`,
        fromUserId: qaDonor.id,
        createdById: admin.id,
        reviewedById: admin.id,
        status: "APPROVED",
        date: daysAgo(1),
        bmcEventId: `${PREFIX}-bmc-001`,
      },
    ],
  });

  await prisma.service.createMany({
    data: [
      {
        category: "Infrastructure",
        name: `${PREFIX} Supabase Pro`,
        price: new Prisma.Decimal("2500"),
        currency: "INR",
        frequency: "MONTHLY",
        planUrl: "https://supabase.com",
        expiryDate: daysFromNow(26),
        status: "ACTIVE",
        columns: [{ key: "owner", label: "Owner" }],
        entries: [{ owner: "Platform" }],
      },
      {
        category: "Automation",
        name: `${PREFIX} GitHub Actions`,
        price: new Prisma.Decimal("12"),
        currency: "USD",
        frequency: "MONTHLY",
        planUrl: "https://github.com/features/actions",
        expiryDate: daysFromNow(18),
        status: "ACTIVE",
        columns: [{ key: "budget", label: "Budget" }],
        entries: [{ budget: "QA" }],
      },
      {
        category: "Security",
        name: `${PREFIX} Cloudflare Tunnel`,
        price: new Prisma.Decimal("0"),
        currency: "USD",
        frequency: "MONTHLY",
        planUrl: "https://cloudflare.com",
        expiryDate: daysFromNow(40),
        status: "ACTIVE",
        columns: [{ key: "zone", label: "Zone" }],
        entries: [{ zone: "sentinel.piratezparty.com" }],
      },
    ],
  });

  const credential = await prisma.credential.create({
    data: {
      platform: `${PREFIX} Supabase`,
      label: `${PREFIX} Readonly service key`,
      value: "qa-temp-readonly-key-rotate-me",
      status: "APPROVED",
      createdById: admin.id,
      accesses: {
        create: [
          { userId: admin.id, accessLevel: "FULL", granted: true, grantedAt: new Date() },
          { userId: qaDev.id, accessLevel: "FULL", granted: true, grantedAt: new Date() },
        ],
      },
    },
  });
  await prisma.credential.create({
    data: {
      platform: `${PREFIX} Supabase`,
      label: `${PREFIX} Pending key rotation`,
      value: "qa-temp-pending-rotation",
      status: "PENDING",
      createdById: qaDev.id,
      parentId: credential.id,
    },
  });

  await prisma.reminder.createMany({
    data: [
      {
        message: `${PREFIX} Renew Supabase Pro before invoice date`,
        frequency: "MONTHLY",
        nextFire: daysFromNow(7),
        channel: "BOTH",
        recipientRoles: ["ADMIN", "DEV"],
        createdById: admin.id,
      },
      {
        message: `${PREFIX} Weekly donor receipt export check`,
        frequency: "WEEKLY",
        nextFire: daysFromNow(3),
        channel: "WEB",
        recipientRoles: ["ADMIN"],
        createdById: admin.id,
      },
    ],
  });

  await prisma.vpsServer.createMany({
    data: [
      {
        name: `${PREFIX} web-01`,
        token: `${PREFIX}-web-token`,
        provider: "Hetzner",
        ip: "203.0.113.24",
        platform: "Ubuntu 24.04",
        password: "temporary-qa-password",
        notes: `${PREFIX} online seeded metrics`,
        specs: { cpu: "2 vCPU", ram: "4GB", disk: "80GB" },
        cpuUsage: 37.4,
        ramUsage: 1.8,
        ramTotal: 4,
        diskUsage: 28,
        diskTotal: 80,
        netIn: 12.34,
        netOut: 3.21,
        uptime: 86_400,
        loadAvg: "0.42 0.36 0.31",
        status: "online",
        approved: true,
        addedById: admin.id,
        lastSeen: new Date(),
      },
      {
        name: `${PREFIX} bot-01`,
        token: `${PREFIX}-bot-token`,
        provider: "Oracle",
        ip: "203.0.113.25",
        platform: "Debian 12",
        password: "temporary-qa-password",
        notes: `${PREFIX} offline seeded metrics`,
        specs: { cpu: "1 vCPU", ram: "1GB", disk: "30GB" },
        cpuUsage: 4.2,
        ramUsage: 0.4,
        ramTotal: 1,
        diskUsage: 12,
        diskTotal: 30,
        netIn: 1.2,
        netOut: 0.5,
        uptime: 43_200,
        loadAvg: "0.05 0.03 0.01",
        status: "offline",
        approved: true,
        addedById: admin.id,
        lastSeen: daysAgo(1),
      },
      {
        name: `${PREFIX} pending-node`,
        token: `${PREFIX}-pending-token`,
        provider: "Local",
        ip: "203.0.113.26",
        platform: "Ubuntu 22.04",
        password: "temporary-qa-password",
        notes: `${PREFIX} pending approval`,
        specs: {},
        approved: false,
        addedById: qaDev.id,
        lastSeen: daysAgo(1),
      },
    ],
  });

  await prisma.trackedRepo.create({
    data: {
      name: `${PREFIX} Sentinel QA`,
      fullName: `Spamverse/${PREFIX}-sentinel-qa`,
      url: "https://github.com/Spamverse/pzp-finance",
      addedById: admin.id,
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: admin.id,
        type: "SYSTEM",
        title: `${PREFIX} QA notification`,
        message: `${PREFIX} seeded notification for top bar checks`,
        priority: "NORMAL",
      },
      {
        userId: qaDonor.id,
        type: "TX_APPROVED",
        title: `${PREFIX} Donation approved`,
        message: `${PREFIX} approved donation notification`,
        entityId: approvedDonation.id,
        priority: "NORMAL",
      },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      {
        userId: admin.id,
        action: "QA_SEED",
        entityType: "QASeed",
        entityId: PREFIX,
        before: {},
        after: {
          users: [qaDev.id, qaDonor.id, qaInactive.id],
          project: project.id,
          pendingDonation: pendingDonation.id,
          approvedDonation: approvedDonation.id,
        },
      },
      {
        userId: admin.id,
        action: "QA_VERIFY",
        entityType: "QASeed",
        entityId: `${PREFIX}-browser`,
        before: {},
        after: { prefix: PREFIX, purpose: "mobile browser QA target" },
      },
    ],
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        prefix: PREFIX,
        admin: admin.id,
        qaUsers: [qaDev.id, qaDonor.id, qaInactive.id],
        project: project.id,
        tasks: tasks.length + 1,
        pendingDonation: pendingDonation.id,
        approvedDonation: approvedDonation.id,
      },
      null,
      2,
    ),
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
