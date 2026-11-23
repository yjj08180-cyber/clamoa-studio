import { processNextJob } from "../lib/server/jobs";

let stop = false;
process.once("SIGINT", () => {
  stop = true;
});
process.once("SIGTERM", () => {
  stop = true;
});

async function main() {
  console.log("CLAMOA 워커가 작업을 기다리고 있습니다.");
  while (!stop) {
    try {
      if (await processNextJob()) continue;
    } catch (e) {
      console.error(
        "[clamoa] Worker could not reach the queue:",
        e instanceof Error ? e.message : "Unknown error",
      );
    }
    if (!stop) await new Promise((r) => setTimeout(r, 4000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
