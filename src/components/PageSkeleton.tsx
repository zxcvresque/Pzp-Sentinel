import ServicesLoading from "@/app/(dashboard)/admin/services/loading";
import VpsLoading from "@/app/(dashboard)/admin/vps/loading";
import ReposLoading from "@/app/(dashboard)/admin/repos/loading";
import { BmcConnectionSkeleton } from "./BmcConnection";

function Line({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} />;
}

function LoadingRegion({ children, label }: { children: React.ReactNode; label: string }) {
  return <div role="status" aria-label={label}><span className="sr-only">{label}</span><div aria-hidden="true">{children}</div></div>;
}

export function FeedbackSkeleton() {
  return <LoadingRegion label="Loading support response"><div className="mx-auto max-w-2xl">
    <Line className="my-3 h-5 w-36" /><Line className="mt-7 h-8 w-64 max-w-full" />
    <Line className="mt-4 h-4 w-full" /><Line className="mt-2 h-4 w-3/4" />
    <div className="mt-6 rounded-2xl border border-[var(--border)] p-5 sm:p-6">
      <Line className="h-6 w-44" /><div className="mt-5 grid gap-4">{[0, 1].map(i => <div key={i} className="flex justify-between gap-4"><Line className="h-4 w-48 max-w-[70%]" /><Line className="h-5 w-16" /></div>)}</div>
      <Line className="mt-6 h-4 w-16" /><Line className="mt-3 h-4 w-full" /><Line className="mt-2 h-4 w-4/5" />
    </div>
    <Line className="mt-7 h-6 w-56" /><Line className="mt-3 h-4 w-full" /><Line className="mt-4 h-32 w-full rounded-xl" /><Line className="mt-4 h-11 w-full sm:w-60" />
  </div></LoadingRegion>;
}

export function NotificationsSkeleton({ detail = false }: { detail?: boolean }) {
  return <LoadingRegion label="Loading notifications"><div className="mx-auto max-w-2xl">
    <Line className="h-8 w-52" /><Line className="mt-3 h-4 w-4/5" />
    {detail ? <><Line className="mt-7 h-4 w-40" /><Line className="mt-6 h-4 w-full" /><Line className="mt-3 h-4 w-full" /><Line className="mt-3 h-4 w-2/3" /></> : <div className="mt-6 divide-y divide-[var(--border)]">{[0, 1, 2, 3, 4].map(i => <div key={i} className="px-3 py-5"><Line className="h-5 w-3/4" /><Line className="mt-3 h-4 w-full" /><Line className="mt-2 h-3 w-28" /></div>)}</div>}
  </div></LoadingRegion>;
}

export function TransactionRowsSkeleton() {
  return <LoadingRegion label="Loading transactions"><div className="divide-y divide-[var(--border)]">{[0, 1, 2, 3].map(i => <div key={i} className="grid gap-4 p-4 lg:min-h-[136px] lg:grid-cols-[minmax(0,1fr)_6.5rem_7rem_7.5rem_12rem] lg:items-center"><div><Line className="h-4 w-3/4" /><Line className="mt-3 h-3 w-24" /></div><Line className="h-5 w-20" /><Line className="h-6 w-20" /><Line className="h-4 w-20" /><Line className="h-8 w-32" /></div>)}</div></LoadingRegion>;
}

export function TransactionsSkeleton() {
  return <LoadingRegion label="Loading transaction ledger"><div>
    <div className="mb-6 flex flex-wrap justify-between gap-4"><div><Line className="h-9 w-64" /><Line className="mt-2 h-3 w-40" /></div><Line className="h-10 w-44" /></div>
    <Line className="mb-6 h-10 w-64 max-w-full" /><div className="mb-4 flex flex-wrap gap-3">{[0, 1, 2].map(i => <Line key={i} className="h-9 w-28" />)}</div>
    <Line className="mb-4 h-11 w-full" /><div className="overflow-hidden rounded-xl border border-[var(--border)]"><TransactionRowsSkeleton /></div>
  </div></LoadingRegion>;
}

export function DonorSkeleton() {
  return <LoadingRegion label="Loading your donations"><div>
    <div className="mb-6 flex justify-between gap-4"><Line className="h-9 w-52" /><Line className="h-10 w-32" /></div>
    <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map(i => <div key={i} className="rounded-2xl border border-[var(--border)] p-5"><Line className="h-6 w-44 max-w-full" /><Line className="mt-4 h-4 w-full" /><Line className="mt-5 h-10 w-32" /></div>)}</div>
    <div className="my-6 grid grid-cols-2 gap-4 sm:grid-cols-3">{[0, 1, 2].map(i => <div key={i}><Line className="h-4 w-24" /><Line className="mt-2 h-8 w-28" /></div>)}</div>
    <Line className="mb-4 h-9 w-64 max-w-full" /><TransactionRowsSkeleton />
  </div></LoadingRegion>;
}

export default function PageSkeleton({ pathname }: { pathname: string }) {
  if (pathname === "/admin/bmc") return <BmcConnectionSkeleton />;
  if (pathname.startsWith("/notifications/feedback/")) return <FeedbackSkeleton />;
  if (pathname.startsWith("/notifications")) return <NotificationsSkeleton detail={pathname !== "/notifications"} />;
  if (pathname === "/admin/transactions") return <TransactionsSkeleton />;
  if (pathname.startsWith("/donor")) return <DonorSkeleton />;
  if (pathname === "/admin") return <OverviewSkeleton />;
  if (pathname === "/dev") return <DevBoardSkeleton />;
  if (pathname === "/admin/services") return <ServicesLoading />;
  if (pathname === "/admin/vps") return <VpsLoading />;
  if (pathname === "/admin/repos") return <ReposLoading />;
  // Unknown screens keep the shell stable without inventing a page structure.
  return <p role="status" className="py-6 text-sm text-text-secondary">Loading {pathname.split("/").filter(Boolean).pop()?.replace(/-/g, " ") || "page"}…</p>;
}


export function OverviewSkeleton() {
  return <LoadingRegion label="Loading treasury overview"><Line className="mb-8 h-9 w-64 max-w-full" />
    <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="rounded-xl border border-[var(--border)] p-5"><Line className="mb-3 h-3 w-20" /><Line className="h-8 w-28" /></div>)}</div>
    <div className="rounded-xl border border-[var(--border)] p-5">{[0, 1, 2, 3, 4].map(i => <Line key={i} className="mb-2 h-10 w-full" />)}</div>
  </LoadingRegion>;
}

export function DevBoardSkeleton() {
  return <LoadingRegion label="Loading developer board"><Line className="mb-8 h-8 w-48" /><div className="grid gap-4 lg:grid-cols-5">{[0, 1, 2, 3, 4].map(i => <Line key={i} className="h-64 w-full rounded-xl" />)}</div></LoadingRegion>;
}
