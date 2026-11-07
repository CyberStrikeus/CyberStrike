import { erlangBeamSchema } from "../../src/domain/erlang/beam.js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import {
  erlangBeamChunksFixture,
  erlangBeamFixture,
  erlangBeamLegacyAtomsFixture,
  erlangBeamOtp29Fixture,
} from "../../src/erlang/Beam.fixture.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

const completeBeamEvidenceSchema = toolContract(
  "inspect_erlang_beam",
).outputSchema.safeExtend({ normalized_result: erlangBeamSchema });

const oneAtomBeam = (paddingByte: number): Buffer => {
  const bytes = Buffer.alloc(28);
  bytes.write("FOR1", 0, "latin1");
  bytes.writeUInt32BE(20, 4);
  bytes.write("BEAM", 8, "latin1");
  bytes.write("AtU8", 12, "latin1");
  bytes.writeUInt32BE(6, 16);
  bytes.writeUInt32BE(1, 20);
  bytes[24] = 1;
  bytes[25] = "m".charCodeAt(0);
  bytes[26] = paddingByte;
  bytes[27] = paddingByte === 0 ? 0 : 1;
  return bytes;
};

const extendedFirstAtomLength = (): Buffer => {
  const control = erlangBeamOtp29Fixture();
  const chunkOffset = control.indexOf(Buffer.from("AtU8", "latin1"));
  const payloadOffset = chunkOffset + 8;
  const payloadSize = control.readUInt32BE(chunkOffset + 4);
  const payloadEnd = payloadOffset + payloadSize;
  expect(
    Buffer.compare(
      control.subarray(payloadOffset + 4, payloadOffset + 6),
      Buffer.from([0x08, 0x10]),
    ),
  ).toBe(0);
  const payload = Buffer.concat([
    control.subarray(payloadOffset, payloadOffset + 4),
    Buffer.from([0x18, 0x00, 0x10]),
    control.subarray(payloadOffset + 6, payloadEnd),
  ]);
  const paddingBytes = (4 - (payload.length % 4)) % 4;
  const chunkHeader = Buffer.from(control.subarray(chunkOffset, payloadOffset));
  chunkHeader.writeUInt32BE(payload.length, 4);
  const suffixOffset = payloadEnd + ((4 - (payloadSize % 4)) % 4);
  const extended = Buffer.concat([
    control.subarray(0, chunkOffset),
    chunkHeader,
    payload,
    Buffer.alloc(paddingBytes),
    control.subarray(suffixOffset),
  ]);
  extended.writeUInt32BE(extended.length - 8, 4);
  return extended;
};

cliTest(
  "reports BEAM tables and code through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-cli-");
    const path = join(root, "app.beam");
    await writeFile(path, erlangBeamFixture("cli_mod"));
    const result = await cli.run({
      arguments: ["inspect-erlang-beam", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = completeBeamEvidenceSchema.parse(result.json);
    expect(evidence).toMatchObject({
      confidence: "observed",
      subject: { local_path: path, format: "file" },
    });
    expect(evidence.normalized_result).toMatchObject({
      atom_encoding: "utf8",
      module: "cli_mod",
      atoms: [
        { name: "cli_mod" },
        { name: "module_info" },
        { name: "start" },
        { name: "erlang" },
        { name: "get_module_info" },
      ],
      lambdas: [
        expect.objectContaining({
          function: "start",
          arity: 1,
          label: 4,
          old_unique: 42,
        }),
      ],
      code: {
        instruction_set: 0,
        opcode_max: 169,
        labels: 4,
        functions: 2,
        extra_header_bytes: 0,
        instructions: { bytes: 4 },
      },
    });
    expect(evidence.normalized_result.exports).toEqual([
      { function_index: 3, function: "start", arity: 0, label: 2 },
      { function_index: 2, function: "module_info", arity: 0, label: 1 },
      { function_index: 2, function: "module_info", arity: 1, label: 3 },
    ]);
    expect(evidence.normalized_result.imports).toEqual([
      {
        module_index: 4,
        module: "erlang",
        function_index: 5,
        function: "get_module_info",
        arity: 1,
      },
    ]);
    expect(
      evidence.normalized_result.chunks.map((chunk) => chunk.name),
    ).toEqual(["AtU8", "Code", "ExpT", "ImpT", "FunT"]);
  },
);

cliTest(
  "inspects empty optional BEAM chunks through CLI and MCP without losing source evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-empty-chunks-");
    // Append an inert chunk to the compiler fixture; no bytecode is executed.
    const original = erlangBeamOtp29Fixture();
    const extension = erlangBeamChunksFixture([["FunT", Buffer.alloc(0)]]);
    const emptyLambda = Buffer.concat([original, extension.subarray(12)]);
    emptyLambda.writeUInt32BE(emptyLambda.length - 8, 4);
    const { call } = await connectLocalToolsMcp();
    for (const {
      label,
      bytes,
      chunk,
      module,
      atomEncoding,
      exportedFunction,
    } of [
      {
        label: "lambda",
        bytes: emptyLambda,
        chunk: "FunT",
        module: "rea_beam_fixture",
        atomEncoding: "utf8",
        exportedFunction: "hello",
      },
      // This reduced legacy container asserts structural facts, not runtime loading.
      {
        label: "legacy-atoms",
        bytes: erlangBeamLegacyAtomsFixture(Buffer.alloc(0)),
        chunk: "AtU8",
        module: "demo",
        atomEncoding: "latin1",
        exportedFunction: "ÿ",
      },
    ]) {
      const path = join(root, `${label}.beam`);
      await writeFile(path, bytes);
      const output = await cli.run({
        arguments: ["inspect-erlang-beam", path, "--json"],
      });
      expect(output.exitCode, output.stderr).toBe(0);
      const report = completeBeamEvidenceSchema.parse(
        output.json,
      ).normalized_result;
      const reply = await call("inspect_erlang_beam", { path });
      expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
      expect(
        completeBeamEvidenceSchema.parse(reply.structuredContent)
          .normalized_result,
      ).toEqual(report);
      expect(report).toMatchObject({
        module,
        atom_encoding: atomEncoding,
        lambdas: null,
        coverage: { status: "complete" },
        artifact: {
          path,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      });
      expect(report.exports).toContainEqual(
        expect.objectContaining({ function: exportedFunction }),
      );
      expect(report.chunks).toContainEqual(
        expect.objectContaining({
          name: chunk,
          payload: expect.objectContaining({
            bytes: 0,
            sha256: createHash("sha256").update(Buffer.alloc(0)).digest("hex"),
          }),
        }),
      );
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    }
  },
);

