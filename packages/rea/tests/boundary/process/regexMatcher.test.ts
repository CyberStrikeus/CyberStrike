import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expect, it } from "vitest";

import { regexMatchingDeadlineRecovery } from "../../../src/config/regexMatchingDeadline.js";
import {
  DEFAULT_REGEX_MATCHING_DEADLINE_MS,
  MINIMUM_REGEX_WORKER_HEAP_REQUEST_MIB,
} from "../../../src/domain/analysisResourceLimits.js";
import { ok } from "../../../src/domain/result.js";
import { HopperRegexSearch } from "../../../src/hopper/HopperRegexSearch.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  matchRegexValues,
  REGEX_MATCHING_LIMITATION,
  regexMatchingDeadlineError,
  regexMatchingLimitation,
  regexWorkerHeapError,
  execArgvFromCommandLine,
  resolveLaunchRegexWorkerHeap,
  resolveRegexWorkerHeap,
  readLaunchExecArgv,
  readLaunchNodeOptions,
} from "../../../src/process/RegexMatcher.js";

const workerHeapProbe = `
import { Worker } from "node:worker_threads";
const worker = new Worker(
  \`import { parentPort, resourceLimits } from "node:worker_threads";
    import v8 from "node:v8";
    parentPort.postMessage({
      resourceOld: resourceLimits.maxOldGenerationSizeMb,
      heap: v8.getHeapStatistics().heap_size_limit,
    });\`,
  { eval: true, resourceLimits: { maxOldGenerationSizeMb: 128 } },
);
worker.once("message", (message) => {
  process.stdout.write(JSON.stringify(message));
  void worker.terminate();
});
worker.once("error", (error) => {
  process.stderr.write(error.message);
  process.exitCode = 1;
});
`;

