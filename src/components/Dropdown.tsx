"use client";

import { useState, useRef, useEffect } from "react";

export interface DropdownOption {
  value: string;
  label: string;
  color?: string; // optional accent dot
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  onClick?: (e: React.MouseEvent) => void;
}

export default function Dropdown({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = "",
  size = "md",
  onClick,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const pad = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2.5 text-sm";
  const optPad = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          onClick?.(e);
          setOpen(!open);
        }}
        className={`w-full flex items-center justify-between gap-2 bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg ${pad} text-left transition-colors duration-150 outline-none focus:border-[var(--border-active)] hover:border-[var(--border-hover)]`}
      >
        <span className="flex items-center gap-2 min-w-0 truncate">
          {selected?.color && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: selected.color }}
            />
          )}
          <span className={selected ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}>
            {selected?.label || placeholder}
          </span>
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className={`shrink-0 text-[var(--text-tertiary)] transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1.5 w-full rounded-xl border border-[var(--border)] shadow-lg overflow-hidden animate-scale-in"
          style={{ background: "var(--bg-card)" }}
        >
          <div className="max-h-56 overflow-y-auto py-1">
            {options.map((opt) => {
              const isActive = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 ${optPad} text-left transition-colors duration-100`}
                  style={{
                    background: isActive ? "var(--bg-elevated)" : "transparent",
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    fontWeight: isActive ? 500 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  {opt.color && (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: opt.color }}
                    />
                  )}
                  <span className="truncate">{opt.label}</span>
                  {isActive && (
                    <svg width="14" height="14" viewBox="0 0 14 14" className="ml-auto shrink-0 text-[var(--lime)]">
                      <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
