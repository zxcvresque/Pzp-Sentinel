import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG;

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!GITHUB_TOKEN || !GITHUB_ORG) {
    return NextResponse.json(
      { repos: [], error: "GITHUB_TOKEN or GITHUB_ORG not configured" },
      { status: 200 },
    );
  }

  try {
    const res = await fetch(
      `https://api.github.com/orgs/${GITHUB_ORG}/repos?per_page=100&sort=updated`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (!res.ok) {
      // Fallback: try as user repos
      const userRes = await fetch(
        `https://api.github.com/users/${GITHUB_ORG}/repos?per_page=100&sort=updated`,
        {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3+json",
          },
        },
      );
      if (!userRes.ok) {
        return NextResponse.json({ repos: [] });
      }
      const data = await userRes.json();
      return NextResponse.json({
        repos: data.map((r: Record<string, unknown>) => ({
          name: r.name,
          fullName: r.full_name,
          description: r.description,
          url: r.html_url,
          private: r.private,
          language: r.language,
          updatedAt: r.updated_at,
        })),
      });
    }

    const data = await res.json();
    return NextResponse.json({
      repos: data.map((r: Record<string, unknown>) => ({
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        url: r.html_url,
        private: r.private,
        language: r.language,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error("[github-repos]", err);
    return NextResponse.json({ repos: [] });
  }
}
