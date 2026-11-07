import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { toolContract } from "../../src/contracts/toolContracts.js";
import { rustBinarySchema } from "../../src/domain/rust/rustBinary.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { expectCliMcpEvidenceParity } from "../fixtures/cliMcpEvidenceParity.js";
import {
  RUSTC_HASH,
  rustElfSectionNameFixture,
} from "../fixtures/rust/image.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "finds compiler paths independently of ELF section names through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-unnamed-sections-");
    const { client, call } = await connectLocalToolsMcp();
    for (const name of ["named", "empty", "unavailable", "writable"] as const) {
      const bytes = rustElfSectionNameFixture(
        name === "writable" ? "empty" : name,
      );
      if (name === "writable") bytes.writeBigUInt64LE(3n, 384 + 8);
      const path = join(root, `${name}.elf`);
      await writeFile(path, bytes);
      const output = await cli.sharedCliRun!({
        arguments: ["inspect-rust-binary", path, "--json"],
      });
      expect(output.exitCode, output.stderr).toBe(0);
      const evidence = toolContract("inspect_rust_binary").outputSchema.parse(
        output.json,
      );
      const report = rustBinarySchema.parse(evidence.normalized_result);
      expect(report.artifact.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      expect(report.auditable_metadata).toBeNull();
      expect(report.rustc_commit).toEqual(
        name === "writable"
          ? null
          : {
              evidence_kind: "inferred",
              hashes: [{ hash: RUSTC_HASH, file_offset: 2048 }],
            },
      );
      if (name === "unavailable")
        expect(report.limitations).toContainEqual(
          expect.stringContaining("no section-name string table is declared"),
        );
      const response = await call("inspect_rust_binary", { path });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expectCliMcpEvidenceParity(evidence, response.structuredContent, path);
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    }
    await client.ping();
  },
);
