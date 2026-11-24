"use client";

import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Brush,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileSearch,
  FileText,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  Action,
  Claim,
  Job,
  Plan,
  Project,
  Shot,
  Source,
  StudioClient,
} from "../lib/types";
import { nextShotNumber, pad, thumb } from "../lib/library";
import { buildPrompt, observationText, referenceRoles } from "../lib/editorial";
import {
  FlowField,
  SourceEditor,
  WorkflowModal,
  claimIssue,
  claimLink,
  newId,
  sourceError,
  sourceLabel,
} from "./ProjectDialogs";
import "./workflow.css";

function emptyPlan(): Plan {
  return {
    title: "",
    theme: "",
    reason: "",
    scene: "",
    subject: "",
    material: "",
    light: "",
    framing: "세로 4:5",
    logoProcess: "",
    mood: "",
    genre: "패션",
    prompt: "",
    claims: [],
  };
}

function newClaim(): Claim {
  return {
    id: newId(),
    kind: "자료 관찰",
    fact: "",
    sourceTitle: "",
    verified: false,
  };
}

function citedURL(url?: string) {
  if (!url) return;
  try {
    const value = new URL(url);
    return ["https:", "http:"].includes(value.protocol)
      ? value.href
      : undefined;
  } catch {
    return;
  }
}

