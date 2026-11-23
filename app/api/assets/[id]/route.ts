import { getViewer } from "../../../../lib/server/auth";
import { assetMeta, readAsset } from "../../../../lib/server/store";
import { errorResponse } from "../../../../lib/server/http";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await getViewer(request);
    const { id } = await context.params;
    const asset = await assetMeta(id);
    const disposition = asset.mime.startsWith("image/")
      ? "inline"
      : "attachment";
    return new Response(new Uint8Array(await readAsset(asset)), {
      headers: {
        "Content-Type": asset.mime,
        "Content-Disposition":
          disposition + "; filename*=UTF-8''" + encodeURIComponent(asset.name),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
