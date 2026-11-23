import { createHash } from "node:crypto";
import type { Claim, Source } from "../types";

export type Passage = {
  id: string;
  text: string;
  title: string;
  url?: string;
  sourceId?: string;
  page?: number;
  memo?: boolean;
};

type Citation = {
  type: string;
  start_index: number;
  end_index: number;
  url: string;
  title: string;
};
export type ResponseResult = {
  status?: string;
  output?: Array<{
    type: string;
    status?: string;
    results?: Array<{
      type: string;
      image_url?: string;
      thumbnail_url?: string;
      source_website_url?: string;
      caption?: string;
    }>;
    content?: Array<{ type: string; text?: string; annotations?: Citation[] }>;
  }>;
};

export type Finding = {
  kind: Claim["kind"];
  fact: string;
  evidenceId: string;
  excerpt: string;
  date: string;
  period: string;
  region: string;
  unit: string;
};

export const insufficientEvidence =
  "이 키워드와 시즌에 연결할 수 있는 근거가 부족합니다. 발행일이 있는 공식 자료 URL이나 텍스트가 포함된 PDF를 추가하고 리서치를 다시 실행하세요.";

function publicUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    url.hash = "";
    return url.href;
  } catch {
    return;
  }
}

function sourceIdentity(raw: string) {
  const href = publicUrl(raw);
  if (!href) return;
  const url = new URL(href);
  // Provider links may carry campaign parameters absent from the supplied URL.
  for (const name of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();
  return url.href;
}

function normalize(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

const sentences = new Intl.Segmenter("ko", { granularity: "sentence" });

function cleanCitationText(text: string) {
  return text
    .replace(/\uE200[^\uE201]*\uE201/g, "")
    .replace(/\[([^\]]*)\]\(https?:\/\/[^\s)]+\)/g, "$1")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .trim();
}

function citedSentence(
  points: string[],
  first: number,
  last: number,
  citation: Citation,
) {
  const span = points.slice(first, last).join("").trim();
  const prefix = points.slice(0, first).join("").trim();
  // Depending on the response, an annotation covers the claim itself or its
  // inline citation. Text after the cited range must never inherit the URL.
  const content =
    span.startsWith("([") && span.endsWith("))") ? span.slice(1, -1) : span;
  const link = content.match(/^\[([^\]]+)\]\((https?:\/\/\S+)\)$/);
  if (link && sourceIdentity(link[2]) !== sourceIdentity(citation.url))
    return "";
  const marker =
    link ||
    /^\(?\s*(?:\uE200[^\uE201]*\uE201|【[^】]+】|\[\d+\]|https?:\/\/\S+)\s*\)?$/.test(
      span,
    );
  if (!marker) {
    // A short anchor can be inside a qualified or negated sentence. Preserve
    // its complete sentence, but never append other sentences on that line.
    const begin = points.slice(0, first).join("").length;
    const finish = points.slice(0, last).join("").length;
    return cleanCitationText(sentenceRange(points.join(""), begin, finish));
  }
  const preceding = cleanCitationText(prefix.replace(/\(\s*$/, ""));
  if (preceding)
    return [...sentences.segment(preceding)].at(-1)?.segment.trim() || "";
  // A Markdown link may wrap the claim instead of a source name.
  const label = link?.[1].trim();
  return label && label !== citation.title ? label : "";
}

/** Match native URL annotations to their own claim. Search-result lists and
 * links typed by the model do not establish a relationship to a sentence. */
export function webPassages(
  response: ResponseResult,
  sources: Source[],
): Passage[] {
  const output = response.output ?? [];
  if (
    !output.some(
      (item) => item.type === "web_search_call" && item.status === "completed",
    )
  )
    return [];
  const passages: Passage[] = [];
  for (const item of output) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text" || !part.text) continue;
      let offset = 0;
      for (const line of part.text.split("\n")) {
        const points = [...line];
        const start = offset;
        const end = start + points.length;
        offset = end + 1;
        const matches = (part.annotations ?? []).filter(
          (a) =>
            a.type === "url_citation" &&
            a.title?.trim() &&
            Number.isInteger(a.start_index) &&
            Number.isInteger(a.end_index) &&
            a.start_index >= start &&
            a.end_index <= end &&
            a.end_index > a.start_index &&
            publicUrl(a.url),
        );
        // Each requested observation has one cited source per line. Skip
        // compound attributions when the provider does not separate them.
        if (matches.length !== 1) continue;
        const [citation] = matches;
        const url = publicUrl(citation.url)!;
        const text = citedSentence(
          points,
          citation.start_index - start,
          citation.end_index - start,
          citation,
        );
        if (text.length < 8) continue;
        const sourceId = sources.find(
          (source) =>
            source.kind === "url" &&
            source.url &&
            sourceIdentity(source.url) === sourceIdentity(url),
        )?.id;
        passages.push({
          id: "web-" + (passages.length + 1),
          text,
          title: citation.title.trim(),
          url,
          sourceId,
        });
      }
    }
  }
  return passages;
}

