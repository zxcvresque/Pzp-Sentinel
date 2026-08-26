export interface ServiceEditColumn {
  key: string;
  label: string;
  type?: string;
}

export interface EditableLinkedService {
  id: string;
  name: string;
  category: string;
  frequency?: string | null;
  customRepeatEvery?: number | null;
  customRepeatUnit?: string | null;
  planUrl?: string | null;
  expiryDate?: string | null;
  autoRenew?: boolean;
  columns?: ServiceEditColumn[] | null;
  entries?: Record<string, string>[] | null;
  credentials?: Array<{ id: string; platform: string; label: string; expiresAt?: string | null }>;
}

export function linkedServiceEditFields(service: EditableLinkedService) {
  const serviceColumns = Array.isArray(service.columns) ? service.columns : [];
  const firstEntry = Array.isArray(service.entries) && service.entries[0] ? service.entries[0] : {};
  return {
    serviceId: service.id,
    serviceName: service.name,
    serviceCategory: service.category,
    serviceFrequency: service.frequency || "MONTHLY",
    serviceRenewal: service.expiryDate?.slice(0, 10) || "",
    serviceCustomRepeatEvery: String(service.customRepeatEvery || 1),
    serviceCustomRepeatUnit: service.customRepeatUnit || "MONTH",
    servicePlanUrl: service.planUrl || "",
    serviceAutoRenew: Boolean(service.autoRenew),
    serviceColumns,
    serviceMetadata: Object.fromEntries(serviceColumns.map((column) => [column.key, firstEntry[column.key] || ""])),
    credentials: (service.credentials || []).map((credential) => ({
      id: credential.id,
      platform: credential.platform,
      label: credential.label,
      value: "",
      expiresAt: credential.expiresAt?.slice(0, 10) || "",
    })),
  };
}
