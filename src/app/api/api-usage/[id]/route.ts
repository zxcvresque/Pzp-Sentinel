import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/secret-crypto";
import { normalizeAuthCookie, normalizeWorkspaceId, validateOpenCodeGoApiKey } from "@/lib/opencode-go-usage";
import { getPublicApiUsageAccount, refreshApiUsageAccount } from "@/lib/api-usage-accounts";
import { logAudit } from "@/lib/audit";

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && hasRole(user.roles, "ADMIN") ? user : null;
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  const existing = await prisma.apiUsageAccount.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    data.name = name;
  }
  if (typeof body.workspaceId === "string") {
    const workspaceId = normalizeWorkspaceId(body.workspaceId);
    if (!workspaceId) return NextResponse.json({ error: "Workspace ID/URL is invalid." }, { status: 400 });
    data.workspaceId = workspaceId;
  }
  if (typeof body.authCookie === "string" && body.authCookie.trim()) {
    try {
      normalizeAuthCookie(body.authCookie);
      data.authCookie = encryptSecret(body.authCookie.trim());
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid cookie." }, { status: 400 });
    }
  }
  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    try {
      await validateOpenCodeGoApiKey(body.apiKey);
      data.apiKey = encryptSecret(body.apiKey.trim());
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid API key." }, { status: 400 });
    }
  }
  if (body.clearApiKey === true) data.apiKey = null;
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (body.expiresAt === null || body.expiresAt === "") data.expiresAt = null;
  else if (typeof body.expiresAt === "string") {
    const expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return NextResponse.json({ error: "Expiry date is invalid." }, { status: 400 });
    }
    data.expiresAt = expiresAt;
  }

  if (Object.keys(data).length > 0) {
    await prisma.apiUsageAccount.update({
      where: { id },
      data: {
        ...data,
        lastError: null,
        lastErrorAt: null,
      },
    });
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: "API_USAGE_ACCOUNT_UPDATE",
      entityType: "ApiUsageAccount",
      entityId: id,
      before: { name: existing.name, workspaceId: existing.workspaceId, enabled: existing.enabled },
      after: { changedFields: Object.keys(data).filter((key) => key !== "authCookie" && key !== "apiKey") },
    });
  }

  const account = body.refresh === false
    ? await getPublicApiUsageAccount(id)
    : await refreshApiUsageAccount(id);
  return NextResponse.json({ account });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  const account = await prisma.apiUsageAccount.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  await prisma.apiUsageAccount.delete({ where: { id } });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: "API_USAGE_ACCOUNT_DELETE",
    entityType: "ApiUsageAccount",
    entityId: id,
    before: { name: account.name, workspaceId: account.workspaceId, provider: account.provider },
  });
  return NextResponse.json({ ok: true });
}
