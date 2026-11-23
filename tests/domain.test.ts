import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, completeJob } from "../lib/domain";
import { creativeBrief } from "../lib/brief";
import { getSeedState } from "../lib/server/seed";
import type { Action, JobResult, StudioState, Viewer } from "../lib/types";

const editor: Viewer = { email: "editor@example.org", role: "member" };
const admin: Viewer = { email: "admin@example.org", role: "admin" };

test("one-line creative briefs resolve season, cut count and optional links", () => {
  const brief = creativeBrief(
    "2027 S/S Energy Orange, 측면광으로 2컷. https://example.org/source.",
  );
  assert.equal(brief.season, "2027 S/S");
  assert.equal(brief.count, 2);
  assert.deepEqual(brief.urls, ["https://example.org/source"]);
  assert.equal(creativeBrief("차가운 금속과 푸른 조명").count, 1);
});

test("quick briefs queue one draft per grounded cut and retain a revision's base version", () => {
  const seed = getSeedState();
  const sample = seed.projects[0];
  let state = applyAction(
    seed,
    {
      type: "createProject",
      id: "quick-brief",
      name: "Energy Orange",
      keyword: "Energy Orange",
      season: "2027 S/S",
      count: 2,
      sources: sample.sources,
      logoId: "guide",
      quick: true,
    },
    editor,
  );
  const research = state.jobs[0];
  const plan = {
    ...sample.shots[0].plan,
    visualReferences: [
      {
        title: "화보",
        url: "https://example.org/editorial",
        observation: "낮은 측면광",
      },
    ],
  };
  markRunning(state, research.id);
  state = completeJob(state, research.id, {
    kind: "research",
    plans: [plan, { ...plan, title: "추가 근거 필요", claims: [], prompt: "" }],
  });
  const first = state.jobs.find((j) => j.kind === "generate")!;
  assert.equal(state.jobs.filter((j) => j.kind === "generate").length, 1);
  markRunning(state, first.id);
  state = completeJob(state, first.id, imageResult(11));
  const shot = state.projects[0].shots[0];
  const original = shot.versions[0];
  state = applyAction(
    state,
    {
      type: "refineShot",
      projectId: "quick-brief",
      shotId: shot.id,
      versionId: original.id,
      instruction: "그림자를 부드럽게",
      key: "revision-one",
    },
    editor,
  );
  const revision = state.jobs.at(-1)!;
  assert.equal(revision.input?.baseVersionId, original.id);
  assert.match(revision.input!.plan.prompt, /그림자를 부드럽게/);
  markRunning(state, revision.id);
  state = completeJob(state, revision.id, imageResult(12));
  const [before, after] = state.projects[0].shots[0].versions;
  assert.deepEqual(before, original);
  assert.equal(after.baseVersionId, original.id);
  assert.equal(after.refinement, "그림자를 부드럽게");
  assert.deepEqual(after.plan.visualReferences, plan.visualReferences);
});
function imageResult(n: number): JobResult {
  const id = "image-" + n;
  return {
    kind: "generate",
    image: {
      id,
      name: id + ".png",
      url: "/api/assets/" + id,
      mime: "image/png",
    },
    model: "test-image-model",
  };
}
function markRunning(state: StudioState, jobId: string) {
  const job = state.jobs.find((j) => j.id === jobId)!;
  assert.equal(job.status, "queued");
  job.status = "running";
}

