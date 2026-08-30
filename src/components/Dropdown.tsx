"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

export interface DropdownOption {
  value: string;
  label: string;
  color?: string; // optional accent dot
  avatar?: string | null; // optional profile photo URL
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  onClick?: (e: React.MouseEvent) => void;
  id?: string;
  ariaLabel?: string;
}

export default function Dropdown({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = "",
  size = "md",
  onClick,
  id,
  ariaLabel,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; direction: "down" | "up" }>({
    top: 0,
    left: 0,
    width: 0,
    direction: "down",
  });

  const selected = options.find((o) => o.value === value);

  // Position the menu when opened
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = 240; // max-h-56 = 224px + padding
    const spaceBelow = window.innerHeight - rect.bottom;
    const goUp = spaceBelow < menuHeight && rect.top > spaceBelow;

    setMenuPos({
      top: goUp ? rect.top : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      direction: goUp ? "up" : "down",
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    // Close on outside click
    function handleOutside(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }

    // Close on scroll / resize to avoid stale positioning
    function handleReposition() {
      updatePosition();
    }

    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [open, updatePosition]);

  const pad = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2.5 text-sm";
  const optPad = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm";

  return (
    <div className={`relative ${className}`}>
      <button
        id={id}
        aria-label={ariaLabel}
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          onClick?.(e);
          setOpen(!open);
        }}
        className={`w-full flex items-center justify-between gap-2 bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg ${pad} text-left transition-colors duration-150 outline-none focus:border-[var(--border-active)] hover:border-[var(--border-hover)]`}
      >
        <span className="flex items-center gap-2 min-w-0 truncate">
          {selected?.avatar ? (
            <img src={selected.avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
          ) : selected?.avatar === null && selected?.label ? (
            <span className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
              {selected.label.charAt(0).toUpperCase()}
            </span>
          ) : selected?.color ? (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: selected.color }}
            />
          ) : null}
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

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] rounded-xl border border-[var(--border)] shadow-lg overflow-hidden animate-scale-in"
            style={{
              background: "var(--bg-card)",
              top: menuPos.direction === "up" ? undefined : menuPos.top,
              bottom: menuPos.direction === "up" ? window.innerHeight - menuPos.top + 6 : undefined,
              left: menuPos.left,
              width: menuPos.width,
              minWidth: 120,
            }}
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
                    {opt.avatar ? (
                      <img src={opt.avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
                    ) : opt.avatar === null && opt.label ? (
                      <span className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
                        {opt.label.charAt(0).toUpperCase()}
                      </span>
                    ) : opt.color ? (
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: opt.color }}
                      />
                    ) : null}
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
          </div>,
          document.body,
        )}
    </div>
  );
}
