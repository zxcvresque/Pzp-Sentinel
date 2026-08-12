import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { POST as approveTransaction } from "../[id]/approve/route";
import { POST as rejectTransaction } from "../[id]/reject/route";
import { DELETE as voidTransaction } from "../[id]/route";

type BulkAction = "APPROVE" | "REJECT" | "VOID";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const rawIds: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
  const ids = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const action = body?.action as BulkAction;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (ids.length === 0 || ids.length > 5000) {
    return NextResponse.json({ error: "Select between 1 and 5,000 transactions" }, { status: 400 });
  }
  if (!["APPROVE", "REJECT", "VOID"].includes(action)) {
    return NextResponse.json({ error: "Invalid bulk action" }, { status: 400 });
  }
  if ((action === "REJECT" || action === "VOID") && !reason) {
    return NextResponse.json({ error: `${action === "VOID" ? "Void" : "Rejection"} reason is required` }, { status: 400 });
  }
  if (reason.length > 500) {
    return NextResponse.json({ error: "Reason must be at most 500 characters" }, { status: 400 });
  }

  const results: Array<
    { id: string; success: true; transaction: unknown }
    | { id: string; success: false; error: string }
  > = [];
  // Keep notification/log delivery pressure bounded for large filtered selections.
  for (let start = 0; start < ids.length; start += 20) {
    const batch = ids.slice(start, start + 20);
    results.push(...await Promise.all(batch.map(async (id) => {
      try {
        const actionRequest = new NextRequest(req.nextUrl, {
          method: action === "VOID" ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        const context = { params: Promise.resolve({ id }) };
        const response = action === "APPROVE"
          ? await approveTransaction(actionRequest, context)
          : action === "REJECT"
            ? await rejectTransaction(actionRequest, context)
            : await voidTransaction(actionRequest, context);
        const data = await response.json().catch(() => ({}));
        return response.ok
          ? { id, success: true as const, transaction: data.transaction }
          : { id, success: false as const, error: data.error || `Request failed (${response.status})` };
      } catch {
        return { id, success: false as const, error: "Network error" };
      }
    })));
  }

  const succeeded = results.filter((result) => result.success);
  const failed = results.filter((result) => !result.success);
  return NextResponse.json({
    action,
    requested: ids.length,
    succeeded: succeeded.length,
    failed: failed.length,
    results,
  });
}
