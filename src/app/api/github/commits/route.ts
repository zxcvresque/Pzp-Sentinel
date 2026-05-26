import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/\s.]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repoUrl = req.nextUrl.searchParams.get("repoUrl");
  if (!repoUrl) {
    return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
  }

  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid GitHub URL" }, { status: 400 });
  }

  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_LOGS_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "PzP-Sentinel",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?per_page=15`,
      { headers },
    );

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ commits: [], error: "Repository not found or private" });
      }
      if (res.status === 403) {
        return NextResponse.json({ commits: [], error: "GitHub API rate limit exceeded" });
      }
      return NextResponse.json({ commits: [], error: `GitHub API: ${res.status}` });
    }

    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commits = data.map((c: any) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0],
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url,
      avatar: c.author?.avatar_url ?? null,
    }));

    return NextResponse.json({ commits });
  } catch (err) {
    console.error("[github] Failed to fetch commits:", err);
    return NextResponse.json({ commits: [], error: "Failed to fetch commits" });
  }
}
