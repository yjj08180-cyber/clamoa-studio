import { after } from "next/server";
import type {
  Action,
  StudioPayload,
  StudioState,
  Viewer,
} from "../../../lib/types";
import { applyAction } from "../../../lib/domain";
import { getViewer } from "../../../lib/server/auth";
import { teamConfig } from "../../../lib/server/config";
import {
  checkOrigin,
  errorResponse,
  HttpError,
  jsonBody,
} from "../../../lib/server/http";
import {
  aiReady,
  drainLocalJobs,
  processVercelJob,
} from "../../../lib/server/jobs";
import {
  canonicalAction,
  readState,
  transact,
} from "../../../lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function response(state: StudioState, viewer: Viewer) {
  const payload: StudioPayload = {
    state,
    viewer,
    mode: teamConfig() ? "team" : "local",
    aiReady: aiReady(),
  };
  if (
    process.env.VERCEL &&
    payload.mode === "team" &&
    payload.aiReady &&
    state.jobs.some((job) => job.status === "queued") &&
    !state.jobs.some((job) => job.status === "running")
  ) {
    after(processVercelJob);
  } else if (
    payload.mode === "local" &&
    state.jobs.some(
      (job) =>
        job.status === "running" ||
        (job.status === "queued" && payload.aiReady),
    )
  ) {
    after(() =>
      drainLocalJobs().catch(() =>
        console.error("[clamoa] Local worker unavailable"),
      ),
    );
  }
  return Response.json(payload, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  try {
    const viewer = await getViewer(request);
    return response(await readState(), viewer);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const viewer = await getViewer(request);
    const raw = await jsonBody(request);
    if (typeof raw.type !== "string")
      throw new HttpError(400, "지원하지 않는 변경 요청입니다.");
    if (
      (raw.type === "workflow" || raw.type === "logo") &&
      viewer.role !== "admin"
    )
      throw new HttpError(
        403,
        "관리자만 제작 기준과 로고를 변경할 수 있습니다.",
      );
    const action = await canonicalAction(raw as Action);
    const state = await transact((doc) => {
      try {
        doc.state = applyAction(doc.state, action, viewer);
        if (action.type === "deleteProject" || action.type === "deleteShot") {
          const liveJobs = new Set(doc.state.jobs.map((job) => job.id));
          for (const id of Object.keys(doc.leases)) {
            if (!liveJobs.has(id)) delete doc.leases[id];
          }
        }
      } catch (e) {
        throw new HttpError(
          400,
          e instanceof Error ? e.message : "입력 항목을 확인해 주세요.",
        );
      }
      return { value: doc.state };
    });
    return response(state, viewer);
  } catch (e) {
    return errorResponse(e);
  }
}
