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
  return <article className="mx-auto w-full max-w-2xl">
    <Link href="/notifications" className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--lime)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--lime)]">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 5-7 7 7 7M5 12h14" /></svg>
      All notifications
    </Link>
    <h1 className="mt-4 text-2xl font-semibold text-[var(--text-primary)]">BMC recurring support</h1>
    <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{feedback.stage === "COMPLETED"
      ? "Your response is saved below. You can add information once if there’s anything else the admins should know."
      : "Buy Me a Coffee reported that this recurring support was cancelled. Share what happened so the admins can follow up."}</p>
    {user.id !== feedback.userId && <p className="mt-3 text-sm text-[var(--text-secondary)]">Donor: {feedback.user.name}</p>}
    <BmcFeedbackForm key={`${id}:${feedback.responseRevision}`} readOnly={user.id !== feedback.userId} feedback={{
      id, stage: feedback.stage, wantedToDonate: feedback.wantedToDonate,
      deliberateCancellation: feedback.deliberateCancellation, reason: feedback.reason,
      additionalInfo: feedback.additionalInfo, additionalInfoAt: feedback.additionalInfoAt?.toISOString() || null,
      respondedAt: feedback.respondedAt?.toISOString() || null,
    }} />
  </article>;
}
