import { NextRequest, NextResponse } from "next/server";
import { createGuestDonationOrder, RazorpayError } from "@/lib/razorpay";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body.token === "string" ? body.token : "";
    const order = await createGuestDonationOrder({ token, amount: body.amount, description: body.description });
    return NextResponse.json({ order });
  } catch (error) {
    const status = error instanceof RazorpayError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create checkout" }, { status });
  }
}
