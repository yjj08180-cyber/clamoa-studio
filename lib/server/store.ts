import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Action, Asset, StudioState } from "../types";
import { getSeedState } from "./seed";
import { dbJson, supa, teamConfig } from "./config";
import { HttpError } from "./http";

export type StoredStudio = {
  state: StudioState;
  leases: Record<string, { token: string; expiresAt: number }>;
};
type Row = { revision: number; document: StoredStudio };
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assetPath = (id: string) => "/api/assets/" + id;
let local: Promise<DatabaseSync> | undefined;
let bundled: Map<string, Asset> | undefined;

function bundledAsset(id: string): Asset | undefined {
  if (!bundled) {
    const seed = getSeedState();
    const images = seed.projects.flatMap((p) =>
      p.shots.flatMap((s) => s.versions.map((v) => v.image)),
    );
    bundled = new Map(
      [...seed.logos.map((logo) => logo.asset), ...images].map((a) => [
        a.id,
        a,
      ]),
    );
  }
  return bundled.get(id);
}

function database(): Promise<DatabaseSync> {
  if (!local)
    local = (async () => {
      const folder = resolve(
        /* turbopackIgnore: true */ process.env.STUDIO_DATA_DIR || ".clamoa",
      );
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(resolve(folder, "studio.sqlite"));
      db.exec(`PRAGMA busy_timeout=10000;
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL);`);
      return db;
    })().catch((e) => {
      local = undefined;
      throw e;
    });
  return local;
}

async function snapshot(): Promise<Row> {
  if (!teamConfig()) {
    const db = await database();
    let row = db
      .prepare("SELECT revision,document FROM workspace WHERE id=1")
      .get();
    if (!row) {
      db.prepare("INSERT OR IGNORE INTO workspace VALUES(1,0,?)").run(
        JSON.stringify({ state: getSeedState(), leases: {} }),
      );
      row = db
        .prepare("SELECT revision,document FROM workspace WHERE id=1")
        .get()!;
    }
    return {
      revision: Number(row.revision),
      document: JSON.parse(String(row.document)),
    };
  }
  const query = "clamoa_workspace?id=eq.1&select=revision,document";
  const [row] = await dbJson<Row[]>(query);
  if (row) return row;
  await dbJson("clamoa_workspace", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      id: 1,
      revision: 0,
      document: { state: getSeedState(), leases: {} },
    }),
  });
  const [created] = await dbJson<Row[]>(query);
  if (!created) throw new HttpError(503, "스튜디오를 초기화할 수 없습니다.");
  return created;
}

export async function readState(): Promise<StudioState> {
  return (await snapshot()).document.state;
}

// The callback may be replayed on conflict. All network/AI side effects belong outside it.
export async function transact<T>(
  update: (doc: StoredStudio) => { value: T; skip?: boolean },
): Promise<T> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const { revision, document } = await snapshot();
    const { value, skip } = update(document);
    if (skip) return value;
    if (teamConfig()) {
      const rows = await dbJson<{ id: number }[]>(
        "clamoa_workspace?id=eq.1&revision=eq." + revision + "&select=id",
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ revision: revision + 1, document }),
        },
      );
      if (rows.length) return value;
    } else {
      const db = await database();
      const { changes } = db
        .prepare(
          "UPDATE workspace SET revision=revision+1,document=? WHERE id=1 AND revision=?",
        )
        .run(JSON.stringify(document), revision);
      if (changes) return value;
    }
    await new Promise((r) =>
      setTimeout(r, 10 + Math.random() * (attempt + 1) * 10),
    );
  }
  throw new HttpError(409, "동시 편집이 많습니다. 잠시 후 다시 시도해 주세요.");
}

export async function saveAsset(
  bytes: Buffer,
  name: string,
  mime: string,
): Promise<Asset> {
  const id = randomUUID();
  const cleanName =
    name.replace(/[\u0000-\u001F\u007F/\\]/g, "_").slice(0, 180) || "asset";
  const asset = { id, name: cleanName, mime, url: assetPath(id) };
  if (!teamConfig()) {
    const db = await database();
    db.prepare("INSERT INTO assets VALUES(?,?,?,?)").run(
      id,
      cleanName,
      mime,
      bytes,
    );
  } else {
    const r = await supa("/storage/v1/object/clamoa-private/" + id, {
      method: "POST",
      headers: { "Content-Type": mime },
      body: new Uint8Array(bytes),
    });
    if (!r.ok)
      throw new HttpError(503, "파일을 팀 저장소에 업로드하지 못했습니다.");
    try {
      await dbJson("clamoa_assets", {
        method: "POST",
        body: JSON.stringify({ id, name: cleanName, mime }),
      });
    } catch (error) {
      // The new random ID has not been returned to any caller. Roll both writes
      // back even when the database accepted an insert but its response was lost.
      const cleanup = await Promise.allSettled([
        supa("/storage/v1/object/clamoa-private", {
          method: "DELETE",
          body: JSON.stringify({ prefixes: [id] }),
        }),
        supa("/rest/v1/clamoa_assets?id=eq." + id, { method: "DELETE" }),
      ]);
      if (cleanup.some((item) => item.status === "rejected" || !item.value.ok))
        console.error("[clamoa] Incomplete upload cleanup", id);
      throw error;
    }
  }
  return asset;
}

