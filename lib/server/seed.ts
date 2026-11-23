import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Asset, Plan, Project, StudioState } from "../types";

const themes = [
  "Luminous Blue",
  "Energy Orange",
  "Pop Pink",
  "Meadowland Green",
  "Clay",
];
const subjects = [
  "플리츠 스커트",
  "블루 바이저",
  "페이턴트 펌프",
  "거울과 종이 손",
  "비대칭 스커트",
  "럭비 셔츠",
  "립스틱과 반사판",
  "코냑색 가죽 가방",
  "오간자와 모델",
  "스프링 위의 장갑",
  "플리츠와 금속 빗",
  "체크 니트 포트레이트",
  "럭비 룩",
  "그물 레이스",
  "향수병과 꿀벌",
  "체크 메리제인",
  "랩스커트",
  "장식 데님 소맷단",
  "금빛 셔츠 칼라",
  "가죽 숄더백",
];
const materials = [
  "플리츠",
  "컬러 필름",
  "페이턴트·세라믹",
  "종이·거울",
  "플리츠",
  "니트",
  "금속·반사 필름",
  "가죽·구리",
  "오간자",
  "가죽·금속",
  "금속·주름 원단",
  "니트",
  "피케·플리츠",
  "레이스",
  "유리",
  "니트",
  "코튼",
  "데님",
  "새틴",
  "가죽",
];
const genres = [
  "패션",
  "패션",
  "오브제",
  "아트",
  "패션",
  "패션",
  "뷰티",
  "오브제",
  "패션",
  "아트",
  "오브제",
  "패션",
  "패션",
  "아트",
  "뷰티",
  "패션",
  "패션",
  "패션",
  "패션",
  "오브제",
];
const sourceUrl =
  "https://www.wgsn.com/en/wgsn/press/press-releases/wgsn-and-coloro-reveal-colour-year-2027-luminous-blue-and-s-s-27-key";
const createdAt = "2026-11-23T07:00:00.000Z";
export function getSeedState(): StudioState {
  const files = readdirSync(path.join(process.cwd(), "content/sample/Feed"))
    .filter((x) => x.endsWith(".jpg"))
    .sort();
  const text = readFileSync(
    path.join(process.cwd(), "content/workflow.md"),
    "utf8",
  );
  const project: Project = {
    id: "ss27",
    name: "2027 S/S 컬러 에디토리얼",
    keyword: "2027 S/S 키 컬러",
    season: "2027 S/S",
    count: 20,
    sources: [
      {
        id: "wgsn-ss27",
        kind: "url",
        name: "WGSN × Coloro · S/S 27 키 컬러 발표",
        url: sourceUrl,
      },
    ],
    workflowId: "workflow-1",
    logoId: "guide",
    createdAt,
    createdBy: "클라모아",
    sample: true,
    shots: [],
  };
  project.shots = files.map((file, i) => {
    const num = i + 1,
      theme = themes[Math.floor(i / 4)],
      title = file.slice(3, -4).replaceAll("_", " ");
    const plan: Plan = {
      title,
      theme,
      subject: subjects[i],
      genre: genres[i],
      material: materials[i],
      scene:
        i === 7
          ? "구리 링과 가방 손잡이의 곡선이 겹친다."
          : i === 2
            ? "검은 펌프를 푸른 세라믹 파도 위에 수평으로 얹는다."
            : i === 14
              ? "향수 분사구의 벌이 타일 벽에 비행기 그림자를 드리운다."
              : subjects[i] + "의 실루엣과 표면을 한 장면에 담는다.",
      reason:
        i === 7
          ? "에너지 오렌지를 가죽과 구리의 고유색으로 보여준다."
          : theme + "를 " + materials[i] + "의 색과 표면으로 해석한다.",
      light:
        i === 7
          ? "옆에서 들어온 빛이 가죽 결을 스치고 둥근 그림자를 만든다."
          : "주요 피사체의 표면과 그림자가 읽히는 방향광",
      framing:
        i === 7
          ? "가방 앞면이 보이는 세로 정물 근접 촬영"
          : "세로 4:5 · 피사체 중심",
      logoProcess:
        i === 7
          ? "가방 앞면 오른쪽 아래에 무색 음각. 눌린 가장자리만 어두워지고 가죽 결이 획 안쪽까지 이어진다."
          : i === 2
            ? "구두 뒤축 옆면에 작은 흰색 인쇄"
            : i === 14
              ? "향수병 곡면에 동색 로고"
              : "소재 표면에 통합된 소문자 clamoa",
      mood: "SS27 제작 보드 · 색과 소재의 대비",
      prompt: "",
      claims: [
        {
          id: "ss27-colour-" + num,
          kind: "전망",
          fact:
            "WGSN과 Coloro는 " +
            theme +
            "를 2027 S/S의 다섯 가지 키 컬러 중 하나로 선정했다.",
          sourceTitle: "WGSN × Coloro · S/S 27 Key Colours",
          sourceId: "wgsn-ss27",
          url: sourceUrl,
          date: "2025-04-29",
          verified: true,
        },
      ],
    };
    plan.prompt = [
      plan.subject,
      plan.scene,
      plan.material,
      plan.theme,
      plan.light,
      plan.framing,
      plan.logoProcess,
      "하나의 독립된 4:5 에디토리얼 사진.",
    ].join(" · ");
    const image: Asset = {
      id: "sample-" + num,
      name: file,
      mime: "image/jpeg",
      url: "/sample/Feed/" + file,
    };
    return {
      id: "ss27-shot-" + num,
      number: num,
      plan,
      adoptedId: "ss27-v-" + num,
      versions: [
        {
          id: "ss27-v-" + num,
          image,
          createdAt,
          status: "adopted",
          note: "기존 SS27 제작물. 편집용 기획은 제작 기록에 따라 정리했습니다.",
          model: "기존 제작물",
          plan: structuredClone(plan),
          prompt: "기존 제작물 · 실행 당시 프롬프트 미기록",
          logoId: "guide",
          sourceIds: ["wgsn-ss27"],
          workflowId: "workflow-1",
        },
      ],
    };
  });
  return {
    projects: [project],
    jobs: [],
    workflows: [
      {
        id: "workflow-1",
        name: "클라모아 인스타그램 콘텐츠 제작 워크플로우",
        text,
        createdAt,
      },
    ],
    logos: [
      {
        id: "guide",
        name: "clamoa 워드마크 가이드",
        official: false,
        asset: {
          id: "guide",
          name: "wordmark-guide.png",
          url: "/sample/wordmark-guide.png",
          mime: "image/png",
        },
      },
    ],
    boards: [
      {
        id: "ss27-board",
        name: "2027 S/S 시즌 보드",
        versionIds: project.shots.map((s) => s.adoptedId!),
        updatedAt: createdAt,
      },
    ],
  };
}
