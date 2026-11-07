import { expect, it } from "vitest";

import {
  createBoundedProcessTextNormalizer,
  createProcessTextNormalizer,
  createProcessIdentifierLookup,
  normalizeProcessSamples,
  normalizeProcessText,
} from "./ProcessNormalization.js";
import { processScenarioSchema } from "../../domain/process/processScenario.js";

const rootPid = 41_010;
const samples = Object.freeze(
  [
    {
      at_ms: 17,
      pid: rootPid,
      parent_pid: 40_000,
      process_group_id: rootPid,
      session_id: rootPid,
      command: " root 41010 ",
    },
    {
      at_ms: 28,
      pid: 42_020,
      parent_pid: rootPid,
      process_group_id: 43_030,
      session_id: 44_040,
      command:
        " /workspace/program child 42020 parent 41010 group 43030 session 44040 listen:8080 marker ",
    },
    {
      at_ms: 39,
      pid: 45_050,
      parent_pid: 42_020,
      process_group_id: 43_030,
      session_id: 44_040,
      command: "peer 45050 unrelated 145050",
    },
    {
      at_ms: 41,
      pid: 46_060,
      parent_pid: 0,
      process_group_id: null,
      session_id: 0,
      command: "unknown 46060",
    },
    {
      at_ms: 52,
      pid: 47_070,
      parent_pid: 0,
      process_group_id: 0,
      session_id: null,
      command: "unavailable 47070",
    },
  ].map((sample) =>
    Object.freeze({ ...sample, runtime_metadata: "must not be serialized" }),
  ),
);

const scenario = (normalization: {
  readonly pids?: boolean;
  readonly paths?: boolean;
  readonly ports?: boolean;
  readonly patterns?: readonly {
    readonly pattern: string;
    readonly replacement: string;
  }[];
}) =>
  processScenarioSchema.parse({
    executable: "/usr/bin/node",
    working_directory: "/workspace",
    normalization: {
      paths: true,
      time_bucket_ms: 10,
      patterns: [{ pattern: "marker", replacement: "selected" }],
      ...normalization,
    },
  });

it("replaces caller-declared patterns literally, without expanding replacement patterns", () => {
  const declared = scenario({
    paths: false,
    patterns: [
      { pattern: "8080", replacement: "$&$&" },
      { pattern: "READY", replacement: "$$" },
      { pattern: "NAME", replacement: "$1" },
    ],
  });
  expect(
    normalizeProcessText(
      "listening on 8080; READY; NAME=alpha; tail NAME",
      declared,
      "/temporary",
      rootPid,
    ),
  ).toBe("listening on $&$&; $$; $1=alpha; tail $1");
});

it("bounds ordered normalization before replacement expansion and preserves later smaller chunks", () => {
  const normalize = createBoundedProcessTextNormalizer(
    scenario({
      paths: false,
      ports: false,
      pids: false,
      patterns: [{ pattern: "a", replacement: "x".repeat(500) }],
    }),
    "/temporary",
    rootPid,
  );

  expect(normalize("a".repeat(100), 1_000)).toEqual({
    state: "over_budget",
    reason: "normalization",
  });
  expect(normalize("z", 1_000)).toEqual({
    state: "normalized",
    value: "z",
    utf8Bytes: 1,
  });
});

it("keeps ordered intermediate expansion explicit even when a later rule could shrink it", () => {
  const normalize = createBoundedProcessTextNormalizer(
    scenario({
      paths: false,
      ports: false,
      pids: false,
      patterns: [
        { pattern: "a", replacement: "x".repeat(20) },
        { pattern: "x", replacement: "y" },
      ],
    }),
    "/temporary",
    rootPid,
  );

  expect(normalize("a", 10)).toEqual({
    state: "over_budget",
    reason: "normalization",
  });
});

