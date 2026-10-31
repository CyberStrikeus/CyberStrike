import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateVerifiedPackageEnvelope,
  workflowPackageIdentity,
} from "./qualified-package-envelope.mjs";
import {
  readQualifiedNpmRelease,
  requireMatchingNpmRelease,
} from "./npm-release-state.mjs";

/** Validate the original artifact and fresh registry state on every publisher attempt. */
export async function prepareNpmPublication(request = fetch) {
  const { manifest, tarball } = await validateVerifiedPackageEnvelope({
    directory: ".cache/verified-package",
    ...(await workflowPackageIdentity()),
  });
  const published = await readQualifiedNpmRelease(
    manifest.packageVersion,
    manifest.releaseTag,
    request,
  );
  if (published.status === "published")
    await requireMatchingNpmRelease(
      tarball,
      manifest.packageVersion,
      published,
    );
  if (!process.env.GITHUB_OUTPUT)
    throw new Error("GITHUB_OUTPUT is required for publication intent");
  // Fixed archive path and whitelisted channel; no opaque version enters workflow outputs.
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `tag=${manifest.releaseTag}\npublished=${published.status === "published"}\n`,
  );
}

// The complete import graph intentionally uses only Node built-ins.
// Rehearsal validates SemVer/channel semantics on the same immutable artifact first.
if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await prepareNpmPublication();
