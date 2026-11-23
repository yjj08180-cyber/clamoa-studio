import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { errorResponse, HttpError } from "../../../lib/server/http";
import { processNextJob, processVercelJob } from "../../../lib/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret)
      throw new HttpError(503, "워커 호출 키가 설정되지 않았습니다.");
    const auth = Buffer.from(request.headers.get("authorization") || "");
    const expected = Buffer.from("Bearer " + secret);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected))
      throw new HttpError(401, "워커 권한이 필요합니다.");
    if (process.env.VERCEL) {
      after(processVercelJob);
      return Response.json(
        { accepted: true },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { processed: await processNextJob() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = run;
export const POST = run;
