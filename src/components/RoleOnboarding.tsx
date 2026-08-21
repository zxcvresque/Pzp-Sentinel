"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { Role } from "@/generated/prisma/enums";

type Slide = { eyebrow: string; title: string; body: string; points: string[]; accent: string; visual: "FLOW" | "PULSE" | "STACK" | "RINGS" | "TRUST" };

const SLIDES: Record<Role, Slide[]> = {
  ADMIN: [
    { eyebrow: "Your command centre", title: "See the whole community clearly", body: "Sentinel turns donations, spending, people and infrastructure into one calm operating picture.", points: ["Live treasury health", "Pending decisions", "Recent community activity"], accent: "#6FD1D7", visual: "PULSE" },
    { eyebrow: "Record once", title: "One transaction, every linked record", body: "Record a purchase once and Sentinel can connect its service, receipt, renewal, credentials and audit trail.", points: ["No duplicate entry", "Receipts stay attached", "Renewals remain accountable"], accent: "#F472B6", visual: "FLOW" },
    { eyebrow: "An actionable inbox", title: "Know what needs attention now", body: "Approvals, reconciliation, missing receipts and operational incidents arrive in one prioritised view.", points: ["Approve with context", "Match provider payments", "Resolve incidents"], accent: "#FBBF24", visual: "STACK" },
    { eyebrow: "Community operations", title: "Services, access and servers stay connected", body: "Track recurring tools, VPS health, maintainers and secure credential grants without exposing secrets in bulk.", points: ["Granular access", "VPS telemetry", "Expiry and health alerts"], accent: "#A78BFA", visual: "RINGS" },
    { eyebrow: "Accountability built in", title: "Every important action tells a coherent story", body: "Composite audit events group the transaction, service and supporting records created by the same decision.", points: ["Who changed what", "Linked workflow history", "Recoverable destructive actions"], accent: "#34D399", visual: "TRUST" },
  ],
  DEV: [
    { eyebrow: "Your community workspace", title: "Know what to build next", body: "Sentinel brings assigned work, project context and community progress into one focused developer view.", points: ["My tasks", "Project boards", "Deadlines and priorities"], accent: "#6FD1D7", visual: "STACK" },
    { eyebrow: "GitHub-connected work", title: "Turn tasks into visible delivery", body: "Projects connect community work with repositories, issues, pull requests and the momentum of every contributor.", points: ["Repository activity", "Issue-ready tasks", "Contribution visibility"], accent: "#F472B6", visual: "FLOW" },
    { eyebrow: "Live infrastructure", title: "See the systems behind your project", body: "VPS telemetry and process health show what is running, what is struggling and who maintains it.", points: ["CPU, memory and disk", "Process status", "Granular alert preferences"], accent: "#FBBF24", visual: "PULSE" },
    { eyebrow: "Access without guesswork", title: "Request the right credential safely", body: "See only credentials explicitly shared with you, request VPS access and keep every reveal or copy audited.", points: ["Public-key access", "Audited reveal", "Clear approval state"], accent: "#A78BFA", visual: "TRUST" },
    { eyebrow: "Shared momentum", title: "Build with the community, not in isolation", body: "Activity and task views make other contributors visible so progress feels collective and blockers surface earlier.", points: ["Team activity", "Ownership clarity", "Fewer forgotten fixes"], accent: "#34D399", visual: "RINGS" },
  ],
  DONOR: [
    { eyebrow: "Your contribution space", title: "Support the community with confidence", body: "Sentinel gives you a clear, private view of how you contribute and which payment options are available to you.", points: ["One-time giving", "Monthly support", "Manual proof when needed"], accent: "#6FD1D7", visual: "PULSE" },
    { eyebrow: "Flexible payments", title: "Choose the giving method that suits you", body: "Use secure Razorpay checkout, Buy Me a Coffee or a manual submission when an administrator needs to verify proof.", points: ["Provider-confirmed payments", "Recurring options", "Clear pending state"], accent: "#F472B6", visual: "FLOW" },
    { eyebrow: "A complete history", title: "Every contribution remains understandable", body: "See amount, provider, status, receipts and review outcomes without digging through messages.", points: ["Paginated history", "Appeals and proof", "Reporting currency"], accent: "#FBBF24", visual: "STACK" },
    { eyebrow: "Community recognition", title: "Celebrate the people keeping things moving", body: "The contribution leaderboard keeps provider currencies honest and shows combined totals fairly.", points: ["All-time and period views", "Provider identity", "INR comparison totals"], accent: "#A78BFA", visual: "RINGS" },
    { eyebrow: "You stay in control", title: "Privacy and reminders work around you", body: "Choose notification channels and donation reminders while financial proofs stay private to you and authorised admins.", points: ["Granular preferences", "Private proof access", "Reminder controls"], accent: "#34D399", visual: "TRUST" },
  ],
};