it("counts UTF-8 bytes across replacement boundaries like the final JavaScript string", () => {
  const splitPair = scenario({
    paths: false,
    ports: false,
    pids: false,
    patterns: [{ pattern: "\ude00", replacement: "\ude01" }],
  });
  const splitPairResult = createBoundedProcessTextNormalizer(
    splitPair,
    "/temporary",
    rootPid,
  )("😀", 4);
  expect(splitPairResult).toEqual({
    state: "normalized",
    value: normalizeProcessText("😀", splitPair, "/temporary", rootPid),
    utf8Bytes: 4,
  });
  expect(
    splitPairResult.state === "normalized" && splitPairResult.utf8Bytes,
  ).toBe(
    Buffer.byteLength(
      normalizeProcessText("😀", splitPair, "/temporary", rootPid),
    ),
  );

  const joinedPair = scenario({
    paths: false,
    ports: false,
    pids: false,
    patterns: [{ pattern: "\ude00\ud83d", replacement: "" }],
  });
  const joinedInput = "😀😀";
  const joinedExpected = normalizeProcessText(
    joinedInput,
    joinedPair,
    "/temporary",
    rootPid,
  );
  expect(joinedExpected).toBe("😀");
  expect(
    createBoundedProcessTextNormalizer(
      joinedPair,
      "/temporary",
      rootPid,
    )(joinedInput, Buffer.byteLength(joinedExpected)),
  ).toEqual({
    state: "normalized",
    value: joinedExpected,
    utf8Bytes: Buffer.byteLength(joinedExpected),
  });

  const emptyPattern = scenario({
    paths: false,
    ports: false,
    pids: false,
    patterns: [{ pattern: "", replacement: "\ude00" }],
  });
  const input = "\ud83d";
  const expected = normalizeProcessText(
    input,
    emptyPattern,
    "/temporary",
    rootPid,
  );
  expect(
    createBoundedProcessTextNormalizer(
      emptyPattern,
      "/temporary",
      rootPid,
    )(input, Buffer.byteLength(expected)),
  ).toEqual({
    state: "normalized",
    value: expected,
    utf8Bytes: Buffer.byteLength(expected),
  });
  expect(
    createBoundedProcessTextNormalizer(
      emptyPattern,
      "/temporary",
      rootPid,
    )(input, Buffer.byteLength(expected) - 1),
  ).toEqual({ state: "over_budget", reason: "normalization" });

  const loneSurrogate = scenario({
    paths: false,
    ports: false,
    pids: false,
    patterns: [{ pattern: "x", replacement: "y" }],
  });
  const loneInput = "\ud83dx";
  const loneExpected = normalizeProcessText(
    loneInput,
    loneSurrogate,
    "/temporary",
    rootPid,
  );
  expect(
    createBoundedProcessTextNormalizer(
      loneSurrogate,
      "/temporary",
      rootPid,
    )(loneInput, Buffer.byteLength(loneExpected)),
  ).toEqual({
    state: "normalized",
    value: loneExpected,
    utf8Bytes: Buffer.byteLength(loneExpected),
  });
});

it("lets a later pattern shrink text when an earlier pattern does not match", () => {
  const declared = scenario({
    paths: false,
    ports: false,
    pids: false,
    patterns: [
      { pattern: "z", replacement: "x" },
      { pattern: "aa", replacement: "b" },
    ],
  });
  const expected = normalizeProcessText("aa", declared, "/temporary", rootPid);
  expect(expected).toBe("b");
  expect(
    createBoundedProcessTextNormalizer(
      declared,
      "/temporary",
      rootPid,
    )("aa", Buffer.byteLength(expected)),
  ).toEqual({
    state: "normalized",
    value: expected,
    utf8Bytes: Buffer.byteLength(expected),
  });
});

it("reuses matchers while observing the terminal PID after launch", () => {
  let pid = -1;
  const normalize = createProcessTextNormalizer(
    scenario({ ports: false, patterns: [] }),
    "/temporary",
    () => pid,
  );
  expect(normalize("root 41010 /workspace/item")).toBe(
    "root 41010 <working-directory>/item",
  );
  pid = 41_010;
  expect(normalize("root 41010 /workspace/item")).toBe(
    "root <pid> <working-directory>/item",
  );
  pid = 42_020;
  expect(normalize("root 41010 peer 42020")).toBe("root 41010 peer <pid>");
});

