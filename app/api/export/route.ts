import { getViewer } from "../../../lib/server/auth";
import { readState, readAsset } from "../../../lib/server/store";
import { checkOrigin, errorResponse, jsonBody } from "../../../lib/server/http";
import { entries } from "../../../lib/library";
import { renderExport } from "../../../lib/server/export";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    await getViewer(req);
    const { versionIds, format } = await jsonBody(req, 64000);
    if (
      typeof format !== "string" ||
      !["jpg", "index", "zip"].includes(format) ||
      !Array.isArray(versionIds) ||
      !versionIds.length ||
      versionIds.length > 150 ||
      (format === "jpg" && versionIds.length !== 1)
    )
      return Response.json(
        { error: "내보낼 컷을 확인해 주세요." },
        { status: 400 },
      );
    const all = new Map(
      entries(await readState(), true).map((e) => [e.version.id, e]),
    );
    const rows = versionIds.map((id: string) => all.get(id));
    if (rows.some((r) => !r))
      return Response.json(
        { error: "선택한 버전이 없습니다." },
        { status: 404 },
      );
    const file = await renderExport(
      rows.map((r) => r!),
      format as "jpg" | "index" | "zip",
      readAsset,
    );
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition":
          "attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
