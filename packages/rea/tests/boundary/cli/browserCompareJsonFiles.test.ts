import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { describe, expect } from "vitest";

import { createWebScreenshotArtifact } from "../../../src/domain/webScreenshot.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const INTEGRATION_TEST_TIMEOUT_MS = 60_000;
// Linux limits one argument to 128 KiB and macOS all arguments to 1 MiB.
const COMMAND_LINE_LIMIT_BYTES = 1024 * 1024;

const pngChunk = (type: string, data: Buffer): Buffer => {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
};

/** An incompressible RGB PNG whose artifact JSON exceeds command-line limits. */
const noisePng = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Array.from({ length: height }, () =>
    Buffer.concat([Buffer.of(0), randomBytes(width * 3)]),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

describe("browser comparison JSON file inputs", () => {
  cliTest(
    "compares screenshot artifacts too large for a command-line argument",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-screenshot-files-");
      const artifact = JSON.stringify(
        createWebScreenshotArtifact(noisePng(640, 640)),
      );
      expect(Buffer.byteLength(artifact)).toBeGreaterThan(
        COMMAND_LINE_LIMIT_BYTES,
      );
      const before = join(root, "before.json");
      const after = join(root, "after.json");
      await writeFile(before, artifact);
      await writeFile(after, artifact);

      const comparison = await cli.run({
        arguments: ["compare-web-screenshots", before, after, "--json"],
        environment: process.env,
      });
      expect(comparison.exitCode, comparison.stderr).toBe(0);
      expect(comparison.signal).toBeNull();
      expect(comparison.json).toMatchObject({
        operation: "compare_web_screenshots",
        normalized_result: { status: "identical", changed_pixels: 0 },
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  cliTest(
    "reports which screenshot artifact failed validation",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-screenshot-invalid-");
      const valid = createWebScreenshotArtifact(noisePng(2, 2));
      const before = join(root, "before.json");
      await writeFile(before, JSON.stringify({ ...valid, bytes: 1 }));

      const invalidArtifact = await cli.run({
        arguments: [
          "compare-web-screenshots",
          before,
          JSON.stringify(valid),
          "--json",
        ],
        environment: process.env,
      });
      expect(invalidArtifact.exitCode, invalidArtifact.stderr).toBe(1);
      expect(invalidArtifact.signal).toBeNull();
      expect(invalidArtifact.json).toMatchObject({
        error: "Browser observation failed",
        code: "invalid_request",
        details: {
          operation: "compare_web_screenshots",
          issues: [
            {
              path: ["before"],
              message: "Screenshot artifact digest or size mismatch",
            },
          ],
        },
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  cliTest(
    "reports malformed PNG chunks as invalid input and valid unsupported PNGs as unsupported targets",
    async ({ cli }) => {
      await assertPngInputErrorProjections(cli);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  cliTest(
    "identifies a missing capture file instead of reporting malformed JSON",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-capture-missing-");
      const missing = join(root, "before.json");

      const missingCapture = await cli.run({
        arguments: ["compare-web-captures", missing, "{}", "--json"],
        environment: process.env,
      });
      expect(missingCapture.exitCode, missingCapture.stderr).toBe(1);
      expect(missingCapture.signal).toBeNull();
      expect(missingCapture.json).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "compare_web_captures",
          issues: [
            {
              reason: "invalid_value",
              message: expect.stringContaining(`(ENOENT): ${missing}`),
            },
          ],
        },
        input_path: missing,
        input_reason: "read-failed",
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});

const assertPngInputErrorProjections = async (cli: TestCli): Promise<void> => {
  const damagedBytes = noisePng(1, 1);
  damagedBytes[29] = (damagedBytes[29] ?? 0) ^ 1;
  const damaged = JSON.stringify(createWebScreenshotArtifact(damagedBytes));
  const damagedPng = await cli.run({
    arguments: ["compare-web-screenshots", damaged, damaged, "--json"],
    environment: process.env,
  });
  expect(damagedPng.exitCode, damagedPng.stderr).toBe(1);
  expect(damagedPng.signal).toBeNull();
  expect(damagedPng.json).toMatchObject({
    code: "invalid_request",
    details: {
      operation: "compare_web_screenshots",
      issues: [
        { path: [], reason: "invalid_format", message: expect.any(String) },
      ],
    },
  });

  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const malformedDeflate = JSON.stringify(
    createWebScreenshotArtifact(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", Buffer.from("bad")),
        pngChunk("IEND", Buffer.alloc(0)),
      ]),
    ),
  );
  const malformedDeflatePng = await cli.run({
    arguments: [
      "compare-web-screenshots",
      malformedDeflate,
      malformedDeflate,
      "--json",
    ],
    environment: process.env,
  });
  expect(malformedDeflatePng.exitCode, malformedDeflatePng.stderr).toBe(1);
  expect(malformedDeflatePng.signal).toBeNull();
  expect(malformedDeflatePng.json).toMatchObject({
    code: "invalid_request",
    details: {
      operation: "compare_web_screenshots",
      issues: [{ path: [], reason: "invalid_format" }],
    },
  });

  const grayscaleHeader = Buffer.alloc(13);
  grayscaleHeader.writeUInt32BE(1, 0);
  grayscaleHeader.writeUInt32BE(1, 4);
  grayscaleHeader.set([8, 0, 0, 0, 0], 8);
  const grayscale = JSON.stringify(
    createWebScreenshotArtifact(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", grayscaleHeader),
        pngChunk("IDAT", deflateSync(Buffer.from([0, 30]))),
        pngChunk("IEND", Buffer.alloc(0)),
      ]),
    ),
  );
  const unsupportedPng = await cli.run({
    arguments: ["compare-web-screenshots", grayscale, grayscale, "--json"],
    environment: process.env,
  });
  expect(unsupportedPng.exitCode, unsupportedPng.stderr).toBe(1);
  expect(unsupportedPng.signal).toBeNull();
  expect(unsupportedPng.json).toMatchObject({
    code: "unsupported_target",
    details: { operation: "compare_web_screenshots" },
  });

  const oversizedHeader = Buffer.alloc(13);
  oversizedHeader.writeUInt32BE(0x7fffffff, 0);
  oversizedHeader.writeUInt32BE(1, 4);
  oversizedHeader.set([8, 6, 0, 0, 0], 8);
  const hugeDimensions = JSON.stringify(
    createWebScreenshotArtifact(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", oversizedHeader),
        pngChunk("IDAT", deflateSync(Buffer.from([0]))),
        pngChunk("IEND", Buffer.alloc(0)),
      ]),
    ),
  );
  const oversizedPng = await cli.run({
    arguments: [
      "compare-web-screenshots",
      hugeDimensions,
      hugeDimensions,
      "--json",
    ],
    environment: process.env,
  });
  expect(oversizedPng.exitCode, oversizedPng.stderr).toBe(1);
  expect(oversizedPng.signal).toBeNull();
  expect(oversizedPng.json).toMatchObject({
    code: "resource_constraint",
    details: {
      operation: "compare_web_screenshots",
      resource: "memory",
      reported_limits: {
        maximum_working_memory_bytes: 256 * 1024 * 1024,
        estimated_working_memory_bytes: "34359738499",
        before_dimensions: { width: 0x7fffffff, height: 1 },
        after_dimensions: { width: 0x7fffffff, height: 1 },
      },
    },
  });
};