cliTest(
  "decodes the last atom table while retaining every chunk occurrence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-repeated-atoms-");
    const original = erlangBeamOtp29Fixture();
    const decoy = oneAtomBeam(0).subarray(12);
    const repeated = Buffer.concat([
      original.subarray(0, 12),
      decoy,
      original.subarray(12),
    ]);
    repeated.writeUInt32BE(repeated.length - 8, 4);
    const path = join(root, "repeated.beam");
    await writeFile(path, repeated);
    const result = await cli.run({
      arguments: ["inspect-erlang-beam", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const report = completeBeamEvidenceSchema.parse(
      result.json,
    ).normalized_result;
    expect(report.module).toBe("rea_beam_fixture");
    expect(report.exports).toContainEqual({
      function_index: 2,
      function: "hello",
      arity: 1,
      label: 2,
    });
    const atomChunks = report.chunks.filter(({ name }) => name === "AtU8");
    expect(atomChunks).toHaveLength(2);
    expect(atomChunks[0]?.payload.sha256).toBe(
      createHash("sha256").update(decoy.subarray(8, 14)).digest("hex"),
    );
    expect(atomChunks[1]?.payload.sha256).toBe(
      createHash("sha256")
        .update(original.subarray(20, 20 + original.readUInt32BE(16)))
        .digest("hex"),
    );
    expect(atomChunks[0]?.payload.location.offset).toBe(20);
    expect(atomChunks[1]?.payload.location.offset).toBe(20 + decoy.length);
    expect(report.coverage.status).toBe("complete");
  },
);

cliTest(
  "inspects an OTP 29 BEAM with an extended compact atom length and preserves source identity",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-extended-atom-");
    const controlPath = join(root, "control.beam");
    const extendedPath = join(root, "extended.beam");
    const controlBytes = erlangBeamOtp29Fixture();
    const extendedBytes = extendedFirstAtomLength();
    await writeFile(controlPath, controlBytes);
    await writeFile(extendedPath, extendedBytes);

    const inspect = async (path: string) => {
      const result = await cli.run({
        arguments: ["inspect-erlang-beam", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      return completeBeamEvidenceSchema.parse(result.json);
    };
    const control = await inspect(controlPath);
    const extended = await inspect(extendedPath);
    // Golden facts from beam_lib:chunks/2 on the compiler-produced OTP 29 file.
    expect(control.normalized_result.module).toBe("rea_beam_fixture");
    expect(control.normalized_result.atoms?.map((atom) => atom.name)).toEqual([
      "rea_beam_fixture",
      "hello",
      "lists",
      "reverse",
      "module_info",
      "erlang",
      "get_module_info",
    ]);
    expect(control.normalized_result.exports).toEqual([
      { function_index: 5, function: "module_info", arity: 1, label: 6 },
      { function_index: 5, function: "module_info", arity: 0, label: 4 },
      { function_index: 2, function: "hello", arity: 1, label: 2 },
    ]);
    expect(
      control.normalized_result.imports?.map((row) => [
        row.module,
        row.function,
        row.arity,
      ]),
    ).toEqual([
      ["lists", "reverse", 1],
      ["erlang", "get_module_info", 1],
      ["erlang", "get_module_info", 2],
    ]);
    expect(control.normalized_result.code).toMatchObject({
      instruction_set: 0,
      opcode_max: 181,
      labels: 7,
      functions: 3,
      extra_header_bytes: 0,
      instructions: { bytes: 49 },
    });
    expect(extended.normalized_result.module).toBe("rea_beam_fixture");
    expect(extended.normalized_result.atoms).toEqual(
      control.normalized_result.atoms,
    );
    expect(extended.normalized_result.exports).toEqual(
      control.normalized_result.exports,
    );
    expect(extended.normalized_result.imports).toEqual(
      control.normalized_result.imports,
    );
    expect(extended.normalized_result.artifact.bytes).toBe(
      control.normalized_result.artifact.bytes,
    );
    expect(extended.normalized_result.artifact.sha256).not.toBe(
      control.normalized_result.artifact.sha256,
    );
    for (const [evidence, bytes] of [
      [control, controlBytes],
      [extended, extendedBytes],
    ] as const) {
      expect(evidence.normalized_result.chunks[0]?.payload.sha256).toBe(
        createHash("sha256")
          .update(bytes.subarray(20, 20 + bytes.readUInt32BE(16)))
          .digest("hex"),
      );
    }
  },
);

cliTest(
  "inspects BEAM chunks with nonzero alignment padding and preserves payload identity",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-padding-");
    const cleanPath = join(root, "padding-zero.beam");
    const paddedPath = join(root, "padding-nonzero.beam");
    await writeFile(cleanPath, oneAtomBeam(0));
    await writeFile(paddedPath, oneAtomBeam(0x7f));

    const inspect = async (path: string) => {
      const result = await cli.run({
        arguments: ["inspect-erlang-beam", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      return completeBeamEvidenceSchema.parse(result.json);
    };
    const clean = await inspect(cleanPath);
    const padded = await inspect(paddedPath);
    expect(padded.normalized_result.module).toBe("m");
    expect(padded.normalized_result.chunks).toEqual(
      clean.normalized_result.chunks,
    );
    expect(padded.normalized_result.artifact.bytes).toBe(
      clean.normalized_result.artifact.bytes,
    );
    expect(padded.normalized_result.artifact.sha256).not.toBe(
      clean.normalized_result.artifact.sha256,
    );
  },
);

cliTest(
  "inspects the declared BEAM form while retaining trailing bytes in artifact identity",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-trailer-");
    const controlPath = join(root, "control.beam");
    const trailingPath = join(root, "trailing.beam");
    const formBytes = erlangBeamOtp29Fixture();
    const trailer = Buffer.from("note");
    await writeFile(controlPath, formBytes);
    await writeFile(trailingPath, Buffer.concat([formBytes, trailer]));

    const inspect = async (path: string) => {
      const result = await cli.run({
        arguments: ["inspect-erlang-beam", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      return completeBeamEvidenceSchema.parse(result.json);
    };
    const control = await inspect(controlPath);
    const trailing = await inspect(trailingPath);
    expect(trailing.normalized_result.form).toEqual(
      control.normalized_result.form,
    );
    expect(trailing.normalized_result.chunks).toEqual(
      control.normalized_result.chunks,
    );
    expect(trailing.normalized_result.exports).toEqual(
      control.normalized_result.exports,
    );
    expect(trailing.normalized_result.artifact.bytes).toBe(
      formBytes.length + trailer.length,
    );
    expect(trailing.normalized_result.artifact.sha256).not.toBe(
      control.normalized_result.artifact.sha256,
    );
    expect(trailing.normalized_result.form.location.bytes).toBe(
      formBytes.length,
    );
  },
);

cliTest(
  "rejects a BEAM chunk whose required alignment bytes are truncated",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-padding-short-");
    const path = join(root, "padding-truncated.beam");
    const bytes = oneAtomBeam(0x7f).subarray(0, 27);
    bytes.writeUInt32BE(19, 4);
    await writeFile(path, bytes);
    const result = await cli.run({
      arguments: ["inspect-erlang-beam", path, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: { operation: "inspect_erlang_beam" },
    });
  },
);

cliTest(
  "resolves a relative BEAM path against the working directory",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-cli-rel-");
    await writeFile(join(root, "app.beam"), erlangBeamFixture());
    const result = await cli.run({
      arguments: ["inspect-erlang-beam", "app.beam", "--json"],
      cwd: root,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = completeBeamEvidenceSchema.parse(result.json);
    expect(evidence.subject?.local_path).toBe(join(root, "app.beam"));
  },
);

cliTest("rejects an empty BEAM path before reading", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-beam-cli-path-");
  const result = await cli.run({
    arguments: ["inspect-erlang-beam", "", "--json"],
    cwd: root,
  });
  expect(result.exitCode, result.stderr).not.toBe(0);
  expect(result.stdout).not.toContain("sha256");
});

cliTest("reports a truncated BEAM as invalid input", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-beam-cli-bad-");
  const path = join(root, "broken.beam");
  await writeFile(path, Buffer.from("FOR1"));
  const result = await cli.run({
    arguments: ["inspect-erlang-beam", path, "--json"],
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "invalid_request",
    details: { operation: "inspect_erlang_beam" },
  });
});
