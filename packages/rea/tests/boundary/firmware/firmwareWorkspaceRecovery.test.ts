import { access, chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { firmwareResultSchemas } from "../../../src/domain/firmware/firmwareAnalysis.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import {
  assertFirmwareCleanup,
  firmwareFixture,
} from "../../fixtures/firmware/provider.js";

it.skipIf(process.platform !== "linux" || process.getuid?.() === 0)(
  "retains completed extractions and retries all workspaces without blocking stopped-worker operations",
  async () => {
    const fixture = await firmwareFixture("workspace-cleanup-failure");
    const sourceBytes = await readFile(fixture.path);
    const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    const workspaces = new Set<string>();
    try {
      for (const output of [
        fixture.output,
        join(fixture.root, "second-output"),
      ]) {
        const extracted = await fixture.service.execute("extract_firmware", {
          path: fixture.path,
          output_directory: output,
          range: { offset: 2, length: 4 },
        });
        const workspace = fixture.launches.at(-1)?.cwd;
        if (workspace === undefined)
          throw new Error("Expected owned workspace");
        expect(workspaces.has(workspace)).toBe(false);
        workspaces.add(workspace);
        if (extracted.ok) throw new Error("Expected workspace removal failure");
        expect(extracted.error.cleanupIncomplete).toBe(true);
        const partial = extracted.error.partialObservation;
        if (
          partial === undefined ||
          !("kind" in partial) ||
          partial.kind !== "firmware"
        )
          throw new Error("Expected completed firmware observation");
        expect(partial.provenance).toMatchObject({
          subject: {
            format: "file",
            path: fixture.path,
            sha256: sourceSha256,
          },
          provider: { id: "unblob", version: "26.6.4" },
          raw_result: {
            report: expect.any(Array),
            execution: { exit_code: 0 },
          },
          locations: [{ kind: "file-offset-range", start: 2, end: 6 }],
        });
        const result = firmwareResultSchemas.extract_firmware.parse(
          partial.result,
        );
        expect(result.selection).toEqual({
          offset: 2,
          length: 4,
          sha256: createHash("sha256")
            .update(sourceBytes.subarray(2, 6))
            .digest("hex"),
        });
        const file = result.files[0];
        if (file === undefined)
          throw new Error("Expected published extracted file");
        expect(await readFile(file.path, "utf8")).toBe("firmware=true\n");
        expect(extracted.error.cleanupResources).toContain(workspace);
        await access(workspace);
        const delivered = createToolResultDelivery(
          STDIO_DEFAULT_MAX_BUFFER_SIZE,
        ).toCallToolResult(extracted, toolContract("extract_firmware"));
        expect(delivered.isError).toBe(true);
        expect(delivered.structuredContent).toMatchObject({
          error: {
            details: {
              partial_observation: {
                kind: "firmware",
                result,
                provenance: partial.provenance,
              },
            },
          },
        });

        const inspected = await fixture.service.execute(
          "inspect_firmware_regions",
          {
            path: fixture.path,
          },
        );
        if (!inspected.ok) throw inspected.error;
        expect(inspected.value.subject?.local_path).toBe(fixture.path);
        expect(
          firmwareResultSchemas.inspect_firmware_regions.parse(
            inspected.value.normalized_result,
          ).regions[0]?.signature,
        ).toBe("gzip");
      }
      await expect(fixture.close()).rejects.toMatchObject({
        cleanupResources: expect.arrayContaining([...workspaces]),
      });
      for (const workspace of workspaces) await access(workspace);
    } finally {
      for (const workspace of workspaces)
        await chmod(join(workspace, "cleanup-blocked"), 0o700);
      await fixture.close();
    }
    await assertFirmwareCleanup(fixture.launches);
    expect(Buffer.compare(await readFile(fixture.path), sourceBytes)).toBe(0);
    for (const output of [fixture.output, join(fixture.root, "second-output")])
      expect(await readFile(join(output, "rootfs/config"), "utf8")).toBe(
        "firmware=true\n",
      );
  },
);

it.skipIf(process.platform !== "linux" || process.getuid?.() === 0)(
  "preserves the report failure alongside a workspace removal failure",
  async () => {
    const fixture = await firmwareFixture(
      "workspace-cleanup-failure-malformed",
    );
    let workspace: string | undefined;
    try {
      const failed = await fixture.service.execute("extract_firmware", {
        path: fixture.path,
        output_directory: fixture.output,
      });
      workspace = fixture.launches.at(-1)?.cwd;
      if (failed.ok || workspace === undefined)
        throw new Error("Expected both report and cleanup failures");
      expect(projectAnalysisError(failed.error)).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          diagnostics: {
            primary_error: { code: "unreadable_output" },
            cleanup_error: {
              code: "cleanup_incomplete",
              details: {
                diagnostics: { reason: expect.stringContaining("EACCES") },
              },
            },
          },
          resources: expect.arrayContaining([workspace]),
        },
      });
      await expect(access(fixture.output)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      if (workspace !== undefined)
        await chmod(join(workspace, "cleanup-blocked"), 0o700);
      await fixture.close();
    }
    await assertFirmwareCleanup(fixture.launches);
  },
);
