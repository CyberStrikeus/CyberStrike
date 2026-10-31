import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { parseEvidence } from "../../src/domain/evidence.js";
import { inspectMachoSchema } from "../../src/domain/native/nativeInspection.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.skipIf(process.platform !== "darwin")(
  "inspects a Mach-O whose filename ends in parentheses with real otool",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-parenthesized-macho-");
    const target = join(root, "Example (Beta)");
    const temporary = join(root, "temp");
    await mkdir(temporary);
    await copyFile("/usr/bin/true", target);
    const original = await readFile(target);
    const result = await cli.run({
      arguments: ["inspect-macho", target, "--json"],
      environment: {
        TMPDIR: temporary,
        ...(process.env.DEVELOPER_DIR === undefined
          ? {}
          : { DEVELOPER_DIR: process.env.DEVELOPER_DIR }),
      },
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = parseEvidence(result.json);
    expect(evidence.caller_input_path).toBe(target);
    expect(evidence.subject?.local_path).toBe(target);
    const inspected = inspectMachoSchema.parse(evidence.normalized_result);
    const operand = inspected.provenance
      .flatMap(({ command }) => command)
      .find((argument) => argument.includes("rea-macho-operand-"));
    expect(operand).toEqual(expect.any(String));
    if (operand === undefined) throw new Error("missing otool operand");
    await expect(stat(operand)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readFile(target)).equals(original)).toBe(true);
  },
);
