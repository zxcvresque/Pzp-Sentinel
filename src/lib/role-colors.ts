/**
 * Universal role color map — single source of truth for ADMIN / DONOR / DEV styling.
 * Import this wherever you need role-based colors (badges, toggles, switchers, etc.)
 */

export const ROLE_COLORS: Record<
  string,
  { text: string; bg: string; bgSolid: string; border: string; rgb: string }
> = {
  ADMIN: {
    text: "var(--violet)",          // #a78bfa
    bg: "rgba(167,139,250,0.12)",
    bgSolid: "var(--violet)",
    border: "rgba(167,139,250,0.30)",
    rgb: "167,139,250",
  },
  DONOR: {
    text: "var(--amber)",           // #fbbf24
    bg: "rgba(251,191,36,0.12)",
    bgSolid: "var(--amber)",
    border: "rgba(251,191,36,0.30)",
    rgb: "251,191,36",
  },
  DEV: {
    text: "var(--cyan)",            // #38bdf8
    bg: "rgba(56,189,248,0.12)",
    bgSolid: "var(--cyan)",
    border: "rgba(56,189,248,0.30)",
    rgb: "56,189,248",
  },
};

export const ROLE_FALLBACK = {
  text: "var(--text-secondary)",
  bg: "rgba(228,228,232,0.08)",
  bgSolid: "var(--text-secondary)",
  border: "rgba(228,228,232,0.15)",
  rgb: "228,228,232",
};

export function getRoleColor(role: string) {
  return ROLE_COLORS[role.toUpperCase()] ?? ROLE_FALLBACK;
}
