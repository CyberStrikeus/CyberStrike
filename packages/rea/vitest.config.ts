import { realpathSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig } from "vitest/config";
import { parseCLI } from "vitest/node";
import {
  BUILT_TEST_PROJECTS,
  SOURCE_TEST_PROJECTS,
} from "./scripts/lib/test-projects.mjs";

import { CiTestSequencer } from "./tests/ciTestSequencer.js";

// Playwright's registry does not derive a cache directory for Termux's
// `android` platform. Match the production CLI fallback before workers import
// browser modules.
if (
  process.platform === "android" &&
  process.env.PLAYWRIGHT_BROWSERS_PATH === undefined
) {
  const cacheRoot =
    process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? ".", ".cache");
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(cacheRoot, "ms-playwright");
}

const CANONICAL_TEMPORARY_DIRECTORY = realpathSync(tmpdir());
// Use Vitest's option parser so explicit false and spaced shard values retain
// their meaning. Unknown worker/embedding arguments are not Vitest options.
const { options: testOptions } = parseCLI(
  ["vitest", ...process.argv.slice(2)],
  { allowUnknownOptions: true },
);
const COVERAGE_ENABLED = testOptions.coverage?.enabled === true;
const COVERAGE_SHARD = testOptions.shard !== undefined;
// Keep local and CI concurrency bounded by the runner rather than command locks.
const MAX_TEST_WORKERS = Math.min(2, availableParallelism());

const TEST_PROJECTS = [...SOURCE_TEST_PROJECTS, ...BUILT_TEST_PROJECTS];
const PROJECT_POLICIES = {
  domain: {
    pool: "threads" as const,
    maxWorkers: MAX_TEST_WORKERS,
    // Domain and contract modules are pure and own no process-global state, so
    // per-file module isolation adds startup cost without protecting a seam.
  },
  services: {
    pool: "threads" as const,
    maxWorkers: MAX_TEST_WORKERS,
    // Service tests use recording ports and own no process-global state. Share
    // their module graph so file startup does not dominate the lane.
  },
  adapters: { pool: "forks" as const, maxWorkers: MAX_TEST_WORKERS },
  composition: {
    pool: "threads" as const,
    maxWorkers: MAX_TEST_WORKERS,
    // Composition tests use provider-neutral sessions and test-scoped cleanup;
    // sharing their immutable module graph avoids per-file startup work.
  },
  boundary: { pool: "forks" as const, maxWorkers: MAX_TEST_WORKERS },
  "cli-boundary": {
    pool: "forks" as const,
    maxWorkers: MAX_TEST_WORKERS,
    // CLI tests create fresh command instances or subprocesses and own their
    // cleanup. Reuse the immutable graph; module mocks belong in process-global.
    // The shared source/contract graph also needs transient schema/help space.
    // Ordinary CI exhausted 384 MiB after earlier files warmed that graph.
    // Use the measured 512 MiB budget with the same bounded concurrency.
    execArgv: ["--max-old-space-size=512"],
  },
  "process-boundary": {
    pool: "forks" as const,
    maxWorkers: MAX_TEST_WORKERS,
    // Process-tree observations share host sampling resources; keep this small
    // lane serial while the independent projects run together.
    fileParallelism: false,
    sequence: { groupOrder: 1 },
  },
  "mcp-boundary": {
    pool: "threads" as const,
    maxWorkers: MAX_TEST_WORKERS,
    // Each file creates and closes an explicit in-memory MCP session. Reuse the
    // immutable server graph so module startup does not outweigh transport work.
  },
  acceptance: { pool: "forks" as const, maxWorkers: MAX_TEST_WORKERS },
  "process-global": { pool: "forks" as const, maxWorkers: MAX_TEST_WORKERS },
  conformance: {
    pool: "threads" as const,
    maxWorkers: MAX_TEST_WORKERS,
    // Contract cases use recording providers and own no process-global state.
  },
  evaluation: {
    pool: "threads" as const,
    maxWorkers: MAX_TEST_WORKERS,
    // Evaluator tests inspect deterministic inputs without mutating shared state.
  },
};

const ZERO_COVERAGE_THRESHOLDS = {
  statements: 0,
  branches: 0,
  functions: 0,
  lines: 0,
  "src/domain/**": {
    statements: 0,
    branches: 0,
    functions: 0,
    lines: 0,
  },
  "src/contracts/**": {
    statements: 0,
    branches: 0,
    functions: 0,
    lines: 0,
  },
};

const projects = TEST_PROJECTS.map((project) => {
  const policy =
    PROJECT_POLICIES[project.name as keyof typeof PROJECT_POLICIES];
  if (!policy)
    throw new Error(`Missing test runner policy for ${project.name}`);
  return {
    extends: true as const,
    test: {
      name: project.name,
      include: [...project.include],
      ...(project.exclude ? { exclude: [...project.exclude] } : {}),
      isolate: project.isolate !== false,
      ...policy,
    },
  };
});

export default defineConfig({
  test: {
    env: { TMPDIR: CANONICAL_TEMPORARY_DIRECTORY },
    maxWorkers: MAX_TEST_WORKERS,
    projects,
    ...(process.env.REA_CI_TEST_HISTORY
      ? { sequence: { sequencer: CiTestSequencer } }
      : {}),
    retry: 0,
    reporters: ["default"],
    runner: "./tests/processOwnershipRunner.ts",
    // Boundary projects may compete with TypeScript, docs, and package checks
    // under Turbo. Keep the deadline bounded while avoiding false failures from
    // host-level CPU and filesystem contention.
    testTimeout: COVERAGE_ENABLED ? 60_000 : 30_000,
    coverage: {
      enabled: false,
      provider: "v8",
      reportsDirectory: join(
        tmpdir(),
        `rea-vitest-coverage-${String(process.pid)}`,
      ),
      include: ["src/**"],
      thresholds: COVERAGE_SHARD
        ? ZERO_COVERAGE_THRESHOLDS
        : {
            statements: 65,
            branches: 60,
            functions: 60,
            lines: 68,
            "src/domain/**": {
              statements: 80,
              branches: 75,
              functions: 75,
              lines: 80,
            },
            "src/contracts/**": {
              statements: 85,
              branches: 80,
              functions: 80,
              lines: 85,
            },
          },
      reporter: ["text", "text-summary"],
    },
  },
});
