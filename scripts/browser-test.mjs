import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { chromium } from "playwright";
import { unzipSync } from "fflate";
import sharp from "sharp";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "clamoa-browser-"));
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = "http://127.0.0.1:" + port;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ],
  {
    env: {
      ...process.env,
      STUDIO_DATA_DIR: temporary,
      OPENAI_API_KEY: "",
      SUPABASE_URL: "",
      SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      STUDIO_SITE_URL: "",
    },
    stdio: "ignore",
  },
);
const stopped = new Promise((resolve) => child.once("exit", resolve));
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    if (child.exitCode !== null)
      throw new Error(
        "테스트 서버 시작 실패. 먼저 npm run build를 실행하세요.",
      );
    ready = await fetch(base + "/api/studio")
      .then((r) => r.ok)
      .catch(() => false);
    if (!ready) await wait(100);
  }
  assert.ok(ready, "테스트 서버 준비");
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  }
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "콘텐츠 생성하기" }).waitFor();
  await page
    .getByRole("button", { name: "Energy Orange", exact: true })
    .click();
  assert.equal(await page.locator(".shot-card").count(), 4);
  await page.getByRole("button", { name: "Celestial Handle 컷 보기" }).click();
  await page.getByText("근거와 제작 기록").click();
  assert.match(await page.getByRole("dialog").innerText(), /구리/);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Celestial Handle 참고해 새 프로젝트" })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByText("기준 컷 08", { exact: true }).waitFor();
  await dialog
    .getByLabel("아이디어", { exact: false })
    .fill("Energy Orange, 가죽과 구리로 새 정물 제작");
  await dialog.getByText("참고 자료 추가", { exact: false }).click();
  await dialog.getByRole("button", { name: "무드 링크", exact: true }).click();
  const mood = dialog.locator(".cw-source-item").last();
  await mood
    .getByLabel("무드 레퍼런스 URL")
    .fill("https://example.org/editorial/copper");
  await mood.getByText("무드 관찰 · 활용 방식").click();
  await mood.getByLabel("레퍼런스 이름").fill("구리 정물 레퍼런스");
  await mood.getByLabel("빛", { exact: true }).fill("길게 떨어지는 측면광");
  await mood.getByLabel("질감", { exact: true }).fill("표면의 가죽 결");
  await dialog
    .getByRole("button", { name: "프로젝트 생성", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Energy Orange, 가죽과 구리로 새 정물 제작",
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "컷 추가", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("컷 번호", { exact: false }).fill("8");
  await dialog.getByLabel("컷 제목").fill("Copper Direction");
  await dialog.getByLabel("주제 · 컬러").fill("Energy Orange");
  await dialog
    .getByLabel("이 컷을 만드는 이유", { exact: false })
    .fill("오렌지를 가죽과 구리의 고유색으로 보여준다.");
  await dialog.getByLabel("주인공 · 피사체").fill("코냑색 가죽 가방");
  await dialog
    .getByLabel("장면과 시각적 아이디어")
    .fill("구리 링과 가방 손잡이의 곡선이 겹친다.");
  await dialog.getByLabel("구리 정물 레퍼런스").check();
  await dialog.getByLabel("로고 위치").fill("가방 앞면 오른쪽 아래");
  await dialog.getByLabel("로고 가공 방식").fill("무색 음각");
  await dialog
    .getByLabel("로고 가공 디테일")
    .fill("획 안쪽까지 가죽 결이 이어진다.");
  await dialog.getByLabel("검수 기준").fill("원본을 확대해 음각을 확인한다.");
  await dialog.getByRole("button", { name: "근거 0" }).click();
  await dialog.getByRole("button", { name: "근거 추가", exact: true }).click();
  await dialog.locator(".cw-claim-kind").selectOption("전망");
  await dialog
    .getByPlaceholder("원문에서 확인할 수 있는 내용을 입력하세요.")
    .fill("WGSN과 Coloro가 Energy Orange를 2027 S/S 주요 색으로 발표했다.");
  await dialog.getByLabel("출처명").fill("WGSN × Coloro");
  await dialog.getByLabel("발행일 또는 시즌").fill("2027 S/S");
  await dialog
    .getByLabel("원문 URL")
    .fill(
      "https://www.wgsn.com/en/wgsn/press/press-releases/wgsn-and-coloro-reveal-colour-year-2027-luminous-blue-and-s-s-27-key",
    );
  await dialog.getByLabel("원문과 대조했습니다").check();
  await dialog.getByRole("button", { name: "컷 추가", exact: true }).click();
  await page.getByRole("button", { name: "08 Copper Direction 검수" }).click();
  dialog = page.getByRole("dialog");
  for (const name of ["첫 이미지 업로드", "파일 등록"]) {
    await dialog.getByRole("button", { name, exact: true }).click();
    const bytes = await sharp({
      create: {
        width: 216,
        height: 270,
        channels: 3,
        background: name === "파일 등록" ? "#963600" : "#E58C54",
      },
    })
      .jpeg()
      .toBuffer();
    await dialog.locator('input[type="file"]').setInputFiles({
      name: name + ".jpg",
      mimeType: "image/jpeg",
      buffer: bytes,
    });
    await dialog
      .getByRole("button", { name: "새 버전 등록", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "검수", exact: true, pressed: true })
      .waitFor();
    await dialog.locator(".cw-preview-fig").first().waitFor();
  }
  const comparison = dialog.getByLabel("나란히 비교", { exact: false });
  const originalId = await comparison
    .locator("option")
    .filter({ hasText: "V01" })
    .getAttribute("value");
  await comparison.selectOption(originalId);
  assert.equal(await dialog.locator(".cw-preview-fig").count(), 2);
  await dialog.getByText("근거와 제작 기록").click();
  assert.match(await dialog.innerText(), /길게 떨어지는 측면광/);
  assert.match(await dialog.innerText(), /가방 앞면 오른쪽 아래 · 무색 음각/);
  await dialog
    .getByRole("button", { name: "이 버전 채택", exact: true })
    .click();
  await page.getByText("이 버전을 채택했습니다.").waitFor();
  const jpg = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "게시용 JPG · 1080 × 1350" })
    .click();
  const shot = await sharp(await (await jpg).path()).metadata();
  assert.deepEqual([shot.width, shot.height], [1080, 1350]);
  await dialog
    .getByLabel("검수할 버전", { exact: false })
    .selectOption(originalId);
  await dialog
    .getByLabel("검수 메모", { exact: false })
    .fill("로고 음각 대비를 보완한다.");
  await dialog.getByRole("button", { name: "보류", exact: true }).click();
  await page.getByText("보류 사유를 저장했습니다.").waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "콘텐츠 풀", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "보류본", exact: true }).click();
  await page.getByRole("textbox", { name: "콘텐츠 검색" }).fill("08번");
  await page.getByRole("button", { name: "Copper Direction 컷 보기" }).click();
  assert.equal(
    await page
      .getByRole("dialog")
      .getByLabel("검수 메모", { exact: false })
      .inputValue(),
    "로고 음각 대비를 보완한다.",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "피드 편집", exact: true }).click();
  await page.locator(".board-cell").first().waitFor();
  assert.equal(await page.locator(".board-cell").count(), 20);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ZIP 다운로드" }).click();
  const files = unzipSync(await fs.readFile(await (await download).path()));
  assert.equal(Object.keys(files).length, 21);
  const first = await sharp(
    files[Object.keys(files).find((s) => s.startsWith("01_"))],
  ).metadata();
  assert.deepEqual([first.width, first.height], [1080, 1350]);
  await page.getByRole("button", { name: "새 배열", exact: true }).click();
  await page
    .getByRole("button", { name: "새 피드 배열", exact: true })
    .waitFor();
  await page.getByRole("textbox", { name: "배열 이름" }).fill("검증용 셀렉션");
  for (const title of [
    "Tide Line",
    "Celestial Handle",
    "Greenroom Visitor",
    "Copper Direction",
  ]) {
    await page
      .locator(".pick-list")
      .getByRole("button", { name: new RegExp(title) })
      .click();
  }
  await page.locator(".board-cell").nth(1).hover();
  await page
    .locator(".board-cell")
    .nth(1)
    .getByRole("button", { name: "앞으로 이동" })
    .click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByText("피드 배열을 저장했습니다.").waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "검증용 셀렉션", exact: true })
    .click();
  assert.equal(await page.locator(".board-cell").count(), 4);
  assert.equal(
    await page.locator(".board-cell img").first().getAttribute("alt"),
    "Celestial Handle",
  );
  await page.locator(".board-cell").first().hover();
  await page
    .locator(".board-cell")
    .first()
    .getByRole("button", { name: "배열에서 빼기" })
    .click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByText("피드 배열을 저장했습니다.").waitFor();
  assert.equal(await page.locator(".board-cell").count(), 3);
  await page
    .getByRole("button", { name: "2027 S/S 시즌 보드", exact: true })
    .click();
  assert.equal(await page.locator(".board-cell").count(), 20);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: /^프로젝트/ })
    .click();
  const projectRow = page.getByRole("button", {
    name: /Energy Orange, 가죽과 구리로 새 정물 제작.*컷/,
  });
  await projectRow.click();
  await page
    .getByRole("button", { name: "Copper Direction 컷 삭제", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "컷 삭제" });
  assert.match(await dialog.innerText(), /피드 배열 1개/);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await page
    .getByRole("button", { name: "08 Copper Direction 검수", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Copper Direction 컷 삭제", exact: true })
    .click();
  await dialog.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByText("컷을 삭제했습니다.", { exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "프로젝트 삭제", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "08 Copper Direction 검수", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "← 프로젝트 목록" }).click();
  const deleteProject = page.getByRole("button", {
    name: /Energy Orange, 가죽과 구리로 새 정물 제작.*프로젝트 삭제/,
  });
  await deleteProject.click();
  dialog = page.getByRole("dialog", { name: "프로젝트 삭제" });
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await projectRow.waitFor();
  await deleteProject.click();
  await dialog.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByText("프로젝트를 삭제했습니다.", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "프로젝트", exact: true }).waitFor();
  assert.equal(await projectRow.count(), 0);
  await page.getByRole("button", { name: "피드 편집", exact: true }).click();
  await page
    .getByRole("button", { name: "검증용 셀렉션", exact: true })
    .click();
  assert.equal(await page.locator(".board-cell").count(), 2);
  assert.equal(
    await page
      .getByRole("button", { name: "Copper Direction 제작 기록", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "스튜디오 홈", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page
    .getByRole("button", { name: "콘텐츠 풀", exact: false })
    .first()
    .click();
  await page.getByRole("heading", { name: /콘텐츠 풀/ }).waitFor();
  assert.equal(await page.evaluate(() => document.body.scrollWidth), 390);
  assert.deepEqual(errors, []);
  console.log(
    "브라우저 검증 통과 · 기준 컷, 근거·무드·08 기획, 업로드·비교·채택·보류, 1080×1350 JPG, 20컷 ZIP, 독립 배열 저장·복원, 컷·프로젝트 삭제, 모바일 탐색",
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await stopped;
  await fs.rm(temporary, { recursive: true, force: true });
}
