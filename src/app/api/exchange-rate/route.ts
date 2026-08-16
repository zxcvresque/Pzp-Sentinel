import { NextRequest, NextResponse } from "next/server";
import { currencyForCountry } from "@/lib/currency-display";

// In-memory cache: { rate, updatedAt, fetchedAt }
let cached: { rate: number; updatedAt: string; fetchedAt: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function locationPayload(request: NextRequest) {
  const country = request.headers.get("cf-ipcountry")
    || request.headers.get("x-vercel-ip-country")
    || request.headers.get("x-country-code");
  return {
    country: country?.toUpperCase() || null,
    suggestedCurrency: currencyForCountry(country),
  };
}

export async function GET(request: NextRequest) {
  const now = Date.now();

  // Return cached value if fresh
  if (cached && now - cached.fetchedAt < CACHE_TTL) {
    return NextResponse.json({
      rate: cached.rate,
      updatedAt: cached.updatedAt,
      ...locationPayload(request),
    });
  }

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      // If fetch fails but we have stale cache, return it
      if (cached) {
        return NextResponse.json({
          rate: cached.rate,
          updatedAt: cached.updatedAt,
          stale: true,
          ...locationPayload(request),
        });
      }
      return NextResponse.json(
        { error: "Failed to fetch exchange rate" },
        { status: 502 },
      );
    }

    const data = await res.json();
    const inrRate = data.rates?.INR;

    if (!inrRate) {
      if (cached) {
        return NextResponse.json({
          rate: cached.rate,
          updatedAt: cached.updatedAt,
          stale: true,
          ...locationPayload(request),
        });
      }
      return NextResponse.json(
        { error: "INR rate not found in response" },
        { status: 502 },
      );
    }

    cached = {
      rate: inrRate,
      updatedAt: data.time_last_update_utc || new Date().toISOString(),
      fetchedAt: now,
    };

    return NextResponse.json({
      rate: cached.rate,
      updatedAt: cached.updatedAt,
      ...locationPayload(request),
    });
  } catch {
    if (cached) {
      return NextResponse.json({
        rate: cached.rate,
        updatedAt: cached.updatedAt,
        stale: true,
        ...locationPayload(request),
      });
    }
    return NextResponse.json(
      { error: "Failed to fetch exchange rate" },
      { status: 502 },
    );
  }
}
