export type NotificationDestination = {
  type: string;
  roles: string[];
};

export function notificationDestination(notification: NotificationDestination): string | null {
  const isAdmin = notification.roles.includes("ADMIN");
  switch (notification.type) {
    case "TX_PENDING":
    case "TX_APPROVED":
    case "TX_REJECTED":
      return isAdmin ? "/admin/transactions" : "/donor";
    case "TASK_ASSIGNED":
      return "/dev/tasks";
    case "CREDENTIAL_ASSIGNED":
    case "CREDENTIAL_REVIEWED":
      return isAdmin ? "/admin/credentials" : "/dev/credentials";
    case "USER_REGISTERED":
      return "/admin/users";
    case "ROLE_ASSIGNED":
      return "/profile";
    default:
      return null;
  }
}
