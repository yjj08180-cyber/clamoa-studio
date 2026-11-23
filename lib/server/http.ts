export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown): Response {
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500)
    console.error(
      "[clamoa]",
      error instanceof Error ? error.message : "Unknown error",
    );
  return Response.json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next can canonicalize the request URL to localhost while a browser uses 127.0.0.1.
  // In local mode getViewer independently checks for a loopback host.
  const host = request.headers.get("host") || url.host;
  const expected = process.env.STUDIO_SITE_URL || url.protocol + "//" + host;
  if (origin && origin !== new URL(expected).origin)
    throw new HttpError(403, "이 사이트에서 다시 시도해 주세요.");
}

export async function jsonBody(
  request: Request,
  limit = 1_000_000,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "JSON 요청이 필요합니다.");
  const raw = await limitedBody(request, limit);
  try {
    const data = JSON.parse(raw.bytes.toString("utf8"));
    if (!data || Array.isArray(data) || typeof data !== "object")
      throw new Error();
    return data;
  } catch {
    throw new HttpError(400, "요청 내용을 확인해 주세요.");
  }
}

export async function limitedBody(
  request: Request,
  limit: number,
): Promise<{ bytes: Buffer }> {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new HttpError(413, "파일 또는 요청 크기가 너무 큽니다.");
  if (!request.body) throw new HttpError(400, "요청 내용이 비어 있습니다.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError(413, "파일 또는 요청 크기가 너무 큽니다.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks) };
}
