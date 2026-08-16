import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { RazorpayError, verifyMonthlySubscriptionCheckout } from "@/lib/razorpay";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (!hasRole(user.roles, "DONOR") && !hasRole(user.roles, "ADMIN"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const subscriptionId = typeof body.razorpay_subscription_id === "string" ? body.razorpay_subscription_id : "";
    const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
    const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
    if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId) || !/^[a-f0-9]{64}$/i.test(signature)) {
      return NextResponse.json({ error: "Invalid subscription response" }, { status: 400 });
    }
    const result = await verifyMonthlySubscriptionCheckout({
      subscriptionId,
      paymentId,
      signature,
      expectedUserId: user.id,
    });
    return NextResponse.json({
      ...result,
      message: result.paymentRecorded
        ? "Monthly autopay authorised and first payment recorded"
        : "Monthly autopay authorised",
    });
  } catch (error) {
    const status = error instanceof RazorpayError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Subscription verification failed";
    console.error("[razorpay] subscription verification failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
