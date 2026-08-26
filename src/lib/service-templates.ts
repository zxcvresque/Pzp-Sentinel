export interface ServiceTemplate {
  id: string;
  label: string;
  category: string;
  name: string;
  frequency: "MONTHLY" | "YEARLY";
  credentialLabels: string[];
  metadata: Array<{ key: string; label: string; type: string }>;
}

export { serviceReminderRepeat } from "./service-billing";

export const SERVICE_TEMPLATES: ServiceTemplate[] = [
  {
    id: "SAAS_API",
    label: "SaaS / API subscription",
    category: "Software & APIs",
    name: "SaaS subscription",
    frequency: "MONTHLY",
    credentialLabels: ["Account email", "API key or access token"],
    metadata: [
      { key: "provider", label: "Provider", type: "text" },
      { key: "plan", label: "Product / plan", type: "text" },
      { key: "workspace", label: "Workspace / account", type: "text" },
      { key: "usageLimit", label: "Usage limit", type: "text" },
    ],
  },
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
    label: "Cloud hosting / VPS plan",
    category: "Infrastructure",
    name: "VPS",
    frequency: "MONTHLY",
    credentialLabels: ["Host/IP", "Username", "Password or SSH key"],
    metadata: [
      { key: "provider", label: "Provider", type: "text" },
      { key: "region", label: "Region", type: "text" },
      { key: "allowance", label: "CPU / RAM / storage allowance", type: "text" },
    ],
  },
  {
    id: "DATABASE_STORAGE",
    label: "Database / storage",
    category: "Infrastructure",
    name: "Database or storage",
    frequency: "MONTHLY",
    credentialLabels: ["Dashboard login", "Connection string / API key"],
    metadata: [
      { key: "provider", label: "Provider", type: "text" },
      { key: "project", label: "Project / database", type: "text" },
      { key: "region", label: "Region", type: "text" },
      { key: "usageLimit", label: "Storage / usage limit", type: "text" },
    ],
  },
  {
    id: "SOFTWARE_LICENCE",
    label: "Software licence",
    category: "Software & APIs",
    name: "Software licence",
    frequency: "YEARLY",
    credentialLabels: ["Account login", "Licence key"],
    metadata: [
      { key: "product", label: "Product", type: "text" },
      { key: "tier", label: "Licence tier", type: "text" },
      { key: "seats", label: "Seat count", type: "number" },
      { key: "assignedUsers", label: "Assigned users", type: "text" },
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
