import { prisma } from "./db";

export type ProjectAccessRole = "ADMIN" | "LEAD" | "MEMBER" | "VIEWER";

export async function projectAccessFor(user: { id: string; roles: readonly string[] }, projectId: string): Promise<ProjectAccessRole | null> {
  if (user.roles.includes("ADMIN")) return "ADMIN";
  if (!user.roles.includes("DEV")) return null;

  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
    select: { role: true },
  });
  if (membership) return membership.role;

  // Compatibility for projects created before explicit membership roles.
  const legacy = await prisma.project.findFirst({
    where: { id: projectId, members: { some: { id: user.id } } },
    select: { id: true },
  });
  return legacy ? "MEMBER" : null;
}

export function canManageProject(role: ProjectAccessRole | null) {
  return role === "ADMIN" || role === "LEAD";
}

export function canWriteProject(role: ProjectAccessRole | null) {
  return role === "ADMIN" || role === "LEAD" || role === "MEMBER";
}
