import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

const MAX_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Upload proof screenshots → Telegram group (screenshots topic).
 * Returns proxy URLs (/api/avatar/{fileId}) stored in transaction.attachments.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "No files" }, { status: 400 });
  }

  const token = process.env.BOT_TOKEN;
  const groupId = process.env.TG_GROUP_ID;
  const topicId = process.env.TG_TOPIC_SCREENSHOTS;

  if (!token || !groupId || !topicId) {
    return NextResponse.json(
      { error: "Telegram upload not configured" },
      { status: 500 },
    );
  }

  const urls: string[] = [];

  for (const file of files) {
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `File "${file.name}" exceeds 20MB limit` },
        { status: 400 },
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `File "${file.name}" is not a supported image type` },
        { status: 400 },
      );
    }

    // Upload to Telegram group via Bot API
    const tgForm = new FormData();
    tgForm.append("chat_id", groupId);
    tgForm.append("message_thread_id", topicId);
    tgForm.append("photo", file, file.name);
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: tgForm,
    });

    const tgData = await tgRes.json();

    if (!tgData.ok || !tgData.result?.photo?.length) {
      console.error("[upload] TG sendPhoto failed:", tgData);
      return NextResponse.json(
        { error: `Failed to upload "${file.name}"` },
        { status: 502 },
      );
    }

    // Delete the staging message — we only needed it for the file_id.
    // The real captioned photo is sent by logProofScreenshots after tx creation.
    if (tgData.result.message_id) {
      fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: groupId, message_id: tgData.result.message_id }),
      }).catch(() => {});
    }

    // Grab the largest photo size's file_id (stays valid after message deletion)
    const photos = tgData.result.photo;
    const bestPhoto = photos[photos.length - 1];
    urls.push(`/api/avatar/${bestPhoto.file_id}`);
  }

  return NextResponse.json({ urls });
}
