import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

interface ActivityItem {
  id: string;
  type: "push" | "pr" | "branch" | "release" | "issue" | "review" | "fork" | "star";
  repo: string;
  title: string;
  author: string;
  avatar: string | null;
  date: string;
  url: string;
  sha?: string;
  meta?: Record<string, unknown>;
}

function parseEvents(events: Record<string, unknown>[], repoName: string, repoFull: string): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const evt of events) {
    const payload = evt.payload as Record<string, unknown>;
    const actor = evt.actor as Record<string, string>;
    const author = actor?.display_login || actor?.login || "unknown";
    const avatar = actor?.avatar_url || null;
    const date = evt.created_at as string;

    switch (evt.type) {
      case "PushEvent": {
        const commits = (payload.commits as Record<string, unknown>[]) || [];
        for (const commit of commits.slice(0, 3)) {
          const msg = (commit.message as string) || "";
          const sha = ((commit.sha as string) || "").slice(0, 7);
          items.push({
            id: `${evt.id}-${sha}`,
            type: "push",
            repo: repoName,
            title: msg.split("\n")[0],
            author: (commit.author as Record<string, string>)?.name || author,
            avatar,
            date,
            url: `https://github.com/${repoFull}/commit/${commit.sha}`,
            sha,
          });
        }
        break;
      }

      case "PullRequestEvent": {
        const pr = payload.pull_request as Record<string, unknown>;
        const action = payload.action as string;
        if (["opened", "closed", "reopened"].includes(action)) {
          const merged = action === "closed" && pr?.merged === true;
          items.push({
            id: evt.id as string,
            type: "pr",
            repo: repoName,
            title: `${merged ? "Merged" : action === "opened" ? "Opened" : action === "closed" ? "Closed" : "Reopened"} PR #${pr?.number}: ${pr?.title || ""}`,
            author,
            avatar,
            date,
            url: (pr?.html_url as string) || `https://github.com/${repoFull}`,
            meta: { action: merged ? "merged" : action, number: pr?.number },
          });
        }
        break;
      }

      case "CreateEvent": {
        const refType = payload.ref_type as string;
        if (refType === "branch" || refType === "tag") {
          items.push({
            id: evt.id as string,
            type: "branch",
            repo: repoName,
            title: `Created ${refType}: ${payload.ref || "default"}`,
            author,
            avatar,
            date,
            url: `https://github.com/${repoFull}/tree/${payload.ref || "main"}`,
            meta: { refType, ref: payload.ref },
          });
        }
        break;
      }

      case "ReleaseEvent": {
        const release = payload.release as Record<string, unknown>;
        items.push({
          id: evt.id as string,
          type: "release",
          repo: repoName,
          title: `Released ${release?.tag_name || release?.name || "new version"}`,
          author,
          avatar,
          date,
          url: (release?.html_url as string) || `https://github.com/${repoFull}`,
        });
        break;
      }

      case "IssuesEvent": {
        const issue = payload.issue as Record<string, unknown>;
        const action = payload.action as string;
        if (["opened", "closed", "reopened"].includes(action)) {
          items.push({
            id: evt.id as string,
            type: "issue",
            repo: repoName,
            title: `${action.charAt(0).toUpperCase() + action.slice(1)} issue #${issue?.number}: ${issue?.title || ""}`,
            author,
            avatar,
            date,
            url: (issue?.html_url as string) || `https://github.com/${repoFull}`,
          });
        }
        break;
      }

      case "PullRequestReviewEvent": {
        const pr = payload.pull_request as Record<string, unknown>;
        const review = payload.review as Record<string, unknown>;
        const state = (review?.state as string) || "";
        items.push({
          id: evt.id as string,
          type: "review",
          repo: repoName,
          title: `${state === "approved" ? "Approved" : state === "changes_requested" ? "Requested changes on" : "Reviewed"} PR #${pr?.number}`,
          author,
          avatar,
          date,
          url: (review?.html_url as string) || (pr?.html_url as string) || `https://github.com/${repoFull}`,
        });
        break;
      }

      default:
        break;
    }
  }

  return items;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // The cross-repository feed is deliberately visible to all developers for
  // community motivation, but never to donors or other authenticated roles.
  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!GITHUB_TOKEN) {
    return NextResponse.json(
      { activity: [], error: "GITHUB_TOKEN not configured" },
      { status: 200 },
    );
  }

  try {
    const trackedRepos = await prisma.trackedRepo.findMany();

    if (trackedRepos.length === 0) {
      return NextResponse.json({ activity: [], hint: "No repos tracked yet" });
    }

    // Fetch events + recent commits per tracked repo in parallel
    const fetches = trackedRepos.flatMap((repo) => [
      // Events (PRs, branches, releases, etc.)
      (async (): Promise<ActivityItem[]> => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/${repo.fullName}/events?per_page=20`,
            {
              headers: {
                Authorization: `Bearer ${GITHUB_TOKEN}`,
                Accept: "application/vnd.github.v3+json",
              },
              next: { revalidate: 120 },
            },
          );
          if (!res.ok) return [];
          const events = await res.json();
          return parseEvents(events, repo.name, repo.fullName);
        } catch {
          return [];
        }
      })(),
      // Direct commits (reliable, always returns latest)
      (async (): Promise<ActivityItem[]> => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/${repo.fullName}/commits?per_page=10`,
            {
              headers: {
                Authorization: `Bearer ${GITHUB_TOKEN}`,
                Accept: "application/vnd.github.v3+json",
              },
              next: { revalidate: 120 },
            },
          );
          if (!res.ok) return [];
          const commits = await res.json();
          if (!Array.isArray(commits)) return [];
          return commits.map((c: Record<string, unknown>) => {
            const sha = ((c.sha as string) || "").slice(0, 7);
            const commit = c.commit as Record<string, unknown>;
            const authorObj = commit?.author as Record<string, string>;
            const ghAuthor = c.author as Record<string, string> | null;
            return {
              id: `commit-${repo.name}-${sha}`,
              type: "push" as const,
              repo: repo.name,
              title: ((commit?.message as string) || "").split("\n")[0],
              author: authorObj?.name || "unknown",
              avatar: ghAuthor?.avatar_url || null,
              date: authorObj?.date || "",
              url: (c.html_url as string) || `https://github.com/${repo.fullName}/commit/${c.sha}`,
              sha,
            };
          });
        } catch {
          return [];
        }
      })(),
    ]);

    const results = await Promise.all(fetches);

    // Deduplicate — commits from events and direct fetch may overlap
    const seen = new Set<string>();
    const activity = results
      .flat()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .filter((item) => {
        // Dedup commits by sha+repo, other events by id
        const key = item.sha ? `${item.repo}-${item.sha}` : item.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 50);

    return NextResponse.json({ activity });
  } catch (err) {
    console.error("[github-activity] Error:", err);
    return NextResponse.json({ activity: [] });
  }
}
