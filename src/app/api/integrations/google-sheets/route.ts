import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { syncFinanceWorkbook } from "@/lib/finance-sheets";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json({
    configured: Boolean(
      process.env.GOOGLE_SHEETS_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY,
    ),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const result = await syncFinanceWorkbook({
      action: "MANUAL_SYNC",
      actorName: user.name,
      sendBackup: body.sendBackup === true,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[finance-sheets] manual sync failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Google Sheets synchronization failed" },
      { status: 502 },
    );
  }
}
