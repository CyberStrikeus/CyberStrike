import {
  IDA_COMPATIBILITY_PROFILES,
  readIdaConfiguration,
} from "./IdaConfiguration.js";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createIdaTarget,
  RecordingIdaMcp,
} from "../../tests/fixtures/idaMcp.js";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  AnalysisInputError,
  AnalysisProtocolError,
} from "../domain/analysisErrorCore.js";
import {
  decodeIdaToolResult,
  type IdaMcpConnection,
} from "./IdaMcpConnection.js";
import { parseConfig } from "../config/parseConfig.js";
import { IdaProvider } from "./IdaProvider.js";
import { idaCapabilities } from "./IdaProviderCapabilities.js";
import { IdaSessionClient } from "./IdaSessionClient.js";
import type {
  RetainedResourceScope,
  AnalysisProfileResolution,
} from "../application/AnalysisProvider.js";
import { ProviderInspectionScope } from "../application/ProviderInspectionScope.js";
import type { AnalysisProfileCommitment } from "../domain/analysisProfile.js";

const resourceScope: RetainedResourceScope = {
  retain: () => undefined,
  run: (operation) => operation(),
};

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

const fixture = async () => {
  const { root, target } = await createIdaTarget();
  roots.push(root);
  const producer = new RecordingIdaMcp(target);
  producer.overrideCall = (name) => {
    if (name === "decompile")
      return {
        addr: "0x1000",
        ok: true,
        pseudocode: producer.pseudocode,
        lines: 1,
      };
    if (name === "disasm")
      return {
        asm: {
          name: "main",
          start_ea: "0x1000",
          lines: "main (.text @ 0x1000):\n1000  ret",
        },
        cursor: { done: true },
      };
    if (name === "callees")
      return [
        {
          callees: [{ addr: "0x2000", name: "puts", type: "external" }],
          more: false,
          error: null,
        },
      ];
    if (name === "xrefs_to")
      return [
        {
          xrefs: [{ addr: "0x1004", type: "code", fn: null }],
          more: false,
          error: null,
        },
      ];
    return undefined;
  };
  const resources: string[] = [];
  const connection: IdaMcpConnection = {
    connect: async () => [
      "list_funcs",
      "lookup_funcs",
      "find_regex",
      "decompile",
      "disasm",
      "callees",
      "xrefs_to",
    ],
    call: (name, args) => producer.call(name, args),
    readResource: async (uri) => {
      resources.push(uri);
      const metadata = await producer.call("get_metadata", {});
      if (
        metadata === null ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
      )
        throw new Error("Invalid metadata fixture");
      return { ...metadata, path: `${producer.inputPath}.i64` };
    },
    serverInfo: () => producer.serverInfo(),
    close: () => producer.close(),
    detach: () => producer.detach(),
  };
  const client = new IdaSessionClient(
    {
      url: "http://127.0.0.1:13337/mcp",
      headers: {},
      mode: "attached",
      protocol: "native",
      timeoutMs: 1000,
    },
    target,
    connection,
  );
  return { producer, client, target, resources, root };
};

