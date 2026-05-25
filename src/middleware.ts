import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import type { Role } from "@/generated/prisma/enums";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "");

// Public paths — no auth required
const publicPaths = ["/", "/login", "/plan"];

// Public API routes — no JWT needed
const publicApiPaths = ["/api/auth", "/api/bot", "/api/exchange-rate", "/api/bmc/webhook"];

const roleRoutes: Record<string, Role> = {
  "/admin": "ADMIN",
  "/donor": "DONOR",
  "/dev": "DEV",
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public pages
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Public API endpoints
  if (publicApiPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // API routes: reject early if no token (defense-in-depth — route handlers also check)
  if (pathname.startsWith("/api/")) {
    const token = req.cookies.get("token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Page routes: redirect to login if no valid token
  const token = req.cookies.get("token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const roles = payload.roles as Role[];

    for (const [prefix, role] of Object.entries(roleRoutes)) {
      if (pathname.startsWith(prefix) && !roles.includes(role)) {
        return NextResponse.redirect(new URL("/login", req.url));
      }
    }
  } catch {
    const response = NextResponse.redirect(new URL("/login", req.url));
    response.cookies.delete("token");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"],
};
