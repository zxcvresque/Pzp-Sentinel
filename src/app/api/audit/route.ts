import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const logs = await prisma.auditLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 200,
  });

  return NextResponse.json({ logs });
}
