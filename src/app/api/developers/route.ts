import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const developers = await prisma.user.findMany({
    where: { status: "ACTIVE", roles: { hasSome: ["DEV", "ADMIN"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, photoUrl: true, telegramUser: true, githubUsername: true },
  });
  return NextResponse.json({ developers });
}
