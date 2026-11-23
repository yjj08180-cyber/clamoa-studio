"use client";
import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  GripVertical,
  Image as ImageIcon,
  LayoutGrid,
  Plus,
  Save,
  X,
} from "lucide-react";
import type { StudioClient, Board } from "../lib/types";
import { entries, pad, thumb, type Entry } from "../lib/library";
import { downloadVersions } from "../lib/client";

function BoardEditor({
  client,
  board,
  onOpen,
}: {
  client: StudioClient;
  board: Board;
  onOpen: (entry: Entry) => void;
}) {
  const [draft, setDraft] = useState<Board | null>(null),
    [busy, setBusy] = useState(""),
    [search, setSearch] = useState("");
  const view = draft || board;
  const name = view.name;
  const setIds = (versionIds: string[]) => setDraft({ ...view, versionIds });
  const setName = (value: string) => setDraft({ ...view, name: value });
  const conflict = draft && draft.updatedAt !== board.updatedAt;
  const versions = useMemo(
    () =>
      new Map(entries(client.data.state, true).map((e) => [e.version.id, e])),
    [client.data.state],
  );
  const ids = view.versionIds.filter((id) => versions.has(id));
  const candidates = entries(client.data.state).filter(
    (e) =>
      !ids.includes(e.version.id) &&
      [e.project.name, e.version.plan.title, e.version.plan.theme]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  function move(from: number, to: number) {
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setIds(next);
  }
  async function save() {
    setBusy("save");
    try {
      if (
        await client.act({
          type: "board",
          id: board.id,
          name,
          versionIds: ids,
          baseUpdatedAt: view.updatedAt,
        })
      ) {
        setDraft(null);
        client.notify("피드 배열을 저장했습니다.");
      }
    } finally {
      setBusy("");
    }
  }
  async function exportFile(format: "index" | "zip") {
    setBusy(format);
    try {
      await downloadVersions(ids, format);
    } catch (e) {
      client.notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="board-editor">
      <div className="board-work">
        <div className="board-tools">
          <input
            aria-label="배열 이름"
            className="board-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
          <button
            className="btn dark small"
            disabled={!name.trim() || !!busy}
            onClick={save}
          >
            <Save size={15} />
            저장
          </button>
        </div>
        {conflict && (
          <p className="connection-error">
            다른 팀원이 배열을 변경했습니다.{" "}
            <button className="text-btn" onClick={() => setDraft(null)}>
              최신 저장본 열기
            </button>
          </p>
        )}
        <div className="board-grid">
          {ids.map((id, i) => {
            const entry = versions.get(id);
            if (!entry) return null;
            return (
              <div
                key={id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  move(ids.indexOf(e.dataTransfer.getData("text/plain")), i);
                }}
                className="board-cell"
              >
                <button
                  className="board-inspect"
                  title="이 버전의 제작 기록"
                  aria-label={entry.version.plan.title + " 제작 기록"}
                  onClick={() => onOpen(entry)}
                >
                  <img
                    draggable={false}
                    alt={entry.version.plan.title}
                    src={thumb(entry.version.image.url)}
                  />
                </button>
                <span className="board-count">{pad(i + 1)}</span>
                <div className="cell-actions">
                  <button
                    aria-label="앞으로 이동"
                    disabled={!i}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowUp />
                  </button>
                  <button
                    aria-label="뒤로 이동"
                    disabled={i === ids.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown />
                  </button>
                  <button
                    aria-label="배열에서 빼기"
                    onClick={() => setIds(ids.filter((x) => x !== id))}
                  >
                    <X />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {!ids.length && (
          <p className="empty compact">
            <LayoutGrid />
            콘텐츠 풀에서 컷을 추가하세요.
          </p>
        )}
        <div className="exportbar">
          <span>
            <GripVertical size={15} />
            {ids.length}컷 · 드래그로 순서 변경
          </span>
          <button
            className="btn small"
            disabled={!ids.length || !!busy}
            onClick={() => exportFile("index")}
          >
            <ImageIcon size={14} />
            인덱스 JPG
          </button>
          <button
            className="btn small primary"
            disabled={!ids.length || !!busy}
            onClick={() => exportFile("zip")}
          >
            <Download size={14} />
            {busy === "zip" ? "준비 중…" : "ZIP 다운로드"}
          </button>
        </div>
      </div>
      <aside className="board-picker">
        <h3>콘텐츠 풀에서 추가</h3>
        <input
          className="field"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="컷 또는 프로젝트 검색"
          aria-label="추가할 컷 검색"
        />
        <div className="pick-list">
          {candidates.map((e) => (
            <button
              key={e.version.id}
              onClick={() => setIds([...ids, e.version.id])}
            >
              <img src={thumb(e.version.image.url)} alt="" />
              <span>
                <strong>{e.version.plan.title}</strong>
                <small>{e.project.name}</small>
              </span>
              <Plus size={17} />
            </button>
          ))}
        </div>
        {!candidates.length && <p className="quiet">추가할 컷이 없습니다.</p>}
      </aside>
    </div>
  );
}
export default function Boards({
  client,
  onOpen,
}: {
  client: StudioClient;
  onOpen: (entry: Entry) => void;
}) {
  const boards = client.data.state.boards,
    [id, setId] = useState(boards[0]?.id || ""),
    [creating, setCreating] = useState(false);
  const cur = boards.find((b) => b.id === id) || boards[0];
  async function create() {
    setCreating(true);
    try {
      const id = crypto.randomUUID();
      if (
        await client.act({
          type: "board",
          id,
          name: "새 피드 배열",
          versionIds: [],
        })
      )
        setId(id);
    } finally {
      setCreating(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>피드 편집</h1>
          <p>채택한 컷을 세 열로 배열하고 게시용 파일을 내려받으세요.</p>
        </div>
        <button className="btn primary" disabled={creating} onClick={create}>
          <Plus size={17} />새 배열
        </button>
      </div>
      <div className="board-tabs">
        {boards.map((b) => (
          <button
            key={b.id}
            className={cur?.id === b.id ? "on" : ""}
            onClick={() => setId(b.id)}
          >
            {cur?.id === b.id && <Check size={13} />} {b.name}
          </button>
        ))}
      </div>
      {creating && (
        <p role="status" className="empty">
          새 배열을 여는 중입니다…
        </p>
      )}
      {!creating && cur && (
        <BoardEditor key={cur.id} board={cur} client={client} onOpen={onOpen} />
      )}
    </>
  );
}
