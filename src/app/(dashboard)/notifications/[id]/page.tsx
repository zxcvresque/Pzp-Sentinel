import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notificationTargets } from "@/lib/notification-routing";
import BroadcastContent from "@/components/BroadcastContent";

export default async function NotificationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const notification = await prisma.notification.findFirst({ where: { id, userId: user.id } });
  if (!notification) notFound();
  if (!notification.read) await prisma.notification.update({ where: { id }, data: { read: true } });
  const destination = (await notificationTargets([notification], user)).get(id);
  if (destination && destination !== `/notifications/${encodeURIComponent(id)}`) redirect(destination);
  return <article className="mx-auto w-full max-w-2xl">
    <Link href="/notifications" className="text-sm text-[var(--lime)] hover:underline">All notifications</Link>
    <h1 className="mt-6 break-words text-2xl font-semibold text-[var(--text-primary)]">{notification.title}</h1>
    <time className="mt-3 block text-sm text-[var(--text-secondary)]" dateTime={notification.createdAt.toISOString()}>{notification.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST</time>
    <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6">
      <BroadcastContent message={notification.message} className="break-words text-text-secondary [&_p]:leading-7" />
    </div>
  </article>;
}
