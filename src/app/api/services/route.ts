import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const services = await prisma.service.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ services });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { category, name, columns, entries } = body;

  if (!category || !name) {
    return NextResponse.json(
      { error: "category and name are required" },
      { status: 400 },
    );
  }

  const service = await prisma.service.create({
    data: {
      category,
      name,
      columns: columns ?? undefined,
      entries: entries ?? undefined,
    },
  });

  return NextResponse.json({ service }, { status: 201 });
}
