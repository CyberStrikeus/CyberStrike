import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  inspectPythonPycInputSchema,
  pythonPycSchema,
  type PythonPyc,
} from "../domain/python/pythonPyc.js";
import {
  marshalCode,
  pythonPycFixture,
  pythonPycHeader,
} from "./PythonPyc.fixture.js";
import { parsePythonPyc } from "./PythonPycParser.js";
import {
  PythonPycFormatFailure,
  PythonPycResourceFailure,
} from "./PythonPyc.errors.js";

const defaults = inspectPythonPycInputSchema.parse({
  path: "/artifacts/sample.pyc",
});

const root = (report: PythonPyc) => {
  const code = report.code_objects[0];
  if (code === undefined) throw new Error("Report lists no code object");
  return code;
};

const parse = (bytes: Buffer) =>
  parsePythonPyc(
    bytes,
    {
      path: defaults.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
    defaults,
  );

it("reads 3.7, 3.10 and 3.12 layouts including nested code", () => {
  const py37 = parse(pythonPycFixture("py37"));
  expect(py37.header).toMatchObject({
    magic: 3394,
    python_version: "3.7",
    code_layout: "py37",
    hash_based: false,
  });
  expect(root(py37).posonlyargcount).toBeNull();
  expect(root(py37).nlocals).toBe(0);
  expect(root(py37).qualname).toBeNull();

  const py38 = parse(pythonPycFixture("py38", { nested: true }));
  expect(py38.header.python_version).toBe("3.10");
  expect(root(py38).posonlyargcount).toBe(0);
  expect(py38.code_objects[1]?.name).toBe("inner");
  expect(py38.coverage.code_objects).toBe(2);

  const py311 = parse(pythonPycFixture("py311", { nested: true }));
  expect(py311.header).toMatchObject({
    magic: 3531,
    python_version: "3.12",
    code_layout: "py311",
  });
  expect(root(py311).nlocals).toBeNull();
  expect(root(py311).qualname).toBe("<module>");
  expect(py311.code_objects[1]?.name).toBe("inner");
  expect(root(py311).consts).toEqual(
    expect.arrayContaining([
      { kind: "code", name: "inner", firstlineno: 2 },
      { kind: "none" },
    ]),
  );
});

it("preserves signed co_firstlineno in code objects and code constants", () => {
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
  const report = parse(bytes);
  expect(root(report).firstlineno).toBe(-1);
  expect(root(report).consts).toContainEqual({
    kind: "code",
    name: "inner",
    firstlineno: -7,
  });
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
  expect(
    pythonPycSchema.safeParse({
      ...report,
      code_objects: [
        { ...root(report), firstlineno: -0x8000_0001 },
        ...report.code_objects.slice(1),
      ],
    }).success,
  ).toBe(false);
  expect(
    pythonPycSchema.safeParse({
      ...report,
      code_objects: [
        { ...root(report), firstlineno: 0x8000_0000 },
        ...report.code_objects.slice(1),
      ],
    }).success,
  ).toBe(false);
});

it("decodes a hash-based header and a FLAG_REF top-level code object", () => {
  const bytes = pythonPycFixture("py311", {
    flaggedCode: true,
    header: {
      flags: 0x1,
      sourceHash: Buffer.from("0102030405060708", "hex"),
    },
  });
  const report = parse(bytes);
  expect(report.header).toMatchObject({
    hash_based: true,
    check_source: false,
    source_hash_hex: "0102030405060708",
    source_mtime: null,
    source_size: null,
  });
  expect(root(report).name).toBe("<module>");
});

it("fails unknown magics and truncated marshal without partial success", () => {
  const unknown = Buffer.concat([pythonPycHeader(1), marshalCode("py311")]);
  expect(() => parse(unknown)).toThrow(PythonPycFormatFailure);
  expect(() => parse(pythonPycFixture("py311").subarray(0, 20))).toThrow(
    PythonPycFormatFailure,
  );
});

it.each([
  { magic: 3571, layout: "py311", version: "3.13" },
  { magic: 3401, layout: "py37", version: "3.8" },
] as const)(
  "decodes supported standalone magic $magic with its own marshal layout",
  ({ magic, layout, version }) => {
    const result = parse(
      Buffer.concat([pythonPycHeader(magic), marshalCode(layout)]),
    );
    expect(result.header).toMatchObject({
      magic,
      python_version: version,
      code_layout: layout,
    });
    expect(root(result).name).toBe("<module>");
  },
);

it("keeps a known newer CPython identity outside standalone decoder coverage", () => {
  expect(() => parse(pythonPycHeader(3627))).toThrow(
    expect.objectContaining({
      kind: "unsupported",
      message: expect.stringContaining(
        "outside the pinned CPython 3.7–3.13 table",
      ),
    }),
  );
});

it("reports a short unknown header before unsupported magic, and bad CR LF before either", () => {
  const unknown = pythonPycHeader(1).subarray(0, 4);
  expect(() => parse(unknown)).toThrow(
    expect.objectContaining({
      kind: "malformed",
      message:
        "Selected file is shorter than a 16-byte CPython 3.7+ pyc header.",
    }),
  );
  const badTrailer = Buffer.from(unknown);
  badTrailer[3] = 0;
  expect(() => parse(badTrailer)).toThrow(
    expect.objectContaining({
      kind: "malformed",
      message: "Pyc magic is not a little-endian integer followed by CR LF.",
    }),
  );
});

it("classifies the 12-byte 3.7 alpha header as unsupported", () => {
  for (const magic of [3390, 3391]) {
    const header = Buffer.alloc(12);
    header.writeUInt16LE(magic);
    header[2] = 0x0d;
    header[3] = 0x0a;
    expect(() => parse(Buffer.concat([header, marshalCode("py37")]))).toThrow(
      expect.objectContaining({
        kind: "unsupported",
        message: expect.stringContaining("unsupported 12-byte CPython header"),
      }),
    );
    expect(() => parse(header.subarray(0, 4))).toThrow(
      expect.objectContaining({
        kind: "unsupported",
        message: expect.stringContaining("unsupported 12-byte CPython header"),
      }),
    );
  }
});

const u32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
const i32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value);
  return bytes;
};
const f64 = (value: number): Buffer => {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleLE(value);
  return bytes;
};
const marshalRef = (index: number): Buffer =>
  Buffer.concat([Buffer.from([0x72]), u32(index)]);
const marshalLong = (digits: readonly number[], negative = false): Buffer =>
  Buffer.concat([
    Buffer.from([0x6c]),
    i32(negative ? -digits.length : digits.length),
    ...digits.map((digit) => {
      const bytes = Buffer.alloc(2);
      bytes.writeUInt16LE(digit);
      return bytes;
    }),
  ]);
const marshalUnicode = (bytes: Buffer): Buffer =>
  Buffer.concat([Buffer.from([0x75]), u32(bytes.length), bytes]);
const withConsts = (consts: Buffer[]): Buffer =>
  Buffer.concat([pythonPycHeader(3531), marshalCode("py311", { consts })]);
