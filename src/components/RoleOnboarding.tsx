"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { Role } from "@/generated/prisma/enums";

type Item = { title: string; detail: string; icon: string };
type Destination = { label: string; route: string };
type Slide = { section: string; title: string; summary: string; accent: string; items: Item[]; destinations: Destination[]; asset?: "SENTINEL" | "GITHUB" | "PAYMENTS" };

const ADMIN: Slide[] = [
  slide("01 · Overview", "Dashboard and Needs Attention", "Start with treasury health, recent activity and one prioritized queue for decisions that cannot wait.", "#6FD1D7", [["Dashboard", "/admin"], ["Needs Attention", "/admin/attention"]], [["Treasury snapshot", "Balances, inflow, spending and recent entries.", "chart"], ["Decision inbox", "Payments, missing proof and incidents in one queue.", "alert"], ["Quick actions", "Open the exact record that needs work.", "action"]], "SENTINEL"),
  slide("02 · Money", "Transactions from entry to approval", "The complete financial workflow lives together: record, review, reconcile, attach receipts and audit the result.", "#F472B6", [["Ledger", "/admin/transactions"], ["Pending approvals", "?status=PENDING"], ["Reconciliation", "/admin/reconciliation"], ["Record transaction", "/admin/transactions/new"]], [["Record once", "Income, expense, donation or purchase with its receipt.", "receipt"], ["Approve safely", "Review pending and recurring deductions before posting.", "approval"], ["Match providers", "Connect Razorpay and BMC payments to people and records.", "payment"], ["Search and export", "Filter the ledger without losing provider context.", "search"]], "PAYMENTS"),
  slide("03 · Operations", "Service catalogue and billing history", "Keep every community tool, renewal, initial payment and later charge in one understandable service record.", "#FBBF24", [["Catalogue", "/admin/services"], ["Service details", "/admin/services/[id]"]], [["Templates first", "Create common services without technical field builders.", "template"], ["One billing ledger", "Initial payment and renewals appear in one history.", "ledger"], ["Linked records", "Receipts, credentials and reminders remain attached.", "link"]]),
  slide("04 · Infrastructure", "VPS ownership and operational alerts", "See machine and process health, responsible maintainers, access requests and granular alert choices.", "#A78BFA", [["VPS", "/admin/vps"], ["Operational alerts", "/admin/alerts"]], [["Live health", "CPU, memory, disk, load and deployment processes.", "server"], ["Responsible people", "Projects and maintainers are visible beside each VPS.", "people"], ["Granular alerts", "Enable only the incident types each person wants.", "bell"]]),
  slide("05 · Access", "Credentials without bulk secret exposure", "Grant the right developer the right secret while every reveal, copy and access failure remains accountable.", "#34D399", [["Credentials", "/admin/credentials"]], [["Scoped grants", "Share by person and project, then revoke cleanly.", "key"], ["Deliberate reveal", "Lists never return decrypted secrets in bulk.", "secure"], ["Full audit", "Reveal, copy, rotation and failed access are recorded.", "audit"]]),
  slide("06 · Community", "Donors and contribution access", "Manage who can donate, review provider history and understand combined support without changing original currencies.", "#60A5FA", [["Donors", "/admin/donors"]], [["Access controls", "Enable donor access and share guest contribution links.", "people"], ["Provider context", "Razorpay, BMC and manual records stay distinguishable.", "payment"], ["Fair totals", "Original amounts plus a comparable INR total.", "chart"]], "PAYMENTS"),
  slide("07 · People", "Users, roles and profile identity", "Approve new people, assign roles, manage active access and keep names consistently paired with profile photos.", "#FB7185", [["Users", "/admin/users"], ["General settings", "/profile"]], [["Role management", "Admin, developer and donor workspaces stay distinct.", "people"], ["Safe deactivation", "Protect hardcoded admins and remove obsolete access.", "secure"], ["Profile identity", "Photo, GitHub username and preferences travel together.", "profile"]]),
  slide("08 · Communication", "Broadcasts and accountable reminders", "Send the right message to the right audience and follow reminders through acknowledgement, snooze and escalation.", "#F59E0B", [["Broadcasts", "/admin/broadcasts"], ["Reminders", "/admin/reminders"]], [["Targeted broadcasts", "Reach roles or selected people through configured channels.", "broadcast"], ["Owned reminders", "Every reminder has a recipient and clear state.", "clock"], ["Follow-through", "Acknowledge, snooze and escalate instead of losing work.", "action"]]),
  slide("09 · Accountability", "Repositories, audit log and preferences", "Keep community delivery visible, inspect correlated changes and choose how Sentinel presents information to you.", "#C084FC", [["Repos", "/admin/repos"], ["Audit Log", "/admin/audit"], ["Settings", "/profile"]], [["Org activity", "Tracked repository commits motivate the developer group.", "github"], ["Workflow audit", "Related transaction, service and reminder changes group together.", "audit"], ["Your preferences", "Form layout, currency and notifications persist for you.", "settings"]], "GITHUB"),
];

