"use client";

import { useEffect, useState } from "react";

interface Service {
  id: string;
  category: string;
  name: string;
  columns: string[] | null;
  entries: Record<string, string>[] | null;
}

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/services")
      .then((r) => r.json())
      .then((data) => setServices(data.services || []))
      .finally(() => setLoading(false));
  }, []);

  const grouped = services.reduce<Record<string, Service[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

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
        Service <span className="font-display text-lime">Catalog</span>
      </h1>

      {services.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No services catalogued yet.</p>
          <p className="text-text-tertiary text-sm">Add services via the API to track what the community uses.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-3">
                {category}
              </h2>
              <div className="space-y-3">
                {items.map((svc) => (
                  <div key={svc.id} className="card p-5">
                    <div className="text-sm font-semibold mb-3">{svc.name}</div>
                    {svc.columns && svc.entries && svc.entries.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--border)]">
                              {svc.columns.map((col) => (
                                <th key={col} className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {svc.entries.map((entry, i) => (
                              <tr key={i} className="border-b border-[var(--border)] last:border-0">
                                {svc.columns!.map((col) => (
                                  <td key={col} className="px-3 py-2 text-text-secondary">
                                    {entry[col] || "—"}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
