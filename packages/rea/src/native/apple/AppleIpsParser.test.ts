import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  appleIpsSchema,
  inspectAppleIpsInputSchema,
} from "../../domain/native/appleIps.js";
import {
  appleIpsBytes,
  appleIpsMetadataLine,
  appleIpsReport,
} from "../../../tests/fixtures/binaryDiagnostics/appleIps.js";
import {
  AppleIpsFormatFailure,
  AppleIpsResourceFailure,
} from "./AppleIps.errors.js";
import { parseAppleIps } from "./AppleIpsParser.js";

const input = inspectAppleIpsInputSchema.parse({
  path: "/artifacts/report.ips",
});

const artifact = (bytes: Buffer) => ({
  path: "/artifacts/report.ips",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
});

it.each(
  ["\f", "\v", "\u00a0", "\ufeff"].flatMap((character) =>
    ["metadata suffix", "body prefix", "body suffix"].map((position) => ({
      character,
      position,
    })),
  ),
)(
  "rejects non-JSON whitespace at $position: $character",
  ({ character, position }) => {
    const metadata = appleIpsMetadataLine();
    const body = '{"threads":[],"usedImages":[]}';
    const bytes = Buffer.from(
      position === "metadata suffix"
        ? `${metadata}${character}\n${body}`
        : position === "body prefix"
          ? `${metadata}\n${character}${body}`
          : `${metadata}\n${body}${character}`,
    );
    expect(() => parseAppleIps(bytes, artifact(bytes), input)).toThrow(
      AppleIpsFormatFailure,
    );
  },
);

it("accepts only JSON whitespace around each object", () => {
  const bytes = Buffer.from(
    ` \t${appleIpsMetadataLine()} \t\r\n \t\r\n{"threads":[],"usedImages":[]} \t\r\n`,
  );
  expect(parseAppleIps(bytes, artifact(bytes), input).coverage.status).toBe(
    "complete",
  );
});

it.each([
  "not-a-uuid",
  "Z".repeat(32),
  `A-${"A".repeat(31)}`,
  ` ${"A".repeat(32)}`,
])("retains malformed UUID spelling %s in partial coverage", (recorded) => {
  const parsed = parse(
    withBody(
      JSON.stringify({
        threads: [],
        usedImages: [{ uuid: recorded, arch: "arm64" }],
      }),
    ),
  );
  expect(parsed.images[0]).toMatchObject({ uuid: null, uuid_unknown: true });
  expect(parsed.coverage.status).toBe("partial");
  expect(parsed.coverage.type_mismatches).toEqual([
    {
      path: "body.usedImages[0].uuid",
      expected: "32 hexadecimal UUID digits with optional canonical hyphens",
      observed: "malformed UUID string",
      recorded_value: recorded,
    },
  ]);
});

const integerAmplificationBytes = (): Buffer => {
  const base = `1${"0".repeat(20000)}`;
  const frames = Array.from(
    { length: 512 },
    () => '{"imageIndex":0,"imageOffset":1}',
  ).join(",");
  return Buffer.from(
    `${appleIpsMetadataLine()}\n{"faultingThread":0,"threads":[{"frames":[${frames}]}],"usedImages":[{"base":${base},"size":4096,"arch":"arm64"}]}`,
  );
};

it("retains image metadata once while frames refer to its owner", () => {
  const arch = "unknown_arch_" + "x".repeat(20000);
  const uuid = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
  const frames = Array.from(
    { length: 512 },
    () => '{"imageIndex":0,"imageOffset":1}',
  ).join(",");
  const bytes = Buffer.from(
    `${appleIpsMetadataLine()}\n{"faultingThread":0,"threads":[{"frames":[${frames}]}],"usedImages":[{"base":4294967296,"size":4096,"arch":${JSON.stringify(arch)},"uuid":${JSON.stringify(uuid)}}]}`,
  );
  const report = parseAppleIps(bytes, artifact(bytes), input);
  expect(report.images[0]).toMatchObject({ arch, uuid });
  expect(report.threads[0]?.frames).toHaveLength(512);
  expect(report.threads[0]?.frames[0]?.image_index).toBe(0);
  const serialized = JSON.stringify(report);
  expect(serialized.split(arch)).toHaveLength(2);
  expect(serialized.split(uuid)).toHaveLength(2);
});

