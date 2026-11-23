import sharp from "sharp";
import type { ResponseResult } from "./evidence";

const maxBytes = 8 * 1024 * 1024;
const pinHost = /^(?:[a-z]{2,3}\.)?pinterest\.(?:com|co\.uk)$/;

function httpsURL(value?: string) {
  try {
    const url = new URL(value ?? "");
    if (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password
    )
      return url;
  } catch {
    return;
  }
}

export function pinterestPin(value?: string) {
  const url = httpsURL(value);
  if (!url || !pinHost.test(url.hostname)) return;
  const match = /^\/pin\/(?:[\w-]+--)?(\d{5,25})\/?$/.exec(url.pathname);
  if (!match) return;
  return {
    id: "pin-" + match[1],
    url: "https://www.pinterest.com/pin/" + match[1] + "/",
  };
}

export type PinImage = {
  id: string;
  url: string;
  title: string;
  bytes: Buffer;
};

export async function pinterestImages(
  result: ResponseResult,
): Promise<PinImage[]> {
  const candidates = new Map<
    string,
    {
      pin: NonNullable<ReturnType<typeof pinterestPin>>;
      media: string[];
      title: string;
    }
  >();
  for (const call of result.output ?? []) {
    if (call.type !== "web_search_call" || !Array.isArray(call.results))
      continue;
    for (const item of call.results) {
      if (item.type !== "image_result") continue;
      const pin = pinterestPin(item.source_website_url);
      const media = [item.image_url, item.thumbnail_url].flatMap((raw) => {
        const url = httpsURL(raw);
        return url?.hostname === "i.pinimg.com" ? [url.href] : [];
      });
      if (pin && media.length && !candidates.has(pin.id)) {
        candidates.set(pin.id, {
          pin,
          media: [...new Set(media)],
          title: item.caption?.trim().slice(0, 140) || "Pinterest 레퍼런스",
        });
      }
    }
  }
  const images = await Promise.all(
    [...candidates.values()].slice(0, 6).map(async ({ pin, media, title }) => {
      for (const url of media) {
        const bytes = await downloadImage(url);
        if (bytes) return { ...pin, title, bytes };
      }
    }),
  );
  return images.filter((image) => image !== undefined).slice(0, 4);
}

async function downloadImage(url: string) {
  try {
    const result = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(5500),
      cache: "no-store",
    });
    if (!result.ok || !result.body) return;
    const type = result.headers.get("content-type")?.split(";")[0].trim();
    if (
      !type ||
      !["image/jpeg", "image/png", "image/webp"].includes(type) ||
      Number(result.headers.get("content-length")) > maxBytes
    ) {
      await result.body.cancel();
      return;
    }
    const reader = result.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return;
      }
      chunks.push(value);
    }
    const image = sharp(Buffer.concat(chunks), {
      limitInputPixels: 24_000_000,
    });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      Math.min(metadata.width ?? 0, metadata.height ?? 0) < 140
    )
      return;
    return await image
      .rotate()
      .resize({
        width: 960,
        height: 960,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#fff" })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    return;
  }
}
