"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
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
      setError("Something went wrong. Please try again.");
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
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/login-bg.png')", filter: "brightness(1.3)" }}
      />
      {/* Tinted overlay for readability */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.5) 100%)",
        }}
      />

      <div className="w-full max-w-sm px-6 relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl text-lime mb-2 font-extrabold" style={{ letterSpacing: "0.05em" }}>{"Ｓ ☰ ＮＴＩＮ ☰ Ｌ"}</h1>
          <p className="text-text-secondary text-sm">PzP Finance &amp; Developers Hub</p>
        </div>

        <div className="card p-6 backdrop-blur-sm bg-[var(--bg-surface)]/80 border border-[var(--border)]">
          {step === "id" ? (
            <form onSubmit={requestOtp}>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Telegram ID
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={telegramId}
                onChange={(e) => setTelegramId(e.target.value)}
                placeholder="Enter your numeric Telegram ID"
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-lime/30 transition-colors"
                autoFocus
              />

              {error && (
                <p className="text-coral text-sm mt-3">{error}</p>
              )}
              {botLink && (
                <a
                  href={botLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan text-sm mt-1 block hover:underline"
                >
                  Start the bot first
                </a>
              )}

              <button
                type="submit"
                disabled={loading || !telegramId}
                className="w-full mt-4 bg-lime text-bg-void font-semibold py-3 rounded-full hover:bg-lime/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-bg-void/30 border-t-bg-void rounded-full animate-spin" />
                    Sending...
                  </span>
                ) : (
                  "Send OTP"
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp}>
              <p className="text-mint text-sm mb-4">
                OTP sent! Check your Telegram DMs.
              </p>

              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Enter OTP
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit code"
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary text-center text-2xl tracking-[0.3em] font-mono placeholder:text-text-tertiary placeholder:text-base placeholder:tracking-normal focus:outline-none focus:border-lime/30 transition-colors"
                autoFocus
              />

              {error && (
                <p className="text-coral text-sm mt-3">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full mt-4 bg-lime text-bg-void font-semibold py-3 rounded-full hover:bg-lime/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-bg-void/30 border-t-bg-void rounded-full animate-spin" />
                    Verifying...
                  </span>
                ) : (
                  "Verify"
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("id");
                  setOtp("");
                  setError("");
                }}
                className="w-full mt-2 text-text-secondary text-sm hover:text-text-primary transition-colors"
              >
                Back
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
