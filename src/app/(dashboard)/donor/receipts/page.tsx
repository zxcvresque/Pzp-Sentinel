"use client";

import { useEffect, useState } from "react";

interface Transaction {
  id: string;
  amount: string;
  currency: string;
  method: string;
  description: string;
  status: string;
  date: string;
  reviewNote: string | null;
}

export default function ReceiptsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/transactions?limit=100")
      .then((r) => r.json())
      .then((data) =>
        setTransactions(
          (data.transactions || []).filter(
            (t: Transaction) => t.status === "APPROVED"
          )
        )
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-6">
        Your <span className="font-display text-lime">Receipts</span>
      </h1>

      {transactions.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No approved donations yet.</p>
          <p className="text-text-tertiary text-sm">
            Receipts will appear here once your donations are approved by an admin.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {transactions.map((tx) => (
            <div key={tx.id} className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">{tx.description}</span>
                <span className="text-mint font-extrabold">
                  ₹{parseFloat(tx.amount).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-text-tertiary text-xs">
                <span>{new Date(tx.date).toLocaleDateString()} · {tx.method}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded bg-mint/10 text-mint">
                  APPROVED
                </span>
              </div>
              {tx.reviewNote && (
                <div className="mt-2 text-text-secondary text-xs border-t border-[var(--border)] pt-2">
                  Note: {tx.reviewNote}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
