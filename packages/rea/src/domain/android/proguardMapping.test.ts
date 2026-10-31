import { expect, it, vi } from "vitest";
import {
  ANDROID_MAPPING_LIMITS,
  projectAndroidMapping,
} from "./androidMapping.js";
import {
  parseProguardMapping,
  PROGUARD_MAPPING_LIMITS,
  type ProguardMapping,
  resolveProguardClass,
  resolveProguardField,
  resolveProguardMethod,
} from "./proguardMapping.js";

const fixture = [
  "# compiler: R8",
  "# compiler_version: 8.5.35",
  "# min_api: 24",
  '# {"id":"com.android.tools.r8.mapping","version":"2.2"}',
  "# pg_map_id: 1a2b3c4",
  "# pg_map_hash: SHA-256 1a2b3c4d5e6f",
  "    int orphan -> z",
  "com.example.app.LoginActivity -> a.a:",
  '# {"id":"sourceFile","fileName":"LoginActivity.kt"}',
  "    int attempts -> a",
  "    java.lang.String userName -> b",
  "    com.example.app.Session session -> c",
  "    1:4:void <init>():12:15 -> <init>",
  "    1:1:void submit(int):30:30 -> a",
  "    2:2:void submit(java.lang.String):40:40 -> a",
  "    3:3:boolean validate(java.lang.String):50:50 -> b",
  "    4:4:int com.example.app.Util.clamp(int):7:7 -> c",
  "    4:4:void retry():60 -> c",
  "    5:7:void render():90:92 -> d",
  "    8:9:void render():95:96 -> d",
  "    10:10:void log(java.lang.String,int):80:80 -> e",
  '    # {"id":"com.android.tools.r8.residualsignature","signature":"()V"}',
  "    void handle() -> do",
  "    11:x:void broken() -> f",
  "    void missingArrow()",
  "    # {not json — plain comment}",
  "com.example.app.LoginActivity$Callback -> a.a$a:",
  "    void onDone(com.example.app.Session) -> a",
  "com.example.app.Session -> a.b:",
  "    long id -> a",
  "    java.lang.String token -> a",
  "com.example.app.First -> a.f:",
  "com.example.app.Second -> a.f:",
  "com.example.app.Broken -> a.e",
  "    int lost -> a",
].join("\n");

const parse = (text: string): ProguardMapping => {
  const parsed = parseProguardMapping(text, ANDROID_MAPPING_LIMITS);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
};
const mapping = parse(fixture);
const app = "com.example.app";
const method = (
  name: string,
  parameter_types: string[] = [],
  return_type = "void",
) => ({ class: `${app}.LoginActivity`, name, return_type, parameter_types });

it("reports header facts, valid record counts and malformed line samples", () => {
  expect(mapping.reported).toEqual({
    compiler: "R8",
    compiler_version: "8.5.35",
    min_api: "24",
    map_version: "2.2",
    pg_map_id: "1a2b3c4",
    pg_map_hash: "SHA-256 1a2b3c4d5e6f",
  });
  expect(mapping.records).toEqual({
    classes: 5,
    fields: 5,
    methods: 11,
    malformed: 5,
  });
  expect(mapping.malformed).toEqual([
    { line: 7, reason: "member-without-class" },
    { line: 24, reason: "member-line" },
    { line: 25, reason: "member-line" },
    { line: 34, reason: "class-line" },
    { line: 35, reason: "member-without-class" },
  ]);
});

it("maps classes only through exactly one residual record", () => {
  expect(resolveProguardClass(mapping, "a.a")).toEqual({
    status: "mapped",
    mapped: { name: `${app}.LoginActivity` },
    verified_by: "class",
  });
  expect(resolveProguardClass(mapping, "a.a$a")).toMatchObject({
    status: "mapped",
    mapped: { name: `${app}.LoginActivity$Callback` },
  });
  expect(resolveProguardClass(mapping, "a.f")).toEqual({
    status: "ambiguous",
    reason: "multiple-records",
    candidate_count: 2,
    candidates: [{ name: `${app}.First` }, { name: `${app}.Second` }],
  });
  expect(resolveProguardClass(mapping, "a.z")).toEqual({ status: "unmapped" });
});