describe("native IDA attached protocol", () => {
  it("keeps the exact registration fact selected at readiness if the path changes before profile resolution", async () => {
    const { root, target, producer } = await fixture();
    const path = join(root, "mutable-registration.json");
    await writeFile(
      path,
      JSON.stringify({ command: "first-server", mode: "attached" }),
    );
    const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
    if (!config.ok) throw config.error;
    const factoryRegistrations: string[] = [];
    const provider = new IdaProvider(config.value, {}, (registration) => {
      factoryRegistrations.push(
        "command" in registration ? registration.command : registration.url,
      );
      return producer;
    });
    const controller = new AbortController();
    const scope = new ProviderInspectionScope();
    const options = { signal: controller.signal, scope, resourceScope };
    const readiness = await provider.inspectReadinessSnapshot(options);
    expect(readiness.availability).toMatchObject({
      status: "available",
      diagnostics: { mode: "attached" },
    });
    await writeFile(
      path,
      JSON.stringify({ command: "replacement-server", mode: "headless" }),
    );
    const profile = await provider.resolveAnalysisProfile(target, options);
    if (!profile.ok) throw profile.error;
    expect(profile.value.profile.parameters).toMatchObject({
      mode: "attached",
    });
    const createBoundClient = profile.value.createClient;
    if (createBoundClient === undefined)
      throw new Error("IDA profile did not retain its client factory");
    const client = createBoundClient(target, profile.value.profile);
    const restoredClient = createBoundClient(target, profile.value.profile);
    expect(factoryRegistrations).toEqual(["first-server", "first-server"]);
    await client.close();
    await restoredClient.close();
    scope.close();
  });

  it("does not reuse a registration across independent scopes sharing one signal", async () => {
    const { root, target } = await fixture();
    const path = join(root, "independent-registration.json");
    await writeFile(path, JSON.stringify({ command: "first-server" }));
    const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
    if (!config.ok) throw config.error;
    const provider = new IdaProvider(config.value, {});
    const controller = new AbortController();
    const firstScope = new ProviderInspectionScope();
    const first = await provider.inspectReadinessSnapshot({
      signal: controller.signal,
      scope: firstScope,
      resourceScope,
    });
    expect(first.availability.status).toBe("available");
    const firstProfile = await provider.resolveAnalysisProfile(target, {
      signal: controller.signal,
      scope: firstScope,
      resourceScope,
    });
    if (!firstProfile.ok) throw firstProfile.error;
    await writeFile(path, JSON.stringify({ command: "second-server" }));
    const secondScope = new ProviderInspectionScope();
    const second = await provider.inspectReadinessSnapshot({
      signal: controller.signal,
      scope: secondScope,
      resourceScope,
    });
    expect(second.availability.status).toBe("available");
    const profile = await provider.resolveAnalysisProfile(target, {
      signal: controller.signal,
      scope: secondScope,
      resourceScope,
    });
    if (!profile.ok) throw profile.error;
    expect(profile.value.profile.parameters.mode).toBe("attached");
    expect(profile.value.profile.digest).not.toBe(
      firstProfile.value.profile?.digest,
    );
    firstScope.close();
    secondScope.close();
  });
});

describe("IDA selected registration factories", () => {
  it("retains every concurrently resolved registration factory without eviction", async () => {
    const { root, target } = await fixture();
    const path = join(root, "many-registrations.json");
    const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
    if (!config.ok) throw config.error;
    const observed: string[] = [];
    const producer = new RecordingIdaMcp(target);
    const provider = new IdaProvider(config.value, {}, (registration) => {
      observed.push(
        "command" in registration ? registration.command : registration.url,
      );
      return producer;
    });
    const bindings: {
      readonly createClient: NonNullable<
        AnalysisProfileResolution["createClient"]
      >;
      readonly profile: AnalysisProfileCommitment;
    }[] = [];
    const signal = new AbortController().signal;
    for (let index = 0; index < 40; index += 1) {
      await writeFile(path, JSON.stringify({ command: `server-${index}` }));
      const scope = new ProviderInspectionScope();
      const resolution = await provider.resolveAnalysisProfile(target, {
        signal,
        scope,
        resourceScope,
      });
      if (!resolution.ok) throw resolution.error;
      if (
        resolution.value.profile === null ||
        resolution.value.createClient === undefined
      )
        throw new Error(
          "IDA profile resolution omitted its bound client factory",
        );
      bindings.push({
        createClient: resolution.value.createClient,
        profile: resolution.value.profile,
      });
      scope.close();
    }
    const clients = bindings.map(({ createClient, profile }) =>
      createClient(target, profile),
    );
    expect(observed).toEqual(
      Array.from({ length: 40 }, (_, index) => `server-${index}`),
    );
    const mismatchedTargetClient = bindings[0]!.createClient(
      { ...target, path: `${target.path}.different` },
      bindings[0]!.profile,
    );
    const mismatchedProfileClient = bindings[0]!.createClient(
      target,
      bindings[1]!.profile,
    );
    expect((await mismatchedTargetClient.execute("health", {})).ok).toBe(false);
    expect((await mismatchedProfileClient.execute("health", {})).ok).toBe(
      false,
    );
    await mismatchedTargetClient.close();
    await mismatchedProfileClient.close();
    for (const client of clients) await client.close();
  });

  it("requires explicit opt-in and rejects native headless registrations", async () => {
    const { root } = await fixture();
    const path = join(root, "native.json");
    await writeFile(
      path,
      JSON.stringify({ url: "http://127.0.0.1:13337/mcp", protocol: "native" }),
    );
    expect(await readIdaConfiguration(path, { resourceScope })).toMatchObject({
      ok: true,
      value: { mode: "attached", protocol: "native" },
    });
    await writeFile(
      path,
      JSON.stringify({
        url: "http://127.0.0.1:13337/mcp",
        protocol: "native",
        mode: "headless",
      }),
    );
    expect((await readIdaConfiguration(path, { resourceScope })).ok).toBe(
      false,
    );
    await writeFile(path, JSON.stringify({ command: "python" }));
    const old = await readIdaConfiguration(path, { resourceScope });
    expect(old.ok && old.value.protocol).toBeUndefined();
  });

  it("commits native profile semantics and advertises GUI effects without starting a provider", async () => {
    const { root, target, producer } = await fixture();
    const path = join(root, "profile.json");
    await writeFile(
      path,
      JSON.stringify({ url: "http://127.0.0.1:13337/mcp", protocol: "native" }),
    );
    const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
    if (!config.ok) throw config.error;
    const provider = new IdaProvider(config.value, {}, () => {
      throw new Error("Unexpected discovery startup");
    });
    expect((await provider.inspectAvailability()).status).toBe("available");
    const profile = await provider.resolveAnalysisProfile(target);
    if (!profile.ok) throw profile.error;
    expect(profile.value.profile.provider.name).toBe("IDA MCP adapter");
    expect(profile.value.profile.parameters).toMatchObject({
      compatibility_profile: "native-ida-mcp",
      mode: "attached",
      cache_policy: "live",
      engine_version: null,
    });
    const readiness = await provider.inspectReadinessSnapshot();
    expect(
      readiness.capabilities.find(
        ({ operation }) => operation === "procedure_assembly",
      )?.effects.mayShowUi,
    ).toBe(false);
    expect(producer.connects).toBe(0);
  });
});

