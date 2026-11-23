import { nextShotNumber } from "./library";
import { observationFields } from "./editorial";
import { supportedClaim } from "./provenance";
import { randomUUID } from "node:crypto";
import type {
  Action,
  Asset,
  Job,
  JobResult,
  Plan,
  Project,
  Shot,
  Source,
  StudioState,
  Viewer,
} from "./types";

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function field(value: unknown, label: string, max = 4096): string {
  requireValue(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    label + "을(를) 확인해 주세요.",
  );
  return value.trim();
}
function ident(value: unknown): string {
  requireValue(
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value),
    "올바르지 않은 식별자입니다.",
  );
  return value;
}
function web(value: unknown) {
  try {
    return (
      typeof value === "string" &&
      ["https:", "http:"].includes(new URL(value).protocol)
    );
  } catch {
    return false;
  }
}
function checkAsset(asset: Asset, imageOnly = false) {
  requireValue(asset && typeof asset === "object", "파일을 선택해 주세요.");
  ident(asset.id);
  field(asset.name, "파일 이름");
  requireValue(
    asset.url === "/api/assets/" + asset.id ||
      /^\/sample\/(Feed\/[\w-]+\.jpg|wordmark-guide\.png)$/.test(asset.url),
    "등록한 파일만 연결할 수 있습니다.",
  );
  requireValue(
    [
      "image/png",
      "image/jpeg",
      "image/webp",
      ...(imageOnly ? [] : ["application/pdf"]),
    ].includes(asset.mime),
    "지원하지 않는 파일 형식입니다.",
  );
}
function checkSources(sources: Source[]) {
  requireValue(
    Array.isArray(sources) && sources.length <= 100,
    "프로젝트 자료는 100개까지 연결할 수 있습니다.",
  );
  requireValue(
    new Set(sources.map((s) => s.id)).size === sources.length,
    "중복된 자료입니다.",
  );
  for (const source of sources) {
    ident(source.id);
    field(source.name, "자료 이름");
    switch (source.kind) {
      case "url":
        requireValue(web(source.url), "자료의 웹 주소를 확인해 주세요.");
        break;
      case "memo":
        field(source.text, "메모", 100000);
        break;
      case "mood":
        requireValue(
          source.asset || web(source.url),
          "무드 이미지나 레퍼런스 URL을 연결해 주세요.",
        );
        if (source.url)
          requireValue(web(source.url), "레퍼런스 주소를 확인해 주세요.");
        if (source.asset) checkAsset(source.asset, true);
        if (source.referenceRole)
          requireValue(
            ["base", "prefer", "avoid"].includes(source.referenceRole),
            "레퍼런스 활용 방식을 확인해 주세요.",
          );
        if (source.referenceNumber !== undefined)
          requireValue(
            Number.isInteger(source.referenceNumber) &&
              source.referenceNumber > 0,
            "기준 컷 번호를 확인해 주세요.",
          );
        if (
          source.referenceRole === "prefer" ||
          source.referenceRole === "avoid"
        )
          field(source.text, "레퍼런스 선택 이유", 4096);
        for (const [key] of observationFields)
          if (source.observation?.[key])
            field(source.observation[key], "시각 관찰", 1024);
        break;
      case "pdf":
        requireValue(source.asset, "첨부 파일을 선택해 주세요.");
        checkAsset(source.asset);
        requireValue(
          source.asset.mime === "application/pdf",
          "PDF 파일을 선택해 주세요.",
        );
        break;
      default:
        throw new Error("지원하지 않는 자료입니다.");
    }
  }
}
function checkPlan(plan: Plan, p: Project) {
  requireValue(plan && typeof plan === "object", "컷 기획을 확인해 주세요.");
  if (plan.visualReferences) {
    requireValue(
      Array.isArray(plan.visualReferences) && plan.visualReferences.length <= 6,
      "시각 참고 자료를 확인해 주세요.",
    );
    for (const ref of plan.visualReferences) {
      requireValue(web(ref.url), "시각 참고 자료의 주소를 확인해 주세요.");
      field(ref.title, "시각 참고 자료 이름", 1024);
      field(ref.observation, "시각 관찰", 4096);
      if (ref.pinterestImage) checkAsset(ref.pinterestImage, true);
    }
  }
  for (const k of [
    "title",
    "theme",
    "reason",
    "scene",
    "subject",
    "material",
    "light",
    "framing",
    "logoProcess",
    "mood",
    "genre",
    "prompt",
  ] as const)
    requireValue(
      typeof plan[k] === "string" && plan[k].length <= 20000,
      "기획 입력을 확인해 주세요.",
    );
  for (const key of ["logoPlacement", "logoDetail", "reviewNote"] as const)
    if (plan[key] !== undefined)
      requireValue(
        typeof plan[key] === "string" && plan[key].length <= 4096,
        "연출 브리프를 확인해 주세요.",
      );
  field(plan.title, "컷 제목");
  if (plan.referenceIds)
    requireValue(
      Array.isArray(plan.referenceIds) &&
        plan.referenceIds.every((id) =>
          p.sources.some(
            (s) =>
              s.id === id && s.kind === "mood" && s.referenceRole !== "avoid",
          ),
        ),
      "등록한 무드 레퍼런스를 선택해 주세요.",
    );
  requireValue(
    Array.isArray(plan.claims) && plan.claims.length <= 100,
    "근거 목록을 확인해 주세요.",
  );
  for (const c of plan.claims) {
    field(c.fact, "근거 문장");
    ident(c.id);
    requireValue(
      ["전망", "런웨이 관찰", "실측", "자료 관찰"].includes(c.kind),
      "근거 유형을 확인해 주세요.",
    );
    if (c.url) requireValue(web(c.url), "출처 주소를 확인해 주세요.");
    if (c.sourceId)
      requireValue(
        p.sources.some((s) => s.id === c.sourceId),
        "연결된 자료를 찾을 수 없습니다.",
      );
    if (!c.verified) continue;
    const source = p.sources.find((s) => s.id === c.sourceId);
    requireValue(
      source?.kind !== "mood" && (c.url || source),
      "근거의 원문을 연결해 주세요.",
    );
    if (source?.kind === "memo")
      requireValue(
        c.kind === "자료 관찰",
        "팀 메모는 자료 관찰로 기록해 주세요.",
      );
    if (source?.kind === "pdf")
      requireValue(
        Number.isInteger(c.page) && c.page! > 0,
        "근거의 PDF 페이지를 확인해 주세요.",
      );
    if (c.kind === "실측")
      requireValue(
        c.period?.trim() && c.region?.trim() && c.unit?.trim(),
        "실측 자료에는 기간·지역·단위가 필요합니다.",
      );
  }
}
function checkPinterestAssets(plan: Plan, project: Project) {
  const registered = project.shots.flatMap(
    (shot) => shot.plan.visualReferences ?? [],
  );
  for (const reference of plan.visualReferences ?? []) {
    const asset = reference.pinterestImage;
    if (!asset) continue;
    requireValue(
      registered.some(
        (ref) =>
          ref.url === reference.url &&
          ref.pinterestImage?.id === asset.id &&
          ref.pinterestImage.url === asset.url &&
          ref.pinterestImage.name === asset.name &&
          ref.pinterestImage.mime === asset.mime,
      ),
      "리서치에서 등록한 Pinterest 이미지를 선택해 주세요.",
    );
  }
}

