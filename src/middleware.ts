import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import type { Role } from "@/generated/prisma/enums";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret-change-me");

const publicPaths = ["/", "/login", "/api/auth", "/api/bot"];

const roleRoutes: Record<string, Role> = {
  "/admin": "ADMIN",
  "/donor": "DONOR",
  "/dev": "DEV",
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"],
};
