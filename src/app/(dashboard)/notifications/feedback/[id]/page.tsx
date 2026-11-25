import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import BmcFeedbackForm from "@/components/BmcFeedbackForm";

export default async function FeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const feedback = await prisma.bmcSubscriptionFeedback.findFirst({
    where: { id, ...(user.roles.includes("ADMIN") ? {} : { userId: user.id }) },
    include: { user: { select: { name: true } } },
  });
  if (!feedback) notFound();
  return <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
    <Link href="/notifications" className="text-sm text-[var(--lime)] hover:underline">All notifications</Link>
    <h1 className="mt-6 text-2xl font-semibold text-[var(--text-primary)]">BMC recurring support</h1>
    <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">Buy Me a Coffee reported that this recurring support was cancelled. Share what happened so the admins can follow up.</p>
    {user.id !== feedback.userId && <p className="mt-3 text-sm text-[var(--text-secondary)]">Donor: {feedback.user.name}</p>}
    <BmcFeedbackForm key={`${id}:${feedback.responseRevision}`} readOnly={user.id !== feedback.userId} feedback={{
      id, stage: feedback.stage, wantedToDonate: feedback.wantedToDonate,
      deliberateCancellation: feedback.deliberateCancellation, reason: feedback.reason,
      additionalInfo: feedback.additionalInfo, additionalInfoAt: feedback.additionalInfoAt?.toISOString() || null,
      respondedAt: feedback.respondedAt?.toISOString() || null,
    }} />
  </main>;
}
