#!/usr/bin/env node
import { execFile } from "node:child_process";
import { parseArgs, promisify } from "node:util";
import { inspectReleaseCheckpoint } from "./lib/release-checkpoint.mjs";

const execFileAsync = promisify(execFile);

async function git(args) {
  const result = await execFileAsync("git", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout;
}

async function main() {
  const { values } = parseArgs({
    options: {
      phase: { type: "string" },
      stage: { type: "string", default: "source" },
      "release-branch": { type: "string" },
      "source-sha": { type: "string" },
    },
  });
  const report = await inspectReleaseCheckpoint(git, {
    phase: values.phase,
    stage: values.stage,
    releaseBranch: values["release-branch"],
    sourceSha: values["source-sha"],
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.missingNotes.length > 0) {
    process.stderr.write(
      `Review ${report.missingNotes.length} additional unreleased mainline entries missing from these release notes; see the ancestry report above.\n`,
    );
  }
}

await main().catch((error) => {
  process.stderr.write(
    `Release checkpoint validation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