it("refuses integer text amplification before retaining every derived address", () => {
  const bytes = integerAmplificationBytes();
  expect(bytes.length).toBeLessThan(input.max_file_bytes);
  expect(() => parseAppleIps(bytes, artifact(bytes), input)).toThrow(
    expect.objectContaining({
      boundary: "integer_text",
      maximum: 8 * 1024 * 1024,
    }),
  );
});

it("honors a larger integer text allowance without changing decimal facts", () => {
  const bytes = integerAmplificationBytes();
  const options = inspectAppleIpsInputSchema.parse({
    path: input.path,
    max_integer_text_bytes: 64 * 1024 * 1024,
  });
  const report = parseAppleIps(bytes, artifact(bytes), options);
  expect(report.threads[0]?.frames).toHaveLength(512);
  expect(report.images[0]?.base?.decimal).toBe(`1${"0".repeat(20000)}`);
  expect(report.threads[0]?.frames[511]?.runtime_address?.decimal).toBe(
    `1${"0".repeat(19999)}1`,
  );
});

it("reads a 309 crash report, uppercase UUID, and lossless register", () => {
  const bytes = appleIpsBytes();
  const report = parseAppleIps(bytes, artifact(bytes), input);
  expect(report.metadata.bug_type).toBe("309");
  expect(report.exception?.type).toBe("EXC_BAD_ACCESS");
  expect(report.exception?.signal).toBe("SIGSEGV");
  expect(report.images[0]?.uuid).toBe("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA");
  expect(report.images[0]?.source_meaning).toBe("process");
  expect(report.images[1]?.uuid_unknown).toBe(true);
  expect(report.threads[0]?.frames[0]).toMatchObject({
    role: "faulting_instruction",
    recorded_symbol: "rea_fixture_fault",
  });
  expect(report.threads[0]?.registers[0]).toMatchObject({
    name: "x0",
    value: {
      decimal: "9594637537912899908",
      hex: "0x8527000193ed4944",
    },
  });
  expect(report.classification.status).toBe("unclassified");
  expect(report.threads[0]?.frames[0]?.runtime_address?.hex).toBe(
    "0x100000338",
  );
});

it("refuses a stackshot bug_type without a crash body", () => {
  const bytes = appleIpsBytes({ bugType: "288" });
  expect(() => parseAppleIps(bytes, artifact(bytes), input)).toThrow(
    AppleIpsFormatFailure,
  );
  try {
    parseAppleIps(bytes, artifact(bytes), input);
  } catch (cause) {
    expect(cause).toMatchObject({
      kind: "unsupported",
      message: expect.stringContaining("288"),
    });
  }
});

it("fails closed on a truncated crash body", () => {
  const bytes = appleIpsBytes({ truncateBody: true });
  expect(() => parseAppleIps(bytes, artifact(bytes), input)).toThrow(
    AppleIpsFormatFailure,
  );
});

it("matches documented watchdog, guard, PAC and dyld rules", () => {
  const watchdog = parseAppleIps(
    appleIpsBytes({ terminationCode: "2343432205" }),
    artifact(appleIpsBytes({ terminationCode: "2343432205" })),
    input,
  );
  expect(watchdog.classification.matches.map((row) => row.rule)).toEqual([
    "watchdog",
  ]);
  const guard = parseAppleIps(
    appleIpsBytes({
      exceptionType: "EXC_GUARD",
      subtype: "GUARD_TYPE_FD",
    }),
    artifact(
      appleIpsBytes({ exceptionType: "EXC_GUARD", subtype: "GUARD_TYPE_FD" }),
    ),
    input,
  );
  expect(guard.classification.matches[0]?.rule).toBe("guarded_file_descriptor");
  const pac = parseAppleIps(
    appleIpsBytes({
      subtype: "KERN_INVALID_ADDRESS (possible pointer authentication failure)",
    }),
    artifact(
      appleIpsBytes({
        subtype:
          "KERN_INVALID_ADDRESS (possible pointer authentication failure)",
      }),
    ),
    input,
  );
  expect(pac.classification.matches[0]?.rule).toBe(
    "possible_pointer_authentication_failure",
  );
  const dyld = parseAppleIps(
    appleIpsBytes({
      terminationNamespace: "DYLD",
      terminationIndicator: "Library missing",
      terminationReasons: ["Library not loaded: @rpath/libreamissing.dylib"],
    }),
    artifact(
      appleIpsBytes({
        terminationNamespace: "DYLD",
        terminationIndicator: "Library missing",
        terminationReasons: ["Library not loaded: @rpath/libreamissing.dylib"],
      }),
    ),
    input,
  );
  expect(dyld.classification.matches[0]).toMatchObject({
    rule: "dyld_missing_library",
  });
});

