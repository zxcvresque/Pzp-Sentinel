import type { NextResponse } from "next/server";

export const PRIMARY_SESSION_COOKIE = "token";
export const TELEGRAM_WEB_SESSION_COOKIE = "telegram_token";

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export function sessionTokens(cookies: CookieReader): string[] {
  return [...new Set([
    cookies.get(PRIMARY_SESSION_COOKIE)?.value,
    cookies.get(TELEGRAM_WEB_SESSION_COOKIE)?.value,
  ].filter((value): value is string => Boolean(value)))];
}

export function setSessionCookies(
  response: NextResponse,
  token: string,
  maxAge: number,
) {
  const production = process.env.NODE_ENV === "production";
  const base = {
    httpOnly: true,
    maxAge,
    path: "/",
    priority: "high" as const,
  };

  // First-party website session.
  response.cookies.set(PRIMARY_SESSION_COOKIE, token, {
    ...base,
    secure: production,
    sameSite: "lax",
  });

  // Telegram Web A/K embeds Mini Apps cross-site. CHIPS keeps this cookie
  // available inside that iframe even when Chrome blocks third-party cookies.
  if (production) {
    response.cookies.set(TELEGRAM_WEB_SESSION_COOKIE, token, {
      ...base,
      secure: true,
      sameSite: "none",
      partitioned: true,
    });
  }
}

export function clearSessionCookies(response: NextResponse) {
  const production = process.env.NODE_ENV === "production";
  response.cookies.set(PRIMARY_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  if (production) {
    response.cookies.set(TELEGRAM_WEB_SESSION_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      partitioned: true,
      maxAge: 0,
      path: "/",
    });
  }
}