/** Reattach qualifiers or negation if the suggested quote cuts through a sentence. */
function sentenceRange(text: string, start: number, end: number) {
  return [...sentences.segment(text)]
    .filter((s) => s.index < end && s.index + s.segment.length > start)
    .map((s) => s.segment)
    .join("")
    .trim();
}

function fullExcerpt(text: string, quote: string) {
  const passage = normalize(text);
  const first = passage.indexOf(quote);
  if (quote.length < 8 || first < 0 || passage.indexOf(quote, first + 1) >= 0)
    return "";
  const full = sentenceRange(passage, first, first + quote.length);
  return full.length <= 4096 ? full : "";
}

const quantitativeAmount =
  /(?:[$£€]\s*\d|\d[\d,.]*\s*(?:%|퍼센트|만\s*건|달러|원어치|배\s*(?:증가|감소)|percent\b))/i;
const kinds = new Set<Claim["kind"]>([
  "전망",
  "런웨이 관찰",
  "실측",
  "자료 관찰",
]);
function known(value: string) {
  return (
    value.trim().length > 0 &&
    !/^(?:-|n\/?a|unknown|not (?:specified|provided)|미상|없음|불명|미확인|미기재|정보 없음|알 수 없음)$/i.test(
      value.trim(),
    )
  );
}

/** Check a verbatim supporting passage and keep its trusted source locator.
 * Numeric metadata for a measurement must be present in that same passage. */
export function groundFindings(
  findings: Finding[],
  passages: Passage[],
): Claim[] {
  const claims = new Map<string, Claim>();
  for (const finding of findings) {
    const passage = passages.find((p) => p.id === finding.evidenceId);
    if (
      !passage ||
      !kinds.has(finding.kind) ||
      (passage.memo && finding.kind !== "자료 관찰")
    )
      continue;
    const excerpt = fullExcerpt(passage.text, normalize(finding.excerpt));
    const fact = normalize(finding.fact);
    if (!excerpt || !fact) continue;
    const normalizeNumbers = (v: string) => v.replace(/(?<=\d),(?=\d)/g, "");
    const numbers = normalizeNumbers(fact).match(/\d+(?:\.\d+)?/g) ?? [];
    const evidenceNumbers = new Set(
      normalizeNumbers(excerpt).match(/\d+(?:\.\d+)?/g),
    );
    if (numbers.some((n) => !evidenceNumbers.has(n))) continue;
    const measured = finding.kind === "실측";
    if (
      !measured &&
      (quantitativeAmount.test(fact) || quantitativeAmount.test(excerpt))
    )
      continue;
    if (
      measured &&
      (numbers.length === 0 ||
        ![finding.period, finding.region, finding.unit].every(
          (v) =>
            known(v) &&
            excerpt.toLowerCase().includes(normalize(v).toLowerCase()),
        ))
    )
      continue;
    if (measured && !/\d/.test(excerpt.replace(normalize(finding.period), "")))
      continue;
    const date =
      known(finding.date) &&
      normalize(passage.text).includes(normalize(finding.date))
        ? finding.date.trim()
        : undefined;
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          passage.url || passage.sourceId,
          passage.page,
          excerpt,
          finding.kind,
        ]),
      )
      .digest("hex")
      .slice(0, 20);
    claims.set(key, {
      // The editable art direction may interpret a passage. The fact shown as
      // confirmed always retains its original meaning, including negation.
      id: "claim-" + key,
      kind: finding.kind,
      fact: excerpt,
      excerpt,
      sourceTitle: passage.title,
      url: passage.url,
      sourceId: passage.sourceId,
      page: passage.page,
      date,
      ...(measured && {
        period: finding.period,
        region: finding.region,
        unit: finding.unit,
      }),
      verified: true,
    });
  }
  return [...claims.values()];
}
