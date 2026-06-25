import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";

const MAX_KEY_SIZE = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No SSH key file provided" }, { status: 400 });
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "SSH key file is empty" }, { status: 400 });
  }

  if (file.size > MAX_KEY_SIZE) {
    return NextResponse.json({ error: "SSH key file must be 5MB or smaller" }, { status: 400 });
  }

  const token = process.env.BOT_TOKEN;
  const groupId = process.env.TG_GROUP_ID;
  const topicId = process.env.TG_TOPIC_SCREENSHOTS;

  if (!token || !groupId || !topicId) {
    return NextResponse.json(
      { error: "Telegram document upload is not configured" },
      { status: 500 },
    );
  }

  const tgForm = new FormData();
  tgForm.append("chat_id", groupId);
  tgForm.append("message_thread_id", topicId);
  tgForm.append("document", file, file.name || "ssh-key");
  tgForm.append(
    "caption",
    `VPS SSH key uploaded by ${user.name || user.telegramUser || user.telegramId}`,
  );

  const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: tgForm,
  });
  const tgData = await tgRes.json();

  if (!tgData.ok || !tgData.result?.document?.file_id) {
    console.error("[vps-key-upload] TG sendDocument failed:", tgData);
    return NextResponse.json({ error: "Failed to upload SSH key file" }, { status: 502 });
  }

  return NextResponse.json({
    url: `/api/avatar/${tgData.result.document.file_id}`,
    fileName: tgData.result.document.file_name || file.name || "ssh-key",
  });
}