it("retains an empty image path and accepts CRLF line endings", () => {
  const bytes = appleIpsBytes();
  const crlf = Buffer.from(appleIpsReport().replaceAll("\n", "\r\n"), "utf8");
  const report = parseAppleIps(bytes, artifact(bytes), input);
  expect(report.images[1]?.path).toBe("");
  const crlfReport = parseAppleIps(crlf, artifact(crlf), input);
  expect(crlfReport.metadata.bug_type).toBe("309");
  expect(crlfReport.threads[0]?.frames[0]?.role).toBe("faulting_instruction");
});

it("fails closed when the image budget is exhausted", () => {
  const bytes = appleIpsBytes();
  expect(() =>
    parseAppleIps(
      bytes,
      artifact(bytes),
      inspectAppleIpsInputSchema.parse({
        path: "/artifacts/report.ips",
        max_images: 1,
      }),
    ),
  ).toThrow(AppleIpsResourceFailure);
});

const parse = (bytes: Buffer, options: Record<string, number> = {}) =>
  parseAppleIps(
    bytes,
    artifact(bytes),
    inspectAppleIpsInputSchema.parse({
      path: "/artifacts/report.ips",
      ...options,
    }),
  );

const withBody = (body: string): Buffer =>
  Buffer.from(`${appleIpsMetadataLine()}\n${body}`, "utf8");

it("keeps empty observed text and JSON keys distinct from omitted fields", () => {
  const bytes = Buffer.from(
    '{"bug_type":"309","":0}\n{"procName":"","osVersion":"","threads":[{"threadState":{"":0},"frames":[{"symbol":""},{}]}],"usedImages":[{"source":"","arch":"","uuid":"","path":""},{}],"":0}',
  );
  const parsed = appleIpsSchema.parse(parse(bytes));
  expect(parsed.metadata.unlisted_keys).toEqual([""]);
  expect(parsed.unlisted_body_keys).toEqual([""]);
  expect(parsed.process.name).toBe("");
  expect(parsed.process.path).toBeNull();
  expect(parsed.process.os_version).toEqual({ form: "text", text: "" });
  expect(parsed.threads[0]?.registers[0]).toMatchObject({
    name: "",
    value: { decimal: "0", hex: "0x0" },
  });
  expect(
    parsed.threads[0]?.frames.map((frame) => frame.recorded_symbol),
  ).toEqual(["", null]);
  expect(parsed.images[0]).toMatchObject({
    source: "",
    source_meaning: null,
    arch: "",
    uuid: null,
    uuid_unknown: true,
    path: "",
  });
  expect(parsed.images[1]?.path).toBeNull();
  expect(parsed.classification.status).toBe("unclassified");
  expect(parsed.coverage.type_mismatches).toEqual([
    {
      path: "body.usedImages[0].uuid",
      expected: "32 hexadecimal UUID digits with optional canonical hyphens",
      observed: "malformed UUID string",
      recorded_value: "",
    },
  ]);
});

it("keeps an empty recorded architecture without claiming a UUID join", () => {
  const parsed = parse(
    withBody(
      '{"threads":[],"usedImages":[{"arch":"","uuid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}',
    ),
  );
  expect(parsed.images[0]).toMatchObject({
    arch: "",
    uuid: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
    uuid_unknown: true,
  });
  expect(parsed.coverage.status).toBe("complete");
});

it("does not copy empty source text into classification match fields", () => {
  const parsed = parse(
    withBody(
      '{"threads":[],"usedImages":[],"exception":{"type":"","subtype":"KERN_INVALID_ADDRESS (possible pointer authentication failure)"},"termination":{"namespace":"DYLD","indicator":"","reasons":["Library not loaded: @rpath/missing.dylib"]}}',
    ),
  );
  expect(parsed.exception?.type).toBe("");
  expect(parsed.termination?.indicator).toBe("");
  expect(parsed.classification.matches.map((match) => match.rule)).toEqual([
    "possible_pointer_authentication_failure",
    "dyld_missing_library",
  ]);
  expect(
    parsed.classification.matches.flatMap((match) => match.fields),
  ).not.toContainEqual(expect.objectContaining({ value: "" }));
  expect(appleIpsSchema.safeParse(parsed).success).toBe(true);
});