it("keeps equal-path priority and replacement aliases local to each capture", () => {
  const declared = processScenarioSchema.parse({
    executable: "/selected/tool",
    working_directory: "/selected",
    filesystem_observation_paths: ["/selected", "<working-directory>"],
    normalization: { paths: true, pids: false, ports: false, patterns: [] },
  });
  const normalize = createProcessTextNormalizer(declared, "/selected", -1);
  const other = createProcessTextNormalizer(declared, "/other", -1);
  const text = "/selected/item <working-directory>/source";
  expect(normalize(text)).toBe(
    "<temporary-root>/item <filesystem-root-1>/source",
  );
  expect(other(text)).toBe(
    "<working-directory>/item <filesystem-root-1>/source",
  );
});

it("preserves empty-pattern boundaries, including empty text", () => {
  const declared = scenario({
    patterns: [{ pattern: "", replacement: "$$" }],
  });
  expect(normalizeProcessText("ab", declared, "/temporary", rootPid)).toBe(
    "$$a$$b$$",
  );
  expect(normalizeProcessText("", declared, "/temporary", rootPid)).toBe("$$");
});

it.each(["$`", "$'"])(
  "retains the selected replacement %s verbatim",
  (replacement) => {
    const declared = scenario({
      patterns: [{ pattern: "marker", replacement }],
    });
    expect(
      normalizeProcessText(
        "before marker after",
        declared,
        "/temporary",
        rootPid,
      ),
    ).toBe(`before ${replacement} after`);
  },
);

it("preserves compact JSON, counters, line numbers, and ambiguous endpoint spellings", () => {
  const input = [
    '{"pid":32,"size":108,"height":480,"width":640,"score":20}',
    "score=20 size:108 elapsed=3600 file.js:480 server:8080",
    "port=65536 port:8080ms localhost:70000 999.1.2.3:8080",
    "https://user:32@example.test/path http://user:20@localhost/path",
  ].join("\n");
  expect(normalizeProcessText(input, scenario({}), "/temporary", rootPid)).toBe(
    input,
  );
});

it("normalizes only contextual ports before overlapping PID values and honors disabled rules", () => {
  const input =
    'http://example.test:8080/x https://user:password@example.test:443/x 127.0.0.1:9 [::1]:65535 localhost:41010 "port":80 tcp_port=123 udp_port:0 listen:8080';
  expect(normalizeProcessText(input, scenario({}), "/temporary", rootPid)).toBe(
    'http://example.test:<port>/x https://user:password@example.test:<port>/x 127.0.0.1:<port> [::1]:<port> localhost:<port> "port":<port> tcp_port=<port> udp_port:<port> listen:<port>',
  );
  expect(
    normalizeProcessText(
      input,
      scenario({ ports: false, pids: false }),
      "/temporary",
      rootPid,
    ),
  ).toBe(input);
});

it("normalizes ports that end a sentence but not decimal or host continuations", () => {
  const input = [
    "Listening on port: 8080.",
    "Server at http://localhost:8080. Ready",
    "Bound [::1]:3000.",
    "listen=9000.\n",
    "port: 80.5 localhost:8080.5 localhost:8080.example.test",
    "port: 8080.β localhost:8080.é port: 8080é",
  ].join("\n");
  expect(normalizeProcessText(input, scenario({}), "/temporary", rootPid)).toBe(
    [
      "Listening on port: <port>.",
      "Server at http://localhost:<port>. Ready",
      "Bound [::1]:<port>.",
      "listen=<port>.\n",
      "port: 80.5 localhost:8080.5 localhost:8080.example.test",
      "port: 8080.β localhost:8080.é port: 8080é",
    ].join("\n"),
  );
});

it("keeps a port before a chunk-final period, whose continuation is unknown", () => {
  for (const chunk of ["port: 80.", "http://localhost:8080.", "[::1]:3000."])
    expect(
      normalizeProcessText(chunk, scenario({}), "/temporary", rootPid),
    ).toBe(chunk);
});

