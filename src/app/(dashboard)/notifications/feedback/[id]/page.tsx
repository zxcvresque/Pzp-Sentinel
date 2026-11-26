import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import BmcFeedbackForm from "@/components/BmcFeedbackForm";
import { displayDateTime } from "@/lib/date-format";

export default async function FeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const feedback = await prisma.bmcSubscriptionFeedback.findFirst({
    where: { id, ...(user.roles.includes("ADMIN") ? {} : { userId: user.id }) },
    include: { user: { select: { name: true } } },
  });
  if (!feedback) notFound();
  const own = user.id === feedback.userId;
  const completed = feedback.stage === "COMPLETED";
  return <article className="mx-auto w-full max-w-2xl">
    <Link href="/notifications" className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--lime)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--lime)]">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 5-7 7 7 7M5 12h14" /></svg>
      All notifications
    </Link>
    <h1 className="mt-4 text-2xl font-semibold text-[var(--text-primary)]">BMC recurring support</h1>
    <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{completed
      ? own
        ? feedback.additionalInfoAt ? "Your response and additional information are saved. Admins can review both below." : "Your response is saved. You can add information once if there’s anything else the admins should know."
        : "Review the donor’s recorded response and any additional information below."
      : "Buy Me a Coffee reported that this recurring support was cancelled. Share what happened so the admins can follow up."}</p>
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-secondary">
      {!own && <span>Donor: <strong className="font-semibold text-text-primary">{feedback.user.name}</strong></span>}
      <time dateTime={(feedback.respondedAt || feedback.requestedAt).toISOString()}>{completed ? "Responded" : "Requested"} {displayDateTime(feedback.respondedAt || feedback.requestedAt)} IST</time>
      {feedback.additionalInfoAt && <time dateTime={feedback.additionalInfoAt.toISOString()}>Updated {displayDateTime(feedback.additionalInfoAt)} IST</time>}
    </div>
    <BmcFeedbackForm key={`${id}:${feedback.responseRevision}`} readOnly={user.id !== feedback.userId} feedback={{
      id, stage: feedback.stage, wantedToDonate: feedback.wantedToDonate,
      deliberateCancellation: feedback.deliberateCancellation, reason: feedback.reason,
      additionalInfo: feedback.additionalInfo, additionalInfoAt: feedback.additionalInfoAt?.toISOString() || null,
      respondedAt: feedback.respondedAt?.toISOString() || null,
    }} />
  </article>;
}
