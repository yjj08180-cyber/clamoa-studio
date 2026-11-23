import { validateLink, verifyLink } from "../../../../lib/server/auth";
import { requiredTeam } from "../../../../lib/server/config";
import {
  checkOrigin,
  HttpError,
  limitedBody,
} from "../../../../lib/server/http";

export const runtime = "nodejs";

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  // Same-origin form POSTs must keep their Origin without leaking the token URL.
  "Referrer-Policy": "strict-origin",
  "X-Robots-Tag": "noindex",
  "Content-Security-Policy":
    "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; style-src 'unsafe-inline'",
};

function page(content: string, status = 200) {
  return new Response(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>클라모아 로그인</title>' +
      "<style>body{background:#f7f7f3;color:#202322;font:16px system-ui;margin:0;min-height:100dvh;display:grid;place-items:center}main{margin:20px;padding:32px;border:1px solid #dedfd9;border-radius:12px;background:#fffefa}button{background:#304cd6;color:#fff;border:0;border-radius:5px;font:inherit;padding:10px 16px;cursor:pointer}p{line-height:1.6}</style>" +
      "<main><h1>클라모아 팀 스튜디오</h1>" +
      content +
      "</main></html>",
    { status, headers },
  );
}

function failure(error: unknown) {
  const status = error instanceof HttpError ? error.status : 500;
  return page(
    "<p>이 로그인 링크를 사용할 수 없습니다. 스튜디오에서 새 링크를 요청해 주세요.</p>" +
      '<a href="/">스튜디오로 돌아가기</a>',
    status,
  );
}

export function GET(request: Request) {
  try {
    requiredTeam();
    const params = new URL(request.url).searchParams;
    const token = params.get("token_hash") || "";
    const type = params.get("type") || "email";
    validateLink(token, type);
    // Email scanners prefetch GET links. Verification starts only from the form button.
    return page(
      "<p>이메일 주소를 확인하고 스튜디오에 로그인합니다.</p>" +
        '<form method="post" action="/api/auth/callback">' +
        '<input type="hidden" name="token_hash" value="' +
        token +
        '">' +
        '<input type="hidden" name="type" value="' +
        type +
        '">' +
        '<button type="submit">스튜디오에 로그인</button></form>',
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const config = requiredTeam();
    if (
      !request.headers
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      throw new HttpError(415, "로그인 양식을 확인해 주세요.");
    const { bytes } = await limitedBody(request, 4096);
    const form = new URLSearchParams(bytes.toString("utf8"));
    await verifyLink(form.get("token_hash") || "", form.get("type") || "");
    return new Response(null, {
      status: 303,
      headers: {
        Location: config.site + "/",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