const probeWorkerHeap = (
  args: readonly string[],
  nodeOptions: string | undefined,
  cwd?: string,
): { readonly resourceOld: number; readonly heap: number } => {
  const env = { ...process.env };
  if (nodeOptions === undefined) delete env.NODE_OPTIONS;
  else env.NODE_OPTIONS = nodeOptions;
  const result = spawnSync(process.execPath, [...args, "-e", workerHeapProbe], {
    cwd,
    env,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout ?? "") as {
    resourceOld: number;
    heap: number;
  };
};

it("names the configurable regex deadline and the effective worker heap", () => {
  const heap = resolveLaunchRegexWorkerHeap(
    readLaunchExecArgv(),
    readLaunchNodeOptions(),
  );
  expect(REGEX_MATCHING_LIMITATION).toBe(regexMatchingLimitation(heap));
  const deadline = projectAnalysisError(
    regexMatchingDeadlineError("search_procedures"),
  );
  expect(deadline).toMatchObject({
    code: "resource_constraint",
    details: {
      resource: "cpu",
      reported_limits: {
        matching_deadline_ms: DEFAULT_REGEX_MATCHING_DEADLINE_MS,
        matching_deadline_source: "default",
      },
    },
  });
  expect(deadline.details?.limit).toMatchObject({
    setting: "regex.matching_deadline_ms",
    effective_value: 5000,
    source: "default",
  });
  const failure = projectAnalysisError(
    regexWorkerHeapError("search_procedures", new Error("heap")),
  );
  if (heap.kind === "effective") {
    expect(failure.details).toMatchObject({
      reported_limits: {
        worker_heap_mib: heap.mib,
        requested_worker_heap_mib: 128,
        requested_worker_heap_source: "default",
      },
    });
  } else {
    expect(failure.details?.reported_limits).not.toHaveProperty(
      "worker_heap_mib",
    );
    expect(failure.details).toMatchObject({
      reported_limits: {
        requested_worker_heap_mib: 128,
        requested_worker_heap_source: "default",
      },
    });
  }
});

const relativeHeapGap = (left: number, right: number): number =>
  Math.abs(left - right) / Math.max(left, right);

it("leaves a heap percentage unestablished without reading host memory", () => {
  const percentage = "--max-old-space-size-percentage=50";
  const absolute = "--max-old-space-size=64";
  const observed = probeWorkerHeap([percentage, absolute], undefined);
  expect(observed.resourceOld).toBe(128);
  for (const execArgv of [
    [percentage],
    [percentage, absolute],
    [absolute, percentage],
  ])
    expect(resolveRegexWorkerHeap(execArgv, undefined)).toEqual({
      kind: "unknown",
    });
});

it("does not report the 128 MiB request for NODE_OPTIONS supplied by an env file", () => {
  const directory = mkdtempSync(join(tmpdir(), "rea-regex-env-file-"));
  const file = join(directory, "heap.env");
  writeFileSync(file, "NODE_OPTIONS=--max-old-space-size=256\n");
  try {
    const fromFile = probeWorkerHeap([`--env-file=${file}`], undefined);
    const ifExists = probeWorkerHeap(
      [`--env-file-if-exists=${file}`],
      undefined,
    );
    const small = probeWorkerHeap(["--max-old-space-size=64"], undefined);
    const large = probeWorkerHeap(["--max-old-space-size=256"], undefined);
    expect(fromFile.resourceOld).toBe(128);
    expect(ifExists.resourceOld).toBe(128);
    expect(small.resourceOld).toBe(128);
    expect(large.resourceOld).toBe(128);
    expect(relativeHeapGap(fromFile.heap, large.heap)).toBeLessThan(0.05);
    expect(relativeHeapGap(ifExists.heap, large.heap)).toBeLessThan(0.05);
    expect(fromFile.heap).toBeGreaterThan(small.heap);
    expect(ifExists.heap).toBeGreaterThan(small.heap);
    for (const execArgv of [
      [`--env-file=${file}`],
      [`--env-file-if-exists=${file}`],
      [`--env-file=${file}`, "--max-old-space-size=64"],
    ])
      expect(resolveRegexWorkerHeap(execArgv, undefined)).toEqual({
        kind: "unknown",
      });
    expect(
      resolveRegexWorkerHeap([`--env-file=${file}`], "--max-old-space-size=64"),
    ).toEqual({ kind: "effective", mib: 64, overridden: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("does not report the 128 MiB request for a heap percentage in a Node config file", () => {
  const directory = mkdtempSync(join(tmpdir(), "rea-regex-config-file-"));
  const file = join(directory, "heap.config.json");
  const config = '{"nodeOptions":{"max-old-space-size-percentage":"1"}}\n';
  writeFileSync(file, config);
  writeFileSync(join(directory, "node.config.json"), config);
  try {
    const fromFile = probeWorkerHeap(
      [`--experimental-config-file=${file}`],
      undefined,
    );
    const withAbsolute = probeWorkerHeap(
      [`--experimental-config-file=${file}`, "--max-old-space-size=256"],
      undefined,
    );
    const fromDefault = probeWorkerHeap(
      ["--experimental-default-config-file"],
      undefined,
      directory,
    );
    expect(fromFile.resourceOld).toBe(128);
    expect(withAbsolute.resourceOld).toBe(128);
    expect(fromDefault.resourceOld).toBe(128);
    for (const execArgv of [
      [`--experimental-config-file=${file}`],
      ["--experimental-config-file", file],
      [`--experimental-config-file=${file}`, "--max-old-space-size=64"],
      ["--experimental-default-config-file"],
    ])
      expect(resolveRegexWorkerHeap(execArgv, undefined)).toEqual({
        kind: "unknown",
      });
    expect(
      resolveRegexWorkerHeap(
        ["--experimental-config-file=node.config.json"],
        "--max-old-space-size=64",
      ),
    ).toEqual({ kind: "unknown" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("does not report the 128 MiB request when --max-heap-size lowers the worker heap", () => {
  const heap64 = probeWorkerHeap(["--max-heap-size=64"], undefined);
  const underscore = probeWorkerHeap(["--max_heap_size=64"], undefined);
  const old256 = probeWorkerHeap(["--max-old-space-size=256"], undefined);
  expect(heap64.resourceOld).toBe(128);
  expect(underscore.resourceOld).toBe(128);
  expect(old256.resourceOld).toBe(128);
  expect(heap64.heap).toBeLessThan(old256.heap);
  expect(relativeHeapGap(underscore.heap, heap64.heap)).toBeLessThan(0.05);
  expect(resolveRegexWorkerHeap(["--max-heap-size=64"], undefined)).toEqual({
    kind: "unknown",
  });
  expect(resolveRegexWorkerHeap([], "--max-heap-size=64")).toEqual({
    kind: "unknown",
  });
  expect(
    resolveRegexWorkerHeap(
      ["--max-heap-size=64", "--max-old-space-size=256"],
      undefined,
    ),
  ).toEqual({ kind: "unknown" });
});

it("lets a launch --max-old-space-size override the 128 MiB worker request", () => {
  const smaller = probeWorkerHeap(["--max-old-space-size=64"], undefined);
  const larger = probeWorkerHeap([], "--max-old-space-size=256");
  expect(smaller.resourceOld).toBe(128);
  expect(larger.resourceOld).toBe(128);
  expect(smaller.heap).toBeLessThan(larger.heap);
});

const assertUnrecoverableOffLinux = (): boolean => {
  if (process.platform === "linux") return false;
  const launchExecArgv = readLaunchExecArgv();
  expect(launchExecArgv).toEqual({ kind: "unrecoverable" });
  expect(
    resolveLaunchRegexWorkerHeap(launchExecArgv, {
      kind: "recovered",
      value: "--max-old-space-size=64",
    }),
  ).toEqual({ kind: "unknown" });
  return true;
};

const spawnCommandLineReport = (
  directory: string,
  args: readonly string[],
  preloadBody: string | undefined,
): {
  execLen: number;
  cmdline: string;
  heap: number;
  resourceOld: number;
} => {
  const script = join(directory, "report.cjs");
  const launchArgs = [...args];
  if (preloadBody !== undefined) {
    const preload = join(directory, "preload.cjs");
    writeFileSync(preload, preloadBody);
    launchArgs.push(`--require=${preload}`);
  }
  writeFileSync(
    script,
    `const { Worker } = require("node:worker_threads");
const fs = require("node:fs");
const worker = new Worker(
  \`const { parentPort, resourceLimits } = require("node:worker_threads");
    const v8 = require("node:v8");
    parentPort.postMessage({
      resourceOld: resourceLimits.maxOldGenerationSizeMb,
      heap: v8.getHeapStatistics().heap_size_limit,
    });\`,
  { eval: true, resourceLimits: { maxOldGenerationSizeMb: 128 } },
);
worker.once("message", (message) => {
  process.stdout.write(JSON.stringify({
    execLen: process.execArgv.length,
    cmdline: fs.readFileSync("/proc/self/cmdline").toString("base64"),
    heap: message.heap,
    resourceOld: message.resourceOld,
  }));
});
worker.once("error", (error) => {
  process.stderr.write(error.message);
  process.exitCode = 1;
});
`,
  );
  launchArgs.push(script);
  const result = spawnSync(process.execPath, launchArgs, { encoding: "utf8" });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout ?? "") as {
    execLen: number;
    cmdline: string;
    heap: number;
    resourceOld: number;
  };
};

it("does not report the 128 MiB request after a preload clears process.execArgv", () => {
  if (assertUnrecoverableOffLinux()) return;
  const directory = mkdtempSync(join(tmpdir(), "rea-regex-exec-argv-"));
  try {
    const reported = spawnCommandLineReport(
      directory,
      ["--max-old-space-size=64"],
      "process.execArgv.length = 0;\n",
    );
    const preload = join(directory, "preload.cjs");
    const pinned = probeWorkerHeap(["--max-old-space-size=64"], undefined);
    const larger = probeWorkerHeap(["--max-old-space-size=256"], undefined);
    expect(reported.execLen).toBe(0);
    expect(reported.resourceOld).toBe(128);
    expect(relativeHeapGap(reported.heap, pinned.heap)).toBeLessThan(0.05);
    expect(reported.heap).toBeLessThan(larger.heap);
    const recovered = execArgvFromCommandLine(
      Buffer.from(reported.cmdline, "base64"),
    );
    expect(recovered).toEqual({
      kind: "recovered",
      value: ["--max-old-space-size=64", `--require=${preload}`],
    });
    expect(
      resolveLaunchRegexWorkerHeap(recovered, {
        kind: "recovered",
        value: undefined,
      }),
    ).toEqual({ kind: "effective", mib: 64, overridden: true });
    expect(resolveRegexWorkerHeap([], undefined)).toEqual({
      kind: "effective",
      mib: 128,
      overridden: false,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("leaves the heap unknown when a preload title overwrites the command line", () => {
  if (assertUnrecoverableOffLinux()) return;
  const directory = mkdtempSync(join(tmpdir(), "rea-regex-title-"));
  try {
    const reported = spawnCommandLineReport(
      directory,
      ["--max-old-space-size=64"],
      'process.title = "rea";\n',
    );
    const pinned = probeWorkerHeap(["--max-old-space-size=64"], undefined);
    expect(reported.resourceOld).toBe(128);
    expect(relativeHeapGap(reported.heap, pinned.heap)).toBeLessThan(0.05);
    const recovered = execArgvFromCommandLine(
      Buffer.from(reported.cmdline, "base64"),
    );
    expect(recovered).toEqual({ kind: "unrecoverable" });
    expect(
      resolveLaunchRegexWorkerHeap(recovered, {
        kind: "recovered",
        value: undefined,
      }),
    ).toEqual({ kind: "unknown" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("leaves the heap unknown when --title overwrites the command line", () => {
  if (assertUnrecoverableOffLinux()) return;
  const directory = mkdtempSync(join(tmpdir(), "rea-regex-title-flag-"));
  try {
    const reported = spawnCommandLineReport(
      directory,
      ["--title=rea", "--max-old-space-size=64"],
      undefined,
    );
    const pinned = probeWorkerHeap(["--max-old-space-size=64"], undefined);
    expect(reported.resourceOld).toBe(128);
    expect(relativeHeapGap(reported.heap, pinned.heap)).toBeLessThan(0.05);
    const recovered = execArgvFromCommandLine(
      Buffer.from(reported.cmdline, "base64"),
    );
    expect(recovered).toEqual({ kind: "unrecoverable" });
    expect(
      resolveLaunchRegexWorkerHeap(recovered, {
        kind: "recovered",
        value: undefined,
      }),
    ).toEqual({ kind: "unknown" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("arms the worker timer with an overridden matching deadline", async () => {
  const delays: number[] = [];
  const original = global.setTimeout;
  global.setTimeout = ((handler, timeout, ...args) => {
    if (typeof timeout === "number") delays.push(timeout);
    return original(handler, timeout, ...args);
  }) as typeof setTimeout;
  try {
    expect(
      await matchRegexValues({
        operation: "search_procedures",
        pattern: "^a",
        caseSensitive: true,
        values: ["a"],
        deadline: { deadlineMs: 10_000, source: "setting" },
      }),
    ).toEqual(ok([0]));
    expect(delays).toContain(10_000);
    expect(delays).not.toContain(5_000);
  } finally {
    global.setTimeout = original;
  }
});

it("stops a slow match at the configured deadline and names the setting", async () => {
  const started = performance.now();
  const matched = await matchRegexValues({
    operation: "search_procedures",
    pattern: "^(a+)+$",
    caseSensitive: true,
    values: [`${"a".repeat(30)}!`],
    deadline: { deadlineMs: 100, source: "setting" },
  });
  expect(performance.now() - started).toBeLessThan(4_000);
  expect(matched.ok).toBe(false);
  if (matched.ok) return;
  const projected = projectAnalysisError(matched.error);
  expect(projected).toMatchObject({
    code: "resource_constraint",
    details: {
      resource: "cpu",
      reported_limits: {
        matching_deadline_ms: 100,
        matching_deadline_source: "setting",
      },
    },
  });
  expect(projected.details?.limit).toMatchObject({
    setting: "regex.matching_deadline_ms",
    effective_value: 100,
    source: "setting",
    agent_editable: true,
    rea_restart_required: false,
  });
  expect(projected.remediation.action).toContain(
    regexMatchingDeadlineRecovery({ deadlineMs: 100, source: "setting" }),
  );
  expect(matched.error).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    resource: "cpu",
    reportedLimits: {
      matching_deadline_ms: 100,
      matching_deadline_source: "setting",
    },
  });
});

it("matches a trivial pattern in a real worker at the heap floor", () => {
  const directory = mkdtempSync(join(tmpdir(), "rea-regex-heap-floor-"));
  const probe = join(directory, "probe.mjs");
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  const tsxApi = pathToFileURL(
    join(repository, "node_modules/tsx/dist/esm/api/index.mjs"),
  ).href;
  const matcher = pathToFileURL(
    join(repository, "src/process/RegexMatcher.ts"),
  ).href;
  // Plain Node, with NODE_OPTIONS removed. Do not put `--import tsx` on this
  // process: workers inherit execArgv, and that flag exhausts a floor-sized heap.
  writeFileSync(
    probe,
    `import { tsImport } from ${JSON.stringify(tsxApi)};
const { matchRegexValues } = await tsImport(${JSON.stringify(matcher)}, import.meta.url);
const result = await matchRegexValues({
  operation: "search_procedures",
  pattern: "^a",
  caseSensitive: true,
  values: ["a"],
  heapRequest: {
    heapMiB: ${String(MINIMUM_REGEX_WORKER_HEAP_REQUEST_MIB)},
    source: "setting",
  },
});
process.stdout.write(JSON.stringify(result.ok
  ? { ok: true, indices: result.value }
  : { ok: false, message: String(result.error?.message ?? "") }));
if (!result.ok) process.exitCode = 1;
`,
  );
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  try {
    const result = spawnSync(process.execPath, [probe], {
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, indices: [0] });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("preserves Unicode matching order and refuses a pre-cancelled match", async () => {
  expect(
    await matchRegexValues({
      operation: "search_procedures",
      pattern: "^δ",
      caseSensitive: false,
      values: ["Δelta", "delta", "δίκη"],
    }),
  ).toEqual(ok([0, 2]));
  expect(
    await matchRegexValues({
      operation: "search_procedures",
      pattern: ".",
      caseSensitive: true,
      values: ["value"],
      signal: AbortSignal.abort(),
    }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
});

it("preserves the caller abort reason for pre-cancelled and interrupted matches", async () => {
  const preCancelled = { request: "stop before matching" };
  const refused = await matchRegexValues({
    operation: "search_procedures",
    pattern: ".",
    caseSensitive: true,
    values: ["value"],
    signal: AbortSignal.abort(preCancelled),
  });
  expect(refused).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  if (!refused.ok) expect(refused.error.cause).toBe(preCancelled);
  const controller = new AbortController();
  const interrupted = { request: "stop while matching" };
  const matching = matchRegexValues({
    operation: "search_procedures",
    pattern: "^a",
    caseSensitive: true,
    values: ["a"],
    signal: controller.signal,
  });
  controller.abort(interrupted);
  const result = await matching;
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  if (!result.ok) expect(result.error.cause).toBe(interrupted);
});

it("names the rejected pattern field for a default invalid-pattern refusal", async () => {
  const matched = await matchRegexValues({
    operation: "search_procedures",
    pattern: "[",
    caseSensitive: false,
    values: ["value"],
  });
  expect(matched.ok).toBe(false);
  if (matched.ok) return;
  expect(projectAnalysisError(matched.error)).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    recovery: {
      kind: "inspect_input_contract",
      operation: "search_procedures",
    },
    details: {
      operation: "search_procedures",
      issues: [
        {
          path: ["pattern"],
          reason: "invalid_format",
          message: "Supply a valid regular expression.",
        },
      ],
    },
  });
});

it("keeps Hopper's result projection and invalid-pattern contract with the shared worker", async () => {
  const search = new HopperRegexSearch({
    callTool: async () =>
      ok([
        { address: "0x10", value: "Δelta" },
        { address: "0x20", value: "other" },
      ]),
  });
  expect(
    await search.execute("search_strings", { pattern: "^δ", mode: "regex" }),
  ).toEqual(ok([{ address: "0x10", value: "Δelta" }]));
  const invalid = await search.execute("search_strings", {
    pattern: "[",
    mode: "regex",
  });
  if (invalid.ok) throw new Error("Expected invalid-pattern refusal");
  expect(projectAnalysisError(invalid.error)).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    message: expect.stringContaining("Invalid regex pattern"),
    recovery: { kind: "inspect_input_contract", operation: "search_strings" },
    details: {
      operation: "search_strings",
      issues: [
        {
          path: ["pattern"],
          reason: "invalid_format",
          message: "Supply a valid regular expression.",
        },
      ],
    },
  });
  await search.close();
});
