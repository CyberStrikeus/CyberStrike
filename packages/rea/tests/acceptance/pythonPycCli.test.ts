import { createHash } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { pythonPycSchema } from "../../src/domain/python/pythonPyc.js";
import { toolContract } from "../../src/contracts/toolContracts.js";
import {
  marshalCode,
  pythonPycFixture,
  pythonPycHeader,
} from "../../src/python/PythonPyc.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../support/cli/cliFixture.js";

const completePycEvidenceSchema = toolContract(
  "inspect_python_pyc",
).outputSchema.safeExtend({ normalized_result: pythonPycSchema });

const marshalUtf8 = (bytes: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([Buffer.from([0x75]), length, bytes]);
};

const marshalInt64 = (value: bigint): Buffer => {
  const payload = Buffer.alloc(8);
  payload.writeBigInt64LE(value);
  return Buffer.concat([Buffer.from([0x49]), payload]);
};

const marshalInt32 = (value: number): Buffer => {
  const payload = Buffer.alloc(4);
  payload.writeInt32LE(value);
  return Buffer.concat([Buffer.from([0x69]), payload]);
};

const marshalSingleItemTuple = (item: Buffer): Buffer =>
  Buffer.concat([Buffer.from([0x29, 1]), item]);

cliTest(
  "reads backward-compatible signed 64-bit marshal integers",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-pyc-int64-");
    for (const [name, value, bits] of [
      ["positive", 42n, 6],
      ["negative", -1n, 1],
      ["minimum", -(1n << 63n), 64],
      ["maximum", (1n << 63n) - 1n, 63],
    ] as const) {
      const path = join(root, `${name}.pyc`);
      await writeFile(
        path,
        Buffer.concat([
          pythonPycHeader(3531),
          marshalCode("py311", {
            constsObject: marshalSingleItemTuple(marshalInt64(value)),
          }),
        ]),
      );
      const result = await runFileCli(cli, {
        arguments: ["inspect-python-pyc", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = completePycEvidenceSchema.parse(result.json);
      expect(evidence.normalized_result.code_objects[0]?.consts).toContainEqual(
        { kind: "int", bits, value: value.toString() },
      );
    }

    const ordinaryIntPath = join(root, "ordinary-int.pyc");
    await writeFile(
      ordinaryIntPath,
      Buffer.concat([
        pythonPycHeader(3531),
        marshalCode("py311", {
          constsObject: marshalSingleItemTuple(marshalInt32(-42)),
        }),
      ]),
    );
    const ordinaryInt = await runFileCli(cli, {
      arguments: ["inspect-python-pyc", ordinaryIntPath, "--json"],
    });
    expect(ordinaryInt.exitCode, ordinaryInt.stderr).toBe(0);
    const ordinaryEvidence = completePycEvidenceSchema.parse(ordinaryInt.json);
    expect(
      ordinaryEvidence.normalized_result.code_objects[0]?.consts,
    ).toContainEqual({ kind: "int", bits: 6, value: "-42" });

    const truncatedPath = join(root, "truncated.pyc");
    await writeFile(
      truncatedPath,
      Buffer.concat([
        pythonPycHeader(3531),
        Buffer.from([0x49]),
        Buffer.alloc(7),
      ]),
    );
    const truncated = await runFileCli(cli, {
      arguments: ["inspect-python-pyc", truncatedPath, "--json"],
    });
    expect(truncated.exitCode).toBe(1);
    expect(truncated.json).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "inspect_python_pyc",
        issues: [
          {
            reason: "invalid_format",
            message: expect.stringContaining("64-bit integer"),
          },
        ],
      },
    });
  },
);

