import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import {
  CI_FLAGS as flags,
  MANUAL_VERIFIERS,
  CI_LANES,
  WINDOWS_EXECUTABLE_SELECTION_INPUTS,
} from "./scopes.mjs";
import { planTestSelection } from "./test-selection.mjs";

// Actionlint validates workflow syntax only. The semantic suite asserts these
// workflows' release, publication and self-hosted runner safeguards.
const GUARDED_WORKFLOWS = new Set([
  ".github/workflows/pr-title.yml",
  ".github/workflows/pr-readiness.yml",
  ".github/workflows/ci-full-pr.yml",
  ".github/workflows/release.yml",
  ".github/workflows/release-recovery.yml",
  ".github/workflows/real-ghidra-windows.yml",
  ".github/workflows/sqlite-runtime.yml",
  ".github/workflows/ci-timings.yml",
  ".github/workflows/mutation.yml",
]);
// Sources compiled by build-conformance-fixtures.mjs. The readiness journey
// analyzes the built C fixture as well as its own applications.
const FIXTURE_SOURCES = [
  "scripts/build-conformance-fixtures.mjs",
  "scripts/verify-conformance-fixtures.mjs",
  "scripts/lib/conformance-fixtures.mjs",
  "tests/conformance/c/**",
  "tests/conformance/napi/**",
  "tests/conformance/objc/**",
  "tests/conformance/swift/**",
  "tests/conformance/versions/**",
];
// These reporters affect CI output only; they do not select a host or provider
// verification lane when changed on their own.
const PORTABLE_CI_REPORTERS = new Set([
  "scripts/ci/job-timings.mjs",
  "scripts/ci/job-timings-batch.mjs",
  "scripts/ci/test-report.mjs",
  "scripts/ci/test-timing-reporter.mjs",
  "scripts/ci/test-history.mjs",
]);
const matchesAny = (file, patterns) =>
  patterns.some((pattern) => matchesGlob(file, pattern));
const selected = Object.fromEntries(flags.map((flag) => [flag, false]));
const reasons = [];
// Shared process, contract, CLI, and CI-script edits are not a specific provider.
// Fast qualification keeps the portable suite and the Linux x64 runtime
// baseline. Full qualification still selects every lane.
const SHARED_BOUNDARY =
  /^(src\/process\/|src\/filesystem\/|src\/contracts\/tool|src\/server\/createServer|src\/cli\.ts|scripts\/ci\/)/;
const full = (reason) => {
  if (tier === "full") {
    for (const flag of flags) selected[flag] = true;
  } else {
    selected.code = true;
    selected.runtime = true;
  }
  reasons.push(reason);
};
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trimEnd();
function classifyPackage(base, head) {
  const before = JSON.parse(git("show", `${base}:package.json`));
  const after = JSON.parse(git("show", `${head}:package.json`));
  const { scripts: beforeScripts, ...beforeRest } = before;
  const { scripts: afterScripts, ...afterRest } = after;
  const compilerDependencies = (metadata) => ({
    dependencies: {
      typescript: metadata.dependencies?.typescript,
      tsrs: metadata.dependencies?.tsrs,
    },
    devDependencies: {
      typescript: metadata.devDependencies?.typescript,
      tsrs: metadata.devDependencies?.tsrs,
    },
  });
  const compilerScripts = [
    "compile",
    "typecheck",
    "build",
    "build:cached",
    "test:prepare",
    "docs:prepare",
    "verify:frida:bindings",
  ].flatMap((name) => [name, `pre${name}`, `post${name}`]);
  selected.package ||=
    JSON.stringify(compilerDependencies(before)) !==
      JSON.stringify(compilerDependencies(after)) ||
    compilerScripts.some(
      (name) => beforeScripts?.[name] !== afterScripts?.[name],
    );
  if (JSON.stringify(beforeRest) !== JSON.stringify(afterRest)) {
    full("Package metadata or dependencies changed");
    return;
  }
  selected.code = true;
  const changed = [
    ...new Set([
      ...Object.keys(beforeScripts ?? {}),
      ...Object.keys(afterScripts ?? {}),
    ]),
  ].filter((key) => beforeScripts?.[key] !== afterScripts?.[key]);
  for (const script of changed) {
    if (/^test:(coverage|mutation):reverse-tools$/.test(script)) {
      selected.reverse_tools = true;
      continue;
    }
    if (script === "test:python") {
      selected.python = true;
      continue;
    }
    if (script === "test:sqlite" || script === "test:sqlite:run") {
      selected.sqlite = true;
      continue;
    }
    if (
      /^(test(?::|$)|check(?::|$)|lint(?::|$)|format(?::|$)|knip(?::|$)|jscpd$)/.test(
        script,
      )
    )
      continue;
    if (
      ["compile:termux", "build:termux", "build:termux:run"].includes(script)
    ) {
      selected.workflows = true;
      reasons.push(
        `Android build script changed; real Android verification remains manual: ${script}`,
      );
      continue;
    }
    // Verify scripts own provider setup as well as execution. Reuse their
    // existing source-file ownership rather than maintaining a second map.
    const entrypoint = (command) =>
      /^(?:npm run build:cached && )?node (scripts\/[\w/-]+\.mjs)(?: [\w./=-]+)*$/.exec(
        command ?? "",
      )?.[1];
    const beforeEntry = entrypoint(beforeScripts?.[script]);
    const afterEntry = entrypoint(afterScripts?.[script]);
    const entries = [beforeEntry, afterEntry].filter(Boolean);
    const simple =
      (!beforeScripts?.[script] || beforeEntry) &&
      (!afterScripts?.[script] || afterEntry);
    const scriptOwners =
      simple &&
      entries.every((entry) =>
        Object.values(CI_LANES).some(({ paths }) => matchesAny(entry, paths)),
      )
        ? Object.entries(CI_LANES)
            .filter(([, { paths }]) =>
              entries.some((entry) => matchesAny(entry, paths)),
            )
            .map(([owner]) => owner)
        : [];
    if (scriptOwners.length)
      for (const owner of scriptOwners) selected[owner] = true;
    else full(`Shared or unknown package script: ${script}`);
  }
}

