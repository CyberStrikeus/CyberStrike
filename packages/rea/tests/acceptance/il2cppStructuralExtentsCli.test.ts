import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createIl2cppMetadataFixture } from "../fixtures/il2cpp/metadata.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../support/cli/cliFixture.js";

cliTest(
  "rejects partial IL2CPP table extents through CLI and MCP without a binary",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-il2cpp-extent-");
    const { call } = await connectLocalToolsMcp();
    for (const [version, name] of [
      [31, "genericContainers"],
      [31, "genericParameters"],
      [31, "interfaceOffsets"],
      [39, "genericParameters"],
    ] as const) {
      const fixture = createIl2cppMetadataFixture({
        version,
        genericOwners: true,
      });
      const path = join(root, `${version}-${name}.dat`);
      await writeFile(path, fixture.bytes);
      const intact = await runFileCli(cli, {
        arguments: ["inspect-il2cpp-metadata", path, "--json"],
      });
      expect(intact.exitCode, intact.stderr).toBe(0);

      const damaged = Buffer.from(fixture.bytes);
      damaged.writeInt32LE(
        fixture.section(name).size - 1,
        fixture.header(name, "size"),
      );
      await writeFile(path, damaged);
      const invalid = await runFileCli(cli, {
        arguments: ["inspect-il2cpp-metadata", path, "--json"],
      });
      const expected = {
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["path"],
              reason: "invalid_format",
              message: expect.stringContaining("record-size-mismatch"),
            },
          ],
        },
      };
      expect(invalid.exitCode).toBe(1);
      expect(invalid.json).toMatchObject(expected);
      const result = await call("inspect_il2cpp_metadata", { path });
      expect(result.isError).toBe(true);
      expect(parseMcpToolError(result).error).toMatchObject(expected);
    }
  },
  30000,
);
