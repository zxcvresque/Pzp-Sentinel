"use client";

import { useEffect, useState } from "react";
import TgUser from "@/components/TgUser";
import RazorpayDonationCard from "@/components/RazorpayDonationCard";
import BmcSupportCard from "@/components/BmcSupportCard";
import OneTimeDonationLinks from "@/components/OneTimeDonationLinks";
import PageTour from "@/components/PageTour";

interface Donor {
  rank: number;
  userId: string;
  name: string;
  photoUrl?: string | null;
  telegramUser?: string | null;
  totalAmount: number;
  donationCount: number;
}

interface DonorAccess {
  id: string;
  name: string;
  photoUrl?: string | null;
  telegramUser?: string | null;
  bmcAccess: boolean;
  razorpayAccess: boolean;
}

type Period = "all" | "year" | "month";

const periodLabels: Record<Period, string> = {
  all: "All Time",
  year: "This Year",
  month: "This Month",
};

export default function DonorsLeaderboard() {
  const [donors, setDonors] = useState<Donor[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("all");
  const [accessDonors, setAccessDonors] = useState<DonorAccess[]>([]);
  const [accessLoading, setAccessLoading] = useState(true);
  const [savingAccess, setSavingAccess] = useState("");
  const [accessMessage, setAccessMessage] = useState("");

  useEffect(() => {
    fetchLeaderboard(period);
  }, [period]);

  useEffect(() => {
    fetch("/api/donors/access", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load payment access");
        setAccessDonors(data.donors || []);
      })
      .catch((error) => setAccessMessage(error instanceof Error ? error.message : "Failed to load payment access"))
      .finally(() => setAccessLoading(false));
  }, []);

  async function toggleAccess(donor: DonorAccess, provider: "BMC" | "RAZORPAY", allowed: boolean) {
    const key = `${donor.id}:${provider}`;
    setSavingAccess(key);
    setAccessMessage("");
    try {
      const response = await fetch("/api/donors/access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: donor.id, provider, allowed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update payment access");
      setAccessDonors((current) => current.map((entry) => entry.id === donor.id
        ? { ...entry, ...data.donor }
        : entry));
      setAccessMessage(`${provider === "BMC" ? "Buy Me a Coffee" : "Razorpay"} ${allowed ? "enabled" : "disabled"} for ${donor.name}.`);
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "Could not update payment access");
    } finally {
      setSavingAccess("");
    }
  }

  async function fetchLeaderboard(p: Period) {
    setLoading(true);
    try {
      const res = await fetch(`/api/donors/leaderboard?period=${p}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDonors(data.leaderboard || []);
    } catch {
      setDonors([]);
    } finally {
      setLoading(false);
    }
  }

  // Medal colors for top 3
  function rankDisplay(rank: number) {
    if (rank === 1) return { bg: "rgba(251,191,36,0.12)", color: "var(--amber)", label: "1st" };
    if (rank === 2) return { bg: "rgba(167,167,180,0.10)", color: "#a7a7b4", label: "2nd" };
    if (rank === 3) return { bg: "rgba(205,127,50,0.10)", color: "#cd7f32", label: "3rd" };
    return { bg: "transparent", color: "var(--text-tertiary)", label: `${rank}` };
  }

  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold">
            Top <span className="font-display text-lime">Donors</span>
          </h1>
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card p-5">
              <div className="skeleton h-8 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-extrabold">
          Donors <span className="font-display text-lime">& Payments</span>
        </h1>
      </div>

      <section data-tour="donor-payment-access" className="mb-8 overflow-hidden rounded-[22px] border border-[var(--border)] bg-bg-deep">
        <div className="border-b border-[var(--border)] p-4 sm:p-5">
          <h2 className="text-base font-bold">Allow payment methods for</h2>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">BMC is enabled for donors by default. Enable Razorpay for selected donors; access remains available until you switch it off.</p>
        </div>
        {accessLoading ? (
          <div className="space-y-2 p-4 sm:p-5"><div className="skeleton h-16 w-full" /><div className="skeleton h-16 w-full" /></div>
        ) : accessDonors.length === 0 ? (
          <p className="p-5 text-sm text-text-secondary">No active donors found.</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {accessDonors.map((donor) => {
              const razorpayKey = `${donor.id}:RAZORPAY`;
              const bmcKey = `${donor.id}:BMC`;
              return (
                <div key={donor.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                  <div className="min-w-0">
                    <TgUser name={donor.name} telegramUser={donor.telegramUser} photoUrl={donor.photoUrl} size={24} />
                    <p className="mt-1 font-mono text-[9px] uppercase tracking-[.08em] text-text-tertiary">Payment access managed per donor</p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-amber/20 bg-amber/5 px-3 text-xs text-text-secondary">
                      <input type="checkbox" checked={donor.bmcAccess} disabled={savingAccess === bmcKey}
                        onChange={(event) => void toggleAccess(donor, "BMC", event.target.checked)} className="h-4 w-4 accent-amber" />
                      Allow BMC
                    </label>
                    <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-lime/20 bg-lime/5 px-3 text-xs text-text-secondary">
                      <input type="checkbox" checked={donor.razorpayAccess} disabled={savingAccess === razorpayKey}
                        onChange={(event) => void toggleAccess(donor, "RAZORPAY", event.target.checked)} className="h-4 w-4 accent-lime" />
                      Allow Razorpay
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {accessMessage && <p className="mb-5 rounded-xl border border-[var(--border)] bg-white/[.02] px-3 py-2.5 text-xs text-text-secondary">{accessMessage}</p>}

      <OneTimeDonationLinks />
      <RazorpayDonationCard adminPreview onSuccess={() => fetchLeaderboard(period)} />
      <BmcSupportCard adminPreview />

      <div data-tour="donor-leaderboard" className="mb-5 mt-10">
        <h2 className="text-xl font-extrabold">Contribution <span className="font-display text-lime">Leaderboard</span></h2>
      </div>

      {/* Period filter */}
      <div className="flex gap-2 mb-6">
        {(Object.keys(periodLabels) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border transition-colors ${
              period === p
                ? "bg-lime text-bg-void border-lime"
                : "text-text-secondary border-[var(--border)] hover:border-[var(--border-hover)]"
            }`}
          >
            {periodLabels[p]}
          </button>
        ))}
      </div>

      {donors.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No donations found for this period.</p>
          <p className="text-text-tertiary text-sm">
            Donations will appear here once approved IN transactions with assigned donors exist.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {donors.map((donor) => {
            const rd = rankDisplay(donor.rank);
            return (
              <div
                key={donor.userId}
                className="card p-4 flex items-center gap-4 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
              >
                {/* Rank badge */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-mono text-sm font-bold shrink-0"
                  style={{ background: rd.bg, color: rd.color }}
                >
                  {rd.label}
                </div>

                {/* Name + count */}
                <div className="flex-1 min-w-0">
                  <TgUser name={donor.name} telegramUser={donor.telegramUser} photoUrl={donor.photoUrl} size={24} />
                  <div className="font-mono text-[10px] text-text-tertiary mt-0.5">
                    {donor.donationCount} donation{donor.donationCount !== 1 ? "s" : ""}
                  </div>
                </div>

                {/* Amount */}
                <div className="text-right shrink-0">
                  <div className="text-lg font-extrabold text-mint">
                    ₹{donor.totalAmount.toLocaleString("en-IN")}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Summary footer */}
          <div
            className="mt-4 p-4 rounded-lg flex items-center justify-between"
            style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              Total ({periodLabels[period]})
            </div>
            <div className="font-mono text-sm font-semibold text-text-primary">
              ₹{donors.reduce((s, d) => s + d.totalAmount, 0).toLocaleString("en-IN")}
              <span className="text-text-tertiary text-[10px] ml-2">
                from {donors.length} donor{donors.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>
      )}
      <PageTour pageKey="admin-donors" version={2} />
    </div>
  );
}