const now = () => new Date().toISOString();
function snapshot(p: Project, plan: Plan) {
  return {
    plan: structuredClone(plan),
    logoId: p.logoId,
    workflowId: p.workflowId,
    sourceIds: [
      ...new Set([
        ...plan.claims.flatMap((c) => (c.sourceId ? [c.sourceId] : [])),
        ...(plan.referenceIds || []),
      ]),
    ],
  };
}
function getProject(state: StudioState, id: string) {
  const p = state.projects.find((p) => p.id === id);
  requireValue(p, "프로젝트를 찾을 수 없습니다.");
  return p;
}
function getShot(p: Project, id?: string) {
  const shot = p.shots.find((s) => s.id === id);
  requireValue(shot, "컷을 찾을 수 없습니다.");
  return shot;
}
function enqueue(
  state: StudioState,
  project: Project,
  kind: Job["kind"],
  key: string,
  shotId?: string,
  revision?: Job["input"],
) {
  ident(key);
  if (
    state.jobs.some(
      (j) =>
        j.projectId === project.id &&
        j.kind === kind &&
        j.shotId === shotId &&
        (j.key === key || j.status === "queued" || j.status === "running"),
    )
  )
    return;
  const input =
    revision ??
    (shotId ? snapshot(project, getShot(project, shotId).plan) : undefined);
  state.jobs.push({
    id: randomUUID(),
    kind,
    projectId: project.id,
    shotId,
    key,
    status: "queued",
    createdAt: now(),
    input,
  });
}