it.each([
  ["a.a", "c", "La/b;", { class: `${app}.LoginActivity`, name: "session" }],
  ["a.b", "a", "J", { class: `${app}.Session`, name: "id", type: "long" }],
  ["a.b", "a", "Ljava/lang/String;", { name: "token" }],
])(
  "maps field %s.%s %s by its residual type",
  (className, name, type, mapped) => {
    expect(
      resolveProguardField(mapping, { className, name, type }),
    ).toMatchObject({ status: "mapped", mapped, verified_by: "type" });
  },
);

it("refuses a field whose observed type matches no record", () => {
  expect(
    resolveProguardField(mapping, { className: "a.b", name: "a", type: "I" }),
  ).toMatchObject({ status: "ambiguous", reason: "type-mismatch" });
});

it.each([
  ["a.a", "a", "(I)V", method("submit", ["int"])],
  ["a.a", "a", "(Ljava/lang/String;)V", method("submit", ["java.lang.String"])],
  ["a.a", "c", "()V", method("retry")],
  ["a.a", "d", "()V", method("render")],
  ["a.a", "e", "()V", method("log", ["java.lang.String", "int"])],
  ["a.a", "<init>", "()V", method("<init>")],
  ["a.a", "do", "()V", method("handle")],
  [
    "a.a$a",
    "a",
    "(La/b;)V",
    {
      class: `${app}.LoginActivity$Callback`,
      name: "onDone",
      return_type: "void",
      parameter_types: [`${app}.Session`],
    },
  ],
])(
  "maps method %s.%s%s by its residual prototype",
  (className, name, descriptor, mapped) => {
    expect(
      resolveProguardMethod(mapping, { className, name, descriptor }),
    ).toEqual({ status: "mapped", mapped, verified_by: "descriptor" });
  },
);

it("keeps same-range overloads that are not an inline stack", () => {
  const overloads = parse(
    [
      "com.example.Owner -> a.o:",
      "    1:1:void first():1:1 -> a",
      "    1:1:void second(int):1:1 -> a",
    ].join("\n"),
  );
  const owner = { class: "com.example.Owner", return_type: "void" };
  expect(
    resolveProguardMethod(overloads, {
      className: "a.o",
      name: "a",
      descriptor: "()V",
    }),
  ).toEqual({
    status: "mapped",
    mapped: { ...owner, name: "first", parameter_types: [] },
    verified_by: "descriptor",
  });
  expect(
    resolveProguardMethod(overloads, {
      className: "a.o",
      name: "a",
      descriptor: "(I)V",
    }),
  ).toEqual({
    status: "mapped",
    mapped: { ...owner, name: "second", parameter_types: ["int"] },
    verified_by: "descriptor",
  });
});

it("never maps a lone name-only method candidate", () => {
  expect(
    resolveProguardMethod(mapping, {
      className: "a.a",
      name: "c",
      descriptor: "(I)I",
    }),
  ).toEqual({
    status: "ambiguous",
    reason: "descriptor-mismatch",
    candidate_count: 1,
    candidates: [method("retry")],
  });
  expect(
    resolveProguardMethod(mapping, {
      className: "a.a",
      name: "b",
      descriptor: "(I)Z",
    }),
  ).toEqual({
    status: "ambiguous",
    reason: "descriptor-mismatch",
    candidate_count: 1,
    candidates: [method("validate", ["java.lang.String"], "boolean")],
  });
  expect(
    resolveProguardMethod(mapping, {
      className: "a.a",
      name: "g",
      descriptor: "()V",
    }),
  ).toEqual({ status: "unmapped" });
});

it("reports members of a class with several records as ambiguous", () => {
  const ambiguous = parse(
    [
      "com.example.First -> a.f:",
      "    void run() -> a",
      "    int count -> b",
      "com.example.Second -> a.f:",
      "    void run() -> a",
    ].join("\n"),
  );
  expect(
    resolveProguardMethod(ambiguous, {
      className: "a.f",
      name: "a",
      descriptor: "()V",
    }),
  ).toMatchObject({
    status: "ambiguous",
    reason: "ambiguous-class",
    candidates: [
      { class: "com.example.First" },
      { class: "com.example.Second" },
    ],
  });
  expect(
    resolveProguardField(ambiguous, {
      className: "a.f",
      name: "b",
      type: "I",
    }),
  ).toMatchObject({ status: "ambiguous", reason: "ambiguous-class" });
});

