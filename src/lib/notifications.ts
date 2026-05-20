import { prisma } from "@/lib/db";
import type { NotifType } from "@/generated/prisma/enums";

export async function createNotification(data: {
  userId: string;
  type: NotifType;
  title: string;
  message: string;
  entityId?: string;
}) {
  return prisma.notification.create({ data });
}
