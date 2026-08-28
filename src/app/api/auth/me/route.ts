import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, signToken, verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotifType, DonateCadence, FormLayout, ReminderUnit } from "@/generated/prisma/enums";
import type { Role } from "@/generated/prisma/enums";
import { sessionTokens, setSessionCookies } from "@/lib/session-cookies";

export const dynamic = "force-dynamic";

function rolesEqual(a: Role[], b: Role[]): boolean {
  if (a.length !== b.length) return false;
  const sortedB = [...b].sort();
  return [...a].sort().every((r, i) => r === sortedB[i]);
}

function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const res = NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      telegramId: user.telegramId,
      telegramUser: user.telegramUser,
      photoUrl: user.photoUrl,
      themeColor: user.themeColor,
      formLayout: user.formLayout,
      onboardingVersion: user.onboardingVersion,
      savedColors: user.savedColors,
      chatId: user.chatId,
      roles: user.roles,
      dmPreferences: user.dmPreferences,
      inAppPreferences: user.inAppPreferences,
      preferredCurrency: user.preferredCurrency,
      githubUsername: user.githubUsername,
      donateReminderCadence: user.donateReminderCadence,
      donateReminderAnchorAt: user.donateReminderAnchorAt?.toISOString() ?? null,
      donateReminderEveryN: user.donateReminderEveryN,
      donateReminderUnit: user.donateReminderUnit,
      donateReminderTimeMin: user.donateReminderTimeMin,
      donateReminderTz: user.donateReminderTz,
      createdAt: user.createdAt.toISOString(),
    },
  }, { headers: { "Cache-Control": "no-store" } });

  // Keep the auth cookie's role snapshot in sync with the DB. Middleware authorizes
  // /admin, /dev, /donor from the JWT roles (the Edge runtime can't query Prisma), so
  // a role added or removed after login otherwise wouldn't take effect until the 24h
  // token expired. The app fetches this endpoint on load, so re-mint the cookie here
  // when the DB roles drift from the token — preserving the original expiry.
  const cookieStore = await cookies();
  let payload = null;
  for (const token of sessionTokens(cookieStore)) {
    payload = await verifyToken(token);
    if (payload) break;
  }
  if (payload?.exp && !rolesEqual(payload.roles, user.roles)) {
    const remaining = payload.exp - Math.floor(Date.now() / 1000);
    if (remaining > 0) {
      const fresh = await signToken({ userId: user.id, roles: user.roles }, payload.exp);
      setSessionCookies(res, fresh, remaining);
    }
  }

  return res;
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    dmPreferences,
    inAppPreferences,
    preferredCurrency,
    formLayout,
    onboardingVersion,
    githubUsername,
    name,
    themeColor,
    savedColors,
    donateReminderCadence,
    donateReminderEveryN,
    donateReminderUnit,
    donateReminderTimeMin,
    donateReminderTz,
  } = body;

  const data: {
    dmPreferences?: string[];
    inAppPreferences?: string[];
    preferredCurrency?: "INR" | "USD";
    formLayout?: FormLayout;
    onboardingVersion?: number;
    githubUsername?: string;
    name?: string;
    themeColor?: string;
    savedColors?: string[];
    donateReminderCadence?: DonateCadence;
    donateReminderEveryN?: number | null;
    donateReminderUnit?: ReminderUnit | null;
    donateReminderTimeMin?: number;
    donateReminderTz?: string;
  } = {};

  if (dmPreferences !== undefined) {
    if (!Array.isArray(dmPreferences)) {
      return NextResponse.json({ error: "dmPreferences must be an array" }, { status: 400 });
    }
    const validTypes = Object.values(NotifType) as string[];
    const invalid = dmPreferences.filter((t: string) => !validTypes.includes(t));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid notification types: ${invalid.join(", ")}` },
        { status: 400 },
      );
    }
    data.dmPreferences = dmPreferences;
  }
  if (inAppPreferences !== undefined) {
    if (!Array.isArray(inAppPreferences)) return NextResponse.json({ error: "inAppPreferences must be an array" }, { status: 400 });
    const validTypes = Object.values(NotifType) as string[];
    const invalid = inAppPreferences.filter((type: string) => !validTypes.includes(type));
    if (invalid.length) return NextResponse.json({ error: `Invalid notification types: ${invalid.join(", ")}` }, { status: 400 });
    data.inAppPreferences = inAppPreferences;
  }
  if (preferredCurrency !== undefined) {
    if (preferredCurrency !== "INR" && preferredCurrency !== "USD") return NextResponse.json({ error: "Invalid preferred currency" }, { status: 400 });
    data.preferredCurrency = preferredCurrency;
  }
  if (formLayout !== undefined) {
    const validLayouts = Object.values(FormLayout) as string[];
    if (!validLayouts.includes(formLayout)) {
      return NextResponse.json({ error: "Invalid form layout" }, { status: 400 });
    }
    data.formLayout = formLayout as FormLayout;
  }
  if (onboardingVersion !== undefined) {
    if (!Number.isInteger(onboardingVersion) || onboardingVersion < 0 || onboardingVersion > 10) {
      return NextResponse.json({ error: "Invalid onboarding version" }, { status: 400 });
    }
    data.onboardingVersion = onboardingVersion;
  }
  if (githubUsername !== undefined) {
    const username = typeof githubUsername === "string" ? githubUsername.trim().replace(/^@/, "") : "";
    const valid = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)
      && !username.includes("--");
    if (!valid) {
      return NextResponse.json(
        { error: "Enter a valid GitHub username (without the @)." },
        { status: 400 },
      );
    }
    data.githubUsername = username;
  }
  if (name !== undefined) {
    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (!normalizedName || normalizedName.length > 100) {
      return NextResponse.json({ error: "Name must be between 1 and 100 characters" }, { status: 400 });
    }
    data.name = normalizedName;
  }
  if (themeColor !== undefined) {
    const color = typeof themeColor === "string" ? themeColor.trim() : "";
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return NextResponse.json({ error: `Invalid hex color: "${color}"` }, { status: 400 });
    }
    data.themeColor = color;
  }
  if (savedColors !== undefined) {
    if (!Array.isArray(savedColors) || savedColors.length > 3 || savedColors.some((color) => typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))) {
      return NextResponse.json({ error: "savedColors must contain up to 3 hex colors" }, { status: 400 });
    }
    data.savedColors = savedColors;
  }

  if (donateReminderCadence !== undefined) {
    const valid = Object.values(DonateCadence) as string[];
    if (!valid.includes(donateReminderCadence)) {
      return NextResponse.json({ error: "Invalid donateReminderCadence" }, { status: 400 });
    }
    data.donateReminderCadence = donateReminderCadence as DonateCadence;
  }

  if (donateReminderEveryN !== undefined) {
    if (donateReminderEveryN === null) {
      data.donateReminderEveryN = null;
    } else if (
      !Number.isInteger(donateReminderEveryN) ||
      donateReminderEveryN < 1 ||
      donateReminderEveryN > 365
    ) {
      return NextResponse.json(
        { error: "donateReminderEveryN must be an integer between 1 and 365" },
        { status: 400 },
      );
    } else {
      data.donateReminderEveryN = donateReminderEveryN;
    }
  }

  if (donateReminderUnit !== undefined) {
    if (donateReminderUnit === null) {
      data.donateReminderUnit = null;
    } else {
      const validUnits = Object.values(ReminderUnit) as string[];
      if (!validUnits.includes(donateReminderUnit)) {
        return NextResponse.json({ error: "Invalid donateReminderUnit" }, { status: 400 });
      }
      data.donateReminderUnit = donateReminderUnit as ReminderUnit;
    }
  }

  if (donateReminderTimeMin !== undefined) {
    if (
      !Number.isInteger(donateReminderTimeMin) ||
      donateReminderTimeMin < 0 ||
      donateReminderTimeMin > 1439
    ) {
      return NextResponse.json(
        { error: "donateReminderTimeMin must be between 0 and 1439" },
        { status: 400 },
      );
    }
    data.donateReminderTimeMin = donateReminderTimeMin;
  }

  if (donateReminderTz !== undefined) {
    if (typeof donateReminderTz !== "string" || !isValidTimeZone(donateReminderTz)) {
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
    }
    data.donateReminderTz = donateReminderTz;
  }

  // A CUSTOM cadence needs both an interval count and a unit (from this request or
  // already stored), otherwise the bot can't compute when to fire.
  if (data.donateReminderCadence === "CUSTOM") {
    const n = data.donateReminderEveryN ?? user.donateReminderEveryN;
    const u = data.donateReminderUnit ?? user.donateReminderUnit;
    if (!n || !u) {
      return NextResponse.json(
        { error: "Custom cadence requires an interval (every N) and a unit." },
        { status: 400 },
      );
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: {
      dmPreferences: true,
      inAppPreferences: true,
      preferredCurrency: true,
      formLayout: true,
      onboardingVersion: true,
      githubUsername: true,
      name: true,
      themeColor: true,
      savedColors: true,
      donateReminderCadence: true,
      donateReminderEveryN: true,
      donateReminderUnit: true,
      donateReminderTimeMin: true,
      donateReminderTz: true,
    },
  });

  return NextResponse.json(updated);
}
