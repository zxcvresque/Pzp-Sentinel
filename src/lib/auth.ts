import { SignJWT, jwtVerify } from "jose";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
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
  const claims: Partial<JwtPayload> = { ...payload };
  delete claims.exp;
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
  return randomInt(100000, 1_000_000).toString();
}

export function hashOtp(telegramId: string, otp: string): string {
  return createHmac("sha256", process.env.JWT_SECRET!)
    .update(`${telegramId}:${otp}`)
    .digest("hex");
}

export function verifyOtpHash(telegramId: string, otp: string, expected: string): boolean {
  const actual = Buffer.from(hashOtp(telegramId, otp), "hex");
  const stored = Buffer.from(expected, "hex");
  return actual.length === stored.length && timingSafeEqual(actual, stored);
}

export function hasRole(userRoles: Role[], required: Role): boolean {
  return userRoles.includes(required);
}

export function highestRole(roles: Role[]): Role {
  if (roles.includes("ADMIN")) return "ADMIN";
  if (roles.includes("DEV")) return "DEV";
  return "DONOR";
}
