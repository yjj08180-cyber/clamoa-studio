import sharp from "sharp";
import { zipSync } from "fflate";
import type { Entry } from "../library";
import { pad } from "../library";
import type { Asset } from "../types";

const paper = "#f8f7f2";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const filename = (s: string) =>
  s
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, 64)
    .replace(/ +/g, "_") || "CLAMOA";
export async function renderExport(
  rows: Entry[],
  format: "jpg" | "index" | "zip",
  read: (asset: Asset) => Promise<Buffer>,
) {
  const files: Record<string, Uint8Array> = {};
  const perRow = Math.min(4, rows.length),
    cellW = 244,
    cellH = 342,
    padX = 28,
    top = 86,
    width = padX * 2 + perRow * cellW,
    height = top + Math.ceil(rows.length / perRow) * cellH + 12;
  const overlays: sharp.OverlayOptions[] = [];
  const labels: string[] = [];
  for (const [i, { shot, version }] of rows.entries()) {
    const image = await read(version.image);
    const name = pad(i + 1) + "_" + filename(version.plan.title) + ".jpg";
    if (format !== "index") {
      const jpg = await sharp(image)
        .rotate()
        .resize(1080, 1350, { fit: "contain", background: paper })
        .flatten({ background: paper })
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer();
      if (format === "jpg") return { bytes: jpg, name, mime: "image/jpeg" };
      files[name] = jpg;
    }
    const x = padX + (i % perRow) * cellW,
      y = top + Math.floor(i / perRow) * cellH;
    overlays.push({
      input: await sharp(image)
        .rotate()
        .resize(232, 290, { fit: "contain", background: paper })
        .jpeg()
        .toBuffer(),
      left: x,
      top: y,
    });
    labels.push(
      '<text x="' +
        x +
        '" y="' +
        (y + 311) +
        '" font-size="15" font-weight="bold">' +
        pad(i + 1) +
        "  " +
        escape(Array.from(version.plan.title).slice(0, 22).join("")) +
        '</text><text x="' +
        x +
        '" y="' +
        (y + 329) +
        '" font-size="11" fill="#5a5b57">CUT ' +
        pad(shot.number) +
        " · " +
        escape(Array.from(version.plan.theme).slice(0, 24).join("")) +
        "</text>",
    );
  }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '"><g fill="#20231f" font-family="Arial, sans-serif"><text x="28" y="51" font-size="36" font-weight="bold">clamoa</text><text x="' +
    (width - 28) +
    '" y="49" text-anchor="end" font-size="13">FEED INDEX / ' +
    pad(rows.length) +
    "</text>" +
    labels.join("") +
    "</g></svg>";
  overlays.push({ input: Buffer.from(svg), top: 0, left: 0 });
  const index = await sharp({
    create: { width, height, channels: 3, background: paper },
  })
    .composite(overlays)
    .jpeg({ quality: 90 })
    .toBuffer();
  const name = "00_CLAMOA_Index.jpg";
  if (format === "index") return { bytes: index, name, mime: "image/jpeg" };
  files[name] = index;
  return {
    bytes: Buffer.from(zipSync(files, { level: 0 })),
    name: "CLAMOA_Feed_" + pad(rows.length) + ".zip",
    mime: "application/zip",
  };
}
