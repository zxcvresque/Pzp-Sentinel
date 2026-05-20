"use client";

import { useRef, useState, useCallback, useEffect } from "react";

/* ---------- colour helpers ---------- */

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return h;
}

/* ---------- component ---------- */

interface ThemeColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

export default function ThemeColorPicker({
  value,
  onChange,
}: ThemeColorPickerProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [localColor, setLocalColor] = useState(value);

  // Sync from parent when value prop changes externally
  useEffect(() => {
    if (!dragging.current) setLocalColor(value);
  }, [value]);

  const isWhite =
    localColor.toLowerCase() === "#6FD1D7" ||
    localColor.toLowerCase() === "#fff";

  const hue = hexToHue(localColor);

  const fireChange = useCallback(
    (hex: string) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        onChange(hex);
      }, 300);
    },
    [onChange],
  );

  function pickFromEvent(
    e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent,
  ) {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const clientX =
      "touches" in e
        ? (e as TouchEvent).touches[0].clientX
        : (e as MouseEvent).clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const h = Math.round(ratio * 360);
    const hex = hslToHex(h, 1, 0.5);
    setLocalColor(hex);
    fireChange(hex);
  }

  function handlePointerDown(e: React.MouseEvent | React.TouchEvent) {
    dragging.current = true;
    pickFromEvent(e);

    const onMove = (ev: MouseEvent | TouchEvent) => pickFromEvent(ev);
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
  }

  function handleReset() {
    const white = "#6FD1D7";
    setLocalColor(white);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    onChange(white);
  }

  // Indicator position: for white / greys fall back to far-left
  const indicatorPct = isWhite ? 0 : (hue / 360) * 100;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
      }}
    >
      {/* Colour swatch */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: localColor,
          border: "2px solid var(--border)",
          flexShrink: 0,
        }}
      />

      {/* Hue bar */}
      <div
        ref={barRef}
        onMouseDown={handlePointerDown}
        onTouchStart={handlePointerDown}
        role="slider"
        aria-label="Pick accent colour"
        aria-valuenow={hue}
        aria-valuemin={0}
        aria-valuemax={360}
        tabIndex={0}
        style={{
          position: "relative",
          flex: 1,
          height: 20,
          borderRadius: 10,
          background:
            "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
          cursor: "crosshair",
          border: "1px solid var(--border)",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        {/* Indicator thumb */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: `${indicatorPct}%`,
            transform: "translate(-50%, -50%)",
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: localColor,
            border: "2px solid #fff",
            boxShadow: "0 0 4px rgba(0,0,0,0.5)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Reset button */}
      <button
        onClick={handleReset}
        title="Reset to white"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
          color: "var(--text-secondary)",
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
        }}
      >
        {/* Simple reset icon (unicode) */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </button>
    </div>
  );
}