describe("native IDA complete result decoding", () => {
  it("uses complete native JSON text instead of a shortened structured preview", () => {
    const complete = [
      {
        data: [{ addr: "0x1000", name: "main", size: "0x20" }],
        next_offset: null,
      },
    ];
    const response = {
      content: [{ type: "text", text: JSON.stringify(complete) }],
      structuredContent: { result: [], _output_truncated: true },
    };
    expect(decodeIdaToolResult(response, "native")).toEqual(complete);
    expect(() =>
      decodeIdaToolResult({ ...response, content: [] }, "native"),
    ).toThrow("complete JSON");
    expect(() =>
      decodeIdaToolResult(
        { ...response, content: [{ type: "text", text: "broken JSON" }] },
        "native",
      ),
    ).toThrow();
    expect(() =>
      decodeIdaToolResult({ ...response, isError: true }, "native"),
    ).toThrow("tool failed");
  });
});

describe("native IDA provider observations", () => {
  it.each([false, true])(
    "keeps unknown callers in dossier coverage when callee truncation is %s",
    async (more) => {
      const { client, producer } = await fixture();
      const original = producer.overrideCall;
      producer.overrideCall = (name, args) =>
        name === "callees"
          ? [
              {
                callees: [{ addr: "0x2000", name: "puts", type: "external" }],
                more,
                error: null,
              },
            ]
          : original?.(name, args);
      try {
        const direct = await client.execute("procedure_callees", {
          procedure: "main",
        });
        if (!direct.ok) throw direct.error;
        expect(direct.value.relationshipCoverage).toMatchObject({
          status: more ? "partial" : "complete",
        });
        const dossier = await client.execute("analyze_function", {
          procedure: "main",
        });
        if (!dossier.ok) throw dossier.error;
        expect(dossier.value.relationshipCoverage).toMatchObject({
          status: "unknown",
          reason: more
            ? expect.stringContaining(
                "Callees: Upstream callees capped results at 500; additional callees remain unknown.",
              )
            : expect.stringContaining(
                "Callers: Upstream xrefs do not establish direct caller relationships.",
              ),
        });
        if (more)
          expect(dossier.value.relationshipCoverage).toMatchObject({
            reason: expect.stringContaining(
              "Callers: Upstream xrefs do not establish direct caller relationships.",
            ),
          });
        expect(dossier.value.result).toMatchObject({
          callers: [],
          callees: [{ address: "0x2000", name: "puts" }],
          facet_availability: {
            callers: { available: false },
            callees: { available: true },
          },
        });
        if (more)
          expect(dossier.value.limitations).toContain(
            "Upstream callees capped results at 500; additional callees remain unknown.",
          );
      } finally {
        await client.close();
      }
    },
  );

  it("retains native tool provenance, reads recorded metadata, and closes only its connection", async () => {
    const { client, producer, resources } = await fixture();
    for (const operation of [
      "list_procedures",
      "list_strings",
      "procedure_assembly",
      "procedure_pseudo_code",
      "procedure_callees",
      "xrefs",
      "analyze_function",
    ] as const) {
      const result = await client.execute(
        operation,
        operation === "list_procedures" || operation === "list_strings"
          ? {}
          : operation === "xrefs"
            ? { address: "0x1000" }
            : { procedure: "main" },
      );
      if (!result.ok) throw result.error;
      expect(result.value.provider.name).toBe("IDA MCP adapter");
      if (operation === "xrefs")
        expect(
          result.value.referencesTruncated,
          "the native producer's explicit cap flag is forwarded",
        ).toBe(false);
      if (operation === "procedure_assembly")
        expect(result.value.result).toBe("0x1000: ret");
      if (operation === "procedure_pseudo_code") {
        expect(result.value.result).toBe(producer.pseudocode);
        expect(result.value.rawResult).toMatchObject({
          observations: expect.arrayContaining([
            expect.objectContaining({
              tool: "decompile",
              result: {
                addr: "0x1000",
                ok: true,
                pseudocode: producer.pseudocode,
                lines: 1,
              },
            }),
          ]),
        });
      }
    }
    expect(resources).toHaveLength(14);
    expect(new Set(resources)).toEqual(new Set(["ida://idb/metadata"]));
    expect(
      producer.calls.find(({ name }) => name === "find_regex")?.args.pattern,
    ).toBe("[\\s\\S]*");
    expect(
      (await client.execute("procedure_callers", { procedure: "main" })).ok,
    ).toBe(false);
    expect((await client.close()).ok).toBe(true);
    expect(producer.closes).toBe(1);
    expect(producer.calls.some(({ name }) => name.startsWith("idb_"))).toBe(
      false,
    );
    const declared = idaCapabilities(IDA_COMPATIBILITY_PROFILES.native, false);
    expect(
      declared.find(({ operation }) => operation === "procedure_callers")
        ?.available,
    ).toBe(false);
    expect(
      declared.find(({ operation }) => operation === "procedure_pseudo_code")
        ?.effects,
    ).toMatchObject({ mayShowUi: true, mayAccessNetwork: true });
    expect(
      idaCapabilities(IDA_COMPATIBILITY_PROFILES.legacy, false).find(
        ({ operation }) => operation === "procedure_callers",
      )?.available,
    ).toBe(true);
  });

  it("rejects unavailable or mismatched recorded input hashes and database switches", async () => {
    const { client, producer, target } = await fixture();
    for (const hash of ["unavailable", "a".repeat(64)]) {
      producer.inputSha256 = hash;
      expect((await client.execute("health", {})).ok).toBe(false);
    }
    producer.inputSha256 = target.sha256;
    expect((await client.execute("health", {})).ok).toBe(true);
    producer.inputPath += ".other.i64";
    expect((await client.execute("list_procedures", {})).ok).toBe(false);
    await client.close();
  });
});