const report = (options: Parameters<typeof appleIpsReport>[0]) =>
  parse(appleIpsBytes(options));

it("keeps ReportCrash-shaped producer facts and reports complete coverage", () => {
  const parsed = report({});
  expect(parsed.process.os_version).toEqual({
    form: "structured",
    train: "macOS 15.0",
    build: "24A335",
    release_type: "User",
    is_embedded: null,
    unlisted_keys: [],
  });
  expect(
    report({ osVersionText: "Version 15.0 (Build 24A335)" }).process.os_version,
  ).toEqual({
    form: "text",
    text: "Version 15.0 (Build 24A335)",
  });
  expect(parsed.threads[0]?.state_flavor).toBe("ARM_THREAD_STATE64");
  expect(parsed.threads[0]?.registers.map((row) => row.name)).toEqual([
    "x0",
    "x1",
    "lr",
    "esr",
    "pc",
    "far",
  ]);
  expect(parsed.threads[0]?.registers[3]).toEqual({
    name: "esr",
    value: { decimal: "2449473606", hex: "0x92000046" },
    description: "(Data Abort) byte read Translation fault",
  });
  expect(parsed.exception?.unlisted_keys).toEqual(["rawCodes"]);
  expect(parsed.termination?.unlisted_keys).toEqual([]);
  expect(parsed.unlisted_body_keys).toContain("sharedCache");
  expect(parsed.unlisted_body_keys).not.toContain("osVersion");
  expect(parsed.metadata.unlisted_keys).toContain("slice_uuid");
  expect(parsed.coverage).toEqual({
    status: "complete",
    reason: null,
    threads: 2,
    frames: 5,
    images: 2,
    registers: 6,
    type_mismatches: [],
  });
});

it("keeps the documented terminating process, parent pid and metadata members", () => {
  const parsed = report({});
  expect(parsed.termination).toMatchObject({
    flags: { decimal: "0", hex: "0x0" },
    by_pid: { decimal: "4242", hex: "0x1092" },
    by_proc: "exc handler",
  });
  expect(parsed.process.parent_pid).toEqual({ decimal: "100", hex: "0x64" });
  expect(parsed.metadata).toMatchObject({
    build_version: "",
    platform: { decimal: "1", hex: "0x1" },
  });
  expect(parsed.metadata.unlisted_keys).not.toContain("build_version");
  expect(parsed.metadata.unlisted_keys).not.toContain("platform");
  expect(parsed.unlisted_body_keys).not.toContain("parentPid");
  expect(parsed.coverage.status).toBe("complete");
  const wrong = parse(
    Buffer.from(
      appleIpsReport().replace('"byPid": 4242', '"byPid": "4242"'),
      "utf8",
    ),
  );
  expect(wrong.termination?.by_pid).toBeNull();
  expect(wrong.coverage.type_mismatches).toContainEqual(
    expect.objectContaining({
      path: "body.termination.byPid",
      expected: "integer",
    }),
  );
});

it("keeps the recorded image name and symbol offset", () => {
  const parsed = report({});
  expect(parsed.images.map((image) => image.name)).toEqual([
    "rea-crash-fixture",
    null,
  ]);
  expect(parsed.threads[0]?.frames[0]).toMatchObject({
    recorded_symbol: "rea_fixture_fault",
    symbol_location: { decimal: "12", hex: "0xc" },
  });
  expect(parsed.threads[1]?.frames[0]?.symbol_location).toEqual({
    decimal: "0",
    hex: "0x0",
  });
  expect(parsed.coverage.status).toBe("complete");
  const wrong = parse(
    Buffer.from(
      appleIpsReport().replace(
        '"symbolLocation": 12',
        '"symbolLocation": "12"',
      ),
      "utf8",
    ),
  );
  expect(wrong.threads[0]?.frames[0]?.symbol_location).toBeNull();
  expect(wrong.coverage.type_mismatches).toContainEqual(
    expect.objectContaining({
      path: "body.threads[0].frames[0].symbolLocation",
      expected: "integer",
    }),
  );
});

