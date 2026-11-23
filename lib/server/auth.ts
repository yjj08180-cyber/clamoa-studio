import { cookies } from "next/headers";
import type { Viewer } from "../types";
import { dbJson, requiredTeam, supa, teamConfig } from "./config";
import { HttpError } from "./http";

const ACCESS = "clamoa-access";
const REFRESH = "clamoa-refresh";
type Session = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};
const refreshes = new Map<string, Promise<Session | undefined>>();
const rememberedDays = 90;
const loop = (host: string) =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host.toLowerCase());
const hostName = (value: string) => {
  try {
    return new URL("http://" + value).hostname;
  } catch {
    return "";
  }
};

function localRequest(request: Request) {
  const host = request.headers.get("host") || "";
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedFor = request.headers.get("x-forwarded-for");
  return (
    !process.env.VERCEL &&
    loop(new URL(request.url).hostname) &&
    loop(hostName(host)) &&
    (!forwardedHost ||
      forwardedHost.split(",").every((h) => loop(hostName(h.trim())))) &&
    (!forwardedFor ||
      forwardedFor
        .split(",")
        .every((h) => loop(h.trim()) || h.trim() === "::ffff:127.0.0.1"))
  );
}

export function normalizeEmail(input: unknown): string {
  if (typeof input !== "string")
    throw new HttpError(400, "이메일 주소를 확인해 주세요.");
  const email = input.trim().toLowerCase();
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email) || email.length > 254)
    throw new HttpError(400, "이메일 주소를 확인해 주세요.");
  return email;
}

async function membership(email: string): Promise<Viewer | undefined> {
  const params = new URLSearchParams({
    email: "eq." + email,
    select: "email,role",
  });
  const [member] = await dbJson<Viewer[]>("clamoa_members?" + params);
  return member;
}

async function setSession(session: Session) {
  if (!session.access_token || !session.refresh_token)
    throw new HttpError(401, "로그인 링크를 다시 요청해 주세요.");
  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: new URL(requiredTeam().site).protocol === "https:",
    sameSite: "lax",
    path: "/",
  } as const;
  jar.set(ACCESS, session.access_token, {
    ...options,
    maxAge: session.expires_in || 3600,
  });
  jar.set(REFRESH, session.refresh_token, {
    ...options,
    maxAge: rememberedDays * 86400,
  });
}

async function verifiedViewer(access: string): Promise<Viewer | undefined> {
  const r = await supa(
    "/auth/v1/user",
    { headers: { Authorization: "Bearer " + access } },
    "anon",
  );
  if (r.status === 401 || r.status === 403) return undefined;
  if (!r.ok) throw new HttpError(503, "로그인 서버에 연결할 수 없습니다.");
  const user = await r.json();
  if (!user.email || !user.email_confirmed_at)
    throw new HttpError(403, "확인된 팀 이메일이 필요합니다.");
  const member = await membership(normalizeEmail(user.email));
  if (!member) throw new HttpError(403, "초대된 팀원만 이용할 수 있습니다.");
  return member;
}

async function refreshSession(refresh: string): Promise<Session | undefined> {
  let request = refreshes.get(refresh);
  if (!request) {
    request = supa(
      "/auth/v1/token?grant_type=refresh_token",
      { method: "POST", body: JSON.stringify({ refresh_token: refresh }) },
      "anon",
    )
      .then(async (response) => {
        if (response.ok) return response.json() as Promise<Session>;
        if (response.status >= 500 || response.status === 429)
          throw new HttpError(503, "로그인 연결을 잠시 확인할 수 없습니다.");
        return undefined;
      })
      .finally(() => refreshes.delete(refresh));
    refreshes.set(refresh, request);
  }
  return request;
}

function expiresSoon(access: string) {
  try {
    const { exp } = JSON.parse(
      Buffer.from(access.split(".")[1], "base64url").toString("utf8"),
    );
    return Number.isFinite(exp) && exp * 1000 <= Date.now() + 90_000;
  } catch {
    return false;
  }
}

async function getTeamSession(renewEarly = false) {
  const jar = await cookies();
  const access = jar.get(ACCESS)?.value;
  const refresh = jar.get(REFRESH)?.value;
  const earlyRefresh = access && refresh && renewEarly && expiresSoon(access);
  if (access && !earlyRefresh) {
    const viewer = await verifiedViewer(access);
    if (viewer) return { viewer, access };
  }
  if (refresh) {
    const session = await refreshSession(refresh);
    if (session?.access_token) {
      const viewer = await verifiedViewer(session.access_token);
      if (viewer) {
        await setSession(session);
        return { viewer, access: session.access_token };
      }
    }
  }
  if (access && earlyRefresh) {
    const viewer = await verifiedViewer(access);
    if (viewer) return { viewer, access };
  }
  throw new HttpError(401, "팀 이메일로 로그인해 주세요.");
}

