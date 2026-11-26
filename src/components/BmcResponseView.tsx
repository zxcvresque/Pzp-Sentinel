import BroadcastContent from "./BroadcastContent";

export type BmcResponse = {
  wantedToDonate: boolean | null; deliberateCancellation: boolean | null;
  reason: string | null; additionalInfo: string | null;
};

export default function BmcResponseView({ feedback }: { feedback: BmcResponse }) {
  const answers = [
    ["Wanted to continue donating", feedback.wantedToDonate ? "Yes" : "No"],
    ["Deliberately cancelled", feedback.deliberateCancellation === null ? "Not asked" : feedback.deliberateCancellation ? "Yes" : "No"],
  ];
  return <div className="mt-5">
    <dl className="grid gap-3 text-sm sm:grid-cols-2 sm:gap-6">
      {answers.map(([label, answer]) => <div key={label} className="flex items-center justify-between gap-3 sm:flex-col sm:items-start sm:gap-2">
        <dt className="text-text-secondary">{label}</dt>
        <dd className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${answer === "Not asked" ? "bg-[var(--bg-elevated)] text-text-secondary" : "bg-lime/10 text-lime"}`}>{answer}</dd>
      </div>)}
    </dl>
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-text-primary">Reason</h3>
      <blockquote className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] p-4 sm:p-5">
        <BroadcastContent message={feedback.reason || "No reason supplied."} className="break-words text-text-secondary [&_blockquote]:border-0 [&_blockquote]:bg-transparent [&_blockquote]:px-0 [&_p]:leading-7" />
      </blockquote>
    </div>
    {feedback.additionalInfo && <div className="mt-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">Additional information <span className="rounded-md bg-lime/10 px-2 py-0.5 text-xs font-medium text-lime">Added</span></h3>
      <blockquote className="mt-3 rounded-xl border border-lime/20 bg-lime/[0.04] p-4 sm:p-5">
        <BroadcastContent message={feedback.additionalInfo} className="break-words text-text-secondary [&_blockquote]:border-0 [&_blockquote]:bg-transparent [&_blockquote]:px-0 [&_p]:leading-7" />
      </blockquote>
    </div>}
  </div>;
}