it("assigns frame roles by recorded row without inventing inline stack addresses", () => {
  const roles = (parsed: ReturnType<typeof parse>) =>
    parsed.threads.map((thread) => thread.frames.map((frame) => frame.role));
  expect(roles(report({}))).toEqual([
    ["faulting_instruction", "return_address"],
    ["current_instruction", "return_address", "return_address"],
  ]);
  expect(report({}).threads[1]?.frames[0]?.inline).toBe(true);
  const unknownFault = parse(
    Buffer.from(appleIpsReport().replace('"faultingThread": 0,', ""), "utf8"),
  );
  expect(unknownFault.faulting_thread).toBeNull();
  expect(roles(unknownFault)).toEqual([
    ["unknown", "return_address"],
    ["unknown", "return_address", "return_address"],
  ]);
});

it.each(["5", "4294967295"])(
  "preserves unresolved faulting index %s without establishing top-frame roles",
  (index) => {
    const parsed = parse(
      withBody(
        `{"faultingThread":${index},"threads":[{"frames":[{},{}]}],"usedImages":[]}`,
      ),
    );
    expect(parsed.faulting_thread).toBe(Number(index));
    expect(parsed.threads[0]?.frames.map((frame) => frame.role)).toEqual([
      "unknown",
      "return_address",
    ]);
    expect(parsed.coverage.status).toBe("partial");
    expect(parsed.coverage.type_mismatches).toContainEqual(
      expect.objectContaining({
        path: "body.faultingThread",
        recorded_integer: index,
      }),
    );
  },
);

it("does not resolve a faulting reference to a malformed thread row", () => {
  const parsed = parse(
    withBody(
      '{"faultingThread":0,"threads":[null,{"frames":[{}]}],"usedImages":[]}',
    ),
  );
  expect(parsed.faulting_thread).toBe(0);
  expect(parsed.threads[1]?.frames[0]?.role).toBe("unknown");
  expect(parsed.coverage.type_mismatches).toContainEqual(
    expect.objectContaining({
      path: "body.faultingThread",
      recorded_integer: "0",
    }),
  );
});

it.each(["-1", "4294967296", `1${"0".repeat(1000)}`])(
  "preserves rejected index spelling (case %#)",
  (index) => {
    const parsed = parse(
      withBody(
        `{"faultingThread":${index},"threads":[{"frames":[{"imageIndex":${index}}]}],"usedImages":[]}`,
      ),
    );
    expect(parsed.faulting_thread).toBeNull();
    expect(parsed.threads[0]?.frames[0]?.image_index).toBeNull();
    expect(
      parsed.coverage.type_mismatches.map(
        (mismatch) => mismatch.recorded_integer,
      ),
    ).toEqual([index, index]);
  },
);

it("bounds rejected index text before retaining it", () => {
  // A bare metadata line: its recorded platform integer would also count toward this allowance.
  const bytes = Buffer.from(
    '{"bug_type":"309"}\n{"faultingThread":4294967296,"threads":[],"usedImages":[]}',
    "utf8",
  );
  expect(() =>
    parseAppleIps(bytes, artifact(bytes), {
      ...input,
      max_integer_text_bytes: 19,
    }),
  ).toThrow(expect.objectContaining({ boundary: "integer_text", maximum: 19 }));
  const parsed = parseAppleIps(bytes, artifact(bytes), {
    ...input,
    max_integer_text_bytes: 20,
  });
  expect(parsed.coverage.type_mismatches[0]).toMatchObject({
    recorded_integer: "4294967296",
  });
});

it("leaves inline addresses unknown when their own offset is absent", () => {
  const parsed = parse(
    withBody(
      '{"faultingThread":0,"threads":[{"frames":[{"imageIndex":0,"inline":true},{"imageIndex":0,"imageOffset":8,"inline":true},{"imageIndex":1,"imageOffset":16}]}],"usedImages":[{"base":4096},{"base":8192}]}',
    ),
  );
  expect(
    parsed.threads[0]?.frames.map(
      (frame) => frame.runtime_address?.decimal ?? null,
    ),
  ).toEqual([null, "4104", "8208"]);
  expect(
    parsed.threads[0]?.frames.map(
      (frame) => frame.image_offset?.decimal ?? null,
    ),
  ).toEqual([null, "8", "16"]);
});