it("disambiguates overloads collapsed to one name and caps reported candidates", () => {
  const overloads = parse(
    [
      "com.example.Many -> a.m:",
      ...Array.from(
        { length: 10 },
        (_, index) => `    void run${index}(int${"[]".repeat(index)}) -> a`,
      ),
    ].join("\n"),
  );
  expect(
    resolveProguardMethod(overloads, {
      className: "a.m",
      name: "a",
      descriptor: "([[[I)V",
    }),
  ).toMatchObject({ status: "mapped", mapped: { name: "run3" } });
  const report = projectAndroidMapping(
    {
      file: { path: "/tmp/mapping.txt", sha256: "a".repeat(64), bytes: 1 },
      mapping: overloads,
    },
    [
      { kind: "class", name: "a.m", raw_name: "a.m" },
      {
        kind: "method",
        class_raw_name: "a.m",
        name: "a",
        overload_index: 0,
        raw_name: "a",
        dex_descriptor: "(J)V",
      },
      { kind: "class", name: "a.n", raw_name: "a.n" },
    ],
  );
  expect(report.symbols[1]?.resolution).toMatchObject({
    status: "ambiguous",
    reason: "descriptor-mismatch",
    candidate_count: 10,
  });
  const resolution = report.symbols[1]?.resolution;
  expect(
    resolution?.status === "ambiguous" ? resolution.candidates : [],
  ).toHaveLength(ANDROID_MAPPING_LIMITS.candidates);
  expect(report.coverage).toEqual({
    symbols: 3,
    mapped: 1,
    ambiguous: 1,
    unmapped: 1,
  });
});

it("matches original field types against observed residual DEX types", () => {
  const renamed = parse(
    [
      "com.example.Outer$Inner -> a.b$c:",
      "com.example.Twice -> a.t:",
      "com.example.Twice -> a.u:",
      "com.example.Duplicate -> a.d:",
      "com.example.Duplicate -> a.d:",
      "Owner -> owner:",
      "    int[][] primitiveArray -> a",
      "    com.example.Outer$Inner[] nestedArray -> b",
      "    java.util.List external -> c",
      "    com.example.Twice conflicting -> d",
      "    com.example.Duplicate duplicate -> e",
    ].join("\n"),
  );
  for (const [name, type, originalName] of [
    ["a", "[[I", "primitiveArray"],
    ["b", "[La/b$c;", "nestedArray"],
    ["c", "Ljava/util/List;", "external"],
    ["e", "La/d;", "duplicate"],
  ] as const) {
    expect(
      resolveProguardField(renamed, { className: "owner", name, type }),
    ).toMatchObject({
      status: "mapped",
      mapped: { class: "Owner", name: originalName },
      verified_by: "type",
    });
  }
  for (const type of ["La/t;", "La/u;"]) {
    expect(
      resolveProguardField(renamed, { className: "owner", name: "d", type }),
    ).toMatchObject({
      status: "ambiguous",
      reason: "type-mismatch",
      candidate_count: 1,
      candidates: [{ class: "Owner", name: "conflicting" }],
    });
  }
});

it.each([
  ["boolean", "Z"],
  ["byte", "B"],
  ["char", "C"],
  ["short", "S"],
  ["int[][]", "[[I"],
  ["long", "J"],
  ["float", "F"],
  ["double", "D"],
  ["java.lang.String", "Ljava/lang/String;"],
  ["Original$Inner[][]", "[[Lr/名$𐐀;"],
])("compares field and method type %s directly as %s", (type, descriptor) => {
  const translated = parse(
    [
      "Original$Inner -> r.名$𐐀:",
      "Owner -> a:",
      `    ${type} value -> f`,
      `    ${type} echo(${type}) -> m`,
    ].join("\n"),
  );
  expect(
    resolveProguardField(translated, {
      className: "a",
      name: "f",
      type: descriptor,
    }),
  ).toMatchObject({ status: "mapped", mapped: { type } });
  expect(
    resolveProguardMethod(translated, {
      className: "a",
      name: "m",
      descriptor: `(${descriptor})${descriptor}`,
    }),
  ).toMatchObject({
    status: "mapped",
    mapped: { parameter_types: [type], return_type: type },
  });
  expect(
    resolveProguardMethod(translated, {
      className: "a",
      name: "m",
      descriptor: `(${descriptor})V`,
    }),
  ).toMatchObject({ status: "ambiguous", reason: "descriptor-mismatch" });
});

