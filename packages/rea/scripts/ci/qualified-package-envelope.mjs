import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

export const MANIFEST_NAME = "manifest.json";
export const TARBALL_NAME = "package.tgz";
const execFileAsync = promisify(execFile);
const MANIFEST_KEYS = [
  "schemaVersion",
  "sourceSha",
  "runId",
  "runAttempt",
  "platform",
  "architecture",
  "packageVersion",
  "nodeVersion",
  "releaseTag",
  "sha256",
].sort();

/** Construct the immutable envelope; semantic release intent belongs to qualification. */
export function createVerifiedPackageEnvelope(metadata) {
  const manifest = { schemaVersion: 2, ...metadata };
  validateManifestShape(manifest);
  return manifest;
}

/** Validate a retained package against the current checkout and workflow attempt. */
export async function validateVerifiedPackageEnvelope({
  directory,
  sourceSha,
  runId,
  runAttempt,
  packageVersion,
  nodeVersion,
  allowLegacyManifest = false,
}) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha))
    throw new Error("Expected source SHA must be a full commit SHA");
  if (!Number.isSafeInteger(runId) || runId <= 0)
    throw new Error("Expected workflow run ID must be a positive integer");
  if (!Number.isSafeInteger(runAttempt) || runAttempt <= 0)
    throw new Error("Expected workflow run attempt must be a positive integer");
  const manifestPath = join(directory, MANIFEST_NAME);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read verified package manifest: ${cause}`, {
      cause,
    });
  }
  validateManifestShape(manifest, allowLegacyManifest);
  assertEqual(manifest.sourceSha, sourceSha, "source SHA");
  assertEqual(manifest.runId, runId, "workflow run ID");
  // A successful producer may belong to an earlier attempt when only failed
  // publisher jobs are rerun. The workflow still requires same-run qualification.
  if (manifest.runAttempt > runAttempt)
    throw new Error("Verified package workflow run attempt is from the future");
  assertEqual(manifest.platform, "linux", "verifier platform");
  assertEqual(manifest.architecture, "x64", "verifier architecture");
  assertEqual(manifest.packageVersion, packageVersion, "package version");
  assertEqual(manifest.nodeVersion, nodeVersion, "Node.js version");

  // The artifact format deliberately fixes the name; no manifest value can
  // redirect validation to another path.
  const tarball = resolve(directory, TARBALL_NAME);
  const digest = await sha256File(tarball);
  assertEqual(manifest.sha256, digest, "tarball SHA-256");
  return { tarball, manifest };
}

function validateManifestShape(manifest, allowLegacyManifest = false) {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest)
  )
    throw new Error("Verified package manifest must be a JSON object");
  const legacy = allowLegacyManifest && manifest.schemaVersion === 1;
  const expectedKeys = legacy
    ? MANIFEST_KEYS.filter((key) => key !== "releaseTag")
    : MANIFEST_KEYS;
  const keys = Object.keys(manifest).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  )
    throw new Error("Verified package manifest has missing or unknown fields");
  if (manifest.schemaVersion !== 2 && !legacy)
    throw new Error("Unsupported verified package manifest schema version");
  if (
    typeof manifest.sourceSha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(manifest.sourceSha)
  )
    throw new Error("Verified package manifest has an invalid source SHA");
  if (!Number.isSafeInteger(manifest.runId) || manifest.runId <= 0)
    throw new Error("Verified package manifest has an invalid workflow run ID");
  if (!Number.isSafeInteger(manifest.runAttempt) || manifest.runAttempt <= 0)
    throw new Error(
      "Verified package manifest has an invalid workflow run attempt",
    );
  for (const key of [
    "platform",
    "architecture",
    "packageVersion",
    "nodeVersion",
  ])
    if (typeof manifest[key] !== "string" || manifest[key].length === 0)
      throw new Error(`Verified package manifest has an invalid ${key}`);
  if (!legacy && !["latest", "next"].includes(manifest.releaseTag))
    throw new Error("Verified package manifest has an invalid release tag");
  if (
    typeof manifest.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(manifest.sha256)
  )
    throw new Error("Verified package manifest has an invalid tarball SHA-256");
}

function assertEqual(actual, expected, label) {
  if (actual !== expected)
    throw new Error(`Verified package ${label} mismatch`);
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Require the registry to serve the exact archive selected for publication. */
export async function verifyPublishedPackageIntegrity(tarball, integrity) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(tarball)) hash.update(chunk);
  if (integrity !== `sha512-${hash.digest("base64")}`)
    throw new Error(
      "Published npm integrity differs from the original qualified package",
    );
}

/** Bind each consumer to the checked-out source and the same workflow run. */
export async function workflowPackageIdentity() {
  const sourceSha = process.env.GITHUB_SHA;
  if (sourceSha === undefined || !/^[a-f0-9]{40}$/u.test(sourceSha))
    throw new Error("GITHUB_SHA must be a full commit SHA");
  const checkoutSha = (
    await execFileAsync("git", ["rev-parse", "HEAD"])
  ).stdout.trim();
  assertEqual(checkoutSha, sourceSha, "checked out source SHA");
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  return {
    sourceSha,
    runId: parsePositiveInteger(process.env.GITHUB_RUN_ID, "GITHUB_RUN_ID"),
    runAttempt: parsePositiveInteger(
      process.env.GITHUB_RUN_ATTEMPT,
      "GITHUB_RUN_ATTEMPT",
    ),
    packageVersion: packageJson.version,
    nodeVersion: process.version,
  };
}

export function parsePositiveInteger(value, name) {
  if (value === undefined || !/^[1-9]\d*$/u.test(value))
    throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`${name} must be a safe positive integer`);
  return parsed;
}
