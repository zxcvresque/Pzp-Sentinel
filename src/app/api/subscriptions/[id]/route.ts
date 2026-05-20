import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { Prisma } from "@/generated/prisma/client";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { platform, price, frequency, expiryDate, planUrl, specs, currency } =
    body;

  const data: Record<string, unknown> = {};
  if (platform !== undefined) data.platform = platform;
  if (price !== undefined) data.price = new Prisma.Decimal(price);
  if (frequency !== undefined) data.frequency = frequency;
  if (expiryDate !== undefined) data.expiryDate = new Date(expiryDate);
  if (planUrl !== undefined) data.planUrl = planUrl || null;
  if (specs !== undefined) data.specs = specs;
  if (currency !== undefined) data.currency = currency;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 },
    );
  }

  const subscription = await prisma.subscription.update({
    where: { id },
    data,
  });

  return NextResponse.json({ subscription });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;

  await prisma.subscription.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