const CO_VARARGS = 0x04;

/** Each level keeps one flagged child and two TYPE_REF copies of it. */
const sharedChain = (levels: number): Buffer => {
  const level = (index: number): Buffer =>
    index === levels
      ? marshalCode("py311", { name: `leaf`, flagged: true })
      : marshalCode("py311", {
          name: `level${index}`,
          flagged: index > 0,
          consts: [level(index + 1), marshalRef(index), marshalRef(index)],
        });
  return Buffer.concat([pythonPycHeader(3531), level(0)]);
};

it("lists a code object shared through TYPE_REF once and refers to it by index", () => {
  const small = parse(sharedChain(3));
  expect(small.code_objects.map((code) => code.name)).toEqual([
    "level0",
    "level1",
    "level2",
    "leaf",
  ]);
  expect(small.code_objects.map((code) => code.nested_code)).toEqual([
    [1],
    [2],
    [3],
    [],
  ]);
  expect(small.coverage.code_objects).toBe(4);
  expect(pythonPycSchema.safeParse(small).success).toBe(true);
  const started = Date.now();
  const deep = parse(sharedChain(25));
  expect(Date.now() - started).toBeLessThan(1000);
  expect(deep.coverage.code_objects).toBe(26);
  expect(JSON.stringify(deep).length).toBeLessThan(64 * 1024);
});

it("bounds names repeated through TYPE_REF by what the report carries", () => {
  const name = Buffer.alloc(1000, 0x61);
  const namesObject = Buffer.concat([
    Buffer.from([0x29, 101]),
    Buffer.from([0x61 | 0x80]),
    u32(name.length),
    name,
    ...Array.from({ length: 100 }, () => marshalRef(0)),
  ]);
  const bytes = Buffer.concat([
    pythonPycHeader(3531),
    marshalCode("py311", { namesObject }),
  ]);
  expect(() =>
    parsePythonPyc(
      bytes,
      {
        path: defaults.path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      },
      { ...defaults, max_file_bytes: bytes.length },
    ),
  ).toThrow(PythonPycResourceFailure);
});

it("charges shared empty name tables against the object budget", () => {
  const width = 200;
  const owners = 40;
  const namesObject = Buffer.concat([
    Buffer.from([0xa8]),
    u32(width),
    Buffer.from([0xfa, 0x00]),
    ...Array.from({ length: width - 1 }, () => marshalRef(2)),
  ]);
  const owner = (index: number) =>
    marshalCode("py311", {
      name: `o${index}`,
      qualname: `o${index}`,
      filename: "n.py",
      flagged: true,
      namesObject: index === 0 ? namesObject : marshalRef(1),
    });
  const bytes = Buffer.concat([
    pythonPycHeader(3531),
    marshalCode("py311", {
      consts: Array.from({ length: owners }, (_, index) => owner(index)),
    }),
  ]);
  const report = parseWith(bytes, {
    max_objects: 65_536,
    max_file_bytes: bytes.length,
  });
  const copiedNames = report.code_objects.reduce(
    (sum, code) => sum + code.names.length,
    0,
  );
  const shared = report.code_objects[1]?.names;
  expect(copiedNames).toBe(owners * width);
  expect(shared).toEqual(Array.from({ length: width }, () => ""));
  expect(report.code_objects.at(-1)?.names).toEqual(shared);
  expect(report.coverage.objects).toBeLessThan(copiedNames);
  expect(report.coverage.status).toBe("complete");
  expect(() =>
    parseWith(bytes, {
      max_objects: copiedNames - 1,
      max_file_bytes: bytes.length,
    }),
  ).toThrow(/Reported names exceed max_objects/);
});

it("charges long digits to the string budget and keeps large previews bounded", () => {
  expect(() =>
    parse(withConsts([Buffer.concat([Buffer.from([0x6c]), i32(600_000)])])),
  ).toThrow(PythonPycResourceFailure);
  const report = parse(
    withConsts([
      marshalLong([1, 2]),
      marshalLong(Array.from({ length: 20 }, (_, index) => index + 1)),
    ]),
  );
  expect(root(report).consts[0]).toEqual({
    kind: "int",
    bits: 17,
    value: String(1n + (2n << 15n)),
  });
  expect(root(report).consts[1]).toMatchObject({ kind: "int", value: null });
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
  expect(() => parse(withConsts([marshalLong([1, 0])]))).toThrow(
    PythonPycFormatFailure,
  );
  expect(() => parse(withConsts([marshalLong([0x8000])]))).toThrow(
    PythonPycFormatFailure,
  );
});

it("decodes marshal strings with CPython surrogatepass rules", () => {
  const report = parse(
    withConsts([marshalUnicode(Buffer.from("efbbbf73eda080efbbbf", "hex"))]),
  );
  expect(root(report).consts[0]).toMatchObject({
    kind: "str",
    value: "\ufeffs\ud800\ufeff",
  });
  expect(() =>
    parse(withConsts([marshalUnicode(Buffer.from([0xf0, 0x90, 0x80]))])),
  ).toThrow(PythonPycFormatFailure);
  expect(() =>
    parse(withConsts([marshalUnicode(Buffer.from([0xc0, 0x80]))])),
  ).toThrow(PythonPycFormatFailure);
});

it.each([0x73, 0x74, 0x75, 0x61, 0x41, 0x28, 0x5b, 0x3c, 0x3e])(
  "classifies a negative signed marshal count (tag %i) before applying limits",
  (tag) => {
    expect(() =>
      parse(withConsts([Buffer.concat([Buffer.from([tag]), i32(-1)])])),
    ).toThrow(PythonPycFormatFailure);
  },
);

it("keeps signed zero and non-finite float and complex constants JSON-safe", () => {
  const report = parse(
    withConsts([
      Buffer.concat([Buffer.from([0x67]), f64(Infinity)]),
      Buffer.concat([Buffer.from([0x79]), f64(0), f64(-Infinity)]),
      Buffer.concat([Buffer.from([0x67]), f64(Number.NaN)]),
      Buffer.concat([Buffer.from([0x67]), f64(-0)]),
      Buffer.concat([Buffer.from([0x67]), f64(0)]),
      Buffer.concat([Buffer.from([0x79]), f64(-0), f64(-0)]),
    ]),
  );
  expect(root(report).consts).toEqual([
    { kind: "float", value: "inf" },
    { kind: "complex", real: 0, imag: "-inf" },
    { kind: "float", value: "nan" },
    { kind: "float", value: "-0.0" },
    { kind: "float", value: 0 },
    { kind: "complex", real: "-0.0", imag: "-0.0" },
  ]);
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
  expect(JSON.parse(JSON.stringify(report))).toEqual(report);
});

it("truncates string previews without introducing a lone surrogate", () => {
  const prefix = "x".repeat(79);
  const report = parse(
    withConsts([
      marshalUnicode(Buffer.from(`${prefix}😀tail`)),
      marshalUnicode(
        Buffer.concat([
          Buffer.from(prefix),
          Buffer.from("eda080", "hex"),
          Buffer.from("tail"),
        ]),
      ),
    ]),
  );
  expect(root(report).consts).toEqual([
    { kind: "str", bytes: 87, truncated: true, value: prefix },
    { kind: "str", bytes: 86, truncated: true, value: `${prefix}\ud800` },
  ]);
});

