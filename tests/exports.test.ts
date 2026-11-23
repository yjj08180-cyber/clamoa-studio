import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { getSeedState } from "../lib/server/seed";
import { entries, pad } from "../lib/library";
import { renderExport } from "../lib/server/export";
import type { Asset } from "../lib/types";

const original = (asset: Asset) =>
  readFile(resolve("content", asset.url.slice(1)));

async function signature(bytes: Buffer | Uint8Array) {
  return sharp(bytes)
    .resize(8, 10, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
}
function meanDifference(a: Buffer, b: Buffer) {
  assert.equal(a.length, b.length);
  return (
    a.reduce((total, value, i) => total + Math.abs(value - b[i]), 0) / a.length
  );
}

test("20-shot ZIP exports correctly ordered full-size JPGs and a matching four-column index", async () => {
  // Swap the endpoints to check editorial board order independently of shot number.
  const rows = entries(getSeedState());
  [rows[0], rows[19]] = [rows[19], rows[0]];
  const result = await renderExport(rows, "zip", original);
  assert.equal(result.name, "CLAMOA_Feed_20.zip");
  assert.equal(result.mime, "application/zip");
  const files = unzipSync(result.bytes);
  const names = rows.map(
    (row, i) =>
      pad(i + 1) + "_" + row.version.plan.title.replaceAll(" ", "_") + ".jpg",
  );
  assert.deepEqual(
    Object.keys(files).sort(),
    ["00_CLAMOA_Index.jpg", ...names].sort(),
  );
  const index = files["00_CLAMOA_Index.jpg"];
  const board = await sharp(index).metadata();
  assert.deepEqual(
    [board.format, board.width, board.height],
    ["jpeg", 1032, 1808],
  );
  for (const [i, row] of rows.entries()) {
    const bytes = files[names[i]];
    const jpg = await sharp(bytes).metadata();
    assert.deepEqual([jpg.format, jpg.width, jpg.height], ["jpeg", 1080, 1350]);
    const feed = await signature(bytes);
    const source = await signature(await original(row.version.image));
    assert.ok(
      meanDifference(feed, source) < 3,
      "Feed image must match the selected version at " + i,
    );
    const thumb = await sharp(index)
      .extract({
        left: 28 + (i % 4) * 244,
        top: 86 + Math.floor(i / 4) * 342,
        width: 232,
        height: 290,
      })
      .png()
      .toBuffer();
    assert.ok(
      meanDifference(await signature(thumb), source) < 4,
      "Contact sheet tile must match exported image at " + i,
    );
  }
});