it("preserves alias uncertainty and identical aliases during direct member comparisons", () => {
  const aliases = parse(
    [
      "Twice -> x:",
      "Twice -> y:",
      "Duplicate -> d.e:",
      "Duplicate -> d.e:",
      "Owner -> a:",
      "    Twice unclear -> f",
      "    void unclear(Twice[]) -> m",
      "    Duplicate known -> g",
      "    Duplicate[] known(Duplicate) -> n",
    ].join("\n"),
  );
  expect(
    resolveProguardField(aliases, { className: "a", name: "f", type: "Lx;" }),
  ).toMatchObject({ status: "ambiguous", reason: "type-mismatch" });
  expect(
    resolveProguardMethod(aliases, {
      className: "a",
      name: "m",
      descriptor: "([Lx;)V",
    }),
  ).toMatchObject({ status: "ambiguous", reason: "descriptor-mismatch" });
  expect(
    resolveProguardField(aliases, { className: "a", name: "g", type: "Ld/e;" }),
  ).toMatchObject({ status: "mapped" });
  expect(
    resolveProguardMethod(aliases, {
      className: "a",
      name: "n",
      descriptor: "(Ld/e;)[Ld/e;",
    }),
  ).toMatchObject({ status: "mapped" });
});

it("resolves many repeated aliases without losing duplicate class evidence", () => {
  const count = 20_000;
  const parameters = Array.from({ length: 255 }, () => "T").join(",");
  const repeated = parse(
    [
      ...Array.from({ length: count }, () => "T -> t:"),
      "Owner -> a:",
      ...Array.from(
        { length: 1_000 },
        (_, index) => `    void candidate${index}(${parameters}) -> m`,
      ),
    ].join("\n"),
  );
  expect(repeated.records.classes).toBe(count + 1);
  expect(resolveProguardClass(repeated, "t")).toMatchObject({
    status: "ambiguous",
    candidate_count: count,
  });
  expect(
    resolveProguardMethod(repeated, {
      className: "a",
      name: "m",
      descriptor: `(${"Lt;".repeat(255)})V`,
    }),
  ).toMatchObject({ status: "ambiguous", candidate_count: 1_000 });
});

it("keeps a conflicting alias unknown even after many later agreeing records", () => {
  const conflict = parse(
    [
      "T -> x:",
      "T -> y:",
      ...Array.from({ length: 100 }, () => "T -> x:"),
      "Owner -> owner:",
      "    T field -> a",
    ].join("\n"),
  );
  for (const type of ["Lx;", "Ly;"]) {
    expect(
      resolveProguardField(conflict, { className: "owner", name: "a", type }),
    ).toMatchObject({
      status: "ambiguous",
      reason: "type-mismatch",
      candidate_count: 1,
    });
  }
});

it("indexes many distinct residual signatures without merging away late candidates", () => {
  const count = 40_000;
  const many = parse(
    [
      "Owner -> a:",
      ...Array.from(
        { length: count },
        (_, index) =>
          `    void run() -> m\n    # {"id":"com.android.tools.r8.residualsignature","signature":"()Lr${index};"}`,
      ),
    ].join("\n"),
  );
  expect(many.records.methods).toBe(count);
  expect(
    resolveProguardMethod(many, {
      className: "a",
      name: "m",
      descriptor: "()Lr39999;",
    }),
  ).toMatchObject({ status: "mapped", mapped: { name: "run" } });
  expect(
    resolveProguardMethod(many, {
      className: "a",
      name: "m",
      descriptor: "()V",
    }),
  ).toMatchObject({ status: "ambiguous", candidate_count: count });
});

it.each([false, true])(
  "preserves missing-signature merges with typed records (initial missing: %s)",
  (initialMissing) => {
    const metadata = (signature: string) =>
      `    # {"id":"com.android.tools.r8.residualsignature","signature":"${signature}"}`;
    const input = ["Owner -> a:", "    void run() -> m"];
    if (!initialMissing) input.push(metadata("(I)V"));
    input.push(
      "    void run() -> m",
      metadata("(I)V"),
      "    void run() -> m",
      metadata("()V"),
      "    void run() -> m",
      "    void run() -> m",
      metadata("()V"),
    );
    const merged = parse(input.join("\n"));
    for (const descriptor of ["(I)V", "()V"])
      expect(
        resolveProguardMethod(merged, {
          className: "a",
          name: "m",
          descriptor,
        }),
      ).toMatchObject({ status: "mapped" });
    expect(
      resolveProguardMethod(merged, {
        className: "a",
        name: "m",
        descriptor: "()J",
      }),
    ).toMatchObject({ status: "ambiguous", candidate_count: 2 });
  },
);

