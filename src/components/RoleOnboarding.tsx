"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { Role } from "@/generated/prisma/enums";

type Visual = "FLOW" | "PULSE" | "STACK" | "RINGS" | "TRUST";
type Slide = { eyebrow: string; title: string; body: string; points: string[]; accent: string; visual: Visual };

const SLIDES: Record<Role, Slide[]> = {
  ADMIN: [
    { eyebrow: "Your command centre", title: "See the whole community clearly", body: "Live treasury health, people and infrastructure become one calm operating picture.", points: ["Live treasury health", "Pending decisions", "Community activity"], accent: "#6FD1D7", visual: "PULSE" },
    { eyebrow: "Record once", title: "One transaction, every record linked", body: "Connect a purchase to its service, receipt, renewal, credentials and audit story in one flow.", points: ["No duplicate entry", "Receipts stay attached", "Renewal reminders"], accent: "#F472B6", visual: "FLOW" },
    { eyebrow: "An actionable inbox", title: "Know what needs attention now", body: "Approvals, reconciliation, missing proof and operational incidents arrive in priority order.", points: ["Approve with context", "Match provider payments", "Resolve alerts"], accent: "#FBBF24", visual: "STACK" },
    { eyebrow: "Community operations", title: "Services, access and servers stay connected", body: "Track recurring tools, VPS health and maintainers without exposing secrets in bulk.", points: ["Granular access", "VPS telemetry", "Expiry and health alerts"], accent: "#A78BFA", visual: "RINGS" },
    { eyebrow: "Accountability built in", title: "Every decision tells one coherent story", body: "Correlated audit events group the transaction, service and supporting records created together.", points: ["Who changed what", "Linked workflow history", "Recoverable actions"], accent: "#34D399", visual: "TRUST" },
  ],
  DEV: [
    { eyebrow: "Your community workspace", title: "Know what to build next", body: "Assigned work, project context and community progress live in one focused developer view.", points: ["My tasks", "Project boards", "Deadlines and priorities"], accent: "#6FD1D7", visual: "STACK" },
    { eyebrow: "GitHub-connected work", title: "Turn tasks into visible delivery", body: "Repository activity keeps issues, pull requests and every contributor's momentum visible.", points: ["Repository activity", "Issue-ready tasks", "Contribution visibility"], accent: "#F472B6", visual: "FLOW" },
    { eyebrow: "Live infrastructure", title: "See the systems behind your project", body: "VPS and process health show what is running, what is struggling and who maintains it.", points: ["CPU, memory and disk", "Process health", "Alert preferences"], accent: "#FBBF24", visual: "PULSE" },
    { eyebrow: "Access without guesswork", title: "Request the right credential safely", body: "See only what is shared with you; every access request, reveal and copy remains accountable.", points: ["Public-key access", "Audited reveal", "Clear approval state"], accent: "#A78BFA", visual: "TRUST" },
    { eyebrow: "Shared momentum", title: "Build with the community, not in isolation", body: "Ownership is visible, blockers surface sooner and completed work becomes shared progress.", points: ["Team activity", "Ownership clarity", "Fewer forgotten fixes"], accent: "#34D399", visual: "RINGS" },
  ],
  DONOR: [
    { eyebrow: "Your contribution space", title: "Support the community with confidence", body: "A clear, private view of your contributions and the payment choices available to you.", points: ["One-time giving", "Monthly support", "Manual proof"], accent: "#6FD1D7", visual: "PULSE" },
    { eyebrow: "Flexible payments", title: "Choose the method that suits you", body: "Use secure Razorpay checkout, Buy Me a Coffee or a manually verified contribution.", points: ["Verified providers", "Recurring options", "Clear pending state"], accent: "#F472B6", visual: "FLOW" },
    { eyebrow: "A complete history", title: "Every contribution stays understandable", body: "See amount, provider, status, receipt and review outcome without searching old messages.", points: ["Paginated history", "Appeals and proof", "Reporting currency"], accent: "#FBBF24", visual: "STACK" },
    { eyebrow: "Community recognition", title: "Celebrate the people keeping things moving", body: "The leaderboard preserves original currencies and compares combined support fairly in INR.", points: ["Period views", "Provider identity", "INR comparison total"], accent: "#A78BFA", visual: "RINGS" },
    { eyebrow: "You stay in control", title: "Privacy and reminders work around you", body: "Choose when Sentinel nudges you while financial proof stays private to authorised people.", points: ["Notification choices", "Private proof access", "Reminder controls"], accent: "#34D399", visual: "TRUST" },
  ],
};

