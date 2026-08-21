"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { Role } from "@/generated/prisma/enums";

type Item = { title: string; detail: string; icon: string };
type Destination = { label: string; route: string };
type Slide = { section: string; title: string; summary: string; accent: string; items: Item[]; destinations: Destination[]; asset?: "SENTINEL" | "GITHUB" | "PAYMENTS" };

const ADMIN: Slide[] = [
  slide("01 · Finance", "Money and decisions in one place", "See the treasury, handle pending decisions and keep every financial record connected.", "#6FD1D7", [["Dashboard", "/admin"], ["Needs Attention", "/admin/attention"], ["Ledger", "/admin/transactions"], ["Reconciliation", "/admin/reconciliation"], ["Record transaction", "/admin/transactions/new"]], [["Treasury view", "Balances, income, spending and recent activity.", "chart"], ["Review and approve", "Contributions and renewals wait for an admin decision.", "approval"], ["Reconcile providers", "Match Razorpay, BMC, proof and missing receipts.", "payment"], ["Record once", "Link a purchase, service, receipt and audit trail.", "receipt"]], "PAYMENTS"),
  slide("02 · Operations", "Services, VPS and secure access", "Manage community tools and infrastructure without separating billing, ownership, health and access.", "#FBBF24", [["Catalogue", "/admin/services"], ["VPS", "/admin/vps"], ["Credentials", "/admin/credentials"], ["Operational alerts", "/admin/alerts"]], [["Service catalogue", "Templates, billing history, receipts and renewals.", "ledger"], ["VPS health", "Machine, process and responsible-maintainer status.", "server"], ["Credential grants", "Scoped access without bulk secret exposure.", "key"], ["Operational alerts", "Granular incidents and approval-based costs.", "bell"]]),
  slide("03 · Community", "People, donors and communication", "Manage participation and send the right update without spreading related work across separate explanations.", "#F472B6", [["Donors", "/admin/donors"], ["Users", "/admin/users"], ["Broadcasts", "/admin/broadcasts"], ["Reminders", "/admin/reminders"]], [["Donor access", "Provider history, guest links and combined totals.", "payment"], ["Users and roles", "Approve people, assign roles and deactivate safely.", "people"], ["Broadcasts", "Send targeted messages to roles or selected users.", "broadcast"], ["Reminders", "Track ownership, acknowledgement, snooze and escalation.", "clock"]]),
  slide("04 · Delivery", "Repositories, audit and settings", "Keep delivery visible, understand who changed what and tailor Sentinel to your workflow.", "#A78BFA", [["Repos", "/admin/repos"], ["Audit Log", "/admin/audit"], ["Settings", "/profile"]], [["Repository activity", "Tracked organization commits keep progress visible.", "github"], ["Correlated audit", "Related changes appear as one expandable workflow.", "audit"], ["Your settings", "Form layout, currency and notifications persist.", "settings"]], "GITHUB"),
];

const DEV: Slide[] = [
  slide("01 · Build", "Boards, tasks and GitHub activity", "Find assigned work, understand its project and follow what the community is shipping.", "#6FD1D7", [["Board", "/dev"], ["My Tasks", "/dev/tasks"], ["GitHub activity", "/dev#github"]], [["Project board", "Priorities, tags, ownership and status in context.", "board"], ["My Tasks", "Direct tasks and assigned subtasks in one queue.", "task"], ["Community activity", "Organization commits show shared progress.", "github"], ["Issue delivery", "Keep task, issue and pull request connected.", "link"]], "GITHUB"),
  slide("02 · Operate", "VPS, access and credentials", "See the systems behind your projects and request only the access you need.", "#FBBF24", [["VPS Stats", "/dev/vps"], ["Credentials", "/dev/credentials"]], [["Live VPS health", "CPU, memory, disk, load and processes.", "server"], ["SSH access", "Submit a public key and follow approval.", "key"], ["Alert choices", "Opt into specific infrastructure incidents.", "bell"], ["Shared credentials", "Reveal or submit only authorized project secrets.", "secure"]]),
  slide("03 · You", "GitHub identity and preferences", "Connect your developer identity once, then choose the updates and profile information Sentinel uses.", "#34D399", [["Settings", "/profile"]], [["GitHub username", "Matches issues, pull requests and activity to you.", "github"], ["Notifications", "Choose task, reminder and VPS alert channels.", "bell"], ["Your profile", "Keep your name and photo recognizable.", "profile"]], "GITHUB"),
];

