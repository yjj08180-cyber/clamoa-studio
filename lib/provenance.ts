import type { Claim, Source } from "./types";

export function supportedClaim(claim: Claim, sources: Source[]): boolean {
  if (!claim.verified || !claim.fact.trim()) return false;
  if (
    claim.kind === "실측" &&
    !(claim.period?.trim() && claim.region?.trim() && claim.unit?.trim())
  )
    return false;
  const source = sources.find((s) => s.id === claim.sourceId);
  if (claim.sourceId && !source) return false;
  if (source?.kind === "mood") return false;
  if (source?.kind === "pdf")
    return !claim.url && Number.isInteger(claim.page) && Number(claim.page) > 0;
  if (source?.kind === "memo")
    return (
      !claim.url && claim.kind === "자료 관찰" && Boolean(source.text?.trim())
    );
  const url = claim.url || source?.url;
  if (!url) return false;
  try {
    return ["https:", "http:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
