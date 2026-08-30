import { isIP } from "node:net";

const HOST_LABEL = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;
const SSH_USERNAME = /^[a-z_][a-z0-9_-]{0,31}$/i;

export function isValidVpsHost(value: string) {
  if (isIP(value)) return true;
  if (!value || value.length > 253 || value.endsWith(".")) return false;
  return value.split(".").every((label) => HOST_LABEL.test(label));
}

export function isValidSshUsername(value: string) {
  return SSH_USERNAME.test(value);
}

export function parseSshPort(value: unknown) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}