describe("native IDA query identity", () => {
  it.each([
    "procedure_address",
    "procedure_assembly",
    "procedure_pseudo_code",
    "analyze_function",
  ] as const)(
    "rejects a successful lookup for another query before %s can accept the wrong function",
    async (operation) => {
      const { client, producer } = await fixture();
      producer.overrideCall = (name) =>
        name === "lookup_funcs"
          ? [
              {
                query: "helper",
                fn: { addr: "0x2000", name: "helper", size: "0x20" },
                error: null,
              },
            ]
          : undefined;
      try {
        const result = await client.execute(operation, { procedure: "main" });
        if (result.ok)
          throw new Error("Expected a mismatched lookup rejection");
        expect(result.error._tag).toBe("AnalysisProtocolError");
        expect(result.error.message).toContain("different query");
        expect(
          producer.calls.some(
            ({ name }) => name === "disasm" || name === "decompile",
          ),
        ).toBe(false);
      } finally {
        expect((await client.close()).ok).toBe(true);
      }
    },
  );
});

describe("native IDA callee truncation", () => {
  it("rejects native successes without an explicit truncation marker and preserves upstream failures", async () => {
    const { client, producer } = await fixture();
    const previous = producer.overrideCall;
    try {
      producer.overrideCall = (name, args) =>
        name === "callees"
          ? [{ callees: [], error: null }]
          : previous?.(name, args);
      for (const operation of [
        "procedure_callees",
        "analyze_function",
      ] as const) {
        const result = await client.execute(operation, { procedure: "main" });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBeInstanceOf(AnalysisProtocolError);
          expect(result.error.message).toContain("truncation marker");
        }
      }
      producer.overrideCall = (name, args) =>
        name === "callees"
          ? [{ callees: null, error: "callee database failure" }]
          : previous?.(name, args);
      const result = await client.execute("procedure_callees", {
        procedure: "main",
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.message).toContain("callee database failure");
    } finally {
      await client.close();
    }
  });
});

