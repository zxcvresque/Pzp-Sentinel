import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET() {
  try {
    const script = readFileSync(
      join(process.cwd(), "scripts", "install-agent.sh"),
      "utf-8",
    );
    return new NextResponse(script, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'inline; filename="install-agent.sh"',
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Script not found" }, { status: 500 });
  }
}