const DEV: Slide[] = [
  slide("01 · Build", "Project board and community activity", "See the projects you collaborate on, move work through the board and use GitHub activity as shared momentum.", "#6FD1D7", [["Board", "/dev"], ["GitHub activity", "/dev#github"]], [["Project context", "Tasks, priorities, tags and ownership stay together.", "board"], ["Visible progress", "Org repository commits show what others are shipping.", "github"], ["Issue-ready work", "Sentinel tasks can become repository issues.", "issue"]], "GITHUB"),
  slide("02 · Focus", "My Tasks, including assigned subtasks", "A focused queue shows everything assigned to you, with filters and enough parent context to start work.", "#F472B6", [["My Tasks", "/dev/tasks"]], [["Nothing hidden", "Direct tasks and assigned subtasks appear together.", "task"], ["Useful filters", "Narrow by project, priority, state or due date.", "search"], ["Delivery loop", "Issue, pull request and done state can stay linked.", "link"]]),
  slide("03 · Run", "VPS health, access and alert choices", "See only infrastructure relevant to your projects, request SSH access and choose exactly which incidents notify you.", "#FBBF24", [["VPS Stats", "/dev/vps"]], [["Machine health", "CPU, memory, disk, load and process status.", "server"], ["Request access", "Submit a public key and follow its approval state.", "key"], ["Opt-in alerts", "Offline, load, storage and process alerts are granular.", "bell"]]),
  slide("04 · Access", "Shared credentials and safe submissions", "Use secrets explicitly granted to you and submit project credentials without exposing them to unrelated developers.", "#A78BFA", [["Credentials", "/dev/credentials"]], [["Granted to you", "Only authorized credentials appear in your workspace.", "secure"], ["Audited use", "Reveal and copy actions remain visible to administrators.", "audit"], ["Submit safely", "Provide a new secret for the relevant project.", "key"]]),
  slide("05 · You", "GitHub identity and notification settings", "Connect the username used for issues and pull requests, then choose the task, reminder and infrastructure updates you want.", "#34D399", [["General settings", "/profile"]], [["GitHub username", "Required once so assignments match the right account.", "github"], ["Notification choices", "Control events and delivery channels individually.", "bell"], ["Your profile", "Keep your name and photo recognizable across Sentinel.", "profile"]], "GITHUB"),
];

