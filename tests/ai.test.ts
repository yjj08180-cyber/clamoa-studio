import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { runJob } from "../lib/server/ai";
import { groundFindings, webPassages } from "../lib/server/evidence";
import type { Finding, ResponseResult } from "../lib/server/evidence";
import type { Asset, Job, Plan, Project, StudioState } from "../lib/types";

// Node's test runner isolates files in child processes. All HTTP is mocked below.
process.env.OPENAI_API_KEY = "fixture-key";

const ukSource = "https://example.org/fixture/report";
const excerpt = "2026년 7월 영국에서 이 소재의 검색량이 12% 증가했다.";
const finding: Finding = {
  kind: "실측",
  fact: excerpt,
  evidenceId: "web-1",
  excerpt,
  period: "2026년 7월",
  region: "영국",
  unit: "%",
  date: "",
};

function searchResult(): ResponseResult {
  const text =
    "근거 없는 주장입니다.\n" + excerpt + " [보고서](" + ukSource + ")";
  return {
    status: "completed",
    output: [
      { type: "web_search_call", status: "completed" },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text,
            annotations: [
              {
                type: "url_citation",
                start_index: text.indexOf("[보고서]"),
                end_index: text.length,
                url: ukSource,
                title: "검증용 보고서",
              },
            ],
          },
        ],
      },
    ],
  };
}

test("웹 인용은 주장이 적힌 줄에만 연결되고 임의 URL이나 누락된 실측 정보는 근거가 될 수 없다", () => {
  const passages = webPassages(searchResult(), [
    { id: "input-url", kind: "url", url: ukSource, name: "입력한 링크" },
  ]);
  assert.deepEqual(passages, [
    {
      id: "web-1",
      title: "검증용 보고서",
      sourceId: "input-url",
      url: ukSource,
      text: excerpt,
    },
  ]);
  const [claim] = groundFindings([finding], passages);
  assert.equal(claim.url, ukSource);
  assert.equal(claim.region, "영국");
  const opposite = groundFindings(
    [{ ...finding, fact: excerpt.replace("증가했다", "감소했다") }],
    passages,
  );
  assert.equal(opposite[0].fact, excerpt);
  const memo = [
    {
      id: "memo-1",
      title: "팀 메모",
      sourceId: "memo",
      text: excerpt,
      memo: true,
    },
  ];
  assert.deepEqual(
    groundFindings([{ ...finding, evidenceId: "memo-1" }], memo),
    [],
  );
  assert.deepEqual(
    groundFindings(
      [
        {
          ...finding,
          fact: "검색량이 증가했다.",
          kind: "자료 관찰",
          evidenceId: "memo-1",
        },
      ],
      memo,
    ),
    [],
  );
  for (const change of [
    { region: "" },
    { region: "프랑스" },
    { period: "미상" },
    { unit: "USD" },
    { excerpt: "원문에 없는 문장" },
    { evidenceId: "web-invented" },
    { fact: "영국 검색량이 25% 증가했다." },
  ])
    assert.equal(
      groundFindings([{ ...finding, ...change }], passages).length,
      0,
    );
  assert.deepEqual(
    webPassages({ output: searchResult().output?.slice(1) }, []),
    [],
  );
});

const logoAsset: Asset = {
  id: "logo-image",
  name: "logo.png",
  mime: "image/png",
  url: "/logo.png",
};
const project: Project = {
  id: "p",
  name: "테스트",
  keyword: "소재",
  season: "2027 S/S",
  count: 1,
  sources: [],
  workflowId: "w",
  logoId: "logo",
  shots: [],
  createdAt: "",
  createdBy: "",
};
const state: StudioState = {
  projects: [project],
  logos: [{ id: "logo", name: "시안", asset: logoAsset, official: false }],
  workflows: [
    {
      id: "w",
      name: "운영 문서",
      text: "소재에 따라 각인 위치를 기록한다.",
      createdAt: "",
    },
  ],
  boards: [],
  jobs: [],
};
const job: Job = {
  id: "j",
  key: "k",
  kind: "research",
  projectId: "p",
  status: "running",
  createdAt: "",
};
const io = {
  read: async () => {
    throw Error("unexpected asset read");
  },
  save: async () => {
    throw Error("unexpected asset save");
  },
};

