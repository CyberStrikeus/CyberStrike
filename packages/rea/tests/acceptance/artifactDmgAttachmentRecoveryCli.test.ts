import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { expect } from "vitest";

import {
  NativeDmgArtifactReader,
  DMG_EXISTING_ATTACHMENT_RECOVERY,
} from "../../src/artifacts/NativeDmgArtifactReader.js";
import { parseNativeDmgInfo } from "../../src/artifacts/NativeDmgOwnership.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.skipIf(process.platform !== "darwin")(
  "DMG recovery preserves the caller's real attachment and succeeds after its owner releases it",
  async ({ cli, processes }) => {
    const root = await createTestTempDirectory("rea-dmg-attachment-recovery-");
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "fixture.txt"), "caller-owned image\n");
    const image = join(root, "fixture.dmg");
    const created = await processes.run(
      "/usr/bin/hdiutil",
      [
        "create",
        "-quiet",
        "-srcfolder",
        source,
        "-volname",
        "ReaRecoveryFixture",
        "-size",
        "20m",
        "-format",
        "UDZO",
        image,
      ],
      { timeoutMs: 30_000 },
    );
    expect(created.exitCode, created.stderr).toBe(0);
    const digest = createHash("sha256")
      .update(await readFile(image))
      .digest("hex");
    const resolvedImage = await realpath(image);
    const owner = new NativeDmgArtifactReader(image, process.env);
    let mountRoot: string | undefined;
    const attachedImages = async () => {
      const info = await processes.run("/usr/bin/hdiutil", ["info", "-plist"], {
        timeoutMs: 10_000,
      });
      expect(info.exitCode, info.stderr).toBe(0);
      return parseNativeDmgInfo(info.stdout).images;
    };
    const attachedImagePaths = async () =>
      Promise.all(
        (await attachedImages()).map((entry) =>
          entry["image-path"] === undefined
            ? undefined
            : realpath(entry["image-path"]).catch(() => undefined),
        ),
      );
    const mountedDevices = async (): Promise<string[]> =>
      (await attachedImages())
        .flatMap((entry) => entry["system-entities"])
        .filter(
          (entry) =>
            mountRoot !== undefined &&
            entry["mount-point"]?.startsWith(`${mountRoot}${sep}`),
        )
        .map((entry) => entry["dev-entry"])
        .sort();
    try {
      const entries: string[] = [];
      for await (const entry of owner.entries()) entries.push(entry.path);
      expect(entries.some((path) => path.endsWith("/fixture.txt"))).toBe(true);
      const attach = owner
        .provenance()
        .find((command) => command.arguments[0] === "attach");
      if (attach === undefined)
        throw new Error("Fixture attachment was not recorded");
      mountRoot = attach.arguments[attach.arguments.indexOf("-mountroot") + 1];
      expect(mountRoot).toBeDefined();
      const before = await mountedDevices();
      expect(before.length).toBeGreaterThan(0);
      expect(await attachedImagePaths()).toContain(resolvedImage);
      const busy = await cli.run({
        arguments: ["inspect-artifact", image, "--json"],
        timeoutMs: 30_000,
      });
      expect(busy.exitCode, busy.stdout).toBe(1);
      expect(busy.json).toMatchObject({
        code: "artifact_operation_failed",
        category: "unavailable",
        message: DMG_EXISTING_ATTACHMENT_RECOVERY,
        remediation: {
          action: DMG_EXISTING_ATTACHMENT_RECOVERY,
        },
        details: {
          reason: "unavailable",
          partial_observation: {
            kind: "artifact-inventory",
            inventory: {
              manifest: { root_sha256: digest, root_format: "dmg" },
              coverage: { status: "unknown" },
              occurrences: [{ logical_path: "." }],
              provenance: expect.arrayContaining([
                expect.objectContaining({
                  arguments: expect.arrayContaining(["attach", image]),
                  exit_code: 1,
                }),
              ]),
            },
          },
        },
      });
      expect(await mountedDevices()).toEqual(before);
    } finally {
      await owner.close();
    }
    expect(await mountedDevices()).toEqual([]);
    const control = await cli.run({
      arguments: ["inspect-artifact", image, "--json"],
      timeoutMs: 30_000,
    });
    expect(control.exitCode, control.stdout).toBe(0);
    expect(control.json).toMatchObject({
      normalized_result: {
        substeps: [
          {
            operation: "inventory_artifact",
            evidence: {
              normalized_result: {
                manifest: { root_sha256: digest },
                coverage: { scope: "container-entries", status: "complete" },
              },
            },
          },
        ],
      },
    });
    expect(await attachedImagePaths()).not.toContain(resolvedImage);
  },
  60_000,
);
