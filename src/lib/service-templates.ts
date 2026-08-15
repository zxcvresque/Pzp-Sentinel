export interface ServiceTemplate {
  id: string;
  label: string;
  category: string;
  name: string;
  frequency: "MONTHLY" | "YEARLY";
  credentialLabels: string[];
  metadata: Array<{ key: string; label: string; type: string }>;
}

export const SERVICE_TEMPLATES: ServiceTemplate[] = [
  {
    id: "SUPABASE",
    label: "Supabase",
    category: "Infrastructure",
    name: "Supabase",
    frequency: "MONTHLY",
    credentialLabels: ["Project URL", "Service role key", "Database password"],
    metadata: [
      { key: "projectRef", label: "Project reference", type: "text" },
      { key: "region", label: "Region", type: "text" },
    ],
  },
  {
    id: "VPS",
    label: "VPS / server",
    category: "Infrastructure",
    name: "VPS",
    frequency: "MONTHLY",
    credentialLabels: ["Host/IP", "Username", "Password or SSH key"],
    metadata: [
      { key: "provider", label: "Provider", type: "text" },
      { key: "region", label: "Region", type: "text" },
    ],
  },
  {
    id: "DOMAIN",
    label: "Domain",
    category: "Domains",
    name: "Domain registration",
    frequency: "YEARLY",
    credentialLabels: ["Registrar login", "Transfer/EPP code"],
    metadata: [
      { key: "domain", label: "Domain name", type: "text" },
      { key: "registrar", label: "Registrar", type: "text" },
    ],
  },
  {
    id: "GITHUB",
    label: "GitHub",
    category: "Development",
    name: "GitHub",
    frequency: "MONTHLY",
    credentialLabels: ["Account email", "Personal access token"],
    metadata: [
      { key: "organization", label: "Organization", type: "text" },
      { key: "plan", label: "Plan", type: "text" },
    ],
  },
];

export function serviceTemplate(id: unknown) {
  return SERVICE_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function serviceReminderRepeat(frequency: string | null | undefined) {
  if (frequency === "WEEKLY") return { repeatEvery: 1, repeatUnit: "WEEK" as const };
  if (frequency === "MONTHLY") return { repeatEvery: 1, repeatUnit: "MONTH" as const };
  if (frequency === "YEARLY") return { repeatEvery: 12, repeatUnit: "MONTH" as const };
  return null;
}
