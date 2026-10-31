import { execFile } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { valid } from "semver";
import { z } from "zod";

import { validateVerifiedPackage } from "./verified-package.mjs";
import { verifyPublishedPackageIntegrity } from "./qualified-package-envelope.mjs";

const execute = promisify(execFile);
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const positive = z.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const versionSchema = z
  .string()
  .refine(
    (value) => valid(value) === value && !value.includes("+"),
    "Expected an exact release version without build metadata",
  );
const repositorySchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/u);

/** Require the original release's successful qualification and npm write. */
export function selectRecoveryRelease({
  repository,
  version,
  run,
  jobs,
  release,
  tagSha,
}) {
  repositorySchema.parse(repository);
  versionSchema.parse(version);
  sha.parse(tagSha);
  const original = z
    .object({
      id: positive,
      run_attempt: positive,
      path: z.literal(".github/workflows/release.yml"),
      event: z.literal("pull_request"),
      status: z.literal("completed"),
      repository: z.object({ full_name: z.literal(repository) }),
      head_repository: z.object({ full_name: z.literal(repository) }),
    })
    .parse(run);
  z.object({
    tag_name: z.literal(`rea-agents-${version}`),
    draft: z.literal(false),
    published_at: z.string().min(1),
  }).parse(release);
  const parsedJobs = z
    .array(
      z.object({
        name: z.string(),
        status: z.string(),
        conclusion: z.string().nullable(),
        steps: z
          .array(
            z.object({ name: z.string(), conclusion: z.string().nullable() }),
          )
          .default([]),
      }),
    )
    .parse(jobs);
  const requireJob = (name) => {
    const matches = parsedJobs.filter((job) => job.name === name);
    if (matches.length !== 1 || matches[0].status !== "completed")
      throw new Error(`Expected one completed original job: ${name}`);
    return matches[0];
  };
  for (const name of [
    "Release reviewed main merge",
    "Qualify exact release revision / CI required",
  ])
    if (requireJob(name).conclusion !== "success")
      throw new Error(`Original release did not pass ${name}`);
  const publish = requireJob("Publish to npm");
  const writes = publish.steps.filter((step) => step.name === "Publish");
  const verificationJobs = parsedJobs.filter(
    (job) => job.name === "Verify published npm package",
  );
  if (
    verificationJobs.length > 1 ||
    verificationJobs.some((job) => job.status !== "completed")
  )
    throw new Error(
      "Expected at most one completed original npm verification job",
    );
  const verified = [publish, ...verificationJobs]
    .flatMap((job) => job.steps)
    .filter((step) => step.name === "Verify published npm bytes and dist-tag");
  if (
    !(
      (writes.length === 1 && writes[0].conclusion === "success") ||
      (verified.length === 1 && verified[0].conclusion === "success")
    )
  )
    throw new Error(
      "Original npm publication did not succeed or verify existing bytes",
    );
  return {
    version,
    source_sha: tagSha,
    run_id: original.id,
    run_attempt: original.run_attempt,
  };
}

/** Bind existing npm bytes to the original qualified archive, without rebuilding it. */
export async function verifyRecoveryPackage({
  directory,
  sourceSha,
  runId,
  runAttempt,
  version,
  integrity,
}) {
  const tarball = await validateVerifiedPackage({
    directory,
    sourceSha,
    runId,
    runAttempt,
    packageVersion: version,
    nodeVersion: process.version,
    // Existing published releases retain their original v1 artifact; never rewrite it.
    allowLegacyManifest: true,
  });
  await verifyPublishedPackageIntegrity(tarball, integrity);
  return { version, sourceSha, runId, runAttempt, integrity };
}

async function command(program, args, cwd) {
  return (
    await execute(program, args, { cwd, maxBuffer: 16 * 1024 * 1024 })
  ).stdout.trim();
}

async function main() {
  const [operation, ...extra] = process.argv.slice(2);
  if (extra.length || !["resolve", "verify"].includes(operation))
    throw new Error(
      "Usage: node scripts/ci/release-recovery.mjs resolve|verify",
    );
  const version = versionSchema.parse(process.env.RECOVERY_VERSION);
  const runId = positive.parse(process.env.RECOVERY_RUN_ID);
  if (operation === "resolve") {
    if (process.env.GITHUB_REF !== "refs/heads/main")
      throw new Error("Run release recovery from main");
    const repository = repositorySchema.parse(process.env.GITHUB_REPOSITORY);
    const api = async (path) =>
      JSON.parse(await command("gh", ["api", `repos/${repository}/${path}`]));
    const run = await api(`actions/runs/${runId}`);
    const pages = z
      .array(z.object({ jobs: z.array(z.unknown()) }))
      .parse(
        JSON.parse(
          await command("gh", [
            "api",
            "--paginate",
            "--slurp",
            `repos/${repository}/actions/runs/${runId}/attempts/${positive.parse(run.run_attempt)}/jobs?per_page=100`,
          ]),
        ),
      );
    const release = await api(`releases/tags/rea-agents-${version}`);
    const tagSha = await command("git", [
      "rev-parse",
      "--verify",
      `refs/tags/rea-agents-${version}^{commit}`,
    ]);
    const selection = selectRecoveryRelease({
      repository,
      version,
      run,
      jobs: pages.flatMap((page) => page.jobs),
      release,
      tagSha,
    });
    await appendFile(
      z.string().min(1).parse(process.env.GITHUB_OUTPUT),
      Object.entries(selection)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
    process.stdout.write(`${JSON.stringify(selection)}\n`);
    return;
  }
  const sourceDirectory = z
    .string()
    .min(1)
    .parse(process.env.RECOVERY_SOURCE_DIRECTORY);
  const sourceSha = sha.parse(process.env.RECOVERY_SOURCE_SHA);
  if (
    (await command("git", ["rev-parse", "HEAD"], sourceDirectory)) !== sourceSha
  )
    throw new Error("Recovery checkout differs from the released source");
  z.object({ version: z.literal(version) }).parse(
    JSON.parse(await readFile(join(sourceDirectory, "package.json"), "utf8")),
  );
  const integrity = z
    .string()
    .parse(
      JSON.parse(
        await command("npm", [
          "view",
          `rea-agents@${version}`,
          "dist.integrity",
          "--json",
          "--registry=https://registry.npmjs.org",
        ]),
      ),
    );
  const result = await verifyRecoveryPackage({
    directory: z.string().min(1).parse(process.env.RECOVERY_ARTIFACT_DIRECTORY),
    sourceSha,
    runId,
    runAttempt: positive.parse(process.env.RECOVERY_RUN_ATTEMPT),
    version,
    integrity,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