export async function getViewer(request: Request): Promise<Viewer> {
  if (!teamConfig()) {
    if (!localRequest(request))
      throw new HttpError(503, "외부 접속에는 팀 로그인 설정이 필요합니다.");
    return { email: "local@clamoa.studio", role: "admin" };
  }
  return (
    await getTeamSession(
      request.method === "GET" &&
        new URL(request.url).pathname === "/api/studio",
    )
  ).viewer;
}

export async function passwordLogin(email: string, password: unknown) {
  const invalid =
    "이메일과 비밀번호를 확인해 주세요. 처음이라면 이메일 링크로 로그인하세요.";
  if (
    typeof password !== "string" ||
    !password ||
    Buffer.byteLength(password) > 72
  )
    throw new HttpError(401, invalid);
  const response = await supa(
    "/auth/v1/token?grant_type=password",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
    },
    "anon",
  );
  if (response.status === 429 || response.status >= 500)
    throw new HttpError(
      response.status === 429 ? 429 : 503,
      "잠시 후 다시 로그인해 주세요.",
    );
  if (!response.ok) throw new HttpError(401, invalid);
  const session = (await response.json()) as Session;
  if (!session.access_token || !(await verifiedViewer(session.access_token)))
    throw new HttpError(401, invalid);
  await setSession(session);
}

export async function savePassword(password: unknown) {
  if (
    typeof password !== "string" ||
    password.trim().length < 8 ||
    Buffer.byteLength(password) > 72
  )
    throw new HttpError(
      400,
      "새 비밀번호는 8자 이상 72바이트 이하로 입력해 주세요.",
    );
  const { access } = await getTeamSession();
  const response = await supa(
    "/auth/v1/user",
    {
      method: "PUT",
      headers: { Authorization: "Bearer " + access },
      body: JSON.stringify({ password }),
    },
    "anon",
  );
  if (!response.ok) {
    const { error_code } = await response.json().catch(() => ({}));
    if (
      error_code === "reauthentication_needed" ||
      error_code === "reauthentication_not_valid"
    )
      throw new HttpError(
        403,
        "계정 확인이 필요합니다. 이메일 링크로 다시 로그인한 뒤 비밀번호를 설정해 주세요.",
      );
    if (error_code === "same_password")
      throw new HttpError(
        400,
        "현재 사용 중인 비밀번호와 다른 값을 입력해 주세요.",
      );
    throw new HttpError(
      response.status >= 500 ? 503 : 400,
      "비밀번호를 설정하지 못했습니다. 길이와 문자 구성을 확인해 주세요.",
    );
  }
}

async function sendOtp(email: string) {
  const redirect = encodeURIComponent(
    requiredTeam().site + "/api/auth/callback",
  );
  return supa(
    "/auth/v1/otp?redirect_to=" + redirect,
    { method: "POST", body: JSON.stringify({ email, create_user: true }) },
    "anon",
  );
}

export async function login(email: string) {
  // Keep the result identical for uninvited emails.
  if (!(await membership(email))) return;
  const r = await sendOtp(email);
  if (!r.ok)
    throw new HttpError(
      r.status === 429 ? 429 : 503,
      "메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
}

export async function invite(email: string) {
  const redirect = encodeURIComponent(
    requiredTeam().site + "/api/auth/callback",
  );
  await dbJson("clamoa_members", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ email, role: "member" }),
  });
  let r = await supa("/auth/v1/invite?redirect_to=" + redirect, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  // Existing Supabase users receive a fresh sign-in link.
  if (!r.ok && [400, 422].includes(r.status)) r = await sendOtp(email);
  if (!r.ok)
    throw new HttpError(
      r.status === 429 ? 429 : 503,
      "팀원 등록은 저장했습니다. 초대 메일을 다시 요청해 주세요.",
    );
}

export function validateLink(tokenHash: string, type: string) {
  if (
    !["email", "invite", "magiclink", "signup"].includes(type) ||
    !/^[A-Za-z0-9_-]{16,512}$/.test(tokenHash)
  )
    throw new HttpError(400, "로그인 링크가 올바르지 않습니다.");
}

export async function verifyLink(tokenHash: string, type: string) {
  validateLink(tokenHash, type);
  const r = await supa(
    "/auth/v1/verify",
    { method: "POST", body: JSON.stringify({ token_hash: tokenHash, type }) },
    "anon",
  );
  if (!r.ok)
    throw new HttpError(
      401,
      "로그인 링크가 만료되었습니다. 새 링크를 요청해 주세요.",
    );
  const session = (await r.json()) as Session;
  if (!(await verifiedViewer(session.access_token)))
    throw new HttpError(401, "새 로그인 링크를 요청해 주세요.");
  await setSession(session);
}

export async function logout() {
  const jar = await cookies();
  const access = jar.get(ACCESS)?.value;
  try {
    if (access)
      await supa(
        "/auth/v1/logout?scope=local",
        { method: "POST", headers: { Authorization: "Bearer " + access } },
        "anon",
      );
  } finally {
    jar.delete(ACCESS);
    jar.delete(REFRESH);
  }
}