function ClaimForm({
  claim,
  sources,
  update,
  remove,
}: {
  claim: Claim;
  sources: Source[];
  update: (claim: Claim) => void;
  remove: () => void;
}) {
  const source = sources.find((s) => s.id === claim.sourceId);
  const set = (changes: Partial<Claim>) =>
    update({ ...claim, verified: false, ...changes });
  return (
    <div className="cw-claim-form">
      <div className="cw-between">
        <select
          className="cw-claim-kind"
          aria-label="근거 유형"
          value={claim.kind}
          onChange={(e) => set({ kind: e.target.value as Claim["kind"] })}
        >
          {(["전망", "런웨이 관찰", "실측", "자료 관찰"] as const).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button
          type="button"
          aria-label="근거 삭제"
          className="cw-mini-icon"
          onClick={remove}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <FlowField label="확인한 사실">
        <textarea
          rows={2}
          value={claim.fact}
          placeholder="원문에서 확인할 수 있는 내용을 입력하세요."
          onChange={(e) => set({ fact: e.target.value })}
        />
      </FlowField>
      <div className="cw-grid2">
        <FlowField label="출처명">
          <input
            value={claim.sourceTitle}
            placeholder="발행처 · 자료 제목"
            onChange={(e) => set({ sourceTitle: e.target.value })}
          />
        </FlowField>
        <FlowField label="발행일 또는 시즌">
          <input
            value={claim.date ?? ""}
            placeholder="예) 2026-10-12"
            onChange={(e) => set({ date: e.target.value })}
          />
        </FlowField>
      </div>
      <FlowField label="원문 URL">
        <input
          type="url"
          value={claim.url ?? ""}
          placeholder="https://"
          disabled={Boolean(source)}
          onChange={(e) => set({ url: e.target.value })}
        />
      </FlowField>
      {!!sources.length && (
        <FlowField label="프로젝트 자료 연결">
          <select
            value={claim.sourceId ?? ""}
            onChange={(e) => {
              const next = sources.find((s) => s.id === e.target.value);
              set({
                sourceId: next?.id,
                sourceTitle: next?.name || claim.sourceTitle,
                url: next?.kind === "url" ? next.url : undefined,
                excerpt: undefined,
                kind: next?.kind === "memo" ? "자료 관찰" : claim.kind,
                page: undefined,
              });
            }}
          >
            <option value="">자료 선택</option>
            {sources
              .filter((s) => s.kind !== "mood")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {sourceLabel[s.kind]} · {s.name}
                </option>
              ))}
          </select>
        </FlowField>
      )}
      {source?.kind === "pdf" && (
        <FlowField label="PDF 페이지">
          <input
            type="number"
            min={1}
            step={1}
            value={claim.page ?? ""}
            onChange={(e) =>
              set({ page: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </FlowField>
      )}
      <FlowField label={claim.url ? "인용 연결 문장" : "자료 발췌"}>
        <textarea
          rows={2}
          value={claim.excerpt ?? ""}
          onChange={(e) => set({ excerpt: e.target.value })}
        />
      </FlowField>
      {claim.kind === "실측" && (
        <div className="cw-grid3">
          {(
            [
              ["period", "측정 기간"],
              ["region", "지역"],
              ["unit", "단위"],
            ] as const
          ).map(([key, label]) => (
            <FlowField label={label} key={key}>
              <input
                value={claim[key] ?? ""}
                onChange={(e) => set({ [key]: e.target.value })}
              />
            </FlowField>
          ))}
        </div>
      )}
      <label className="cw-check">
        <input
          type="checkbox"
          checked={claim.verified}
          onChange={(e) => update({ ...claim, verified: e.target.checked })}
        />
        원문과 대조했습니다
      </label>
    </div>
  );
}

function PlanDialog({
  client,
  project,
  shot,
  duplicate,
  onClose,
}: {
  client: StudioClient;
  project: Project;
  shot?: Shot;
  duplicate?: boolean;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<Plan>(() =>
    shot
      ? {
          ...structuredClone(shot.plan),
          title: duplicate ? shot.plan.title + " 복제" : shot.plan.title,
        }
      : emptyPlan(),
  );
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState("");
  const [tab, setTab] = useState<"concept" | "claims" | "prompt">("concept");
  const [error, setError] = useState("");
  const fresh = !shot || duplicate;
  type TextField = Exclude<
    keyof Plan,
    "claims" | "referenceIds" | "visualReferences"
  >;
  const [customPrompt, setCustomPrompt] = useState(
    Boolean(shot?.plan.prompt && shot.plan.prompt !== buildPrompt(shot.plan)),
  );
  const moodSources = project.sources.filter(
    (source) => source.kind === "mood" && source.referenceRole !== "avoid",
  );
  function compose(draft: Plan) {
    const observations = moodSources
      .filter((source) => draft.referenceIds?.includes(source.id))
      .map((source) =>
        [observationText(source.observation), source.text]
          .filter(Boolean)
          .join(" · "),
      )
      .filter(
        (observation) => observation && !draft.mood.includes(observation),
      );
    return buildPrompt({
      ...draft,
      mood: [draft.mood, ...observations].filter(Boolean).join("\n"),
    });
  }
  const updateText = (id: TextField, value: string) => {
    if (id === "prompt") setCustomPrompt(true);
    setPlan((current) => {
      const next = { ...current, [id]: value };
      if (
        id !== "title" &&
        id !== "prompt" &&
        !customPrompt &&
        next.scene.trim()
      )
        next.prompt = compose(next);
      return next;
    });
  };
  const field = (
    key: TextField,
    label: string,
    hint?: string,
    lines?: number,
  ) => (
    <FlowField key={key} label={label} hint={hint}>
      {lines ? (
        <textarea
          rows={lines}
          value={plan[key] ?? ""}
          onChange={(e) => updateText(key, e.target.value)}
        />
      ) : (
        <input
          value={plan[key] ?? ""}
          onChange={(e) => updateText(key, e.target.value)}
        />
      )}
    </FlowField>
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!plan.title.trim()) {
      setTab("concept");
      setError("컷 제목을 입력해 주세요.");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError("");
    const draft = {
      ...plan,
      title: plan.title.trim(),
      claims: plan.claims.filter(
        (c) => c.fact.trim() || c.sourceTitle.trim() || c.excerpt?.trim(),
      ),
    };
    try {
      const ok = await client.act(
        fresh
          ? {
              type: "addShot",
              projectId: project.id,
              plan: draft,
              ...(number && { number: Number(number) }),
            }
          : {
              type: "editPlan",
              projectId: project.id,
              shotId: shot!.id,
              plan: draft,
            },
      );
      if (ok) {
        client.notify(fresh ? "컷을 추가했습니다." : "컷 기획을 저장했습니다.");
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }
  const match = claimIssue(plan, project.sources);
  return (
    <WorkflowModal
      title={fresh ? (duplicate ? "컷 기획 복제" : "컷 추가") : "컷 기획 편집"}
      eyebrow={
        fresh ? project.name : `Shot ${pad(shot!.number)} / ${project.name}`
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="cw-form" onSubmit={save}>
        <div className="cw-scroll cw-stack">
          <div className="cw-tabs">
            {(
              [
                ["concept", "연출 브리프"],
                ["claims", `근거 ${plan.claims.length}`],
                ["prompt", "생성 프롬프트"],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "concept" && (
            <>
              {field("title", "컷 제목")}
              {fresh && (
                <FlowField
                  label="컷 번호"
                  hint="비워 두면 다음 번호를 사용합니다. 저장하면 컷 번호가 고정됩니다."
                >
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    placeholder={pad(nextShotNumber(project))}
                  />
                </FlowField>
              )}
              <div className="cw-grid2">
                {field("theme", "주제 · 컬러")}
                {field("genre", "장르")}
              </div>
              {field(
                "reason",
                "이 컷을 만드는 이유",
                "조사한 사실이 클라모아의 시각적 선택과 어떻게 이어지는지 적어 주세요.",
                2,
              )}
              <div className="cw-grid2">
                {field("subject", "주인공 · 피사체")}
                {field("material", "소재")}
              </div>
              {field("scene", "장면과 시각적 아이디어", undefined, 2)}
              <div className="cw-grid2">
                {field("light", "조명")}
                {field("framing", "거리 · 프레이밍")}
              </div>
              {moodSources.length > 0 && (
                <div className="cw-stack--tight">
                  <strong className="cw-legend">
                    이 컷에 연결할 무드 레퍼런스
                  </strong>
                  <div className="cw-ref-options">
                    {moodSources.map((source) => (
                      <label
                        key={source.id}
                        className={
                          "cw-ref-option" +
                          (source.asset ? "" : " cw-ref-option--link")
                        }
                      >
                        <input
                          type="checkbox"
                          checked={
                            plan.referenceIds?.includes(source.id) ?? false
                          }
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setPlan((p) => {
                              const refs = p.referenceIds ?? [];
                              const next = {
                                ...p,
                                referenceIds: checked
                                  ? [...refs, source.id]
                                  : refs.filter((id) => id !== source.id),
                              };
                              return !customPrompt && next.scene.trim()
                                ? { ...next, prompt: compose(next) }
                                : next;
                            });
                          }}
                        />
                        {source.asset && (
                          <img alt="" src={thumb(source.asset.url)} />
                        )}
                        <span>{source.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {plan.visualReferences?.map((ref) => (
                <div className="cw-trace" key={ref.url + "|" + ref.observation}>
                  <a
                    href={citedURL(ref.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="cw-link"
                  >
                    {ref.title}
                    <ExternalLink size={12} />
                  </a>
                  <p className="cw-note">{ref.observation}</p>
                </div>
              ))}
              {field(
                "mood",
                "무드 레퍼런스 관찰",
                "참고할 빛·색·질감·프레이밍을 적어 주세요.",
                2,
              )}
              <div className="cw-grid2">
                {field("logoPlacement", "로고 위치")}
                {field("logoProcess", "로고 가공 방식")}
              </div>
              {field("logoDetail", "로고 가공 디테일", undefined, 2)}
              {field(
                "reviewNote",
                "검수 기준",
                "번호 보드와 원본 확대에서 확인할 요소를 적어 주세요.",
                2,
              )}
            </>
          )}
          {tab === "claims" && (
            <div className="cw-stack">
              {plan.claims.length === 0 && (
                <p className="cw-note">
                  주제와 장면을 뒷받침하는 근거와 출처를 등록하세요.
                </p>
              )}
              {plan.claims.map((claim) => (
                <ClaimForm
                  key={claim.id}
                  claim={claim}
                  sources={project.sources}
                  update={(next) =>
                    setPlan((p) => ({
                      ...p,
                      claims: p.claims.map((c) =>
                        c.id === claim.id ? next : c,
                      ),
                    }))
                  }
                  remove={() =>
                    setPlan((p) => ({
                      ...p,
                      claims: p.claims.filter((c) => c.id !== claim.id),
                    }))
                  }
                />
              ))}
              <div>
                <button
                  type="button"
                  className="cw-btn"
                  onClick={() =>
                    setPlan((p) => ({
                      ...p,
                      claims: [...p.claims, newClaim()],
                    }))
                  }
                >
                  <Plus size={14} />
                  근거 추가
                </button>
              </div>
            </div>
          )}
          {tab === "prompt" && (
            <>
              <div className="cw-between">
                <strong className="cw-legend">실행할 프롬프트</strong>
                <button
                  type="button"
                  className="cw-btn"
                  onClick={() => {
                    setCustomPrompt(false);
                    setPlan((p) => ({ ...p, prompt: compose(p) }));
                  }}
                >
                  <Brush size={14} />
                  브리프로 조립
                </button>
              </div>
              <textarea
                aria-label="이미지 생성 프롬프트"
                rows={12}
                value={plan.prompt}
                onChange={(e) => updateText("prompt", e.target.value)}
              />
              <p className="cw-note">
                {match ||
                  "확인된 근거와 컷 기획을 바탕으로 이미지 생성을 요청할 수 있습니다."}
              </p>
            </>
          )}
          {error && (
            <p className="cw-alert" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="cw-footer">
          <button
            type="button"
            className="cw-btn"
            onClick={onClose}
            disabled={busy}
          >
            취소
          </button>
          <button className="cw-btn cw-btn--dark" disabled={busy}>
            {fresh ? "컷 추가" : "기획 저장"}
            <Check size={14} />
          </button>
        </footer>
      </form>
    </WorkflowModal>
  );
}

function SourcesDialog({
  client,
  project,
  onClose,
}: {
  client: StudioClient;
  project: Project;
  onClose: () => void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!busy && !uploading) onClose();
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    const issue = sourceError(sources);
    if (issue) {
      setError(issue);
      return;
    }
    if (busy || uploading) return;
    setBusy(true);
    try {
      if (
        await client.act({
          type: "sources",
          projectId: project.id,
          sources: [...project.sources, ...sources],
        })
      ) {
        client.notify("프로젝트 자료를 저장했습니다.");
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkflowModal
      title="프로젝트 자료 추가"
      eyebrow={project.name}
      onClose={close}
    >
      <form className="cw-form" onSubmit={save}>
        <div className="cw-scroll cw-stack">
          {project.sources.length > 0 && (
            <details className="cw-detail">
              <summary>
                등록된 자료 {project.sources.length}건<ChevronDown size={14} />
              </summary>
              <div className="cw-stack--tight">
                {project.sources.map((s) => (
                  <p className="cw-note" key={s.id}>
                    {sourceLabel[s.kind]} · {s.name}
                  </p>
                ))}
              </div>
            </details>
          )}
          <SourceEditor
            sources={sources}
            onChange={setSources}
            client={client}
            onUploading={setUploading}
          />
          {error && (
            <p role="alert" className="cw-alert">
              {error}
            </p>
          )}
        </div>
        <footer className="cw-footer">
          <button
            className="cw-btn"
            type="button"
            disabled={uploading || busy}
            onClick={close}
          >
            취소
          </button>
          <button
            className="cw-btn cw-btn--dark"
            disabled={busy || uploading || !sources.length}
          >
            자료 저장
          </button>
        </footer>
      </form>
    </WorkflowModal>
  );
}

const isActive = (job?: Job) =>
  job?.status === "running" || job?.status === "queued";
const jobLabel = {
  queued: "대기",
  running: "진행 중",
  succeeded: "완료",
  failed: "실패",
};

export function DeleteContentDialog({
  client,
  project,
  shot,
  onClose,
  onDeleted,
}: {
  client: StudioClient;
  project: Project;
  shot?: Shot;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const kind = shot ? "컷" : "프로젝트";
  const title = shot ? `${pad(shot.number)} ${shot.plan.title}` : project.name;
  const versions = new Set(
    (shot ? [shot] : project.shots).flatMap((item) =>
      item.versions.map((v) => v.id),
    ),
  );
  const boardCount = client.data.state.boards.filter((board) =>
    board.versionIds.some((id) => versions.has(id)),
  ).length;
  async function remove(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await client.act(
        shot
          ? { type: "deleteShot", projectId: project.id, shotId: shot.id }
          : { type: "deleteProject", projectId: project.id },
      );
      if (result) {
        client.notify(shot ? "컷을 삭제했습니다." : "프로젝트를 삭제했습니다.");
        onDeleted();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkflowModal
      title={kind + " 삭제"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="cw-form" onSubmit={remove}>
        <div className="cw-scroll cw-stack--tight">
          <p className="cw-body-text">
            「{title}」{shot ? " 컷을" : " 프로젝트를"} 삭제할까요?
          </p>
          <p className="cw-note">
            {shot
              ? "이 컷의 모든 버전과 작업 기록이 삭제됩니다."
              : "프로젝트의 모든 컷과 작업 기록이 삭제됩니다."}
            {boardCount > 0 &&
              ` 저장한 피드 배열 ${boardCount}개에서 해당 컷이 빠집니다.`}
            {" 삭제한 항목은 복구할 수 없습니다."}
          </p>
        </div>
        <footer className="cw-footer">
          <button
            className="cw-btn"
            type="button"
            data-autofocus
            disabled={busy}
            onClick={onClose}
          >
            취소
          </button>
          <button className="cw-btn cw-btn--danger" disabled={busy}>
            {busy ? (
              <LoaderCircle className="cw-spin" size={15} />
            ) : (
              <Trash2 size={15} />
            )}
            {busy ? "삭제 중" : "삭제"}
          </button>
        </footer>
      </form>
    </WorkflowModal>
  );
}

function QuickCut({
  shot,
  client,
  project,
  busy,
  onReview,
  onDelete,
}: {
  shot: Shot;
  client: StudioClient;
  project: Project;
  busy: boolean;
  onReview: () => void;
  onDelete?: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  const version = shot.versions.at(-1);
  const problem = claimIssue(shot.plan, project.sources);
  async function refine(event: FormEvent) {
    event.preventDefault();
    if (!version || !instruction.trim() || sending || busy) return;
    setSending(true);
    try {
      if (
        await client.act({
          type: "refineShot",
          projectId: project.id,
          shotId: shot.id,
          versionId: version.id,
          instruction: instruction.trim(),
          key: newId(),
        })
      ) {
        setInstruction("");
        client.notify("수정 요청을 저장했습니다.");
      }
    } finally {
      setSending(false);
    }
  }
  return (
    <article className="cw-quick-cut">
      {version && (
        <button
          type="button"
          className="cw-quick-image"
          onClick={onReview}
          aria-label={shot.plan.title + " 검수 열기"}
        >
          <img src={thumb(version.image.url)} alt={shot.plan.title} />
        </button>
      )}
      <div className="cw-stack--tight">
        <div className="cw-between">
          <h3>{shot.plan.title}</h3>
          <div className="cw-row">
            {version && (
              <span className="cw-pill">
                V{pad(shot.versions.length)} ·{" "}
                {version.status === "adopted"
                  ? "채택"
                  : version.status === "held"
                    ? "보류"
                    : "검수 대기"}
              </span>
            )}
            {onDelete && (
              <button
                className="cw-btn cw-delete-control"
                type="button"
                onClick={onDelete}
                aria-label={shot.plan.title + " 컷 삭제"}
                title="컷 삭제"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
        {version ? (
          <>
            {version.refinement && (
              <p className="cw-quick-note">{version.refinement}</p>
            )}
            <button type="button" className="cw-btn" onClick={onReview}>
              검수 · 채택 · 다운로드 <ArrowRight size={14} />
            </button>
            <form className="cw-quick-refine" onSubmit={refine}>
              <FlowField label="어떻게 바꿀까요?">
                <textarea
                  rows={2}
                  maxLength={1500}
                  placeholder="예) 그림자를 더 길게 하고, 왼쪽에 여백을 줘."
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
              </FlowField>
              <button
                type="submit"
                className="cw-btn cw-btn--primary"
                disabled={
                  busy ||
                  sending ||
                  !instruction.trim() ||
                  !!problem ||
                  !client.data.aiReady
                }
              >
                <Sparkles size={15} /> {busy ? "수정 중" : "수정 요청"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="cw-note">
              {shot.plan.reason || "근거를 추가하면 이 컷을 만들 수 있습니다."}
            </p>
            <button type="button" className="cw-btn" onClick={onReview}>
              컷 기획 보기
              <ArrowRight size={14} />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function ProjectWorkflow({
  client,
  project,
  onReview,
  onProjectDeleted,
}: {
  client: StudioClient;
  project: Project;
  onReview: (shotId: string) => void;
  onProjectDeleted: () => void;
}) {
  const [tab, setTab] = useState<"drafts" | "shots" | "research">(
    project.quick ? "drafts" : "shots",
  );
  const [editor, setEditor] = useState<{
    shot?: Shot;
    duplicate?: boolean;
  } | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [deletion, setDeletion] = useState<{ shotId?: string } | null>(null);
  const deletingShot = project.shots.find(
    (shot) => shot.id === deletion?.shotId,
  );
  const [checked, setChecked] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const jobs = client.data.state.jobs
    .filter((j) => j.projectId === project.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const research = jobs.find((j) => j.kind === "research");
  const live = jobs.filter((j) => isActive(j));
  const lastByShot = new Map<string, Job>();
  jobs.forEach((job) => {
    if (job.shotId && !lastByShot.has(job.shotId))
      lastByShot.set(job.shotId, job);
  });
  const failures = [research, ...lastByShot.values()].filter(
    (job): job is Job => job?.status === "failed",
  );
  const confirmed = project.shots.filter((s) => s.adoptedId).length;
  const choose = (shot: Shot) =>
    !isActive(lastByShot.get(shot.id)) &&
    !claimIssue(shot.plan, project.sources);
  const ready = project.shots.filter(choose);
  const eligible = ready.map((s) => s.id);
  const selected = checked.filter((id) => eligible.includes(id));
  const selectedAll =
    eligible.length > 0 && selected.length === eligible.length;
  const logo = client.data.state.logos.find((l) => l.id === project.logoId);
  const workflow = client.data.state.workflows.find(
    (w) => w.id === project.workflowId,
  );
  const [showWorkflow, setShowWorkflow] = useState(false);
  const claims = new Map<string, { claim: Claim; shots: Shot[] }>();
  const visualReferences = [
    ...new Map(
      project.shots
        .flatMap((shot) => shot.plan.visualReferences ?? [])
        .map((ref) => [ref.url + "|" + ref.observation, ref]),
    ).values(),
  ];
  for (const shot of project.shots)
    for (const claim of shot.plan.claims) {
      const key = [
        claim.kind,
        claim.fact,
        claim.url || claim.sourceId || "",
      ].join("|");
      if (claims.has(key)) claims.get(key)!.shots.push(shot);
      else claims.set(key, { claim, shots: [shot] });
    }
  async function run(action: Action) {
    if (running) return;
    setRunning(true);
    try {
      const ok = await client.act(action);
      if (ok && action.type === "generate") {
        setChecked([]);
        client.notify(`${action.shotIds.length}컷의 생성을 요청했습니다.`);
      }
    } finally {
      setRunning(false);
    }
  }
  return (
    <div className="cw-workspace">
      <header className="cw-project-head">
        <div>
          <h1>{project.name}</h1>
          <p className="cw-project-meta">
            {project.season && <span>{project.season}</span>}
            {!project.quick && project.name !== project.keyword && (
              <span>{project.keyword}</span>
            )}
          </p>
        </div>
        <div className="cw-row">
          <button
            className="cw-btn"
            type="button"
            onClick={() => setSourcesOpen(true)}
          >
            <Link2 size={15} /> 자료 추가
          </button>
          {!project.sample && (
            <button
              className="cw-btn cw-delete-control"
              type="button"
              disabled={running}
              onClick={() => setDeletion({})}
            >
              <Trash2 size={15} /> 프로젝트 삭제
            </button>
          )}
        </div>
      </header>
      {project.quick && project.name !== project.keyword && (
        <p className="cw-quick-note">{project.keyword}</p>
      )}
      {!project.quick && (
        <div className="cw-metrics">
          <div>
            <span>목표 컷</span>
            <b>{pad(project.count)}</b>
          </div>
          <div>
            <span>기획 컷</span>
            <b>{pad(project.shots.length)}</b>
          </div>
          <div>
            <span>채택 컷</span>
            <b>{pad(confirmed)}</b>
          </div>
        </div>
      )}
      {(live.length > 0 || failures.length > 0) && (
        <section className="cw-jobs" aria-live="polite">
          {live.length > 0 && (
            <p className="cw-running">
              <LoaderCircle size={15} className="cw-spin" />
              {isActive(research)
                ? "출처와 Pinterest 무드 레퍼런스를 찾고 컷 기획을 정리하고 있습니다."
                : `이미지 생성 ${live.filter((j) => j.kind === "generate").length}건이 대기 · 진행 중입니다.`}
            </p>
          )}
          {failures.map((job) => (
            <div className="cw-error-job" key={job.id}>
              <div>
                <strong>
                  {job.kind === "research"
                    ? "키워드 리서치"
                    : `컷 ${pad(project.shots.find((s) => s.id === job.shotId)?.number ?? 0)} 생성`}{" "}
                  실패
                </strong>
                <p>{job.error || "작업을 마치지 못했습니다."}</p>
              </div>
              <button
                type="button"
                className="cw-btn"
                disabled={running || !client.data.aiReady}
                onClick={() =>
                  void run({ type: "retry", jobId: job.id, key: newId() })
                }
              >
                <RotateCcw size={13} />
                재시도
              </button>
            </div>
          ))}
        </section>
      )}
      <div className="cw-main-tabs cw-tabs">
        {project.quick && (
          <button
            type="button"
            aria-pressed={tab === "drafts"}
            onClick={() => setTab("drafts")}
          >
            초안{" "}
            <b>{project.shots.filter((shot) => shot.versions.length).length}</b>
          </button>
        )}
        <button
          type="button"
          aria-pressed={tab === "shots"}
          onClick={() => setTab("shots")}
        >
          컷 기획 · 검수 <b>{project.shots.length}</b>
        </button>
        <button
          type="button"
          aria-pressed={tab === "research"}
          onClick={() => setTab("research")}
        >
          리서치 · 무드보드 <b>{project.sources.length}</b>
        </button>
      </div>
      {tab === "drafts" ? (
        <section className="cw-section">
          {project.shots.length ? (
            <div className="cw-quick-grid">
              {project.shots.map((shot) => (
                <QuickCut
                  key={shot.id}
                  shot={shot}
                  client={client}
                  project={project}
                  busy={isActive(lastByShot.get(shot.id))}
                  onReview={() => onReview(shot.id)}
                  onDelete={
                    project.sample
                      ? undefined
                      : () => setDeletion({ shotId: shot.id })
                  }
                />
              ))}
            </div>
          ) : (
            <div className="cw-empty-board">
              <FileSearch size={26} />
              <h3>
                {isActive(research)
                  ? "레퍼런스와 근거를 찾고 있습니다"
                  : "아직 초안이 없습니다"}
              </h3>
              <p>
                {isActive(research)
                  ? "기획이 완료되면 첫 이미지 생성이 시작됩니다."
                  : "리서치와 무드보드에서 자료를 확인할 수 있습니다."}
              </p>
            </div>
          )}
        </section>
      ) : tab === "shots" ? (
        <section className="cw-section">
          <div className="cw-between">
            <h2>컷 리스트</h2>
            <div className="cw-row">
              <button
                type="button"
                className="cw-btn"
                onClick={() => setEditor({})}
              >
                <Plus size={15} />컷 추가
              </button>
              <button
                type="button"
                className="cw-btn cw-btn--primary"
                disabled={!selected.length || !client.data.aiReady || running}
                onClick={() =>
                  void run({
                    type: "generate",
                    projectId: project.id,
                    shotIds: selected,
                    key: newId(),
                  })
                }
              >
                <Sparkles size={15} />
                {selected.length
                  ? `선택한 ${selected.length}컷 생성`
                  : "선택 컷 생성"}
              </button>
            </div>
          </div>
          {!client.data.aiReady && (
            <p className="cw-note cw-notice">
              <ImageIcon size={15} />
              OpenAI API 키 연결 전입니다. 컷 기획을 추가하고 검수 화면에서
              이미지를 등록할 수 있습니다.
            </p>
          )}
          {project.shots.length === 0 ? (
            <div className="cw-empty-board">
              <FileSearch size={30} strokeWidth={1.2} />
              <h3>
                {isActive(research) ? "리서치 진행 중" : "첫 컷을 기획하세요"}
              </h3>
              <p>
                {isActive(research)
                  ? "조사가 완료되면 출처와 선정 이유가 담긴 컷 기획이 여기에 표시됩니다."
                  : "자료를 바탕으로 컷을 추가하거나 키워드 리서치로 시작하세요."}
              </p>
              <div className="cw-row">
                <button
                  className="cw-btn"
                  type="button"
                  onClick={() => setEditor({})}
                >
                  <Plus size={14} />
                  직접 컷 추가
                </button>
                {client.data.aiReady && !isActive(research) && (
                  <button
                    className="cw-btn cw-btn--dark"
                    onClick={() =>
                      void run({
                        type: "research",
                        projectId: project.id,
                        key: newId(),
                      })
                    }
                    disabled={running}
                  >
                    <Search size={14} />
                    키워드 리서치
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="cw-selection">
                <label className="cw-check">
                  <input
                    type="checkbox"
                    checked={selectedAll}
                    disabled={!eligible.length}
                    onChange={() => setChecked(selectedAll ? [] : eligible)}
                  />
                  생성 가능한 컷 전체 선택
                </label>
                <span>
                  {ready.length} / {project.shots.length}
                </span>
              </div>
              <div className="cw-shot-grid">
                {project.shots.map((shot) => {
                  const ver =
                    shot.versions.find((v) => v.id === shot.adoptedId) ||
                    [...shot.versions].sort((a, b) =>
                      b.createdAt.localeCompare(a.createdAt),
                    )[0];
                  const job = lastByShot.get(shot.id);
                  const issue = claimIssue(shot.plan, project.sources);
                  return (
                    <article className="cw-shot-card" key={shot.id}>
                      <div className="cw-card-image">
                        <button
                          type="button"
                          onClick={() => onReview(shot.id)}
                          aria-label={`${pad(shot.number)} ${shot.plan.title} 검수`}
                        >
                          {ver ? (
                            <img
                              loading="lazy"
                              alt={shot.plan.title}
                              src={thumb(ver.image.url)}
                            />
                          ) : (
                            <div className="cw-image-placeholder">
                              <ImageIcon size={27} strokeWidth={1} />
                              <span>이미지 등록 · 검수</span>
                            </div>
                          )}
                        </button>
                        <label
                          title={issue || "생성할 컷 선택"}
                          className="cw-card-check"
                        >
                          <input
                            type="checkbox"
                            aria-label={`${pad(shot.number)}번 컷 생성 선택`}
                            disabled={!choose(shot)}
                            checked={selected.includes(shot.id)}
                            onChange={(e) =>
                              setChecked((v) =>
                                e.target.checked
                                  ? [...new Set([...v, shot.id])]
                                  : v.filter((id) => id !== shot.id),
                              )
                            }
                          />
                        </label>
                        <span className="cw-shot-no">{pad(shot.number)}</span>
                      </div>
                      <div className="cw-shot-meta">
                        <span>
                          {shot.plan.theme || shot.plan.genre || "컷 브리프"}
                        </span>
                        <span>
                          {isActive(job)
                            ? `생성 ${jobLabel[job!.status]}`
                            : shot.adoptedId
                              ? "채택"
                              : ver
                                ? "검수"
                                : "기획"}
                        </span>
                      </div>
                      <h3>{shot.plan.title}</h3>
                      <p>{shot.plan.reason || "선정 이유를 입력해 주세요."}</p>
                      <div className="cw-card-actions">
                        <button
                          type="button"
                          onClick={() => setEditor({ shot })}
                        >
                          <Pencil size={13} />
                          기획 편집
                        </button>
                        <button
                          type="button"
                          aria-label={`${shot.plan.title} 복제`}
                          title="컷 복제"
                          onClick={() => setEditor({ shot, duplicate: true })}
                        >
                          <Copy size={13} />
                        </button>
                        {!project.sample && (
                          <button
                            className="cw-delete-control"
                            type="button"
                            disabled={running}
                            aria-label={shot.plan.title + " 컷 삭제"}
                            title="컷 삭제"
                            onClick={() => setDeletion({ shotId: shot.id })}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="cw-card-open"
                          onClick={() => onReview(shot.id)}
                        >
                          검수
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="cw-section">
          <div className="cw-between">
            <h2>리서치 · 무드보드</h2>
            <div className="cw-row">
              <button
                type="button"
                className="cw-btn"
                onClick={() => setSourcesOpen(true)}
              >
                <Plus size={15} />
                자료 추가
              </button>
              <button
                type="button"
                className="cw-btn cw-btn--dark"
                disabled={!client.data.aiReady || running || isActive(research)}
                onClick={() =>
                  void run({
                    type: "research",
                    projectId: project.id,
                    key: newId(),
                  })
                }
              >
                <Search size={15} />
                {isActive(research) ? "조사 중" : "키워드 리서치"}
              </button>
            </div>
          </div>
          {!client.data.aiReady && (
            <p className="cw-note cw-notice">
              <FileSearch size={15} />
              자동 리서치에는 서버의 OpenAI API 키가 필요합니다. 자료와 근거는
              직접 입력할 수 있습니다.
            </p>
          )}
          <div className="cw-research-grid">
            <section className="cw-research-main">
              <h3>
                선정 근거 <em>{claims.size}</em>
              </h3>
              {claims.size === 0 && (
                <p className="cw-note">
                  리서치가 완료되거나 컷 기획에 근거를 등록하면 여기에
                  표시됩니다.
                </p>
              )}
              {[...claims.values()].map(({ claim, shots }) => (
                <article
                  className="cw-research-claim"
                  key={claim.id + shots[0].id}
                >
                  <div className="cw-row">
                    <span className="cw-pill">{claim.kind}</span>
                    <small>{claim.verified ? "출처 확인" : "확인 필요"}</small>
                    {claim.date && <small>{claim.date}</small>}
                  </div>
                  <h4>{claim.fact || "근거 미입력"}</h4>
                  {claim.excerpt && claim.excerpt !== claim.fact && (
                    <blockquote>
                      <small>
                        {claim.url ? "인용 연결 문장" : "자료 발췌"}
                      </small>
                      <br />
                      {claim.excerpt}
                    </blockquote>
                  )}
                  {claim.kind === "실측" && (
                    <p className="cw-note">
                      {[claim.period, claim.region, claim.unit]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {claimLink(claim, project.sources) ? (
                    <a
                      className="cw-link"
                      href={claimLink(claim, project.sources)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {claim.sourceTitle || "원문 보기"}
                      {claim.page ? ` · p.${claim.page}` : ""}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <p className="cw-note">
                      {claim.sourceTitle ||
                        project.sources.find((s) => s.id === claim.sourceId)
                          ?.name}
                      {claim.page && ` · p.${claim.page}`}
                    </p>
                  )}
                  <div className="cw-row cw-cut-links">
                    {shots.map((shot) => (
                      <button
                        key={shot.id}
                        className="cw-btn"
                        onClick={() => setEditor({ shot })}
                      >
                        컷 {pad(shot.number)}
                        <ArrowRight size={11} />
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </section>
            <aside className="cw-research-side">
              {project.pinterestReferences === 0 && (
                <p className="cw-note">
                  이번 리서치에서는 사용할 수 있는 Pinterest 이미지를 확보하지
                  못했습니다.
                </p>
              )}
              {visualReferences.length > 0 && (
                <>
                  <h3>
                    시각 레퍼런스 <em>{visualReferences.length}</em>
                  </h3>
                  {visualReferences.map((ref) => (
                    <article
                      className="cw-source-card"
                      key={ref.url + "|" + ref.observation}
                    >
                      {ref.pinterestImage && (
                        <img
                          src={ref.pinterestImage.url}
                          alt=""
                          loading="lazy"
                        />
                      )}
                      <div>
                        {ref.pinterestImage && (
                          <small>Pinterest · 이미지 레퍼런스</small>
                        )}
                        <strong>{ref.title}</strong>
                        <p className="cw-note">{ref.observation}</p>
                        {citedURL(ref.url) && (
                          <a
                            className="cw-link"
                            target="_blank"
                            rel="noreferrer"
                            href={citedURL(ref.url)}
                          >
                            레퍼런스 열기
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
                </>
              )}
              <h3>
                프로젝트 자료 <em>{project.sources.length}</em>
              </h3>
              {!project.sources.length && (
                <p className="cw-note">추가된 참고 자료가 없습니다.</p>
              )}
              {project.sources.map((s) => (
                <div key={s.id} className="cw-source-card">
                  {s.kind === "mood" && s.asset && (
                    <img src={thumb(s.asset.url)} alt={s.name} loading="lazy" />
                  )}
                  <div>
                    <small>
                      {s.referenceRole
                        ? referenceRoles[s.referenceRole]
                        : sourceLabel[s.kind]}
                      {s.referenceNumber ? " · " + pad(s.referenceNumber) : ""}
                    </small>
                    <strong>{s.name}</strong>
                    {s.observation && (
                      <p className="cw-note">
                        {observationText(s.observation)}
                      </p>
                    )}
                    {s.text && <p className="cw-note">{s.text}</p>}
                    {(citedURL(s.url) || s.asset?.url) && (
                      <a
                        className="cw-link"
                        href={citedURL(s.url) || s.asset?.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        원본 열기
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
              <div className="cw-project-assets">
                <h3>적용된 제작 기준</h3>
                {workflow && (
                  <button
                    type="button"
                    className="cw-link"
                    onClick={() => setShowWorkflow(true)}
                  >
                    <FileText size={14} />
                    {workflow.name}
                  </button>
                )}
                {logo && (
                  <div className="cw-logo-line">
                    <img src={logo.asset.url} alt="프로젝트 워드마크" />
                    <div>
                      <strong>{logo.name}</strong>
                      <p className="cw-note">
                        {logo.official ? "공식 원본" : "시안용 가이드"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </section>
      )}
      {deletion && (!deletion.shotId || deletingShot) && (
        <DeleteContentDialog
          client={client}
          project={project}
          shot={deletingShot}
          onClose={() => setDeletion(null)}
          onDeleted={() => {
            setDeletion(null);
            if (!deletion.shotId) onProjectDeleted();
          }}
        />
      )}
      {editor && (
        <PlanDialog
          client={client}
          project={project}
          shot={editor.shot}
          duplicate={editor.duplicate}
          onClose={() => setEditor(null)}
        />
      )}
      {sourcesOpen && (
        <SourcesDialog
          client={client}
          project={project}
          onClose={() => setSourcesOpen(false)}
        />
      )}
      {showWorkflow && workflow && (
        <WorkflowModal
          title={workflow.name}
          eyebrow="Project workflow"
          wide
          onClose={() => setShowWorkflow(false)}
        >
          <div className="cw-scroll">
            <pre className="cw-workflow-md">{workflow.text}</pre>
          </div>
        </WorkflowModal>
      )}
    </div>
  );
}
