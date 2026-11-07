import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { z } from "zod";

import { compareTestSelection } from "./test-selection.mjs";

const root = process.cwd();
const historyDirectory = join(root, ".cache/ci-test-history");
const historyPath = join(historyDirectory, "test-results.json");
const selectionDirectory = join(root, ".cache/ci-test-selection");
const selectionPath = join(selectionDirectory, "report.json");
// Never let a failed or partial rerun leave a previous successful history file.
await rm(historyPath, { force: true });
await rm(selectionPath, { force: true });
const report = z
  .object({
    version: z.literal(1),
    success: z.boolean(),
    reason: z.string().optional(),
    unhandledErrors: z.number().int().nonnegative().optional(),
    files: z.array(
      z.object({
        name: z.string().min(1),
        durationMs: z.number().finite().nonnegative(),
        state: z.string().optional(),
      }),
    ),
  })
  .parse(JSON.parse(await readFile("test-timings.json", "utf8")));

const files = report.files.map(({ name, durationMs, state }) => {
  const path = relative(root, resolve(root, name));
  if (
    path === "" ||
    path === ".." ||
    path.startsWith(".." + sep) ||
    isAbsolute(path)
  )
    throw new Error(`Test report path is outside the checkout: ${name}`);
  return { name: path.split(sep).join("/"), durationMs, state };
});
// Keep group outcomes intact: an unavailable group is not a completed failure.
const groupResults = [
  process.env.SHARD_RESULT,
  ...(process.env.SOURCE_REQUIRED === "true"
    ? [process.env.SOURCE_RESULT]
    : []),
];
const groupsCompleted = groupResults.every((state) =>
  ["success", "failure"].includes(state),
);
const passed =
  groupResults.every((state) => state === "success") &&
  process.env.MERGE_RESULT === "success" &&
  report.success;
// Successful shards and merged reports must account for the complete portable
// inventory. Coverage thresholds alone cannot prove that every file ran.
const verifyInventory = process.env.CI_VERIFY_TEST_INVENTORY === "true";
const expected =
  verifyInventory || process.env.CI_TEST_SELECTION
    ? execFileSync("git", ["ls-files", "-z", "--", "src", "tests"], {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      })
        .split("\0")
        .filter((path) => path.endsWith(".test.ts"))
    : [];
let selection;
if (process.env.CI_TEST_SELECTION) {
  const comparison = compareTestSelection(
    JSON.parse(process.env.CI_TEST_SELECTION),
    expected,
    files,
  );
  selection = {
    ...comparison,
    complete:
      comparison.complete &&
      report.unhandledErrors === 0 &&
      ["passed", "failed"].includes(report.reason) &&
      groupsCompleted &&
      ["success", "failure"].includes(process.env.MERGE_RESULT),
    executionSha: process.env.GITHUB_SHA ?? null,
    prHeadSha: process.env.CI_PR_HEAD_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  };
  await mkdir(selectionDirectory, { recursive: true });
  await writeFile(selectionPath, JSON.stringify(selection));
}
if (passed && verifyInventory) {
  const actual = files.map(({ name }) => name);
  if (actual.length === 0)
    throw new Error("No portable test modules were reported");
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((path) => !actualSet.has(path));
  const unexpected = actual.filter((path) => !expectedSet.has(path));
  if (missing.length || unexpected.length || actualSet.size !== actual.length)
    throw new Error(
      `Incomplete portable test inventory: ${JSON.stringify({ missing, unexpected, duplicateFiles: actual.length - actualSet.size })}`,
    );
  if (files.every(({ state }) => state === "skipped"))
    throw new Error("Every portable test module was skipped");
}
const skippedFiles = files.filter(({ state }) => state === "skipped");
const summary = [
  groupsCompleted
    ? "## Merged test diagnostics"
    : "## Partial test diagnostics",
  "",
  ...(selection
    ? [
        "### Observational PR test selection",
        "",
        `Plan: ${selection.plan.mode}. Proposed files: ${selection.selected.length}; omitted: ${selection.omitted.length}.`,
        `Full-run comparison: ${selection.complete ? "complete" : "incomplete"}; failures outside proposed selection: ${selection.missedFailures.length}.`,
        "This observational report cannot enable omissions or qualify a revision. Skipped, missing, and interrupted observations do not establish parity.",
        "",
      ]
    : []),
  `Shard result: ${process.env.SHARD_RESULT ?? "unknown"}; merge result: ${process.env.MERGE_RESULT ?? "unknown"}.`,
  ...(process.env.SOURCE_REQUIRED === "true"
    ? [`Source result: ${process.env.SOURCE_RESULT ?? "unknown"}.`]
    : []),
  `Skipped test modules: ${skippedFiles.length}. Their skip reasons and required coverage are not established by this report.`,
  ...(skippedFiles.length ? [""] : []),
  ...skippedFiles.map(({ name }) => `- ${name.replaceAll("|", "\\|")}`),
  "",
  passed
    ? "Successful timing history is available."
    : "This report is diagnostic only and is not a successful timing baseline.",
  "",
  "Durations include tests and hooks, worker preparation, environment, imports, and setup. They are scheduling weights, not summed workflow wall time.",
  "",
  "| Slowest file | Duration (ms) |",
  "| --- | ---: |",
  ...files
    .toSorted((left, right) => right.durationMs - left.durationMs)
    .slice(0, 20)
    .map(
      ({ name, durationMs }) =>
        `| ${name.replaceAll("|", "\\|")} | ${durationMs} |`,
    ),
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
else console.log(summary);

if (passed) {
  await mkdir(historyDirectory, { recursive: true });
  await writeFile(
    historyPath,
    JSON.stringify({
      version: 1,
      success: true,
      files: files.map(({ name, durationMs }) => ({ name, durationMs })),
    }),
  );
}
