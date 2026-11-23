import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getViewer } from "../../../lib/server/auth";
import { errorResponse } from "../../../lib/server/http";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    await getViewer(request);
    const path = (await context.params).path.join("/");
    if (
      !/^(?:thumb\/\d{2}\.webp|Feed\/\d{2}_[\w-]+\.jpg|wordmark-guide\.png)$/.test(
        path,
      )
    )
      return new Response(null, { status: 404 });
    const bytes = await readFile(
      join(process.cwd(), "content/sample", path),
    ).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!bytes) return new Response(null, { status: 404 });
    const mime = path.endsWith(".webp")
      ? "image/webp"
      : path.endsWith(".png")
        ? "image/png"
        : "image/jpeg";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