const DONOR: Slide[] = [
  slide("01 · Contribute", "Razorpay, BMC and recurring support", "Choose a secure provider, give once or monthly and see the payment appear with its real currency and method.", "#6FD1D7", [["My Donations", "/donor"], ["Secure checkout", "/donor#razorpay"], ["BMC", "/donor#bmc"]], [["Razorpay checkout", "UPI, cards and supported wallets in one checkout.", "payment"], ["Buy Me a Coffee", "USD support stays recorded as USD.", "coffee"], ["Monthly support", "Track recurring contributions and their status.", "clock"]], "PAYMENTS"),
  slide("02 · Submit", "Manual proof, review and corrections", "Record an outside contribution, attach proof and retain control while the submission is awaiting review.", "#F472B6", [["Record manual", "/donor#manual"], ["Pending review", "/donor#history"]], [["Attach proof", "Add a receipt now or provide missing proof later.", "receipt"], ["Edit or cancel", "Correct a pending submission before approval.", "action"], ["Appeal a rejection", "Send context instead of starting from zero.", "message"]]),
  slide("03 · Understand", "History, status and contribution totals", "Review every contribution with provider, status and receipt, then compare support fairly without rewriting original amounts.", "#FBBF24", [["Contribution history", "/donor#history"], ["Leaderboard", "/donor#leaderboard"]], [["Complete history", "Paginated records instead of an arbitrary fifty-item limit.", "ledger"], ["Clear status", "Payment lifecycle and admin review are separate.", "approval"], ["Currency clarity", "Original amounts plus a comparable INR total.", "chart"]], "PAYMENTS"),
  slide("04 · Control", "Notifications, reminders and private proof", "Choose which contribution updates reach you while financial documents remain accessible only to you and authorized admins.", "#A78BFA", [["General settings", "/profile"]], [["Event preferences", "Choose payment, review and reminder notifications.", "bell"], ["Private documents", "Financial proof is never treated like a public avatar.", "secure"], ["Persistent choices", "Currency and preferences follow you across devices.", "settings"]]),
];

const SLIDES: Record<Role, Slide[]> = { ADMIN, DEV, DONOR };

function slide(section: string, title: string, summary: string, accent: string, destinations: [string, string][], items: [string, string, string][], asset?: Slide["asset"]): Slide {
  return { section, title, summary, accent, destinations: destinations.map(([label, route]) => ({ label, route })), items: items.map(([itemTitle, detail, icon]) => ({ title: itemTitle, detail, icon })), asset };
}

type Props = { role: Role; name: string; photoUrl: string | null; githubUsername?: string | null; requireGithub?: boolean; onComplete: (startTours: boolean, githubUsername?: string) => Promise<boolean> };

