import { NextRequest, NextResponse } from "next/server";
import { finalizeCapturedDonation, getOneTimeDonationInvite, RazorpayError, verifyCheckoutSignature } from "@/lib/razorpay";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body.token === "string" ? body.token : "";
    const orderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
    const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
    const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
    if (!/^order_[A-Za-z0-9]+$/.test(orderId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId) || !/^[a-f0-9]{64}$/i.test(signature)) {
      return NextResponse.json({ error: "Invalid payment response" }, { status: 400 });
    }
    const invite = await getOneTimeDonationInvite(token);
    if (!invite?.order || invite.order.razorpayOrderId !== orderId) {
      return NextResponse.json({ error: "Payment order was not found" }, { status: 404 });
    }
    if (!verifyCheckoutSignature({ orderId: invite.order.razorpayOrderId, paymentId, signature })) {
      return NextResponse.json({ error: "Payment signature verification failed" }, { status: 400 });
    }
    const result = await finalizeCapturedDonation({ orderId, paymentId, actorName: invite.guestName });
    return NextResponse.json({ transaction: result.transaction, duplicate: result.duplicate });
  } catch (error) {
    const status = error instanceof RazorpayError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment verification failed" }, { status });
  }
}