it("preserves an unresolved image index without claiming complete coverage", () => {
  const parsed = parse(
    withBody(
      '{"threads":[{"frames":[{"imageIndex":7,"imageOffset":8}]}],"usedImages":[]}',
    ),
  );
  expect(parsed.threads[0]?.frames[0]).toMatchObject({
    image_index: 7,
    image_offset: { decimal: "8" },
    runtime_address: null,
  });
  expect(parsed.coverage.status).toBe("partial");
  expect(parsed.coverage.type_mismatches[0]).toMatchObject({
    path: "body.threads[0].frames[0].imageIndex",
    recorded_integer: "7",
  });
});

it("classifies SIGKILL codes by canonical hex, not a near-miss decimal", () => {
  const rules = (code: string) =>
    report({ terminationCode: code }).classification.matches;
  expect(rules("3735933132")).toEqual([]);
  expect(rules("3735883980")).toEqual([
    {
      rule: "dead10cc",
      fields: [
        { name: "termination.code", value: "3735883980" },
        { name: "termination.code_hex", value: "0xdead10cc" },
      ],
    },
  ]);
  expect(rules("3221229823").map((row) => row.rule)).toEqual(["thermal"]);
});

it("reports wrong-type collections as partial instead of empty and complete", () => {
  const parsed = parse(
    withBody(
      '{"procName":"x","threads":{"0":{}},"usedImages":"none","exception":{"type":"EXC_CRASH"}}',
    ),
  );
  expect(parsed.threads).toEqual([]);
  expect(parsed.images).toEqual([]);
  expect(parsed.exception?.type).toBe("EXC_CRASH");
  expect(parsed.coverage.status).toBe("partial");
  expect(parsed.coverage.reason).toMatch(/type_mismatches/u);
  expect(parsed.coverage.type_mismatches).toEqual([
    { path: "body.usedImages", expected: "array", observed: "string" },
    { path: "body.threads", expected: "array", observed: "object" },
  ]);
  const absent = parse(withBody('{"procName":"x"}'));
  expect(absent.coverage.type_mismatches).toEqual([
    { path: "body.usedImages", expected: "array", observed: "absent" },
    { path: "body.threads", expected: "array", observed: "absent" },
  ]);
  const empty = parse(withBody('{"threads":[],"usedImages":[]}'));
  expect(empty.coverage.status).toBe("complete");
});

it("keeps the nested Rosetta registers of a translated process", () => {
  const parsed = parse(
    withBody(`{
      "translated": true,
      "threads": [
        {
          "threadState": {
            "flavor": "x86_THREAD_STATE",
            "rip": { "value": 4294983680 },
            "rosetta": { "tmp0": { "value": 7 }, "tmp1": 8 }
          }
        }
      ],
      "usedImages": []
    }`),
  );
  expect(parsed.threads[0]?.registers).toEqual([
    {
      name: "rip",
      value: { decimal: "4294983680", hex: "0x100004000" },
      description: null,
    },
    {
      name: "rosetta.tmp0",
      value: { decimal: "7", hex: "0x7" },
      description: null,
    },
    {
      name: "rosetta.tmp1",
      value: { decimal: "8", hex: "0x8" },
      description: null,
    },
  ]);
  expect(parsed.coverage).toMatchObject({
    status: "complete",
    registers: 3,
    type_mismatches: [],
  });
});

it.each([
  { rosetta: "7", observed: "integer" },
  { rosetta: '"invalid"', observed: "string" },
  { rosetta: "[]", observed: "array" },
])(
  "reports a $observed Rosetta container without losing ordinary registers",
  ({ rosetta, observed }) => {
    const parsed = parse(
      withBody(`{
      "threads": [{ "threadState": { "rip": 1, "rosetta": ${rosetta}, "rsp": 2 } }],
      "usedImages": []
    }`),
      { max_registers: 2 },
    );
    expect(parsed.threads[0]?.registers.map(({ name }) => name)).toEqual([
      "rip",
      "rsp",
    ]);
    expect(parsed.coverage).toMatchObject({
      status: "partial",
      registers: 2,
      type_mismatches: [
        {
          path: "body.threads[0].threadState.rosetta",
          expected: "object",
          observed,
        },
      ],
    });
  },
);

