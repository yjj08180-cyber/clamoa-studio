import { HttpError } from "./http";

export function teamConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const site = process.env.STUDIO_SITE_URL;
  if (!url && !anon && !service && !site) return null;
  if (!url || !anon || !service || !site)
    throw new HttpError(503, "팀 로그인 및 저장소 환경 설정을 완료해 주세요.");
  return { url, anon, service, site: new URL(site).origin };
}

export function requiredTeam() {
  const config = teamConfig();
  if (!config)
    throw new HttpError(409, "팀 설정 후 이용할 수 있는 기능입니다.");
  return config;
}

export async function supa(
  path: string,
  options: RequestInit = {},
  role: "service" | "anon" = "service",
) {
  const c = requiredTeam();
  const key = role === "service" ? c.service : c.anon;
  const headers = new Headers(options.headers);
  headers.set("apikey", key);
  // The gateway accepts opaque Supabase secret/publishable keys in apikey.
  // Legacy JWT keys also carry the database role in Authorization.
  if (!headers.has("Authorization") && key.split(".").length === 3)
    headers.set("Authorization", "Bearer " + key);
  if (
    options.body &&
    typeof options.body === "string" &&
    !headers.has("Content-Type")
  )
    headers.set("Content-Type", "application/json");
  return fetch(c.url + path, {
    ...options,
    headers,
    cache: "no-store",
    signal: options.signal || AbortSignal.timeout(30_000),
  });
}

export async function dbJson<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const r = await supa("/rest/v1/" + path, options);
  if (!r.ok) {
    console.error("[clamoa] Database operation failed", r.status);
    throw new HttpError(
      503,
      "팀 저장소에 연결할 수 없습니다. 데이터베이스 설정을 확인해 주세요.",
    );
  }
  if (r.status === 204 || r.headers.get("content-length") === "0")
    return undefined as T;
  const text = await r.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
