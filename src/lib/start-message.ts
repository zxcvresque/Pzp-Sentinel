import { escapeTelegramHtml } from "./telegram-format";

export function startMessage(user: { name: string; roles: readonly string[]; status?: string }) {
  const name = escapeTelegramHtml(user.name);
  if (user.status === "INACTIVE") {
    return {
      text: `<blockquote><b>Account deactivated</b></blockquote>\nHey ${name}. Contact an admin to restore your access.`,
      route: null, button: null,
    };
  }
  const roles = ["ADMIN", "DEV", "DONOR"].filter(role => user.roles.includes(role));
  if (!roles.length) {
    return {
      text: `<blockquote><b>Welcome to Sentinel</b></blockquote>\nHey ${name}!\n\nAccess is for registered members. You're not registered yet; an admin will review and assign your access shortly.`,
      route: null, button: null,
    };
  }
  const descriptions: Record<string, string> = {
    ADMIN: "🛡️ <b>Admin</b>\nManage the treasury, approve payments and access, and oversee community operations.",
    DEV: "⚡ <b>Developer</b>\nView your projects and tasks, follow GitHub activity, and access your assigned tools and servers.",
    DONOR: "💚 <b>Donor</b>\nSupport the community, view your donation history, and manage your payments and reminders.",
  };
  const primary = roles[0];
  return {
    text: `<blockquote><b>Welcome back, ${name}!</b></blockquote>\n${roles.map(role => descriptions[role]).join("\n\n")}`,
    route: primary === "ADMIN" ? "/admin" : primary === "DEV" ? "/dev" : "/donor",
    button: primary === "ADMIN" ? "Open admin dashboard" : primary === "DEV" ? "Open developer workspace" : "Open donor dashboard",
  };
}
