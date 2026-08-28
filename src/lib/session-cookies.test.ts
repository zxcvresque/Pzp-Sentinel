import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextResponse } from "next/server";
import {
  PRIMARY_SESSION_COOKIE,
  TELEGRAM_WEB_SESSION_COOKIE,
  clearSessionCookies,
  sessionTokens,
  setSessionCookies,
} from "./session-cookies";

function responseRecorder() {
  const calls: Array<[string, string, Record<string, unknown>]> = [];
  const response = {
    cookies: {
      set: (name: string, value: string, options: Record<string, unknown>) => {
        calls.push([name, value, options]);
      },
    },
  } as unknown as NextResponse;
  return { response, calls };
}

afterEach(() => vi.unstubAllEnvs());

describe("session cookies", () => {
  it("reads both first-party and Telegram Web session candidates", () => {
    const values = new Map([
      [PRIMARY_SESSION_COOKIE, { value: "first-party" }],
      [TELEGRAM_WEB_SESSION_COOKIE, { value: "partitioned" }],
    ]);
    expect(sessionTokens({ get: (name) => values.get(name) })).toEqual([
      "first-party",
      "partitioned",
    ]);
  });

  it("sets a CHIPS cookie for Telegram Web in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { response, calls } = responseRecorder();
    setSessionCookies(response, "signed-token", 3600);

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([
      TELEGRAM_WEB_SESSION_COOKIE,
      "signed-token",
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "none",
        partitioned: true,
        maxAge: 3600,
      }),
    ]);
  });

  it("expires both cookie contexts on logout", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { response, calls } = responseRecorder();
    clearSessionCookies(response);

    expect(calls.map(([name]) => name)).toEqual([
      PRIMARY_SESSION_COOKIE,
      TELEGRAM_WEB_SESSION_COOKIE,
    ]);
    expect(calls.every(([, , options]) => options.maxAge === 0)).toBe(true);
  });
});
