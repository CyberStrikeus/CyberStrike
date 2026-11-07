import { verifyPublishedPackageIntegrity } from "./qualified-package-envelope.mjs";

/** Parse fresh registry state using the channel already owned by qualification. */
export async function readQualifiedNpmRelease(version, tag, request = fetch) {
  if (!["latest", "next"].includes(tag))
    throw new Error("Invalid qualified npm channel");
  const response = await request("https://registry.npmjs.org/rea-agents", {
    headers: {
      Accept: "application/vnd.npm.install-v1+json",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return { status: "absent" };
  if (!response.ok)
    throw new Error(`npm registry lookup failed: HTTP ${response.status}`);
  const metadata = requireRecord(await response.json());
  if (metadata.name !== "rea-agents")
    throw new Error("Unexpected npm package name");
  const versions = requireRecord(metadata.versions);
  const tags = requireRecord(metadata["dist-tags"]);
  if (Object.values(tags).some((value) => typeof value !== "string"))
    throw new Error("Invalid npm dist-tags");
  if (!Object.hasOwn(versions, version)) return { status: "absent" };
  const published = requireRecord(versions[version]);
  const dist = requireRecord(published.dist);
  if (
    published.name !== "rea-agents" ||
    published.version !== version ||
    typeof dist.integrity !== "string" ||
    dist.integrity.length === 0
  )
    throw new Error("Invalid published npm identity or integrity");
  return {
    status: "published",
    integrity: dist.integrity,
    tag,
    taggedVersion: tags[tag] ?? null,
    stableVersion: tags.latest ?? null,
  };
}

function requireRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid npm registry metadata");
  return value;
}

/** Validate content before accepting a previously published or newly visible version. */
export async function requireMatchingNpmRelease(tarball, version, published) {
  if (published.status !== "published")
    throw new Error(`rea-agents@${version} is not published`);
  await verifyPublishedPackageIntegrity(tarball, published.integrity);
  if (published.taggedVersion !== version)
    throw new Error(
      `Expected npm ${published.tag} to select ${version}, observed ${published.taggedVersion ?? "missing"}; refusing to change an existing dist-tag`,
    );
}
