#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs, promisify } from "node:util";
import { collectGitHubCredits } from "./lib/release-notes-github.mjs";
import { verifyNotesPublication } from "./lib/release-notes-publication.mjs";
import {
  contributionRecord,
  contributionSummary,
  readReleaseHistory,
  releaseInventorySchema,
  selectedReleaseNotes,
  verifyInventoryHistory,
  verifyReleaseNotes,
} from "./lib/release-notes.mjs";

const execFileAsync = promisify(execFile);
async function run(command, args, input) {
  const pending = execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  pending.child.stdin.end(input);
  return (await pending).stdout;
}

async function createInventory(values) {
  if (!values.repository || !values.base || !values.target || !values.version)
    throw new Error(
      "inventory requires --repository, --base, --target and --version",
    );
  // Parse caller-selected boundaries before making network requests.
  const history = await readReleaseHistory(run, values.base, values.target);
  releaseInventorySchema.omit({ commits: true, pullRequests: true }).parse({
    schemaVersion: 1,
    repository: values.repository,
    version: values.version,
    base: history.base,
    target: history.target,
  });
  const credits = await collectGitHubCredits(
    run,
    values.repository,
    history.commits,
  );
  const inventory = releaseInventorySchema.parse({
    schemaVersion: 1,
    repository: values.repository,
    version: values.version,
    base: history.base,
    target: history.target,
    ...credits,
  });
  await verifyInventoryHistory(run, inventory);
  await writeFile(values.manifest, `${JSON.stringify(inventory, null, 2)}\n`, {
    flag: "wx",
  });
  process.stdout.write(
    `Inventoried ${inventory.commits.length} commits and ${inventory.pullRequests.length} merged PRs. Saved ${values.manifest}\n`,
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repository: { type: "string" },
      pr: { type: "string" },
      base: { type: "string" },
      target: { type: "string" },
      version: { type: "string" },
      manifest: { type: "string" },
      notes: { type: "string", default: "CHANGELOG.md" },
      "pr-body": { type: "string" },
      source: { type: "string" },
      output: { type: "string" },
      summary: { type: "boolean", default: false },
    },
  });
  const [command] = positionals;
  if (command === "publication" && positionals.length === 1) {
    if (!values.repository || !values.source)
      throw new Error(
        "publication requires --repository and --source; --pr selects the merged release PR",
      );
    process.stdout.write(
      `${JSON.stringify(await verifyNotesPublication(run, values), null, 2)}\n`,
    );
    return;
  }
  if (
    positionals.length !== 1 ||
    !["inventory", "record", "check", "render"].includes(command) ||
    !values.manifest
  )
    throw new Error(
      "Usage: release-notes inventory|record|check|render --manifest FILE [--repository OWNER/REPO --base TAG --target SHA --version VERSION] [--notes FILE --pr-body FILE --source SHA --output FILE] [--summary for record]",
    );
  if (command === "inventory") {
    await createInventory(values);
    return;
  }
  const inventory = releaseInventorySchema.parse(
    JSON.parse(await readFile(values.manifest, "utf8")),
  );
  await verifyInventoryHistory(run, inventory, values.source);
  if (command === "record") {
    const record = values.summary
      ? contributionSummary(inventory)
      : contributionRecord(inventory);
    if (values.output)
      await writeFile(values.output, record, {
        flag: "wx",
      });
    else process.stdout.write(record);
    return;
  }
  const notes = await readFile(values.notes, "utf8");
  const body = values["pr-body"]
    ? await readFile(values["pr-body"], "utf8")
    : undefined;
  const report = verifyReleaseNotes(inventory, notes, body);
  if (command === "check") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (!values.output)
    throw new Error(
      "render requires --output (an existing file is never overwritten)",
    );
  const rendered = selectedReleaseNotes(notes, inventory.version);
  await writeFile(values.output, `${rendered}\n`, { flag: "wx" });
}

await main().catch((error) => {
  process.stderr.write(
    `Release notes failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
