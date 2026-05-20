import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logSubscriptionAction } from "@/lib/github-log";
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

  // GitHub immutable log
  logSubscriptionAction({
    action: "UPDATED",
    userId: user.id,
    userName: user.name,
    entityId: id,
    platform: subscription.platform,
    details: `Updated: ${subscription.platform}`,
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

  const existing = await prisma.subscription.findUnique({ where: { id } });
  await prisma.subscription.delete({ where: { id } });

  // GitHub immutable log
  logSubscriptionAction({
    action: "DELETED",
    userId: user.id,
    userName: user.name,
    entityId: id,
    platform: existing?.platform || "unknown",
    details: `Deleted: ${existing?.platform || id}`,
  });

  return NextResponse.json({ success: true });
}