it("accepts an empty co_filename", () => {
  const report = parse(
    Buffer.concat([
      pythonPycHeader(3531),
      marshalCode("py311", { filename: "" }),
    ]),
  );
  expect(root(report).filename).toBe("");
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
});

it("rejects a code object whose location tables are not bytes", () => {
  expect(() =>
    parse(
      Buffer.concat([
        pythonPycHeader(3531),
        marshalCode("py311", { exceptiontableObject: Buffer.from([0x53]) }),
      ]),
    ),
  ).toThrow(PythonPycFormatFailure);
});

it("hashes one shared byte string no matter how many times it is referenced", () => {
  const payload = Buffer.alloc(1024 * 1024, 0x61);
  const refs = 1200;
  const bytes = Buffer.concat([
    pythonPycHeader(3531),
    marshalCode("py311", {
      constsObject: Buffer.concat([
        Buffer.from([0x28]),
        u32(refs + 1),
        Buffer.from([0xf3]),
        u32(payload.length),
        payload,
        ...Array.from({ length: refs }, () => marshalRef(0)),
      ]),
    }),
  ]);
  const started = Date.now();
  const report = parse(bytes);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(root(report).consts).toHaveLength(refs + 1);
  expect(root(report).consts[refs]).toEqual(root(report).consts[0]);
  expect(root(report).consts[0]).toMatchObject({
    kind: "bytes",
    bytes: payload.length,
  });
});