test("20 independent shots retain 19 successes when one fails and is retried", () => {
  const seed = getSeedState();
  const template = seed.projects[0];
  const create: Action = {
    type: "createProject",
    id: "campaign",
    name: "시즌 에디토리얼",
    keyword: "SS27",
    season: "SS27",
    count: 20,
    sources: template.sources,
    logoId: "guide",
  };
  let state = applyAction(seed, create, editor);
  assert.deepEqual(applyAction(state, create, editor), state);
  const research = state.jobs[0];
  markRunning(state, research.id);
  state = completeJob(state, research.id, {
    kind: "research",
    plans: template.shots.map((s) => s.plan),
  });
  const shots = state.projects[0].shots;
  assert.deepEqual(
    shots.map((s) => s.number),
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  const batch: Action = {
    type: "generate",
    projectId: "campaign",
    shotIds: shots.map((s) => s.id),
    key: "batch-one",
  };
  state = applyAction(state, batch, editor);
  assert.deepEqual(applyAction(state, batch, editor), state);
  const initial = state.jobs.filter((j) => j.kind === "generate");
  assert.equal(initial.length, 20);

  for (const [i, job] of initial.entries()) {
    markRunning(state, job.id);
    if (i === 7) {
      const failed = state.jobs.find((j) => j.id === job.id)!;
      failed.status = "failed";
      failed.error = "temporary provider timeout";
    } else state = completeJob(state, job.id, imageResult(i + 1));
  }
  assert.equal(state.projects[0].shots.flatMap((s) => s.versions).length, 19);
  const preserved = state.projects[0].shots
    .filter((s) => s.number !== 8)
    .map((s) => s.versions[0].id);
  const failed = initial[7];
  const retry: Action = { type: "retry", jobId: failed.id, key: "retry-eight" };
  state = applyAction(state, retry, editor);
  assert.deepEqual(applyAction(state, retry, editor), state);
  assert.deepEqual(
    state.jobs.filter((j) => j.status === "queued").map((j) => j.id),
    [failed.id],
  );
  markRunning(state, failed.id);
  state = completeJob(state, failed.id, imageResult(8));
  assert.deepEqual(completeJob(state, failed.id, imageResult(8)), state);
  assert.deepEqual(applyAction(state, batch, editor), state);
  assert.equal(
    state.jobs.filter((j) => j.kind === "generate" && j.status === "succeeded")
      .length,
    20,
  );
  assert.ok(
    state.projects[0].shots.every(
      (s) => s.versions.length === 1 && s.versions[0].status === "pending",
    ),
  );
  assert.deepEqual(
    state.projects[0].shots
      .filter((s) => s.number !== 8)
      .map((s) => s.versions[0].id),
    preserved,
  );
});

test("deleting generated content prunes only its versions and jobs from saved workspace state", () => {
  let state = getSeedState();
  const sample = state.projects[0];
  const generated = structuredClone(sample);
  generated.id = "deletable";
  generated.sample = false;
  generated.shots = generated.shots.slice(0, 2);
  for (const shot of generated.shots) {
    shot.id += "-generated";
    shot.versions[0].id += "-generated";
    shot.adoptedId = shot.versions[0].id;
  }
  const [survivor, removed] = generated.shots;
  const sampleVersion = sample.shots[0].adoptedId!;
  state.projects.push(generated);
  state = applyAction(
    state,
    {
      type: "board",
      id: "mixed",
      name: "팀 배열",
      versionIds: [removed.adoptedId!, sampleVersion, survivor.adoptedId!],
    },
    editor,
  );
  const before = state.boards.find((board) => board.id === "mixed")!;
  state = applyAction(
    state,
    {
      type: "generate",
      projectId: generated.id,
      shotIds: [removed.id, survivor.id],
      key: "batch",
    },
    editor,
  );
  const running = state.jobs.find((job) => job.shotId === removed.id)!;
  markRunning(state, running.id);
  const action: Action = {
    type: "deleteShot",
    projectId: generated.id,
    shotId: removed.id,
  };
  state = applyAction(state, action, editor);
  assert.deepEqual(applyAction(state, action, editor), state);
  assert.deepEqual(state.boards.find((b) => b.id === "mixed")?.versionIds, [
    sampleVersion,
    survivor.adoptedId,
  ]);
  assert.notEqual(
    state.boards.find((b) => b.id === "mixed")?.updatedAt,
    before.updatedAt,
  );
  assert.deepEqual(
    state.jobs.map((j) => j.shotId),
    [survivor.id],
  );
  assert.throws(
    () => completeJob(state, running.id, imageResult(23)),
    /작업 결과/,
  );

  state = applyAction(
    state,
    { type: "addShot", projectId: generated.id, plan: survivor.plan },
    editor,
  );
  assert.deepEqual(
    state.projects
      .find((p) => p.id === generated.id)!
      .shots.map((shot) => shot.number),
    [1, 3],
  );
  state = applyAction(
    state,
    { type: "deleteProject", projectId: generated.id },
    editor,
  );
  assert.deepEqual(state.projects, [sample]);
  assert.deepEqual(state.jobs, []);
  assert.deepEqual(state.boards.find((b) => b.id === "mixed")?.versionIds, [
    sampleVersion,
  ]);
  assert.throws(
    () =>
      applyAction(
        state,
        { type: "deleteProject", projectId: sample.id },
        admin,
      ),
    /기본 제공/,
  );
});

test("changing adoption keeps saved board version IDs and its original art", () => {
  let state = getSeedState();
  const p = state.projects[0];
  const first = p.shots[0];
  const original = first.versions[0];
  const board = structuredClone(state.boards[0]);
  state = applyAction(
    state,
    {
      type: "uploadVersion",
      projectId: p.id,
      shotId: first.id,
      asset: p.shots[1].versions[0].image,
      note: "새 보정본",
    },
    editor,
  );
  const replacement = state.projects[0].shots[0].versions[1];
  state = applyAction(
    state,
    {
      type: "review",
      projectId: p.id,
      shotId: first.id,
      versionId: replacement.id,
      status: "adopted",
      note: "채택",
    },
    editor,
  );
  assert.equal(state.projects[0].shots[0].adoptedId, replacement.id);
  assert.equal(state.projects[0].shots[0].versions[0].status, "pending");
  assert.deepEqual(state.boards[0], board);
  const pinned = state.projects[0].shots[0].versions.find(
    (v) => v.id === state.boards[0].versionIds[0],
  );
  assert.deepEqual(pinned?.image, original.image);
});

test("updated workflow applies to new briefs while pending image generation keeps its original plan, logo and sources", () => {
  let state = getSeedState();
  const p = state.projects[0],
    shot = p.shots[0];
  const oldWorkflow = structuredClone(state.workflows[0]);
  const oldInput = {
    workflowId: p.workflowId,
    logoId: p.logoId,
    sourceIds: p.sources.map((s) => s.id),
    plan: structuredClone(shot.plan),
  };
  state = applyAction(
    state,
    { type: "generate", projectId: p.id, shotIds: [shot.id], key: "one" },
    editor,
  );
  const job = state.jobs[0];
  const update: Action = {
    type: "workflow",
    name: "새 기준",
    text: "# 다음 시즌 제작 기준",
  };
  assert.throws(() => applyAction(state, update, editor), /관리자/);
  state = applyAction(state, update, admin);
  state = applyAction(
    state,
    {
      type: "editPlan",
      projectId: p.id,
      shotId: shot.id,
      plan: { ...shot.plan, prompt: "수정된 기획 프롬프트" },
    },
    editor,
  );
  state = applyAction(
    state,
    {
      type: "sources",
      projectId: p.id,
      sources: [
        {
          id: "additional",
          kind: "memo",
          name: "새 메모",
          text: "새 재질 정보",
        },
      ],
    },
    editor,
  );
  markRunning(state, job.id);
  state = completeJob(state, job.id, imageResult(21));
  const version = state.projects[0].shots[0].versions.at(-1)!;
  assert.equal(version.prompt, oldInput.plan.prompt);
  assert.deepEqual(
    {
      workflowId: version.workflowId,
      logoId: version.logoId,
      sourceIds: version.sourceIds,
      plan: version.plan,
    },
    oldInput,
  );
  assert.deepEqual(
    state.workflows.find((w) => w.id === oldWorkflow.id),
    oldWorkflow,
  );
  state = applyAction(
    state,
    {
      type: "createProject",
      id: "newer",
      name: "다음 시즌",
      keyword: "클레이",
      season: "FW27",
      count: 1,
      sources: [],
      logoId: "guide",
      research: false,
    },
    editor,
  );
  assert.equal(state.projects[0].workflowId, state.workflows[0].id);
  assert.equal(
    state.projects.find((project) => project.id === p.id)?.workflowId,
    oldWorkflow.id,
  );
});

test("a stale board edit cannot overwrite another editor’s selection", () => {
  const state = getSeedState(),
    original = state.boards[0];
  const action: Action = {
    type: "board",
    id: original.id,
    name: "첫 수정",
    versionIds: original.versionIds.slice(0, 3),
    baseUpdatedAt: original.updatedAt,
  };
  const next = applyAction(state, action, editor);
  assert.deepEqual(applyAction(next, action, editor), next);
  assert.throws(
    () => applyAction(next, { ...action, name: "덮어쓰기" }, editor),
    /다른 팀원/,
  );
});

test("a completed research retry fills an untouched evidence placeholder in place", () => {
  let state = getSeedState();
  const p = state.projects[0],
    template = p.shots[0].plan;
  const placeholder = {
    ...template,
    title: "보완 필요",
    scene: "",
    reason: "",
    prompt: "",
    claims: [
      {
        id: "needs-evidence",
        kind: "자료 관찰" as const,
        verified: false,
        fact: "근거 부족",
        sourceTitle: "",
      },
    ],
  };
  state = applyAction(
    state,
    { type: "addShot", projectId: p.id, plan: placeholder },
    editor,
  );
  const empty = state.projects[0].shots.at(-1)!;
  state = applyAction(
    state,
    { type: "research", projectId: p.id, key: "more-evidence" },
    editor,
  );
  markRunning(state, state.jobs[0].id);
  state = completeJob(state, state.jobs[0].id, {
    kind: "research",
    plans: [template],
  });
  assert.equal(state.projects[0].shots.length, 21);
  assert.equal(state.projects[0].shots.at(-1)?.id, empty.id);
  assert.equal(state.projects[0].shots.at(-1)?.plan.title, template.title);
});
