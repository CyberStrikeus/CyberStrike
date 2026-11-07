import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import {
  MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS,
  inspectErlangBeamInputSchema,
} from "../domain/erlang/beam.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  erlangBeamChunksFixture,
  erlangBeamDeclaredRowsFixture,
  erlangBeamFixture,
  erlangBeamLegacyAtomsFixture,
  erlangBeamManyAtomsFixture,
  erlangBeamOtp29Fixture,
} from "./Beam.fixture.js";
import { BeamCapacityFailure, parseErlangBeam } from "./BeamParser.js";
import { BeamProvider } from "./BeamProvider.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";

const defaults = inspectErlangBeamInputSchema.parse({
  path: "/artifacts/app.beam",
});

const parse = (bytes: Buffer, input = defaults) =>
  parseErlangBeam(
    bytes,
    {
      path: input.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
    input,
  );

it("selects the last table and Code payload for every repeated chunk name", () => {
  const original = erlangBeamFixture("selected");
  const decoy = erlangBeamFixture("decoy");
  const changedFields = new Map([
    ["Code", 16],
    ["ExpT", 8],
    ["ImpT", 12],
    ["FunT", 8],
  ]);
  for (let at = 12; at < decoy.length;) {
    const name = decoy.toString("latin1", at, at + 4);
    const size = decoy.readUInt32BE(at + 4);
    const field = changedFields.get(name);
    if (field !== undefined) decoy.writeUInt32BE(9, at + 8 + field);
    at += 8 + size + ((4 - (size % 4)) % 4);
  }
  const repeated = Buffer.concat([
    original.subarray(0, 12),
    decoy.subarray(12),
    original.subarray(12),
  ]);
  repeated.writeUInt32BE(repeated.length - 8, 4);
  const report = parse(repeated);
  const control = parse(original);
  expect(report.atoms).toEqual(control.atoms);
  expect(report.exports).toEqual(control.exports);
  expect(report.imports).toEqual(control.imports);
  expect(report.lambdas).toEqual(control.lambdas);
  expect(report.code).toEqual({
    ...control.code,
    instructions: {
      ...control.code!.instructions,
      offset: control.code!.instructions.offset + decoy.length - 12,
    },
  });
  expect(report.chunks).toHaveLength(control.chunks.length * 2);
});

it("rejects a malformed selected atom table instead of using an earlier table", () => {
  const original = erlangBeamFixture();
  const invalid = erlangBeamChunksFixture([["AtU8", Buffer.from([0])]]);
  const repeated = Buffer.concat([original, invalid.subarray(12)]);
  repeated.writeUInt32BE(repeated.length - 8, 4);
  expect(() => parse(repeated)).toThrow(/truncated/);
});

it("falls back from an empty AtU8 to legacy Atom, while nonempty alternates keep precedence", () => {
  const control = parse(erlangBeamLegacyAtomsFixture());
  const empty = parse(erlangBeamLegacyAtomsFixture(Buffer.alloc(0)));
  expect(empty.atoms).toEqual(control.atoms);
  expect(empty.atom_encoding).toBe("latin1");
  expect(empty.module).toBe("demo");
  expect(empty.exports?.[0]?.function).toBe("ÿ");
  expect(empty.chunks.map(({ name }) => name)).toEqual([
    "Atom",
    "AtU8",
    "ExpT",
  ]);
  expect(empty.chunks[1]?.payload.bytes).toBe(0);
  const alternate = parse(
    erlangBeamLegacyAtomsFixture(
      Buffer.concat([
        Buffer.from([0, 0, 0, 2, 4]),
        Buffer.from("demo"),
        Buffer.from([3]),
        Buffer.from("new"),
      ]),
    ),
  );
  expect(alternate.atom_encoding).toBe("utf8");
  expect(alternate.exports?.[0]?.function).toBe("new");
  const zeroCount = parse(erlangBeamLegacyAtomsFixture(Buffer.alloc(4)));
  expect(zeroCount.atom_encoding).toBe("utf8");
  expect(zeroCount.atoms).toEqual([]);
  expect(zeroCount.exports?.[0]?.function).toBeNull();
});

it.each([Buffer.from([0]), Buffer.from([0, 0, 0, 1])])(
  "rejects a malformed nonempty AtU8 without falling back: %j",
  (payload) => {
    expect(() => parse(erlangBeamLegacyAtomsFixture(payload))).toThrow(
      /truncated/,
    );
  },
);

it.each(["AtU8", "Atom"])(
  "does not turn an empty standalone %s atom table into decoded facts",
  (name) => {
    expect(() =>
      parse(erlangBeamChunksFixture([[name, Buffer.alloc(0)]])),
    ).toThrow(/atom table is truncated/);
  },
);

it("uses the last AtU8 occurrence even when empty", () => {
  const control = erlangBeamLegacyAtomsFixture(Buffer.from([0, 0, 0, 0]));
  const empty = erlangBeamChunksFixture([["AtU8", Buffer.alloc(0)]]);
  const bytes = Buffer.concat([control, empty.subarray(12)]);
  bytes.writeUInt32BE(bytes.length - 8, 4);
  const report = parse(bytes);
  expect(report.atom_encoding).toBe("latin1");
  expect(report.exports?.[0]?.function).toBe("ÿ");
  expect(
    report.chunks
      .filter(({ name }) => name === "AtU8")
      .map(({ payload }) => payload.bytes),
  ).toEqual([4, 0]);
});

it.each([
  { payload: Buffer.alloc(0), expected: null },
  { payload: Buffer.alloc(4), expected: [] },
])(
  "distinguishes empty optional FunT from a zero row count: $payload",
  ({ payload, expected }) => {
    const original = erlangBeamOtp29Fixture();
    const extension = erlangBeamChunksFixture([["FunT", payload]]);
    const bytes = Buffer.concat([original, extension.subarray(12)]);
    bytes.writeUInt32BE(bytes.length - 8, 4);
    const control = parse(original);
    const report = parse(bytes);
    expect(control.lambdas).toBeNull();
    expect(report.lambdas).toEqual(expected);
    expect(report.atoms).toEqual(control.atoms);
    expect(report.exports).toEqual(control.exports);
    expect(report.imports).toEqual(control.imports);
    expect(report.code).toEqual(control.code);
    expect(report.chunks.at(-1)?.payload.bytes).toBe(payload.length);
  },
);

it("does not reuse an earlier FunT when its last occurrence is empty", () => {
  const original = erlangBeamFixture();
  const extension = erlangBeamChunksFixture([["FunT", Buffer.alloc(0)]]);
  const bytes = Buffer.concat([original, extension.subarray(12)]);
  bytes.writeUInt32BE(bytes.length - 8, 4);
  const report = parse(bytes);
  expect(report.lambdas).toBeNull();
  expect(
    report.chunks
      .filter(({ name }) => name === "FunT")
      .map(({ payload }) => payload.bytes),
  ).toEqual([28, 0]);
});

it.each([Buffer.from([0]), Buffer.from([0, 0, 0, 1])])(
  "rejects truncated nonempty FunT payloads: %j",
  (payload) => {
    expect(() => parse(erlangBeamChunksFixture([["FunT", payload]]))).toThrow(
      /lambda table is truncated/,
    );
  },
);

it("accepts extended compact atom lengths and rejects truncated or overflowing values", () => {
  const compactAtom = (length: Buffer, name: Buffer): Buffer =>
    erlangBeamChunksFixture([
      [
        "AtU8",
        Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), length, name]),
      ],
    ]);
  const name = Buffer.from("0123456789abcdef", "ascii");
  const extended = parse(compactAtom(Buffer.from([0x18, 0x00, 0x10]), name));
  expect(extended.module).toBe(name.toString("ascii"));
  expect(() => parse(compactAtom(Buffer.from([0x18, 0x00]), name))).toThrow(
    /BEAM atom table is truncated/,
  );
  expect(() => parse(compactAtom(Buffer.from([0x19]), name))).toThrow(
    /BEAM atom length is not a u tag/,
  );
  expect(() =>
    parse(
      compactAtom(
        Buffer.from([0xd8, 0x80, 0, 0, 0, 0, 0, 0, 0]),
        Buffer.alloc(0),
      ),
    ),
  ).toThrow(/BEAM atom length encoding overflows/);
  expect(() =>
    parse(
      compactAtom(
        Buffer.from([0xf8, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        Buffer.alloc(0),
      ),
    ),
  ).toThrow(/BEAM atom length encoding overflows/);
});

