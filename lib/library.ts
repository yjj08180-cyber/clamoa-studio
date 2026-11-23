import type { Project, Shot, StudioState, Version } from "./types";
export type Entry = { project: Project; shot: Shot; version: Version };
export function entries(state: StudioState, all = false): Entry[] {
  return state.projects.flatMap((project) =>
    project.shots.flatMap((shot) =>
      shot.versions
        .filter((version) => all || version.id === shot.adoptedId)
        .map((version) => ({ project, shot, version })),
    ),
  );
}
export function nextShotNumber(project: Project): number {
  return (
    Math.max(
      project.lastShotNumber ?? 0,
      ...project.shots.map((shot) => shot.number),
    ) + 1
  );
}
export const pad = (n: number) => String(n).padStart(2, "0");
export function thumb(url: string) {
  const match = /^\/sample\/Feed\/(\d{2})_/.exec(url);
  return match ? "/sample/thumb/" + match[1] + ".webp" : url;
}
export const themeColors: Record<string, string> = {
  "Luminous Blue": "#303cbd",
  "Energy Orange": "#e57936",
  "Pop Pink": "#eb81aa",
  "Meadowland Green": "#709249",
  Clay: "#a66b52",
};
