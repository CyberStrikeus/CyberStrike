import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "plist";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { scanCanonicalArtifactInventory } from "../../tests/fixtures/artifactInventory.js";
import {
  NativeDmgArtifactReader,
  DMG_EXISTING_ATTACHMENT_RECOVERY,
  type NativeDmgHost,
} from "./NativeDmgArtifactReader.js";
import { translateArtifactFailure } from "./ArtifactOperationFailure.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { analysisErrorUserMessage } from "../domain/analysisErrorPresentation.js";
import { ArtifactOperationError } from "../domain/artifactOperationError.js";

it.each(["same", "other", "missing-path", "no-path", "empty-group"] as const)(
  "retains DMG root facts and limits existing-attachment guidance to a resolved image path: %s",
  async (listed) => {
    const root = await createTestTempDirectory("rea-dmg-unavailable-root-");
    const path = join(root, "image.dmg");
    const bytes = Buffer.alloc(1024);
    bytes.write("koly", bytes.length - 512, "ascii");
    await writeFile(path, bytes);
    const other = join(root, "other.dmg");
    await writeFile(other, bytes);
    const calls: string[] = [];
    const host: NativeDmgHost = {
      run: async (args) => {
        calls.push(args[0] ?? "");
        if (args[0] === "verify") return { stdout: "", exitCode: 0 };
        if (args[0] === "info")
          return {
            stdout: build({
              images: [
                {
                  ...(listed === "no-path"
                    ? {}
                    : {
                        "image-path":
                          listed === "same" || listed === "empty-group"
                            ? path
                            : listed === "other"
                              ? other
                              : join(root, "missing.dmg"),
                      }),
                  "system-entities":
                    listed === "empty-group"
                      ? []
                      : [
                          {
                            "dev-entry": "/dev/disk800",
                            "mount-point": join(root, "preexisting"),
                          },
                        ],
                },
              ],
            }),
            exitCode: 0,
          };
        if (args[0] === "attach")
          return {
            stdout: "",
            stderr: "hdiutil: attach failed - Resource busy",
            exitCode: 1,
          };
        throw new Error(`Unexpected command ${String(args[0])}`);
      },
    };
    let failure: unknown;
    try {
      await scanCanonicalArtifactInventory(
        path,
        {},
        () => new NativeDmgArtifactReader(path, {}, host),
      );
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toBeDefined();
    const projected = projectAnalysisError(
      translateArtifactFailure("inspect_artifact", failure),
    );
    expect(projected).toMatchObject({
      category: "unavailable",
      details: {
        partial_observation: {
          kind: "artifact-inventory",
          inventory: {
            manifest: {
              root_sha256: createHash("sha256").update(bytes).digest("hex"),
              root_format: "dmg",
            },
            coverage: { status: "unknown" },
            occurrences: [{ logical_path: "." }],
            provenance: [
              { arguments: ["verify", path], exit_code: 0 },
              {
                arguments: expect.arrayContaining(["attach", path]),
                exit_code: 1,
              },
            ],
          },
        },
      },
    });
    expect(projected.details?.partial_observation).toEqual(
      expect.objectContaining({ kind: "artifact-inventory" }),
    );
    if (listed === "same") {
      expect(projected.message).toBe(DMG_EXISTING_ATTACHMENT_RECOVERY);
      expect(projected.remediation.action).toBe(
        DMG_EXISTING_ATTACHMENT_RECOVERY,
      );
    } else {
      expect(projected.message).toBe(
        analysisErrorUserMessage(
          new ArtifactOperationError("inspect_artifact", "unavailable"),
        ),
      );
    }
    expect(calls).not.toContain("detach");
  },
);