it("compares explicit residual metadata exactly without falling back to original types", () => {
  const metadata = parse(
    [
      "Original -> a:",
      "    Original value -> f",
      '    # {"id":"com.android.tools.r8.residualsignature","signature":"J"}',
      "    Original echo(Original) -> m",
      '    # {"id":"com.android.tools.r8.residualsignature","signature":"(I)J"}',
    ].join("\n"),
  );
  for (const [type, status] of [
    ["J", "mapped"],
    ["La;", "ambiguous"],
  ] as const)
    expect(
      resolveProguardField(metadata, { className: "a", name: "f", type }),
    ).toMatchObject({ status });
  for (const [descriptor, status] of [
    ["(I)J", "mapped"],
    ["(La;)La;", "ambiguous"],
  ] as const)
    expect(
      resolveProguardMethod(metadata, {
        className: "a",
        name: "m",
        descriptor,
      }),
    ).toMatchObject({ status });
});

it("does not expand a 5 MiB alias into a 640 MiB prototype before finding a later match", () => {
  const expanded = parse(
    [
      `T -> ${"R".repeat(5 * 1024 * 1024)}:`,
      "Owner -> a:",
      "    T value -> f",
      `    void enormous(${Array.from({ length: 128 }, () => "T").join(",")}) -> m`,
      "    void later(int) -> m",
      "    T returned() -> r",
    ].join("\n"),
  );
  expect(expanded.records).toEqual({
    classes: 2,
    fields: 1,
    methods: 3,
    malformed: 0,
  });
  expect(
    resolveProguardMethod(
      expanded,
      { className: "a", name: "m", descriptor: "(I)V" },
      { candidates: 1 },
    ),
  ).toMatchObject({ status: "mapped", mapped: { name: "later" } });
  expect(
    resolveProguardMethod(
      expanded,
      { className: "a", name: "m", descriptor: "()V" },
      { candidates: 1 },
    ),
  ).toMatchObject({
    status: "ambiguous",
    reason: "descriptor-mismatch",
    candidate_count: 2,
    candidates: [{ name: "enormous" }],
  });
  expect(
    resolveProguardField(expanded, { className: "a", name: "f", type: "I" }),
  ).toMatchObject({ status: "ambiguous", reason: "type-mismatch" });
  expect(
    resolveProguardMethod(expanded, {
      className: "a",
      name: "r",
      descriptor: "()I",
    }),
  ).toMatchObject({ status: "ambiguous", reason: "descriptor-mismatch" });
});

it("uses residual signature metadata and reports an invalid payload", () => {
  const metadata = parse(
    [
      "com.example.Meta -> a.m:",
      "    int count -> a",
      '    # {"id":"com.android.tools.r8.residualsignature","signature":"J"}',
      "    void run() -> b",
      '    # {"id":"com.android.tools.r8.residualsignature","signature":"V"}',
    ].join("\n"),
  );
  expect(
    resolveProguardField(metadata, { className: "a.m", name: "a", type: "J" }),
  ).toMatchObject({ status: "mapped", mapped: { name: "count" } });
  expect(metadata.malformed).toEqual([{ line: 5, reason: "metadata" }]);
});

it("treats CRLF and tab indentation like LF and spaces", () => {
  expect(
    parse(fixture.replaceAll("\n", "\r\n").replaceAll("    ", "\t")),
  ).toEqual(mapping);
});

it.each([
  ["empty", ""],
  ["comment-only", "# compiler: R8\n# just a comment\n"],
  ["usage.txt", "com.example.Unused\n    void unused()\n    int field\n"],
  ["seeds.txt", "com.example.Keep: void keep()\n"],
])("fails closed on a %s file without class records", (_name, text) => {
  expect(parseProguardMapping(text, ANDROID_MAPPING_LIMITS)).toEqual({
    ok: false,
    error: { kind: "no-class-records" },
  });
});

it("refuses class-index growth at its source line with an explicit retained budget", () => {
  const parsed = parseProguardMapping(
    Array.from({ length: 8 }, (_, index) => `Owner${index} -> a${index}:`).join(
      "\r\n",
    ),
    { indexBytes: 4096 },
  );
  expect(parsed).toEqual({
    ok: false,
    error: { kind: "capacity", resource: "index", limit_bytes: 4096, line: 4 },
  });
});

