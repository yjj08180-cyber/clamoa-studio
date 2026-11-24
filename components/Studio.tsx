"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  FolderClosed,
  Grid2X2,
  House,
  Layers3,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  RotateCw,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import type {
  Action,
  Asset,
  Source,
  StudioClient,
  StudioPayload,
} from "../lib/types";
import { pad, thumb } from "../lib/library";
import type { Entry } from "../lib/library";
import Gallery from "./Gallery";
import Boards from "./Boards";
import { DeleteContentDialog, ProjectWorkflow } from "./ProjectWorkflow";
import { NewProjectDialog, SettingsDialog, ShotDialog } from "./ProjectDialogs";

type View = "home" | "projects" | "pool" | "boards";
const menus = [
  { id: "home", label: "스튜디오 홈", icon: House },
  { id: "projects", label: "프로젝트", icon: FolderClosed },
  { id: "pool", label: "콘텐츠 풀", icon: Layers3 },
  { id: "boards", label: "피드 편집", icon: Grid2X2 },
] as const;
function Hero({
  onCreate,
  onSample,
}: {
  onCreate: () => void;
  onSample: () => void;
}) {
  return (
    <section className="hero">
      <div className="hero-content">
        <span className="hero-season">
          <i />
          SPRING / SUMMER 2027
        </span>
        <h1>
          Feed Studio<span>.</span>
        </h1>
        <p>
          키워드에서 시작해 클라모아의 시선이 담긴
          <br className="hero-br" /> 피드 이미지를 완성하세요.
        </p>
        <button className="hero-cta" onClick={onCreate}>
          <Plus size={17} />
          콘텐츠 생성하기
          <ArrowUpRight size={16} />
        </button>
      </div>
      <button
        className="hero-art"
        onClick={onSample}
        aria-label="2027 S/S 컬러 에디토리얼 열기"
      >
        {[
          { n: 3, title: "Tide Line", theme: "Luminous Blue" },
          { n: 5, title: "Orange Peel Hem", theme: "Energy Orange" },
          { n: 10, title: "Soft Serve", theme: "Pop Pink" },
        ].map(({ n, title, theme }, i) => (
          <span key={n} className={"print print-" + i}>
            <img src={"/sample/thumb/" + pad(n) + ".webp"} alt={title} />
            <span className="print-meta">
              <strong>
                {pad(n)} / {title}
              </strong>
              <small>{theme}</small>
            </span>
          </span>
        ))}
      </button>
    </section>
  );
}
function ProjectList({
  client,
  onOpen,
  onCreate,
  home = false,
}: {
  client: StudioClient;
  onOpen: (id: string) => void;
  onCreate: () => void;
  home?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [deletionId, setDeletionId] = useState<string>();
  const projects = client.data.state.projects;
  const deleting = projects.find((project) => project.id === deletionId);
  const filtered = projects.filter((p) =>
    (p.name + " " + p.keyword + " " + p.season)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section className="projects">
      <div className={home ? "section-head" : "page-heading"}>
        <div>
          {home ? (
            <h2>
              프로젝트 <em>{projects.length}</em>
            </h2>
          ) : (
            <>
              <h1>프로젝트</h1>
              <p>브리프와 리서치부터 컷별 생성 이력까지 한곳에서 관리하세요.</p>
            </>
          )}
        </div>
        <button
          className={"btn " + (home ? "small" : "primary")}
          onClick={onCreate}
        >
          <Plus size={15} />새 프로젝트
        </button>
      </div>
      {!home && (
        <div className="library-search">
          <Search size={17} />
          <input
            aria-label="프로젝트 검색"
            placeholder="프로젝트명 또는 키워드 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      <div className="project-list">
        {(home ? filtered.slice(0, 3) : filtered).map((p) => {
          const v = p.shots
            .find((s) => s.adoptedId)
            ?.versions.find((v) => v.status === "adopted");
          return (
            <div className="project-list-item" key={p.id}>
              <button
                className="project-row"
                onClick={() => onOpen(p.id)}
              >
                {v ? (
                  <img alt="" src={thumb(v.image.url)} />
                ) : (
                  <span className="project-folder">
                    <FolderClosed size={25} />
                  </span>
                )}
                <span className="project-title">
                  <small>{p.season}</small>
                  <strong>{p.name}</strong>
                  {p.name !== p.keyword && (
                    <span>
                      {p.keyword.length > 100
                        ? p.keyword.slice(0, 100) + "…"
                        : p.keyword}
                    </span>
                  )}
                </span>
                <span className="project-stats">{p.shots.length}컷</span>
                <ArrowUpRight size={19} />
              </button>
              {!p.sample && (
                <button
                  type="button"
                  className="project-list-delete"
                  aria-label={p.name + " 프로젝트 삭제"}
                  title="프로젝트 삭제"
                  onClick={() => setDeletionId(p.id)}
                >
                  <Trash2 size={17} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!filtered.length && <p className="empty">표시할 프로젝트가 없습니다.</p>}
      {deleting && (
        <DeleteContentDialog
          client={client}
          project={deleting}
          onClose={() => setDeletionId(undefined)}
          onDeleted={() => setDeletionId(undefined)}
        />
      )}
    </section>
  );
}
function Login({
  notice,
  onLogin,
}: {
  notice: string;
  onLogin: () => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [method, setMethod] = useState<"passwordLogin" | "login">("passwordLogin"),
    [message, setMessage] = useState(notice),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <section>
        <strong className="wordmark">clamoa</strong>
        <h1>팀 스튜디오 로그인</h1>
        <p>
          {method === "passwordLogin"
            ? "팀 이메일과 스튜디오 비밀번호로 들어오세요."
            : "처음 로그인하거나 비밀번호를 잊으셨다면 이메일 링크를 받으세요."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                  method === "login"
                    ? { action: method, email }
                    : { action: method, email, password },
                ),
              });
              const b = await r.json();
              if (r.ok && method === "passwordLogin") {
                setPassword("");
                await onLogin();
                return;
              }
              setMessage(
                b.message ||
                  b.error ||
                  (r.ok
                    ? "메일함에서 로그인 링크를 확인해 주세요."
                    : "로그인 요청에 실패했습니다."),
              );
            } catch {
              setMessage("연결을 확인해 주세요.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            팀 이메일
            <input
              required
              type="email"
              autoComplete="username"
              value={email}
              placeholder="name@clamoa.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {method === "passwordLogin" && (
            <label>
              비밀번호
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          <button className="btn primary" disabled={busy}>
            {busy
              ? "처리 중…"
              : method === "login"
                ? "로그인 링크 받기"
                : "로그인"}
            <ArrowRight size={16} />
          </button>
        </form>
        <button
          className="login-option"
          type="button"
          disabled={busy}
          onClick={() => {
            setMethod(method === "login" ? "passwordLogin" : "login");
            setPassword("");
            setMessage("");
          }}
        >
          {method === "login"
            ? "비밀번호로 로그인"
            : "처음 로그인 또는 비밀번호를 잊으셨나요?"}
        </button>
        <p role="status">{message}</p>
      </section>
    </main>
  );
}
function readRoute() {
  const parts = window.location.hash.slice(1).split("/");
  return {
    view: (menus.some((m) => m.id === parts[0]) ? parts[0] : "home") as View,
    id: parts[0] === "projects" ? parts[1] || "" : "",
  };
}
export default function Studio() {
  const [data, setData] = useState<StudioPayload | null>(null),
    [error, setError] = useState(""),
    [login, setLogin] = useState(false),
    [route, setRoute] = useState<{ view: View; id: string }>({
      view: "home",
      id: "",
    }),
    [mobile, setMobile] = useState(false),
    [newProject, setNew] = useState(false),
    [reference, setReference] = useState<Source>(),
    [settings, setSettings] = useState(false),
    [review, setReview] = useState<{
      p: string;
      s: string;
      versionId?: string;
    } | null>(null),
    [toast, setToast] = useState("");
  const token = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((s: string) => {
    setToast(s);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const load = useCallback(async () => {
    const t = ++token.current;
    try {
      const request = () => fetch("/api/studio", { cache: "no-store" });
      const res = await (navigator.locks
        ? navigator.locks.request("clamoa-studio-session", request)
        : request());
      if (t !== token.current) return;
      if (res.status === 401) {
        setLogin(true);
        setData(null);
        return;
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "스튜디오를 열지 못했습니다.");
      if (t === token.current) {
        setData(body);
        setError("");
        setLogin(false);
      }
    } catch (e) {
      if (t === token.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const sync = () => {
      setRoute(readRoute());
      setMobile(false);
      setReview(null);
      window.scrollTo(0, 0);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      clearTimeout(timer.current);
    };
  }, [load]);
  const working =
    data?.state.jobs.some((j) => ["running", "queued"].includes(j.status)) ||
    false;
  useEffect(() => {
    if (!data || login) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const id = setInterval(refreshWhenVisible, working ? 2200 : 30000);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [!!data, login, working, load]);
  function go(view: View, id = "") {
    window.location.hash = view + (id ? "/" + id : "");
    setRoute({ view, id });
    setMobile(false);
  }
  async function act(action: Action) {
    try {
      ++token.current;
      const r = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const b = await r.json();
      if (!r.ok) {
        if (r.status === 401) setLogin(true);
        throw new Error(b.error || "작업을 저장하지 못했습니다.");
      }
      ++token.current;
      setData(b);
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    }
  }
  async function upload(file: File): Promise<Asset> {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/assets", { method: "POST", body: fd });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error || "파일을 올리지 못했습니다.");
    return b.asset;
  }
  function start(e?: Entry) {
    setReference(
      e
        ? {
            id: crypto.randomUUID(),
            kind: "mood",
            name: e.version.plan.title,
            asset: e.version.image,
            referenceRole: "base",
            referenceNumber: e.shot.number,
          }
        : undefined,
    );
    setNew(true);
    setMobile(false);
  }
  const project = data?.state.projects.find((p) => p.id === route.id),
    reviewProject = data?.state.projects.find((p) => p.id === review?.p),
    reviewShot = reviewProject?.shots.find((s) => s.id === review?.s);
  const title = menus.find((m) => m.id === route.view)!.label;
  if (login)
    return (
      <Login
        onLogin={load}
        notice={
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).has("auth_error")
            ? "로그인 링크가 만료되었습니다. 새 링크를 받아 주세요."
            : ""
        }
      />
    );
  const client: StudioClient | undefined = data
    ? { data, act, upload, notify }
    : undefined;
  return (
    <div className="studio">
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={"sidebar " + (mobile ? "visible" : "")}>
        <button
          className="brand"
          onClick={() => go("home")}
          aria-label="클라모아 스튜디오 홈"
        >
          <span className="wordmark">clamoa</span>
          <span className="studio-mark">STUDIO</span>
        </button>
        <div className="nav-label">워크스페이스</div>
        <nav aria-label="주 메뉴">
          {menus.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={route.view === id ? "page" : undefined}
              className={"nav-item " + (route.view === id ? "selected" : "")}
              onClick={() => go(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "pool" && data && (
                <small>
                  {data.state.projects.reduce(
                    (n, p) => n + p.shots.filter((s) => s.adoptedId).length,
                    0,
                  )}
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-divider" />
        <div className="nav-label">브랜드 관리</div>
        <button
          className="nav-item"
          disabled={!data}
          onClick={() => {
            setSettings(true);
            setMobile(false);
          }}
        >
          <Settings2 size={19} />
          스튜디오 설정
        </button>
        <div className="sidebar-bottom">
          <div className="team-icon">
            c<span>.</span>
          </div>
          <div>
            <strong>클라모아 팀</strong>
            <small>
              {data?.mode === "team" ? "팀 워크스페이스" : "로컬 워크스페이스"}
            </small>
          </div>
          {data?.mode === "team" && (
            <button
              title="로그아웃"
              aria-label="로그아웃"
              onClick={async () => {
                await fetch("/api/auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "logout" }),
                });
                void load();
              }}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>
      <div className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu"
              aria-label="메뉴 열기"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <LayoutGrid size={16} />
            <span>워크스페이스</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
            {project && (
              <>
                <ChevronRight size={13} />
                <span className="crumb-project">{project.name}</span>
              </>
            )}
          </div>
          <div className="top-date">
            <CalendarDays size={14} />
            {new Intl.DateTimeFormat("ko-KR", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              timeZone: "Asia/Seoul",
            }).format(new Date())}
          </div>
        </header>
        <main className="workspace">
          {!data || !client ? (
            <div className="empty load-state">
              {error ? (
                <>
                  <CircleAlert />
                  {error}
                  <button className="btn" onClick={load}>
                    <RotateCw size={15} />
                    다시 열기
                  </button>
                </>
              ) : (
                <>스튜디오를 여는 중입니다…</>
              )}
            </div>
          ) : (
            <>
              {error && <p className="connection-error">{error}</p>}
              {route.view === "home" ? (
                <>
                  <Hero
                    onCreate={() => start()}
                    onSample={() => go("projects", "ss27")}
                  />
                  <Gallery
                    home
                    state={data.state}
                    onOpen={(e) =>
                      setReview({
                        p: e.project.id,
                        s: e.shot.id,
                        versionId: e.version.id,
                      })
                    }
                    onNew={start}
                    onAll={() => go("pool")}
                  />
                  <ProjectList
                    home
                    client={client}
                    onOpen={(id) => go("projects", id)}
                    onCreate={() => start()}
                  />
                </>
              ) : route.view === "pool" ? (
                <Gallery
                  state={data.state}
                  onOpen={(e) =>
                    setReview({
                      p: e.project.id,
                      s: e.shot.id,
                      versionId: e.version.id,
                    })
                  }
                  onNew={start}
                  onAll={() => go("pool")}
                />
              ) : route.view === "boards" ? (
                <Boards
                  client={client}
                  onOpen={(e) =>
                    setReview({
                      p: e.project.id,
                      s: e.shot.id,
                      versionId: e.version.id,
                    })
                  }
                />
              ) : project ? (
                <>
                  <button className="back-link" onClick={() => go("projects")}>
                    ← 프로젝트 목록
                  </button>
                  <ProjectWorkflow
                    key={project.id}
                    client={client}
                    project={project}
                    onReview={(s) => setReview({ p: project.id, s })}
                    onProjectDeleted={() => go("projects")}
                  />
                </>
              ) : (
                <ProjectList
                  client={client}
                  onOpen={(id) => go("projects", id)}
                  onCreate={() => start()}
                />
              )}
            </>
          )}
        </main>
      </div>
      {client && newProject && (
        <NewProjectDialog
          client={client}
          reference={reference}
          onClose={() => setNew(false)}
          onCreated={(id) => {
            setNew(false);
            go("projects", id);
          }}
        />
      )}
      {client && settings && (
        <SettingsDialog client={client} onClose={() => setSettings(false)} />
      )}
      {client && reviewShot && reviewProject && (
        <ShotDialog
          client={client}
          project={reviewProject}
          shot={reviewShot}
          initialVersionId={review?.versionId}
          onClose={() => setReview(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="알림 닫기" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
