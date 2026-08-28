import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import type { Role } from "@/generated/prisma/enums";
import { PRIMARY_SESSION_COOKIE, sessionTokens, TELEGRAM_WEB_SESSION_COOKIE } from "@/lib/session-cookies";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "");

// Public paths — no auth required.
// `/install.sh` and `/agent.sh` are rewritten to /api/vps/{install,agent} in
// next.config, but middleware runs BEFORE rewrites and sees the raw path — so
// they must be allow-listed here or unauthenticated `curl .../install.sh` gets
// redirected to /login (and piped into bash, breaks).
const publicPaths = ["/", "/login", "/plan", "/donate", "/install.sh", "/agent.sh"];

// Public API routes — no JWT needed
const publicApiPaths = ["/api/auth", "/api/bot", "/api/exchange-rate", "/api/bmc/webhook", "/api/payments/razorpay/guest", "/api/webhooks/razorpay", "/api/vps/heartbeat", "/api/vps/install", "/api/vps/agent"];

const roleRoutes: Record<string, Role> = {
  "/admin": "ADMIN",
  "/donor": "DONOR",
  "/dev": "DEV",
};

async function sessionPayload(req: NextRequest) {
  for (const token of sessionTokens(req.cookies)) {
    try {
      return (await jwtVerify(token, JWT_SECRET)).payload;
    } catch {
      // A stale first-party cookie must not mask a valid Telegram partition.
    }
  }
  return null;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public pages
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/")) || /^\/[A-Za-z0-9_-]{8}$/.test(pathname)) {
    return NextResponse.next();
  }

  // Public API endpoints
  if (publicApiPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // API routes: reject early if no token (defense-in-depth — route handlers also check)
  if (pathname.startsWith("/api/")) {
    const payload = await sessionPayload(req);
    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Page routes: redirect to login if no valid token
  const payload = await sessionPayload(req);
  if (!payload) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const roles = payload.roles as Role[];

    for (const [prefix, role] of Object.entries(roleRoutes)) {
      if (pathname.startsWith(prefix) && !roles.includes(role)) {
        return NextResponse.redirect(new URL("/login", req.url));
      }
    }
  } catch {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(PRIMARY_SESSION_COOKIE);
    response.cookies.delete(TELEGRAM_WEB_SESSION_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"],
};