describe("native IDA callee lookup batches", () => {
  it("batches unique callees and binds reordered replies to their source queries", async () => {
    const { client, producer } = await fixture();
    const previous = producer.overrideCall;
    producer.overrideCall = (name, args) => {
      if (name === "callees")
        return [
          {
            callees: [
              { addr: "0x2004", name: "first", type: "internal" },
              { addr: "0x2004", name: "first", type: "internal" },
              { addr: "0x3000", name: "second", type: "internal" },
              { addr: "0x4000", name: "import", type: "external" },
            ],
            more: false,
            error: null,
          },
        ];
      if (
        name === "lookup_funcs" &&
        Array.isArray(args.queries) &&
        args.queries.length > 1
      )
        return [
          {
            query: "0x3000",
            fn: { addr: "0x3000", name: "second", size: "0x20" },
            error: null,
          },
          {
            query: "0x2004",
            fn: { addr: "0x2000", name: "first", size: "0x20" },
            error: null,
          },
        ];
      return previous?.(name, args);
    };
    try {
      const result = await client.execute("procedure_callees", {
        procedure: "main",
      });
      if (!result.ok) throw result.error;
      expect(result.value.result).toEqual(["0x4000", "0x2000", "0x3000"]);
      expect(
        producer.calls
          .filter(({ name }) => name === "lookup_funcs")
          .map(({ args }) => args.queries),
      ).toEqual([["main"], ["0x2004", "0x3000"]]);
      expect(result.value.rawResult).toMatchObject({
        observations: expect.arrayContaining([
          expect.objectContaining({
            tool: "lookup_funcs",
            arguments: { queries: ["0x2004", "0x3000"] },
            result: [
              expect.objectContaining({ query: "0x3000" }),
              expect.objectContaining({ query: "0x2004" }),
            ],
          }),
        ]),
      });
    } finally {
      await client.close();
    }
  });

  it("rejects missing, duplicate, unrelated, and failed callee lookup rows as provider faults", async () => {
    const { client, producer } = await fixture();
    const previous = producer.overrideCall;
    const first = {
      query: "0x2000",
      fn: { addr: "0x2000", name: "first", size: "0x20" },
      error: null,
    };
    const second = {
      query: "0x3000",
      fn: { addr: "0x3000", name: "second", size: "0x20" },
      error: null,
    };
    let rows: JsonValue = [];
    producer.overrideCall = (name, args) => {
      if (name === "callees")
        return [
          {
            callees: [
              { addr: "0x2000", name: "first", type: "internal" },
              { addr: "0x3000", name: "second", type: "internal" },
            ],
            more: false,
            error: null,
          },
        ];
      if (
        name === "lookup_funcs" &&
        Array.isArray(args.queries) &&
        args.queries.length > 1
      )
        return rows;
      return previous?.(name, args);
    };
    try {
      for (const reply of [
        [first],
        [first, first],
        [first, { ...second, query: "unrequested" }],
        [first, { query: "0x3000", fn: null, error: "Not found" }],
      ]) {
        rows = reply;
        const result = await client.execute("procedure_callees", {
          procedure: "main",
        });
        expect(result.ok).toBe(false);
        if (!result.ok)
          expect(result.error).toBeInstanceOf(AnalysisProtocolError);
      }
    } finally {
      await client.close();
    }
  });
});

const nativeLiteralValues = [
  "A.B",
  "axb",
  "Kelvin",
  "İstanbul",
  "σ",
  "ς",
  "literal[bracket",
  "a\\b",
  "🧪",
  "Σ",
  "ΟΣ",
  "ος",
  "S",
  "s",
  "ſ",
];

