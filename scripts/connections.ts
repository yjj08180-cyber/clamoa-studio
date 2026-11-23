import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runJob, imageModel, researchModel } from "../lib/server/ai";
import { normalizeEmail } from "../lib/server/auth";
import { supa, teamConfig } from "../lib/server/config";
import { getSeedState } from "../lib/server/seed";
import { readAsset } from "../lib/server/store";
import type { Job, Project } from "../lib/types";

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " 설정이 필요합니다.");
  return value;
}

async function check(label: string, action: () => Promise<void>) {
  try {
    await action();
    console.log("통과 · " + label);
  } catch (error) {
    process.exitCode = 1;
    console.error(
      "확인 필요 · " +
        label +
        " · " +
        (error instanceof Error ? error.message : "연결 실패"),
    );
  }
}

async function json<T>(label: string, response: Response): Promise<T> {
  if (!response.ok) throw new Error(label + " HTTP " + response.status);
  return response.json() as Promise<T>;
}

function management() {
  const projectUrl = new URL(env("SUPABASE_URL"));
  const ref = /^([a-z0-9]+)\.supabase\.co$/.exec(projectUrl.hostname)?.[1];
  if (!ref || projectUrl.protocol !== "https:")
    throw new Error(
      "SUPABASE_URL에 프로젝트의 기본 https://<ref>.supabase.co 주소를 지정해 주세요.",
    );
  const access = env("SUPABASE_ACCESS_TOKEN");
  return async <T>(path: string, method = "GET", body?: object) => {
    const response = await fetch(
      "https://api.supabase.com/v1/projects/" + ref + path,
      {
        method,
        headers: {
          Authorization: "Bearer " + access,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    return json<T>(method + " " + path, response);
  };
}

type AuthConfig = {
  site_url?: string;
  uri_allow_list?: string;
  smtp_host?: string;
  external_email_enabled?: boolean;
  mailer_templates_confirmation_content?: string;
  mailer_templates_magic_link_content?: string;
  mailer_templates_invite_content?: string;
};

function mailContent(title: string, type: "email" | "invite") {
  return (
    "<h2>" +
    title +
    "</h2><p>아래 링크에서 이메일을 확인하세요.</p>" +
    '<p><a href="{{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&amp;type=' +
    type +
    '">클라모아 스튜디오 열기</a></p>'
  );
}

async function setupTeam() {
  const config = teamConfig();
  if (!config) throw new Error("팀 서버 환경 변수를 먼저 설정해 주세요.");
  if (!config.site.startsWith("https://"))
    throw new Error("팀 서버의 HTTPS 주소가 필요합니다.");
  const admin = normalizeEmail(env("STUDIO_ADMIN_EMAIL"));
  const request = management();
  const current = await request<AuthConfig>("/config/auth");
  const smtpNames = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM_EMAIL",
  ] as const;
  const changingSmtp = smtpNames.some((name) => process.env[name]?.trim());
  const smtp = changingSmtp
    ? {
        smtp_host: env("SMTP_HOST"),
        smtp_port: env("SMTP_PORT"),
        smtp_user: env("SMTP_USER"),
        smtp_pass: env("SMTP_PASSWORD"),
        smtp_admin_email: normalizeEmail(env("SMTP_FROM_EMAIL")),
        smtp_sender_name: process.env.SMTP_FROM_NAME?.trim() || "CLAMOA Studio",
      }
    : {};
  if (
    changingSmtp &&
    (!/^\d+$/.test(smtp.smtp_port!) ||
      Number(smtp.smtp_port) < 1 ||
      Number(smtp.smtp_port) > 65535)
  )
    throw new Error("SMTP_PORT를 확인해 주세요.");
  if (!changingSmtp && !current.smtp_host)
    throw new Error(
      "일반 팀원에게 메일을 보내려면 사용자 지정 SMTP 설정이 필요합니다.",
    );
  const migration = await readFile(
    resolve("supabase/migrations/001_clamoa_studio.sql"),
    "utf8",
  );
  await request("/database/query", "POST", { query: migration });
  const response = await supa("/rest/v1/clamoa_members?on_conflict=email", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ email: admin, role: "admin" }),
  });
  if (!response.ok) throw new Error("관리자 등록 HTTP " + response.status);
  const allow = (current.uri_allow_list || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  await request("/config/auth", "PATCH", {
    ...smtp,
    site_url: config.site,
    uri_allow_list: [
      ...new Set([...allow, config.site + "/api/auth/callback"]),
    ].join(","),
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mailer_subjects_confirmation: "클라모아 스튜디오 이메일 확인",
    mailer_templates_confirmation_content: mailContent(
      "클라모아 스튜디오 이메일 확인",
      "email",
    ),
    mailer_subjects_magic_link: "클라모아 스튜디오 로그인",
    mailer_templates_magic_link_content: mailContent(
      "클라모아 스튜디오 로그인",
      "email",
    ),
    mailer_subjects_invite: "클라모아 스튜디오에 초대합니다",
    mailer_templates_invite_content: mailContent(
      "클라모아 스튜디오에 초대합니다",
      "invite",
    ),
  });
}