type Props = {
  role: Role;
  name: string;
  photoUrl: string | null;
  githubUsername?: string | null;
  requireGithub?: boolean;
  onComplete: (startTours: boolean, githubUsername?: string) => Promise<boolean>;
};

export default function RoleOnboarding({ role, name, photoUrl, githubUsername, requireGithub = role === "DEV", onComplete }: Props) {
  const slides = useMemo(() => SLIDES[role], [role]);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "back">("next");
  const [githubStage, setGithubStage] = useState(false);
  const [startToursAfterGithub, setStartToursAfterGithub] = useState(true);
  const [github, setGithub] = useState(githubUsername || "");
  const [githubError, setGithubError] = useState("");
  const [saving, setSaving] = useState(false);
  const slide = slides[index];
  const firstName = name.trim().split(/\s+/)[0] || "there";
  const needsGithub = role === "DEV" && requireGithub;

  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (githubStage) return;
      if (event.key === "ArrowRight" && index < slides.length - 1) { setDirection("next"); setIndex((value) => value + 1); }
      if (event.key === "ArrowLeft" && index > 0) { setDirection("back"); setIndex((value) => value - 1); }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [githubStage, index, slides.length]);

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
    if (needsGithub) {
      setStartToursAfterGithub(startTours);
      setGithubStage(true);
      return;
    }
    void persist(startTours);
  }

  function next() {
    if (index < slides.length - 1) {
      setDirection("next");
      setIndex((value) => value + 1);
    } else {
      requestFinish(true);
    }
  }

  const reverse = index % 3 === 1;
  const compactPoints = index % 3 === 2;

  return (
    <div className="onboarding-shell fixed inset-0 z-[10000] overflow-hidden bg-[#0b0b11]" role="dialog" aria-modal="true" aria-label={`Welcome to Sentinel for ${role.toLowerCase()}s`}>
      <div className="pointer-events-none fixed inset-0 opacity-70" style={{ background: `radial-gradient(circle at 18% 12%, ${slide.accent}22, transparent 34%),radial-gradient(circle at 86% 78%, #ff00aa18, transparent 35%),linear-gradient(135deg,#0b0b11,#14131c)` }} />
      <div className="pointer-events-none fixed inset-0 opacity-[.14] [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:44px_44px]" />

      <div className="relative mx-auto flex h-dvh max-w-7xl flex-col overflow-hidden px-4 py-3 sm:px-7 sm:py-4 lg:px-10">
        <header className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Image src="/logo-icon.webp" alt="" width={40} height={40} priority className="h-9 w-9 rounded-full object-cover" />
            <div><p className="font-mono text-[8px] uppercase tracking-[.28em] text-white/35">S E N T I N E L</p><p className="text-[11px] text-white/58">Welcome, {firstName}</p></div>
          </div>
          <div className="flex items-center gap-2">
            {photoUrl && <Image src={photoUrl} alt="" width={30} height={30} unoptimized className="h-7 w-7 rounded-full object-cover ring-2 ring-white/10" />}
            <span className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 font-mono text-[8px] uppercase tracking-[.12em]" style={{ color: slide.accent }}>{role} view</span>
          </div>
        </header>

        <main className="onboarding-main min-h-0 flex-1 overflow-hidden py-3 sm:py-4">
          {githubStage ? (
            <GitHubStage accent={slide.accent} value={github} error={githubError} onChange={(value) => { setGithub(value); setGithubError(""); }} />
          ) : (
            <div key={`${index}-${direction}`} className={`onboarding-grid grid h-full min-h-0 w-full grid-cols-1 items-center gap-3 lg:grid-cols-[minmax(0,.92fr)_minmax(380px,1.08fr)] lg:gap-10 ${direction === "next" ? "onboarding-slide-next" : "onboarding-slide-back"}`}>
              <section className={`onboarding-copy min-w-0 ${reverse ? "lg:order-2" : ""}`}>
                <p className="font-mono text-[9px] font-bold uppercase tracking-[.2em]" style={{ color: slide.accent }}>{slide.eyebrow}</p>
                <h1 className="onboarding-title mt-2 max-w-3xl text-[clamp(2rem,5.3vw,4rem)] font-black leading-[.98] tracking-[-.045em] text-white">{slide.title}</h1>
                <p className="onboarding-body mt-3 max-w-2xl text-sm leading-5 text-white/58 sm:text-base sm:leading-6">{slide.body}</p>
                <div className={`onboarding-points mt-3 grid gap-2 ${compactPoints ? "grid-cols-1 sm:grid-cols-3 lg:grid-cols-1" : "grid-cols-3"}`}>
                  {slide.points.map((point) => (
                    <div key={point} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/8 bg-white/[.035] p-2.5 backdrop-blur">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ color: slide.accent, background: `${slide.accent}16` }}><FeatureIcon label={point} /></span>
                      <p className="text-[10px] font-semibold leading-4 text-white/76 sm:text-xs">{point}</p>
                    </div>
                  ))}
                </div>
              </section>
              <div className={reverse ? "lg:order-1" : ""}><OnboardingVisual visual={slide.visual} accent={slide.accent} role={role} /></div>
            </div>
          )}
        </main>

        <footer className="onboarding-footer shrink-0 border-t border-white/8 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[9px] text-white/35">{githubStage ? "IDENTITY" : `${String(index + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`}</span>
              {!githubStage && <div className="flex gap-1.5">{slides.map((_, itemIndex) => <button key={itemIndex} type="button" onClick={() => { setDirection(itemIndex > index ? "next" : "back"); setIndex(itemIndex); }} aria-label={`Go to slide ${itemIndex + 1}`} className="h-1.5 rounded-full transition-all" style={{ width: itemIndex === index ? 28 : 7, background: itemIndex === index ? slide.accent : "rgba(255,255,255,.16)" }} />)}</div>}
            </div>
            <div className="flex items-center gap-2">
              {githubStage ? (
                <>
                  <button type="button" onClick={() => setGithubStage(false)} className="rounded-full border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/65">Back</button>
                  <button type="button" disabled={saving} onClick={() => void persist(startToursAfterGithub)} className="rounded-full px-4 py-2.5 text-[11px] font-black text-[#0b0b11] disabled:opacity-50" style={{ background: slide.accent }}>{saving ? "Saving…" : startToursAfterGithub ? "Save & start tour" : "Save & enter Sentinel"}</button>
                </>
              ) : (
                <>
                  <button type="button" disabled={saving} onClick={() => requestFinish(false)} className="onboarding-explore rounded-full border border-white/10 px-3 py-2 text-[10px] font-semibold text-white/52 transition hover:text-white/80 disabled:opacity-40">Explore without tours</button>
                  {index > 0 && <button type="button" onClick={() => { setDirection("back"); setIndex((value) => value - 1); }} className="rounded-full border border-white/10 px-3 py-2 text-[10px] font-semibold text-white/70">Back</button>}
                  <button type="button" disabled={saving} onClick={next} className="rounded-full px-4 py-2.5 text-[11px] font-black text-[#0b0b11] shadow-[0_12px_36px_rgba(0,0,0,.35)] disabled:opacity-50" style={{ background: slide.accent }}>{saving ? "Saving…" : index === slides.length - 1 ? "Start guided tour" : "Continue →"}</button>
                </>
              )}
            </div>
          </div>
          {githubError && githubStage && <p className="mt-1 text-right text-[10px] text-red-300 sm:hidden">{githubError}</p>}
        </footer>
      </div>

      <style>{`
        @keyframes onboardingNext{from{opacity:0;transform:translateX(22px) scale(.99)}to{opacity:1;transform:none}}
        @keyframes onboardingBack{from{opacity:0;transform:translateX(-22px) scale(.99)}to{opacity:1;transform:none}}
        .onboarding-slide-next{animation:onboardingNext .44s cubic-bezier(.2,.8,.2,1)}
        .onboarding-slide-back{animation:onboardingBack .38s cubic-bezier(.2,.8,.2,1)}
        .onboarding-visual{height:clamp(130px,34vh,340px)}
        @media(max-width:1023px){.onboarding-grid{grid-template-rows:auto minmax(110px,.78fr)}.onboarding-copy{align-self:end}.onboarding-visual{height:clamp(118px,24vh,210px)}}
        @media(max-width:640px){.onboarding-title{font-size:clamp(1.75rem,9vw,2.45rem)}.onboarding-points>div{padding:.42rem}.onboarding-points p{font-size:9px;line-height:1.25}.onboarding-points svg{width:14px;height:14px}.onboarding-points span{width:24px;height:24px}.onboarding-footer>div{align-items:flex-end}.onboarding-footer>div>div:last-child{display:grid;grid-template-columns:auto auto;gap:6px}.onboarding-explore{grid-column:1/-1}.onboarding-visual{height:clamp(105px,21vh,165px)}}
        @media(max-height:680px){.onboarding-body{display:none}.onboarding-visual{height:clamp(90px,18vh,125px)}.onboarding-main{padding-block:.35rem}.onboarding-copy h1{margin-top:.3rem}.onboarding-points{margin-top:.45rem}.onboarding-footer{padding-top:.45rem}}
        @media(max-height:560px){.onboarding-visual{display:none}.onboarding-grid{display:block}.onboarding-copy{height:100%;display:flex;flex-direction:column;justify-content:center}.onboarding-points{margin-top:.5rem}}
        @media(prefers-reduced-motion:reduce){.onboarding-slide-next,.onboarding-slide-back{animation:none}}
      `}</style>
    </div>
  );
}