describe("native IDA literal matching", () => {
  it("retains literal, Unicode, case, and regex semantics while narrowing native candidates", async () => {
    const { client, producer } = await fixture();
    const values = nativeLiteralValues;
    producer.overrideCall = (name, args) => {
      if (name !== "find_regex") return undefined;
      if (typeof args.pattern !== "string")
        throw new Error("Invalid fixture pattern");
      // Exercise a byte-oriented producer seam, including Unicode candidates
      // whose final matching semantics belong to REA, not the upstream regex.
      const regex = new RegExp(
        Buffer.from(args.pattern).toString("latin1"),
        "i",
      );
      return {
        matches: values.flatMap((value, i) =>
          regex.test(Buffer.from(value).toString("latin1"))
            ? [{ addr: `0x${(0x3000 + i).toString(16)}`, string: value }]
            : [],
        ),
        cursor: { done: true },
      };
    };
    const cases = [
      {
        pattern: "ſ",
        mode: "literal",
        case_sensitive: false,
        expected: ["İstanbul", "S", "s", "ſ"],
      },
      {
        pattern: "a.b",
        mode: "literal",
        case_sensitive: false,
        expected: ["A.B"],
      },
      { pattern: "a.b", mode: "literal", case_sensitive: true, expected: [] },
      {
        pattern: "kelvin",
        mode: "literal",
        case_sensitive: false,
        expected: ["Kelvin"],
      },
      {
        pattern: "İ",
        mode: "literal",
        case_sensitive: false,
        expected: ["İstanbul"],
      },
      // Match the shared Unicode contract after the byte-oriented producer has
      // returned candidates, including final sigma inside a word.
      ...["σ", "ς", "Σ"].map((pattern) => ({
        pattern,
        mode: "literal",
        case_sensitive: false,
        expected: ["σ", "ς", "Σ", "ΟΣ", "ος"],
      })),
      ...["ΟΣ", "ος"].map((pattern) => ({
        pattern,
        mode: "literal",
        case_sensitive: false,
        expected: ["ΟΣ", "ος"],
      })),
      ...[
        { pattern: "σ", expected: ["σ"] },
        { pattern: "ς", expected: ["ς", "ος"] },
        { pattern: "Σ", expected: ["Σ", "ΟΣ"] },
        { pattern: "ΟΣ", expected: ["ΟΣ"] },
        { pattern: "ος", expected: ["ος"] },
      ].map((query) => ({
        ...query,
        mode: "literal",
        case_sensitive: true,
      })),
      {
        pattern: "σ",
        mode: "regex",
        case_sensitive: false,
        expected: ["σ", "ς", "Σ", "ΟΣ", "ος"],
      },
      {
        pattern: "[",
        mode: "literal",
        case_sensitive: false,
        expected: ["literal[bracket"],
      },
      {
        pattern: "\\",
        mode: "literal",
        case_sensitive: true,
        expected: ["a\\b"],
      },
      {
        pattern: "\ud800",
        mode: "literal",
        case_sensitive: false,
        expected: [],
      },
      {
        pattern: "🧪",
        mode: "literal",
        case_sensitive: true,
        expected: ["🧪"],
      },
    ];
    try {
      for (const { expected, ...query } of cases) {
        const before = producer.calls.length;
        const result = await client.execute("search_strings", query);
        if (!result.ok) throw result.error;
        expect(result.value.result, JSON.stringify(query)).toEqual(
          expected.map((value) => ({
            address: `0x${(0x3000 + values.indexOf(value)).toString(16)}`,
            value,
          })),
        );
        const reads = producer.calls
          .slice(before)
          .filter(({ name }) => name === "find_regex");
        expect(reads).toHaveLength(1);
        const unfiltered = query.mode === "regex" || query.pattern === "\ud800";
        const unicodeFold =
          !query.case_sensitive && /[\u0080-\u{10ffff}]/u.test(query.pattern);
        if (unfiltered || unicodeFold)
          expect(reads[0]?.args.pattern).toBe("[\\s\\S]*");
        else expect(reads[0]?.args.pattern).not.toBe("[\\s\\S]*");
      }
      const before = producer.calls.length;
      const invalid = await client.execute("search_strings", {
        pattern: "[",
        mode: "regex",
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error).toBeInstanceOf(AnalysisInputError);
      expect(
        producer.calls.slice(before).some(({ name }) => name === "find_regex"),
      ).toBe(false);
    } finally {
      await client.close();
    }
  });
});

describe("native IDA string pagination and failures", () => {
  it("reads all candidate pages and reports native search failures explicitly", async () => {
    const { client, producer } = await fixture();
    producer.overrideCall = (name, args) =>
      name === "find_regex"
        ? {
            matches: [
              {
                addr: args.offset === 0 ? "0x3000" : "0x3001",
                string: args.offset === 0 ? "σ" : "needle",
              },
            ],
            cursor: args.offset === 0 ? { next: 1 } : { done: true },
          }
        : undefined;
    try {
      const found = await client.execute("search_strings", {
        pattern: "needle",
      });
      if (!found.ok) throw found.error;
      expect(found.value.result).toEqual([
        { address: "0x3001", value: "needle" },
      ]);
      const reads = producer.calls.filter(({ name }) => name === "find_regex");
      expect(reads.map(({ args }) => args.offset)).toEqual([0, 1]);
      expect(new Set(reads.map(({ args }) => args.pattern)).size).toBe(1);
      producer.overrideCall = (name) =>
        name === "find_regex"
          ? {
              matches: [],
              cursor: { done: true },
              error: "Regex resource failure",
            }
          : undefined;
      const failed = await client.execute("search_strings", {
        pattern: "needle",
      });
      expect(failed.ok).toBe(false);
      if (!failed.ok) {
        expect(failed.error).toBeInstanceOf(AnalysisProtocolError);
        expect(failed.error.message).toContain("Regex resource failure");
      }
    } finally {
      await client.close();
    }
  });
});

describe("native IDA malformed observations", () => {
  it("rejects wrong-function pseudocode, upstream cloud failures, and malformed assembly", async () => {
    const { client, producer } = await fixture();
    for (const value of [
      { addr: "0x2000", ok: true, pseudocode: "int wrong(void);" },
      {
        addr: "0x1000",
        ok: false,
        error: "No pseudocode widget for this function after decompilation",
      },
      { addr: "0x1000", ok: true },
    ]) {
      producer.overrideCall = (name) =>
        name === "decompile" ? value : undefined;
      const result = await client.execute("procedure_pseudo_code", {
        procedure: "main",
      });
      expect(result.ok).toBe(false);
    }
    producer.overrideCall = (name) =>
      name === "disasm"
        ? {
            asm: {
              name: "main",
              start_ea: "0x1000",
              lines: "main (.text @ 0x1000):\nunsupported",
            },
            cursor: { done: true },
          }
        : undefined;
    expect(
      (await client.execute("procedure_assembly", { procedure: "main" })).ok,
    ).toBe(false);
    await client.close();
  });

  it("follows native assembly pages and rejects non-advancing cursors", async () => {
    const { client, producer } = await fixture();
    producer.overrideCall = (name, args): JsonValue | undefined =>
      name === "disasm"
        ? {
            asm: {
              name: "main",
              start_ea: "0x1000",
              lines: `main (.text @ 0x1000):\n${args.offset === 0 ? "1000  nop" : "1001  ret"}`,
            },
            cursor: args.offset === 0 ? { next: 1 } : { done: true },
          }
        : undefined;
    const result = await client.execute("procedure_assembly", {
      procedure: "main",
    });
    expect(result.ok && result.value.result).toBe("0x1000: nop\n0x1001: ret");
    producer.overrideCall = (name) =>
      name === "find_regex" ? { matches: [], cursor: { next: 0 } } : undefined;
    expect((await client.execute("list_strings", {})).ok).toBe(false);
    await client.close();
  });
});

describe("native IDA attached operation admission", () => {
  it("reports the bound document but not headless-only address resolution", async () => {
    const { client, producer, target } = await fixture();
    const containing = await client.execute("resolve_containing_procedure", {
      address: "0x1000",
    });
    expect(containing.ok).toBe(false);
    if (!containing.ok)
      expect(containing.error._tag).toBe("AnalysisCapabilityUnavailableError");

    const documents = await client.execute("list_documents", {});
    if (!documents.ok) throw documents.error;
    expect(documents.value.result).toEqual([target.path]);
    expect(
      producer.calls.some(({ name }) => name === "lookup_funcs"),
      "nothing is dispatched upstream",
    ).toBe(false);
    await client.close();
  });
});
