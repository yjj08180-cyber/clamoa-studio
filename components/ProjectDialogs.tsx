"use client";
import { supportedClaim } from "../lib/provenance";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  BookmarkCheck,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardCopy,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Images,
  Link2,
  LoaderCircle,
  MailPlus,
  MessageSquare,
  Plus,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import type {
  Claim,
  Plan,
  Project,
  Shot,
  Source,
  StudioClient,
  Version,
} from "../lib/types";
import { downloadVersions } from "../lib/client";
import { pad, thumb } from "../lib/library";
import {
  logoDirection,
  observationFields,
  observationText,
  referenceRoles,
} from "../lib/editorial";
import { creativeBrief } from "../lib/brief";
import "./workflow.css";

export function WorkflowModal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const titleId = useId();
  const frame = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const content = frame.current;
    const selector =
      'button:not(:disabled), input:not(:disabled):not([type=hidden]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]';
    const items = () =>
      Array.from(content?.querySelectorAll<HTMLElement>(selector) ?? []).filter(
        (el) => el.getClientRects().length,
      );
    const first =
      content?.querySelector<HTMLElement>("[data-autofocus]") ||
      items()[0] ||
      content;
    first?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const controls = items();
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="cw-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={frame}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`cw-modal${wide ? " cw-modal--wide" : ""}`}
      >
        <header className="cw-modal-heading">
          <div>
            {eyebrow && <p className="cw-kicker">{eyebrow}</p>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="cw-icon"
            aria-label="닫기"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function FlowField({
  children,
  label,
  hint,
}: {
  children: ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <label className="cw-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function newId() {
  return crypto.randomUUID();
}

export const sourceLabel: Record<Source["kind"], string> = {
  url: "웹 출처",
  pdf: "PDF",
  memo: "메모",
  mood: "무드 레퍼런스",
};
const sourceIcons = {
  url: Link2,
  pdf: FileText,
  mood: ImageIcon,
  memo: MessageSquare,
};
const defaultSourceName = {
  url: "참고 링크",
  pdf: "PDF",
  mood: "무드 레퍼런스",
  memo: "제공 메모",
};

function validWebUrl(input?: string) {
  if (!input) return false;
  try {
    return ["https:", "http:"].includes(new URL(input).protocol);
  } catch {
    return false;
  }
}

export function sourceError(sources: Source[]) {
  if (sources.some((s) => s.kind === "url" && !validWebUrl(s.url)))
    return "출처 링크에 http 또는 https로 시작하는 주소를 입력해 주세요.";
  if (
    sources.some(
      (s) =>
        s.kind === "mood" &&
        ((!s.asset && !s.url) || (s.url && !validWebUrl(s.url))),
    )
  )
    return "무드 이미지나 http 또는 https로 시작하는 레퍼런스 URL을 연결해 주세요.";
  if (
    sources.some(
      (s) =>
        (s.referenceRole === "prefer" || s.referenceRole === "avoid") &&
        !s.text?.trim(),
    )
  )
    return "선호하거나 피하고 싶은 컷에 이유를 적어 주세요.";
  if (sources.some((s) => s.kind === "memo" && !s.text?.trim()))
    return "추가한 메모에 내용을 입력해 주세요.";
  return "";
}

export function SourceEditor({
  sources,
  onChange,
  client,
  onUploading,
}: {
  sources: Source[];
  onChange: (items: Source[]) => void;
  client: StudioClient;
  onUploading: (value: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [gallery, setGallery] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(sources);
  latest.current = sources;
  const samples = client.data.state.projects
    .filter((p) => p.sample || p.id === "ss27")
    .flatMap((p) =>
      p.shots.flatMap((shot) => {
        const version =
          shot.versions.find((v) => v.id === shot.adoptedId) ||
          shot.versions[0];
        return version ? [{ shot, version }] : [];
      }),
    );
  const update = (id: string, partial: Partial<Source>) =>
    onChange(
      latest.current.map((s) => (s.id === id ? { ...s, ...partial } : s)),
    );
  function add(kind: "memo" | "url" | "mood") {
    onChange([
      ...latest.current,
      {
        id: newId(),
        kind,
        name: defaultSourceName[kind],
        ...(kind === "memo" ? { text: "" } : { url: "" }),
      },
    ]);
  }
  async function files(incoming: FileList | null) {
    if (!incoming?.length) return;
    setUploading(true);
    onUploading(true);
    setError("");
    const added: Source[] = [];
    try {
      for (const file of Array.from(incoming)) {
        const asset = await client.upload(file);
        added.push({
          id: newId(),
          kind: asset.mime === "application/pdf" ? "pdf" : "mood",
          name: file.name,
          asset,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "파일을 불러오지 못했습니다.");
    } finally {
      if (added.length) onChange([...latest.current, ...added]);
      setUploading(false);
      onUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <div className="cw-stack--tight">
      {sources.map((s) => {
        const Icon = sourceIcons[s.kind];
        return (
          <div key={s.id} className="cw-source-item">
            <div className="cw-between">
              <div className="cw-row">
                <Icon size={14} />
                <strong>{sourceLabel[s.kind]}</strong>
                {s.asset && <small>{s.name}</small>}
              </div>
              <button
                type="button"
                className="cw-mini-icon"
                aria-label={`${s.name} 삭제`}
                onClick={() =>
                  onChange(latest.current.filter((x) => x.id !== s.id))
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
            {(s.kind === "url" || (s.kind === "mood" && !s.asset)) && (
              <input
                aria-label={
                  s.kind === "mood" ? "무드 레퍼런스 URL" : "출처 URL"
                }
                type="url"
                placeholder="https://"
                value={s.url ?? ""}
                onChange={(e) =>
                  update(s.id, {
                    url: e.target.value,
                    name: e.target.value.trim() || defaultSourceName[s.kind],
                  })
                }
              />
            )}
            {s.kind === "mood" && s.asset && (
              <img className="cw-source-thumb" src={s.asset.url} alt={s.name} />
            )}
            {s.kind === "mood" && (
              <details className="cw-detail">
                <summary>
                  무드 관찰 · 활용 방식 <ChevronDown size={14} />
                </summary>
                {!s.asset && (
                  <FlowField label="레퍼런스 이름">
                    <input
                      maxLength={200}
                      value={s.name}
                      onChange={(e) => update(s.id, { name: e.target.value })}
                    />
                  </FlowField>
                )}
                <FlowField label="레퍼런스 활용">
                  <select
                    value={s.referenceRole ?? ""}
                    onChange={(e) =>
                      update(s.id, {
                        referenceRole: (e.target.value ||
                          undefined) as Source["referenceRole"],
                      })
                    }
                  >
                    <option value="">무드 참고</option>
                    {Object.entries(referenceRoles).map(([role, label]) => (
                      <option key={role} value={role}>
                        {label}
                      </option>
                    ))}
                  </select>
                </FlowField>
                {s.referenceRole !== "avoid" && (
                  <div className="cw-grid2">
                    {observationFields.map(([key, label]) => (
                      <FlowField key={key} label={label}>
                        <input
                          maxLength={1024}
                          value={s.observation?.[key] ?? ""}
                          onChange={(e) =>
                            update(s.id, {
                              observation: {
                                ...s.observation,
                                [key]: e.target.value,
                              },
                            })
                          }
                        />
                      </FlowField>
                    ))}
                  </div>
                )}
              </details>
            )}
            <textarea
              aria-label={
                s.kind === "memo"
                  ? "메모 본문"
                  : s.referenceRole
                    ? "레퍼런스 선택 이유"
                    : "자료 관찰 메모"
              }
              maxLength={s.kind === "memo" ? 100000 : 4096}
              rows={s.kind === "memo" ? 3 : 2}
              value={s.text ?? ""}
              placeholder={
                s.kind === "memo"
                  ? "브리프, 기사 발췌 또는 관찰한 내용을 입력하세요."
                  : s.kind === "mood"
                    ? s.referenceRole === "avoid"
                      ? "어떤 요소가 어색했고 왜 피하고 싶은지 적어 주세요."
                      : s.referenceRole === "prefer"
                        ? "어떤 요소가 좋았고 왜 참고하고 싶은지 적어 주세요."
                        : "참고할 빛·색·질감·프레이밍을 기록하세요."
                    : "참고할 부분이나 페이지를 기록하세요. (선택)"
              }
              onChange={(e) => update(s.id, { text: e.target.value })}
            />
          </div>
        );
      })}
      <div className="cw-row">
        <button type="button" className="cw-btn" onClick={() => add("url")}>
          <Link2 size={14} />
          링크
        </button>
        <button type="button" className="cw-btn" onClick={() => add("mood")}>
          <ImageIcon size={14} />
          무드 링크
        </button>
        <button type="button" className="cw-btn" onClick={() => add("memo")}>
          <MessageSquare size={14} />
          메모
        </button>
        <button
          type="button"
          className="cw-btn"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={14} />
          {uploading ? "업로드 중" : "PDF · 이미지"}
        </button>
        {!!samples.length && (
          <button
            type="button"
            className="cw-btn"
            aria-expanded={gallery}
            onClick={() => setGallery(!gallery)}
          >
            <Images size={14} />
            기존 컷
          </button>
        )}
        <input
          className="cw-hidden"
          ref={fileInput}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,application/pdf"
          aria-label="PDF 또는 이미지 첨부"
          onChange={(e) => void files(e.target.files)}
        />
      </div>
      {gallery && (
        <div className="cw-ref-gallery">
          {samples.map(({ shot, version }) => {
            const exists = sources.some(
              (s) => s.asset?.id === version.image.id,
            );
            return (
              <button
                key={shot.id}
                type="button"
                disabled={exists}
                aria-label={`${shot.plan.title} ${exists ? "추가됨" : "참고 컷에 추가"}`}
                onClick={() =>
                  onChange([
                    ...latest.current,
                    {
                      id: newId(),
                      kind: "mood",
                      name: shot.plan.title,
                      asset: version.image,
                      referenceNumber: shot.number,
                    },
                  ])
                }
              >
                <img loading="lazy" src={thumb(version.image.url)} alt="" />
                <span>
                  {String(shot.number).padStart(2, "0")} {shot.plan.title}
                </span>
                {exists && <Check size={15} />}
              </button>
            );
          })}
        </div>
      )}
      {error && (
        <div role="alert" className="cw-alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function NewProjectDialog({
  client,
  reference,
  onClose,
  onCreated,
}: {
  client: StudioClient;
  reference?: Source;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [name, setName] = useState("");
  const [season, setSeason] = useState("");
  const [count, setCount] = useState<number | undefined>();
  const [creationMode, setCreationMode] = useState<
    "draft" | "research" | "manual"
  >("draft");
  const planFirst = creationMode === "research";
  const manual = !client.data.aiReady || creationMode === "manual";
  const defaults = creativeBrief(keyword);
  if (reference?.asset && defaults.season === "시즌 미정") {
    const base = client.data.state.projects.find((project) =>
      project.shots.some((shot) =>
        shot.versions.some(
          (version) => version.image.id === reference.asset?.id,
        ),
      ),
    );
    if (base) defaults.season = base.season;
  }
  const [logoId, setLogoId] = useState(
    (
      client.data.state.logos.find((x) => x.official) ||
      client.data.state.logos[0]
    )?.id ?? "",
  );
  const [sources, setSources] = useState<Source[]>(
    reference ? [reference] : [],
  );
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || uploading) return;
    const issue = sourceError(sources);
    if (issue || !keyword.trim()) {
      setError(issue || "만들고 싶은 콘텐츠를 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    const id = newId();
    try {
      const ok = await client.act({
        type: "createProject",
        id,
        name: name.trim() || defaults.name,
        keyword: keyword.trim(),
        season: season.trim() || defaults.season,
        count: count ?? defaults.count,
        logoId,
        sources: [
          ...sources,
          ...defaults.urls
            .filter((url) => !sources.some((source) => source.url === url))
            .map((url) => ({
              id: newId(),
              kind: "url" as const,
              name: new URL(url).hostname,
              url,
            })),
        ],
        research: !manual,
        quick: !manual && !planFirst,
      });
      if (ok) onCreated(id);
    } finally {
      setBusy(false);
    }
  }
  const close = () => {
    if (!busy && !uploading) onClose();
  };
  return (
    <WorkflowModal title="어떤 콘텐츠를 만들까요?" onClose={close}>
      <form onSubmit={submit} className="cw-form">
        <div className="cw-scroll cw-stack">
          {reference?.referenceRole === "base" && (
            <div className="cw-source-card">
              {reference.asset && (
                <img src={thumb(reference.asset.url)} alt="" />
              )}
              <div>
                <small>
                  기준 컷{" "}
                  {reference.referenceNumber && pad(reference.referenceNumber)}
                </small>
                <strong>{reference.name}</strong>
              </div>
            </div>
          )}
          <FlowField
            label="아이디어"
            hint={
              reference?.referenceRole === "base"
                ? "기준 컷에서 새로 바꾸고 싶은 요소를 적어 주세요."
                : undefined
            }
          >
            <textarea
              data-autofocus
              required
              rows={4}
              maxLength={4000}
              placeholder={
                reference?.referenceRole === "base"
                  ? "예) 소재를 광택 가죽에서 스웨이드로 바꾸고 배경은 따뜻한 회색으로."
                  : "예) 2027 S/S Energy Orange. 거친 콘크리트와 대비되는 아웃도어 정물, 강한 측면광으로 1컷 만들어줘."
              }
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </FlowField>
          <details className="cw-detail">
            <summary>
              참고 자료 추가
              {sources.length ? " · " + sources.length + "건" : ""}
              <ChevronDown size={14} />
            </summary>
            <SourceEditor
              sources={sources}
              onChange={setSources}
              client={client}
              onUploading={setUploading}
            />
          </details>
          <details className="cw-detail">
            <summary>
              제작 설정
              <ChevronDown size={14} />
            </summary>
            <div className="cw-grid2">
              <FlowField label="시즌">
                <input
                  placeholder={defaults.season}
                  value={season}
                  maxLength={100}
                  onChange={(e) => setSeason(e.target.value)}
                />
              </FlowField>
              <FlowField label="목표 컷 수">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={count || ""}
                  placeholder={String(defaults.count)}
                  onChange={(e) =>
                    setCount(
                      e.target.value ? Number(e.target.value) : undefined,
                    )
                  }
                />
              </FlowField>
            </div>
            <FlowField
              label="프로젝트 이름"
              hint="비워 두면 입력한 키워드를 이름으로 사용합니다."
            >
              <input
                value={name}
                maxLength={160}
                placeholder="프로젝트 이름 (선택)"
                onChange={(e) => setName(e.target.value)}
              />
            </FlowField>
            <FlowField label="로고 자산">
              <select
                value={logoId}
                onChange={(e) => setLogoId(e.target.value)}
              >
                {!client.data.state.logos.length && (
                  <option value="">등록된 자산 없음</option>
                )}
                {client.data.state.logos.map((logo) => (
                  <option key={logo.id} value={logo.id}>
                    {logo.name} ·{" "}
                    {logo.official ? "공식 원본" : "시안용 가이드"}
                  </option>
                ))}
              </select>
            </FlowField>
            {client.data.aiReady && (
              <FlowField label="제작 방식">
                <select
                  value={creationMode}
                  onChange={(e) =>
                    setCreationMode(e.target.value as typeof creationMode)
                  }
                >
                  <option value="draft">자동 리서치와 초안 생성</option>
                  <option value="research">
                    기획안을 확인한 뒤 이미지 생성
                  </option>
                  <option value="manual">직접 기획하고 이미지 업로드</option>
                </select>
              </FlowField>
            )}
          </details>
          {!client.data.aiReady && (
            <p className="cw-note cw-notice">
              <CircleHelp size={15} /> API 키 연결 전에는 근거와 컷을 직접
              등록하고 이미지를 업로드할 수 있습니다.
            </p>
          )}
          {error && (
            <div role="alert" className="cw-alert">
              {error}
            </div>
          )}
        </div>
        <footer className="cw-footer">
          {!manual && (
            <small className="cw-composer-count">
              {planFirst ? "기획" : "초안"} {count ?? defaults.count}컷
            </small>
          )}
          <button
            type="button"
            className="cw-btn"
            disabled={busy || uploading}
            onClick={close}
          >
            취소
          </button>
          <button
            className="cw-btn cw-btn--primary"
            disabled={busy || uploading || !keyword.trim()}
          >
            {busy ? <LoaderCircle className="cw-spin" size={15} /> : null}
            {!manual
              ? planFirst
                ? "리서치 시작"
                : "리서치하고 초안 만들기"
              : "프로젝트 생성"}
            <ArrowRight size={15} />
          </button>
        </footer>
      </form>
    </WorkflowModal>
  );
}

export function claimLink(claim: Claim, sources: Source[]) {
  const source = sources.find((item) => item.id === claim.sourceId);
  if (source?.kind === "pdf" && source.asset)
    return source.asset.url + (claim.page ? "#page=" + claim.page : "");
  return validWebUrl(claim.url)
    ? claim.url
    : validWebUrl(source?.url)
      ? source?.url
      : undefined;
}

export function claimIssue(plan: Plan, sources: Source[]) {
  if (!plan.reason.trim() || !plan.scene.trim())
    return "선정 이유와 장면을 작성해 주세요.";
  const verified = plan.claims.some((c) => supportedClaim(c, sources));
  if (!verified)
    return "원문 링크 또는 연결한 자료가 있는 근거를 한 건 이상 확인해 주세요. PDF는 페이지, 실측은 기간·지역·단위가 필요합니다.";
  if (!plan.prompt.trim()) return "생성에 사용할 프롬프트를 작성해 주세요.";
  return "";
}

function prettyDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

export function ShotDialog({
  client,
  project,
  shot,
  initialVersionId,
  onClose,
}: {
  client: StudioClient;
  project: Project;
  shot: Shot;
  initialVersionId?: string;
  onClose: () => void;
}) {
  const versions = [...shot.versions].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const [picked, setPicked] = useState(
    initialVersionId ?? versions[0]?.id ?? "",
  );
  const [against, setAgainst] = useState("");
  const current = versions.find((v) => v.id === picked) ?? versions[0];
  const comparison = versions.find(
    (v) => v.id === against && v.id !== current?.id,
  );
  const [note, setNote] = useState(current?.note ?? "");
  const [prompt, setPrompt] = useState(shot.plan.prompt);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadNote, setUploadNote] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"review" | "prompt" | "upload">("review");
  const uploadInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setNote(current?.note ?? "");
  }, [current?.id, current?.note]);
  useEffect(() => {
    setPrompt(shot.plan.prompt);
  }, [shot.plan.prompt]);
  const projectJobs = client.data.state.jobs.filter(
    (j) => j.shotId === shot.id && j.projectId === project.id,
  );
  const active = projectJobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  const statusLabel: Record<Version["status"], string> = {
    pending: "검수 대기",
    adopted: "채택",
    held: "보류",
  };
  const viewPlan = current?.plan || shot.plan;
  const moodSources = project.sources.filter(
    (source) =>
      source.kind === "mood" &&
      (current?.sourceIds ?? viewPlan.referenceIds ?? []).includes(source.id),
  );
  const generationIssue = claimIssue({ ...shot.plan, prompt }, project.sources);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "작업을 마치지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function review(status: "adopted" | "held") {
    if (!current) return;
    if (status === "held" && !note.trim()) {
      setError("보류할 이유나 수정할 부분을 적어 주세요.");
      return;
    }
    await run(async () => {
      if (
        await client.act({
          type: "review",
          projectId: project.id,
          shotId: shot.id,
          versionId: current.id,
          status,
          note: note.trim(),
        })
      )
        client.notify(
          status === "adopted"
            ? "이 버전을 채택했습니다."
            : "보류 사유를 저장했습니다.",
        );
    });
  }
  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    await run(async () => {
      const asset = await client.upload(file);
      const ok = await client.act({
        type: "uploadVersion",
        projectId: project.id,
        shotId: shot.id,
        asset,
        note: uploadNote.trim(),
      });
      if (ok) {
        setFile(null);
        setUploadNote("");
        setPicked("");
        setTab("review");
        client.notify("새 버전을 등록했습니다.");
      }
    });
  }
  async function savePrompt(generate: boolean) {
    await run(async () => {
      if (
        prompt !== shot.plan.prompt &&
        !(await client.act({
          type: "editPlan",
          projectId: project.id,
          shotId: shot.id,
          plan: { ...shot.plan, prompt },
        }))
      )
        return;
      if (generate)
        await client.act({
          type: "generate",
          projectId: project.id,
          shotIds: [shot.id],
          key: newId(),
        });
      else client.notify("다음 생성에 사용할 프롬프트를 저장했습니다.");
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      client.notify("프롬프트를 복사했습니다.");
    } catch {
      setError("프롬프트 입력란에서 텍스트를 선택해 복사해 주세요.");
    }
  }
  const vNumber = (v: Version) =>
    versions.length - versions.findIndex((item) => item.id === v.id);
  const close = () => {
    if (!busy) onClose();
  };
  const imagePanel = (version: Version) => (
    <figure className="cw-preview-fig" key={version.id}>
      <a
        href={version.image.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`버전 ${vNumber(version)} 원본 확대`}
      >
        <img
          src={version.image.url}
          alt={`${shot.plan.title} 버전 ${vNumber(version)}`}
        />
        <span className="cw-zoom">
          <ZoomIn size={15} />
        </span>
      </a>
      <figcaption>
        <strong>V{String(vNumber(version)).padStart(2, "0")}</strong>
        <span>{statusLabel[version.status]}</span>
      </figcaption>
    </figure>
  );
  return (
    <WorkflowModal
      wide
      title={shot.plan.title || "컷 검수"}
      eyebrow={`Shot ${String(shot.number).padStart(2, "0")} / ${project.name}`}
      onClose={close}
    >
      <div className="cw-scroll cw-review-grid">
        <section className="cw-stack--tight cw-review-images">
          {current ? (
            <>
              <div
                className={`cw-image-pair${comparison ? " is-comparing" : ""}`}
              >
                {imagePanel(current)}
                {comparison && imagePanel(comparison)}
              </div>
              <div className="cw-grid2">
                <FlowField label="검수할 버전">
                  <select
                    value={current.id}
                    onChange={(e) => {
                      setPicked(e.target.value);
                      if (e.target.value === against) setAgainst("");
                    }}
                  >
                    {versions.map((v) => (
                      <option value={v.id} key={v.id}>
                        V{String(vNumber(v)).padStart(2, "0")} ·{" "}
                        {statusLabel[v.status]} · {prettyDate(v.createdAt)}
                      </option>
                    ))}
                  </select>
                </FlowField>
                {versions.length > 1 && (
                  <FlowField label="나란히 비교">
                    <select
                      value={comparison?.id ?? ""}
                      onChange={(e) => setAgainst(e.target.value)}
                    >
                      <option value="">비교 버전 선택</option>
                      {versions
                        .filter((v) => v.id !== current.id)
                        .map((v) => (
                          <option value={v.id} key={v.id}>
                            V{String(vNumber(v)).padStart(2, "0")} ·{" "}
                            {statusLabel[v.status]}
                          </option>
                        ))}
                    </select>
                  </FlowField>
                )}
              </div>
              <div>
                <button
                  type="button"
                  className="cw-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(() => downloadVersions([current.id], "jpg"))
                  }
                >
                  <Download size={14} />
                  게시용 JPG · 1080 × 1350
                </button>
              </div>
            </>
          ) : (
            <div className="cw-empty-image">
              <ImageIcon size={32} strokeWidth={1} />
              <p>등록된 이미지가 없습니다.</p>
              <button
                className="cw-btn"
                type="button"
                onClick={() => setTab("upload")}
              >
                첫 이미지 업로드
              </button>
            </div>
          )}
        </section>
        <section className="cw-review-controls">
          <div className="cw-tabs">
            {(
              [
                ["review", "검수"],
                ["prompt", "프롬프트"],
                ["upload", "파일 등록"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={key === tab}
                onClick={() => {
                  setTab(key);
                  setError("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "review" && (
            <div className="cw-stack">
              <div className="cw-stack--tight">
                <p className="cw-kicker">Editorial review</p>
                <h3>선정 이유</h3>
                <p className="cw-body-text">
                  {(current?.plan || shot.plan).reason ||
                    "기획에서 선정 이유를 입력해 주세요."}
                </p>
                <details className="cw-detail">
                  <summary>
                    근거와 제작 기록 <ChevronDown size={14} />
                  </summary>
                  <div className="cw-stack--tight">
                    {(current?.plan || shot.plan).claims.map((claim) => (
                      <div className="cw-trace" key={claim.id}>
                        <span className="cw-pill">{claim.kind}</span>
                        <p>{claim.fact}</p>
                        {claim.excerpt && claim.excerpt !== claim.fact && (
                          <p className="cw-note">
                            {claim.url ? "인용 연결 문장" : "자료 발췌"} ·{" "}
                            {claim.excerpt}
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
                          <small>
                            {claim.sourceTitle ||
                              project.sources.find(
                                (x) => x.id === claim.sourceId,
                              )?.name}{" "}
                            {claim.page ? `p.${claim.page}` : ""}
                          </small>
                        )}
                      </div>
                    ))}
                    {(current?.plan || shot.plan).visualReferences?.map(
                      (ref) => (
                        <div
                          className="cw-trace"
                          key={ref.url + "|" + ref.observation}
                        >
                          <span className="cw-pill">
                            {ref.pinterestImage ? "Pinterest" : "시각 레퍼런스"}
                          </span>
                          {ref.pinterestImage && (
                            <div className="cw-history-mood">
                              <img
                                src={ref.pinterestImage.url}
                                alt=""
                                loading="lazy"
                              />
                              <small>
                                {current
                                  ? current.imageReferenceIds?.includes(
                                      ref.pinterestImage.id,
                                    )
                                    ? "생성에 첨부한 이미지"
                                    : "기획에 참고한 이미지"
                                  : "연결된 이미지"}
                              </small>
                            </div>
                          )}
                          <p>{ref.observation}</p>
                          {validWebUrl(ref.url) && (
                            <a
                              className="cw-link"
                              href={ref.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {ref.title}
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      ),
                    )}
                    {current?.refinement && (
                      <p className="cw-note">
                        수정 요청 · {current.refinement}
                      </p>
                    )}
                    <p className="cw-note">
                      {(current?.plan || shot.plan).scene}
                    </p>
                    {viewPlan.mood && (
                      <p className="cw-note">무드 관찰 · {viewPlan.mood}</p>
                    )}
                    <p className="cw-note">
                      로고 · {logoDirection(viewPlan) || "미입력"}
                    </p>
                    {viewPlan.reviewNote && (
                      <p className="cw-note">
                        검수 기준 · {viewPlan.reviewNote}
                      </p>
                    )}
                    {moodSources.map((source) => (
                      <div className="cw-trace" key={source.id}>
                        <a
                          href={
                            source.asset?.url ??
                            (validWebUrl(source.url) ? source.url : undefined)
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="cw-history-mood"
                        >
                          {source.asset && (
                            <img src={thumb(source.asset.url)} alt="" />
                          )}
                          <span>{source.name}</span>
                          <ExternalLink size={12} />
                        </a>
                        {(source.observation || source.text) && (
                          <p>
                            {[observationText(source.observation), source.text]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                      </div>
                    ))}
                    {current && (
                      <>
                        <p className="cw-note">
                          사용 로고 ·{" "}
                          {client.data.state.logos.find(
                            (l) => l.id === current.logoId,
                          )?.name || "기록 없음"}
                        </p>
                        <p className="cw-note">
                          워크플로우 ·{" "}
                          {client.data.state.workflows.find(
                            (w) => w.id === current.workflowId,
                          )?.name || "기록 없음"}
                        </p>
                        <p className="cw-note">생성 방식 · {current.model}</p>
                        <p className="cw-note">
                          참고 자료 ·{" "}
                          {current.sourceIds
                            .filter(
                              (id) =>
                                project.sources.find((s) => s.id === id)
                                  ?.kind !== "mood",
                            )
                            .map(
                              (id) =>
                                project.sources.find((s) => s.id === id)
                                  ?.name || id,
                            )
                            .join(", ") || "없음"}
                        </p>
                        {current.prompt && (
                          <p className="cw-version-prompt">{current.prompt}</p>
                        )}
                      </>
                    )}
                  </div>
                </details>
              </div>
              {current && (
                <>
                  <FlowField
                    label="검수 메모"
                    hint="소문자 clamoa의 철자·자형·원근, 소재 질감과 불필요한 문자를 확인하세요."
                  >
                    <textarea
                      rows={3}
                      placeholder="채택 이유 또는 수정할 부분"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </FlowField>
                  <div className="cw-row">
                    <button
                      type="button"
                      className="cw-btn"
                      disabled={busy}
                      onClick={() => void review("held")}
                    >
                      보류
                    </button>
                    <button
                      type="button"
                      className="cw-btn cw-btn--primary"
                      disabled={busy}
                      onClick={() => void review("adopted")}
                    >
                      <BookmarkCheck size={15} />
                      {current.status === "adopted"
                        ? "채택 메모 저장"
                        : "이 버전 채택"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {tab === "prompt" && (
            <div className="cw-stack">
              <FlowField label="다음 생성 프롬프트">
                <textarea
                  rows={11}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </FlowField>
              <div className="cw-row">
                <button
                  type="button"
                  className="cw-btn"
                  disabled={!prompt}
                  onClick={() => void copy()}
                >
                  <ClipboardCopy size={14} />
                  복사
                </button>
                <button
                  type="button"
                  className="cw-btn"
                  disabled={busy || prompt === shot.plan.prompt}
                  onClick={() => void savePrompt(false)}
                >
                  저장
                </button>
                <button
                  type="button"
                  className="cw-btn cw-btn--primary"
                  disabled={
                    busy || active || !client.data.aiReady || !!generationIssue
                  }
                  onClick={() => void savePrompt(true)}
                >
                  {active
                    ? "생성 중"
                    : versions.length
                      ? "새 버전 생성"
                      : "이미지 생성"}
                </button>
              </div>
              {(!client.data.aiReady || generationIssue) && (
                <p className="cw-note">
                  {!client.data.aiReady
                    ? "OpenAI API 연결 전입니다. 프롬프트를 복사해 외부에서 만든 이미지를 등록할 수 있습니다."
                    : generationIssue}
                </p>
              )}
            </div>
          )}
          {tab === "upload" && (
            <form className="cw-stack" onSubmit={upload}>
              <FlowField
                label="원본 이미지"
                hint="게시용 JPG는 내보낼 때 만듭니다."
              >
                <div className="cw-upload">
                  <input
                    ref={uploadInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    required
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </FlowField>
              <FlowField label="버전 메모">
                <textarea
                  value={uploadNote}
                  rows={3}
                  placeholder="예) 공식 로고 마스터를 배치한 보정본"
                  onChange={(e) => setUploadNote(e.target.value)}
                />
              </FlowField>
              <div>
                <button
                  className="cw-btn cw-btn--dark"
                  disabled={!file || busy}
                >
                  <Upload size={15} />
                  {busy ? "등록 중" : "새 버전 등록"}
                </button>
              </div>
            </form>
          )}
          {error && (
            <p role="alert" className="cw-alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </WorkflowModal>
  );
}

export function SettingsDialog({
  client,
  onClose,
}: {
  client: StudioClient;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"workflow" | "logos" | "team">("workflow");
  const workflow = [...client.data.state.workflows].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  const [text, setText] = useState(workflow?.text ?? "");
  const [name, setName] = useState(
    workflow?.name ?? "클라모아 제작 워크플로우",
  );
  const [file, setFile] = useState<File | null>(null);
  const logoFileInput = useRef<HTMLInputElement>(null);
  const [logoName, setLogoName] = useState("");
  const [official, setOfficial] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const admin = client.data.viewer.role === "admin";
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function loadMD(file?: File) {
    if (!file) return;
    await run(async () => {
      const value = await file.text();
      if (!value.trim() || value.length > 200000)
        throw new Error("1자 이상 20만 자 이하의 워크플로우를 선택해 주세요.");
      setText(value);
      setName(file.name);
      setNotice("불러온 내용을 확인하고 새 버전으로 저장해 주세요.");
    });
  }
  function saveWorkflow(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (
        await client.act({
          type: "workflow",
          text: text.trim(),
          name: name.trim(),
        })
      )
        setNotice("워크플로우를 저장했습니다. 새 프로젝트부터 적용됩니다.");
    });
  }
  function saveLogo(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    void run(async () => {
      const asset = await client.upload(file);
      if (
        await client.act({
          type: "logo",
          name: logoName.trim() || file.name,
          official,
          asset,
        })
      ) {
        setFile(null);
        setLogoName("");
        setOfficial(false);
        if (logoFileInput.current) logoFileInput.current.value = "";
        setNotice("로고 자산을 등록했습니다.");
      }
    });
  }
  function invite(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const result = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite", email: email.trim() }),
      });
      if (!result.ok) {
        const data = await result.json().catch(() => ({}));
        throw new Error(data.error || "초대 메일을 보내지 못했습니다.");
      }
      setNotice(`${email.trim()} 주소로 초대를 보냈습니다.`);
      setEmail("");
    });
  }
  function updatePassword(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (password !== confirmPassword)
        throw new Error("비밀번호 확인이 일치하지 않습니다.");
      const result = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "savePassword", password }),
      });
      const data = await result.json().catch(() => ({}));
      if (!result.ok)
        throw new Error(data.error || "비밀번호를 설정하지 못했습니다.");
      setPassword("");
      setConfirmPassword("");
      setNotice(
        "스튜디오 비밀번호를 설정했습니다. 다음부터 이메일과 비밀번호로 로그인할 수 있습니다.",
      );
    });
  }
  return (
    <WorkflowModal
      title="스튜디오 설정"
      eyebrow="Workspace"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="cw-scroll cw-stack">
        <div className="cw-tabs">
          {(
            [
              ["workflow", "워크플로우"],
              ["logos", "로고 자산"],
              ["team", "팀 · 연결"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              disabled={busy}
              onClick={() => {
                setTab(key);
                setError("");
                setNotice("");
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "workflow" && (
          <form className="cw-stack" onSubmit={saveWorkflow}>
            {admin && (
              <FlowField label="워크플로우 MD 불러오기">
                <div className="cw-upload">
                  <input
                    type="file"
                    accept=".md,.markdown,text/markdown,text/plain"
                    onChange={(e) => void loadMD(e.target.files?.[0])}
                  />
                </div>
              </FlowField>
            )}
            <FlowField label="버전 이름">
              <input
                value={name}
                readOnly={!admin}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </FlowField>
            <FlowField label="제작 기준">
              <textarea
                rows={12}
                value={text}
                readOnly={!admin}
                required
                onChange={(e) => setText(e.target.value)}
              />
            </FlowField>
            {admin && (
              <div>
                <button
                  type="submit"
                  className="cw-btn cw-btn--dark"
                  disabled={
                    busy ||
                    !name.trim() ||
                    !text.trim() ||
                    (text === workflow?.text && name === workflow?.name)
                  }
                >
                  새 버전 저장
                </button>
              </div>
            )}
          </form>
        )}
        {tab === "logos" && (
          <div className="cw-stack">
            <div className="cw-stack--tight">
              {client.data.state.logos.map((logo) => (
                <div key={logo.id} className="cw-logo-line">
                  <img src={logo.asset.url} alt={logo.name} />
                  <div>
                    <strong>{logo.name}</strong>
                    <p className="cw-note">
                      {logo.official ? "공식 원본" : "시안용 가이드"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {admin && (
              <form className="cw-stack cw-bordered" onSubmit={saveLogo}>
                <h3>로고 등록</h3>
                <FlowField label="자산 이름">
                  <input
                    required
                    value={logoName}
                    onChange={(e) => setLogoName(e.target.value)}
                    placeholder="예) clamoa 공식 워드마크"
                  />
                </FlowField>
                <FlowField label="로고 파일">
                  <div className="cw-upload">
                    <input
                      ref={logoFileInput}
                      type="file"
                      required={!file}
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                    {file && <span className="cw-note">{file.name}</span>}
                  </div>
                </FlowField>
                <label className="cw-check">
                  <input
                    type="checkbox"
                    checked={official}
                    onChange={(e) => setOfficial(e.target.checked)}
                  />
                  공식 로고 원본
                </label>
                <div>
                  <button
                    className="cw-btn cw-btn--dark"
                    disabled={busy || !file || !logoName.trim()}
                  >
                    <Plus size={15} />
                    자산 등록
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
        {tab === "team" && (
          <div className="cw-stack">
            <dl className="cw-info-list">
              <div>
                <dt>워크스페이스</dt>
                <dd>
                  {client.data.mode === "team" ? "팀 공유" : "로컬 스튜디오"}
                </dd>
              </div>
              <div>
                <dt>현재 사용자</dt>
                <dd>
                  {client.data.viewer.email} · {admin ? "관리자" : "멤버"}
                </dd>
              </div>
              <div>
                <dt>OpenAI API</dt>
                <dd>{client.data.aiReady ? "연결 설정됨" : "키 미설정"}</dd>
              </div>
            </dl>
            {client.data.mode === "team" && (
              <form className="cw-stack cw-bordered" onSubmit={updatePassword}>
                <h3>내 스튜디오 비밀번호</h3>
                <p className="cw-note">
                  다른 브라우저에서도 팀 이메일과 이 비밀번호로 로그인할 수
                  있습니다.
                </p>
                <input
                  hidden
                  type="email"
                  autoComplete="username"
                  value={client.data.viewer.email}
                  readOnly
                />
                <FlowField label="새 비밀번호">
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={72}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </FlowField>
                <FlowField label="새 비밀번호 확인">
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={72}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </FlowField>
                <div>
                  <button
                    className="cw-btn cw-btn--dark"
                    disabled={busy || !password || !confirmPassword}
                  >
                    비밀번호 저장
                  </button>
                </div>
              </form>
            )}
            {!client.data.aiReady && (
              <p className="cw-note">
                서버에 OPENAI_API_KEY를 설정하면 키워드 리서치와 이미지 생성을
                사용할 수 있습니다.
              </p>
            )}
            {admin && client.data.mode === "team" && (
              <form className="cw-stack cw-bordered" onSubmit={invite}>
                <h3>팀원 초대</h3>
                <FlowField label="이메일 주소">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                  />
                </FlowField>
                <div>
                  <button
                    className="cw-btn cw-btn--dark"
                    disabled={busy || !email.trim()}
                  >
                    <MailPlus size={15} />
                    초대 메일 보내기
                  </button>
                </div>
              </form>
            )}
            {client.data.mode === "local" && (
              <p className="cw-note">
                팀원 초대는 팀 공유 모드에서 사용할 수 있습니다.
              </p>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="cw-notice cw-note">
            <Check size={15} />
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="cw-alert">
            {error}
          </p>
        )}
      </div>
    </WorkflowModal>
  );
}
