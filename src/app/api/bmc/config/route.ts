import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DONOR")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const checkoutUrl = process.env.BMC_PAGE_URL?.trim() || null;
  return NextResponse.json({
    checkoutUrl,
    configured: Boolean(checkoutUrl && process.env.BMC_WEBHOOK_SECRET?.trim()),
  });
}
