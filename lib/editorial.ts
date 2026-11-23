import type { Plan, VisualObservation } from "./types";

export const observationFields = [
  ["light", "빛"],
  ["color", "색"],
  ["texture", "질감"],
  ["framing", "프레이밍"],
] as const;

export const referenceRoles = {
  base: "기준 컷",
  prefer: "선호 컷",
  avoid: "피할 컷",
} as const;

export function observationText(observation?: VisualObservation) {
  return observationFields
    .flatMap(([key, label]) =>
      observation?.[key]?.trim()
        ? [label + " · " + observation[key].trim()]
        : [],
    )
    .join(" / ");
}

export function logoDirection(
  plan: Pick<Plan, "logoPlacement" | "logoProcess" | "logoDetail">,
) {
  return [plan.logoPlacement, plan.logoProcess, plan.logoDetail]
    .filter(Boolean)
    .join(" · ");
}

export function buildPrompt(plan: Plan) {
  const lines = [
    `클라모아 인스타그램용 세로 4:5 ${plan.genre || "패션"} 에디토리얼 사진.`,
    [plan.subject, plan.scene].filter(Boolean).join(". "),
    [plan.material, plan.theme].filter(Boolean).join(" · "),
    [plan.framing, plan.light].filter(Boolean).join(" · "),
    plan.mood && "참고할 시각 요소 · " + plan.mood,
    plan.reason && "편집 의도 · " + plan.reason,
    "첨부된 소문자 clamoa 워드마크를 소재의 한 면에 한 번만 적용한다. 긴 l, 단층형 a, 여섯 글자의 자형과 간격을 유지한다.",
    logoDirection(plan),
    plan.reviewNote && "확인할 디테일 · " + plan.reviewNote,
    "새로운 배경, 동작, 사물 관계를 설계한다. 테두리, 콜라주, 캡션, 추가 로고나 문자가 없는 한 장의 독립된 사진으로 출력한다.",
  ];
  return lines.filter(Boolean).join("\n");
}