export default function RoleOnboarding({ role, name, photoUrl, githubUsername, requireGithub = role === "DEV", onComplete }: Props) {
  const slides = useMemo(() => SLIDES[role], [role]);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "back">("next");
  const [githubStage, setGithubStage] = useState(false);
  const [startToursAfterGithub, setStartToursAfterGithub] = useState(true);
  const [github, setGithub] = useState(githubUsername || "");
  const [githubError, setGithubError] = useState("");
  const [saving, setSaving] = useState(false);
  const current = slides[index];
  const needsGithub = role === "DEV" && requireGithub;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (githubStage) return;
      if (event.key === "ArrowRight" && index < slides.length - 1) { setDirection("next"); setIndex(index + 1); }
      if (event.key === "ArrowLeft" && index > 0) { setDirection("back"); setIndex(index - 1); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [githubStage, index, slides.length]);

  function move(nextIndex: number) { setDirection(nextIndex > index ? "next" : "back"); setIndex(nextIndex); }

  async function persist(startTours: boolean) {
    const username = github.trim().replace(/^@/, "");
    if (needsGithub && (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username) || username.includes("--"))) {
      setGithubError("Enter a valid GitHub username to connect tasks and contribution activity.");
      return;
    }
    setSaving(true);
    const completed = await onComplete(startTours, needsGithub ? username : undefined);
    if (!completed) setGithubError("Sentinel could not save this yet. Please try again.");
    setSaving(false);
  }

  function requestFinish(startTours: boolean) {
    if (needsGithub) { setStartToursAfterGithub(startTours); setGithubStage(true); return; }
    void persist(startTours);
  }

  function next() { if (index < slides.length - 1) move(index + 1); else requestFinish(true); }
  const variant = index % 3;

  return (
    <div className="onboarding-shell fixed inset-0 z-[10000] overflow-hidden bg-[#090a0f]" role="dialog" aria-modal="true" aria-label={`Welcome to Sentinel for ${role.toLowerCase()}s`}>
      <div className="pointer-events-none fixed inset-0" style={{ background: `radial-gradient(circle at 12% 4%, ${current.accent}1c, transparent 34%),radial-gradient(circle at 92% 92%, ${current.accent}12, transparent 30%),linear-gradient(135deg,#090a0f,#11111a)` }} />
      <div className="pointer-events-none fixed inset-0 opacity-[.1] [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="relative mx-auto flex h-dvh max-w-[1240px] flex-col overflow-hidden px-3 py-2.5 sm:px-6 sm:py-4 lg:px-8">
        <header className="flex h-10 shrink-0 items-center justify-between gap-3 sm:h-12">
          <div className="flex items-center gap-2.5"><Image src="/logo-icon.webp" alt="" width={40} height={40} priority className="h-8 w-8 rounded-full object-cover sm:h-10 sm:w-10" /><div><p className="font-mono text-[7px] uppercase tracking-[.28em] text-white/38 sm:text-[9px]">S E N T I N E L</p><p className="text-[10px] text-white/60 sm:text-xs">Welcome, {name.trim().split(/\s+/)[0] || "there"}</p></div></div>
          <div className="flex items-center gap-2">{photoUrl && <Image src={photoUrl} alt="" width={30} height={30} unoptimized className="h-7 w-7 rounded-full object-cover ring-2 ring-white/10" />}<span className="rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1.5 font-mono text-[8px] uppercase tracking-[.12em] sm:px-3 sm:text-[9px]" style={{ color: current.accent }}>{role} workspace</span></div>
        </header>

        <main className="min-h-0 flex-1 py-2.5 sm:py-4">
          {githubStage ? <GitHubStage accent={current.accent} value={github} error={githubError} onChange={(value) => { setGithub(value); setGithubError(""); }} /> :
            <section key={`${role}-${index}`} className={`workspace-card onboarding-${direction} relative grid h-full min-h-0 overflow-hidden rounded-[24px] border border-white/10 bg-[#14151d]/90 p-3 shadow-[0_30px_90px_rgba(0,0,0,.38)] backdrop-blur-xl sm:p-5 lg:p-7 ${variant === 2 ? "layout-wide lg:grid-cols-1" : "lg:grid-cols-[minmax(0,.78fr)_minmax(420px,1.22fr)]"}`}>
              <div className={`workspace-intro flex min-h-0 flex-col ${variant === 1 ? "lg:order-2 lg:pl-8" : "lg:pr-8"}`}>
                <div className="flex items-center justify-between gap-3"><p className="font-mono text-[8px] font-bold uppercase tracking-[.18em] sm:text-[10px]" style={{ color: current.accent }}>{current.section}</p><AssetMark asset={current.asset} /></div>
                <h1 className="workspace-title mt-2 max-w-2xl text-[clamp(1.5rem,3.8vw,3.35rem)] font-black leading-[.98] tracking-[-.04em] text-white">{current.title}</h1>
                <p className="workspace-summary mt-2 max-w-xl text-[11px] leading-[1.5] text-white/58 sm:mt-3 sm:text-sm sm:leading-6">{current.summary}</p>
                <div className="workspace-destinations mt-auto pt-3 sm:pt-5"><p className="mb-1.5 font-mono text-[7px] uppercase tracking-[.18em] text-white/30 sm:text-[8px]">Pages covered</p><div className="flex flex-wrap gap-1.5">{current.destinations.map((destination) => <span key={`${destination.label}-${destination.route}`} className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-white/9 bg-black/20 px-2 py-1 text-[8px] font-semibold text-white/72 sm:px-2.5 sm:py-1.5 sm:text-[10px]"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: current.accent }} />{destination.label}<span className="route-label font-mono text-[7px] font-normal text-white/26 sm:text-[8px]">{destination.route}</span></span>)}</div></div>
              </div>
              <div className={`workspace-preview relative min-h-0 ${variant === 1 ? "lg:order-1" : ""} ${variant === 2 ? "mt-3" : "mt-3 lg:mt-0"}`}>
                <div className="absolute inset-0 rounded-[20px] opacity-50" style={{ background: `linear-gradient(135deg,${current.accent}12,transparent 55%)` }} />
                <div className={`relative grid h-full min-h-0 gap-2 rounded-[20px] border border-white/8 bg-black/20 p-2 sm:gap-3 sm:p-3 ${current.items.length === 4 ? "grid-cols-2" : variant === 2 ? "grid-cols-3" : "grid-cols-1"}`}>
                  {current.items.map((item, itemIndex) => <article key={item.title} className="workspace-item relative min-h-0 overflow-hidden rounded-2xl border border-white/8 bg-white/[.035] p-2.5 sm:p-4"><div className="flex items-start justify-between gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg sm:h-9 sm:w-9 sm:rounded-xl" style={{ color: current.accent, background: `${current.accent}16` }}><FeatureIcon label={item.icon} /></span><span className="font-mono text-[7px] text-white/20 sm:text-[8px]">{String(itemIndex + 1).padStart(2, "0")}</span></div><h2 className="mt-2 text-[10px] font-bold leading-[1.25] text-white/86 sm:mt-3 sm:text-sm">{item.title}</h2><p className="workspace-item-detail mt-1 text-[8px] leading-[1.35] text-white/43 sm:text-[11px] sm:leading-[1.45]">{item.detail}</p></article>)}
                </div>
              </div>
            </section>}
        </main>

        <footer className="shrink-0 border-t border-white/8 pt-2.5 sm:pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3"><span className="shrink-0 font-mono text-[8px] text-white/38 sm:text-[9px]">{githubStage ? "IDENTITY" : `${index + 1} / ${slides.length}`}</span>{!githubStage && <div className="progress-dots flex min-w-0 gap-1">{slides.map((_, itemIndex) => <button key={itemIndex} type="button" onClick={() => move(itemIndex)} aria-label={`Go to slide ${itemIndex + 1}`} className="h-1.5 rounded-full transition-all" style={{ width: itemIndex === index ? 22 : 5, background: itemIndex === index ? current.accent : "rgba(255,255,255,.15)" }} />)}</div>}</div>
            <div className="footer-actions flex items-center gap-1.5 sm:gap-2">{githubStage ? <><button type="button" onClick={() => setGithubStage(false)} className="rounded-full border border-white/10 px-2.5 py-2 text-[9px] font-semibold text-white/65 sm:px-4 sm:text-[11px]">Back</button><button type="button" disabled={saving} onClick={() => void persist(startToursAfterGithub)} className="rounded-full px-3 py-2.5 text-[9px] font-black text-[#0b0b11] disabled:opacity-50 sm:px-5 sm:text-[11px]" style={{ background: current.accent }}>{saving ? "Saving…" : startToursAfterGithub ? "Save & start tour" : "Save & enter"}</button></> : <><button type="button" disabled={saving} onClick={() => requestFinish(false)} className="explore-button rounded-full border border-white/10 px-2.5 py-2 text-[9px] font-semibold text-white/55 transition hover:text-white/80 disabled:opacity-40 sm:px-4 sm:text-[11px]">Skip page tours</button>{index > 0 && <button type="button" onClick={() => move(index - 1)} className="rounded-full border border-white/10 px-2.5 py-2 text-[9px] font-semibold text-white/70 sm:px-4 sm:text-[11px]">Back</button>}<button type="button" disabled={saving} onClick={next} className="rounded-full px-3 py-2.5 text-[9px] font-black text-[#0b0b11] shadow-[0_12px_36px_rgba(0,0,0,.35)] disabled:opacity-50 sm:px-5 sm:text-[11px]" style={{ background: current.accent }}>{saving ? "Saving…" : index === slides.length - 1 ? "Start page tours" : "Next →"}</button></>}</div>
          </div>
          {githubError && githubStage && <p className="mt-1 text-right text-[9px] text-red-300 sm:hidden">{githubError}</p>}
        </footer>
      </div>

      <style>{`
        @keyframes onboardingNext{from{opacity:0;transform:translateX(18px) scale(.995)}to{opacity:1;transform:none}}@keyframes onboardingBack{from{opacity:0;transform:translateX(-18px) scale(.995)}to{opacity:1;transform:none}}
        .onboarding-next{animation:onboardingNext .35s cubic-bezier(.2,.8,.2,1)}.onboarding-back{animation:onboardingBack .32s cubic-bezier(.2,.8,.2,1)}
        @media(min-width:1024px){.layout-wide{grid-template-rows:auto minmax(0,1fr)}.layout-wide .workspace-intro{display:grid;grid-template-columns:minmax(0,.55fr) minmax(320px,.45fr);column-gap:2rem}.layout-wide .workspace-intro>div:first-child,.layout-wide .workspace-intro>h1,.layout-wide .workspace-intro>p{grid-column:1}.layout-wide .workspace-destinations{grid-column:2;grid-row:1/5;align-self:center;margin:0;padding:0}}
        @media(max-width:1023px){.workspace-card{grid-template-rows:auto minmax(0,1fr)}.workspace-preview{overflow:hidden}}
        @media(max-width:640px){.workspace-card{border-radius:19px}.workspace-title{font-size:clamp(1.35rem,7.3vw,2rem)}.workspace-preview{margin-top:.55rem}.workspace-preview>div{border-radius:15px}.workspace-item{border-radius:13px}.route-label{display:none}.footer-actions{display:grid;grid-template-columns:auto auto}.explore-button{grid-column:1/-1;grid-row:2}.progress-dots button{max-width:16px}}
        @media(max-height:680px){.workspace-summary{display:none}.workspace-title{margin-top:.35rem}.workspace-destinations{padding-top:.45rem}.workspace-preview{margin-top:.45rem}.workspace-item{padding:.48rem}.workspace-item h2{margin-top:.35rem}.workspace-item-detail{display:none}.workspace-item span:first-child{height:24px;width:24px}.workspace-preview>div{gap:.4rem;padding:.4rem}.workspace-card{padding:.65rem}.onboarding-shell main{padding-block:.4rem}.onboarding-shell footer{padding-top:.4rem}}
        @media(max-height:540px){.workspace-destinations p{display:none}.workspace-destinations{padding-top:.25rem}.workspace-preview{margin-top:.3rem}.workspace-title{font-size:1.25rem}.workspace-item h2{font-size:8px}.workspace-item span:first-child{height:21px;width:21px}.workspace-item svg{height:12px;width:12px}}
        @media(prefers-reduced-motion:reduce){.onboarding-next,.onboarding-back{animation:none}}
      `}</style>
    </div>
  );
}

function GitHubStage({ accent, value, error, onChange }: { accent: string; value: string; error: string; onChange: (value: string) => void }) {
  return <div className="grid h-full place-items-center"><section className="w-full max-w-2xl rounded-[24px] border border-white/10 bg-white/[.04] p-5 text-center shadow-2xl sm:p-8"><Image src="/github-mark.svg" alt="GitHub" width={72} height={72} className="mx-auto h-12 w-12 sm:h-16 sm:w-16" /><p className="mt-3 font-mono text-[8px] uppercase tracking-[.2em] sm:text-[9px]" style={{ color: accent }}>One-time developer setup</p><h1 className="mt-2 text-2xl font-black tracking-[-.03em] text-white sm:text-4xl">Connect your GitHub identity</h1><p className="mx-auto mt-2 max-w-lg text-[10px] leading-4 text-white/52 sm:text-sm sm:leading-5">Required for developer work. Sentinel uses it to match issue assignments, pull requests and contribution activity—not to sign in.</p><label className="mx-auto mt-4 block max-w-md text-left"><span className="sr-only">GitHub username</span><div className="flex items-center rounded-2xl border border-white/14 bg-black/30 px-4 focus-within:border-white/40"><span className="text-xs text-white/35 sm:text-sm">github.com/</span><input autoFocus value={value} onChange={(event) => onChange(event.target.value.replace(/^@/, ""))} maxLength={39} autoComplete="username" placeholder="your-username" className="min-w-0 flex-1 bg-transparent px-1 py-3 text-xs font-bold text-white outline-none placeholder:text-white/20 sm:text-sm" /></div>{error && <span className="mt-1.5 hidden text-[10px] leading-4 text-red-300 sm:block">{error}</span>}</label></section></div>;
}

function AssetMark({ asset }: { asset?: Slide["asset"] }) {
  if (!asset) return <span className="h-8 w-8" />;
  if (asset === "GITHUB") return <Image src="/github-mark.svg" alt="GitHub" width={36} height={36} className="h-8 w-8 sm:h-9 sm:w-9" />;
  if (asset === "PAYMENTS") return <span className="flex items-center gap-1.5"><span className="grid h-8 w-8 place-items-center rounded-full bg-white"><Image src="/Payment Apps Icons/razorpay-logo-notext.png" alt="Razorpay" width={21} height={21} className="h-5 w-5 object-contain" /></span><span className="grid h-8 w-8 place-items-center rounded-full bg-white"><Image src="/Payment Apps Icons/bmc-logo-yellow.png" alt="Buy Me a Coffee" width={22} height={22} className="h-5 w-5 object-contain" /></span></span>;
  return <Image src="/logo-icon.webp" alt="Sentinel" width={36} height={36} className="h-8 w-8 rounded-full sm:h-9 sm:w-9" />;
}

function FeatureIcon({ label }: { label: string }) {
  const value = label.toLowerCase(); const cn = "h-4 w-4 sm:h-[18px] sm:w-[18px]";
  if (/clock|reminder|monthly/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>;
  if (/server/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01"/></svg>;
  if (/receipt|ledger/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></svg>;
  if (/github|issue/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg>;
  if (/key/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><circle cx="8" cy="12" r="4"/><path d="M12 12h8M17 12v3M20 12v2"/></svg>;
  if (/secure|approval|audit/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><path d="M12 3 5 6v5c0 4.5 2.7 8.1 7 10 4.3-1.9 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></svg>;
  if (/payment|chart/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><path d="M7 7h10M7 11h7M10 7c3 0 4 1 4 3s-1 3-4 3H7l7 6"/></svg>;
  if (/alert|bell|broadcast/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>;
  if (/people|profile/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2.7-7 6-7s6 3 6 7M16 5c2.3.2 4 2.1 4 4.4M17 13c2.4.6 4 2.7 4 5.5"/></svg>;
  if (/search/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>;
  if (/message/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/></svg>;
  if (/coffee/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><path d="M5 7h12l-1 13H6L5 7ZM7 4h8M18 9h2v5h-3"/></svg>;
  if (/link/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><path d="M10 14 8 16a4 4 0 1 1-6-6l3-3a4 4 0 0 1 6 0M14 10l2-2a4 4 0 1 1 6 6l-3 3a4 4 0 0 1-6 0"/></svg>;
  if (/settings/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 2.5 2.5L16 9"/></svg>;
}
