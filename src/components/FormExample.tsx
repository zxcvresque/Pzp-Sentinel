"use client";

import { useFormExamples } from "@/hooks/useFormExamples";

interface FormExampleProps {
  /** Lines of example text to display */
  lines: string[];
}

/**
 * FormExample — shows contextual example hints in forms.
 * Globally hidden once dismissed. Re-enable from profile settings.
 */
export default function FormExample({ lines }: FormExampleProps) {
  const { showExamples, hideExamples } = useFormExamples();

  if (!showExamples) return null;

  return (
    <div
      className="rounded-lg px-4 py-3 mb-4 text-xs leading-relaxed"
      style={{
        background: "color-mix(in srgb, var(--violet) 6%, transparent)",
        border: "1px solid color-mix(in srgb, var(--violet) 15%, transparent)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--violet)] mb-1.5 font-semibold">
            Example
          </div>
          {lines.map((line, i) => (
            <div key={i} className="text-[var(--text-secondary)]">
              {line}
            </div>
          ))}
        </div>
        <button
          onClick={hideExamples}
          className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors whitespace-nowrap flex-shrink-0 mt-0.5"
        >
          Hide examples
        </button>
      </div>
    </div>
  );
}