const event = process.env.GITHUB_EVENT_NAME;
if (!["pull_request", "push", "schedule", "workflow_dispatch"].includes(event))
  throw new Error(`Unsupported CI event: ${event}`);
const requestedFull =
  event === "schedule" ||
  event === "workflow_dispatch" ||
  process.env.CI_FULL === "true";
const tier =
  event === "schedule" &&
  process.env.CI_SKIP_FULL === "true" &&
  process.env.CI_FULL !== "true"
    ? "reused"
    : requestedFull
      ? "full"
      : "fast";
let files = [];
if (tier === "reused") {
  reasons.push(
    "Recent exact-SHA full qualification reused; no fresh provider observation",
  );
} else if (tier === "full") {
  full("Full baseline requested by event or ci:full label");
} else if (event === "pull_request" || event === "push") {
  const head = process.env.HEAD_SHA;
  let base;
  if (event === "pull_request") {
    base = git("merge-base", process.env.BASE_SHA, head);
  } else {
    const candidate = process.env.BASE_SHA;
    const baselineReason = process.env.BASELINE_REASON;
    try {
      if (!candidate || !/^[0-9a-f]{40}$/i.test(candidate))
        throw new Error(
          baselineReason || "No valid successful push baseline was found",
        );
      execFileSync("git", ["merge-base", "--is-ancestor", candidate, head], {
        stdio: "ignore",
      });
      base = candidate;
    } catch {
      full(
        baselineReason ||
          "No valid successful push baseline ancestor; selecting all lanes",
      );
    }
  }
  if (base) {
    // Disable rename detection so both the removed and added paths participate.
    files = git("diff", "--name-only", "--no-renames", "-z", base, head)
      .split("\0")
      .filter(Boolean);
    for (const file of files) {
      selected.package ||= matchesAny(
        file,
        WINDOWS_EXECUTABLE_SELECTION_INPUTS,
      );
      for (const [
        owner,
        { paths, earlyAll, earlyInputs = [] },
      ] of Object.entries(CI_LANES))
        if (matchesAny(file, earlyAll ? paths : earlyInputs))
          selected[owner] = true;
      if (
        /^(README(?:_[^/]+)?\.md|AGENTS\.md|CONTRIBUTING\.md|CHANGELOG\.md|SECURITY\.md|native\/windows\/README\.md|\.github\/pull_request_template\.md)$/.test(
          file,
        ) ||
        file.startsWith("docs/") ||
        file.startsWith(".github/ISSUE_TEMPLATE/")
      ) {
        selected.docs = true;
        // Authored code and its Node package scopes belong to static checkers.
        selected.code ||=
          file.startsWith("docs/") &&
          (/\.(?:[cm]?[jt]s|[jt]sx)$/u.test(file) ||
            file.endsWith("/package.json"));
        selected.website ||= matchesAny(file, CI_LANES.website.paths);
        continue;
      }
      if (/^(src|tests)\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) {
        selected.code = true;
        for (const [owner, { paths, testInputs }] of Object.entries(CI_LANES))
          if (testInputs && matchesAny(file, paths)) selected[owner] = true;
        continue;
      }
      if (matchesAny(file, MANUAL_VERIFIERS)) {
        selected.code = true;
        continue;
      }
      // Timing and report helpers stay on the portable suite. They are not a
      // runtime or provider change.
      if (PORTABLE_CI_REPORTERS.has(file)) {
        selected.code = true;
        continue;
      }
      // A shared boundary is not evidence that every provider or host changed.
      // One matching owner is path evidence. Several owners means the same
      // registration file is listed by many lanes; fast qualification does not
      // fan those out or start the multi-host package matrix.
      if (tier !== "full" && SHARED_BOUNDARY.test(file)) {
        selected.code = true;
        selected.runtime = true;
        const owners = Object.entries(CI_LANES)
          .filter(([, { paths }]) => matchesAny(file, paths))
          .map(([owner]) => owner);
        if (owners.length === 1) selected[owners[0]] = true;
        reasons.push(`Shared boundary on fast tier: ${file}`);
        continue;
      }
      const owners = Object.entries(CI_LANES)
        .filter(([, { paths }]) => matchesAny(file, paths))
        .map(([owner]) => owner);
      for (const owner of owners) selected[owner] = true;
      if (
        file.startsWith(".github/workflows/") ||
        file === ".github/actionlint.yaml"
      ) {
        selected.workflows = true;
        if (GUARDED_WORKFLOWS.has(file)) selected.code = true;
        if (file !== ".github/workflows/ci.yml") continue;
      }
      // The Notes example is also the source-owned agent evaluation fixture.
      if (file.startsWith("website/public/examples/notes-electron/"))
        selected.code = true;
      if (owners.length === 1 && owners[0] === "website") continue;
      if (/^src\/(contracts|domain)\//.test(file)) selected.docs = true;
      if (file === "package.json") {
        classifyPackage(base, head);
        continue;
      }
      selected.code = true;
      if (matchesAny(file, FIXTURE_SOURCES)) {
        selected.fixtures = true;
        selected.readiness = true;
      }
      if (file.startsWith("tests/")) continue;
      if (
        /^(src\/process\/|src\/filesystem\/|src\/contracts\/tool|src\/server\/createServer|src\/cli\.ts|scripts\/ci\/)/.test(
          file,
        )
      ) {
        full(`Shared boundary: ${file}`);
      } else if (owners.length) {
        if (file.startsWith("src/") || file.startsWith("bridge/"))
          selected.runtime = true;
      } else if (/^(src|bridge)\//.test(file)) {
        // Unowned runtime sources keep the Linux x64 installed-package baseline;
        // full qualification retains every native host.
        selected.runtime = true;
        reasons.push(`Unowned runtime source: ${file}`);
      } else if (file.startsWith(".agents/skills/")) {
        selected.runtime = true;
        selected.docs = true;
      } else {
        full(`Unclassified input: ${file}`);
      }
    }
  }
}
selected.runtime ||= selected.package;
const linux = { os: "ubuntu-latest", platform: "linux", architecture: "x64" };
// macOS x64 is the slowest package host. Fast qualification omits it.
const intel =
  tier === "full"
    ? [{ os: "macos-15-intel", platform: "darwin", architecture: "x64" }]
    : [];
const matrix = {
  include: selected.package
    ? [
        linux,
        { os: "ubuntu-24.04-arm", platform: "linux", architecture: "arm64" },
        { os: "macos-15", platform: "darwin", architecture: "arm64" },
        ...intel,
      ]
    : [linux],
};
const testSelection = planTestSelection(files, event, tier);
const plan = { ...selected, tier, matrix, files, reasons, testSelection };
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries({
      ...selected,
      tier,
      matrix: JSON.stringify(matrix),
      test_selection: JSON.stringify(testSelection),
    })
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Selected CI lanes (${tier})\n\n${flags.filter((flag) => selected[flag]).join(", ") || "Formatting only"}\n\n${reasons.join("\n\n")}\n`,
  );
console.log(JSON.stringify(plan));
