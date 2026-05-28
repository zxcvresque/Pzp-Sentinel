"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const BOT_USERNAME = "TheSentinelRobot";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [awaitingRole, setAwaitingRole] = useState(false);
  const [nonce, setNonce] = useState("");
  const [waitingForBot, setWaitingForBot] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const verifiedRef = useRef(false);

  // Generate a nonce and navigate to bot deep link
  const handleTelegramLogin = useCallback(async () => {
    setError("");
    setAwaitingRole(false);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login-token", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create login token");
        setLoading(false);
        return;
      }

      setNonce(data.nonce);
      setWaitingForBot(true);
      setLoading(false);

      // Use an anchor click to open in new tab (more reliable than window.open)
      const a = document.createElement("a");
      a.href = `https://t.me/${BOT_USERNAME}?start=auth_${data.nonce}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }, []);

  // Poll for verification once we have a nonce
  useEffect(() => {
    if (!nonce || !waitingForBot) return;

    const poll = async () => {
      if (verifiedRef.current) return; // already verified, ignore stale polls
      try {
        const res = await fetch(`/api/auth/login-check?nonce=${nonce}`);
        const data = await res.json();

        if (data.status === "verified") {
          verifiedRef.current = true;
          if (pollRef.current) clearInterval(pollRef.current);
          window.location.href = data.redirect;
          return;
        }

        if (verifiedRef.current) return; // guard against race

        if (data.status === "expired") {
          if (pollRef.current) clearInterval(pollRef.current);
          setWaitingForBot(false);
          setNonce("");
          setError("Login expired. Please try again.");
          return;
        }

        if (data.status === "no_role") {
          if (pollRef.current) clearInterval(pollRef.current);
          setWaitingForBot(false);
          setNonce("");
          setAwaitingRole(true);
          setError(data.error);
          return;
        }

        if (!res.ok && data.error) {
          if (pollRef.current) clearInterval(pollRef.current);
          setWaitingForBot(false);
          setNonce("");
          setError(data.error);
          return;
        }

        // status === "pending" — keep polling
      } catch {
        // Network error — keep polling, it'll recover
      }
    };

    // Poll every 2 seconds
    pollRef.current = setInterval(poll, 2000);
    // Also poll immediately
    poll();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [nonce, waitingForBot]);

  const cancelWaiting = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setWaitingForBot(false);
    setNonce("");
    setError("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <style>{`
        @keyframes tg-shine {
          0% { transform: translateX(-100%) skewX(-15deg); }
          100% { transform: translateX(250%) skewX(-15deg); }
        }
        .tg-btn {
          position: relative;
          overflow: hidden;
        }
        .tg-btn::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 35%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255,255,255,0.2),
            transparent
          );
          transform: translateX(-100%) skewX(-15deg);
          pointer-events: none;
        }
        .tg-btn:hover::after {
          animation: tg-shine 0.5s ease forwards;
        }
        .tg-btn:hover {
          box-shadow:
            0 6px 20px rgba(42,171,238,0.4),
            inset 0 1px 0 rgba(255,255,255,0.2) !important;
          transform: translateY(-1px) scale(1.01);
        }
        .tg-btn:active {
          transform: translateY(0) scale(0.98) !important;
        }
        .tg-btn > * {
          position: relative;
          z-index: 1;
        }
        .glass-btn {
          position: relative;
          overflow: hidden;
        }
        .glass-btn::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 40%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255,255,255,0.15),
            transparent
          );
          transform: translateX(-100%) skewX(-15deg);
          pointer-events: none;
        }
        .glass-btn:hover::after {
          animation: tg-shine 0.6s ease forwards;
        }
        .glass-btn:hover {
          background: rgba(255,255,255,0.16) !important;
          border-color: rgba(255,255,255,0.25) !important;
          transform: translateY(-1px);
        }
        .glass-btn:active {
          transform: translateY(0) scale(0.97) !important;
        }
      `}</style>
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
              {/* Waiting overlay */}
              {(loading || waitingForBot) && (
                <div
                  className="absolute inset-0 z-20 rounded-2xl flex items-center justify-center"
                  style={{
                    background: "rgba(17,17,22,0.7)",
                    backdropFilter: "blur(4px)",
                  }}
                >
                  <div className="flex flex-col items-center gap-3 px-6">
                    <span className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                    <span className="text-white/60 text-sm text-center">
                      {waitingForBot
                        ? "Waiting for confirmation in Telegram..."
                        : "Signing in..."}
                    </span>
                    {waitingForBot && (
                      <button
                        type="button"
                        onClick={cancelWaiting}
                        className="text-white/30 text-xs hover:text-white/55 transition-colors mt-1"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}

              <p className="text-white/50 text-[11px] font-semibold uppercase tracking-[0.15em] text-center mb-5">
                Sign in with Telegram
              </p>

              {/* Login with Telegram button */}
              <button
                type="button"
                onClick={handleTelegramLogin}
                disabled={loading || waitingForBot}
                className="tg-btn w-full flex items-center justify-center gap-3 py-3.5 rounded-xl text-sm font-semibold transition-all duration-300 disabled:opacity-25 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg, #2AABEE 0%, #229ED9 100%)",
                  color: "#fff",
                  boxShadow:
                    "0 4px 14px rgba(42,171,238,0.3), inset 0 1px 0 rgba(255,255,255,0.15)",
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                Login with Telegram
              </button>

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

              <div className="flex items-center gap-3 mt-6 mb-1">
                <div
                  className="flex-1 h-px"
                  style={{ background: "rgba(255,255,255,0.08)" }}
                />
                <span className="text-white/20 text-[10px] uppercase tracking-widest">
                  or
                </span>
                <div
                  className="flex-1 h-px"
                  style={{ background: "rgba(255,255,255,0.08)" }}
                />
              </div>

              <button
                type="button"
                onClick={() => setShowOtp(true)}
                className="w-full text-white/30 text-xs hover:text-white/55 transition-colors duration-300 py-2"
              >
                Sign in with OTP
              </button>
            </>
          ) : (
            <OtpFlow
              onBack={() => {
                setShowOtp(false);
                setError("");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  OTP fallback                                                       */
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
            <a
              href={botLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/50 text-sm mt-1.5 block hover:text-white/70 underline underline-offset-2 transition-colors"
            >
              Start the bot first
            </a>
          )}
          <button
            type="submit"
            disabled={loading || !telegramId}
            className="glass-btn w-full mt-5 py-3.5 rounded-xl text-sm font-semibold transition-all duration-300 disabled:opacity-25 disabled:cursor-not-allowed"
            style={btnStyle}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-[1.5px] border-white/20 border-t-white/70 rounded-full animate-spin" />
                Sending...
              </span>
            ) : (
              "Send OTP"
            )}
          </button>
          <a
            href="https://t.me/TheSentinelRobot?start=myid"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-white/30 text-xs mt-3 hover:text-white/55 transition-colors"
          >
            Don&apos;t know your ID?
          </a>
        </form>
      ) : (
        <form onSubmit={verifyOtp}>
          <div
            className="flex items-center gap-2.5 mb-5 px-3.5 py-2.5 rounded-xl"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <svg
              className="w-4 h-4 text-white/50 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-white/50 text-sm">
              OTP sent. Check your Telegram DMs.
            </p>
          </div>
          <label className="text-white/50 text-[11px] font-semibold uppercase tracking-[0.15em] block mb-2">
            Enter OTP
          </label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="000000"
            className="w-full rounded-xl px-4 py-3.5 text-white text-center text-2xl tracking-[0.3em] font-mono placeholder:text-white/15 placeholder:text-2xl transition-all duration-300 focus:outline-none focus:ring-1 focus:ring-white/20"
            style={inputStyle}
            autoFocus
          />
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="glass-btn w-full mt-5 py-3.5 rounded-xl text-sm font-semibold transition-all duration-300 disabled:opacity-25 disabled:cursor-not-allowed"
            style={btnStyle}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-[1.5px] border-white/20 border-t-white/70 rounded-full animate-spin" />
                Verifying...
              </span>
            ) : (
              "Verify"
            )}
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={onBack}
        className="w-full mt-2 text-white/30 text-sm hover:text-white/55 transition-colors duration-300 py-2"
      >
        Back
      </button>
    </>
  );
}
