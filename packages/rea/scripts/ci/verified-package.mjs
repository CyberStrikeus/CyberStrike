import { copyFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { valid } from "semver";
import { releaseNpmTag } from "../release-npm-tag.mjs";
import {
  MANIFEST_NAME,
  TARBALL_NAME,
  createVerifiedPackageEnvelope,
  parsePositiveInteger,
  sha256File,
  validateVerifiedPackageEnvelope,
  workflowPackageIdentity,
} from "./qualified-package-envelope.mjs";

/** Qualification owns the exact SemVer and its parsed publication channel. */
export function createVerifiedPackageMetadata({
  sourceSha,
  runId,
  runAttempt,
  platform,
  architecture,
  packageVersion,
  nodeVersion,
}) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha))
    throw new Error("Source SHA must be a full commit SHA");
  return {
    sourceSha,
    runId: parsePositiveInteger(runId, "GITHUB_RUN_ID"),
    runAttempt: parsePositiveInteger(runAttempt, "GITHUB_RUN_ATTEMPT"),
    platform,
    architecture,
    packageVersion,
    nodeVersion,
    releaseTag: releaseNpmTag(packageVersion),
  };
}

function validateReleaseIntent(manifest) {
  if (valid(manifest.packageVersion) !== manifest.packageVersion)
    throw new Error("Verified package manifest has an invalid package version");
  if (
    manifest.schemaVersion === 2 &&
    releaseNpmTag(manifest.packageVersion) !== manifest.releaseTag
  )
    throw new Error("Verified package release tag mismatch");
}

function createVerifiedPackageManifest(metadata) {
  const manifest = createVerifiedPackageEnvelope(metadata);
  validateReleaseIntent(manifest);
  return manifest;
}

/** Write only after qualification and its cleanup have completed. */
export async function writeVerifiedPackageManifest(directory, metadata) {
  const manifest = createVerifiedPackageManifest(metadata);
  await writeFile(
    join(directory, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

/** Retain the exact archive without unpacking or rebuilding it. */
export async function retainVerifiedPackage({
  sourceTarball,
  directory,
  metadata,
}) {
  const tarball = join(directory, TARBALL_NAME);
  await copyFile(sourceTarball, tarball);
  return {
    directory,
    metadata: createVerifiedPackageManifest({
      ...metadata,
      sha256: await sha256File(tarball),
    }),
  };
}

/** Read-only consumers additionally validate SemVer and its qualified channel. */
export async function validateVerifiedPackage(options) {
  const { tarball, manifest } = await validateVerifiedPackageEnvelope(options);
  validateReleaseIntent(manifest);
  return tarball;
}

async function validateFromCli(directory) {
  const expected = await workflowPackageIdentity();
  const tarball = await validateVerifiedPackage({ directory, ...expected });
  if (process.env.GITHUB_OUTPUT === undefined)
    throw new Error(
      "GITHUB_OUTPUT is required to publish the validated tarball path",
    );
  await writeFile(
    process.env.GITHUB_OUTPUT,
    `tarball=${tarball}\nversion=${expected.packageVersion}\n`,
    { encoding: "utf8", flag: "a" },
  );
  process.stdout.write(`${tarball}\n`);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, directory, ...extra] = process.argv.slice(2);
  if (command !== "validate" || directory === undefined || extra.length > 0) {
    process.stderr.write(
      "Usage: node scripts/ci/verified-package.mjs validate <artifact-directory>\n",
    );
    process.exitCode = 2;
  } else await validateFromCli(directory);
}
