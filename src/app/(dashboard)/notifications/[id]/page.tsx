import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notificationDestination } from "@/lib/notification-destination";
import BroadcastContent from "@/components/BroadcastContent";

export default async function NotificationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const notification = await prisma.notification.findFirst({ where: { id, userId: user.id } });
  if (!notification) notFound();
  if (!notification.read) await prisma.notification.update({ where: { id }, data: { read: true } });
  // Resolve old BMC prompts too; those predate persisted action URLs.
  const feedback = notification.entityId ? await prisma.bmcSubscriptionFeedback.findFirst({ where: {
    id: notification.entityId, ...(user.roles.includes("ADMIN") ? {} : { userId: user.id }),
  }, select: { id: true } }) : null;
  const fallback = notificationDestination({ ...notification, roles: user.roles });
  const action = feedback ? `/notifications/feedback/${feedback.id}` : notification.actionUrl || fallback;
  const safeAction = action?.startsWith("/") && !action.startsWith("//") && !/[\\\r\n]/.test(action) ? action : null;
  return <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
    <Link href="/notifications" className="text-sm text-[var(--lime)] hover:underline">All notifications</Link>
    <h1 className="mt-6 break-words text-2xl font-semibold text-[var(--text-primary)]">{notification.title}</h1>
    <time className="mt-3 block text-sm text-[var(--text-secondary)]" dateTime={notification.createdAt.toISOString()}>{notification.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST</time>
    <div className="mt-6 whitespace-pre-wrap break-words text-base leading-7 text-[var(--text-secondary)]">
      {notification.entityId?.startsWith("broadcast:") ? <BroadcastContent message={notification.message} /> : notification.message}
    </div>
    {safeAction && <Link href={safeAction} className="mt-7 inline-flex min-h-11 items-center rounded-xl bg-[var(--lime)] px-5 py-3 text-sm font-semibold text-[var(--bg-deep)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--lime)]">{feedback ? "Open response form" : "View details"}</Link>}
  </main>;
}
