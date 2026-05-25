"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

/* ------------------------------------------------------------------ */
/*  Telegram Login Widget integration                                  */
/* ------------------------------------------------------------------ */

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    onTelegramAuth: (user: TelegramUser) => void;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [awaitingRole, setAwaitingRole] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  // ── Telegram Widget callback ──
  const handleTelegramAuth = useCallback(
    async (tgUser: TelegramUser) => {
      setError("");
      setLoading(true);
      setAwaitingRole(false);

      try {
        const res = await fetch("/api/auth/telegram-widget", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tgUser),
        });
        const data = await res.json();

        if (!res.ok) {
          if (data.awaitingRole) {
            setAwaitingRole(true);
          }
          setError(data.error);
          return;
        }

        window.location.href = data.redirect;
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // ── Load Telegram widget script ──
  useEffect(() => {
    window.onTelegramAuth = handleTelegramAuth;

    if (widgetRef.current && !widgetRef.current.querySelector("script")) {
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-widget.js?22";
      script.async = true;
      script.setAttribute("data-telegram-login", process.env.NEXT_PUBLIC_BOT_USERNAME || "TheSentinelRobot");
      script.setAttribute("data-size", "large");
      script.setAttribute("data-radius", "12");
      script.setAttribute("data-onauth", "onTelegramAuth(user)");
      script.setAttribute("data-request-access", "write");
      widgetRef.current.appendChild(script);
    }

    return () => {
      delete (window as Partial<typeof window>).onTelegramAuth;
    };
  }, [handleTelegramAuth]);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <img
        src="/login-bg.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />

      <div className="w-full max-w-[400px] px-6 relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1
            className="text-2xl sm:text-3xl font-extrabold text-white select-none mb-2 whitespace-nowrap"
            style={{ letterSpacing: "0.05em" }}
          >
            {"Ｓ ☰ ＮＴＩＮ ☰ Ｌ"}
          </h1>
          <p className="text-white/35 text-[11px] tracking-[0.25em] uppercase">
            PzP Finance &amp; Developers Hub
          </p>
        </div>

        {/* Glass card */}
        <div
          className="rounded-2xl p-7 relative"
          style={{
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(40px) saturate(1.4)",
            WebkitBackdropFilter: "blur(40px) saturate(1.4)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow:
              "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)",
          }}
        >
          {!showOtp ? (
            <>
              {/* Loading overlay */}
              {loading && (
                <div className="absolute inset-0 z-20 rounded-2xl flex items-center justify-center"
                  style={{ background: "rgba(17,17,22,0.7)", backdropFilter: "blur(4px)" }}>
                  <div className="flex flex-col items-center gap-3">
                    <span className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                    <span className="text-white/60 text-sm">Signing in...</span>
                  </div>
                </div>
              )}

              <p className="text-white/50 text-[11px] font-semibold uppercase tracking-[0.15em] text-center mb-5">
                Sign in with Telegram
              </p>

              {/* Telegram widget renders here */}
              <div
                ref={widgetRef}
                className="flex justify-center min-h-[44px]"
              />

              {/* Error */}
              {error && (
                <div className="mt-4">
                  <p className="text-red-400 text-sm text-center">{error}</p>
                  {awaitingRole && (
                    <p className="text-white/30 text-xs text-center mt-1.5">
                      An admin will assign your access shortly.
                    </p>
                  )}
                </div>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3 mt-6 mb-1">
                <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
                <span className="text-white/20 text-[10px] uppercase tracking-widest">or</span>
                <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
              </div>

              {/* OTP fallback */}
              <button
                type="button"
                onClick={() => setShowOtp(true)}
                className="w-full text-white/30 text-xs hover:text-white/55 transition-colors duration-300 py-2"
              >
                Sign in with OTP
              </button>
            </>
          ) : (
            <OtpFlow onBack={() => { setShowOtp(false); setError(""); }} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  OTP fallback (existing flow, compact)                              */
/* ------------------------------------------------------------------ */

function OtpFlow({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"id" | "otp">("id");
  const [telegramId, setTelegramId] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [botLink, setBotLink] = useState("");

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        if (data.botLink) setBotLink(data.botLink);
        return;
      }
      setStep("otp");
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      window.location.href = data.redirect;
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.12)",
  };

  const btnStyle = {
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.15)",
    color: "rgba(255,255,255,0.85)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
  };

  return (
    <>
      {step === "id" ? (
        <form onSubmit={requestOtp}>
          <label className="text-white/50 text-[11px] font-semibold uppercase tracking-[0.15em] block mb-2">
            Telegram ID
          </label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={telegramId}
            onChange={(e) => setTelegramId(e.target.value)}
            placeholder="Enter your numeric ID"
            className="w-full rounded-xl px-4 py-3.5 text-white text-sm placeholder:text-white/25 transition-all duration-300 focus:outline-none focus:ring-1 focus:ring-white/20"
            style={inputStyle}
            autoFocus
          />
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          {botLink && (
            <a href={botLink} target="_blank" rel="noopener noreferrer"
              className="text-white/50 text-sm mt-1.5 block hover:text-white/70 underline underline-offset-2 transition-colors">
              Start the bot first
            </a>
          )}
          <button type="submit" disabled={loading || !telegramId}
            className="w-full mt-5 py-3.5 rounded-xl text-sm font-semibold transition-all duration-300 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-25 disabled:cursor-not-allowed"
            style={btnStyle}>
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-[1.5px] border-white/20 border-t-white/70 rounded-full animate-spin" />
                Sending...
              </span>
            ) : "Send OTP"}
          </button>
          <a href="https://t.me/TheSentinelRobot?start=myid" target="_blank" rel="noopener noreferrer"
            className="block text-center text-white/30 text-xs mt-3 hover:text-white/55 transition-colors">
            Don&apos;t know your ID?
          </a>
        </form>
      ) : (
        <form onSubmit={verifyOtp}>
          <div className="flex items-center gap-2.5 mb-5 px-3.5 py-2.5 rounded-xl"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <svg className="w-4 h-4 text-white/50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-white/50 text-sm">OTP sent. Check your Telegram DMs.</p>
          </div>
          <label className="text-white/50 text-[11px] font-semibold uppercase tracking-[0.15em] block mb-2">
            Enter OTP
          </label>
          <input
            type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
            value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="000000"
            className="w-full rounded-xl px-4 py-3.5 text-white text-center text-2xl tracking-[0.3em] font-mono placeholder:text-white/15 placeholder:text-2xl transition-all duration-300 focus:outline-none focus:ring-1 focus:ring-white/20"
            style={inputStyle} autoFocus
          />
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          <button type="submit" disabled={loading || otp.length !== 6}
            className="w-full mt-5 py-3.5 rounded-xl text-sm font-semibold transition-all duration-300 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-25 disabled:cursor-not-allowed"
            style={btnStyle}>
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-[1.5px] border-white/20 border-t-white/70 rounded-full animate-spin" />
                Verifying...
              </span>
            ) : "Verify"}
          </button>
        </form>
      )}
      <button type="button" onClick={onBack}
        className="w-full mt-2 text-white/30 text-sm hover:text-white/55 transition-colors duration-300 py-2">
        Back
      </button>
    </>
  );
}
