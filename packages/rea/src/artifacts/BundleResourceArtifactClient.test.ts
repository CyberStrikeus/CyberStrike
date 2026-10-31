import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "plist";
import { afterEach, expect, it } from "vitest";

import { ArtifactProvider } from "./ArtifactProvider.js";
import type { ResolvedAppBundleResourceRoot } from "../application/AppBundleExecutable.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("returns keyed archive evidence with root provenance and unknown executable identity", async () => {
  const bundlePath = await mkdtemp(join(tmpdir(), "rea-resource-reader-"));
  temporaryDirectories.push(bundlePath);
  await mkdir(join(bundlePath, "Resources"));
  await writeFile(
    join(bundlePath, "Info.plist"),
    '<?xml version="1.0"?><plist><dict/></plist>',
  );
  const archive = build({
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $objects: ["$null", "sample"],
    $top: { root: { UID: 1 } },
  });
  await writeFile(join(bundlePath, "Resources", "Archive.plist"), archive);
  const root: ResolvedAppBundleResourceRoot = {
    callerPath: bundlePath,
    canonicalPath: bundlePath,
    infoPlistPath: join(bundlePath, "Info.plist"),
    layout: "root",
    executableSha256: null,
  };
  const provider = new ArtifactProvider({}, "linux");
  const client = provider.createBundleResourceClient(root);
  const execution = await client.execute("inspect_keyed_archive", {
    path: "Resources/Archive.plist",
  });
  expect(execution.ok).toBe(true);
  if (execution.ok) {
    expect(execution.value.result).toMatchObject({
      target_sha256: null,
      resource_root: {
        caller_path: bundlePath,
        canonical_path: bundlePath,
        executable_sha256: null,
      },
      archive_path: "Resources/Archive.plist",
    });
  }
  expect((await client.close()).ok).toBe(true);
});
