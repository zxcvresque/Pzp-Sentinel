import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  finalizeCapturedDonation,
  RazorpayError,
  verifyCheckoutSignature,
} from "@/lib/razorpay";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (!hasRole(user.roles, "DONOR") && !hasRole(user.roles, "ADMIN"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const orderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
    const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
    const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
    if (!/^order_[A-Za-z0-9]+$/.test(orderId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId) || !/^[a-f0-9]{64}$/i.test(signature)) {
      return NextResponse.json({ error: "Invalid payment response" }, { status: 400 });
    }

    // Signature verification must use the order ID retained by our server, not
    // an untrusted value returned by Checkout.
    const stored = await prisma.razorpayOrder.findFirst({
      where: { razorpayOrderId: orderId, userId: user.id },
      select: { razorpayOrderId: true },
    });
    if (!stored) return NextResponse.json({ error: "Payment order was not found" }, { status: 404 });
    if (!verifyCheckoutSignature({ orderId: stored.razorpayOrderId, paymentId, signature })) {
      return NextResponse.json({ error: "Payment signature verification failed" }, { status: 400 });
    }

    const result = await finalizeCapturedDonation({
      orderId: stored.razorpayOrderId,
      paymentId,
      expectedUserId: user.id,
      actorName: user.name,
    });
    return NextResponse.json({
      transaction: result.transaction,
      duplicate: result.duplicate,
      message: result.duplicate ? "Payment was already recorded" : "Payment verified and recorded",
    });
  } catch (error) {
    const status = error instanceof RazorpayError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Payment verification failed";
    console.error("[razorpay] verification failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
