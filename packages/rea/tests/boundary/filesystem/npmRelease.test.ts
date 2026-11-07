import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  readNpmRelease,
  stableUpdateVersion,
  waitForNpmRelease,
} from "../../../scripts/ci/npm-release.mjs";
import { requireMatchingNpmRelease } from "../../../scripts/ci/npm-release-state.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const metadata = (
  version: string,
  integrity: string,
  tags: Record<string, string>,
) => ({
  name: "rea-agents",
  versions: { [version]: { name: "rea-agents", version, dist: { integrity } } },
  "dist-tags": tags,
});

it("accepts existing registry bytes only when content and selected channel match", async () => {
  const root = await createTestTempDirectory("rea-npm-release-");
  const tarball = join(root, "package.tgz");
  const archive = "qualified archive";
  await writeFile(tarball, archive);
  const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  const published = await readNpmRelease("6.5.0", async () =>
    Response.json(metadata("6.5.0", integrity, { latest: "6.5.0" })),
  );
  await expect(
    requireMatchingNpmRelease(tarball, "6.5.0", published),
  ).resolves.toBeUndefined();
  expect(stableUpdateVersion("6.5.0", published)).toBe("6.5.0");
  if (published.status !== "published")
    throw new Error("Fixture release is absent");
  await expect(
    requireMatchingNpmRelease(tarball, "6.5.0", {
      ...published,
      integrity: "sha512-wrong",
    }),
  ).rejects.toThrow("npm integrity differs");
  await expect(
    requireMatchingNpmRelease(tarball, "6.5.0", {
      ...published,
      taggedVersion: "6.6.0",
    }),
  ).rejects.toThrow("refusing to change");
});

it("keeps prerelease verification on next and the updater on stable latest", async () => {
  const published = await readNpmRelease("6.6.0-rc.1", async () =>
    Response.json(
      metadata("6.6.0-rc.1", "sha512-candidate", {
        latest: "6.5.0",
        next: "6.6.0-rc.1",
      }),
    ),
  );
  expect(published).toMatchObject({ tag: "next", taggedVersion: "6.6.0-rc.1" });
  expect(stableUpdateVersion("6.6.0-rc.1", published)).toBe("6.5.0");
  if (published.status !== "published")
    throw new Error("Fixture release is absent");
  expect(() =>
    stableUpdateVersion("6.6.0-rc.1", {
      ...published,
      stableVersion: "6.6.0-rc.1",
    }),
  ).toThrow("stable release");
});

it("distinguishes absence from failed or malformed registry responses", async () => {
  await expect(
    readNpmRelease(
      "6.5.0",
      async () => new Response("missing", { status: 404 }),
    ),
  ).resolves.toEqual({ status: "absent" });
  await expect(
    readNpmRelease("6.5.0", async () =>
      Response.json({ name: "rea-agents", versions: {}, "dist-tags": {} }),
    ),
  ).resolves.toEqual({ status: "absent" });
  await expect(
    readNpmRelease(
      "6.5.0",
      async () => new Response("failed", { status: 503 }),
    ),
  ).rejects.toThrow("HTTP 503");
  await expect(
    readNpmRelease("6.5.0", async () => Response.json({})),
  ).rejects.toThrow();
  await expect(
    readNpmRelease("6.5.0", async () =>
      Response.json(metadata("6.5.0", "", { latest: "6.5.0" })),
    ),
  ).rejects.toThrow();
});

it("waits only for confirmed propagation absence and does not retry errors", async () => {
  const published = await readNpmRelease("6.5.0", async () =>
    Response.json(metadata("6.5.0", "sha512-target", { latest: "6.5.0" })),
  );
  let calls = 0;
  const pauses: number[] = [];
  await expect(
    waitForNpmRelease(
      "6.5.0",
      async () => (++calls === 1 ? { status: "absent" } : published),
      async (milliseconds) => {
        pauses.push(milliseconds);
      },
    ),
  ).resolves.toEqual(published);
  expect(calls).toBe(2);
  expect(pauses).toEqual([15_000]);
  let failures = 0;
  await expect(
    waitForNpmRelease(
      "6.5.0",
      async () => {
        failures++;
        throw new Error("unavailable");
      },
      async () => {
        throw new Error("must not retry");
      },
    ),
  ).rejects.toThrow("unavailable");
  expect(failures).toBe(1);
});

it.each([
  {
    name: "array versions",
    value: { name: "rea-agents", versions: [], "dist-tags": {} },
  },
  {
    name: "invalid tag facts",
    value: { name: "rea-agents", versions: {}, "dist-tags": { latest: 42 } },
  },
  {
    name: "different package",
    value: { name: "other", versions: {}, "dist-tags": {} },
  },
  { name: "null registry response", value: null },
])("does not turn $name into publication absence", async ({ value }) => {
  await expect(
    readNpmRelease("6.5.0", async () => Response.json(value)),
  ).rejects.toThrow();
});
