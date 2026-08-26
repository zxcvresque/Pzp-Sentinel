export type NotificationDestination = {
  type: string;
  roles: string[];
  entityId?: string | null;
  title?: string | null;
};

export function notificationDestination(notification: NotificationDestination): string | null {
  const isAdmin = notification.roles.includes("ADMIN");
  switch (notification.type) {
    case "TX_PENDING":
    case "TX_APPROVED":
    case "TX_REJECTED":
      return isAdmin
        ? notification.entityId
          ? `/admin/transactions?transactionId=${encodeURIComponent(notification.entityId)}`
          : "/admin/transactions"
        : "/donor";
    case "TASK_ASSIGNED":
      return "/dev/tasks";
    case "CREDENTIAL_ASSIGNED":
      if (notification.entityId?.startsWith("openrouter:") || notification.title?.toLowerCase().includes("openrouter")) {
        const keyId = notification.entityId?.replace(/^openrouter:/, "") || "";
        return keyId
          ? `/dev/openrouter?keyId=${encodeURIComponent(keyId)}&shared=${encodeURIComponent(`openrouter-key:${keyId}`)}#shared-${encodeURIComponent(keyId)}`
          : "/dev/openrouter";
      }
      return isAdmin ? "/admin/credentials" : "/dev/credentials";
    case "CREDENTIAL_REVIEWED":
      return isAdmin ? "/admin/credentials" : "/dev/credentials";
    case "USER_REGISTERED":
      return "/admin/users";
    case "ROLE_ASSIGNED":
      return "/profile";
    case "VPS_ALERT_SETTINGS":
    case "VPS_ALERT":
      return isAdmin ? "/admin/vps" : "/dev/vps";
    default:
      return null;
  }
}
