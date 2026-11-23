import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  readState,
  transact,
  saveAsset,
  assetMeta,
  readAsset,
  canonicalAction,
} from "../lib/server/store";
import { processNextJob } from "../lib/server/jobs";
import { getViewer } from "../lib/server/auth";
import { checkOrigin } from "../lib/server/http";
import { teamConfig } from "../lib/server/config";
import { GET as getWorker } from "../app/api/worker/route";
import {
  GET as openEmailLink,
  POST as confirmEmailLink,
} from "../app/api/auth/callback/route";

test("email link prefetch renders a form without consuming the single-use token", async (t) => {
  const config = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "publishable-test",
    SUPABASE_SERVICE_ROLE_KEY: "secret-test",
    STUDIO_SITE_URL: "https://studio.example.com",
  };
  for (const [key, val] of Object.entries(config)) process.env[key] = val;
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 401 }),
  );
  try {
    const url = config.STUDIO_SITE_URL + "/api/auth/callback";
    const token = "hash-for-clamoa-test";
    const open = openEmailLink(
      new Request(url + "?type=invite&token_hash=" + token),
    );
    assert.equal(open.status, 200);
    assert.equal(open.headers.get("referrer-policy"), "strict-origin");
    assert.match(await open.text(), /method="post"/);
    assert.equal(fetchMock.mock.callCount(), 0);
    const body = new URLSearchParams({ type: "invite", token_hash: token });
    const rejected = await confirmEmailLink(
      new Request(url, {
        method: "POST",
        body,
        headers: { Origin: "https://elsewhere.example.com" },
      }),
    );
    assert.equal(rejected.status, 403);
    assert.equal(fetchMock.mock.callCount(), 0);
    const expired = await confirmEmailLink(
      new Request(url, {
        method: "POST",
        body,
        headers: { Origin: config.STUDIO_SITE_URL },
      }),
    );
    assert.equal(expired.status, 401);
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    for (const key of Object.keys(config)) delete process.env[key];
  }
});

let dir: string;
const sensitive = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STUDIO_SITE_URL",
  "STUDIO_DATA_DIR",
  "OPENAI_API_KEY",
  "CRON_SECRET",
  "VERCEL",
];
const original = new Map(sensitive.map((key) => [key, process.env[key]]));
before(async () => {
  for (const key of sensitive) delete process.env[key];
  dir = await mkdtemp(join(tmpdir(), "clamoa-store-"));
  process.env.STUDIO_DATA_DIR = dir;
});
after(async () => {
  for (const [key, val] of original) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  await rm(dir, { recursive: true, force: true });
});

test("local writes persist in SQLite and concurrent updates keep each board", async () => {
  assert.equal((await readState()).projects[0].id, "ss27");
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      transact((d) => {
        d.state.boards.push({
          id: "concurrent-" + i,
          name: "동시 작업",
          versionIds: [],
          updatedAt: new Date().toISOString(),
        });
        return { value: null };
      }),
    ),
  );
  const db = new DatabaseSync(join(dir, "studio.sqlite"), { readOnly: true });
  try {
    const row = db.prepare("SELECT document FROM workspace WHERE id=1").get()!;
    assert.equal(
      JSON.parse(String(row.document)).state.boards.filter(
        (b: { id: string }) => b.id.startsWith("concurrent-"),
      ).length,
      12,
    );
  } finally {
    db.close();
  }
});

test("private asset lookup uses persisted metadata and rejects injected paths", async () => {
  const asset = await saveAsset(
    Buffer.from("original image"),
    "캠페인.jpg",
    "image/jpeg",
  );
  assert.deepEqual(await assetMeta(asset.id), asset);
  assert.equal((await readAsset(asset)).toString(), "original image");
  const action = await canonicalAction({
    type: "logo",
    name: "시안",
    official: false,
    asset: {
      ...asset,
      url: "https://example.org/private",
      mime: "image/svg+xml",
    },
  });
  assert.ok(action.type === "logo");
  assert.deepEqual(action.asset, asset);
  await assert.rejects(readAsset({ ...asset, url: "/sample/../private" }));
  await assert.rejects(assetMeta("not-a-uuid"));
  const source = {
    id: "mood-1",
    kind: "mood" as const,
    name: "Blue Bell",
    asset: {
      id: "sample-1",
      url: "/sample/Feed/01_Blue_Bell.jpg",
      name: "wrong name",
      mime: "text/html",
    },
  };
  const gallery = await canonicalAction({
    type: "sources",
    projectId: "ss27",
    sources: [source],
  });
  assert.ok(gallery.type === "sources");
  assert.deepEqual(gallery.sources[0].asset, {
    ...source.asset,
    name: "01_Blue_Bell.jpg",
    mime: "image/jpeg",
  });
  await assert.rejects(
    canonicalAction({
      type: "sources",
      projectId: "ss27",
      sources: [
        {
          ...source,
          asset: { ...source.asset, url: "/sample/Feed/02_Blind_Spot.jpg" },
        },
      ],
    }),
  );
});

test("local workspace denies remote requests and foreign origins", async () => {
  const local = new Request("http://localhost:3000/api/studio", {
    headers: { host: "localhost:3000" },
  });
  assert.equal((await getViewer(local)).role, "admin");
  await assert.rejects(
    getViewer(
      new Request("http://localhost/api/studio", {
        headers: { host: "localhost", "x-forwarded-for": "203.0.113.4" },
      }),
    ),
  );
  await assert.rejects(
    getViewer(
      new Request("http://public.example/api/studio", {
        headers: { host: "public.example" },
      }),
    ),
  );
  assert.throws(() =>
    checkOrigin(
      new Request(local, { headers: { origin: "https://wrong.example" } }),
    ),
  );
  process.env.SUPABASE_URL = "https://example.supabase.co";
  try {
    assert.throws(teamConfig, /설정/);
  } finally {
    delete process.env.SUPABASE_URL;
  }
});

