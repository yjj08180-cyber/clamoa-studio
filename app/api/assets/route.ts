import { getViewer } from "../../../lib/server/auth";
import { saveAsset } from "../../../lib/server/store";
import {
  checkOrigin,
  errorResponse,
  HttpError,
  limitedBody,
} from "../../../lib/server/http";

export const runtime = "nodejs";
const maxBytes = 20 * 1024 * 1024;

function identify(b: Buffer, name: string) {
  if (b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a")
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (b.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  if (/\.(md|txt)$/i.test(name) && !b.includes(0))
    return /\.md$/i.test(name) ? "text/markdown" : "text/plain";
  throw new HttpError(
    415,
    "JPG, PNG, WebP, PDF, MD, TXT 파일을 업로드할 수 있습니다.",
  );
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await getViewer(request);
    const type = request.headers.get("content-type") || "";
    if (!type.startsWith("multipart/form-data;"))
      throw new HttpError(415, "업로드할 파일을 선택해 주세요.");
    const { bytes } = await limitedBody(request, maxBytes + 64 * 1024);
    const form = await new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": type },
    })
      .formData()
      .catch(() => {
        throw new HttpError(400, "파일 업로드 요청을 확인해 주세요.");
      });
    const file = form.get("file");
    if (!file || typeof file === "string" || !file.size)
      throw new HttpError(400, "업로드할 파일을 선택해 주세요.");
    if (file.size > maxBytes)
      throw new HttpError(413, "파일 한 개는 20MB까지 업로드할 수 있습니다.");
    const data = Buffer.from(await file.arrayBuffer());
    return Response.json(
      { asset: await saveAsset(data, file.name, identify(data, file.name)) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