it("admits a method's parameter representation before allocating its split array", () => {
  const args = Array.from({ length: 200 }, () => "int").join(",");
  const split = vi.spyOn(String.prototype, "split");
  let parsed: ReturnType<typeof parseProguardMapping> | undefined;
  let splits = 0;
  try {
    parsed = parseProguardMapping(`Owner -> a:\n    void many(${args}) -> b`, {
      indexBytes: 4096,
    });
    splits = split.mock.calls.length;
  } finally {
    split.mockRestore();
  }
  expect(parsed).toMatchObject({
    ok: false,
    error: { kind: "capacity", resource: "index", line: 2 },
  });
  expect(splits).toBe(0);
});

it("refuses oversized JSON metadata before JSON.parse materializes its tree", () => {
  const text = `Owner -> a:\n# {"id":"unknown","payload":"${"x".repeat(2048)}"}`;
  const json = vi.spyOn(JSON, "parse");
  let parsed: ReturnType<typeof parseProguardMapping> | undefined;
  let calls = 0;
  try {
    parsed = parseProguardMapping(text, { projectionBytes: 1024 });
    calls = json.mock.calls.length;
  } finally {
    json.mockRestore();
  }
  expect(parsed).toEqual({
    ok: false,
    error: {
      kind: "capacity",
      resource: "projection",
      limit_bytes: 1024,
      line: 2,
    },
  });
  expect(calls).toBe(0);
});

it("charges retained headers by replacement delta rather than by repeated comments", () => {
  const parsed = parseProguardMapping(
    [
      `# compiler: ${"x".repeat(100)}`,
      ...Array.from({ length: 500 }, () => "# compiler: R8"),
      "Owner -> a:",
    ].join("\n"),
    { indexBytes: 2048, projectionBytes: 512 },
  );
  expect(parsed).toMatchObject({
    ok: true,
    value: { reported: { compiler: "R8" } },
  });
});

it("preserves Unicode class, member, qualified owner and parameter values when admitting strings", () => {
  const retained = parse(
    [
      "原名.类型 -> r.类型𐐀:",
      "原名.所有者$内部 -> r.所有者$内部:",
      "    原名.类型[] 字段𐐀 -> 字",
      "    原名.类型 外部.所有者.字段 -> 外",
      "    原名.类型[][] 外部.所有者.方法𐐀(原名.类型[],long) -> 法",
    ].join("\n"),
  );
  expect(resolveProguardClass(retained, "r.所有者$内部")).toMatchObject({
    status: "mapped",
    mapped: { name: "原名.所有者$内部" },
  });
  expect(
    resolveProguardField(retained, {
      className: "r.所有者$内部",
      name: "字",
      type: "[Lr/类型𐐀;",
    }),
  ).toMatchObject({
    status: "mapped",
    mapped: {
      class: "原名.所有者$内部",
      name: "字段𐐀",
      type: "原名.类型[]",
    },
  });
  expect(
    resolveProguardField(retained, {
      className: "r.所有者$内部",
      name: "外",
      type: "Lr/类型𐐀;",
    }),
  ).toMatchObject({
    status: "mapped",
    mapped: { class: "外部.所有者", name: "字段", type: "原名.类型" },
  });
  expect(
    resolveProguardMethod(retained, {
      className: "r.所有者$内部",
      name: "法",
      descriptor: "([Lr/类型𐐀;J)[[Lr/类型𐐀;",
    }),
  ).toMatchObject({
    status: "mapped",
    mapped: {
      class: "外部.所有者",
      name: "方法𐐀",
      return_type: "原名.类型[][]",
      parameter_types: ["原名.类型[]", "long"],
    },
  });
});