export default function RoleOnboarding({ role, name, photoUrl, githubUsername, requireGithub = role === "DEV", onComplete }: { role: Role; name: string; photoUrl: string | null; githubUsername?: string | null; requireGithub?: boolean; onComplete: (startTours: boolean, githubUsername?: string) => Promise<boolean> }) {
  const slides = useMemo(() => SLIDES[role], [role]);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "back">("next");
  const [github, setGithub] = useState(githubUsername || "");
  const [githubError, setGithubError] = useState("");
  const [saving, setSaving] = useState(false);
  const slide = slides[index];
  const firstName = name.trim().split(/\s+/)[0] || "there";

  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === "ArrowRight" && index < slides.length - 1) { setDirection("next"); setIndex((value) => value + 1); }
      if (event.key === "ArrowLeft" && index > 0) { setDirection("back"); setIndex((value) => value - 1); }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, slides.length]);

  function validGithub() {
    const username = github.trim().replace(/^@/, "");
    if (!requireGithub) return undefined;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username) || username.includes("--")) {
      setGithubError("Enter your GitHub username so Sentinel can connect tasks and contributions to you.");
      return null;
    }
    setGithubError("");
    return username;
  }

  async function finish(startTours: boolean) {
    const username = validGithub();
    if (username === null) return;
    setSaving(true);
    const completed = await onComplete(startTours, username);
    if (!completed) setGithubError("Sentinel could not save this yet. Please try again.");
    setSaving(false);
  }

  function next() { if (index < slides.length - 1) { setDirection("next"); setIndex((value) => value + 1); } else void finish(true); }
  function back() { if (index > 0) { setDirection("back"); setIndex((value) => value - 1); } }

  return <div className="fixed inset-0 z-[10000] overflow-y-auto bg-[#0b0b11]" role="dialog" aria-modal="true" aria-label={`Welcome to Sentinel for ${role.toLowerCase()}s`}>
    <div className="pointer-events-none fixed inset-0 opacity-70" style={{ background: `radial-gradient(circle at 18% 12%, ${slide.accent}22, transparent 34%),radial-gradient(circle at 86% 78%, #ff00aa18, transparent 35%),linear-gradient(135deg,#0b0b11,#14131c)` }} />
    <div className="pointer-events-none fixed inset-0 opacity-[.16] [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:44px_44px]" />
    <div className="relative mx-auto flex min-h-full max-w-7xl flex-col px-4 py-4 sm:px-7 sm:py-6 lg:px-10">
      <header className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><Image src="/logo-icon.webp" alt="" width={42} height={42} priority className="h-10 w-10 rounded-full object-cover" /><div><p className="font-mono text-[9px] uppercase tracking-[.28em] text-text-tertiary">S E N T I N E L</p><p className="text-xs text-text-secondary">Welcome, {firstName}</p></div></div><div className="flex items-center gap-2">{photoUrl && <Image src={photoUrl} alt="" width={30} height={30} unoptimized className="h-8 w-8 rounded-full object-cover ring-2 ring-white/10" />}<span className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.12em]" style={{ color: slide.accent }}>{role} view</span></div></header>
      <main className="flex flex-1 items-center py-7 sm:py-10"><div key={`${index}-${direction}`} className={`grid w-full min-w-0 grid-cols-1 items-center gap-7 lg:grid-cols-[minmax(0,.92fr)_minmax(420px,1.08fr)] lg:gap-14 ${direction === "next" ? "onboarding-slide-next" : "onboarding-slide-back"}`}>
        <section className="min-w-0"><p className="font-mono text-[10px] font-bold uppercase tracking-[.2em]" style={{ color: slide.accent }}>{slide.eyebrow}</p><h1 className="mt-4 max-w-3xl text-4xl font-black leading-[1.02] tracking-[-.04em] text-white sm:text-5xl lg:text-6xl">{slide.title}</h1><p className="mt-5 max-w-2xl text-base leading-7 text-white/58 sm:text-lg">{slide.body}</p><div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">{slide.points.map((point, pointIndex) => <div key={point} className="rounded-2xl border border-white/8 bg-white/[.035] p-3.5 backdrop-blur"><span className="mb-2 grid h-6 w-6 place-items-center rounded-full text-[10px] font-black text-[#0b0b11]" style={{ background: slide.accent }}>{pointIndex + 1}</span><p className="text-xs font-semibold leading-5 text-white/78">{point}</p></div>)}</div></section>
        <OnboardingVisual visual={slide.visual} accent={slide.accent} role={role} />
      </div></main>
      {requireGithub && <section className="mb-4 rounded-2xl border border-white/10 bg-white/[.035] p-3.5 sm:flex sm:items-center sm:gap-4"><div className="min-w-0 flex-1"><p className="text-xs font-bold text-white">Connect your GitHub identity</p><p className="mt-1 text-[11px] leading-4 text-white/45">Required once for developers. Used to match issue assignments, pull requests and contribution activity—not to sign in.</p></div><label className="mt-3 block sm:mt-0 sm:w-[300px]"><span className="sr-only">GitHub username</span><div className="flex items-center rounded-xl border border-white/12 bg-black/25 px-3 focus-within:border-white/35"><span className="text-sm text-white/35">github.com/</span><input value={github} onChange={(event) => { setGithub(event.target.value.replace(/^@/, "")); setGithubError(""); }} maxLength={39} autoComplete="username" placeholder="your-username" className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm font-semibold text-white outline-none placeholder:text-white/20" /></div>{githubError && <span className="mt-1.5 block text-[10px] leading-4 text-red-300">{githubError}</span>}</label></section>}
      <footer className="flex flex-col gap-4 border-t border-white/8 pt-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center justify-between gap-4 sm:justify-start"><span className="font-mono text-[10px] text-white/35">{String(index + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}</span><div className="flex gap-1.5">{slides.map((_, itemIndex) => <button key={itemIndex} type="button" onClick={() => { setDirection(itemIndex > index ? "next" : "back"); setIndex(itemIndex); }} aria-label={`Go to slide ${itemIndex + 1}`} className="h-1.5 rounded-full transition-all" style={{ width: itemIndex === index ? 30 : 8, background: itemIndex === index ? slide.accent : "rgba(255,255,255,.16)" }} />)}</div></div><div className="grid grid-cols-2 gap-2 sm:flex"><button type="button" disabled={saving} onClick={() => void finish(false)} className="rounded-full border border-white/10 px-4 py-2.5 text-xs font-semibold text-white/50 transition hover:bg-white/[.04] hover:text-white/75 disabled:opacity-40">Explore without tours</button>{index > 0 && <button type="button" onClick={back} className="rounded-full border border-white/10 px-4 py-2.5 text-xs font-semibold text-white/70">Back</button>}<button type="button" disabled={saving} onClick={next} className="col-span-2 rounded-full px-6 py-3 text-sm font-black text-[#0b0b11] shadow-[0_15px_45px_rgba(0,0,0,.35)] transition hover:scale-[1.015] disabled:opacity-50 sm:col-span-1" style={{ background: slide.accent }}>{saving ? "Saving…" : index === slides.length - 1 ? "Start guided tour · Recommended" : "Continue →"}</button></div></footer>
    </div>
    <style>{`@keyframes onboardingNext{from{opacity:0;transform:translateX(24px) scale(.99)}to{opacity:1;transform:none}}@keyframes onboardingBack{from{opacity:0;transform:translateX(-24px) scale(.99)}to{opacity:1;transform:none}}.onboarding-slide-next{animation:onboardingNext .48s cubic-bezier(.2,.8,.2,1)}.onboarding-slide-back{animation:onboardingBack .4s cubic-bezier(.2,.8,.2,1)}@media(prefers-reduced-motion:reduce){.onboarding-slide-next,.onboarding-slide-back{animation:none}}`}</style>
  </div>;
}

function OnboardingVisual({ visual, accent, role }: { visual: Slide["visual"]; accent: string; role: Role }) {
  const labels = role === "ADMIN" ? ["Transaction", "Service", "Receipt", "Reminder"] : role === "DEV" ? ["Task", "Issue", "Pull request", "Deploy"] : ["Contribution", "Provider", "Approval", "History"];
  return <section aria-hidden="true" className="relative mx-auto min-h-[300px] w-full max-w-xl overflow-hidden rounded-[30px] border border-white/10 bg-white/[.035] p-5 shadow-[0_40px_100px_rgba(0,0,0,.45)] backdrop-blur-xl sm:min-h-[410px] sm:p-8"><div className="absolute -right-12 -top-12 h-52 w-52 rounded-full blur-3xl" style={{ background: `${accent}2a` }} /><div className="absolute -bottom-16 -left-12 h-52 w-52 rounded-full bg-fuchsia-500/10 blur-3xl" />
    {visual === "FLOW" && <div className="relative flex min-h-[260px] flex-col justify-center gap-3 sm:min-h-[340px]">{labels.map((label, index) => <div key={label} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/20 p-3.5" style={{ transform: `translateX(${index * 9}px)` }}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-black text-black" style={{ background: index === 0 ? accent : `${accent}88` }}>{index + 1}</span><div className="h-2 flex-1 rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${88 - index * 12}%`, background: accent }} /></div><span className="text-xs font-semibold text-white/72">{label}</span></div>)}</div>}
    {visual === "PULSE" && <div className="relative grid min-h-[260px] place-items-center sm:min-h-[340px]"><div className="absolute h-60 w-60 rounded-full border border-white/8 sm:h-72 sm:w-72" /><div className="absolute h-44 w-44 rounded-full border border-white/10 sm:h-52 sm:w-52" /><div className="absolute h-28 w-28 animate-pulse rounded-full" style={{ background: `${accent}20`, boxShadow: `0 0 80px ${accent}44` }} /><div className="relative text-center"><p className="text-5xl font-black sm:text-7xl" style={{ color: accent }}>LIVE</p><p className="mt-2 font-mono text-[9px] uppercase tracking-[.25em] text-white/35">Signals into decisions</p></div>{labels.map((label,index)=><span key={label} className="absolute rounded-full border border-white/10 bg-[#111119] px-3 py-1.5 text-[10px] text-white/62" style={{ left: `${12 + (index%2)*61}%`, top: `${18 + index*18}%` }}>{label}</span>)}</div>}
    {visual === "STACK" && <div className="relative flex min-h-[260px] flex-col justify-center sm:min-h-[340px]">{labels.map((label,index)=><div key={label} className="relative -mt-2 rounded-2xl border border-white/10 bg-[#14141d]/95 p-4 shadow-xl" style={{ marginLeft: `${index*16}px`, zIndex: labels.length-index, borderLeftColor: accent }}><div className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-white/78">{label}</span><span className="rounded-full px-2 py-1 font-mono text-[8px]" style={{ color: accent, background: `${accent}14` }}>{index === 0 ? "NOW" : `0${index}`}</span></div><div className="mt-3 h-1.5 rounded-full bg-white/8"><div className="h-full rounded-full" style={{ width:`${90-index*14}%`,background:accent }}/></div></div>)}</div>}
    {visual === "RINGS" && <div className="relative grid min-h-[260px] place-items-center sm:min-h-[340px]"><div className="absolute h-64 w-64 rounded-full border border-dashed border-white/15 animate-[spin_28s_linear_infinite] sm:h-80 sm:w-80" /><div className="absolute h-44 w-44 rounded-full border border-white/10 sm:h-56 sm:w-56" /><Image src="/logo-icon.webp" alt="" width={100} height={100} className="h-20 w-20 rounded-full object-cover shadow-2xl sm:h-24 sm:w-24" />{labels.map((label,index)=><span key={label} className="absolute rounded-xl border border-white/10 bg-[#111119] px-3 py-2 text-[10px] font-semibold text-white/65" style={{ transform:`rotate(${index*90}deg) translateY(-128px) rotate(${-index*90}deg)` }}>{label}</span>)}</div>}
    {visual === "TRUST" && <div className="relative flex min-h-[260px] flex-col justify-center sm:min-h-[340px]"><div className="mx-auto grid h-24 w-24 place-items-center rounded-[28px] border border-white/10" style={{ background:`${accent}14`,boxShadow:`0 0 70px ${accent}26` }}><svg viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.5" className="h-12 w-12"><path d="M12 3 5 6v5c0 4.5 2.7 8.1 7 10 4.3-1.9 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></svg></div><div className="mt-8 grid grid-cols-2 gap-2">{labels.map((label,index)=><div key={label} className="rounded-xl border border-white/8 bg-black/20 p-3"><span className="font-mono text-[8px]" style={{color:accent}}>0{index+1}</span><p className="mt-1 text-xs font-semibold text-white/68">{label}</p></div>)}</div></div>}
  </section>;
}
