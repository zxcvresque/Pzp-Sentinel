import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logApproval, logCredentialAction } from "@/lib/github-log";
import { notify, formatTgMessage } from "@/lib/notifications";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { action } = await req.json();

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Action must be approve or reject" }, { status: 400 });
  }

  const pending = await prisma.credential.findUnique({ where: { id } });
  if (!pending || pending.status !== "PENDING") {
    return NextResponse.json({ error: "Not found or not pending" }, { status: 404 });
  }

  if (action === "reject") {
    await prisma.credential.update({
      where: { id },
      data: { status: "REJECTED", reviewedById: user.id },
    });

    // GitHub immutable log
    logApproval({
      action: "REJECT",
      reviewerId: user.id,
      reviewerName: user.name,
      entityType: "Credential",
      entityId: id,
    });
    logCredentialAction({
      action: "REJECTED",
      userId: user.id,
      userName: user.name,
      entityId: id,
      platform: pending.platform,
      details: `Rejected: ${pending.label}`,
    });

    // Notify the credential creator about rejection
    notify({
      userId: pending.createdById,
      type: "CREDENTIAL_REVIEWED",
      title: "Credential Rejected",
      message: `${pending.platform} -- ${pending.label} has been rejected by ${user.name}.`,
      entityId: id,
      priority: "HIGH",
      telegramMessage: formatTgMessage(
        "Credential Rejected",
        `${pending.platform} -- ${pending.label}`,
        `Rejected by ${user.name}`,
      ),
    }).catch(() => {});

    return NextResponse.json({ success: true, status: "REJECTED" });
  }

  if (pending.parentId) {
    await prisma.credential.update({
      where: { id: pending.parentId },
      data: {
        platform: pending.platform,
        label: pending.label,
        value: pending.value,
      },
    });
    await prisma.credential.update({
      where: { id },
      data: { status: "APPROVED", reviewedById: user.id },
    });
  } else {
    await prisma.credential.update({
      where: { id },
      data: { status: "APPROVED", reviewedById: user.id },
    });
  }

  // GitHub immutable log
  logApproval({
    action: "APPROVE",
    reviewerId: user.id,
    reviewerName: user.name,
    entityType: "Credential",
    entityId: id,
  });
  logCredentialAction({
    action: "APPROVED",
    userId: user.id,
    userName: user.name,
    entityId: id,
    platform: pending.platform,
    details: `Approved: ${pending.label}${pending.parentId ? " (revision)" : ""}`,
  });

  // Notify the credential creator about approval
  notify({
    userId: pending.createdById,
    type: "CREDENTIAL_REVIEWED",
    title: "Credential Approved",
    message: `${pending.platform} -- ${pending.label} has been approved by ${user.name}.`,
    entityId: id,
    priority: "NORMAL",
    telegramMessage: formatTgMessage(
      "Credential Approved",
      `${pending.platform} -- ${pending.label}`,
      `Approved by ${user.name}`,
    ),
  }).catch(() => {});

  return NextResponse.json({ success: true, status: "APPROVED" });
}