export async function assetMeta(id: string): Promise<Asset> {
  if (!uuidPattern.test(id))
    throw new HttpError(404, "파일을 찾을 수 없습니다.");
  const row = teamConfig()
    ? (
        await dbJson<{ id: string; name: string; mime: string }[]>(
          "clamoa_assets?id=eq." + id + "&select=id,name,mime",
        )
      )[0]
    : (await database())
        .prepare("SELECT id,name,mime FROM assets WHERE id=?")
        .get(id);
  if (!row) throw new HttpError(404, "파일을 찾을 수 없습니다.");
  return {
    id,
    name: String(row.name),
    mime: String(row.mime),
    url: assetPath(id),
  };
}

export async function readAsset(asset: Asset): Promise<Buffer> {
  const url = asset.url;
  if (
    url === "/sample/wordmark-guide.png" ||
    /^\/sample\/Feed\/\d{2}_[A-Za-z0-9_-]+\.jpg$/.test(url)
  ) {
    return readFile(resolve("content", url.slice(1)));
  }
  if (!uuidPattern.test(asset.id) || url !== assetPath(asset.id))
    throw new HttpError(400, "스튜디오에 저장된 파일을 선택해 주세요.");
  if (!teamConfig()) {
    const row = (await database())
      .prepare("SELECT bytes FROM assets WHERE id=?")
      .get(asset.id);
    if (!row) throw new HttpError(404, "파일을 찾을 수 없습니다.");
    return Buffer.from(row.bytes as Uint8Array);
  }
  const r = await supa(
    "/storage/v1/object/authenticated/clamoa-private/" + asset.id,
  );
  if (!r.ok)
    throw new HttpError(
      r.status === 404 ? 404 : 503,
      "팀 저장소에서 파일을 읽지 못했습니다.",
    );
  return Buffer.from(await r.arrayBuffer());
}

// Resolve user-supplied attachments to trusted metadata before recording them.
export async function canonicalAction(action: Action): Promise<Action> {
  const saved = async (a: Asset) => {
    if (!a || typeof a.id !== "string")
      throw new HttpError(400, "업로드한 파일을 선택해 주세요.");
    if (!uuidPattern.test(a.id)) {
      const reference = bundledAsset(a.id);
      if (!reference || a.url !== reference.url)
        throw new HttpError(400, "등록된 예시 이미지를 선택해 주세요.");
      return { ...reference };
    }
    return assetMeta(a.id);
  };
  if (action.type === "uploadVersion" || action.type === "logo") {
    const asset = await saved(action.asset);
    if (!asset.mime.startsWith("image/"))
      throw new HttpError(400, "이미지 파일을 선택해 주세요.");
    return { ...action, asset };
  }
  if (action.type === "sources" || action.type === "createProject") {
    if (!Array.isArray(action.sources) || action.sources.length > 100)
      throw new HttpError(400, "소스는 최대 100개까지 등록할 수 있습니다.");
    const sources = await Promise.all(
      action.sources.map(async (source) => {
        if (!source || typeof source !== "object")
          throw new HttpError(400, "소스 형식을 확인해 주세요.");
        if (source.kind === "pdf" || (source.kind === "mood" && source.asset)) {
          if (!source.asset)
            throw new HttpError(400, "소스 파일이 필요합니다.");
          const asset = await saved(source.asset);
          if (
            source.kind === "pdf"
              ? asset.mime !== "application/pdf"
              : !asset.mime.startsWith("image/")
          )
            throw new HttpError(400, "소스 파일의 형식을 확인해 주세요.");
          return { ...source, asset };
        }
        const { asset: _ignored, ...rest } = source;
        return rest;
      }),
    );
    return { ...action, sources };
  }
  return action;
}