cliTest(
  "retains distinct Python 3.13 code objects after STORE_SLICE",
  async ({ cli }) => {
    // CPython 3.13.17 marshal output: a module with a frozenset of two
    // compiler-produced functions differing only in the LOAD_FAST operand
    // immediately after STORE_SLICE. CPython retains both through round-trip.
    const pyc = Buffer.from(
      "8w0NCgAAAAAAAAAAAAAAAOMAAAAAAAAAAAAAAAABAAAAAAAAAPMEAAAAlQBnACkCTj4CAAAA4wIAAAAAAAAAAAAAAAQAAAADAAAA8w4AAACVAFgQUwFTAiYAVQAkACkDTukBAAAA6QIAAACpACkC2gFh2gFicwIAAAAgINoKZml4dHVyZS5wedoBZnIKAAAAAQAAAHMQAAAAgADYDQ6AYYgBgEbYCwyASPMAAAAA4wIAAAAAAAAAAAAAAAQAAAADAAAA8w4AAACVAFgQUwFTAiYAVQEkACkDTnIEAAAAcgUAAAByBgAAACkCcgcAAAByCAAAAHMCAAAAICByCQAAAHIKAAAAcgoAAAABAAAAcxAAAACAANgNDoBhiAGARtgLDIBIcgsAAAByBgAAAHIGAAAAcgsAAAByCQAAANoIPG1vZHVsZT5yDgAAAAEAAABzCAAAAPADAQEB2AAEcgsAAAA=",
      "base64",
    );
    const root = await createTestTempDirectory("rea-python-pyc-store-slice-");
    const path = join(root, "code-set.pyc");
    await writeFile(path, pyc);
    const result = await cli.run({
      arguments: ["inspect-python-pyc", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = completePycEvidenceSchema.parse(result.json);
    expect(evidence.normalized_result.code_objects).toHaveLength(3);
    expect(evidence.normalized_result.code_objects[0]).toMatchObject({
      consts: [{ kind: "none" }, { kind: "frozenset", length: 2 }],
      nested_code: [1, 2],
    });
    expect(evidence.normalized_result.artifact.sha256).toBe(
      createHash("sha256").update(pyc).digest("hex"),
    );
  },
);

cliTest(
  "uses magic-specific cache tables for synthetic pyc bytecode equality",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-pyc-inline-cache-");
    const cases = [
      { magic: 3495, opcode: 166, cacheUnits: 1 },
      { magic: 3500, opcode: 25, cacheUnits: 4 },
      { magic: 3524, opcode: 25, cacheUnits: 1 },
      { magic: 3531, opcode: 106, cacheUnits: 9 },
      { magic: 3550, opcode: 25, cacheUnits: 1 },
      { magic: 3553, opcode: 25, cacheUnits: 1 },
      { magic: 3564, opcode: 58, cacheUnits: 1 },
      { magic: 3571, opcode: 82, cacheUnits: 9 },
    ];
    for (const { magic, opcode, cacheUnits } of cases) {
      const cache = Buffer.alloc(cacheUnits * 2);
      const bytecode = (arg: number, cachePayload: Buffer) =>
        Buffer.concat([
          Buffer.from([opcode, arg]),
          cachePayload,
          Buffer.from([83, 0]),
        ]);
      const changedCache = Buffer.from(cache);
      changedCache[0] = 1;
      const frozenSet = Buffer.concat([
        Buffer.from([0x3e, 4, 0, 0, 0]),
        ...[
          bytecode(0, cache),
          bytecode(0, changedCache),
          bytecode(1, cache),
          Buffer.concat([bytecode(0, cache), Buffer.from([0, 0])]),
        ].map((code) => marshalCode("py311", { bytecode: code })),
      ]);
      const pyc = Buffer.concat([
        pythonPycHeader(magic),
        marshalCode("py311", { consts: [frozenSet] }),
      ]);
      const path = join(root, `inline-caches-${magic}.pyc`);
      await writeFile(path, pyc);

      const result = await runFileCli(cli, {
        arguments: ["inspect-python-pyc", path, "--json"],
      });
      expect(
        result.exitCode,
        `${result.stderr}\n${JSON.stringify(result.json)}`,
      ).toBe(0);
      const evidence = completePycEvidenceSchema.parse(result.json);
      expect(evidence.normalized_result.code_objects[0]?.consts).toEqual([
        expect.objectContaining({ kind: "frozenset", length: 3 }),
      ]);
      expect(evidence.normalized_result.code_objects[1]?.bytecode).toEqual({
        bytes: bytecode(0, cache).length,
        sha256: createHash("sha256").update(bytecode(0, cache)).digest("hex"),
      });
      expect(evidence.normalized_result.artifact.sha256).toBe(
        createHash("sha256").update(pyc).digest("hex"),
      );
    }
  },
);

cliTest(
  "keeps distinct Python code names distinct when JavaScript display strings collide",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-pyc-unicode-name-");
    const scalar = Buffer.from([0xf0, 0x9f, 0x98, 0x80]);
    const surrogatePair = Buffer.from([0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80]);
    const code = (name: Buffer) =>
      marshalCode("py311", {
        nameObject: marshalUtf8(name),
        qualnameObject: marshalUtf8(name),
      });
    const frozenSet = Buffer.concat([
      Buffer.from([0x3e, 2, 0, 0, 0]),
      code(scalar),
      code(surrogatePair),
    ]);
    const path = join(root, "unicode-names.pyc");
    await writeFile(
      path,
      Buffer.concat([
        pythonPycHeader(3531),
        marshalCode("py311", { consts: [frozenSet] }),
      ]),
    );

    const result = await cli.run({
      arguments: ["inspect-python-pyc", path, "--json"],
    });
    expect(
      result.exitCode,
      `${result.stderr}\n${JSON.stringify(result.json)}`,
    ).toBe(0);
    const evidence = completePycEvidenceSchema.parse(result.json);
    const codes = evidence.normalized_result.code_objects;
    expect(codes[1]?.name).toBe(codes[2]?.name);
    expect(codes[0]?.consts).toEqual([
      expect.objectContaining({ kind: "frozenset", length: 2 }),
    ]);
  },
);

cliTest(
  "reports nested CPython code objects through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-pyc-cli-");
    const path = join(root, "sample.pyc");
    await writeFile(path, pythonPycFixture("py311", { nested: true }));
    const result = await cli.run({
      arguments: ["inspect-python-pyc", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = completePycEvidenceSchema.parse(result.json);
    expect(evidence.normalized_result.header.python_version).toBe("3.12");
    expect(evidence.normalized_result.code_objects[1]?.name).toBe("inner");
  },
);

cliTest(
  "classifies unsupported 3.7 alpha headers without labeling their marshal data malformed",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-pyc-alpha-header-");
    const marshal = Buffer.from(
      "e3000000000000000000000000010000004000000073040000006400530029014ea900720100000072010000007201000000fa066d6f642e7079da083c6d6f64756c653e010000007300000000",
      "hex",
    );
    expect(marshal).toHaveLength(77);
    for (const magic of [3390, 3391]) {
      const path = join(root, `${magic}.pyc`);
      const header = Buffer.alloc(12);
      header.writeUInt16LE(magic);
      header[2] = 0x0d;
      header[3] = 0x0a;
      await writeFile(path, Buffer.concat([header, marshal]));
      const result = await runFileCli(cli, {
        arguments: ["inspect-python-pyc", path, "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "unsupported_target",
        category: "unsupported_target",
      });
      expect(JSON.stringify(result.json)).toContain(
        "unsupported 12-byte CPython header",
      );
      expect(result.json).not.toHaveProperty("normalized_result");
    }

    for (const magic of [3392, 3394]) {
      const path = join(root, `${magic}.pyc`);
      await writeFile(path, Buffer.concat([pythonPycHeader(magic), marshal]));
      const result = await runFileCli(cli, {
        arguments: ["inspect-python-pyc", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = completePycEvidenceSchema.parse(result.json);
      expect(evidence.normalized_result.header.magic).toBe(magic);
      expect(evidence.normalized_result.code_objects[0]?.bytecode.bytes).toBe(
        4,
      );
    }
  },
);

cliTest(
  "preserves historical signed code fields and reports the ambiguous 3410 constructor revision",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-pyc-signed-fields-");
    for (const { name, magic, layout, fields, expected } of [
      {
        name: "zero",
        magic: 3531,
        layout: "py311",
        fields: { flags: 0 },
        expected: { stacksize: 1, flags: 0 },
      },
      {
        name: "unknown-positive-flags",
        magic: 3531,
        layout: "py311",
        fields: { flags: 0x40000000 },
        expected: { stacksize: 1, flags: 0x40000000 },
      },
      {
        name: "negative-stacksize-py37",
        magic: 3394,
        layout: "py37",
        fields: { stacksize: 0xffffffff },
        expected: { stacksize: -1, flags: 0 },
      },
      {
        name: "negative-flags-py38-alpha",
        magic: 3401,
        layout: "py37",
        fields: { flags: 0x80000000 },
        expected: { stacksize: 1, flags: -0x80000000 },
      },
      {
        name: "negative-stack-and-flags-py38-ambiguous",
        magic: 3410,
        layout: "py38",
        fields: { stacksize: 0xffffffff, flags: 0x80000000 },
        expected: { stacksize: -1, flags: -0x80000000 },
      },
    ] as const) {
      const path = join(root, `${name}.pyc`);
      await writeFile(
        path,
        Buffer.concat([pythonPycHeader(magic), marshalCode(layout, fields)]),
      );
      const result = await runFileCli(cli, {
        arguments: ["inspect-python-pyc", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = completePycEvidenceSchema.parse(result.json);
      expect(evidence.normalized_result.code_objects[0]).toMatchObject(
        expected,
      );
      if (magic === 3410)
        expect(evidence.normalized_result.limitations).toEqual(
          expect.arrayContaining([
            expect.stringContaining("Magic 3410 is shared"),
          ]),
        );
    }
  },
);

cliTest(
  "rejects negative code fields after the pinned constructor validation transition",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-python-pyc-signed-rejection-",
    );
    for (const { name, magic, layout, fields, message } of [
      {
        name: "negative-stacksize-py38-b2",
        magic: 3411,
        layout: "py38",
        fields: { stacksize: 0xffffffff },
        message: "co_stacksize is negative",
      },
      {
        name: "negative-flags-py38-b2",
        magic: 3411,
        layout: "py38",
        fields: { flags: 0x80000000 },
        message: "co_flags is negative",
      },
      {
        name: "negative-stacksize-py311",
        magic: 3531,
        layout: "py311",
        fields: { stacksize: 0xffffffff },
        message: "co_stacksize is negative",
      },
      {
        name: "negative-flags-py311",
        magic: 3531,
        layout: "py311",
        fields: { flags: 0x80000000 },
        message: "co_flags is negative",
      },
    ] as const) {
      const path = join(root, `${name}.pyc`);
      await writeFile(
        path,
        Buffer.concat([pythonPycHeader(magic), marshalCode(layout, fields)]),
      );
      const result = await runFileCli(cli, {
        arguments: ["inspect-python-pyc", path, "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        details: {
          operation: "inspect_python_pyc",
          issues: [
            {
              reason: "invalid_format",
              message: expect.stringContaining(message),
            },
          ],
        },
      });
      expect(result.json).not.toHaveProperty("normalized_result");
    }
  },
);

cliTest(
  "preserves negative CPython first line numbers through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-pyc-lines-");
    const path = join(root, "sample.pyc");
    const nested = marshalCode("py311", {
      name: "inner",
      firstlineno: -7,
    });
    const bytes = Buffer.concat([
      pythonPycHeader(3531),
      marshalCode("py311", {
        firstlineno: -1,
        consts: [nested],
      }),
    ]);
    await writeFile(path, bytes);
    const result = await cli.run({
      arguments: ["inspect-python-pyc", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = completePycEvidenceSchema.parse(result.json);
    expect(evidence.normalized_result.code_objects[0]?.firstlineno).toBe(-1);
    expect(evidence.normalized_result.code_objects[1]?.firstlineno).toBe(-7);
    expect(evidence.normalized_result.code_objects[0]?.consts).toContainEqual({
      kind: "code",
      name: "inner",
      firstlineno: -7,
    });
  },
);

cliTest(
  "matches CPython reference slots for singleton and reference tags",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-pyc-ref-slots-");
    const cases = [
      {
        name: "flagged-none",
        consts: "2903cefa01787200000000",
        expected: [
          { kind: "none" },
          { kind: "str", value: "x" },
          { kind: "str", value: "x" },
        ],
      },
      {
        name: "flagged-ref",
        consts: "2904fa0161f200000000fa01627201000000",
        expected: [
          { kind: "str", value: "a" },
          { kind: "str", value: "a" },
          { kind: "str", value: "b" },
          { kind: "str", value: "b" },
        ],
      },
    ];
    for (const testCase of cases) {
      const path = join(root, `${testCase.name}.pyc`);
      await writeFile(
        path,
        Buffer.concat([
          pythonPycHeader(3531),
          marshalCode("py311", {
            constsObject: Buffer.from(testCase.consts, "hex"),
          }),
        ]),
      );
      const result = await runFileCli(cli, {
        arguments: ["inspect-python-pyc", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = completePycEvidenceSchema.parse(result.json);
      expect(evidence.normalized_result.code_objects[0]?.consts).toMatchObject(
        testCase.expected,
      );
    }
  },
);

cliTest(
  "counts code keys using the selected CPython equality rules",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-pyc-equality-");
    const cases = [
      { magic: 3413, layout: "py38" as const, lengths: [1, 1] },
      { magic: 3439, layout: "py38" as const, lengths: [1, 1] },
      { magic: 3531, layout: "py311" as const, lengths: [2, 2] },
    ];
    for (const [index, testCase] of cases.entries()) {
      const code = (linetable: Buffer) =>
        marshalCode(testCase.layout, {
          name: "f",
          filename: "fixture.py",
          firstlineno: 1,
          linetable,
        });
      const frozenSet = Buffer.concat([
        Buffer.from([0x3e]),
        Buffer.from([2, 0, 0, 0]),
        code(Buffer.from([2, 1])),
        code(Buffer.from([2, 2])),
      ]);
      const dict = Buffer.concat([
        Buffer.from([0x7b]),
        code(Buffer.from([2, 1])),
        Buffer.from([0x4e]),
        code(Buffer.from([2, 2])),
        Buffer.from([0x54, 0x30]),
      ]);
      const path = join(root, `case-${index}.pyc`);
      await writeFile(
        path,
        Buffer.concat([
          pythonPycHeader(testCase.magic),
          marshalCode(testCase.layout, { consts: [frozenSet, dict] }),
        ]),
      );
      const result = await runFileCli(cli, {
        arguments: ["inspect-python-pyc", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = completePycEvidenceSchema.parse(result.json);
      expect(evidence.normalized_result.code_objects[0]?.consts).toEqual([
        { kind: "frozenset", length: testCase.lengths[0] },
        { kind: "dict", length: testCase.lengths[1] },
      ]);
    }
  },
);

cliTest(
  "uses constructor-normalized legacy flags for code keys and preserves raw flags",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-python-pyc-effective-flags-",
    );
    const cases = [
      {
        name: "py37-empty-tables",
        magic: 3394,
        layout: "py37" as const,
        freevars: [],
        cellvars: [],
        lengths: [1, 1],
      },
      {
        name: "py310-nonempty-tables",
        magic: 3439,
        layout: "py38" as const,
        freevars: ["capture"],
        cellvars: [],
        lengths: [1, 1],
      },
      {
        name: "py311-raw-flags",
        magic: 3531,
        layout: "py311" as const,
        freevars: [],
        cellvars: [],
        lengths: [2, 2],
      },
    ];
    for (const testCase of cases) {
      const code = (flags: number) =>
        marshalCode(testCase.layout, {
          name: "f",
          filename: "fixture.py",
          firstlineno: 1,
          flags,
          freevars: testCase.freevars,
          cellvars: testCase.cellvars,
        });
      const first = code(0);
      const second = code(0x40);
      const frozenSet = Buffer.concat([
        Buffer.from([0x3e]),
        Buffer.from([2, 0, 0, 0]),
        first,
        second,
      ]);
      const dict = Buffer.concat([
        Buffer.from([0x7b]),
        first,
        Buffer.from([0x4e]),
        second,
        Buffer.from([0x54, 0x30]),
      ]);
      const path = join(root, `${testCase.name}.pyc`);
      await writeFile(
        path,
        Buffer.concat([
          pythonPycHeader(testCase.magic),
          marshalCode(testCase.layout, { consts: [frozenSet, dict] }),
        ]),
      );
      const result = await runFileCli(cli, {
        arguments: ["inspect-python-pyc", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = completePycEvidenceSchema.parse(result.json);
      expect(
        evidence.normalized_result.code_objects[0]?.consts.map((value) =>
          value.kind === "frozenset" || value.kind === "dict"
            ? value.length
            : null,
        ),
      ).toEqual(testCase.lengths);
      expect(
        evidence.normalized_result.code_objects
          .filter((object) => object.name === "f")
          .map((object) => object.flags),
      ).toContain(0);

      const rawPath = join(root, `raw-${testCase.name}.pyc`);
      await writeFile(
        rawPath,
        Buffer.concat([
          pythonPycHeader(testCase.magic),
          marshalCode(testCase.layout, {
            name: "f",
            flags: 0x40,
            freevars: testCase.freevars,
            cellvars: testCase.cellvars,
          }),
        ]),
      );
      const rawResult = await runFileCli(cli, {
        arguments: ["inspect-python-pyc", rawPath, "--json"],
      });
      expect(rawResult.exitCode, rawResult.stderr).toBe(0);
      const rawEvidence = completePycEvidenceSchema.parse(rawResult.json);
      expect(rawEvidence.normalized_result.code_objects[0]?.flags).toBe(0x40);
    }
  },
);

cliTest(
  "resolves a relative pyc path against the working directory",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-pyc-cli-rel-");
    await writeFile(join(root, "sample.pyc"), pythonPycFixture("py37"));
    const result = await cli.run({
      arguments: ["inspect-python-pyc", "sample.pyc", "--json"],
      cwd: root,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = completePycEvidenceSchema.parse(result.json);
    expect(evidence.normalized_result.header.python_version).toBe("3.7");
    expect(evidence.subject?.local_path).toBe(join(root, "sample.pyc"));
  },
);

cliTest.skipIf(process.platform === "win32")(
  "reads the file the symlink path names, not its lexical sibling",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-pyc-cli-link-");
    const target = join(root, "target");
    await mkdir(join(target, "child"), { recursive: true });
    await writeFile(join(target, "sample.pyc"), pythonPycFixture("py37"));
    await writeFile(join(root, "sample.pyc"), pythonPycFixture("py311"));
    await symlink(join(target, "child"), join(root, "link"));
    const result = await cli.run({
      arguments: ["inspect-python-pyc", "link/../sample.pyc", "--json"],
      cwd: root,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = completePycEvidenceSchema.parse(result.json);
    expect(evidence.normalized_result.header.python_version).toBe("3.7");
    expect(evidence.subject?.local_path).toBe(`${root}/link/../sample.pyc`);
  },
);

cliTest("reports a truncated pyc as invalid input", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-python-pyc-cli-bad-");
  const path = join(root, "broken.pyc");
  await writeFile(path, Buffer.from("not a pyc"));
  const result = await cli.run({
    arguments: ["inspect-python-pyc", path, "--json"],
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "invalid_request",
    details: { operation: "inspect_python_pyc" },
  });
});

cliTest(
  "preserves whole Unicode scalars in bounded pyc previews through CLI and MCP",
  async ({ cli }) => {
    const cases = [
      {
        input: "a" + "😀".repeat(40),
        preview: "a" + "😀".repeat(39),
        bytes: 161,
        truncated: true,
      },
      {
        input: "a" + "😀".repeat(40) + "z",
        preview: "a" + "😀".repeat(39),
        bytes: 162,
        truncated: true,
      },
      {
        input: "a" + "😀".repeat(39),
        preview: "a" + "😀".repeat(39),
        bytes: 157,
        truncated: false,
      },
      {
        input: "😀".repeat(40),
        preview: "😀".repeat(40),
        bytes: 160,
        truncated: false,
      },
      {
        input: "z".repeat(81),
        preview: "z".repeat(80),
        bytes: 81,
        truncated: true,
      },
    ];
    const consts = cases.map(({ input }) => {
      const text = Buffer.from(input, "utf8");
      const header = Buffer.alloc(5);
      header[0] = 0x75;
      header.writeUInt32LE(text.length, 1);
      return Buffer.concat([header, text]);
    });
    const bytes = Buffer.concat([
      pythonPycHeader(3531),
      marshalCode("py311", { consts }),
    ]);
    const root = await createTestTempDirectory("rea-python-pyc-preview-");
    const path = join(root, "unicode.pyc");
    await writeFile(path, bytes);
    const response = await cli.run({
      arguments: ["inspect-python-pyc", path, "--json"],
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const report = completePycEvidenceSchema.parse(
      response.json,
    ).normalized_result;
    expect(report.coverage.status).toBe("complete");
    expect(report.code_objects[0]?.consts).toEqual(
      cases.map((entry) => ({
        kind: "str",
        value: entry.preview,
        bytes: entry.bytes,
        truncated: entry.truncated,
      })),
    );
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected file MCP session");
    const mcp = await call("inspect_python_pyc", { path });
    expect(mcp.isError).not.toBe(true);
    expect(
      completePycEvidenceSchema.parse(mcp.structuredContent).normalized_result,
    ).toEqual(report);
    const toon = await cli.run({
      arguments: ["inspect-python-pyc", path, "--format", "toon"],
    });
    expect(toon.exitCode, toon.stderr).toBe(0);
    expect(toon.stdout).not.toContain("�");
  },
);

cliTest(
  "distinguishes source surrogate code points from astral scalars at the preview cut",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-python-source-boundary-");
    const path = join(root, "source-boundaries.pyc");
    const prefix = "a".repeat(79);
    const scalar = Buffer.from(prefix + "𐀀z");
    const separate = Buffer.concat([
      Buffer.from(prefix),
      Buffer.from([0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80]),
      Buffer.from("z"),
    ]);
    await writeFile(
      path,
      Buffer.concat([
        pythonPycHeader(3531),
        marshalCode("py311", {
          consts: [marshalUtf8(scalar), marshalUtf8(separate)],
        }),
      ]),
    );
    const response = await cli.run({
      arguments: ["inspect-python-pyc", path, "--json"],
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const report = completePycEvidenceSchema.parse(
      response.json,
    ).normalized_result;
    expect(report.code_objects[0]?.consts).toEqual([
      { kind: "str", value: prefix, bytes: 84, truncated: true },
      { kind: "str", value: prefix + "\ud800", bytes: 86, truncated: true },
    ]);
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected file MCP session");
    const mcp = await call("inspect_python_pyc", { path });
    expect(mcp.isError).not.toBe(true);
    expect(
      completePycEvidenceSchema.parse(mcp.structuredContent).normalized_result,
    ).toEqual(report);
  },
);
