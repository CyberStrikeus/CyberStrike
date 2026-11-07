import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, vi } from "vitest";
import type { AnalysisErrorProjection } from "../../../src/domain/analysisErrorProjection.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  processTest,
  type TestProcesses,
} from "../../support/process/processFixture.js";

const script = `
import { PlaywrightElectronActiveProvider } from "./dist/browser/PlaywrightElectronActiveProvider.js";
import { electronActiveObservationInputSchema } from "./dist/domain/javascript/electronActiveObservation.js";
import { projectAnalysisError } from "./dist/domain/analysisErrorProjection.js";

const [scenario, executable, root] = JSON.parse(process.argv[1]);
let observedRejections = 0;
if (scenario === "oneFailureWithManySuccesses" || scenario === "externalListenerSeesUnrelatedOnce")
  process.on("unhandledRejection", () => { observedRejections += 1; });
const orphanStack = (message, file) =>
  message + "\\n    at waitForLine (/app/node_modules/playwright-core/lib/server/" + file + ":247:21)";
const playwrightError = (message, file = "electron/electron.js") => {
  const error = new Error(message);
  error.stack = "Error: " + orphanStack(message, file);
  return error;
};
const rejectLater = (error, ms) => setTimeout(() => void Promise.reject(error), ms);
const fakeApplication = { process: () => ({ pid: undefined }), close: async () => undefined };
const launchFailure = (message) =>
  new Error("electron.launch: " + message + "\\nCall log:\\n  - <launching>");
const after = (ms, action) => new Promise((resolve, reject) => setTimeout(() => {
  try { resolve(action()); } catch (error) { reject(error); }
}, ms));
const orphans = (message) => {
  for (let index = 0; index < 3; index += 1) void Promise.reject(playwrightError(message));
};

let during = -1;
const launches = {
  realLaunch: undefined,
  realWithUnrelatedPlaywrightRejection: async (options) => {
    void Promise.reject(playwrightError("unrelated playwright failure", "page.js"));
    return (await import("playwright-core"))._electron.launch(options);
  },
  failureWithOrphans: async () => {
    during = process.listenerCount("unhandledRejection");
    orphans("Process failed to launch!");
    await after(10, () => { throw launchFailure("Process failed to launch!"); });
  },
  failureInOneTick: async () => {
    orphans("Process failed to launch!");
    throw launchFailure("Process failed to launch!");
  },
  failureWithUnrelatedPlaywrightRejection: async () => {
    orphans("Process failed to launch!");
    void Promise.reject(playwrightError("Target page, context or browser has been closed", "page.js"));
    await after(10, () => { throw launchFailure("Process failed to launch!"); });
  },
  externalListenerSeesUnrelatedOnce: async () => {
    void Promise.reject(playwrightError("unrelated playwright failure", "page.js"));
    await after(10, () => { throw launchFailure("Process failed to launch!"); });
  },
  pendingWithUnrelatedRejection: () => {
    setInterval(() => {}, 1000);
    rejectLater(new Error("unrelated application failure"), 20);
    return new Promise(() => {});
  },
  success: async () => {
    during = process.listenerCount("unhandledRejection");
    return fakeApplication;
  },
  successWithPlaywrightRejection: async () => {
    void Promise.reject(playwrightError("stray playwright failure", "page.js"));
    await after(10, () => fakeApplication);
    return fakeApplication;
  },
};

const input = (executablePath) => ({
  ...electronActiveObservationInputSchema.parse({
    executable_path: executablePath,
    application_path: root,
  }),
  application_root: root,
});
const capture = (launch, executablePath = executable) =>
  new PlaywrightElectronActiveProvider({}, launch).capture(input(executablePath));

const before = process.listenerCount("unhandledRejection");
let results;
if (scenario === "concurrentFailures" || scenario === "failureThenSuccess" || scenario === "successThenFailure" || scenario === "oneFailureWithManySuccesses") {
  const failing = (message, orphanAt, settleAt) => async () => {
    during = Math.max(during, process.listenerCount("unhandledRejection"));
    await after(orphanAt, () => orphans(message));
    await after(settleAt - orphanAt, () => { throw launchFailure(message); });
  };
  const succeeding = (settleAt) => () => {
    during = Math.max(during, process.listenerCount("unhandledRejection"));
    return after(settleAt, () => fakeApplication);
  };
  const pair = {
    concurrentFailures: [failing("alpha failed", 10, 30), failing("beta failed", 20, 50)],
    failureThenSuccess: [failing("alpha failed", 10, 20), succeeding(40)],
    successThenFailure: [failing("alpha failed", 20, 40), succeeding(30)],
    oneFailureWithManySuccesses: [failing("alpha failed", 10, 80), ...[20, 30, 40, 50].map(succeeding)],
  }[scenario];
  results = await Promise.all(pair.map((launch) => capture(launch)));
} else {
  results = [await capture(launches[scenario] ?? undefined)];
}
await new Promise((resolve) => setTimeout(resolve, 50));
console.log(JSON.stringify({
  before,
  during,
  after: process.listenerCount("unhandledRejection"),
  observedRejections,
  errors: results.map((result) => result.ok ? null : projectAnalysisError(result.error)),
  ok: results.map((result) => result.ok),
}));
`;

// A cold macOS Swift toolchain may spend up to 120 seconds building the
// ownership reader before any child launch reaches its assertion.
vi.setConfig({ testTimeout: 180_000 });

