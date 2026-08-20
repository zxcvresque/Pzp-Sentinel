export async function fetchTelegramFile(fileId: string) {
  const token = process.env.BOT_TOKEN;
  if (!token || !fileId) return null;

  const fileResponse = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    { cache: "no-store" },
  );
  const fileData = await fileResponse.json();
  if (!fileData.ok || !fileData.result?.file_path) return null;

  const path = String(fileData.result.file_path);
  const download = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
    cache: "no-store",
  });
  if (!download.ok) return null;

  const extension = path.split(".").pop()?.toLowerCase() || "bin";
  const contentType =
    extension === "png" ? "image/png"
      : extension === "webp" ? "image/webp"
        : extension === "gif" ? "image/gif"
          : extension === "jpg" || extension === "jpeg" ? "image/jpeg"
            : "application/octet-stream";

  return {
    body: await download.arrayBuffer(),
    contentType,
    fileName: path.split("/").pop() || `telegram-file.${extension}`,
  };
}