test("네이티브 출처가 없으면 브리프와 이미지를 만들어내지 않고 자료 보완을 요청한다", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      status: "completed",
      output: [
        { type: "web_search_call", status: "completed" },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "근거가 있다고 주장 [링크](https://example.org)",
              annotations: [],
            },
          ],
        },
      ],
    }),
  );
  const result = await runJob(state, job, io);
  if (result.kind !== "research") throw Error("missing research");
  assert.equal(result.plans[0].claims[0].verified, false);
  assert.match(result.plans[0].claims[0].fact, /근거가 부족합니다/);
  assert.equal(result.plans[0].prompt, "");
  assert.equal(result.pinterestReferences, 0);
});

test("페이지와 인용 문구 모두 같은 PDF 자료여야 한다", () => {
  const passages = [
    {
      id: "pdf-A-2",
      title: "측정 보고서.pdf",
      sourceId: "pdf-A",
      page: 2,
      text: excerpt,
    },
  ];
  const [claim] = groundFindings(
    [{ ...finding, evidenceId: "pdf-A-2" }],
    passages,
  );
  assert.equal(claim.page, 2);
  assert.equal(claim.sourceId, "pdf-A");
  assert.equal(claim.excerpt, excerpt);
  assert.equal(
    groundFindings([{ ...finding, evidenceId: "pdf-A-3" }], passages).length,
    0,
  );
});

test("컷 편집 API가 작업 스냅샷과 동일한 프롬프트, 지정 로고를 전송하고 생성 원본 바이트를 보존한다", async (t) => {
  const png = await sharp({
    create: { width: 1152, height: 1440, channels: 3, background: "#357" },
  })
    .png()
    .toBuffer();
  const logo = await sharp({
    create: { width: 120, height: 32, channels: 3, background: "#123" },
  })
    .png()
    .toBuffer();
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init: RequestInit) => {
      assert.equal(input, "https://api.openai.com/v1/images/edits");
      const body = init.body as FormData;
      assert.equal(body.get("prompt"), "승인한 컷 프롬프트");
      assert.equal(body.get("size"), "1152x1440");
      const reference = body.get("image") as File;
      assert.equal(reference.type, "image/png");
      assert.equal(
        (await sharp(Buffer.from(await reference.arrayBuffer())).metadata())
          .width,
        120,
      );
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    },
  );
  const claims = groundFindings([finding], webPassages(searchResult(), []));
  const plan = { prompt: "승인한 컷 프롬프트", claims } as Plan;
  const result = await runJob(
    state,
    {
      ...job,
      kind: "generate",
      input: { plan, logoId: "logo", sourceIds: [], workflowId: "w" },
    },
    {
      read: async (a) => {
        assert.equal(a.id, "logo-image");
        return logo;
      },
      save: async (bytes, name, mime) => {
        assert.deepEqual(bytes, png);
        return { id: "generated", url: "/generated", name, mime };
      },
    },
  );
  assert.equal(result.kind, "generate");
});

function smallPdf(text: string) {
  const stream = "BT /F1 12 Tf 40 750 Td (" + text + ") Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let file = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(file.length);
    file += i + 1 + " 0 obj\n" + object + "\nendobj\n";
  });
  const start = file.length;
  file +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((o) => o.toString().padStart(10, "0") + " 00000 n \n")
      .join("");
  file += "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + start + "\n%%EOF";
  return Buffer.from(file);
}