it("normalizes representative process identities and preserves null, zero, and unrelated numbers", () => {
  const before = JSON.stringify(samples);
  const normalized = normalizeProcessSamples(samples, scenario({}), rootPid);

  expect(normalized).toEqual([
    {
      at_ms: 10,
      pid: 1,
      parent_pid: 2,
      process_group_id: 1,
      session_id: 1,
      command: "root <pid>",
    },
    {
      at_ms: 20,
      pid: 3,
      parent_pid: 1,
      process_group_id: 4,
      session_id: 5,
      command:
        "<working-directory>/program child <pid> parent <pid> group <pid> session <pid> listen:<port> selected",
    },
    {
      at_ms: 30,
      pid: 6,
      parent_pid: 3,
      process_group_id: 4,
      session_id: 5,
      command: "peer <pid> unrelated 145050",
    },
    {
      at_ms: 40,
      pid: 7,
      parent_pid: 0,
      process_group_id: null,
      session_id: 0,
      command: "unknown <pid>",
    },
    {
      at_ms: 50,
      pid: 8,
      parent_pid: 0,
      process_group_id: 0,
      session_id: null,
      command: "unavailable <pid>",
    },
  ]);
  expect(JSON.stringify(samples)).toBe(before);
  expect(normalized.every((sample) => !("runtime_metadata" in sample))).toBe(
    true,
  );

  const pathAndPortPreserved = normalizeProcessSamples(
    samples,
    scenario({ paths: false, ports: false }),
    rootPid,
  );
  expect(pathAndPortPreserved[1]).toMatchObject({
    pid: 3,
    parent_pid: 1,
    command:
      "/workspace/program child <pid> parent <pid> group <pid> session <pid> listen:8080 selected",
  });

  const identifiersPreserved = normalizeProcessSamples(
    samples,
    scenario({ pids: false }),
    rootPid,
  );
  expect(
    identifiersPreserved.map(
      ({ pid, parent_pid, process_group_id, session_id }) => [
        pid,
        parent_pid,
        process_group_id,
        session_id,
      ],
    ),
  ).toEqual([
    [rootPid, 40_000, rootPid, rootPid],
    [42_020, rootPid, 43_030, 44_040],
    [45_050, 42_020, 43_030, 44_040],
    [46_060, 0, null, 0],
    [47_070, 0, 0, null],
  ]);
  expect(identifiersPreserved[1]?.command).toBe(
    "<working-directory>/program child 42020 parent 41010 group 43030 session 44040 listen:<port> selected",
  );
});

it("normalizes nested paths once using the most specific selected identity", () => {
  const declared = processScenarioSchema.parse({
    executable: "/workspace/project/bin/program",
    working_directory: "/workspace/project",
    filesystem_observation_paths: [
      "/workspace/project/data",
      "/workspace/project/data/cache",
    ],
    normalization: { paths: true, pids: false, ports: false, patterns: [] },
  });
  expect(
    normalizeProcessText(
      "/workspace/project/bin/program /workspace/project/data/cache/item /workspace/project/data/result /workspace/project/log /workspace/tmp",
      declared,
      "/workspace",
      rootPid,
    ),
  ).toBe(
    "<executable> <filesystem-root-1>/item <filesystem-root-0>/result <working-directory>/log <temporary-root>/tmp",
  );
});

it("normalizes descendants of selected directories spelled with a trailing slash or dot", () => {
  const declared = processScenarioSchema.parse({
    executable: "/bin/echo",
    working_directory: "/work/",
    filesystem_observation_paths: ["/selected/", "/other/."],
    normalization: { paths: true, pids: false, ports: false, patterns: [] },
  });
  expect(
    normalizeProcessText(
      "P=/selected/item.txt /other/item /work/log /selected/",
      declared,
      "/tmp",
      rootPid,
    ),
  ).toBe(
    "P=<filesystem-root-0>/item.txt <filesystem-root-1>/item <working-directory>/log <filesystem-root-0>/",
  );
});

