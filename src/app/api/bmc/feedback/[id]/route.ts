import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FeedbackError } from "@/lib/bmc-feedback-response";
import { saveBmcFeedback, drainBmcFeedbackDelivery } from "@/lib/bmc-feedback-service";
import { after } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid response" }, { status: 400 });
  try {
    await saveBmcFeedback(prisma, { id, userId: user.id, source: "APP", body: body as Record<string, unknown> });
    after(async () => {
      await drainBmcFeedbackDelivery(prisma).catch(() => console.error("[bmc-feedback] Delivery pending; bot will retry."));
    });
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof FeedbackError) return Response.json({ error: error.message }, { status: error.status });
    console.error("[bmc-feedback] Could not save response");
    return Response.json({ error: "Could not save your response. Please try again." }, { status: 500 });
  }
}