async function checkModels() {
  const key = env("OPENAI_API_KEY");
  for (const model of new Set([researchModel(), imageModel()])) {
    const response = await fetch(
      "https://api.openai.com/v1/models/" + encodeURIComponent(model),
      {
        headers: { Authorization: "Bearer " + key },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) throw new Error(model + " HTTP " + response.status);
    await response.body?.cancel();
  }
}

async function checkTeam() {
  const config = teamConfig();
  if (!config)
    throw new Error(
      "SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STUDIO_SITE_URL 설정이 필요합니다.",
    );
  await Promise.all([
    (async () => {
      const auth = await json<{ external?: { email?: boolean } }>(
        "Auth",
        await supa("/auth/v1/settings", {}, "anon"),
      );
      if (!auth.external?.email)
        throw new Error("Supabase 이메일 로그인을 활성화해 주세요.");
    })(),
    ...["clamoa_workspace", "clamoa_members", "clamoa_assets"].map(
      async (table) => {
        await json(
          table,
          await supa("/rest/v1/" + table + "?select=*&limit=0"),
        );
      },
    ),
    (async () => {
      const bucket = await json<{ public: boolean }>(
        "Storage",
        await supa("/storage/v1/bucket/clamoa-private"),
      );
      if (bucket.public !== false)
        throw new Error("clamoa-private 버킷을 비공개로 설정해 주세요.");
    })(),
  ]);
}

async function checkMailer() {
  const config = teamConfig();
  if (!config) throw new Error("Supabase 팀 설정이 필요합니다.");
  const auth = await management()<AuthConfig>("/config/auth");
  if (!auth.smtp_host) throw new Error("사용자 지정 SMTP를 설정해 주세요.");
  if (auth.site_url?.replace(/\/$/, "") !== config.site)
    throw new Error("Supabase Site URL이 스튜디오 주소와 다릅니다.");
  if (
    !auth.uri_allow_list
      ?.split(",")
      .map((url) => url.trim())
      .includes(config.site + "/api/auth/callback")
  )
    throw new Error(
      "Supabase Redirect URLs에 스튜디오 콜백 주소를 추가해 주세요.",
    );
  for (const template of [
    auth.mailer_templates_confirmation_content,
    auth.mailer_templates_magic_link_content,
    auth.mailer_templates_invite_content,
  ]) {
    if (
      !template?.includes("/api/auth/callback") ||
      !template.includes(".TokenHash")
    ) {
      throw new Error("이메일 확인·로그인·초대 템플릿을 연결해 주세요.");
    }
  }
}

async function smokeOpenAI() {
  const state = getSeedState();
  const seed = state.projects[0];
  const p: Project = {
    ...seed,
    id: randomUUID(),
    name: "OpenAI 연결 검증",
    keyword: "WGSN × Coloro Energy Orange",
    count: 1,
    sample: false,
    shots: [],
  };
  const research: Job = {
    id: randomUUID(),
    key: randomUUID(),
    kind: "research",
    projectId: p.id,
    status: "running",
    createdAt: new Date().toISOString(),
  };
  state.projects.push(p);
  const out = resolve(".clamoa/check");
  const io = {
    read: readAsset,
    async save(bytes: Buffer, name: string, mime: string) {
      await mkdir(out, { recursive: true, mode: 0o700 });
      const file = resolve(out, name);
      await writeFile(file, bytes, { mode: 0o600, flag: "wx" });
      return { id: name, name, mime, url: file };
    },
  };
  const result = await runJob(state, research, io);
  if (
    result.kind !== "research" ||
    !result.plans[0]?.claims.some((c) => c.verified && c.url)
  )
    throw new Error("실제 웹 인용이 붙은 근거를 확보하지 못했습니다.");
  console.log(
    "통과 · 실제 리서치 · " +
      result.plans[0].claims.filter((c) => c.verified && c.url).length +
      "건",
  );
  const job: Job = {
    ...research,
    id: randomUUID(),
    kind: "generate",
    input: {
      plan: result.plans[0],
      logoId: p.logoId,
      workflowId: p.workflowId,
      sourceIds: p.sources.map((s) => s.id),
    },
  };
  const generated = await runJob(state, job, io);
  if (generated.kind !== "generate")
    throw new Error("이미지 생성 결과가 없습니다.");
  console.log("검증 이미지 · " + generated.image.url);
}

const mode = process.argv[2];
async function main() {
  if (mode === "--apply-team") {
    await check("Supabase DB·관리자·이메일 설정", setupTeam);
    if (process.exitCode) return;
  } else if (mode === "--smoke-openai") {
    await check("OpenAI 모델 접근", checkModels);
    if (!process.exitCode)
      await check("실제 리서치·이미지 1컷 생성", smokeOpenAI);
    return;
  } else if (mode) {
    throw new Error("지원 옵션은 --apply-team 및 --smoke-openai입니다.");
  }
  await Promise.all([
    check("OpenAI 모델 접근", checkModels),
    check("Supabase Auth·DB·비공개 Storage", checkTeam),
    check("Supabase SMTP·이메일 템플릿", checkMailer),
  ]);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "연결 작업 실패");
  process.exitCode = 1;
});