it("records wrong-type rows, scalars and registers with their source path", () => {
  const parsed = parse(
    withBody(`{
      "pid": "4242",
      "osVersion": 15,
      "faultingThread": -1,
      "termination": { "code": 1.5, "reasons": ["ok", 7] },
      "threads": [
        7,
        {
          "frames": [{ "imageIndex": 99999999999, "imageOffset": "8" }, []],
          "threadState": { "flavor": 1, "x": [1, "two", { "value": null }, {}], "rosetta": { "tmp0": "one" } }
        }
      ],
      "usedImages": [null, { "base": 1.0 }]
    }`),
  );
  expect(parsed.process.pid).toBeNull();
  expect(parsed.faulting_thread).toBeNull();
  expect(parsed.termination?.reasons).toEqual(["ok"]);
  expect(parsed.threads).toHaveLength(2);
  expect(parsed.threads[1]?.registers).toEqual([
    { name: "x0", value: { decimal: "1", hex: "0x1" }, description: null },
  ]);
  expect(parsed.images).toHaveLength(2);
  expect(parsed.coverage.status).toBe("partial");
  expect(parsed.coverage.type_mismatches).toEqual([
    { path: "body.usedImages[0]", expected: "object", observed: "null" },
    {
      path: "body.usedImages[1].base",
      expected: "integer",
      observed: "number",
    },
    {
      path: "body.faultingThread",
      expected: "unsigned 32-bit integer",
      observed: "integer out of range",
      recorded_integer: "-1",
    },
    { path: "body.threads[0]", expected: "object", observed: "integer" },
    {
      path: "body.threads[1].frames[0].imageIndex",
      expected: "unsigned 32-bit integer",
      observed: "integer out of range",
      recorded_integer: "99999999999",
    },
    {
      path: "body.threads[1].frames[0].imageOffset",
      expected: "integer",
      observed: "string",
    },
    {
      path: "body.threads[1].frames[1]",
      expected: "object",
      observed: "array",
    },
    {
      path: "body.threads[1].threadState.x[1]",
      expected: "integer or object with integer value",
      observed: "string",
    },
    {
      path: "body.threads[1].threadState.x[3].value",
      expected: "integer",
      observed: "absent",
    },
    {
      path: "body.threads[1].threadState.rosetta.tmp0",
      expected: "integer or object with integer value",
      observed: "string",
    },
    {
      path: "body.threads[1].threadState.flavor",
      expected: "string",
      observed: "integer",
    },
    {
      path: "body.termination.code",
      expected: "integer",
      observed: "number",
    },
    {
      path: "body.termination.reasons[1]",
      expected: "string",
      observed: "integer",
    },
    { path: "body.pid", expected: "integer", observed: "string" },
    {
      path: "body.osVersion",
      expected: "string or object",
      observed: "integer",
    },
  ]);
});

it("refuses invalid UTF-8 instead of replacing bytes", () => {
  const valid = appleIpsBytes({ procName: "rea-é" });
  const offset = valid.indexOf(Buffer.from("é", "utf8"));
  const corrupt = Buffer.from(valid);
  corrupt[offset] = 0xff;
  expect(parse(valid).process.name).toBe("rea-é");
  expect(() => parse(corrupt)).toThrow(
    expect.objectContaining({
      kind: "malformed",
      message: expect.stringMatching(/UTF-8/u),
    }),
  );
});

const registerFlood = (count: number): Buffer =>
  withBody(
    `{"threads":[{"threadState":{"x":[${Array.from({ length: count }, () => "0").join(",")}]}}],"usedImages":[]}`,
  );

it("budgets register slots before expanding threadState rows", () => {
  const flood = registerFlood(150_000);
  expect(flood.length).toBeLessThan(400_000);
  expect(() => parse(flood)).toThrow(
    expect.objectContaining({ boundary: "registers", maximum: 16384 }),
  );
  expect(parse(registerFlood(4), { max_registers: 4 }).coverage.registers).toBe(
    4,
  );
  expect(() => parse(registerFlood(5), { max_registers: 4 })).toThrow(
    AppleIpsResourceFailure,
  );
});

