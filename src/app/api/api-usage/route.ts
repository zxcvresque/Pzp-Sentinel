import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/secret-crypto";
import { normalizeAuthCookie, normalizeWorkspaceId, validateOpenCodeGoApiKey } from "@/lib/opencode-go-usage";
import { listApiUsageAccounts, refreshApiUsageAccount } from "@/lib/api-usage-accounts";
import { logAudit } from "@/lib/audit";

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && hasRole(user.roles, "ADMIN") ? user : null;
}

export async function GET(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const force = req.nextUrl.searchParams.get("refresh") === "1";
  const accounts = await listApiUsageAccounts(force);
  return NextResponse.json(
    { accounts, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const workspaceId = normalizeWorkspaceId(typeof body?.workspaceId === "string" ? body.workspaceId : "");
  const authCookie = typeof body?.authCookie === "string" ? body.authCookie.trim() : "";
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const expiresAt = typeof body?.expiresAt === "string" && body.expiresAt
    ? new Date(body.expiresAt)
    : null;

  if (!name || !workspaceId || !authCookie || !apiKey) {
    return NextResponse.json(
      { error: "Name, Go API key, workspace ID/URL, and auth cookie are required." },
      { status: 400 },
    );
  }
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: "Expiry date is invalid." }, { status: 400 });
  }

  try {
    normalizeAuthCookie(authCookie);
    await validateOpenCodeGoApiKey(apiKey);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OpenCode credentials are invalid." },
      { status: 400 },
    );
  }

  const account = await prisma.apiUsageAccount.create({
    data: {
      name,
      workspaceId,
      authCookie: encryptSecret(authCookie),
      apiKey: encryptSecret(apiKey),
      expiresAt,
    },
  });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: "API_USAGE_ACCOUNT_CREATE",
    entityType: "ApiUsageAccount",
    entityId: account.id,
    after: { name, workspaceId, provider: account.provider, expiresAt },
  });

  const publicAccount = await refreshApiUsageAccount(account.id);
  return NextResponse.json({ account: publicAccount }, { status: 201 });
}