function GitHubStage({ accent, value, error, onChange }: { accent: string; value: string; error: string; onChange: (value: string) => void }) {
  return (
    <div className="grid h-full place-items-center">
      <section className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-white/[.04] p-5 text-center shadow-2xl sm:p-8">
        <Image src="/github-mark.svg" alt="GitHub" width={72} height={72} className="mx-auto h-14 w-14 sm:h-16 sm:w-16" />
        <p className="mt-3 font-mono text-[9px] uppercase tracking-[.2em]" style={{ color: accent }}>One-time developer setup</p>
        <h1 className="mt-2 text-2xl font-black tracking-[-.03em] text-white sm:text-4xl">Connect your GitHub identity</h1>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-white/52 sm:text-sm">Required for developer work. Sentinel uses it to match issue assignments, pull requests and contribution activity—not to sign in.</p>
        <label className="mx-auto mt-4 block max-w-md text-left"><span className="sr-only">GitHub username</span><div className="flex items-center rounded-2xl border border-white/14 bg-black/30 px-4 focus-within:border-white/40"><span className="text-sm text-white/35">github.com/</span><input autoFocus value={value} onChange={(event) => onChange(event.target.value.replace(/^@/, ""))} maxLength={39} autoComplete="username" placeholder="your-username" className="min-w-0 flex-1 bg-transparent px-1 py-3 text-sm font-bold text-white outline-none placeholder:text-white/20" /></div>{error && <span className="mt-1.5 hidden text-[10px] leading-4 text-red-300 sm:block">{error}</span>}</label>
      </section>
    </div>
  );
}