type Outcome = {
  readonly before: number;
  readonly during: number;
  readonly after: number;
  readonly ok: readonly boolean[];
  readonly errors: readonly (AnalysisErrorProjection | null)[];
  readonly observedRejections: number;
};

const run = async (
  processes: TestProcesses,
  scenario: string,
  executable = "/not/launched",
  root = "/",
) =>
  processes.run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      script,
      JSON.stringify([scenario, executable, root]),
    ],
    { timeoutMs: 150_000 },
  );

const outcome = (result: { readonly stdout: string }): Outcome =>
  JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "") as Outcome;

const earlyExit = async () => {
  const root = await createTestTempDirectory("rea-launch-rejections-");
  const executable = join(root, "exits-immediately");
  await mkdir(join(root, "app"));
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o755);
  return { executable, root: join(root, "app") };
};

processTest(
  "absorbs the orphaned rejections of a failed launch and removes its listener",
  async ({ processes }) => {
    const result = await run(processes, "failureWithOrphans");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(outcome(result)).toMatchObject({
      during: outcome(result).before + 1,
      after: outcome(result).before,
      ok: [false],
      errors: [
        {
          details: {
            diagnostics: {
              message: expect.stringContaining(
                "electron.launch: Process failed to launch!",
              ),
            },
          },
        },
      ],
    });
  },
);

processTest(
  "absorbs orphans raised in the same tick as the launch failure",
  async ({ processes }) => {
    const result = await run(processes, "failureInOneTick");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(outcome(result)).toMatchObject({ ok: [false] });
  },
);

processTest.skipIf(process.platform === "win32")(
  "absorbs the orphans of a real Playwright launch that exits at once",
  async ({ processes }) => {
    const { executable, root } = await earlyExit();
    const result = await run(processes, "realLaunch", executable, root);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(outcome(result)).toMatchObject({
      ok: [false],
      errors: [
        {
          details: {
            diagnostics: {
              message: expect.stringContaining(
                "electron.launch: Process failed to launch!",
              ),
            },
          },
        },
      ],
    });
    expect(outcome(result).after).toBe(outcome(result).before);
  },
);

processTest.skipIf(process.platform === "win32")(
  "still fails on an unrelated Playwright rejection during a real failing launch",
  async ({ processes }) => {
    const { executable, root } = await earlyExit();
    const result = await run(
      processes,
      "realWithUnrelatedPlaywrightRejection",
      executable,
      root,
    );
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toContain("unrelated playwright failure");
    expect(result.stdout).toBe("");
  },
);

processTest(
  "does not replay an unrelated orphan to a listener that already received it",
  async ({ processes }) => {
    const result = await run(processes, "externalListenerSeesUnrelatedOnce");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(outcome(result)).toMatchObject({
      observedRejections: 1,
      ok: [false],
      errors: [
        {
          details: {
            diagnostics: {
              message: expect.stringContaining(
                "electron.launch: Process failed to launch!",
              ),
            },
          },
        },
      ],
    });
  },
);

processTest(
  "still fails on an unrelated Playwright rejection beside a failing launch's own orphans",
  async ({ processes }) => {
    const result = await run(
      processes,
      "failureWithUnrelatedPlaywrightRejection",
    );
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      "Target page, context or browser has been closed",
    );
    expect(result.stdout).toBe("");
  },
);

processTest(
  "still fails at once on an unrelated rejection while a launch is pending",
  async ({ processes }) => {
    const result = await run(processes, "pendingWithUnrelatedRejection");
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toContain("unrelated application failure");
    expect(result.stdout).toBe("");
  },
);

processTest(
  "removes its listener after a successful launch",
  async ({ processes }) => {
    const result = await run(processes, "success");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(outcome(result)).toMatchObject({
      during: outcome(result).before + 1,
      after: outcome(result).before,
    });
  },
);

processTest(
  "re-raises a Playwright rejection when the launch succeeds",
  async ({ processes }) => {
    const result = await run(processes, "successWithPlaywrightRejection");
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toContain("stray playwright failure");
    expect(result.stdout).toBe("");
  },
);

processTest.for([
  "concurrentFailures",
  "failureThenSuccess",
  "successThenFailure",
])(
  "keeps overlapping launches from re-raising each other's orphans (%s)",
  async (scenario, { processes }) => {
    const result = await run(processes, scenario);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(outcome(result).after).toBe(outcome(result).before);
  },
);

processTest(
  "holds each orphan once across many overlapping successful launches",
  async ({ processes }) => {
    const result = await run(processes, "oneFailureWithManySuccesses");
    expect(result.exitCode, result.stderr).toBe(0);
    const observed = outcome(result);
    expect(observed.during).toBe(observed.before + 1);
    expect(observed.after).toBe(observed.before);
    expect(observed.observedRejections).toBe(3);
    expect(observed.ok).toEqual([false, false, false, false, false]);
    expect(observed.errors).toMatchObject([
      {
        details: {
          diagnostics: {
            message: expect.stringContaining("electron.launch: alpha failed"),
          },
        },
      },
      ...Array.from({ length: 4 }, () => ({
        code: "cleanup_incomplete",
        details: {
          cleanup: "incomplete",
          resources: ["owned_process_group"],
          diagnostics: {
            primary_error: {
              code: "unreadable_output",
              details: {
                reason: "process_ownership_unavailable",
              },
            },
            cleanup_error: {
              code: "cleanup_incomplete",
              details: {
                reason: "cleanup_failed",
                cleanup: "incomplete",
                resources: ["owned_process_group"],
              },
            },
          },
        },
      })),
    ]);
  },
);
