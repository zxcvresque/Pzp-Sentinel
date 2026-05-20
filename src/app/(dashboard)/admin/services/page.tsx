"use client";

import { useEffect, useState } from "react";

interface ColumnDef {
  key: string;
  label: string;
  type: string;
}

interface Service {
  id: string;
  category: string;
  name: string;
  columns: ColumnDef[] | null;
  entries: Record<string, string>[] | null;
}

const emptyColumn = (): ColumnDef => ({ key: "", label: "", type: "text" });

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  // form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<ColumnDef[]>([emptyColumn()]);
  const [entries, setEntries] = useState<Record<string, string>[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchServices = () => {
    fetch("/api/services")
      .then((r) => r.json())
      .then((data) => setServices(data.services || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setCategory("");
    setName("");
    setColumns([emptyColumn()]);
    setEntries([]);
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (svc: Service) => {
    setEditingId(svc.id);
    setCategory(svc.category);
    setName(svc.name);
    setColumns(svc.columns && svc.columns.length > 0 ? svc.columns : [emptyColumn()]);
    setEntries(svc.entries || []);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!category.trim() || !name.trim()) return;
    setSaving(true);

    const validColumns = columns.filter((c) => c.key.trim() && c.label.trim());
    const payload = {
      category: category.trim(),
      name: name.trim(),
      columns: validColumns.length > 0 ? validColumns : null,
      entries: entries.length > 0 ? entries : null,
    };

    try {
      if (editingId) {
        const res = await fetch(`/api/services/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to update");
      } else {
        const res = await fetch("/api/services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to create");
      }
      resetForm();
      fetchServices();
    } catch {
      // silently handle — could add toast later
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this service?")) return;
    await fetch(`/api/services/${id}`, { method: "DELETE" });
    fetchServices();
  };

  // column helpers
  const updateColumn = (idx: number, field: keyof ColumnDef, value: string) => {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  };
  const addColumn = () => setColumns((prev) => [...prev, emptyColumn()]);
  const removeColumn = (idx: number) =>
    setColumns((prev) => prev.filter((_, i) => i !== idx));

  // entry helpers
  const addEntry = () => {
    const row: Record<string, string> = {};
    columns.forEach((c) => {
      if (c.key.trim()) row[c.key] = "";
    });
    setEntries((prev) => [...prev, row]);
  };
  const updateEntry = (rowIdx: number, key: string, value: string) => {
    setEntries((prev) =>
      prev.map((e, i) => (i === rowIdx ? { ...e, [key]: value } : e)),
    );
  };
  const removeEntry = (idx: number) =>
    setEntries((prev) => prev.filter((_, i) => i !== idx));

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

  const validColumnsForEntries = columns.filter((c) => c.key.trim() && c.label.trim());

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold">
          Service <span className="font-display text-lime">Catalog</span>
        </h1>
        {!showForm && (
          <button
            onClick={openCreateForm}
            className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90"
          >
            Add Service
          </button>
        )}
      </div>

      {showForm && (
        <div className="card p-6 mb-8">
          <h2 className="text-sm font-semibold mb-4">
            {editingId ? "Edit Service" : "New Service"}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
                Category
              </label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Infrastructure"
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cloud Hosting"
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
          </div>

          {/* Columns */}
          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
              Columns
            </label>
            <div className="space-y-2">
              {columns.map((col, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    value={col.key}
                    onChange={(e) => updateColumn(idx, "key", e.target.value)}
                    placeholder="key"
                    className="flex-1 bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-lime/30"
                  />
                  <input
                    value={col.label}
                    onChange={(e) => updateColumn(idx, "label", e.target.value)}
                    placeholder="label"
                    className="flex-1 bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-lime/30"
                  />
                  <input
                    value={col.type}
                    onChange={(e) => updateColumn(idx, "type", e.target.value)}
                    placeholder="type"
                    className="w-24 bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-lime/30"
                  />
                  {columns.length > 1 && (
                    <button
                      onClick={() => removeColumn(idx)}
                      className="text-xs text-coral hover:text-coral/80"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addColumn}
              className="text-xs text-lime hover:text-lime/80 mt-2"
            >
              + Add column
            </button>
          </div>

          {/* Entries (only when editing or columns are defined) */}
          {validColumnsForEntries.length > 0 && (
            <div className="mb-4">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Entries
              </label>
              {entries.length > 0 && (
                <div className="overflow-x-auto mb-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        {validColumnsForEntries.map((col) => (
                          <th
                            key={col.key}
                            className="text-left px-2 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary"
                          >
                            {col.label}
                          </th>
                        ))}
                        <th className="w-16" />
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry, rowIdx) => (
                        <tr key={rowIdx} className="border-b border-[var(--border)] last:border-0">
                          {validColumnsForEntries.map((col) => (
                            <td key={col.key} className="px-2 py-1.5">
                              <input
                                value={entry[col.key] || ""}
                                onChange={(e) =>
                                  updateEntry(rowIdx, col.key, e.target.value)
                                }
                                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-lime/30"
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1.5">
                            <button
                              onClick={() => removeEntry(rowIdx)}
                              className="text-xs text-coral hover:text-coral/80"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                onClick={addEntry}
                className="text-xs text-lime hover:text-lime/80"
              >
                + Add entry
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSubmit}
              disabled={saving || !category.trim() || !name.trim()}
              className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : editingId ? "Update Service" : "Create Service"}
            </button>
            <button
              onClick={resetForm}
              className="px-5 py-2.5 rounded-full text-sm text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {services.length === 0 && !showForm ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No services catalogued yet.</p>
          <p className="text-text-tertiary text-sm">
            Click &quot;Add Service&quot; above to start tracking what the community uses.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([categoryName, items]) => (
            <div key={categoryName}>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-3">
                {categoryName}
              </h2>
              <div className="space-y-3">
                {items.map((svc) => (
                  <div key={svc.id} className="card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold">{svc.name}</div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditForm(svc)}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-violet/10 text-violet hover:bg-violet/20"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(svc.id)}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-coral/10 text-coral hover:bg-coral/20"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {svc.columns && svc.entries && svc.entries.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--border)]">
                              {svc.columns.map((col) => (
                                <th
                                  key={col.key}
                                  className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary"
                                >
                                  {col.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {svc.entries.map((entry, i) => (
                              <tr
                                key={i}
                                className="border-b border-[var(--border)] last:border-0"
                              >
                                {svc.columns!.map((col) => (
                                  <td
                                    key={col.key}
                                    className="px-3 py-2 text-text-secondary"
                                  >
                                    {entry[col.key] || "—"}
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
