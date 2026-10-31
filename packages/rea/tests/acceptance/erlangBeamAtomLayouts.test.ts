import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { erlangBeamChunksFixture } from "../../src/erlang/Beam.fixture.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "uses the selected BEAM atom chunk's own count and length encoding",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-atom-layouts-");
    const { call } = await connectLocalToolsMcp();
    const compact = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x20, 0x61, 0x62]);
    const oldLayout = Buffer.from([0, 0, 0, 1, 2, 0x61, 0x62]);
    const truncated = Buffer.from([0, 0, 0, 1, 0x20, 0x61, 0x62]);
    for (const { name, chunk, bytes, valid, encoding } of [
      { name: "legacy-negative", chunk: "Atom", bytes: compact, valid: false },
      {
        name: "legacy-truncated",
        chunk: "Atom",
        bytes: truncated,
        valid: false,
      },
      {
        name: "legacy-valid",
        chunk: "Atom",
        bytes: oldLayout,
        valid: true,
        encoding: "latin1",
      },
      {
        name: "utf8-old",
        chunk: "AtU8",
        bytes: oldLayout,
        valid: true,
        encoding: "utf8",
      },
      {
        name: "utf8-compact",
        chunk: "AtU8",
        bytes: compact,
        valid: true,
        encoding: "utf8",
      },
    ]) {
      const path = join(root, `${name}.beam`);
      await writeFile(path, erlangBeamChunksFixture([[chunk, bytes]]));
      const output = await cli.run({
        arguments: ["inspect-erlang-beam", path, "--json"],
      });
      const reply = await call("inspect_erlang_beam", { path });
      if (!valid) {
        expect(output.exitCode, name).toBe(1);
        expect(output.json, name).toMatchObject({
          code: "invalid_request",
          details: {
            issues: [expect.objectContaining({ reason: "invalid_format" })],
          },
        });
        expect(reply.isError, name).toBe(true);
      } else {
        expect(output.exitCode, `${name}: ${output.stderr}`).toBe(0);
        expect(output.json, name).toMatchObject({
          normalized_result: {
            module: "ab",
            atom_encoding: encoding,
            atoms: [{ index: 1, name: "ab" }],
            coverage: { status: "complete" },
          },
        });
        expect(reply.isError, name).not.toBe(true);
        expect(reply.structuredContent).toMatchObject({
          normalized_result: {
            module: "ab",
            atom_encoding: encoding,
            atoms: [{ index: 1, name: "ab" }],
            coverage: { status: "complete" },
          },
        });
      }
    }
  },
);
