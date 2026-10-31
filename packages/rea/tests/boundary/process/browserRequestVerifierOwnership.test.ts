import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";
import { z } from "zod";

import { liveProcesses } from "../../../src/process/ProcessOwnershipProcessTree.js";
import { systemProcessOwnershipHost } from "../../../src/process/ProcessOwnershipObservation.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

// Records once if the lane's root disappears while this stand-in browser still runs.
const browserSource = `
import { appendFileSync, existsSync, readdirSync } from "node:fs";
const rootExists = () => readdirSync(process.env.OWNER_TMP).some((name) => name.startsWith("rea-request-e2e-"));
let seen = false;
setInterval(() => {
  if (existsSync(process.env.OWNER_RELEASE)) process.exit(0);
  if (rootExists()) seen = true;
  else if (seen) {
    appendFileSync(process.env.OWNER_EVENTS, JSON.stringify({ kind: "browser-outlived-root" }) + "\\n");
    seen = false;
  }
}, 10);
setTimeout(() => process.exit(0), 20000);
process.send({ pid: process.pid });
`;

// Launches its browser in a new process group, as Playwright does, then overruns the
// lane's output budget while still running.
const cliSource = `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const browser = spawn(process.execPath, [process.env.OWNER_BROWSER_ENTRY], {
  detached: true,
  stdio: ["ignore", "ignore", "ignore", "ipc"],
});
const ready = await new Promise((resolve, reject) => {
  browser.once("message", resolve);
  browser.once("error", reject);
});
browser.disconnect();
writeFileSync(process.env.OWNER_READY, JSON.stringify({ pids: [ready.pid] }));
const chunk = Buffer.alloc(1024 * 1024, 120);
for (;;) await new Promise((resolve) => process.stdout.write(chunk, resolve));
`;

const reportSchema = z.object({
  pids: z.array(z.number().int().positive()).length(1),
  live: z.array(z.number().int().positive()),
  roots: z.array(z.string()),
  failure: z.object({ name: z.string(), message: z.string() }),
});

const releaseBrowser = async (release: string, ready: string) => {
  await writeFile(release, "release the stand-in browser");
  const pids: readonly number[] = await readFile(ready, "utf8").then(
    (text) => reportSchema.shape.pids.parse(JSON.parse(text).pids),
    (cause: unknown) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
        return [];
      throw cause;
    },
  );
  const deadline = Date.now() + 7_500;
  while (
    liveProcesses(await systemProcessOwnershipHost.listProcesses()).some(
      ({ pid }) => pids.includes(pid),
    )
  ) {
    if (Date.now() >= deadline)
      throw new Error("The stand-in browser did not consume its release");
    await delay(25);
  }
};

// The stand-in CLI and browser are authored; the lane, its owner, the private root
// and process cleanup are real. No browser capture is simulated or claimed.
processTest.skipIf(process.platform === "win32")(
  "stops a failed capture's CLI and the browser it launched before removing the request lane's root",
  { timeout: 40_000 },
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-browser-request-owner-");
    const tmp = join(root, "tmp");
    await mkdir(tmp);
    const cli = join(root, "cli.mjs");
    const browser = join(root, "browser.mjs");
    const ready = join(root, "ready.json");
    const release = join(root, "release-browser");
    const events = join(root, "events.jsonl");
    const driver = join(root, "driver.mjs");
    await writeFile(cli, cliSource);
    await writeFile(browser, browserSource);
    const lane = pathToFileURL(
      resolve("scripts/lib/browser-request-e2e.mjs"),
    ).href;
    const observations = pathToFileURL(
      resolve("dist/process/ProcessOwnershipObservation.js"),
    ).href;
    const tree = pathToFileURL(
      resolve("dist/process/ProcessOwnershipProcessTree.js"),
    ).href;
    await writeFile(
      driver,
      `
import { readFile, readdir } from "node:fs/promises";
import { verifyBrowserRequestSteps } from ${JSON.stringify(lane)};
import { systemProcessOwnershipHost } from ${JSON.stringify(observations)};
import { liveProcesses } from ${JSON.stringify(tree)};
let failure;
try {
  await verifyBrowserRequestSteps("/rea-unlaunched-browser", process.env.OWNER_CLI);
} catch (cause) {
  failure = { name: cause?.name ?? typeof cause, message: cause?.message ?? String(cause) };
}
const { pids } = JSON.parse(await readFile(process.env.OWNER_READY, "utf8"));
const live = liveProcesses(await systemProcessOwnershipHost.listProcesses()).filter(({ pid }) => pids.includes(pid)).map(({ pid }) => pid);
const roots = (await readdir(process.env.OWNER_TMP)).filter((name) => name.startsWith("rea-request-e2e-"));
process.stdout.write(JSON.stringify({ pids, live, roots, failure }));
`,
    );
    try {
      const result = await processes.run(process.execPath, [driver], {
        timeoutMs: 30_000,
        env: {
          ...process.env,
          TMPDIR: tmp,
          OWNER_TMP: tmp,
          OWNER_CLI: cli,
          OWNER_BROWSER_ENTRY: browser,
          OWNER_READY: ready,
          OWNER_RELEASE: release,
          OWNER_EVENTS: events,
        },
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const report = reportSchema.parse(JSON.parse(result.stdout));
      expect(report.live).toEqual([]);
      const receipts = await readFile(events, "utf8").catch(
        (cause: unknown) => {
          if (
            cause instanceof Error &&
            "code" in cause &&
            cause.code === "ENOENT"
          )
            return "";
          throw cause;
        },
      );
      expect(receipts).toBe("");
      expect(report.roots).toEqual([]);
      expect(report.failure.message).toMatch(/output exceeded/u);
    } finally {
      await releaseBrowser(release, ready);
    }
  },
);
