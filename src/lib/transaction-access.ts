export function resolveTransactionAccess(
  roles: readonly string[],
  requestedScope: unknown,
) {
  const isAdmin = roles.includes("ADMIN");
  const isDonor = roles.includes("DONOR");
  const requestedSelfScope = requestedScope === "mine";
  const allowed = (isAdmin || isDonor) && (!requestedSelfScope || isDonor);
  const selfScoped = allowed && (requestedSelfScope || !isAdmin);

  return {
    allowed,
    isAdmin,
    isDonor,
    selfScoped,
    adminLedger: allowed && isAdmin && !selfScoped,
  };
}
