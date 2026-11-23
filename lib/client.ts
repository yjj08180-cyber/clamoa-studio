async function exportFile(versionIds: string[], format: "jpg" | "index") {
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versionIds, format }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "다운로드를 준비하지 못했습니다.");
  }
  const header = response.headers.get("Content-Disposition") || "";
  return {
    name: decodeURIComponent(header.split("UTF-8''")[1] || "CLAMOA.jpg"),
    blob: await response.blob(),
  };
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function downloadVersions(
  versionIds: string[],
  format: "jpg" | "index" | "zip",
) {
  if (format !== "zip") {
    const file = await exportFile(versionIds, format);
    download(file.name, file.blob);
    return;
  }
  // Pack in the browser so the finished ZIP isn't subject to the host's response size limit.
  const { zipSync } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  for (let offset = 0; offset < versionIds.length; offset += 4) {
    const batch = await Promise.all(
      versionIds.slice(offset, offset + 4).map(async (id, i) => {
        const item = await exportFile([id], "jpg");
        const order = String(offset + i + 1).padStart(2, "0");
        return [
          order + "_" + item.name.replace(/^\d+_/, ""),
          new Uint8Array(await item.blob.arrayBuffer()),
        ] as const;
      }),
    );
    for (const [name, bytes] of batch) files[name] = bytes;
  }
  const index = await exportFile(versionIds, "index");
  files[index.name] = new Uint8Array(await index.blob.arrayBuffer());
  const archive = new Uint8Array(zipSync(files, { level: 0 }));
  download(
    "CLAMOA_Feed_" + String(versionIds.length).padStart(2, "0") + ".zip",
    new Blob([archive], { type: "application/zip" }),
  );
}
