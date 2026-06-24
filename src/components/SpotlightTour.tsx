"use client";

import { useState, useEffect, useCallback, useLayoutEffect, useRef } from "react";
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
  if (max < min) return min;
  return Math.max(min, Math.min(max, val));
}

function getViewportSize() {
  const vv = window.visualViewport;
  return {
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SpotlightTour({ steps, onFinish, active }: SpotlightTourProps) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);
  const [tooltipSize, setTooltipSize] = useState({ width: 0, height: 0 });
  const [measureTick, setMeasureTick] = useState(0);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const targetRetryRef = useRef(0);
  const targetRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = steps[step];

  const finishTour = useCallback(() => {
    if (targetRetryTimerRef.current) clearTimeout(targetRetryTimerRef.current);
    targetRetryRef.current = 0;
    setStep(0);
    setVisible(false);
    setTooltipSize({ width: 0, height: 0 });
    onFinish();
  }, [onFinish]);

  const skip = useCallback(() => {
    if (targetRetryTimerRef.current) clearTimeout(targetRetryTimerRef.current);
    targetRetryRef.current = 0;
    setVisible(false);
    setTooltipSize({ width: 0, height: 0 });
    if (step < steps.length - 1) setStep((s) => s + 1);
    else finishTour();
  }, [step, steps.length, finishTour]);

  const measure = useCallback(() => {
    if (!current) return;
    // querySelectorAll so we can pick the first *visible* match —
    // e.g. desktop sidebar is display:none on mobile (zero-size) so we
    // fall through to the mobile More button that shares the same data-tour.
    const candidates = Array.from(document.querySelectorAll(current.target)) as Element[];
    const el = candidates.find((e) => {
      const r = getRect(e);
      return r.width > 0 && r.height > 0;
    }) ?? null;
    if (el) {
      targetRetryRef.current = 0;
      const r = getRect(el);
      // Final guard: element must be inside the viewport bounds
      if (r.width === 0 && r.height === 0) {
        skip();
        return;
      }
      // Use instant scroll so the element is at its final position immediately,
      // then double-rAF to let the browser commit layout before measuring.
      const isMobile = window.innerWidth < 768;
      el.scrollIntoView({
        behavior: "instant" as ScrollBehavior,
        block: isMobile ? "center" : "nearest",
        inline: "nearest",
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setRect(getRect(el));
          setVisible(true);
        });
      });
    } else {
      // Async pages often render tour targets after the page shell. Retry briefly
      // so loading content does not make a whole tour disappear.
      if (targetRetryRef.current < 12) {
        targetRetryRef.current += 1;
        if (targetRetryTimerRef.current) clearTimeout(targetRetryTimerRef.current);
        targetRetryTimerRef.current = setTimeout(() => {
          setMeasureTick((tick) => tick + 1);
        }, 200);
        return;
      }

      // Target still not found — skip to next
      targetRetryRef.current = 0;
      skip();
    }
  }, [current, skip]);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(measure, 300);
    return () => {
      clearTimeout(timer);
      if (targetRetryTimerRef.current) clearTimeout(targetRetryTimerRef.current);
    };
  }, [active, step, measure, measureTick]);

  // Re-measure on resize and viewport changes
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const handleViewportChange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, [active, measure]);

  // Keyboard navigation
  useEffect(() => {
    if (!active) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") finishTour();
      if (e.key === "ArrowRight" || e.key === "Enter") {
        if (step < steps.length - 1) {
          targetRetryRef.current = 0;
          setVisible(false);
          setTooltipSize({ width: 0, height: 0 });
          setStep((s) => s + 1);
        } else {
          finishTour();
        }
      }
      if (e.key === "ArrowLeft" && step > 0) {
        targetRetryRef.current = 0;
        setVisible(false);
        setTooltipSize({ width: 0, height: 0 });
        setStep((s) => s - 1);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, step, steps.length, finishTour]);

  useLayoutEffect(() => {
    if (!active || !visible || !rect || !tooltipRef.current) return;
    const next = tooltipRef.current.getBoundingClientRect();
    setTooltipSize((prev) => {
      if (
        Math.abs(prev.width - next.width) < 1 &&
        Math.abs(prev.height - next.height) < 1
      ) {
        return prev;
      }
      return { width: next.width, height: next.height };
    });
  }, [active, visible, rect, step, current?.title, current?.body]);

  if (!active || !visible || !rect) return null;

  const pad = 8; // padding around the spotlight
  const spotX = rect.left - pad;
  const spotY = rect.top - pad;
  const spotW = rect.width + pad * 2;
  const spotH = rect.height + pad * 2;

  // Tooltip positioning
  const placement = current.placement || "bottom";
  const { width: vw, height: vh } = getViewportSize();
  const isMobile = vw < 768;
  const edge = isMobile ? 12 : 16;
  const gap = isMobile ? 10 : 14;
  const mobileBottomReserve = isMobile ? 76 : 16;
  const topLimit = edge;
  const bottomLimit = Math.max(topLimit + 160, vh - mobileBottomReserve);
  const availableHeight = Math.max(160, bottomLimit - topLimit);
  const tooltipW = Math.max(220, Math.min(340, vw - edge * 2));
  const measuredH = tooltipSize.height || (isMobile ? 190 : 176);
  const tooltipH = Math.min(measuredH, availableHeight);
  const maxLeft = Math.max(edge, vw - edge - tooltipW);

  const centeredLeft = clamp(rect.left + rect.width / 2 - tooltipW / 2, edge, maxLeft);
  const centeredTop = clamp(rect.top + rect.height / 2 - tooltipH / 2, topLimit, bottomLimit - tooltipH);
  const space = {
    bottom: bottomLimit - rect.bottom - gap,
    top: rect.top - topLimit - gap,
    right: vw - edge - rect.right - gap,
    left: rect.left - edge - gap,
  };
  const positions: Record<NonNullable<TourStep["placement"]>, React.CSSProperties> = {
    bottom: {
      top: clamp(rect.bottom + gap, topLimit, bottomLimit - tooltipH),
      left: centeredLeft,
    },
    top: {
      top: clamp(rect.top - gap - tooltipH, topLimit, bottomLimit - tooltipH),
      left: centeredLeft,
    },
    right: {
      top: centeredTop,
      left: clamp(rect.right + gap, edge, maxLeft),
    },
    left: {
      top: centeredTop,
      left: clamp(rect.left - gap - tooltipW, edge, maxLeft),
    },
  };

  const fits = {
    bottom: space.bottom >= tooltipH,
    top: space.top >= tooltipH,
    right: space.right >= tooltipW,
    left: space.left >= tooltipW,
  };

  const fallbackOrder: NonNullable<TourStep["placement"]>[] =
    placement === "top" || placement === "bottom"
      ? [placement, placement === "top" ? "bottom" : "top", "right", "left"]
      : [placement, placement === "left" ? "right" : "left", "bottom", "top"];
  const bestFallback = isMobile
    ? space.bottom >= space.top
      ? "bottom"
      : "top"
    : (Object.entries(space).sort(([, a], [, b]) => b - a)[0]?.[0] as NonNullable<TourStep["placement"]> | undefined) ?? placement;
  const resolvedPlacement = fallbackOrder.find((p) => fits[p]) ?? bestFallback;
  const tooltipStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 10002,
    width: tooltipW,
    maxWidth: `calc(100vw - ${edge * 2}px)`,
    maxHeight: availableHeight,
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    ...positions[resolvedPlacement],
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 10000 }}>
      {/* Overlay with spotlight cutout */}
      <svg
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 10000 }}
        viewBox={`0 0 ${vw} ${vh}`}
        preserveAspectRatio="none"
        onClick={finishTour}
      >
        <defs>
          <mask id="sentinel-spotlight-mask">
            <rect width={vw} height={vh} fill="white" />
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
          width={vw}
          height={vh}
          fill="rgba(0,0,0,0.7)"
          mask="url(#sentinel-spotlight-mask)"
          style={{ transition: "all 300ms ease" }}
        />
        {/* Spotlight border glow — rendered outside the mask so it's always visible */}
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
              onClick={() => {
                targetRetryRef.current = 0;
                setVisible(false);
                setTooltipSize({ width: 0, height: 0 });
                setStep((s) => s - 1);
              }}
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
              if (step < steps.length - 1) {
                targetRetryRef.current = 0;
                setVisible(false);
                setTooltipSize({ width: 0, height: 0 });
                setStep((s) => s + 1);
              } else {
                finishTour();
              }
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
            onClick={finishTour}
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
