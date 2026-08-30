export const DEFAULT_ACCENT_COLOR = "#6FD1D7";
export const DEFAULT_SUBTEXT_COLOR = "#AEB4BF";

export const SUBTEXT_COLOR_PRESETS = [
  { name: "Balanced", color: DEFAULT_SUBTEXT_COLOR },
  { name: "Soft white", color: "#D7D9DE" },
  { name: "Cyan mist", color: "#A9DDE1" },
  { name: "Lavender", color: "#C8B9EA" },
  { name: "Sage", color: "#AFD8C2" },
  { name: "Warm sand", color: "#D8C5A7" },
] as const;

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(foreground: string, background = "#1F1F28"): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function isReadableSubtextColor(hex: string): boolean {
  return isHexColor(hex) && contrastRatio(hex) >= 4.5;
}

export function applyAccentColor(hex: string): void {
  if (!isHexColor(hex)) return;
  const [r, g, b] = hexToRgb(hex);
  document.documentElement.style.setProperty("--lime", hex);
  document.documentElement.style.setProperty("--lime-dim", `rgba(${r}, ${g}, ${b}, 0.08)`);
  document.documentElement.style.setProperty("--lime-glow", `rgba(${r}, ${g}, ${b}, 0.12)`);
  document.documentElement.style.setProperty("--border-active", `rgba(${r}, ${g}, ${b}, 0.3)`);
}

export function applySubtextColor(hex: string): void {
  if (!isReadableSubtextColor(hex)) return;
  document.documentElement.style.setProperty("--text-secondary", hex);
  document.documentElement.style.setProperty(
    "--text-tertiary",
    `color-mix(in srgb, ${hex} 76%, transparent)`,
  );
}
