import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";
import type { Role } from "@/generated/prisma/enums";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface JwtPayload {
  userId: string;
  roles: Role[];
  exp?: number;
}

export async function signToken(
  payload: JwtPayload,
  // string ("24h") resolves relative to now; number is an absolute UNIX-seconds
  // expiry — used to re-mint a token while preserving its original expiry.
  expiration: string | number = "24h",
): Promise<string> {
  const { exp: _exp, ...claims } = payload;
  return new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiration)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user || user.status !== "ACTIVE") return null;
  return user;
}

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function hasRole(userRoles: Role[], required: Role): boolean {
  return userRoles.includes(required);
}

export function highestRole(roles: Role[]): Role {
  if (roles.includes("ADMIN")) return "ADMIN";
  if (roles.includes("DEV")) return "DEV";
  return "DONOR";
}