export function applyAction(
  previous: StudioState,
  action: Action,
  viewer: Viewer,
): StudioState {
  requireValue(action && typeof action === "object", "요청을 확인해 주세요.");
  const state = structuredClone(previous);
  if (action.type === "createProject") {
    const id = ident(action.id);
    if (state.projects.some((p) => p.id === id)) return state;
    requireValue(
      Number.isInteger(action.count) &&
        action.count >= 1 &&
        action.count <= 100,
      "목표 컷 수는 1~100입니다.",
    );
    checkSources(action.sources);
    requireValue(
      state.logos.some((l) => l.id === action.logoId),
      "등록한 로고를 선택해 주세요.",
    );
    const p: Project = {
      id,
      name: field(action.name, "프로젝트명"),
      keyword: field(action.keyword, "키워드"),
      season: field(action.season, "시즌"),
      count: action.count,
      sources: action.sources,
      workflowId: state.workflows[0].id,
      logoId: action.logoId,
      shots: [],
      createdAt: now(),
      createdBy: viewer.email,
      ...(action.quick === true && { quick: true }),
    };
    state.projects.unshift(p);
    if (action.research !== false) enqueue(state, p, "research", id);
    return state;
  }
  if (action.type === "workflow" || action.type === "logo") {
    requireValue(
      viewer.role === "admin",
      "관리자만 제작 기준과 로고를 변경할 수 있습니다.",
    );
    if (action.type === "workflow")
      state.workflows.unshift({
        id: randomUUID(),
        name: field(action.name, "기준 이름"),
        text: field(action.text, "제작 기준", 200000),
        createdAt: now(),
      });
    else {
      checkAsset(action.asset, true);
      state.logos.unshift({
        id: randomUUID(),
        name: field(action.name, "로고 이름"),
        asset: action.asset,
        official: action.official === true,
      });
    }
    return state;
  }
  if (action.type === "board") {
    const id = ident(action.id),
      name = field(action.name, "배열 이름");
    requireValue(
      Array.isArray(action.versionIds) && action.versionIds.length <= 150,
      "배열은 최대 150컷입니다.",
    );
    const valid = new Set(
      state.projects.flatMap((p) =>
        p.shots.flatMap((s) => s.versions.map((v) => v.id)),
      ),
    );
    requireValue(
      action.versionIds.every((v) => valid.has(v)) &&
        new Set(action.versionIds).size === action.versionIds.length,
      "배열 버전을 확인해 주세요.",
    );
    const previousBoard = state.boards.find((b) => b.id === id);
    if (
      previousBoard &&
      previousBoard.name === name &&
      previousBoard.versionIds.length === action.versionIds.length &&
      previousBoard.versionIds.every((v, i) => v === action.versionIds[i])
    )
      return state;
    requireValue(
      !action.baseUpdatedAt ||
        previousBoard?.updatedAt === action.baseUpdatedAt,
      "다른 팀원이 배열을 변경했습니다. 최신 배열을 열어 확인해 주세요.",
    );
    const board = { id, name, versionIds: action.versionIds, updatedAt: now() };
    state.boards = [board, ...state.boards.filter((b) => b.id !== id)];
    return state;
  }
  if (action.type === "retry") {
    const j = state.jobs.find((j) => j.id === action.jobId);
    requireValue(j, "작업을 찾을 수 없습니다.");
    ident(action.key);
    if (j.status !== "failed" || j.retryKeys?.includes(action.key))
      return state;
    if (
      state.jobs.some(
        (x) =>
          x.id !== j.id &&
          x.kind === j.kind &&
          x.projectId === j.projectId &&
          x.shotId === j.shotId &&
          ["running", "queued"].includes(x.status),
      )
    )
      return state;
    j.retryKeys = [...(j.retryKeys || []), action.key];
    j.status = "queued";
    delete j.error;
    return state;
  }
  if (action.type === "deleteProject" || action.type === "deleteShot") {
    const projectId = ident(action.projectId);
    const shotId =
      action.type === "deleteShot" ? ident(action.shotId) : undefined;
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return state;
    requireValue(!project.sample, "기본 제공 예시는 삭제할 수 없습니다.");
    const shot = shotId
      ? project.shots.find((item) => item.id === shotId)
      : undefined;
    if (shotId && !shot) return state;

    const removed = shot ? [shot] : project.shots;
    const versions = new Set(
      removed.flatMap((item) => item.versions.map((version) => version.id)),
    );
    if (shot) {
      project.lastShotNumber = nextShotNumber(project) - 1;
      project.shots = project.shots.filter((item) => item.id !== shotId);
    } else {
      state.projects = state.projects.filter((item) => item.id !== projectId);
    }
    state.jobs = state.jobs.filter(
      (job) =>
        job.projectId !== projectId ||
        (shotId !== undefined && job.shotId !== shotId),
    );
    for (const board of state.boards) {
      const remaining = board.versionIds.filter((id) => !versions.has(id));
      if (remaining.length !== board.versionIds.length) {
        board.versionIds = remaining;
        // Invalidate open board drafts even when another edit happened this millisecond.
        const previousTime = Date.parse(board.updatedAt) || 0;
        board.updatedAt = new Date(
          Math.max(Date.now(), previousTime + 1),
        ).toISOString();
      }
    }
    return state;
  }
  requireValue("projectId" in action, "지원하지 않는 작업입니다.");
  const p = getProject(state, action.projectId);
  switch (action.type) {
    case "research":
      enqueue(state, p, "research", action.key);
      break;
    case "sources": {
      checkSources(action.sources);
      // Keep original source IDs addressable by existing versions and queued jobs.
      const byId = new Map(p.sources.map((s) => [s.id, s]));
      for (const s of action.sources) {
        if (!byId.has(s.id)) byId.set(s.id, s);
      }
      p.sources = [...byId.values()];
      break;
    }
    case "addShot": {
      checkPlan(action.plan, p);
      checkPinterestAssets(action.plan, p);
      const number = action.number ?? nextShotNumber(p);
      requireValue(
        Number.isInteger(number) && number > 0 && number <= 9999,
        "컷 번호를 확인해 주세요.",
      );
      requireValue(
        !p.shots.some((shot) => shot.number === number),
        "이미 사용한 컷 번호입니다.",
      );
      p.shots.push({
        id: randomUUID(),
        number,
        plan: action.plan,
        versions: [],
      });
      p.shots.sort((a, b) => a.number - b.number);
      break;
    }
    case "editPlan":
      checkPlan(action.plan, p);
      checkPinterestAssets(action.plan, p);
      getShot(p, action.shotId).plan = action.plan;
      break;
    case "generate": {
      requireValue(
        Array.isArray(action.shotIds) &&
          action.shotIds.length > 0 &&
          action.shotIds.length <= 100,
        "생성할 컷을 선택해 주세요.",
      );
      for (const id of new Set(action.shotIds)) {
        const shot = getShot(p, id);
        checkPlan(shot.plan, p);
        requireValue(
          shot.plan.claims.some((c) => supportedClaim(c, p.sources)) &&
            shot.plan.reason.trim() &&
            shot.plan.scene.trim() &&
            shot.plan.prompt.trim(),
          "생성하려면 확인된 근거와 선정 이유, 장면, 프롬프트가 필요합니다.",
        );
        enqueue(state, p, "generate", action.key, id);
      }
      break;
    }
    case "refineShot": {
      const shot = getShot(p, action.shotId);
      const base = shot.versions.find((v) => v.id === action.versionId);
      requireValue(base, "수정할 초안 버전을 찾을 수 없습니다.");
      const refinement = field(action.instruction, "수정 요청", 1500);
      const plan = structuredClone(shot.plan);
      requireValue(
        plan.claims.some((c) => supportedClaim(c, p.sources)) &&
          plan.prompt.trim(),
        "수정하려면 확인된 근거와 컷 기획이 필요합니다.",
      );
      plan.prompt +=
        "\n\n위 컷의 이전 버전 사진을 바탕으로 다음 수정 요청을 반영하세요. 요청에 언급되지 않은 주제와 구도는 가능한 한 유지하고 두 번째 입력의 워드마크로 로고를 확인하세요.\n수정 요청: " +
        refinement;
      checkPlan(plan, p);
      enqueue(state, p, "generate", action.key, shot.id, {
        ...snapshot(p, plan),
        refinement,
        baseVersionId: base.id,
      });
      break;
    }
    case "uploadVersion": {
      checkAsset(action.asset, true);
      const shot = getShot(p, action.shotId),
        input = snapshot(p, shot.plan);
      shot.versions.push({
        ...input,
        id: randomUUID(),
        image: action.asset,
        status: "pending",
        createdAt: now(),
        note: action.note || "",
        prompt: shot.plan.prompt,
        model: "직접 업로드",
      });
      break;
    }
    case "review": {
      const shot = getShot(p, action.shotId),
        version = shot.versions.find((v) => v.id === action.versionId);
      requireValue(
        version && ["adopted", "held"].includes(action.status),
        "검수할 버전을 확인해 주세요.",
      );
      if (action.status === "held") field(action.note, "보류 사유", 20000);
      if (action.status === "adopted") {
        const old = shot.versions.find((v) => v.id === shot.adoptedId);
        if (old && old.id !== version.id) old.status = "pending";
        shot.adoptedId = version.id;
      } else if (shot.adoptedId === version.id) delete shot.adoptedId;
      version.status = action.status;
      version.note = String(action.note || "").slice(0, 20000);
      break;
    }
    default:
      throw new Error("지원하지 않는 작업입니다.");
  }
  return state;
}
export function completeJob(
  previous: StudioState,
  id: string,
  result: JobResult,
): StudioState {
  const state = structuredClone(previous),
    job = state.jobs.find((j) => j.id === id);
  requireValue(
    job && job.kind === result.kind,
    "작업 결과가 일치하지 않습니다.",
  );
  if (job.status === "succeeded") return state;
  requireValue(
    job.status === "running",
    "실행 중인 작업만 완료할 수 있습니다.",
  );
  const project = getProject(state, job.projectId);
  if (result.kind === "research") {
    requireValue(result.plans.length > 0, "기획안이 없습니다.");
    if (result.pinterestReferences !== undefined)
      project.pinterestReferences = result.pinterestReferences;
    // Fill untouched research placeholders in place, preserving shot numbering.
    const empty = project.shots.filter(
      (s) =>
        !s.versions.length &&
        !s.plan.prompt &&
        !s.plan.reason &&
        !s.plan.scene &&
        s.plan.claims.length === 1 &&
        s.plan.claims[0].id === "needs-evidence",
    );
    const shouldCreateDrafts =
      project.quick &&
      !state.jobs.some(
        (j) => j.projectId === project.id && j.kind === "generate",
      );
    const planned: Shot[] = [];
    for (const plan of result.plans) {
      checkPlan(plan, project);
      const placeholder = empty.shift();
      if (placeholder) {
        placeholder.plan = plan;
        planned.push(placeholder);
        continue;
      }
      const shot = {
        id: randomUUID(),
        number: nextShotNumber(project),
        plan,
        versions: [],
      };
      project.shots.push(shot);
      planned.push(shot);
    }
    if (shouldCreateDrafts) {
      for (const { id, plan } of planned) {
        if (
          plan.reason.trim() &&
          plan.scene.trim() &&
          plan.prompt.trim() &&
          plan.claims.some((c) => supportedClaim(c, project.sources))
        )
          enqueue(state, project, "generate", job.id, id);
      }
    }
  } else {
    const shot = getShot(project, job.shotId),
      input = job.input;
    requireValue(input, "생성 당시의 기획을 찾을 수 없습니다.");
    checkAsset(result.image, true);
    shot.versions.push({
      ...input,
      id: randomUUID(),
      image: result.image,
      createdAt: now(),
      status: "pending",
      note: "",
      prompt: result.executionPrompt ?? input.plan.prompt,
      model: result.model,
      ...(result.imageReferenceIds && {
        imageReferenceIds: result.imageReferenceIds,
      }),
    });
  }
  job.status = "succeeded";
  delete job.error;
  return state;
}
