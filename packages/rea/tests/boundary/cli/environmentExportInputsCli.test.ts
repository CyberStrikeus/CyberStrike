import {
  appendFile,
  readFile,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect } from "vitest";
import { z } from "zod";

import { nativeJsonParseRequiredBytes } from "../../../src/application/JsonInputFile.js";
import { writeEnvironmentServeFiles } from "../../fixtures/environmentServe.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const probe = pathToFileURL(
  resolve("tests/fixtures/environmentExportInputProbe.mjs"),
).href;

for (const role of ["manifest", "evidence"] as const) {
  cliTest(
    `refuses a real ${role} file changed during its read`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-export-input-race-cli-");
      const files = await writeEnvironmentServeFiles(root);
      const input =
        role === "manifest" ? files.manifestPath : files.capturePath;
      const before = await readFile(input);
      const marker = join(root, "read-marker");
      const directory = join(root, "bundle");
      const result = await cli.run({
        arguments: [
          "environment-export",
          files.manifestPath,
          "--evidence",
          files.capturePath,
          directory,
          "--json",
        ],
        environment: {
          NODE_OPTIONS: `--import=${probe} --max-old-space-size=256`,
          REA_TEST_EXPORT_INPUT: input,
          REA_TEST_EXPORT_READ_MARKER: marker,
          REA_TEST_EXPORT_READ_ACTION: "append",
        },
        timeoutMs: 30_000,
      });
      expect(await readFile(marker, "utf8")).toBe("read");
      expect(
        Buffer.compare(
          await readFile(input),
          Buffer.concat([before, Buffer.from(" ")]),
        ),
      ).toBe(0);
      expect(result.exitCode, result.stderr).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "environment-export",
          issues: [{ path: [role], reason: "invalid_value" }],
        },
      });
      await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
}

const heapRefusalSchema = z.object({
  code: z.literal("resource_constraint"),
  details: z.object({
    operation: z.literal("environment-export"),
    resource: z.literal("memory"),
    reported_limits: z.object({
      input_path: z.string(),
      input_file_bytes: z.number(),
      required_heap_bytes: z.number(),
      available_heap_bytes: z.number(),
    }),
  }),
});

cliTest(
  "admits neither the whole read nor an unbudgeted snapshot under a real heap limit",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-export-input-heap-cli-");
    const files = await writeEnvironmentServeFiles(root);
    const originalBytes = (await stat(files.manifestPath)).size;
    const marker = join(root, "read-marker");
    const directory = join(root, "bundle");
    // Whitespace preserves a valid manifest while making the actual file large.
    await appendFile(files.manifestPath, Buffer.alloc(8 * 1024 * 1024, " "));
    let available: number | undefined;
    for (const phase of ["whole-read", "snapshot"] as const) {
      if (available !== undefined) {
        // Fit the native parse in two thirds of the previous child's real
        // headroom, while the additional snapshot reservation cannot fit.
        const overhead = nativeJsonParseRequiredBytes(0);
        const perByte = nativeJsonParseRequiredBytes(1) - overhead;
        await truncate(
          files.manifestPath,
          Math.max(
            originalBytes,
            Math.floor(((available * 2) / 3 - overhead) / perByte),
          ),
        );
      }
      const result = await cli.run({
        arguments: [
          "environment-export",
          files.manifestPath,
          "--evidence",
          files.capturePath,
          directory,
          "--json",
        ],
        environment: {
          NODE_OPTIONS: `--import=${probe} --max-old-space-size=256`,
          REA_TEST_EXPORT_INPUT: files.manifestPath,
          REA_TEST_EXPORT_READ_MARKER: marker,
          REA_TEST_EXPORT_READ_ACTION: "record",
        },
        timeoutMs: 30_000,
      });
      expect(result.exitCode, result.stderr).toBe(1);
      const limits = heapRefusalSchema.parse(result.json).details
        .reported_limits;
      expect(limits.input_path).toBe(files.manifestPath);
      expect(limits.input_file_bytes).toBe(
        (await stat(files.manifestPath)).size,
      );
      expect(limits.required_heap_bytes).toBe(
        nativeJsonParseRequiredBytes(limits.input_file_bytes, true),
      );
      expect(limits.required_heap_bytes).toBeGreaterThan(
        limits.available_heap_bytes,
      );
      if (phase === "snapshot")
        expect(
          nativeJsonParseRequiredBytes(limits.input_file_bytes),
        ).toBeLessThan(limits.available_heap_bytes);
      else
        expect(
          nativeJsonParseRequiredBytes(limits.input_file_bytes),
        ).toBeGreaterThan(limits.available_heap_bytes);
      available = limits.available_heap_bytes;
      await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    }
  },
);

cliTest(
  "attributes a pathless descriptor failure during the real tarball copy",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-export-copy-read-cli-");
    const files = await writeEnvironmentServeFiles(root);
    const tarball = join(root, "package.tgz");
    await writeFile(tarball, "admitted package");
    const marker = join(root, "read-marker");
    const directory = join(root, "bundle");
    const result = await cli.run({
      arguments: [
        "environment-export",
        files.manifestPath,
        "--evidence",
        files.capturePath,
        directory,
        "--package-tarball",
        tarball,
        "--json",
      ],
      environment: {
        NODE_OPTIONS: `--import=${probe} --max-old-space-size=256`,
        REA_TEST_EXPORT_INPUT: tarball,
        REA_TEST_EXPORT_READ_MARKER: marker,
        REA_TEST_EXPORT_READ_ACTION: "fail-copy",
      },
      timeoutMs: 30_000,
    });
    expect(await readFile(marker, "utf8")).toBe("copy");
    expect(await readFile(tarball, "utf8")).toBe("admitted package");
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.json).toMatchObject({
      code: "unreadable_output",
      details: {
        reason: expect.stringContaining(`reading ${tarball}`),
        diagnostics: { output_directory: directory },
      },
      remediation: { action: expect.stringContaining(tarball) },
    });
    expect(JSON.stringify(result.json)).not.toContain("disk space");
  },
);
