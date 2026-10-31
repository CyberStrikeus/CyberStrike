#!/usr/bin/env node
import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { parseArgs, promisify } from "node:util";
import {
  applyReleasePleasePatch,
  releaseProposalSearchDepth,
} from "./lib/release-proposal.mjs";

const execute = promisify(execFile);

async function main() {
  const { values } = parseArgs({
    options: {
      "target-branch": { type: "string" },
      "source-sha": { type: "string" },
    },
  });
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (
    !repository ||
    !/^[\w.-]+\/[\w.-]+$/u.test(repository) ||
    !token ||
    !values["target-branch"]
  ) {
    throw new Error("Expected GITHUB_REPOSITORY, GH_TOKEN and --target-branch");
  }
  const depth = await releaseProposalSearchDepth(
    async (command, args) =>
      (await execute(command, args, { encoding: "utf8" })).stdout,
    values["source-sha"],
  );
  // Patch before import: only proposal generation uses this maintained upstream fix.
  // Publication continues through the pinned release-please action.
  await applyReleasePleasePatch();
  const { GitHub, Manifest } = await import("release-please");
  const [owner, repo] = repository.split("/");
  const branch = values["target-branch"];
  const github = await GitHub.create({
    owner,
    repo,
    token,
    defaultBranch: branch,
  });
  const manifest = await Manifest.fromManifest(
    github,
    branch,
    undefined,
    undefined,
    {
      commitSearchDepth: depth,
    },
  );
  const prs = (await manifest.createPullRequests()).filter(Boolean);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `prs_created=${prs.length > 0}\n${prs.length ? `pr=${JSON.stringify(prs[0])}\n` : ""}`,
    );
  }
}

await main().catch((error) => {
  process.stderr.write(
    `Release proposal failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
