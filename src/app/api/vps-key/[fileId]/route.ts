import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { fetchTelegramFile } from "@/lib/telegram-file";
import { logAudit } from "@/lib/audit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const user = await getCurrentUser();
  const { fileId } = await params;
  if (!user || !hasRole(user.roles, "ADMIN")) {
    if (user) await logAudit({ userId: user.id, userName: user.name, action: "VPS_KEY_ACCESS_DENIED", entityType: "VpsKey", entityId: fileId, request: req, outcome: "FAILURE", errorMessage: "Admin access required" });
    return new NextResponse(null, { status: 403 });
  }
  const file = await fetchTelegramFile(fileId);
  if (!file) return new NextResponse(null, { status: 404 });
  await logAudit({ userId: user.id, userName: user.name, action: "VPS_KEY_DOWNLOAD", entityType: "VpsKey", entityId: fileId, request: req });
  return new NextResponse(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/[\"\\]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