const DONOR: Slide[] = [
  slide("01 · Contribute", "Choose how you want to support", "Give once or monthly through Razorpay or BMC, or submit an outside contribution with proof.", "#6FD1D7", [["My Donations", "/donor"], ["Checkout", "/donor#razorpay"], ["Manual proof", "/donor#manual"]], [["Razorpay", "UPI, cards and supported wallets.", "payment"], ["Buy Me a Coffee", "USD support stays recorded as USD.", "coffee"], ["Monthly support", "Follow recurring contribution status.", "clock"], ["Manual contribution", "Attach proof for admin review.", "receipt"]], "PAYMENTS"),
  slide("02 · Track", "History, corrections and totals", "Understand every contribution and fix a pending or rejected submission without starting again.", "#FBBF24", [["History", "/donor#history"], ["Leaderboard", "/donor#leaderboard"]], [["Clear history", "Provider, status, proof and receipt together.", "ledger"], ["Pending changes", "Edit, cancel or add missing proof before review.", "action"], ["Appeals", "Reply with context when a submission is rejected.", "message"], ["Fair totals", "Original currency plus a comparable INR total.", "chart"]], "PAYMENTS"),
  slide("03 · Control", "Privacy and preferences", "Choose how Sentinel contacts you while financial proof remains private to you and authorized admins.", "#A78BFA", [["Settings", "/profile"]], [["Notifications", "Choose contribution events and delivery channels.", "bell"], ["Reminders", "Control the nudges you want to receive.", "clock"], ["Private proof", "Financial files use owner/admin authorization.", "secure"]]),
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
  const reverse = index % 2 === 1;

  return (
    <div className="onboarding-shell fixed inset-0 z-[10000] overflow-hidden bg-[#090a0f]" role="dialog" aria-modal="true" aria-label={`Welcome to Sentinel for ${role.toLowerCase()}s`}>
      <div className="pointer-events-none fixed inset-0" style={{ background: `radial-gradient(circle at 12% 4%, ${current.accent}1c, transparent 34%),radial-gradient(circle at 92% 92%, ${current.accent}12, transparent 30%),linear-gradient(135deg,#090a0f,#11111a)` }} />
      <div className="pointer-events-none fixed inset-0 opacity-[.1] [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="relative mx-auto flex h-dvh max-w-[1240px] flex-col overflow-hidden px-3 py-2.5 sm:px-6 sm:py-4 lg:px-8">
        <header className="flex h-10 shrink-0 items-center justify-between gap-3 sm:h-12">
          <div className="flex items-center gap-2.5"><Image src="/logo-icon.webp" alt="" width={40} height={40} priority className="h-8 w-8 rounded-full object-cover sm:h-10 sm:w-10" /><div><p className="font-mono text-[7px] uppercase tracking-[.28em] text-white/38 sm:text-[9px]">S E N T I N E L</p><p className="text-[10px] text-white/60 sm:text-xs">Welcome, {name.trim().split(/\s+/)[0] || "there"}</p></div></div>
          <div className="flex items-center gap-2">{photoUrl && <Image src={photoUrl} alt="" width={30} height={30} unoptimized className="h-7 w-7 rounded-full object-cover ring-2 ring-white/10" />}<span className="rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1.5 font-mono text-[8px] uppercase tracking-[.12em] sm:px-3 sm:text-[9px]" style={{ color: current.accent }}>{role} workspace</span></div>
        </header>

        <main className="grid min-h-0 flex-1 place-items-center py-2 sm:py-4">
          {githubStage ? <GitHubStage accent={current.accent} value={github} error={githubError} onChange={(value) => { setGithub(value); setGithubError(""); }} /> :
            <section key={`${role}-${index}`} className={`workspace-card onboarding-${direction} relative grid w-full max-h-full min-h-0 gap-3 rounded-[22px] border border-white/10 bg-[#14151d]/92 p-3 shadow-[0_30px_90px_rgba(0,0,0,.38)] backdrop-blur-xl sm:gap-5 sm:p-5 lg:grid-cols-[minmax(0,.86fr)_minmax(420px,1.14fr)] lg:p-7`}>
              <div className={`workspace-intro min-w-0 ${reverse ? "lg:order-2 lg:pl-4" : "lg:pr-4"}`}>
                <div className="flex items-center justify-between gap-3"><p className="font-mono text-[8px] font-bold uppercase tracking-[.18em] sm:text-[10px]" style={{ color: current.accent }}>{current.section}</p><AssetMark asset={current.asset} /></div>
                <h1 className="workspace-title mt-2 max-w-2xl text-[clamp(1.55rem,3vw,2.8rem)] font-black leading-[1.02] tracking-[-.035em] text-white">{current.title}</h1>
                <p className="workspace-summary mt-2 max-w-xl text-[10px] leading-[1.45] text-white/58 sm:mt-3 sm:text-[13px] sm:leading-5">{current.summary}</p>
                <div className="workspace-destinations mt-3 sm:mt-5"><p className="mb-1.5 font-mono text-[7px] uppercase tracking-[.18em] text-white/30 sm:text-[8px]">Included</p><div className="flex flex-wrap gap-1.5">{current.destinations.map((destination) => <span key={`${destination.label}-${destination.route}`} className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-white/9 bg-black/20 px-2 py-1 text-[8px] font-semibold text-white/72 sm:px-2.5 sm:py-1.5 sm:text-[10px]"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: current.accent }} />{destination.label}</span>)}</div></div>
              </div>
              <div className={`workspace-preview relative min-w-0 ${reverse ? "lg:order-1" : ""}`}>
                <div className="absolute inset-0 rounded-[18px] opacity-50" style={{ background: `linear-gradient(135deg,${current.accent}12,transparent 55%)` }} />
                <div className={`relative grid grid-cols-1 gap-2 rounded-[18px] border border-white/8 bg-black/20 p-2 sm:gap-3 sm:p-3 ${current.items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                  {current.items.map((item, itemIndex) => <article key={item.title} className="workspace-item relative flex min-h-[58px] items-start gap-2.5 rounded-xl border border-white/8 bg-white/[.04] p-2.5 text-left sm:min-h-[98px] sm:gap-3 sm:p-3.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg sm:h-8 sm:w-8" style={{ color: current.accent, background: `${current.accent}16` }}><FeatureIcon label={item.icon} /></span><div className="min-w-0 pr-1"><h2 className="text-[9px] font-bold leading-[1.25] text-white/88 sm:text-[12px]">{item.title}</h2><p className="workspace-item-detail mt-1 line-clamp-2 text-[8px] leading-[1.35] text-white/50 sm:text-[10px] sm:leading-[1.4]">{item.detail}</p></div><span className="absolute right-2 top-2 font-mono text-[7px] text-white/18">{String(itemIndex + 1).padStart(2, "0")}</span></article>)}
                </div>
              </div>
            </section>}
        </main>

        <footer className="shrink-0 border-t border-white/8 pt-2.5 sm:pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3"><span className="shrink-0 font-mono text-[8px] text-white/38 sm:text-[9px]">{githubStage ? "IDENTITY" : `${index + 1} / ${slides.length}`}</span>{!githubStage && <div className="progress-dots flex min-w-0 gap-1">{slides.map((_, itemIndex) => <button key={itemIndex} type="button" onClick={() => move(itemIndex)} aria-label={`Go to slide ${itemIndex + 1}`} className="h-1.5 rounded-full transition-all" style={{ width: itemIndex === index ? 22 : 5, background: itemIndex === index ? current.accent : "rgba(255,255,255,.15)" }} />)}</div>}</div>
            <div className="footer-actions flex shrink-0 items-center gap-1 sm:gap-2">{githubStage ? <><button type="button" onClick={() => setGithubStage(false)} className="rounded-full border border-white/10 px-2.5 py-2 text-[9px] font-semibold text-white/65 sm:px-4 sm:text-[11px]">Back</button><button type="button" disabled={saving} onClick={() => void persist(startToursAfterGithub)} className="rounded-full px-3 py-2.5 text-[9px] font-black text-[#0b0b11] disabled:opacity-50 sm:px-5 sm:text-[11px]" style={{ background: current.accent }}>{saving ? "Saving…" : startToursAfterGithub ? "Save & start tour" : "Save & enter"}</button></> : <>{index > 0 && <button type="button" onClick={() => move(index - 1)} className="rounded-full border border-white/10 px-2 py-2 text-[8px] font-semibold text-white/70 sm:px-4 sm:text-[11px]">Back</button>}<button type="button" disabled={saving} onClick={() => requestFinish(false)} className="rounded-full border border-white/10 px-2 py-2 text-[8px] font-semibold text-white/55 transition hover:text-white/80 disabled:opacity-40 sm:px-4 sm:text-[11px]">Skip page tours</button><button type="button" disabled={saving} onClick={next} className="rounded-full px-2.5 py-2.5 text-[8px] font-black text-[#0b0b11] shadow-[0_12px_36px_rgba(0,0,0,.35)] disabled:opacity-50 sm:px-5 sm:text-[11px]" style={{ background: current.accent }}>{saving ? "Saving…" : index === slides.length - 1 ? "Start tours" : "Next →"}</button></>}</div>
          </div>
          {githubError && githubStage && <p className="mt-1 text-right text-[9px] text-red-300 sm:hidden">{githubError}</p>}
        </footer>
      </div>

      <style>{`
        @keyframes onboardingNext{from{opacity:0;transform:translateX(18px) scale(.995)}to{opacity:1;transform:none}}@keyframes onboardingBack{from{opacity:0;transform:translateX(-18px) scale(.995)}to{opacity:1;transform:none}}
        .onboarding-next{animation:onboardingNext .35s cubic-bezier(.2,.8,.2,1)}.onboarding-back{animation:onboardingBack .32s cubic-bezier(.2,.8,.2,1)}
        @media(max-width:1023px){.workspace-card{grid-template-rows:auto auto}.workspace-preview{min-height:0}}
        @media(max-width:640px){.workspace-card{border-radius:18px}.workspace-title{font-size:clamp(1.4rem,7vw,1.85rem)}.workspace-summary{display:none}.workspace-destinations{margin-top:.55rem}.workspace-preview>div{border-radius:14px}.workspace-item{border-radius:11px}.progress-dots button{max-width:14px}.footer-actions{gap:3px}}
        @media(max-height:600px){.workspace-card{gap:.45rem;padding:.6rem}.workspace-title{margin-top:.3rem;font-size:1.35rem}.workspace-destinations{margin-top:.4rem}.workspace-destinations p{display:none}.workspace-item{min-height:50px;padding:.42rem}.workspace-item-detail{-webkit-line-clamp:1}.workspace-preview>div{gap:.35rem;padding:.35rem}.onboarding-shell main{padding-block:.35rem}.onboarding-shell footer{padding-top:.35rem}}
        @media(max-width:350px){.footer-actions button{padding-inline:.42rem}.footer-actions{gap:2px}.progress-dots{display:none}}
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