test("실제 PDF의 페이지 근거와 첨부 무드, 고정된 워크플로우가 컷별 기획까지 이어진다", async (t) => {
  const pdfText =
    "The collection uses pleated fabric and a polished copper ring.";
  const moodPhoto = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "#8f5431" },
  })
    .png()
    .toBuffer();
  const example = {
    ...project,
    sources: [
      {
        kind: "pdf" as const,
        id: "report",
        name: "시즌 현장 노트",
        asset: { ...logoAsset, id: "uploaded-pdf", mime: "application/pdf" },
      },
      {
        kind: "mood" as const,
        id: "reference",
        name: "브라운 무드",
        asset: { ...logoAsset, id: "uploaded-photo" },
      },
    ],
  };
  const pinURL = "https://www.pinterest.com/pin/123456789/";
  const photoURL = "https://i.pinimg.com/736x/12/34/fixture.jpg";
  const pinFile = await sharp(moodPhoto).resize(240, 300).jpeg().toBuffer();
  const png = await sharp({
    create: { width: 1152, height: 1440, channels: 3, background: "#742" },
  })
    .png()
    .toBuffer();
  const uploaded = new Map<string, Buffer>();
  let calls = 0;
  const output = (v: unknown) =>
    Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(v) }],
        },
      ],
    });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    if (url === photoURL) {
      assert.equal(init.redirect, "error");
      return new Response(new Uint8Array(pinFile), {
        headers: { "Content-Type": "image/jpeg" },
      });
    }
    if (url === "https://api.openai.com/v1/images/edits") {
      const body = init.body as FormData;
      const files = body.getAll("image[]") as File[];
      assert.deepEqual(
        files.map((file) => file.name),
        ["clamoa-wordmark.png", "pin-123456789.jpg"],
      );
      assert.deepEqual(
        Buffer.from(await files[1].arrayBuffer()),
        uploaded.get("pin-123456789.jpg"),
      );
      assert.match(
        String(body.get("prompt")),
        /이후 이미지는 Pinterest 무드 참고/,
      );
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    }
    const body = JSON.parse(String(init.body));
    if (body.include?.includes("web_search_call.results"))
      return Response.json({
        status: "completed",
        output: [
          {
            type: "web_search_call",
            status: "completed",
            results: [
              {
                type: "image_result",
                source_website_url: pinURL,
                image_url: photoURL,
                caption: "구리빛 정물",
              },
              {
                type: "image_result",
                source_website_url: "https://www.pinterest.com/pin/999999999/",
                image_url: "https://example.com/blocked.jpg",
              },
            ],
          },
        ],
      });
    if (body.tools) return Response.json(searchResult());
    const parts = body.input[0].content;
    const data = JSON.parse(parts[0].text);
    if (body.text.format.name === "clamoa_evidence") {
      const page = data.passages.find((p: { page?: number }) => p.page === 1);
      assert.ok(page.text.includes(pdfText));
      assert.ok(
        parts.some((part: { image_url?: string }) =>
          part.image_url?.startsWith("data:image/jpeg;base64,"),
        ),
      );
      return output({
        findings: [
          {
            kind: "자료 관찰",
            evidenceId: page.id,
            fact: "컬렉션에서 플리츠와 광택을 낸 구리 링을 사용했다.",
            excerpt: pdfText,
            date: "",
            period: "",
            region: "",
            unit: "",
          },
        ],
        moods: [
          {
            id: "reference",
            light: "부드러운 측광",
            color: "갈색",
            texture: "매끄러움",
            framing: "근접",
          },
          {
            id: "pin-123456789",
            light: "강한 그림자",
            color: "갈색",
            texture: "구리 결",
            framing: "매크로",
          },
        ],
      });
    }
    assert.equal(data.workflow, state.workflows[0].text);
    return output({
      shots: [
        {
          title: "Copper Fold",
          theme: "구리",
          reason: "현장 노트의 소재 조합을 정물로 풀었다.",
          subject: "링",
          scene: "링이 주름을 가른다.",
          material: "오렌지색 구리",
          light: "측면광",
          framing: "매크로",
          genre: "정물",
          logoProcess: "링 옆면 각인",
          logoPlacement: "링 옆면 가운데",
          logoDetail: "각인 홈에만 그림자",
          reviewNote: "확대해 각인 홈을 확인",
          visualReferenceIds: ["pin-123456789"],
          claimIds: [data.claims[0].id],
          moodIds: [data.moods[0].id],
        },
      ],
    });
  });
  const assetIO = {
    read: async (asset: Asset) =>
      asset.id === "uploaded-pdf"
        ? smallPdf(pdfText)
        : (uploaded.get(asset.id) ?? moodPhoto),
    save: async (bytes: Buffer, name: string, mime: string) => {
      uploaded.set(name, bytes);
      return { id: name, name, mime, url: "/api/assets/" + name };
    },
  };
  const exampleState = { ...state, projects: [example] };
  const result = await runJob(exampleState, job, assetIO);
  assert.equal(result.kind, "research");
  if (result.kind !== "research") throw Error("missing plans");
  assert.equal(calls, 5);
  const [plan] = result.plans;
  assert.equal(plan.claims[0].page, 1);
  assert.equal(plan.claims[0].excerpt, pdfText);
  assert.equal(plan.claims[0].sourceId, "report");
  assert.match(plan.mood, /브라운 무드/);
  assert.match(plan.prompt, /링 옆면 각인/);
  assert.equal(result.pinterestReferences, 1);
  assert.equal(plan.visualReferences?.[0].url, pinURL);
  assert.match(plan.visualReferences?.[0].observation ?? "", /강한 그림자/);
  const generated = await runJob(
    exampleState,
    {
      ...job,
      kind: "generate",
      input: { plan, logoId: "logo", sourceIds: ["report"], workflowId: "w" },
    },
    assetIO,
  );
  assert.equal(generated.kind, "generate");
  assert.deepEqual(generated.imageReferenceIds, ["pin-123456789.jpg"]);
  assert.match(
    generated.executionPrompt ?? "",
    /이후 이미지는 Pinterest 무드 참고/,
  );
});

