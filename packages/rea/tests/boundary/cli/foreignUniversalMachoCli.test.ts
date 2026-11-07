import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { fat } from "../../../src/domain/binaryTarget.fixture.js";
import { listArchitecturesSchema } from "../../../src/domain/native/nativeInspection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const environment = { REA_LOG_LEVEL: "silent" } as const;

// The one slice of each container below is never the host's architecture.
const foreign =
  process.arch === "arm64"
    ? { name: "x86_64", cpuType: 0x01000007 }
    : { name: "arm64", cpuType: 0x0100000c };

cliTest.skipIf(process.platform !== "darwin")(
  "inventories a universal Mach-O whose only slice is foreign to the host",
  async ({ cli, processes }) => {
    const directory = await createTestTempDirectory("rea-foreign-fat-cli-");
    const thin = join(directory, "thin");
    const universal = join(directory, "universal");
    const compiled = await processes.run(
      "/usr/bin/xcrun",
      [
        "clang",
        "-arch",
        foreign.name,
        resolve("tests/conformance/c/fixture.c"),
        "-o",
        thin,
      ],
      { timeoutMs: 30_000 },
    );
    expect(compiled.exitCode, compiled.stderr).toBe(0);
    const created = await processes.run(
      "/usr/bin/xcrun",
      ["lipo", "-create", thin, "-output", universal],
      { timeoutMs: 30_000 },
    );
    expect(created.exitCode, created.stderr).toBe(0);

    const result = await cli.run({
      arguments: ["list-architectures", universal, "--json"],
      environment,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = z
      .object({
        subject: z.object({ format: z.string() }),
        normalized_result: listArchitecturesSchema,
      })
      .parse(result.json);
    expect(evidence.subject.format).toBe("mach-o-universal");
    expect(evidence.normalized_result.architectures).toMatchObject({
      total: 1,
      exhaustive: true,
      items: [{ name: foreign.name }],
    });
    expect(
      evidence.normalized_result.architectures.items[0]?.file_offset,
    ).toBeGreaterThan(0);
  },
  60_000,
);

cliTest.skipIf(process.platform === "darwin")(
  "admits a universal Mach-O whose only slice is foreign to the host",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-foreign-fat-cli-");
    const universal = join(directory, "universal");
    await writeFile(universal, fat([foreign.cpuType]));

    const result = await cli.run({
      arguments: ["list-architectures", universal, "--json"],
      environment,
    });

    // The target is admitted; only the macOS-only lipo inventory is refused.
    expect(result.exitCode).not.toBe(0);
    expect(result.json).toMatchObject({
      code: "capability_unavailable",
      details: { provider_id: "native-macos", operation: "list_architectures" },
    });
  },
);