it("preserves header code units and JSON-escaped lone surrogates in admitted metadata", () => {
  const mapVersion = "2.2-\ud800-𐐀-\udc00";
  const fieldSignature = "[L原名/\udc00;";
  const methodSignature = "(L原名/\ud800;)L返回/\udc00;";
  const compilerVersion = "8.13-漢字-𐐀-literal\\ud800";
  const metadata = (id: string, values: Record<string, string>) =>
    `# ${JSON.stringify({ id: `com.android.tools.r8.${id}`, ...values })}`;
  const retained = parse(
    [
      `# compiler_version: ${compilerVersion}`,
      metadata("mapping", { version: mapVersion }),
      "Original -> a:",
      "    int field -> f",
      metadata("residualsignature", { signature: fieldSignature }),
      "    void method(int) -> m",
      metadata("residualsignature", { signature: methodSignature }),
    ].join("\n"),
  );
  expect(retained.reported.compiler_version).toBe(compilerVersion);
  expect(retained.reported.map_version).toBe(mapVersion);
  expect(retained.malformed).toEqual([]);
  expect(
    resolveProguardField(retained, {
      className: "a",
      name: "f",
      type: fieldSignature,
    }),
  ).toMatchObject({ status: "mapped", mapped: { name: "field" } });
  expect(
    resolveProguardMethod(retained, {
      className: "a",
      name: "m",
      descriptor: methodSignature,
    }),
  ).toMatchObject({ status: "mapped", mapped: { name: "method" } });
  expect(
    resolveProguardMethod(retained, {
      className: "a",
      name: "m",
      descriptor: methodSignature.replaceAll(/\p{Surrogate}/gu, "�"),
    }),
  ).toMatchObject({ status: "ambiguous", reason: "descriptor-mismatch" });
});

it("bounds repeated shared class names in expanded per-class mapping claims", () => {
  const owner = `example.${"X".repeat(200)}`;
  const parsed = parseProguardMapping(
    `${owner} -> a:\n    int first -> b\n    int second -> c`,
    {
      projectionBytes: 1024,
    },
  );
  expect(parsed).toEqual({
    ok: false,
    error: {
      kind: "capacity",
      resource: "projection",
      limit_bytes: 1024,
      line: 3,
    },
  });
});