it("normalizes filesystem-root descendants without rewriting URL separators or HTML tags", () => {
  const declared = processScenarioSchema.parse({
    executable: "/program",
    working_directory: "/elsewhere",
    filesystem_observation_paths: ["/"],
    normalization: { paths: true, pids: false, ports: false, patterns: [] },
  });
  const input = "/other/item http://example.test/path </div> /";
  const expected =
    "<filesystem-root-0>/other/item http://example.test/path </div> <filesystem-root-0>";
  expect(normalizeProcessText(input, declared, "/private", rootPid)).toBe(
    expected,
  );
  expect(
    createBoundedProcessTextNormalizer(
      declared,
      "/private",
      rootPid,
    )(input, 1024),
  ).toMatchObject({
    state: "normalized",
    value: expected,
  });
});

it("treats path metacharacters literally while preferring nested observed roots", () => {
  const declared = processScenarioSchema.parse({
    executable: "/selected/[tool]+",
    working_directory: "/selected",
    filesystem_observation_paths: [
      "/selected/(data)",
      "/selected/(data)/cache",
    ],
    normalization: { paths: true, pids: false, ports: false, patterns: [] },
  });
  expect(
    normalizeProcessText(
      "/selected/[tool]+ /selected/(data)/cache/item /selected/(data)/file /selected/log /selected/toolll",
      declared,
      "/tmp",
      rootPid,
    ),
  ).toBe(
    "<executable> <filesystem-root-1>/item <filesystem-root-0>/file <working-directory>/log <working-directory>/toolll",
  );
});

it("does not give a selected executable identity to a sibling filename", () => {
  const declared = processScenarioSchema.parse({
    executable: "/tmp/process-paths/original/tool",
    working_directory: "/tmp/process-paths",
    normalization: { paths: true, pids: false, ports: false, patterns: [] },
  });
  expect(
    normalizeProcessText(
      "/tmp/process-paths/original/tool-helper /tmp/process-paths/original/tool, /tmp/process-paths/original/tool",
      declared,
      "/tmp/rea-private",
      rootPid,
    ),
  ).toBe(
    "<working-directory>/original/tool-helper <working-directory>/original/tool, <executable>",
  );
});

it.each([
  "http://localhost:8080/ready",
  "port=8080",
  "http://localhost:8080/ready port=8080",
  "/workspace/child http://localhost:8080/ready pid=41010 marker",
])("keeps every ordered bounded stage for %s", (input) => {
  for (const enabled of [true, false]) {
    const settings = scenario({
      paths: enabled,
      ports: enabled,
      pids: enabled,
      patterns: enabled ? [{ pattern: "marker", replacement: "selected" }] : [],
    });
    const expected = createProcessTextNormalizer(
      settings,
      "/temporary",
      rootPid,
    )(input);
    expect(
      createBoundedProcessTextNormalizer(
        settings,
        "/temporary",
        rootPid,
      )(input, 4096),
    ).toEqual({
      state: "normalized",
      value: expected,
      utf8Bytes: Buffer.byteLength(expected),
    });
  }
});

it("shares sampled identifiers before custom patterns in terminal and command normalization", () => {
  const observed = [
    {
      at_ms: 0,
      pid: 100,
      parent_pid: 1,
      process_group_id: 100,
      session_id: 100,
      command: "root=100",
    },
  ];
  const lookup = createProcessIdentifierLookup(observed, () => 100);
  const before = lookup();
  expect(lookup()).toBe(before);
  const declared = scenario({
    paths: false,
    ports: false,
    pids: true,
    patterns: [
      { pattern: "<pid>", replacement: "selected" },
      { pattern: "200", replacement: "wrong-order" },
    ],
  });
  const normalize = createProcessTextNormalizer(declared, "/temporary", lookup);
  expect(normalize("root=100 child=200 other=201")).toBe(
    "root=selected child=wrong-order other=201",
  );
  observed.push({
    at_ms: 1,
    pid: 200,
    parent_pid: 100,
    process_group_id: 100,
    session_id: 100,
    command: "root=100 child=200 other=201",
  });
  expect(lookup()).not.toBe(before);
  expect(normalize(observed[1]!.command)).toBe(
    "root=selected child=selected other=201",
  );
  expect(normalizeProcessSamples(observed, declared, 100)[1]?.command).toBe(
    "root=selected child=selected other=201",
  );
});