test("인용 뒤의 별도 주장을 배제하고 링크로 감싼 사실과 원래 문장의 부정어를 유지한다", () => {
  function evidence(text: string, anchor: string, url = ukSource) {
    const start = [...text.slice(0, text.indexOf(anchor))].length;
    return webPassages(
      {
        output: [
          { type: "web_search_call", status: "completed" },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text,
                annotations: [
                  {
                    type: "url_citation",
                    start_index: start,
                    end_index: start + [...anchor].length,
                    url,
                    title: "시즌 보고서",
                  },
                ],
              },
            ],
          },
        ],
      },
      [],
    );
  }
  const native = "\uE200cite\uE202turn1search1\uE201";
  const first = "2027 시즌 컬렉션은 황동을 사용했다.";
  const link = "[" + first + "](" + ukSource + ")";
  const extra = " 이 문장의 판매량 주장은 근거가 없다.";
  assert.equal(
    evidence("🧵 자료\n" + first + " " + native + extra, native)[0].text,
    first,
  );
  assert.equal(evidence(link + extra, link)[0].text, first);
  assert.equal(evidence(first + extra, first)[0].text, first);
  assert.equal(evidence(link, link, "https://example.org/unrelated").length, 0);
  const snippet = "growth in textile demand";
  const full = "The report found no evidence of growth in textile demand.";
  const cited = evidence(
    full + " Sales projections were unavailable.",
    snippet,
  );
  assert.equal(cited[0].text, full);
  const pdf = [
    { id: "pdf-1", text: full, title: "Report", sourceId: "s", page: 1 },
  ];
  const [claim] = groundFindings(
    [
      {
        ...finding,
        kind: "자료 관찰",
        evidenceId: "pdf-1",
        excerpt: snippet,
        fact: snippet,
      },
    ],
    pdf,
  );
  assert.equal(claim.fact, full);
});
