import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

export function requestIp(request: Request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

export function privateIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function consumeRateLimit(params: {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
}) {
  const now = Date.now();
  const windowStart = Math.floor(now / params.windowMs) * params.windowMs;
  const key = `${params.scope}:${privateIdentifier(params.identifier)}:${windowStart}`;
  const expiresAt = new Date(windowStart + params.windowMs);
  const bucket = await prisma.rateLimitBucket.upsert({
    where: { key },
    create: { key, count: 1, expiresAt },
    update: { count: { increment: 1 } },
    select: { count: true, expiresAt: true },
  });

  return {
    allowed: bucket.count <= params.limit,
    remaining: Math.max(0, params.limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt.getTime() - now) / 1000)),
  };
}
