import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { createDonationOrder, RazorpayError } from "@/lib/razorpay";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (!hasRole(user.roles, "DONOR") && !hasRole(user.roles, "ADMIN"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const order = await createDonationOrder({
      userId: user.id,
      amount: body.amount,
      description: body.description,
      requireAccess: !hasRole(user.roles, "ADMIN"),
    });
    return NextResponse.json({ order });
  } catch (error) {
    const status = error instanceof RazorpayError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not create payment order";
    console.error("[razorpay] order creation failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