test("orphaned running jobs become retryable; credentialless queued jobs stay queued", async () => {
  await transact((d) => {
    d.state.jobs.push(
      {
        id: "orphan",
        kind: "research",
        projectId: "ss27",
        key: "a",
        status: "running",
        createdAt: "2026-01-01",
      },
      {
        id: "waiting",
        kind: "research",
        projectId: "ss27",
        key: "b",
        status: "queued",
        createdAt: "2026-01-01",
      },
    );
    d.leases.orphan = { token: "lost", expiresAt: Date.now() - 100 };
    return { value: null };
  });
  assert.equal(await processNextJob(), false);
  assert.equal(
    (await readState()).jobs.find((j) => j.id === "orphan")?.status,
    "failed",
  );
  assert.equal(
    (await readState()).jobs.find((j) => j.id === "waiting")?.status,
    "queued",
  );
  process.env.CRON_SECRET = "test-worker-secret";
  assert.equal(
    (await getWorker(new Request("http://localhost/api/worker"))).status,
    401,
  );
  assert.deepEqual(
    await (
      await getWorker(
        new Request("http://localhost/api/worker", {
          headers: { authorization: "Bearer test-worker-secret" },
        }),
      )
    ).json(),
    { processed: false },
  );
});

test("API flow creates a persistent project with a gallery reference and serves private uploads", async () => {
  const { GET, POST } = await import("../app/api/studio/route");
  const { POST: upload } = await import("../app/api/assets/route");
  const { GET: download } = await import("../app/api/assets/[id]/route");
  const base = "http://localhost:3000";
  const privateHeaders = { host: "localhost:3000", origin: base };
  const form = new FormData();
  form.set(
    "file",
    new File([Buffer.from("%PDF-1.4\nfixture")], "자료.pdf", {
      type: "application/pdf",
    }),
  );
  const uploaded = await upload(
    new Request(base + "/api/assets", {
      method: "POST",
      headers: privateHeaders,
      body: form,
    }),
  );
  assert.equal(uploaded.status, 201);
  const { asset } = await uploaded.json();
  const result = await download(
    new Request(base + asset.url, { headers: privateHeaders }),
    { params: Promise.resolve({ id: asset.id }) },
  );
  assert.equal(result.headers.get("content-type"), "application/pdf");
  assert.equal(await result.text(), "%PDF-1.4\nfixture");
  const library = (await readState()).projects[0].shots[0].versions[0].image;
  const response = await POST(
    new Request(base + "/api/studio", {
      method: "POST",
      headers: { ...privateHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "createProject",
        id: "integration",
        name: "팀 테스트",
        keyword: "아카이브",
        season: "SS27",
        count: 1,
        logoId: "guide",
        research: false,
        sources: [
          { id: "gallery", kind: "mood", name: "예시", asset: library },
          { id: "report", kind: "pdf", name: "자료", asset },
        ],
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).state.projects[0].sources[1].asset.id,
    asset.id,
  );
  const resultState = await (
    await GET(new Request(base + "/api/studio", { headers: privateHeaders }))
  ).json();
  assert.equal(resultState.state.projects[0].id, "integration");
  assert.equal(resultState.aiReady, false);

  await transact((d) => {
    const id = "integration-running";
    d.state.jobs.push({
      id,
      key: id,
      kind: "research",
      projectId: "integration",
      status: "running",
      createdAt: new Date().toISOString(),
    });
    d.leases[id] = { token: "in-flight", expiresAt: Date.now() + 60_000 };
    return { value: null };
  });
  const deletion = await POST(
    new Request(base + "/api/studio", {
      method: "POST",
      headers: { ...privateHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "deleteProject", projectId: "integration" }),
    }),
  );
  assert.equal(deletion.status, 200);
  await transact((d) => {
    assert.ok(!d.state.projects.some((p) => p.id === "integration"));
    assert.ok(!d.state.jobs.some((j) => j.projectId === "integration"));
    assert.equal(d.leases["integration-running"], undefined);
    return { value: null, skip: true };
  });
});

test("team adapter sends sign-in mail to allowlisted addresses and invites through the service role", async (t) => {
  const { login, invite } = await import("../lib/server/auth");
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_ANON_KEY = "publishable-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "secret-test";
  process.env.STUDIO_SITE_URL = "https://studio.test";
  const requests: { path: string; key: string | null; method: string }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const key = new Headers(init?.headers).get("apikey");
      const method = init?.method || "GET";
      requests.push({ path: url.pathname, key, method });
      if (url.pathname.endsWith("/clamoa_members") && method === "GET") {
        return Response.json(
          url.searchParams.get("email") === "eq.member@example.org"
            ? [{ email: "member@example.org", role: "member" }]
            : [],
        );
      }
      return new Response(null, { status: 204 });
    },
  );
  try {
    await login("unknown@example.org");
    assert.equal(requests.length, 1);
    await login("member@example.org");
    assert.deepEqual(requests.at(-1), {
      path: "/auth/v1/otp",
      key: "publishable-test",
      method: "POST",
    });
    await invite("new@example.org");
    assert.deepEqual(requests.slice(-2), [
      { path: "/rest/v1/clamoa_members", key: "secret-test", method: "POST" },
      { path: "/auth/v1/invite", key: "secret-test", method: "POST" },
    ]);
  } finally {
    for (const key of [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "STUDIO_SITE_URL",
    ])
      delete process.env[key];
  }
});
