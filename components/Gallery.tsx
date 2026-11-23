"use client";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { entries, pad, thumb, themeColors } from "../lib/library";
import type { Entry } from "../lib/library";
import type { StudioState } from "../lib/types";
const featured = [1, 8, 9, 15, 3, 5, 10, 17];
export default function Gallery({
  state,
  home = false,
  onOpen,
  onNew,
  onAll,
}: {
  state: StudioState;
  home?: boolean;
  onOpen: (e: Entry) => void;
  onNew: (e: Entry) => void;
  onAll: () => void;
}) {
  const [theme, setTheme] = useState("전체"),
    [query, setQuery] = useState(""),
    [genre, setGenre] = useState(""),
    [season, setSeason] = useState(""),
    [material, setMaterial] = useState(""),
    [status, setStatus] = useState<"adopted" | "held" | "all">("adopted"),
    [filters, setFilters] = useState(false);
  const all =
    status === "adopted"
      ? entries(state)
      : entries(state, true)
          .filter(
            ({ version }) =>
              version.status === "adopted" || version.status === "held",
          )
          .filter(
            ({ version }) => status === "all" || version.status === status,
          );
  const cutNumber = /^(?:컷\s*)?0*(\d{1,4})(?:번)?$/.exec(query.trim())?.[1];
  const themes = [
    ...new Set(all.map((e) => e.version.plan.theme).filter(Boolean)),
  ];
  const values = (fn: (e: Entry) => string) => [
    ...new Set(all.map(fn).filter(Boolean)),
  ];
  const list = all.filter(
    ({ project, shot, version: { plan } }) =>
      (theme === "전체" || theme === plan.theme) &&
      (!season || season === project.season) &&
      (!genre || genre === plan.genre) &&
      (!material || material === plan.material) &&
      (cutNumber
        ? shot.number === Number(cutNumber)
        : [
            plan.title,
            plan.subject,
            plan.material,
            plan.genre,
            plan.theme,
            project.name,
            project.season,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query.trim().toLowerCase())),
  );
  if (home && theme === "전체")
    list.sort((a, b) => {
      const rank = (e: Entry) =>
        e.project.sample
          ? featured.indexOf(e.shot.number) >= 0
            ? featured.indexOf(e.shot.number)
            : 100
          : -1;
      return rank(a) - rank(b);
    });
  return (
    <section className={home ? "library home-library" : "library"}>
      <div className={home ? "section-head" : "page-heading"}>
        <div>
          {home ? (
            <h2>
              콘텐츠 풀 <em>{all.length}</em>
            </h2>
          ) : (
            <>
              <h1>
                콘텐츠 풀 <em>{all.length}</em>
              </h1>
              <p>채택본과 보류본의 제작 기록을 찾아보세요.</p>
            </>
          )}
        </div>
        {home ? (
          <button className="text-btn" onClick={onAll}>
            전체 보기 <ArrowRight size={15} />
          </button>
        ) : (
          <button
            className={"btn small " + (filters ? "tinted" : "")}
            onClick={() => setFilters(!filters)}
            aria-expanded={filters}
          >
            <SlidersHorizontal size={15} />
            필터
          </button>
        )}
      </div>
      {!home && (
        <div className="library-search">
          <Search size={17} />
          <input
            aria-label="콘텐츠 검색"
            placeholder="컷 번호, 제목, 소재 또는 시즌 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {!home && (
        <div className="color-filters" aria-label="검수 상태">
          {(
            [
              ["adopted", "채택본"],
              ["held", "보류본"],
              ["all", "채택·보류 전체"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={status === key ? "active" : ""}
              aria-pressed={status === key}
              onClick={() => {
                setStatus(key);
                setTheme("전체");
                setGenre("");
                setSeason("");
                setMaterial("");
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {filters && (
        <div className="filterbar">
          {[
            [genre, setGenre, values((e) => e.version.plan.genre), "장르"],
            [season, setSeason, values((e) => e.project.season), "시즌"],
            [
              material,
              setMaterial,
              values((e) => e.version.plan.material),
              "소재",
            ],
          ].map(([val, set, opts, label]) => (
            <label key={String(label)}>
              {String(label)}
              <select
                value={val as string}
                onChange={(e) => (set as (s: string) => void)(e.target.value)}
              >
                <option value="">전체</option>
                {(opts as string[]).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <div className="color-filters">
        <button
          className={theme === "전체" ? "active" : ""}
          onClick={() => setTheme("전체")}
        >
          전체
        </button>
        {themes.map((t) => (
          <button
            key={t}
            className={theme === t ? "active" : ""}
            onClick={() => setTheme(t)}
          >
            <i style={{ background: themeColors[t] || "#888" }} />
            {t}
          </button>
        ))}
      </div>
      <div className="shot-grid">
        {(home ? list.slice(0, 4) : list).map((e) => (
          <article className="shot-card" key={e.version.id}>
            <button
              className="shot-photo"
              onClick={() => onOpen(e)}
              aria-label={e.version.plan.title + " 컷 보기"}
            >
              <img
                alt={e.version.plan.subject}
                loading="lazy"
                src={thumb(e.version.image.url)}
              />
              <span className="plate-no">{pad(e.shot.number)}</span>
              <span className="photo-hover">
                <ArrowUpRight size={22} />
              </span>
            </button>
            <div className="shot-caption">
              <div>
                <button onClick={() => onOpen(e)}>
                  {e.version.plan.title}
                </button>
                <small>
                  <i
                    style={{
                      background: themeColors[e.version.plan.theme] || "#999",
                    }}
                  />
                  {e.version.plan.theme}
                  {e.version.status === "held" && " · 보류"}
                </small>
              </div>
              <button
                className="round-add"
                onClick={() => onNew(e)}
                title="이 컷을 참고해 새 프로젝트"
                aria-label={e.version.plan.title + " 참고해 새 프로젝트"}
              >
                <Plus size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!list.length && <p className="empty">조건에 맞는 컷이 없습니다.</p>}
    </section>
  );
}