it("does not cumulatively charge deduplicated line-range splits", () => {
  const parsed = parseProguardMapping(
    [
      "Owner -> a:",
      ...Array.from(
        { length: 200 },
        (_, index) => `    ${index + 1}:${index + 1}:void run():1:1 -> b`,
      ),
    ].join("\n"),
    { indexBytes: 4096, projectionBytes: 1024 },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  expect(parsed.value.records.methods).toBe(200);
  expect(
    resolveProguardMethod(parsed.value, {
      className: "a",
      name: "b",
      descriptor: "()V",
    }),
  ).toMatchObject({ status: "mapped", mapped: { name: "run" } });
});

it("charges only the retained outermost inline frame", () => {
  const parsed = parseProguardMapping(
    [
      "Owner -> a:",
      "    1:1:void foreign.Owner.inlined():1:1 -> b",
      ...Array.from(
        { length: 100 },
        (_, index) => `    1:1:void outer${index}():7 -> b`,
      ),
    ].join("\n"),
    { indexBytes: 4096, projectionBytes: 1024 },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  expect(
    resolveProguardMethod(parsed.value, {
      className: "a",
      name: "b",
      descriptor: "()V",
    }),
  ).toMatchObject({
    status: "mapped",
    mapped: { class: "Owner", name: "outer99" },
  });
});

it("keeps class-local method keys small while distinguishing qualified foreign owners", () => {
  const owner = `example.${"X".repeat(300)}`;
  const parsed = parseProguardMapping(
    `${owner} -> a:\n    void first() -> b\n    void second() -> c`,
    {
      indexBytes: 4500,
    },
  );
  expect(parsed.ok).toBe(true);
  const qualified = parse(
    "Owner -> a:\n    void run() -> b\n    void foreign.Owner.run() -> b",
  );
  expect(
    resolveProguardMethod(qualified, {
      className: "a",
      name: "b",
      descriptor: "()V",
    }),
  ).toMatchObject({
    status: "ambiguous",
    candidate_count: 2,
    candidates: [{ class: "Owner" }, { class: "foreign.Owner" }],
  });
});

it("streams total candidate counts with bounded stable samples for classes and members", () => {
  const text = Array.from(
    { length: 12 },
    (_, index) =>
      `Owner${index} -> a:\n    int field${index} -> b\n    void method${index}() -> c`,
  ).join("\n");
  const many = parse(text);
  const resolutions = [
    resolveProguardClass(many, "a", { candidates: 2 }),
    resolveProguardField(
      many,
      { className: "a", name: "b", type: "I" },
      { candidates: 2 },
    ),
    resolveProguardMethod(
      many,
      { className: "a", name: "c", descriptor: "()V" },
      { candidates: 2 },
    ),
  ];
  for (const resolution of resolutions) {
    expect(resolution).toMatchObject({
      status: "ambiguous",
      candidate_count: 12,
    });
    if (resolution.status !== "ambiguous")
      throw new Error("Expected ambiguity");
    expect(resolution.candidates).toHaveLength(2);
  }
  expect(resolveProguardClass(many, "a")).toMatchObject({
    candidate_count: 12,
    candidates: Array.from(
      { length: PROGUARD_MAPPING_LIMITS.candidates },
      (_, index) => ({ name: `Owner${index}` }),
    ),
  });
});

it("caps verified and mismatched member samples while counting every relevant candidate", () => {
  const many = parse(
    [
      "Owner -> a:",
      ...Array.from(
        { length: 12 },
        (_, index) => `    void method${index}(int) -> b`,
      ),
    ].join("\n"),
  );
  for (const descriptor of ["(I)V", "(J)V"]) {
    expect(
      resolveProguardMethod(
        many,
        { className: "a", name: "b", descriptor },
        { candidates: 2 },
      ),
    ).toMatchObject({
      status: "ambiguous",
      candidate_count: 12,
      candidates: [{ name: "method0" }, { name: "method1" }],
    });
  }
});

it("samples verified candidates after earlier prototype mismatches", () => {
  const many = parse(
    [
      "Owner -> a:",
      ...Array.from(
        { length: 10 },
        (_, index) => `    void miss${index}(long) -> b`,
      ),
      "    void first(int) -> b",
      "    void second(int) -> b",
    ].join("\n"),
  );
  expect(
    resolveProguardMethod(
      many,
      {
        className: "a",
        name: "b",
        descriptor: "(I)V",
      },
      { candidates: 1 },
    ),
  ).toMatchObject({
    status: "ambiguous",
    reason: "multiple-records",
    candidate_count: 2,
    candidates: [{ name: "first" }],
  });
});

it("bounds malformed samples while continuing to count all bad source records", () => {
  const parsed = parseProguardMapping(
    [
      "Owner -> a:",
      ...Array.from({ length: 100 }, () => "    not a member"),
    ].join("\r\n"),
    { indexBytes: 2048, malformedSamples: 2 },
  );
  expect(parsed).toMatchObject({
    ok: true,
    value: {
      records: { malformed: 100 },
      malformed: [
        { line: 2, reason: "member-line" },
        { line: 3, reason: "member-line" },
      ],
    },
  });
});

it("charges repeated mapping-version metadata only for its retained replacement", () => {
  const parsed = parseProguardMapping(
    [
      ...Array.from(
        { length: 100 },
        () => '# {"id":"com.android.tools.r8.mapping","version":"2.2"}',
      ),
      "Owner -> a:",
    ].join("\n"),
    { indexBytes: 4096, projectionBytes: 512 },
  );
  expect(parsed).toMatchObject({
    ok: true,
    value: { reported: { map_version: "2.2" } },
  });
});

it("keeps conflicting repeated residual signatures ambiguous instead of last-wins mapping", () => {
  const conflict = parse(
    [
      "Owner -> a:",
      "    int value -> b",
      '    # {"id":"com.android.tools.r8.residualsignature","signature":"I"}',
      '    # {"id":"com.android.tools.r8.residualsignature","signature":"J"}',
      "    void run() -> c",
      '    # {"id":"com.android.tools.r8.residualsignature","signature":"()V"}',
      '    # {"id":"com.android.tools.r8.residualsignature","signature":"(I)V"}',
    ].join("\n"),
  );
  for (const type of ["I", "J"])
    expect(
      resolveProguardField(conflict, { className: "a", name: "b", type }),
    ).toMatchObject({
      status: "ambiguous",
      reason: "residual-signature-conflict",
      candidate_count: 1,
    });
  for (const descriptor of ["()V", "(I)V"])
    expect(
      resolveProguardMethod(conflict, {
        className: "a",
        name: "c",
        descriptor,
      }),
    ).toMatchObject({
      status: "ambiguous",
      reason: "residual-signature-conflict",
      candidate_count: 1,
    });
});

it("does not charge repeated identical residual metadata as new retained strings", () => {
  const parsed = parseProguardMapping(
    [
      "Owner -> a:",
      "    int value -> b",
      ...Array.from(
        { length: 500 },
        () =>
          '    # {"id":"com.android.tools.r8.residualsignature","signature":"J"}',
      ),
    ].join("\n"),
    { indexBytes: 4096, projectionBytes: 1024 },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  expect(
    resolveProguardField(parsed.value, {
      className: "a",
      name: "b",
      type: "J",
    }),
  ).toMatchObject({ status: "mapped" });
});
