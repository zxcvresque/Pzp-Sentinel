import { prisma } from "./db";
import { notificationDestination } from "./notification-destination";

type NotificationTarget = { id: string; type: string; entityId: string | null; title: string; actionUrl: string | null };

export function safeNotificationPath(path?: string | null) {
  return path?.startsWith("/") && !path.startsWith("//") && !/[\\\r\n]/.test(path) ? path : null;
}

// Resolve entity identity rather than guessing from message copy. Older SYSTEM
// payment notifications predate actionUrl and need the same direct destination.
export async function notificationTargets(rows: NotificationTarget[], user: { id: string; roles: string[] }) {
  const ids = rows.flatMap(row => row.entityId ? [row.entityId] : []);
  const admin = user.roles.includes("ADMIN");
  const [payments, feedback] = ids.length ? await Promise.all([
    prisma.transaction.findMany({ where: { id: { in: ids }, ...(admin ? {} : { fromUserId: user.id }) }, select: { id: true } }),
    prisma.bmcSubscriptionFeedback.findMany({ where: { id: { in: ids }, ...(admin ? {} : { userId: user.id }) }, select: { id: true } }),
  ]) : [[], []];
  const paymentIds = new Set(payments.map(row => row.id));
  const feedbackIds = new Set(feedback.map(row => row.id));
  return new Map(rows.map(row => {
    const entity = row.entityId;
    const destination = entity && paymentIds.has(entity)
      ? `${admin ? "/admin/transactions" : "/donor"}?transactionId=${encodeURIComponent(entity)}&lifecycle=ALL`
      : entity && feedbackIds.has(entity)
        ? `/notifications/feedback/${encodeURIComponent(entity)}`
        : safeNotificationPath(row.actionUrl) || notificationDestination({ ...row, roles: user.roles });
    return [row.id, destination || `/notifications/${encodeURIComponent(row.id)}`];
  }));
}
