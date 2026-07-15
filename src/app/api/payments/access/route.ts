import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || (!hasRole(user.roles, "DONOR") && !hasRole(user.roles, "ADMIN"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  return NextResponse.json({
    access: {
      bmc: hasRole(user.roles, "ADMIN") || user.bmcAccess,
      razorpay: hasRole(user.roles, "ADMIN") || user.razorpayAccess,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
