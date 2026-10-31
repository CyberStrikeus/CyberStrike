import { goBinarySchema } from "../../src/domain/go/goBinary.js";
import { rustBinarySchema } from "../../src/domain/rust/rustBinary.js";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { createGoBinaryFixture } from "../fixtures/go/image.js";
import { createRustImage } from "../fixtures/rust/image.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "preserves classifier-known Hexagon ELF identity through Go and Rust CLI/MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-elf-machine-identity-");
    const { client, call } = await connectLocalToolsMcp();
    for (const language of ["go", "rust"] as const) {
      const operation =
        language === "go" ? "inspect_go_binary" : "inspect_rust_binary";
      const command =
        language === "go" ? "inspect-go-binary" : "inspect-rust-binary";
      for (const item of [
        { machine: 164, architecture: "hexagon", subject: "hexagon" },
        { machine: 62, architecture: "amd64", subject: "x86_64" },
      ]) {
        const bytes =
          language === "go"
            ? createGoBinaryFixture({ omitBuildInfo: true }).bytes
            : createRustImage({
                format: "elf",
                omitSection: true,
                includeRustc: true,
              });
        bytes.writeUInt16LE(item.machine, 18);
        const path = join(root, `${language}-${item.machine}.elf`);
        await writeFile(path, bytes);

        const cliResponse = await cli.run({
          arguments: [command, path, "--json"],
        });
        expect(
          cliResponse.exitCode,
          `${cliResponse.stderr}\n${JSON.stringify(cliResponse.json)}`,
        ).toBe(0);
        const cliEvidence = toolContract(operation).outputSchema.parse(
          cliResponse.json,
        );
        const cliReport =
          language === "go"
            ? goBinarySchema.parse(cliEvidence.normalized_result)
            : rustBinarySchema.parse(cliEvidence.normalized_result);
        expect(cliReport.architecture).toBe(item.architecture);
        expect(cliEvidence.subject?.architecture).toBe(item.subject);

        const mcpResponse = await call(operation, { path });
        expect(mcpResponse.isError, JSON.stringify(mcpResponse)).not.toBe(true);
        const mcpEvidence = toolContract(operation).outputSchema.parse(
          mcpResponse.structuredContent,
        );
        const mcpReport =
          language === "go"
            ? goBinarySchema.parse(mcpEvidence.normalized_result)
            : rustBinarySchema.parse(mcpEvidence.normalized_result);
        expect(mcpReport.architecture).toBe(item.architecture);
        expect(mcpEvidence.subject?.architecture).toBe(item.subject);
      }

      const malformed =
        language === "go"
          ? createGoBinaryFixture({ omitBuildInfo: true }).bytes
          : createRustImage({
              format: "elf",
              omitSection: true,
              includeRustc: true,
            });
      malformed[0] = 0;
      const path = join(root, `${language}-malformed.elf`);
      await writeFile(path, malformed);
      const cliFailure = await cli.run({
        arguments: [command, path, "--json"],
      });
      expect(cliFailure.exitCode).not.toBe(0);
      expect(cliFailure.json).not.toHaveProperty("normalized_result");
      const mcpFailure = await call(operation, { path });
      expect(mcpFailure.isError).toBe(true);
      expect(mcpFailure.structuredContent).toBeUndefined();
    }
    await client.ping();
  },
  30000,
);
