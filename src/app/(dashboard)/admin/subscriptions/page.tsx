"use client";

import { useEffect, useState } from "react";

interface Subscription {
  id: string;
  platform: string;
  planUrl: string | null;
  price: string;
  currency: string;
  frequency: string;
  status: string;
  expiryDate: string;
  lastRenewalDate: string | null;
  createdAt: string;
}

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/subscriptions")
      .then((r) => r.json())
      .then((data) => setSubs(data.subscriptions || []))
      .finally(() => setLoading(false));
  }, []);

  const activeSubs = subs.filter((s) => s.status === "ACTIVE");
  const monthlyCost = activeSubs.reduce((sum, s) => {
    const price = parseFloat(s.price);
    return sum + (s.frequency === "YEARLY" ? price / 12 : s.frequency === "ONE_TIME" ? 0 : price);
  }, 0);

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-20 w-full mb-4" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold">
          Active <span className="font-display text-lime">Subscriptions</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Active</div>
          <div className="text-3xl font-extrabold text-mint">{activeSubs.length}</div>
        </div>
        <div className="card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Monthly Burn</div>
          <div className="text-3xl font-extrabold text-coral">₹{Math.round(monthlyCost).toLocaleString("en-IN")}</div>
        </div>
        <div className="card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Total Tracked</div>
          <div className="text-3xl font-extrabold">{subs.length}</div>
        </div>
      </div>

      {subs.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No subscriptions tracked yet.</p>
          <p className="text-text-tertiary text-sm">Add subscriptions via the API.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {subs.map((sub) => {
            const isExpired = new Date(sub.expiryDate) < new Date();
            return (
              <div key={sub.id} className="card p-5 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold flex items-center gap-2">
                    {sub.platform}
                    {sub.planUrl && (
                      <a
                        href={sub.planUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-tertiary text-xs hover:text-lime transition-colors"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                  <div className="text-text-tertiary text-xs mt-1">
                    {sub.frequency.toLowerCase()} · expires {new Date(sub.expiryDate).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-lg font-extrabold">
                    {sub.currency === "INR" ? "₹" : "$"}
                    {parseFloat(sub.price).toLocaleString()}
                  </span>
                  <span
                    className={`status-tag ${
                      sub.status === "ACTIVE" && !isExpired
                        ? "status-approved"
                        : sub.status === "CANCELLED"
                          ? "status-rejected"
                          : "status-pending"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {isExpired && sub.status === "ACTIVE" ? "OVERDUE" : sub.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