it("rejects constant tables whose copies exceed max_objects", () => {
  const shared = Buffer.concat([
    Buffer.from([0xa9, 20]),
    Buffer.alloc(20, 0x4e),
  ]);
  const child = (constsObject: Buffer, name: string) =>
    marshalCode("py311", { constsObject, name });
  const bytes = Buffer.concat([
    pythonPycHeader(3531),
    marshalCode("py311", {
      consts: [
        child(shared, "a"),
        ...Array.from({ length: 5 }, (_, index) =>
          child(marshalRef(0), `b${index}`),
        ),
      ],
    }),
  ]);
  const artifact = {
    path: defaults.path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
  const allowed = parsePythonPyc(bytes, artifact, defaults);
  const entries = allowed.code_objects.reduce(
    (sum, code) => sum + code.consts.length,
    0,
  );
  expect(entries).toBeGreaterThan(allowed.coverage.objects);
  expect(() =>
    parsePythonPyc(bytes, artifact, {
      ...defaults,
      max_objects: entries - 1,
    }),
  ).toThrow(/Reported constants exceed max_objects/);
});

it("rejects NULL tuple items and mismatched local kinds", () => {
  expect(() => parse(withConsts([Buffer.from([0x30])]))).toThrow(
    PythonPycFormatFailure,
  );
  expect(
    root(parse(withConsts([Buffer.from([0x7b, 0x4e, 0x54, 0x30])]))).consts[0],
  ).toEqual({
    kind: "dict",
    length: 1,
  });
  expect(() =>
    parse(
      Buffer.concat([
        pythonPycHeader(3531),
        marshalCode("py311", {
          localsplusnames: ["v"],
          localspluskinds: Buffer.alloc(0),
        }),
      ]),
    ),
  ).toThrow(PythonPycFormatFailure);
  const matched = parse(
    Buffer.concat([
      pythonPycHeader(3531),
      marshalCode("py311", {
        localsplusnames: ["v"],
        localspluskinds: Buffer.from([0x20]),
      }),
    ]),
  );
  expect(root(matched).localsplusnames).toEqual(["v"]);
  expect(root(matched).localspluskinds_hex).toBe("20");
  const broken = {
    ...matched,
    code_objects: [
      { ...root(matched), localspluskinds_hex: "" },
      ...matched.code_objects.slice(1),
    ],
  };
  expect(pythonPycSchema.safeParse(broken).success).toBe(false);
  expect(pythonPycSchema.safeParse(matched).success).toBe(true);
});

const textFloat = (text: string): Buffer =>
  Buffer.concat([
    Buffer.from([0x66, Buffer.byteLength(text)]),
    Buffer.from(text),
  ]);

const textComplex = (real: string, imag: string): Buffer =>
  Buffer.concat([
    Buffer.from([0x78, Buffer.byteLength(real)]),
    Buffer.from(real),
    Buffer.from([Buffer.byteLength(imag)]),
    Buffer.from(imag),
  ]);

const parseLimited = (bytes: Buffer, max_file_bytes: number) =>
  parsePythonPyc(
    bytes,
    {
      path: defaults.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
    { ...defaults, max_file_bytes },
  );

it("charges every reported code-constant name against the file budget", () => {
  const name = Buffer.alloc(2000, 0x6e);
  const nameObject = Buffer.concat([
    Buffer.from([0x61]),
    u32(name.length),
    name,
  ]);
  const child = marshalCode("py311", {
    nameObject,
    qualnameObject: nameObject,
    flagged: true,
  });
  const file = (copies: number): Buffer =>
    Buffer.concat([
      pythonPycHeader(3531),
      marshalCode("py311", {
        constsObject: Buffer.concat([
          Buffer.from([0x28]),
          u32(copies),
          child,
          ...Array.from({ length: copies - 1 }, () => marshalRef(0)),
        ]),
      }),
    ]);
  const once = parseLimited(file(1), 20_000);
  expect(root(once).consts[0]).toMatchObject({
    kind: "code",
    name: "n".repeat(2000),
  });
  expect(pythonPycSchema.safeParse(once).success).toBe(true);
  expect(() => parseLimited(file(30), 20_000)).toThrow(
    PythonPycResourceFailure,
  );
});

it("reuses a shared integer's bit length instead of converting every reference", () => {
  const digits = Array.from({ length: 20_000 }, () => 0x7fff);
  const long = marshalLong(digits);
  const flagged = Buffer.concat([
    Buffer.from([(long[0] ?? 0) | 0x80]),
    long.subarray(1),
  ]);
  const refs = 400;
  const bytes = Buffer.concat([
    pythonPycHeader(3531),
    marshalCode("py311", {
      constsObject: Buffer.concat([
        Buffer.from([0x28]),
        u32(refs + 1),
        flagged,
        ...Array.from({ length: refs }, () => marshalRef(0)),
      ]),
    }),
  ]);
  const started = Date.now();
  const report = parse(bytes);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(root(report).consts[0]).toEqual({
    kind: "int",
    bits: digits.length * 15,
    value: null,
  });
  expect(root(report).consts[refs]).toEqual(root(report).consts[0]);
});

it("lists code objects nested inside constant containers", () => {
  const hidden = marshalCode("py311", {
    name: "hidden",
    qualname: "hidden",
    firstlineno: 4,
  });
  const wrapped = Buffer.concat([Buffer.from([0x29, 1]), hidden]);
  const report = parse(withConsts([wrapped]));
  expect(report.code_objects.map((code) => code.name)).toEqual([
    "<module>",
    "hidden",
  ]);
  expect(root(report).nested_code).toEqual([1]);
  expect(root(report).consts[0]).toEqual({ kind: "tuple", length: 1 });
  expect(report.coverage).toMatchObject({
    status: "complete",
    code_objects: 2,
  });
  expect(pythonPycSchema.safeParse(report).success).toBe(true);

  const listed = Buffer.concat([Buffer.from([0x5b]), u32(1), hidden]);
  const deeper = parse(
    withConsts([Buffer.concat([Buffer.from([0x29, 1]), listed])]),
  );
  expect(deeper.code_objects.map((code) => code.name)).toEqual([
    "<module>",
    "hidden",
  ]);
  const keyed = Buffer.concat([
    Buffer.from([0x7b, 0x69]),
    i32(1),
    hidden,
    Buffer.from([0x30]),
  ]);
  expect(
    parse(withConsts([keyed])).code_objects.map((code) => code.name),
  ).toEqual(["<module>", "hidden"]);
});

it("accepts containers that contain themselves", () => {
  const list = Buffer.concat([
    Buffer.from([0x5b | 0x80]),
    u32(1),
    marshalRef(0),
  ]);
  expect(root(parse(withConsts([list]))).consts[0]).toEqual({
    kind: "list",
    length: 1,
  });
  const dict = Buffer.concat([
    Buffer.from([0x7b | 0x80, 0x69 | 0x80]),
    i32(1),
    marshalRef(0),
    Buffer.from([0x30]),
  ]);
  const report = parse(withConsts([dict]));
  expect(root(report).consts[0]).toEqual({ kind: "dict", length: 1 });
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
});

it("reads marshal version 0 text floats inside a code object", () => {
  const version0 = Buffer.from(
    "cb0d0d0a0000000000000000000000006300000000000000000000000001000000000000007308000000970064005a00790128020000006603312e354e280100000075010000007828000000007300000000750900000073616d706c652e707975080000003c6d6f64756c653e75080000003c6d6f64756c653e01000000730a000000f003010101d8040781017300000000",
    "hex",
  );
  const report = parse(version0);
  expect(report.header).toMatchObject({
    magic: 3531,
    python_version: "3.12",
    code_layout: "py311",
  });
  expect(root(report).name).toBe("<module>");
  expect(root(report).consts[0]).toEqual({ kind: "float", value: 1.5 });
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
  const specials = parse(
    withConsts([
      textFloat("inf"),
      textFloat("-inf"),
      textFloat("nan"),
      textComplex("0", "inf"),
      textFloat("1e-2"),
    ]),
  );
  expect(root(specials).consts).toEqual([
    { kind: "float", value: "inf" },
    { kind: "float", value: "-inf" },
    { kind: "float", value: "nan" },
    { kind: "complex", real: 0, imag: "inf" },
    { kind: "float", value: 0.01 },
  ]);
  for (const text of ["1.5x", "", "0x1.8p1", " 1.5"]) {
    expect(() => parse(withConsts([textFloat(text)]))).toThrow(
      PythonPycFormatFailure,
    );
  }
});

it("accepts empty code names", () => {
  const child = marshalCode("py311", { name: "", qualname: "" });
  const report = parse(
    Buffer.concat([
      pythonPycHeader(3531),
      marshalCode("py311", {
        name: "",
        qualname: "",
        consts: [child],
      }),
    ]),
  );
  expect(root(report).name).toBe("");
  expect(root(report).qualname).toBe("");
  expect(root(report).consts[0]).toEqual({
    kind: "code",
    name: "",
    firstlineno: 1,
  });
  expect(report.code_objects[1]?.name).toBe("");
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
});

it("reports the marshal byte length of a string constant", () => {
  const report = parse(
    withConsts([
      marshalUnicode(Buffer.from([0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80])),
    ]),
  );
  expect(root(report).consts[0]).toMatchObject({ kind: "str", bytes: 6 });
});

it("applies Python container rules before reporting lengths", () => {
  const setOf = (...members: Buffer[]): Buffer =>
    Buffer.concat([Buffer.from([0x3c]), u32(members.length), ...members]);
  const int = (value: number): Buffer =>
    Buffer.concat([Buffer.from([0x69]), i32(value)]);
  expect(root(parse(withConsts([setOf(int(1), int(1))]))).consts[0]).toEqual({
    kind: "set",
    length: 1,
  });
  expect(
    root(parse(withConsts([setOf(Buffer.from([0x54]), int(1))]))).consts[0],
  ).toEqual({ kind: "set", length: 1 });
  expect(
    root(
      parse(
        withConsts([
          setOf(int(1), Buffer.concat([Buffer.from([0x67]), f64(1)])),
        ]),
      ),
    ).consts[0],
  ).toEqual({ kind: "set", length: 1 });
  expect(
    root(
      parse(
        withConsts([
          setOf(
            Buffer.concat([Buffer.from([0x67]), f64(Number.NaN)]),
            Buffer.concat([Buffer.from([0x67]), f64(Number.NaN)]),
          ),
        ]),
      ),
    ).consts[0],
  ).toEqual({ kind: "set", length: 2 });
  const sameNan = Buffer.concat([Buffer.from([0x67 | 0x80]), f64(Number.NaN)]);
  expect(
    root(parse(withConsts([setOf(sameNan, marshalRef(0))]))).consts[0],
  ).toEqual({ kind: "set", length: 1 });
  expect(
    root(
      parse(
        withConsts([
          Buffer.concat([Buffer.from([0x3e]), u32(2), int(1), int(1)]),
        ]),
      ),
    ).consts[0],
  ).toEqual({ kind: "frozenset", length: 1 });
  expect(
    root(parse(withConsts([Buffer.from([0x7b, 0x4e, 0x30])]))).consts[0],
  ).toEqual({ kind: "dict", length: 0 });
  const overwritten = Buffer.concat([
    Buffer.from([0x7b]),
    int(1),
    int(10),
    int(1),
    int(11),
    Buffer.from([0x30]),
  ]);
  expect(root(parse(withConsts([overwritten]))).consts[0]).toEqual({
    kind: "dict",
    length: 1,
  });
  const complexOne = Buffer.concat([Buffer.from([0x79]), f64(1), f64(0)]);
  expect(
    root(parse(withConsts([setOf(int(1), complexOne)]))).consts[0],
  ).toEqual({ kind: "set", length: 1 });
  expect(() =>
    parse(
      withConsts([
        Buffer.concat([
          Buffer.from([0x7b, 0x5b]),
          u32(0),
          Buffer.from([0x4e, 0x30]),
        ]),
      ]),
    ),
  ).toThrow(PythonPycFormatFailure);
  expect(() =>
    parse(withConsts([setOf(Buffer.concat([Buffer.from([0x5b]), u32(0)]))])),
  ).toThrow(PythonPycFormatFailure);
});

it("rejects a shared tuple key before its expansion doubles without bound", () => {
  const depth = 30;
  let body = Buffer.concat([Buffer.from([0xe9]), i32(1)]);
  for (let index = depth - 1; index >= 0; index -= 1)
    body = Buffer.concat([
      Buffer.from([0x29 | 0x80, 2]),
      body,
      marshalRef(index + 1),
    ]);
  const bytes = withConsts([
    Buffer.concat([Buffer.from([0x3c]), u32(1), body]),
  ]);
  const started = Date.now();
  expect(() => parse(bytes)).toThrow(PythonPycResourceFailure);
  expect(Date.now() - started).toBeLessThan(1000);
  let shallow = Buffer.concat([Buffer.from([0xe9]), i32(1)]);
  for (let index = 7; index >= 0; index -= 1)
    shallow = Buffer.concat([
      Buffer.from([0x29 | 0x80, 2]),
      shallow,
      marshalRef(index + 1),
    ]);
  expect(
    root(
      parse(
        withConsts([Buffer.concat([Buffer.from([0x3c]), u32(1), shallow])]),
      ),
    ).consts[0],
  ).toEqual({ kind: "set", length: 1 });
});

it("lists a shared container's code objects once per owner and charges each copy", () => {
  const child = marshalCode("py311", { name: "child", flagged: true });
  const copies = 40;
  const container = Buffer.concat([
    Buffer.from([0x28 | 0x80]),
    u32(copies),
    child,
    ...Array.from({ length: copies - 1 }, () => marshalRef(1)),
  ]);
  const repeated = Buffer.concat([
    pythonPycHeader(3531),
    marshalCode("py311", {
      consts: [container, ...Array.from({ length: 7 }, () => marshalRef(0))],
    }),
  ]);
  const started = Date.now();
  const shared = parse(repeated);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(shared.code_objects.map((code) => code.name)).toEqual([
    "<module>",
    "child",
  ]);
  expect(root(shared).nested_code).toEqual([1]);
  expect(JSON.stringify(shared).length).toBeLessThan(64 * 1024);

  const owners = 8;
  const ownedContainer = Buffer.concat([
    Buffer.from([0x28 | 0x80]),
    u32(copies),
    child,
    ...Array.from({ length: copies - 1 }, () => marshalRef(2)),
  ]);
  const first = marshalCode("py311", {
    name: "owner0",
    flagged: true,
    constsObject: ownedContainer,
  });
  const bytes = Buffer.concat([
    pythonPycHeader(3531),
    marshalCode("py311", {
      consts: [
        first,
        ...Array.from({ length: owners - 1 }, (_, index) =>
          marshalCode("py311", {
            name: `owner${index + 1}`,
            constsObject: marshalRef(1),
          }),
        ),
      ],
    }),
  ]);
  const report = parse(bytes);
  expect(report.code_objects.map((code) => code.name)).toEqual([
    "<module>",
    "owner0",
    "child",
    ...Array.from({ length: owners - 1 }, (_, index) => `owner${index + 1}`),
  ]);
  expect(report.code_objects[1]?.nested_code).toEqual([2]);
  expect(report.code_objects[3]?.nested_code).toEqual([2]);
  const relationships = report.code_objects.reduce(
    (sum, code) => sum + code.nested_code.length,
    0,
  );
  const constants = report.code_objects.reduce(
    (sum, code) => sum + code.consts.length,
    0,
  );
  expect(relationships).toBe(owners + owners);
  expect(constants).toBeGreaterThan(report.coverage.objects);
  const artifact = {
    path: defaults.path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
  expect(() =>
    parsePythonPyc(bytes, artifact, { ...defaults, max_objects: constants }),
  ).toThrow(PythonPycResourceFailure);
  expect(
    parsePythonPyc(bytes, artifact, {
      ...defaults,
      max_objects: constants + relationships,
    }).coverage.status,
  ).toBe("complete");
});

it("accepts code objects as set members and dictionary keys", () => {
  const setOf = (...members: Buffer[]): Buffer =>
    Buffer.concat([Buffer.from([0x3c]), u32(members.length), ...members]);
  const same = (filename: string): Buffer =>
    marshalCode("py311", { name: "f", filename, firstlineno: 3 });
  expect(
    root(parse(withConsts([setOf(same("a.py"), same("b.py"))]))).consts[0],
  ).toEqual({ kind: "set", length: 1 });
  expect(
    root(
      parse(
        withConsts([
          setOf(
            same("a.py"),
            marshalCode("py311", { name: "g", firstlineno: 3 }),
          ),
        ]),
      ),
    ).consts[0],
  ).toEqual({ kind: "set", length: 2 });
  const produced = Buffer.from(
    "cb0d0d0a000000000000000000000000e30000000000000000000000000000000000000000f3040000009700790029033e02000000e30000000000000000000000000100000000000000f308000000970064005a0079012902e9010000004e2901da0178a900f300000000fa04692e7079fa083c6d6f64756c653e720900000001000000730a000000f003010101d8020381017207000000e30000000000000000000000000100000000000000f308000000970064005a007901290272040000004e2901da01797206000000720700000072080000007209000000720900000001000000730a000000f003010101d80203810172070000007b7202000000e902000000304e720600000072060000007207000000fa046f2e707972090000007209000000010000007308000000f003010101d800047207000000",
    "hex",
  );
  const report = parse(produced);
  expect(root(report).consts[0]).toEqual({ kind: "frozenset", length: 2 });
  expect(root(report).consts[1]).toEqual({ kind: "dict", length: 1 });
  expect(report.code_objects.map((code) => code.name)).toEqual([
    "<module>",
    "<module>",
    "<module>",
  ]);
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
});

it("rejects code keys and members whose consts are unhashable", () => {
  const list = Buffer.concat([Buffer.from([0x5b]), u32(0)]);
  const int = Buffer.concat([Buffer.from([0x69]), i32(1)]);
  const tuple = (...items: Buffer[]): Buffer =>
    Buffer.concat([Buffer.from([0x29, items.length]), ...items]);
  const code = (...consts: Buffer[]): Buffer =>
    marshalCode("py311", { name: "u", qualname: "u", consts });
  const setOf = (kind: number, member: Buffer): Buffer =>
    Buffer.concat([Buffer.from([kind]), u32(1), member]);
  const dictKey = (key: Buffer): Buffer =>
    Buffer.concat([Buffer.from([0x7b]), key, int, Buffer.from([0x30])]);
  for (const key of [code(list), code(tuple(int, list)), code(code(list))]) {
    expect(() => parse(withConsts([setOf(0x3c, key)]))).toThrow(
      PythonPycFormatFailure,
    );
    expect(() => parse(withConsts([setOf(0x3e, key)]))).toThrow(
      PythonPycFormatFailure,
    );
    expect(() => parse(withConsts([dictKey(key)]))).toThrow(
      PythonPycFormatFailure,
    );
  }
  const cyclic = Buffer.concat([
    Buffer.from([0x29 | 0x80, 1]),
    marshalCode("py311", {
      name: "u",
      qualname: "u",
      flagged: true,
      constsObject: tuple(marshalRef(0)),
    }),
  ]);
  expect(() => parse(withConsts([cyclic, setOf(0x3c, marshalRef(1))]))).toThrow(
    PythonPycFormatFailure,
  );

  // A set inside a tuple that reaches the unfinished tuple, directly, inside
  // a code object's consts, or as those consts, before the list is read.
  for (const member of [
    marshalRef(0),
    marshalCode("py311", {
      name: "u",
      qualname: "u",
      constsObject: tuple(marshalRef(0)),
    }),
    marshalCode("py311", {
      name: "u",
      qualname: "u",
      constsObject: marshalRef(0),
    }),
  ])
    expect(() =>
      parse(
        withConsts([
          Buffer.concat([
            Buffer.from([0x29 | 0x80, 2]),
            setOf(0x3c, member),
            list,
          ]),
        ]),
      ),
    ).toThrow(PythonPycFormatFailure);

  const unhashed = parse(withConsts([tuple(code(list))]));
  expect(unhashed.coverage.status).toBe("complete");
  expect(unhashed.code_objects[1]?.consts[0]).toEqual({
    kind: "list",
    length: 0,
  });
  const hashable = parse(withConsts([setOf(0x3c, code(tuple(int)))]));
  expect(root(hashable).consts[0]).toEqual({ kind: "set", length: 1 });
  expect(hashable.coverage.status).toBe("complete");
});

it("keeps the first dictionary key when a later key compares equal", () => {
  const key = (filename: string): Buffer =>
    marshalCode("py311", {
      name: "f",
      qualname: "f",
      filename,
      firstlineno: 3,
    });
  const value = (name: string): Buffer =>
    marshalCode("py311", {
      name,
      qualname: name,
      filename: `${name}.py`,
    });
  const dict = Buffer.concat([
    Buffer.from([0x7b]),
    key("first.py"),
    value("old"),
    key("last.py"),
    value("new"),
    Buffer.from([0x30]),
  ]);
  const report = parse(withConsts([dict]));
  expect(root(report).consts[0]).toEqual({ kind: "dict", length: 1 });
  expect(report.code_objects.map((code) => [code.name, code.filename])).toEqual(
    [
      ["<module>", "sample.py"],
      ["f", "first.py"],
      ["new", "new.py"],
    ],
  );
  expect(root(report).nested_code).toEqual([1, 2]);
  expect(report.coverage.status).toBe("complete");
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
});

it("walks a wide dictionary once per child instead of copying it each step", () => {
  const keys = 8_000;
  const nested = marshalCode("py311", {
    name: "inside",
    qualname: "inside",
    filename: "inside.py",
  });
  const pieces: Buffer[] = [Buffer.from([0x7b])];
  for (let index = 0; index < keys; index += 1)
    pieces.push(
      Buffer.from([0x69]),
      i32(index),
      index === 0 ? nested : Buffer.from([0x4e]),
    );
  pieces.push(Buffer.from([0x30]));
  const bytes = withConsts([Buffer.concat(pieces)]);
  const started = Date.now();
  const report = parse(bytes);
  // Rebuilding the child list on every key took about 700ms for 8,000 entries.
  expect(Date.now() - started).toBeLessThan(250);
  expect(root(report).consts[0]).toEqual({ kind: "dict", length: keys });
  expect(root(report).nested_code).toEqual([1]);
  expect(report.code_objects[1]?.name).toBe("inside");
  expect(report.coverage.objects).toBeLessThanOrEqual(defaults.max_objects);
  expect(report.coverage.status).toBe("complete");
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
});

const parseWith = (bytes: Buffer, limits: Partial<typeof defaults> = {}) =>
  parsePythonPyc(
    bytes,
    {
      path: defaults.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
    { ...defaults, ...limits },
  );

it("preflights expanded shared code-name keys before building their hex table", () => {
  const width = 1000;
  const name = Buffer.alloc(1100, 0x61);
  const namesObject = Buffer.concat([
    Buffer.from([0x28]),
    i32(width),
    Buffer.from([0x61 | 0x80]),
    u32(name.length),
    name,
    ...Array.from({ length: width - 1 }, () => marshalRef(0)),
  ]);
  const child = marshalCode("py311", { namesObject });
  const bytes = withConsts([
    Buffer.concat([Buffer.from([0x3e]), u32(1), child]),
  ]);

  expect(() => parseWith(bytes, { max_string_bytes: 4096 })).toThrow(
    expect.objectContaining({
      boundary: "string",
      message: expect.stringContaining("max_string_bytes 4096"),
    }),
  );
});

it("keeps one descendant list when many wrappers share a container", () => {
  const children = 1800;
  const wrappers = 14_000;
  const child = marshalCode("py311", {
    name: "c",
    qualname: "c",
    filename: "a.py",
  });
  const pieces: Buffer[] = [
    Buffer.from([0x28]),
    u32(1 + wrappers),
    Buffer.from([0x28 | 0x80]),
    u32(children),
  ];
  for (let index = 0; index < children; index += 1) pieces.push(child);
  const shared = marshalRef(0);
  for (let index = 0; index < wrappers; index += 1)
    pieces.push(Buffer.from([0x29 | 0x80, 1]), shared);
  const bytes = Buffer.concat([
    pythonPycHeader(3531),
    marshalCode("py311", { constsObject: Buffer.concat(pieces) }),
  ]);
  const before = process.memoryUsage().heapUsed;
  const started = Date.now();
  const report = parseWith(bytes, { max_objects: 65_536 });
  const retained = process.memoryUsage().heapUsed - before;
  // 1,800 children and 14,000 wrappers: 49,612 reads, previously ~181 MiB.
  expect(Date.now() - started).toBeLessThan(5000);
  expect(retained).toBeLessThan(64 * 1024 * 1024);
  expect(report.coverage.objects).toBe(49_612);
  expect(report.code_objects).toHaveLength(children + 1);
  expect(root(report).nested_code).toHaveLength(children);
  expect(report.coverage.status).toBe("complete");
});

it("keeps code objects whose consts differ only by tuple shape", () => {
  const int = (value: number): Buffer =>
    Buffer.concat([Buffer.from([0x69]), i32(value)]);
  const tuple = (items: Buffer[]): Buffer =>
    Buffer.concat([Buffer.from([0x29, items.length]), ...items]);
  const code = (consts: Buffer): Buffer =>
    marshalCode("py311", {
      name: "f",
      qualname: "f",
      filename: "f.py",
      firstlineno: 1,
      constsObject: consts,
    });
  const frozen = Buffer.concat([
    Buffer.from([0x3e]),
    u32(2),
    code(tuple([tuple([int(1), int(2)])])),
    code(tuple([tuple([int(1)]), int(2)])),
  ]);
  const report = parse(withConsts([frozen]));
  expect(root(report).consts[0]).toEqual({ kind: "frozenset", length: 2 });
  expect(report.code_objects.map((code) => code.name)).toEqual([
    "<module>",
    "f",
    "f",
  ]);
  expect(report.coverage).toMatchObject({
    status: "complete",
    code_objects: 3,
  });
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
});

it("reports code inside a container that the code also references", () => {
  const list = Buffer.concat([
    Buffer.from([0x5b | 0x80]),
    u32(2),
    marshalCode("py311", {
      name: "a",
      qualname: "a",
      constsObject: Buffer.concat([Buffer.from([0x29, 1]), marshalRef(0)]),
    }),
    marshalCode("py311", { name: "b", qualname: "b" }),
  ]);
  const report = parse(withConsts([list]));
  expect(root(report).consts[0]).toEqual({ kind: "list", length: 2 });
  expect(report.code_objects.map((code) => code.name)).toEqual([
    "<module>",
    "a",
    "b",
  ]);
  expect(root(report).nested_code).toEqual([1, 2]);
  expect(report.code_objects[1]?.consts[0]).toEqual({
    kind: "list",
    length: 2,
  });
  expect(report.code_objects[1]?.nested_code).toEqual([1, 2]);
  expect(report.code_objects[2]?.nested_code).toEqual([]);
  expect(report.coverage.status).toBe("complete");
  expect(pythonPycSchema.safeParse(report).success).toBe(true);

  const cyclic = Buffer.concat([
    Buffer.from([0x5b | 0x80]),
    u32(2),
    marshalRef(0),
    marshalCode("py311", { name: "inside", qualname: "inside" }),
  ]);
  const cycle = parse(withConsts([cyclic]));
  expect(root(cycle).consts[0]).toEqual({ kind: "list", length: 2 });
  expect(cycle.code_objects.map((code) => code.name)).toEqual([
    "<module>",
    "inside",
  ]);
  expect(root(cycle).nested_code).toEqual([1]);
});

it("keeps distinct strings that JavaScript merges through surrogates", () => {
  const unicode = (bytes: Buffer): Buffer =>
    Buffer.concat([Buffer.from([0x75]), u32(bytes.length), bytes]);
  const first = Buffer.from([
    0xf0, 0x90, 0x80, 0x80, 0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80,
  ]);
  const second = Buffer.from([
    0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80, 0xf0, 0x90, 0x80, 0x80,
  ]);
  const dict = Buffer.concat([
    Buffer.from([0x7b]),
    unicode(first),
    marshalCode("py311", { name: "a", qualname: "a" }),
    unicode(second),
    marshalCode("py311", { name: "b", qualname: "b" }),
    Buffer.from([0x30]),
  ]);
  const report = parse(withConsts([dict]));
  expect(root(report).consts[0]).toEqual({ kind: "dict", length: 2 });
  expect(report.code_objects.map((code) => code.name)).toEqual([
    "<module>",
    "a",
    "b",
  ]);
  expect(root(report).nested_code).toEqual([1, 2]);
  expect(report.coverage.status).toBe("complete");
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
});

it("follows a long TYPE_REF chain without a recursive walk", () => {
  const links = 6000;
  const hidden = marshalCode("py311", {
    name: "hidden",
    qualname: "hidden",
  });
  const later = marshalCode("py311", {
    name: "later",
    qualname: "later",
    constsObject: Buffer.concat([
      Buffer.from([0x29, 1]),
      marshalRef(links - 1),
    ]),
  });
  const pieces: Buffer[] = [Buffer.from([0x28]), u32(links + 1)];
  for (let index = 0; index < links; index += 1) {
    pieces.push(Buffer.from([0x29 | 0x80, 1]));
    pieces.push(index === 0 ? hidden : marshalRef(index - 1));
  }
  pieces.push(later);
  const bytes = Buffer.concat([
    pythonPycHeader(3531),
    marshalCode("py311", { constsObject: Buffer.concat(pieces) }),
  ]);
  const started = Date.now();
  const report = parse(bytes);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(report.code_objects.map((code) => code.name)).toEqual([
    "<module>",
    "hidden",
    "later",
  ]);
  expect(report.code_objects[2]?.nested_code).toEqual([1]);
  expect(root(report).nested_code).toEqual([1, 2]);
  expect(report.coverage.status).toBe("complete");
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
});

it("rejects negative CPython code counts and keeps them out of the schema", () => {
  const negative = (
    layout: "py37" | "py311",
    fields: {
      argcount?: number;
      posonlyargcount?: number;
      kwonlyargcount?: number;
      nlocals?: number;
      stacksize?: number;
    },
  ) =>
    Buffer.concat([
      pythonPycHeader(layout === "py37" ? 3394 : 3531),
      marshalCode(layout, fields),
    ]);
  for (const field of [
    "argcount",
    "posonlyargcount",
    "kwonlyargcount",
    "stacksize",
  ] as const) {
    expect(() => parse(negative("py311", { [field]: 0xffffffff }))).toThrow(
      PythonPycFormatFailure,
    );
  }
  expect(() => parse(negative("py37", { nlocals: 0xffffffff }))).toThrow(
    /co_nlocals is negative/,
  );
  expect(() =>
    parse(negative("py311", { argcount: 1, posonlyargcount: 2 })),
  ).toThrow(/co_argcount is smaller than co_posonlyargcount/);
  expect(() => parse(negative("py311", { argcount: 0x7fffffff }))).toThrow(
    /co_varnames is too small/,
  );
  const high = parse(negative("py311", {}));
  expect(pythonPycSchema.safeParse(high).success).toBe(true);
  expect(
    pythonPycSchema.safeParse({
      ...high,
      code_objects: [{ ...root(high), argcount: 0x7fffffff }],
    }).success,
  ).toBe(true);
  expect(
    pythonPycSchema.safeParse({
      ...high,
      code_objects: [{ ...root(high), argcount: 0xffffffff }],
    }).success,
  ).toBe(false);
  expect(
    pythonPycSchema.safeParse({
      ...high,
      code_objects: [{ ...root(high), stacksize: 0xffffffff }],
    }).success,
  ).toBe(false);
});

it("keeps code objects whose name tables differ only by boundaries", () => {
  const frozen = (...members: Buffer[]): Buffer =>
    Buffer.concat([Buffer.from([0x3e]), u32(members.length), ...members]);
  const code = (
    layout: "py311" | "py38",
    fields: Parameters<typeof marshalCode>[1],
  ): Buffer =>
    marshalCode(layout, {
      name: "f",
      qualname: "f",
      filename: "f.py",
      firstlineno: 1,
      ...fields,
    });
  const split = parse(
    withConsts([
      frozen(
        code("py311", { names: [] }),
        code("py311", { names: [""] }),
        code("py311", { names: ["a\0b"] }),
        code("py311", { names: ["a", "b"] }),
        code("py311", { names: ["a"] }),
        code("py311", { names: ["a"], filename: "other.py" }),
      ),
    ]),
  );
  expect(root(split).consts[0]).toEqual({ kind: "frozenset", length: 5 });
  expect(split.code_objects).toHaveLength(6);
  expect(split.coverage).toMatchObject({ status: "complete", code_objects: 6 });
  expect(pythonPycSchema.safeParse(split).success).toBe(true);

  const tables = parse(
    Buffer.concat([
      pythonPycHeader(3439),
      marshalCode("py38", {
        consts: [
          frozen(
            code("py38", { varnames: ["a"], cellvars: ["b"] }),
            code("py38", { varnames: ["a", "b"] }),
            code("py38", { varnames: ["a"], freevars: ["b"] }),
          ),
        ],
      }),
    ]),
  );
  expect(root(tables).consts[0]).toEqual({ kind: "frozenset", length: 3 });
  expect(tables.code_objects).toHaveLength(4);
  expect(tables.coverage.status).toBe("complete");
});

it("hashes a long TYPE_REF tuple chain without recursing", () => {
  const links = 6000;
  // Outer pair is (tuple chain, ref to the set) so the set length is visible.
  // Small tuples are flagged in order; each one references the previous slot.
  const pieces: Buffer[] = [
    Buffer.from([0x29, 2, 0x28 | 0x80]),
    u32(links + 1),
    Buffer.from([0x29 | 0x80, 1, 0x69]),
    i32(1),
  ];
  for (let index = 1; index < links; index += 1)
    pieces.push(Buffer.from([0x29 | 0x80, 1]), marshalRef(index));
  pieces.push(
    Buffer.from([0x3c | 0x80]),
    u32(1),
    marshalRef(links),
    marshalRef(links + 1),
  );
  const bytes = Buffer.concat([
    pythonPycHeader(3531),
    marshalCode("py311", { constsObject: Buffer.concat(pieces) }),
  ]);
  expect(bytes.length).toBeLessThan(64_000);
  const started = Date.now();
  const report = parse(bytes);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(root(report).consts[0]).toEqual({ kind: "tuple", length: links + 1 });
  expect(root(report).consts[1]).toEqual({ kind: "set", length: 1 });
  expect(report.coverage.status).toBe("complete");
  expect(pythonPycSchema.safeParse(report).success).toBe(true);
});

it("rejects code CPython treats as corrupt instead of complete coverage", () => {
  const file = (
    layout: "py37" | "py38" | "py311",
    magic: number,
    fields: Parameters<typeof marshalCode>[1],
  ): Buffer =>
    Buffer.concat([pythonPycHeader(magic), marshalCode(layout, fields)]);
  expect(() =>
    parse(file("py311", 3531, { bytecode: Buffer.from([0x53]) })),
  ).toThrow(/co_code is malformed/);
  expect(() => parse(file("py311", 3531, { argcount: 100 }))).toThrow(
    /co_varnames is too small/,
  );
  expect(() =>
    parse(
      file("py311", 3531, {
        argcount: 1,
        localsplusnames: ["a"],
        localspluskinds: Buffer.from([0x00]),
      }),
    ),
  ).toThrow(/co_varnames is too small/);
  expect(() => parse(file("py311", 3531, { flags: CO_VARARGS }))).toThrow(
    /co_varnames is too small/,
  );
  expect(() => parse(file("py38", 3439, { argcount: 1 }))).toThrow(
    /co_varnames is too small/,
  );
  expect(() =>
    parse(file("py38", 3439, { argcount: 1, cellvars: ["a"] })),
  ).toThrow(/co_varnames is too small/);
  expect(() => parse(file("py37", 3394, { argcount: 1 }))).toThrow(
    /co_varnames is too small/,
  );
  expect(() => parse(file("py311", 3531, { flags: 0x80000000 }))).toThrow(
    /co_flags is negative/,
  );
  expect(() => parse(file("py38", 3411, { flags: 0x80000000 }))).toThrow(
    /co_flags is negative/,
  );
  expect(() => parse(file("py38", 3411, { stacksize: 0xffffffff }))).toThrow(
    /co_stacksize is negative/,
  );

  const valid = parse(
    file("py311", 3531, {
      argcount: 1,
      kwonlyargcount: 1,
      flags: CO_VARARGS,
      localsplusnames: ["a", "b", "c"],
      localspluskinds: Buffer.from([0x20, 0x20, 0x20]),
      bytecode: Buffer.alloc(0),
    }),
  );
  expect(root(valid).argcount).toBe(1);
  expect(valid.coverage.status).toBe("complete");
  const unknownPositiveFlags = parse(
    file("py311", 3531, { flags: 0x40000000 }),
  );
  expect(root(unknownPositiveFlags).flags).toBe(0x40000000);
  expect(unknownPositiveFlags.coverage.status).toBe("complete");
  const negativePy37Flags = parse(file("py37", 3394, { flags: 0x80000000 }));
  expect(root(negativePy37Flags).flags).toBe(-0x80000000);
  expect(pythonPycSchema.safeParse(negativePy37Flags).success).toBe(true);
  const negativePy37Stacksize = parse(
    file("py37", 3394, { stacksize: 0xffffffff }),
  );
  expect(root(negativePy37Stacksize).stacksize).toBe(-1);
  expect(pythonPycSchema.safeParse(negativePy37Stacksize).success).toBe(true);
  const negativePy38AlphaFlags = parse(
    file("py37", 3401, { flags: 0x80000000 }),
  );
  expect(root(negativePy38AlphaFlags).flags).toBe(-0x80000000);
  const ambiguousPy38Fields = parse(
    file("py38", 3410, { stacksize: 0xffffffff, flags: 0x80000000 }),
  );
  expect(root(ambiguousPy38Fields)).toMatchObject({
    stacksize: -1,
    flags: -0x80000000,
  });
  expect(ambiguousPy38Fields.limitations).toEqual(
    expect.arrayContaining([expect.stringContaining("Magic 3410 is shared")]),
  );
  const py37 = parse(
    file("py37", 3394, {
      argcount: 1,
      varnames: ["a"],
      bytecode: Buffer.from([0x53]),
    }),
  );
  expect(root(py37).argcount).toBe(1);
  expect(root(py37).bytecode.bytes).toBe(1);
  expect(py37.coverage.status).toBe("complete");
  expect(pythonPycSchema.safeParse(valid).success).toBe(true);
});

it("leaves 3.11 alpha magics with other code layouts unsupported", () => {
  for (const magic of [3452, 3459, 3460, 3493]) {
    const bytes = Buffer.concat([pythonPycHeader(magic), marshalCode("py311")]);
    expect(() => parse(bytes)).toThrow(
      expect.objectContaining({ kind: "unsupported" }),
    );
  }
  expect(
    parse(pythonPycFixture("py311", { magic: 3495 })).header,
  ).toMatchObject({ python_version: "3.11", code_layout: "py311" });
});

it.each([false, true])(
  "preserves a source-encoded lone surrogate at the preview boundary (truncated=%s)",
  (truncated) => {
    const text = Buffer.concat([
      Buffer.from("a".repeat(79)),
      Buffer.from([0xed, 0xa0, 0x80]),
      ...(truncated ? [Buffer.from("z")] : []),
    ]);
    const report = parse(withConsts([marshalUnicode(text)]));
    expect(root(report).consts[0]).toEqual({
      kind: "str",
      value: "a".repeat(79) + "\ud800",
      bytes: truncated ? 83 : 82,
      truncated,
    });
  },
);
