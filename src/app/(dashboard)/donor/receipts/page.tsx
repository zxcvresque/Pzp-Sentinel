"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import PaymentMethodBadge from "@/components/PaymentMethodBadge";

interface Transaction {
  id: string;
  amount: string;
  currency: string;
  method: string;
  paymentMethodDetail?: string | null;
  description: string;
  status: string;
  date: string;
  reviewNote: string | null;
}

export default function ReceiptsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [donorName, setDonorName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [printingId, setPrintingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/transactions?limit=100")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) =>
        setTransactions(
          (data.transactions || []).filter(
            (t: Transaction) => t.status === "APPROVED"
          )
        )
      )
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => setDonorName(data.user?.name || data.name || ""))
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      const txDate = new Date(tx.date);
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        if (txDate < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (txDate > to) return false;
      }
      return true;
    });
  }, [transactions, dateFrom, dateTo]);

  const handlePrint = useCallback(
    (txId: string) => {
      setPrintingId(txId);
      // Allow React to render the print view before triggering print
      setTimeout(() => {
        window.print();
        setPrintingId(null);
      }, 100);
    },
    []
  );

  const handleExportCSV = useCallback(() => {
    const header = "Date,Amount,Method,Description,Status,Review Note";
    const rows = filtered.map((tx) => {
      const date = new Date(tx.date).toLocaleDateString();
      const amount = parseFloat(tx.amount).toFixed(2);
      const method = tx.method;
      const desc = `"${tx.description.replace(/"/g, '""')}"`;
      const status = "Approved";
      const note = tx.reviewNote
        ? `"${tx.reviewNote.replace(/"/g, '""')}"`
        : "";
      return `${date},${amount},${method},${desc},${status},${note}`;
    });

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pzp-receipts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const printTx = printingId
    ? filtered.find((tx) => tx.id === printingId) ?? null
    : null;

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  return (
    <>
      {/* ---- Print-only receipt view ---- */}
      {printTx && (
        <div className="receipt-print-view">
          <div className="receipt-print-inner">
            <h1 className="receipt-print-title">
              PzP Sentinel &mdash; Donation Receipt
            </h1>

            <table className="receipt-print-table">
              <tbody>
                <tr>
                  <td className="receipt-label">Donor</td>
                  <td>{donorName || "—"}</td>
                </tr>
                <tr>
                  <td className="receipt-label">Date</td>
                  <td>{new Date(printTx.date).toLocaleDateString()}</td>
                </tr>
                <tr>
                  <td className="receipt-label">Amount</td>
                  <td>
                    {printTx.currency === "INR" ? "₹" : "$"}
                    {parseFloat(printTx.amount).toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <td className="receipt-label">Method</td>
                  <td>{printTx.method}</td>
                </tr>
                <tr>
                  <td className="receipt-label">Description</td>
                  <td>{printTx.description}</td>
                </tr>
                <tr>
                  <td className="receipt-label">Status</td>
                  <td>Approved</td>
                </tr>
                {printTx.reviewNote && (
                  <tr>
                    <td className="receipt-label">Admin Note</td>
                    <td>{printTx.reviewNote}</td>
                  </tr>
                )}
              </tbody>
            </table>

            <p className="receipt-print-footer">
              Thank you for your contribution.
            </p>
          </div>
        </div>
      )}

      {/* ---- Screen view ---- */}
      <div className="receipts-screen-view">
        <h1 className="text-3xl font-extrabold mb-6">
          Your <span className="font-display text-lime">Receipts</span>
        </h1>

        {/* Filters row */}
        <div className="card p-4 mb-5 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
              From
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="receipt-date-input"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
              To
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="receipt-date-input"
            />
          </div>

          {(dateFrom || dateTo) && (
            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              Clear dates
            </button>
          )}

          <div className="ml-auto">
            <button
              onClick={handleExportCSV}
              disabled={filtered.length === 0}
              className="receipt-btn receipt-btn-export"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-text-secondary mb-2">
              {transactions.length === 0
                ? "No approved donations yet."
                : "No receipts match the selected date range."}
            </p>
            <p className="text-text-tertiary text-sm">
              {transactions.length === 0
                ? "Receipts will appear here once your donations are approved by an admin."
                : "Try adjusting or clearing the date filters."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((tx) => (
              <div key={tx.id} className="card p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">
                    {tx.description}
                  </span>
                  <span className="text-mint font-extrabold">
                    ₹{parseFloat(tx.amount).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-text-tertiary text-xs">
                  <span>
                    <span className="mr-2">{new Date(tx.date).toLocaleDateString()}</span>
                    <PaymentMethodBadge method={tx.method} detail={tx.paymentMethodDetail} />
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePrint(tx.id)}
                      className="receipt-btn receipt-btn-print"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 9 6 2 18 2 18 9" />
                        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                        <rect x="6" y="14" width="12" height="8" />
                      </svg>
                      Print
                    </button>
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded bg-mint/10 text-mint">
                      APPROVED
                    </span>
                  </div>
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
    </>
  );
}
