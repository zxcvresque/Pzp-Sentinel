"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TourStep {
  /** CSS selector for the target element to spotlight */
  target: string;
  /** Bold heading shown in the tooltip */
  title: string;
  /** Description text */
  body: string;
  /** Preferred tooltip placement relative to target */
  placement?: "top" | "bottom" | "left" | "right";
}

interface SpotlightTourProps {
  steps: TourStep[];
  /** Called when tour completes or is skipped */
  onFinish: () => void;
  /** Whether the tour is currently active */
  active: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getRect(el: Element): DOMRect {
  return el.getBoundingClientRect();
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SpotlightTour({ steps, onFinish, active }: SpotlightTourProps) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const current = steps[step];

  const measure = useCallback(() => {
    if (!current) return;
    const el = document.querySelector(current.target);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      // Small delay for scroll to settle
      requestAnimationFrame(() => {
        setRect(getRect(el));
        setVisible(true);
      });
    } else {
      // Target not found — skip to next
      if (step < steps.length - 1) {
        setStep((s) => s + 1);
      } else {
        onFinish();
      }
    }
  }, [current, step, steps.length, onFinish]);

  useEffect(() => {
    if (!active) {
      setStep(0);
      setVisible(false);
      return;
    }
    setVisible(false);
    const timer = setTimeout(measure, 300);
    return () => clearTimeout(timer);
  }, [active, step, measure]);

  // Re-measure on resize
  useEffect(() => {
    if (!active) return;
    const handleResize = () => measure();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [active, measure]);

  // Keyboard navigation
  useEffect(() => {
    if (!active) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onFinish();
      if (e.key === "ArrowRight" || e.key === "Enter") {
        if (step < steps.length - 1) setStep((s) => s + 1);
        else onFinish();
      }
      if (e.key === "ArrowLeft" && step > 0) setStep((s) => s - 1);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, step, steps.length, onFinish]);

  if (!active || !visible || !rect) return null;

  const pad = 8; // padding around the spotlight
  const spotX = rect.left - pad;
  const spotY = rect.top - pad;
  const spotW = rect.width + pad * 2;
  const spotH = rect.height + pad * 2;

  // Tooltip positioning
  const placement = current.placement || "bottom";
  const tooltipStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 10002,
    maxWidth: 340,
    width: "max-content",
  };

  const gap = 14;
  if (placement === "bottom") {
    tooltipStyle.top = rect.bottom + gap;
    tooltipStyle.left = clamp(rect.left + rect.width / 2 - 170, 16, window.innerWidth - 356);
  } else if (placement === "top") {
    tooltipStyle.bottom = window.innerHeight - rect.top + gap;
    tooltipStyle.left = clamp(rect.left + rect.width / 2 - 170, 16, window.innerWidth - 356);
  } else if (placement === "right") {
    tooltipStyle.top = clamp(rect.top + rect.height / 2 - 60, 16, window.innerHeight - 200);
    tooltipStyle.left = rect.right + gap;
  } else {
    tooltipStyle.top = clamp(rect.top + rect.height / 2 - 60, 16, window.innerHeight - 200);
    tooltipStyle.right = window.innerWidth - rect.left + gap;
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 10000 }}>
      {/* Overlay with spotlight cutout */}
      <svg
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 10000 }}
        onClick={onFinish}
      >
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={spotX}
              y={spotY}
              width={spotW}
              height={spotH}
              rx={12}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.7)"
          mask="url(#spotlight-mask)"
          style={{ transition: "all 300ms ease" }}
        />
        {/* Spotlight border glow */}
        <rect
          x={spotX}
          y={spotY}
          width={spotW}
          height={spotH}
          rx={12}
          fill="none"
          stroke="var(--lime)"
          strokeWidth="1.5"
          opacity="0.5"
          style={{ transition: "all 300ms ease" }}
        />
      </svg>

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        style={{
          ...tooltipStyle,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "20px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
          animation: "tourFadeIn 200ms ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Step counter */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--lime)",
              fontWeight: 600,
            }}
          >
            Step {step + 1} of {steps.length}
          </span>
          {/* Progress dots */}
          <div style={{ display: "flex", gap: 3, marginLeft: "auto" }}>
            {steps.map((_, i) => (
              <div
                key={i}
                style={{
                  width: i === step ? 16 : 5,
                  height: 5,
                  borderRadius: 3,
                  background: i === step ? "var(--lime)" : i < step ? "var(--lime)" : "var(--bg-hover)",
                  opacity: i <= step ? 1 : 0.4,
                  transition: "all 200ms ease",
                }}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <h3
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "var(--text-primary)",
            marginBottom: 6,
            lineHeight: 1.3,
          }}
        >
          {current.title}
        </h3>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.55,
            marginBottom: 18,
          }}
        >
          {current.body}
        </p>

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 150ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--border-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              Back
            </button>
          )}
          <button
            onClick={() => {
              if (step < steps.length - 1) setStep((s) => s + 1);
              else onFinish();
            }}
            style={{
              padding: "7px 18px",
              borderRadius: 8,
              border: "none",
              background: "var(--lime)",
              color: "var(--bg-void)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "opacity 150ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            {step < steps.length - 1 ? "Next" : "Got it!"}
          </button>
          <button
            onClick={onFinish}
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: "var(--text-tertiary)",
              fontSize: 11,
              cursor: "pointer",
              marginLeft: "auto",
              transition: "color 150ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
          >
            Skip tour
          </button>
        </div>
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes tourFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