function RoleAssets({ role }: { role: Role }) {
  if (role === "DONOR") {
    return <div className="absolute left-3 top-3 z-10 flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-full bg-white shadow-lg"><Image src="/Payment Apps Icons/razorpay-logo-notext.png" alt="Razorpay" width={24} height={24} className="h-5 w-5 object-contain" /></span><span className="grid h-9 w-9 place-items-center rounded-full bg-white shadow-lg"><Image src="/Payment Apps Icons/bmc-logo-yellow.png" alt="Buy Me a Coffee" width={26} height={26} className="h-6 w-6 object-contain" /></span></div>;
  }
  if (role === "DEV") {
    return <div className="absolute left-3 top-3 z-10 flex items-center gap-2"><Image src="/github-mark.svg" alt="GitHub" width={36} height={36} className="h-9 w-9" /><span className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-[#111119]"><FeatureIcon label="server process" /></span></div>;
  }
  return <div className="absolute left-3 top-3 z-10 flex items-center gap-2"><Image src="/logo-icon.webp" alt="Sentinel" width={36} height={36} className="h-9 w-9 rounded-full" /><span className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-[#111119]"><FeatureIcon label="receipt" /></span></div>;
}

function OnboardingVisual({ visual, accent, role }: { visual: Visual; accent: string; role: Role }) {
  const labels = role === "ADMIN" ? ["Transaction", "Service", "Receipt", "Reminder"] : role === "DEV" ? ["Task", "GitHub issue", "Pull request", "Deploy"] : ["Contribution", "Razorpay", "Approval", "History"];
  return (
    <section aria-hidden="true" className="onboarding-visual relative mx-auto w-full max-w-xl overflow-hidden rounded-[26px] border border-white/10 bg-white/[.035] p-4 shadow-[0_35px_90px_rgba(0,0,0,.4)] backdrop-blur-xl">
      <RoleAssets role={role} />
      <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full blur-3xl" style={{ background: `${accent}2a` }} />
      {visual === "FLOW" && <div className="relative flex h-full flex-col justify-center gap-1 pt-6">{labels.map((label, itemIndex) => <div key={label} className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/20 p-1.5" style={{ transform: `translateX(${itemIndex * 7}px)` }}><span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg" style={{ color: accent, background: `${accent}18` }}><FeatureIcon label={label} /></span><div className="h-1.5 flex-1 rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${88 - itemIndex * 12}%`, background: accent }} /></div><span className="text-[9px] font-semibold text-white/68">{label}</span></div>)}</div>}
      {visual === "PULSE" && <div className="relative grid h-full place-items-center"><div className="absolute aspect-square h-[84%] rounded-full border border-white/8" /><div className="absolute aspect-square h-[58%] rounded-full border border-white/10" /><div className="absolute aspect-square h-[34%] animate-pulse rounded-full" style={{ background: `${accent}1f`, boxShadow: `0 0 60px ${accent}42` }} /><p className="relative text-4xl font-black sm:text-6xl" style={{ color: accent }}>LIVE</p>{labels.slice(0, 3).map((label,itemIndex)=><span key={label} className="absolute flex items-center gap-1 rounded-full border border-white/10 bg-[#111119] px-2 py-1 text-[8px] text-white/62" style={{ right: itemIndex % 2 ? "8%" : "auto", left: itemIndex % 2 ? "auto" : "8%", top: `${24 + itemIndex * 24}%` }}><FeatureIcon label={label} />{label}</span>)}</div>}
      {visual === "STACK" && <div className="relative flex h-full flex-col justify-center pt-4">{labels.map((label,itemIndex)=><div key={label} className="relative -mt-1 rounded-xl border border-white/10 bg-[#14141d]/95 p-1.5 shadow-xl" style={{ marginLeft: `${itemIndex * 12}px`, zIndex: labels.length-itemIndex, borderLeftColor: accent }}><span className="flex items-center gap-2 text-[9px] font-bold text-white/74"><FeatureIcon label={label} />{label}</span></div>)}</div>}
      {visual === "RINGS" && <div className="relative grid h-full place-items-center"><div className="absolute aspect-square h-[86%] rounded-full border border-dashed border-white/15 animate-[spin_28s_linear_infinite]" /><div className="absolute aspect-square h-[58%] rounded-full border border-white/10" /><Image src={role === "DEV" ? "/github-mark.svg" : role === "DONOR" ? "/Payment Apps Icons/razorpay-logo-notext.png" : "/logo-icon.webp"} alt="" width={82} height={82} className={`relative h-16 w-16 object-contain shadow-2xl ${role === "DONOR" ? "rounded-full bg-white p-3" : "rounded-full"}`} />{labels.slice(0, 3).map((label,itemIndex)=><span key={label} className="absolute flex items-center gap-1 rounded-lg border border-white/10 bg-[#111119] px-2 py-1 text-[8px] font-semibold text-white/65" style={{ transform:`rotate(${itemIndex*120}deg) translateY(-75px) rotate(${-itemIndex*120}deg)` }}><FeatureIcon label={label} />{label}</span>)}</div>}
      {visual === "TRUST" && <div className="relative flex h-full flex-col items-center justify-center pt-4"><div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/10" style={{ color: accent, background:`${accent}14`, boxShadow:`0 0 55px ${accent}25` }}><FeatureIcon label="secure access audit" size="lg" /></div><div className="mt-3 grid w-full grid-cols-2 gap-1.5">{labels.map((label)=><div key={label} className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-black/20 p-2 text-[9px] font-semibold text-white/65"><FeatureIcon label={label} />{label}</div>)}</div></div>}
    </section>
  );
}

function FeatureIcon({ label, size }: { label: string; size?: "lg" }) {
  const value = label.toLowerCase();
  const className = size === "lg" ? "h-9 w-9" : "h-4 w-4 shrink-0";
  if (/reminder|expiry|deadline|monthly/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>;
  if (/server|vps|cpu|memory|disk|deploy|process/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01"/></svg>;
  if (/receipt|proof|history|record/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></svg>;
  if (/github|issue|pull|repository|contribution visibility/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg>;
  if (/credential|access|secure|audit|approval/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M12 3 5 6v5c0 4.5 2.7 8.1 7 10 4.3-1.9 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></svg>;
  if (/transaction|treasury|payment|giving|provider|razorpay|currency|inr/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M7 7h10M7 11h7M10 7c3 0 4 1 4 3s-1 3-4 3H7l7 6"/></svg>;
  if (/alert|attention|pending|decision|priority/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>;
  if (/task|board|fix|ownership|action/.test(value)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 2.5 2.5L16 9"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"/></svg>;
}
