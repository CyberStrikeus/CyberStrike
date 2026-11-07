import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import {
  scenarioHeaderOnlyCaptureEvidence,
  scenarioServeFixture,
} from "../../fixtures/browserScenarioCapture.js";
import {
  environmentServeFixture,
  writeEnvironmentServeFiles,
} from "../../fixtures/environmentServe.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { rawHttpRequest } from "../../support/http/rawRequest.js";
import { startListeningProcess } from "../../support/mcp/streamableHttpProcess.js";
import { processTest } from "../../support/process/processFixture.js";

const SHUTDOWN_TIMEOUT_MS = 90_000;

/** How each case is served and what its stopped document reports about the state. */
const MODES = [
  {
    mode: "from the state it derives",
    fixture: environmentServeFixture,
    flags: [],
    environment: "grafana-example",
    // The manifest's 19 tools less its 5 write tools.
    tools: 14,
    state: { served: true, evidence_id: expect.stringMatching(/^ev_/u) },
  },
  {
    mode: "as pure replay with --replay-only",
    fixture: environmentServeFixture,
    flags: ["--replay-only"],
    environment: "grafana-example",
    tools: 19,
    state: { served: false, reason: "replay-only" },
  },
  {
    mode: "as replay when the capture yields no state",
    fixture: () => scenarioServeFixture(scenarioHeaderOnlyCaptureEvidence()),
    flags: [],
    environment: expect.any(String),
    tools: 5,
    state: {
      served: false,
      reason: "unavailable",
      code: "unsupported_target",
      message: expect.stringContaining("response_body"),
    },
  },
] as const;

describe("rea environment-serve shutdown", () => {
  // On Windows, Node's child.kill() terminates the child outright for SIGTERM and SIGINT alike,
  // so no signal handler runs and there is no graceful shutdown to observe.
  for (const { mode, fixture, flags, environment, tools, state } of MODES)
    processTest.skipIf(process.platform === "win32")(
      `closes the listener on SIGTERM, prints one stopped document and exits 143 when serving ${mode}`,
      async ({ processes }) => {
        const root = await createTestTempDirectory(
          "rea-environment-serve-stop-",
        );
        const files = await writeEnvironmentServeFiles(root, fixture());
        const started = await startListeningProcess(processes, [
          "environment-serve",
          files.manifestPath,
          "--evidence",
          files.capturePath,
          ...flags,
          "--port",
          "0",
          "--json",
        ]);
        let stdout = "";
        started.child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        const card = await rawHttpRequest(
          new URL("/.well-known/agent-env.json", started.url.origin),
        );
        expect(card.status).toBe(200);
        started.child.kill("SIGTERM");
        const [code, signalCode] = await once(started.child, "close");
        expect(code).toBe(143);
        expect(signalCode).toBeNull();
        expect(JSON.parse(stdout)).toEqual({
          status: "stopped",
          url: started.url.href,
          environment,
          tools,
          evidence_id: expect.stringMatching(/^ev_/u),
          manifest_evidence_id: expect.stringMatching(/^ev_/u),
          state,
        });
        // A state that cannot be derived is logged as a warning naming its code, before the listener binds.
        const warning = started
          .stderr()
          .split("\n")
          .find((line) => line.includes("Environment state unavailable"));
        if ("code" in state) {
          expect(JSON.parse(warning ?? "{}")).toMatchObject({
            level: 40,
            code: state.code,
            error: state.message,
          });
          expect(started.stderr().indexOf(warning ?? "")).toBeLessThan(
            started.stderr().indexOf("MCP transport listening"),
          );
        } else expect(warning).toBeUndefined();
        await expect(rawHttpRequest(started.url)).rejects.toMatchObject({
          code: "ECONNREFUSED",
        });
      },
      SHUTDOWN_TIMEOUT_MS,
    );
});

describe.skipIf(process.platform === "win32")(
  "environment startup cancellation",
  () => {
    for (const phase of ["read", "bind"] as const) {
      processTest(
        `cancels paused startup at ${phase} without announcing a listener`,
        async ({ processes }) => {
          const root = await createTestTempDirectory(
            "rea-environment-start-cancel-",
          );
          const files = await writeEnvironmentServeFiles(root);
          const preload = join(root, "pause-read.mjs");
          const marker = "REA_STARTUP_PAUSED";
          const pause = `
const interrupted = new Promise(resolve => process.once("SIGTERM", resolve));
const keepAlive = setInterval(() => undefined, 1000);
process.stderr.write(${JSON.stringify(marker + "\n")});
try { await interrupted; } finally { clearInterval(keepAlive); }
`;
          const source =
            phase === "read"
              ? `
import fs from "node:fs/promises";
const open = fs.open;
let gated = false;
fs.open = async (path, ...args) => {
  const handle = await open(path, ...args);
  if (path === ${JSON.stringify(files.manifestPath)}) {
    const read = handle.read.bind(handle);
    handle.read = async (...args) => {
      if (!gated) { gated = true; ${pause} }
      return read(...args);
    };
  }
  return handle;
};
`
              : `
import dns from "node:dns";
const lookup = dns.lookup;
dns.lookup = (host, ...args) => {
  if (host !== "localhost") return lookup(host, ...args);
  const callback = args.at(-1);
  void (async () => { ${pause} if (args[0]?.all) callback(null, [{address: "127.0.0.1", family: 4}]); else callback(null, "127.0.0.1", 4); })();
};
`;
          await writeFile(
            preload,
            source +
              `
import { syncBuiltinESMExports } from "node:module";
syncBuiltinESMExports();
`,
          );
          const child = processes.spawn(
            process.execPath,
            [
              "--import",
              preload,
              "scripts/rea.mjs",
              "environment-serve",
              files.manifestPath,
              "--evidence",
              files.capturePath,
              "--host",
              phase === "bind" ? "localhost" : "127.0.0.1",
              "--port",
              "0",
              "--json",
            ],
            {
              env: {
                PATH: process.env.PATH ?? "",
                NODE_OPTIONS: "--max-old-space-size=768",
                REA_LOG_LEVEL: "info",
              },
            },
          );
          const closed = once(child, "close");
          child.stdin.end();
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf8");
          });
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error(`No Evidence read marker: ${stderr}`)),
              30_000,
            );
            child.stderr.on("data", (chunk: Buffer) => {
              stderr = (stderr + chunk.toString("utf8")).slice(-64 * 1024);
              if (stderr.includes(marker)) {
                clearTimeout(timeout);
                resolve();
              }
            });
            child.once("exit", () => {
              clearTimeout(timeout);
              reject(new Error(`Exited before Evidence read: ${stderr}`));
            });
          });
          child.kill("SIGTERM");
          const [code, signal] = await closed;
          expect(code).toBe(143);
          expect(signal).toBeNull();
          expect(JSON.parse(stdout)).toMatchObject({
            code: "cancelled",
            details: { operation: "environment-serve" },
          });
          expect(stderr).not.toContain("MCP transport listening");
        },
        SHUTDOWN_TIMEOUT_MS,
      );
    }
  },
);
