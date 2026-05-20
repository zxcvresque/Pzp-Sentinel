import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logSubscriptionAction } from "@/lib/github-log";
import { Prisma } from "@/generated/prisma/client";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const subscriptions = await prisma.subscription.findMany({
    orderBy: { expiryDate: "asc" },
  });

  return NextResponse.json({ subscriptions });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const { platform, price, frequency, expiryDate, planUrl, specs, currency } =
    body;

  if (!platform || price == null || !expiryDate) {
    return NextResponse.json(
      { error: "platform, price, and expiryDate are required" },
      { status: 400 },
    );
  }

  const subscription = await prisma.subscription.create({
    data: {
      platform,
      price: new Prisma.Decimal(price),
      frequency: frequency || "MONTHLY",
      expiryDate: new Date(expiryDate),
      planUrl: planUrl || null,
      specs: specs || undefined,
      currency: currency || "INR",
    },
  });

  // GitHub immutable log
  logSubscriptionAction({
    action: "CREATED",
    userId: user.id,
    userName: user.name,
    entityId: subscription.id,
    platform,
    details: `${subscription.currency} ${subscription.price} ${subscription.frequency}`,
    meta: { price: subscription.price.toString(), frequency: subscription.frequency },
  });

  return NextResponse.json({ subscription }, { status: 201 });
}
