import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { createMonthlyDonationSubscription, RazorpayError } from "@/lib/razorpay";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (!hasRole(user.roles, "DONOR") && !hasRole(user.roles, "ADMIN"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const subscription = await createMonthlyDonationSubscription({
      userId: user.id,
      amount: body.amount,
      description: body.description,
      requireAccess: !hasRole(user.roles, "ADMIN"),
    });
    return NextResponse.json({ subscription });
  } catch (error) {
    const status = error instanceof RazorpayError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not create monthly subscription";
    console.error("[razorpay] subscription creation failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
