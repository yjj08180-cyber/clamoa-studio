import { randomUUID } from "node:crypto";
import type { Job, StudioState } from "../types";
import { completeJob } from "../domain";
import { readAsset, readState, saveAsset, transact } from "./store";
import { requiredTeam } from "./config";

const leaseMs = 5 * 60_000;
export const aiReady = () => Boolean(process.env.OPENAI_API_KEY?.trim());
type Claim = { state: StudioState; job: Job; token: string };

async function claimJob(): Promise<Claim | undefined> {
  const token = randomUUID();
  return transact<Claim | undefined>((doc) => {
    const now = Date.now();
    let repaired = false;
    for (const job of doc.state.jobs) {
      if (
        job.status === "running" &&
        (!doc.leases[job.id] || doc.leases[job.id].expiresAt <= now)
      ) {
        job.status = "failed";
        job.error =
          "작업 연결이 끊겨 완료 여부를 확인할 수 없습니다. 실행 기록을 확인한 뒤 다시 시도해 주세요.";
        delete doc.leases[job.id];
        repaired = true;
      }
    }
    const busy =
      process.env.VERCEL &&
      doc.state.jobs.some((job) => job.status === "running");
    const job =
      aiReady() && !busy
        ? doc.state.jobs.find((candidate) => candidate.status === "queued")
        : undefined;
    if (!job) return { value: undefined, skip: !repaired };
    job.status = "running";
    delete job.error;
    doc.leases[job.id] = { token, expiresAt: now + leaseMs };
    return { value: { state: doc.state, job, token } };
  });
}

export async function processNextJob(): Promise<boolean> {
  const claim = await claimJob();
  if (!claim) return false;
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      await transact((doc) => {
        if (doc.leases[claim.job.id]?.token !== claim.token)
          return { value: null, skip: true };
        doc.leases[claim.job.id].expiresAt = Date.now() + leaseMs;
        return { value: null };
      });
    } catch {
      console.error("[clamoa] Worker lease renewal failed");
    } finally {
      renewing = false;
    }
  }, 60_000);
  heartbeat.unref();
  try {
    const { runJob } = await import("./ai");
    const result = await runJob(claim.state, claim.job, {
      read: readAsset,
      save: saveAsset,
    });
    await transact((doc) => {
      if (doc.leases[claim.job.id]?.token !== claim.token)
        return { value: null, skip: true };
      doc.state = completeJob(doc.state, claim.job.id, result);
      delete doc.leases[claim.job.id];
      return { value: null };
    });
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message.slice(0, 600)
        : "작업을 마치지 못했습니다.";
    await transact((doc) => {
      const job = doc.state.jobs.find((j) => j.id === claim.job.id);
      if (!job || doc.leases[job.id]?.token !== claim.token)
        return { value: null, skip: true };
      job.status = "failed";
      job.error = detail;
      delete doc.leases[job.id];
      return { value: null };
    });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

export async function processVercelJob(): Promise<void> {
  try {
    const processed = await processNextJob();
    if (
      !processed ||
      !(await readState()).jobs.some((job) => job.status === "queued")
    )
      return;
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new Error("CRON_SECRET is missing");
    const next = await fetch(requiredTeam().site + "/api/worker", {
      method: "POST",
      headers: { Authorization: "Bearer " + secret },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!next.ok) throw new Error("Worker continuation HTTP " + next.status);
  } catch (error) {
    console.error(
      "[clamoa] Vercel worker unavailable",
      error instanceof Error ? error.message : "",
    );
  }
}

let localWork: Promise<void> | undefined;
export function drainLocalJobs(): Promise<void> {
  if (!localWork)
    localWork = (async () => {
      while (await processNextJob()) {
        /* finish queued work after the browser request */
      }
    })().finally(() => {
      localWork = undefined;
    });
  return localWork;
}