it("budgets Rosetta registers with the ordinary registers they follow", () => {
  const rosetta = (third: string): Buffer =>
    withBody(
      `{"threads":[{"threadState":{"x":[0],"rosetta":{"tmp0":0,"tmp1":0,"tmp2":${third}}}}],"usedImages":[]}`,
    );
  expect(parse(rosetta("0"), { max_registers: 4 }).coverage).toMatchObject({
    status: "complete",
    registers: 4,
  });
  // The register past the allowance is invalid JSON; the budget must refuse first.
  expect(() => parse(rosetta("?"), { max_registers: 3 })).toThrow(
    expect.objectContaining({ boundary: "registers", maximum: 3 }),
  );
});

it("keeps valid registers around a malformed Rosetta member at the exact slot limit", () => {
  const parsed = parse(
    withBody(`{
      "translated": true,
      "threads": [{
        "threadState": {
          "flavor": "x86_THREAD_STATE",
          "rip": { "value": 1 },
          "rosetta": { "tmp0": { "value": 2 }, "tmp1": "invalid" },
          "rsp": { "value": 3 }
        }
      }],
      "usedImages": []
    }`),
    { max_registers: 4 },
  );
  expect(parsed.threads[0]?.registers.map(({ name }) => name)).toEqual([
    "rip",
    "rosetta.tmp0",
    "rsp",
  ]);
  expect(parsed.coverage).toMatchObject({
    status: "partial",
    registers: 3,
    type_mismatches: [
      {
        path: "body.threads[0].threadState.rosetta.tmp1",
        expected: "integer or object with integer value",
        observed: "string",
      },
    ],
  });
});

it("shares the register allowance across Rosetta groups and later ordinary registers", () => {
  const mixed = (last: string): Buffer =>
    withBody(
      `{"threads":[{"threadState":{"rosetta":{"tmp0":0}}},{"threadState":{"rosetta":{"tmp1":0},"rip":${last}}}],"usedImages":[]}`,
    );
  expect(parse(mixed("0"), { max_registers: 3 }).coverage).toMatchObject({
    status: "complete",
    registers: 3,
  });
  expect(() => parse(mixed("?"), { max_registers: 2 })).toThrow(
    expect.objectContaining({ boundary: "registers", maximum: 2 }),
  );
});

it("refuses an over-budget collection before parsing the rows past the allowance", () => {
  // Rows after the allowance are invalid JSON; the budget must refuse first.
  const threads = withBody(`{"threads":[{},{},{},?],"usedImages":[]}`);
  expect(() => parse(threads, { max_threads: 3 })).toThrow(
    expect.objectContaining({ boundary: "threads", maximum: 3 }),
  );
  const frames = withBody(
    `{"threads":[{"frames":[{},{}]},{"frames":[{},?]}],"usedImages":[]}`,
  );
  expect(() => parse(frames, { max_frames: 3 })).toThrow(
    expect.objectContaining({ boundary: "frames", maximum: 3 }),
  );
  const images = withBody(`{"threads":[],"usedImages":[{},?]}`);
  expect(() => parse(images, { max_images: 1 })).toThrow(
    expect.objectContaining({ boundary: "images", maximum: 1 }),
  );
});

it("skips unconsumed producer members and bounds fixed structural allowances", () => {
  const skipped = parse(
    withBody(
      `{"threads":[],"usedImages":[],"lastExceptionBacktrace":[${Array.from({ length: 100_000 }, () => "{}").join(",")}]}`,
    ),
  );
  expect(skipped.coverage.status).toBe("complete");
  expect(skipped.unlisted_body_keys).toEqual(["lastExceptionBacktrace"]);
  const keys = Array.from(
    { length: 1025 },
    (_, index) => `"k${String(index)}":0`,
  ).join(",");
  expect(() => parse(withBody(`{${keys}}`))).toThrow(
    expect.objectContaining({ boundary: "unlisted_keys", maximum: 1024 }),
  );
  const deep = `${"[".repeat(100)}${"]".repeat(100)}`;
  expect(() => parse(withBody(`{"vmSummary":${deep}}`))).toThrow(
    expect.objectContaining({ boundary: "nesting", maximum: 64 }),
  );
  const reasons = JSON.stringify(Array.from({ length: 257 }, () => "r"));
  expect(() =>
    parse(withBody(`{"termination":{"reasons":${reasons}}}`)),
  ).toThrow(expect.objectContaining({ boundary: "termination_reasons" }));
});
