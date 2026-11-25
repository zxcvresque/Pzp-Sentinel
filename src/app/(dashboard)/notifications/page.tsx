import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const rawPage = Number((await searchParams).page || 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage < 1_000_000 ? rawPage : 1;
  const rows = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 31, skip: (page - 1) * 30 });
  return <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
    <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Notifications</h1>
    <p className="mt-3 text-sm text-[var(--text-secondary)]">Open a notification to read the full message and any follow-up form.</p>
    <ul className="mt-6 divide-y divide-[var(--border)]">
      {rows.slice(0, 30).map(notification => <li key={notification.id}>
        <Link href={`/notifications/${notification.id}`} className="block rounded-lg px-3 py-4 hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--lime)]">
          <span className={`block break-words text-base text-[var(--text-primary)] ${notification.read ? "" : "font-semibold"}`}>{notification.title}{!notification.read && <span className="ml-2 text-xs text-[var(--lime)]">Unread</span>}</span>
          <span className="mt-2 line-clamp-2 block text-sm leading-6 text-[var(--text-secondary)]">{notification.message}</span>
        </Link>
      </li>)}
    </ul>
    {!rows.length && <p className="mt-8 text-[var(--text-secondary)]">No notifications on this page.</p>}
    <nav aria-label="Notification pages" className="mt-6 flex justify-between gap-4 text-sm text-[var(--lime)]">
      {page > 1 ? <Link className="py-3" href={`/notifications?page=${page - 1}`}>Newer notifications</Link> : <span />}
      {rows.length > 30 && <Link className="py-3" href={`/notifications?page=${page + 1}`}>Older notifications</Link>}
    </nav>
  </main>;
}
