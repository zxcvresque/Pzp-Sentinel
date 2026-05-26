import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/avatar/[fileId]
 *
 * Proxies a Telegram file by its file_id.
 * 1. Calls getFile to resolve the temporary download URL
 * 2. Streams the bytes back with a 7-day cache header
 *
 * This lets us store TG file_ids in the DB while serving images
 * through normal <img src=""> tags without exposing the bot token.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  const token = process.env.BOT_TOKEN;

  if (!token || !fileId) {
    return NextResponse.json({ error: "Missing config" }, { status: 500 });
  }

  try {
    // Resolve file_id → temporary file_path
    const fileRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    );
    const fileData = await fileRes.json();

    if (!fileData.ok || !fileData.result?.file_path) {
      return new NextResponse(null, { status: 404 });
    }

    // Download the actual image bytes
    const photoRes = await fetch(
      `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`,
    );

    if (!photoRes.ok) {
      return new NextResponse(null, { status: 502 });
    }

    const buffer = await photoRes.arrayBuffer();
    const ext = fileData.result.file_path.split(".").pop() || "jpg";
    const contentType = ext === "png" ? "image/png" : "image/jpeg";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400", // 7d cache, 1d stale
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
