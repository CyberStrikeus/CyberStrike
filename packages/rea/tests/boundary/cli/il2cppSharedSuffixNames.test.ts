import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { il2cppMetadataSchema } from "../../../src/domain/il2cpp/il2cppMetadata.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createIl2cppMetadataFixture } from "../../fixtures/il2cpp/metadata.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const parseResult = (value: unknown) =>
  il2cppMetadataSchema.parse(
    toolContract("inspect_il2cpp_metadata").outputSchema.parse(value)
      .normalized_result,
  );

cliTest(
  "decodes shared-suffix IL2CPP names through CLI and MCP",
  async ({ cli }) => {
    const directory = await createTestTempDirectory(
      "rea-il2cpp-shared-suffix-",
    );
    const { call } = await connectLocalToolsMcp();
    for (const version of [29, 39] as const) {
      const fixture = createIl2cppMetadataFixture({
        version,
        typeNames: { 0: "xPlayer" },
      });
      const bytes = Buffer.from(fixture.bytes);
      const nameOffsetLocation = fixture.record("typeDefinitions", 0);
      bytes.writeInt32LE(
        bytes.readInt32LE(nameOffsetLocation) + 1,
        nameOffsetLocation,
      );
      const path = join(directory, `metadata-${version}.dat`);
      await writeFile(path, bytes);

      const cliOutput = await cli.run({
        arguments: ["inspect-il2cpp-metadata", path, "--json"],
        environment: {
          REA_LOG_LEVEL: "silent",
          HOME: directory,
          USERPROFILE: directory,
        },
      });
      expect(cliOutput.exitCode, cliOutput.stderr).toBe(0);
      const cliResult = parseResult(cliOutput.json);
      expect(cliResult.types[0]?.name).toBe("Player");
      expect(cliResult.artifact.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );

      const mcpOutput = await call("inspect_il2cpp_metadata", {
        path,
        detail: "complete",
      });
      expect(mcpOutput.isError, JSON.stringify(mcpOutput)).not.toBe(true);
      const mcpResult = parseResult(mcpOutput.structuredContent);
      expect(mcpResult).toEqual(cliResult);
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    }
  },
);
