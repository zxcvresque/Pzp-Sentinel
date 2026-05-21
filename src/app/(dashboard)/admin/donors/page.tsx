"use client";

import { useEffect, useState } from "react";

interface Donor {
  rank: number;
  userId: string;
  name: string;
  totalAmount: number;
  donationCount: number;
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

  useEffect(() => {
    fetchLeaderboard(period);
  }, [period]);

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
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-extrabold">
          Top <span className="font-display text-lime">Donors</span>
        </h1>
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
                  <div className="text-sm font-medium text-text-primary truncate">
                    {donor.name}
                  </div>
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
    </div>
  );
}
