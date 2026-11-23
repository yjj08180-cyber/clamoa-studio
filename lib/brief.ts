export function creativeBrief(input: string) {
  const text = input.trim();
  const urls = [
    ...new Set(
      (text.match(/https?:\/\/[^\s<>"\]\[，。]+/gi) ?? []).map((url) =>
        url.replace(/[.,;)]+$/, ""),
      ),
    ),
  ].filter((url) => URL.canParse(url));
  const clean = urls
    .reduce((brief, url) => brief.replaceAll(url, ""), text)
    .trim();
  const season = clean.match(
    /\b(20\d{2}|\d{2})\s*(s\s*\/?\s*s|f\s*\/?\s*w)\b/i,
  );
  const reversed = clean.match(/\b(ss|fw)\s*(20\d{2}|\d{2})\b/i);
  const year = season?.[1] ?? reversed?.[2];
  const code = (season?.[2] ?? reversed?.[1] ?? "")
    .toUpperCase()
    .replace(/\W/g, "");
  const count = Number(
    clean.match(/(?:^|[^\d])([1-9]\d{0,2})\s*(?:컷|장)(?=$|[^\d])/u)?.[1],
  );
  return {
    name: Array.from(clean.split(/\n|[.!?] +/)[0]?.trim() || "새 콘텐츠")
      .slice(0, 64)
      .join(""),
    season: year
      ? (year.length === 2 ? "20" + year : year) +
        (code === "SS" ? " S/S" : " F/W")
      : "시즌 미정",
    count: count > 0 && count <= 100 ? count : 1,
    urls,
  };
}