it("fails a truncated FOR1 container without partial success", () => {
  expect(() => parse(Buffer.from("FOR1"))).toThrow(ArtifactReaderFailure);
});

it("fails a FOR1 form that is not BEAM", () => {
  const bytes = Buffer.alloc(16);
  bytes.write("FOR1");
  bytes.writeUInt32BE(8, 4);
  bytes.write("WAVE", 8);
  expect(() => parse(bytes)).toThrow(ArtifactReaderFailure);
});

it("rejects a short remainder inside the BEAM form", () => {
  const bytes = Buffer.alloc(16);
  bytes.write("FOR1");
  bytes.writeUInt32BE(8, 4);
  bytes.write("BEAM", 8);
  expect(() => parse(bytes)).toThrow(/BEAM chunk header is truncated/);
});

it("rejects an AtU8 atom name that is not UTF-8", () => {
  expect(() =>
    parse(
      erlangBeamChunksFixture([["AtU8", Buffer.from([0, 0, 0, 1, 1, 0xff])]]),
    ),
  ).toThrow(/BEAM atom name is not valid UTF-8/);
});

it("keeps a latin1 atom byte unchanged", () => {
  const report = parse(
    erlangBeamChunksFixture([["Atom", Buffer.from([0, 0, 0, 1, 1, 0xff])]]),
  );
  expect(report.atom_encoding).toBe("latin1");
  expect(report.module).toBe("ÿ");
});

it("rejects combined table rows before allocating them", () => {
  const below = Math.floor(MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS / 2);
  const overflow = MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS - below * 2 + 1;
  expect(() =>
    parse(
      erlangBeamDeclaredRowsFixture([
        ["ExpT", below],
        ["ImpT", below],
        ["FunT", overflow],
      ]),
    ),
  ).toThrow(
    expect.objectContaining({
      reason: "limit",
      boundary: "capacity",
      message: expect.stringContaining("row budget"),
    }),
  );
  const count = Buffer.alloc(4);
  count.writeUInt32BE(MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS + 1);
  expect(() => parse(erlangBeamChunksFixture([["ExpT", count]]))).toThrow(
    /row budget/,
  );
  count.writeUInt32BE(MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS);
  expect(() => parse(erlangBeamChunksFixture([["ExpT", count]]))).toThrow(
    /truncated/,
  );
});

it("fails when the atom budget is exhausted", () => {
  const bytes = erlangBeamManyAtomsFixture(3);
  expect(() =>
    parse(
      bytes,
      inspectErlangBeamInputSchema.parse({
        path: defaults.path,
        max_atoms: 1,
      }),
    ),
  ).toThrow(ArtifactReaderFailure);
});

it("does not infer a BEAM budget from diagnostic prose", async () => {
  const provider = new BeamProvider();
  const injection = vi
    .spyOn(ArtifactResourceScope.prototype, "run")
    .mockRejectedValueOnce(
      new ArtifactReaderFailure(
        "limit",
        "atom row budget wording from another boundary",
        { boundary: "capacity" },
      ),
    );
  try {
    const result = await provider.inspect(defaults);
    if (result.ok) throw new Error("Expected unknown capacity failure");
    expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
    if (!(result.error instanceof AnalysisResourceConstraintError))
      throw new Error("Missing resource error");
    expect(result.error.retryable).toBeUndefined();
    expect(result.error.remediationAction).toBeUndefined();
  } finally {
    injection.mockRestore();
    await provider.close();
  }
});

it.each([
  {
    resource: "atoms",
    bytes: erlangBeamManyAtomsFixture(3),
    settings: { max_atoms: 1 },
    maximum: 1,
    remediation: "Raise max_atoms above 1",
  },
  {
    resource: "chunks",
    bytes: erlangBeamFixture(),
    settings: { max_chunks: 1 },
    maximum: 1,
    remediation: "Raise max_chunks above 1",
  },
  {
    resource: "table-rows",
    bytes: erlangBeamDeclaredRowsFixture([
      ["ExpT", MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS + 1],
    ]),
    settings: {},
    maximum: MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS,
    remediation: `${String(MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS)}-row ceiling`,
  },
])(
  "retains the producing $resource allowance when diagnostic wording changes",
  async ({ resource, bytes, settings, maximum, remediation }) => {
    const input = inspectErlangBeamInputSchema.parse({
      path: defaults.path,
      ...settings,
    });
    let cause: unknown;
    try {
      parse(bytes, input);
    } catch (failure) {
      cause = failure;
    }
    expect(cause).toBeInstanceOf(BeamCapacityFailure);
    if (!(cause instanceof BeamCapacityFailure))
      throw new Error("Missing named parser allowance");
    expect(cause).toMatchObject({
      resource,
      maximum,
      reason: "limit",
      boundary: "capacity",
    });
    cause.message = "BEAM parser allowance exhausted.";
    const provider = new BeamProvider();
    const injection = vi
      .spyOn(ArtifactResourceScope.prototype, "run")
      .mockRejectedValueOnce(cause);
    try {
      const result = await provider.inspect(input);
      if (result.ok) throw new Error("Expected named capacity failure");
      expect(result.error).toMatchObject({
        _tag: "AnalysisResourceConstraintError",
        retryable: false,
        remediationAction: expect.stringContaining(remediation),
      });
    } finally {
      injection.mockRestore();
      await provider.close();
    }
  },
);
