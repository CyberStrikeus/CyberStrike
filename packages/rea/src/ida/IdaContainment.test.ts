import { IDA_COMPATIBILITY_PROFILES } from "./IdaConfiguration.js";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  createIdaTarget,
  RecordingIdaMcp,
} from "../../tests/fixtures/idaMcp.js";
import { decodeIdaToolResult } from "./IdaMcpConnection.js";
import { idaCapabilities } from "./IdaProviderCapabilities.js";
import { IdaSessionClient } from "./IdaSessionClient.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

const segment = (name: string, start: string, end: string) => ({
  name,
  start,
  end,
  size: `0x${(BigInt(end) - BigInt(start)).toString(16)}`,
  permissions: "r--",
});

/** Adjacent .text and .data, a gap, then a segment above 2^53. */
const SEGMENTS = [
  segment(".text", "0x1000", "0x2000"),
  segment(".data", "0x2000", "0x3000"),
  segment(".far", "0x5000", "0x6000"),
  segment(".huge", "0x20000000000001", "0x20000000000002"),
];

/** The same segments in descending order, which a scan may not rely on. */
const UNSORTED = [...SEGMENTS].reverse();

const survey = (segments: JsonValue = SEGMENTS) => ({
  metadata: { path: "/db/target.i64", module: "target", arch: "metapc" },
  statistics: { total_segments: Array.isArray(segments) ? segments.length : 0 },
  segments,
  entrypoints: [],
});

const function_ = { addr: "0x1000", name: "main", size: "0x20" };

const MODERN_WITHOUT_SURVEY = [
  "idb_open",
  "idb_list",
  "idb_close",
  "server_health",
  "list_funcs",
  "lookup_funcs",
  "find_regex",
  "decompile",
  "disasm",
  "callees",
  "xrefs_to",
];

interface Upstream {
  /** Answer for the lookup of the queried address; default is "Not a function". */
  readonly lookup?: (query: string) => JsonValue;
  readonly survey?: JsonValue;
  readonly tools?: readonly string[];
  readonly surveyFailure?: "error" | "preview";
  /** A distinct source alias of the admitted target, as for an app bundle. */
  readonly sourcePath?: string;
  /** Report a different input from the second health read on. */
  readonly identityChangesAfterOperation?: boolean;
}

const session = async (
  upstream: Upstream = {},
  mode: "headless" | "attached" = "headless",
) => {
  const created = await createIdaTarget("x86_64");
  const { root } = created;
  const target =
    upstream.sourcePath === undefined
      ? created.target
      : { ...created.target, sourcePath: upstream.sourcePath };
  roots.push(root);
  const producer = new RecordingIdaMcp(target, mode);
  if (upstream.tools !== undefined) producer.tools = upstream.tools;
  producer.beforeCall = async (name) => {
    if (name !== "survey_binary") return;
    if (upstream.surveyFailure === "error")
      decodeIdaToolResult({
        content: [{ type: "text", text: "survey failed" }],
        isError: true,
      });
    if (upstream.surveyFailure === "preview")
      decodeIdaToolResult({
        content: [{ type: "text", text: "preview" }],
        _meta: { ida_mcp: { output_truncated: true } },
      });
  };
  let healthReads = 0;
  producer.overrideCall = (name, args) => {
    if (name === "server_health" && upstream.identityChangesAfterOperation) {
      healthReads += 1;
      if (healthReads === 2)
        return {
          status: "ok",
          input_path: "/different/target.elf",
          idb_path: "/different/target.elf.i64",
          module: "target.elf",
          imagebase: "0x1000",
          auto_analysis_ready: true,
        };
    }
    if (name === "lookup_funcs") {
      const queries = Array.isArray(args.queries) ? args.queries : [];
      return queries.map((query) =>
        upstream.lookup === undefined
          ? { query, fn: null, error: "Not a function" }
          : upstream.lookup(String(query)),
      );
    }
    if (name === "survey_binary") return upstream.survey ?? survey();
    return undefined;
  };
  const client = new IdaSessionClient(
    {
      command: "fixture",
      args: [],
      env: {},
      mode,
      timeoutMs: 1000,
      workspaceRoot: root,
    },
    target,
    producer,
  );
  return { client, producer, target };
};

const containing = async (
  client: IdaSessionClient,
  address: string,
  options?: Parameters<IdaSessionClient["execute"]>[2],
) => client.execute("resolve_containing_procedure", { address }, options);

const found = (query: string, fn: typeof function_) => ({
  query,
  fn,
  error: null,
});

describe("IDA containment capabilities", () => {
  it("declares document identity in both profiles and address resolution only in headless", () => {
    const declared = (mode: "attached" | "headless", native = false) =>
      idaCapabilities(
        IDA_COMPATIBILITY_PROFILES[
          native ? "native" : mode === "attached" ? "legacy" : "modern"
        ],
        false,
      )
        .map(({ operation }) => operation)
        .filter(
          (operation) =>
            operation === "resolve_containing_procedure" ||
            operation === "list_documents",
        );

    expect(
      idaCapabilities(IDA_COMPATIBILITY_PROFILES.modern, false)
        .filter(
          ({ operation }) =>
            operation === "resolve_containing_procedure" ||
            operation === "list_documents",
        )
        .map(({ available }) => available),
      "both are declared available, not merely listed",
    ).toEqual([true, true]);
    expect(declared("headless")).toEqual([
      "resolve_containing_procedure",
      "list_documents",
    ]);
    expect(declared("attached")).toEqual(["list_documents"]);
    expect(declared("attached", true)).toEqual(["list_documents"]);
    expect(
      idaCapabilities(IDA_COMPATIBILITY_PROFILES.legacy, false).map(
        ({ operation }) => operation,
      ),
      "attached profiles declare the bound document but not address resolution",
    ).toContain("list_documents");
  });

  it("refuses address resolution on the legacy attached profile", async () => {
    const { client, producer } = await session({}, "attached");
    try {
      const result = await client.execute("resolve_containing_procedure", {
        address: "0x1000",
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error._tag).toBe("AnalysisCapabilityUnavailableError");
      expect(producer.calls.some(({ name }) => name === "lookup_funcs")).toBe(
        false,
      );
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});

describe("headless IDA containing procedure", () => {
  it("returns the canonical entry for an interior address without reading segments", async () => {
    const { client, producer } = await session({
      lookup: (query) => found(query, function_),
    });
    try {
      const result = await containing(client, "1ffe");

      if (!result.ok) throw result.error;
      expect(result.value.result).toEqual({
        query_address: "0x1ffe",
        found: true,
        procedure: {
          address: "0x1000",
          name: "main",
          symbol: null,
          classification: null,
          body: {
            available: false,
            reason: "IDA MCP does not report complete function body ranges.",
          },
        },
      });
      expect(
        producer.calls.filter(({ name }) => name === "lookup_funcs"),
        "the normalized address is the only query",
      ).toMatchObject([{ args: { queries: ["0x1ffe"] } }]);
      expect(
        producer.calls.some(({ name }) => name === "survey_binary"),
        "a positive answer needs no segment facts",
      ).toBe(false);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it.each([
    ["inside the first segment", "0x1000", "not_in_procedure"],
    ["inside an adjacent segment", "0x2000", "not_in_procedure"],
    [
      "at the exclusive end of the last adjacent segment",
      "0x3000",
      "outside_segments",
    ],
    ["in the gap between segments", "0x4000", "outside_segments"],
    ["one below a segment start", "0xfff", "outside_segments"],
    ["the last byte of a segment", "0x5fff", "not_in_procedure"],
    ["above every segment", "0x6000", "outside_segments"],
    [
      "inside a one-byte segment above 2^53",
      "0x20000000000001",
      "not_in_procedure",
    ],
    [
      "one below that segment, which a rounded number cannot tell apart",
      "0x20000000000000",
      "outside_segments",
    ],
    [
      "at the exclusive end of that segment",
      "0x20000000000002",
      "outside_segments",
    ],
  ] as const)(
    "reports an address that is not a function %s as %s",
    async (_description, address, reason) => {
      const { client, producer } = await session();
      try {
        const result = await containing(client, address);

        if (!result.ok) throw result.error;
        expect(result.value.result).toEqual({
          query_address: address,
          found: false,
          procedure: null,
          reason,
        });
        expect(
          producer.calls.find(({ name }) => name === "survey_binary")?.args,
          "the minimal survey is the only segment source",
        ).toMatchObject({ detail_level: "minimal" });
        expect(
          producer.calls.filter(({ name }) => name === "survey_binary"),
        ).toHaveLength(1);
      } finally {
        expect((await client.close()).ok).toBe(true);
      }
    },
  );
});

describe("headless IDA containment failures", () => {
  it.each([
    ["no segments field", { metadata: {}, statistics: {} }],
    ["segments that are null", survey(null)],
    ["an empty segment list", survey([])],
    [
      "a row with a malformed address",
      survey([
        {
          name: ".x",
          start: "0xzz",
          end: "0x2000",
          size: "0x1000",
          permissions: "r--",
        },
      ]),
    ],
    [
      "a reversed segment",
      survey([
        { name: ".x", start: "0x2000", end: "0x1000", permissions: "r--" },
      ]),
    ],
    [
      "a size that disagrees with the bounds",
      survey([{ ...segment(".x", "0x1000", "0x2000"), size: "0x10" }]),
    ],
    [
      "a total that disagrees with the rows",
      { ...survey(), statistics: { total_segments: 9 } },
    ],
    ["a malformed row after valid ones", survey([...SEGMENTS, { name: ".y" }])],
  ] as const)(
    "fails instead of guessing a reason when the survey has %s",
    async (_description, reply) => {
      const { client } = await session({ survey: reply as JsonValue });
      try {
        const result = await containing(client, "0x4000");

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error._tag).toBe("AnalysisOutputError");
      } finally {
        expect((await client.close()).ok).toBe(true);
      }
    },
  );

  it.each(["error", "preview"] as const)(
    "fails when the survey tool reports %s",
    async (surveyFailure) => {
      const { client } = await session({ surveyFailure });
      try {
        const result = await containing(client, "0x4000");

        expect(result.ok).toBe(false);
      } finally {
        expect((await client.close()).ok).toBe(true);
      }
    },
  );

  it("fails without a segment source when the server does not advertise the survey", async () => {
    const { client, producer } = await session({
      tools: MODERN_WITHOUT_SURVEY,
    });
    try {
      const negative = await containing(client, "0x4000");

      expect(negative.ok).toBe(false);
      expect(
        producer.calls.some(({ name }) => name === "survey_binary"),
        "an unadvertised tool is never requested",
      ).toBe(false);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("still answers a positive lookup when the server does not advertise the survey", async () => {
    const { client } = await session({
      lookup: (query) => found(query, function_),
      tools: MODERN_WITHOUT_SURVEY,
    });
    try {
      const result = await containing(client, "0x1010");

      expect(result.ok).toBe(true);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});

describe("headless IDA containment lookup failures", () => {
  it.each([
    ["an answer for another query", () => found("0x9999", function_)],
    [
      "a function together with an error",
      (query: string) => ({ query, fn: function_, error: "Not found" }),
    ],
    [
      "neither a function nor an error",
      (query: string) => ({ query, fn: null, error: null }),
    ],
    [
      "an unknown error text",
      (query: string) => ({ query, fn: null, error: "boom" }),
    ],
    [
      "a padded missing answer",
      (query: string) => ({ query, fn: null, error: " Not a function" }),
    ],
  ] as const)(
    "treats %s as a producer failure and reads no segments",
    async (_description, lookup) => {
      const { client, producer } = await session({ lookup });
      try {
        const result = await containing(client, "0x4000");

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error._tag).toBe("AnalysisProtocolError");
        expect(
          producer.calls.some(({ name }) => name === "survey_binary"),
        ).toBe(false);
      } finally {
        expect((await client.close()).ok).toBe(true);
      }
    },
  );

  it('treats "Not found" for an address like any expected missing answer', async () => {
    const { client } = await session({
      lookup: (query) => ({ query, fn: null, error: "Not found" }),
    });
    try {
      const result = await containing(client, "0x4000");

      if (!result.ok) throw result.error;
      expect(result.value.result).toMatchObject({
        found: false,
        reason: "outside_segments",
      });
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("stops before the survey when the request is cancelled after the lookup", async () => {
    const controller = new AbortController();
    const { client, producer } = await session();
    const inner = producer.beforeCall;
    producer.beforeCall = async (name, args) => {
      await inner?.(name, args);
      if (name === "lookup_funcs") controller.abort();
    };
    try {
      const result = await containing(client, "0x4000", {
        signal: controller.signal,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(
        producer.calls.some(({ name }) => name === "survey_binary"),
        "nothing is dispatched after cancellation",
      ).toBe(false);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("does not depend on the order of the surveyed segments", async () => {
    const { client } = await session({ survey: survey(UNSORTED) });
    try {
      const inside = await containing(client, "0x1000");
      const gap = await containing(client, "0x4000");

      if (!inside.ok) throw inside.error;
      if (!gap.ok) throw gap.error;
      expect(inside.value.result).toMatchObject({ reason: "not_in_procedure" });
      expect(gap.value.result).toMatchObject({ reason: "outside_segments" });
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("retains the completed replies when the survey is rejected", async () => {
    const { client } = await session({
      survey: survey([
        { name: ".x", start: "0x2000", end: "0x1000", permissions: "r--" },
      ]),
    });
    try {
      const result = await containing(client, "0x4000");

      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.partialObservation).toMatchObject({
          normalized_result: {
            status: "partial",
            observations: [
              expect.objectContaining({ tool: "lookup_funcs" }),
              expect.objectContaining({ tool: "survey_binary" }),
            ],
          },
        });
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("rejects an address that is not hexadecimal and a document that is not the admitted target", async () => {
    const { client, producer } = await session();
    try {
      const badAddress = await containing(client, "main");
      const badDocument = await client.execute("resolve_containing_procedure", {
        address: "0x1000",
        document: "/somewhere/else",
      });

      for (const result of [badAddress, badDocument]) {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error._tag).toBe("AnalysisInputError");
      }
      expect(
        producer.calls.some(({ name }) => name === "lookup_funcs"),
        "invalid input never reaches upstream",
      ).toBe(false);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});

describe("headless IDA document identity", () => {
  it("accepts an explicit admitted document and rejects an unknown one for the same operations", async () => {
    const { client, target, producer } = await session();
    try {
      const admitted = await client.execute("resolve_containing_procedure", {
        address: "0x4000",
        document: target.path,
      });
      const unknownContainment = await client.execute(
        "resolve_containing_procedure",
        { address: "0x4000", document: "/somewhere/else" },
      );
      const unknownListing = await client.execute("list_documents", {
        document: "/somewhere/else",
      });

      expect(admitted.ok, "the admitted program is accepted").toBe(true);
      for (const rejected of [unknownContainment, unknownListing]) {
        expect(rejected.ok).toBe(false);
        if (!rejected.ok)
          expect(rejected.error._tag).toBe("AnalysisInputError");
      }
      expect(
        producer.calls.filter(({ name }) => name === "lookup_funcs"),
        "only the admitted request reached upstream",
      ).toHaveLength(1);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("lists the admitted path, not its source alias or the private copy", async () => {
    const { client, target, producer } = await session({
      sourcePath: "/Applications/Fixture.app",
    });
    try {
      const result = await client.execute("list_documents", {});

      if (!result.ok) throw result.error;
      expect(result.value.result).toEqual([target.path]);
      expect(
        producer.calls.filter(({ name }) => name === "server_health"),
        "the target identity is checked before and after the local answer",
      ).toHaveLength(2);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("fails when the target identity changes during the operation", async () => {
    const { client } = await session({ identityChangesAfterOperation: true });
    try {
      const result = await client.execute("list_documents", {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("identity changed");
      }
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("stops without dispatching when the request is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, producer } = await session();
    try {
      const result = await client.execute(
        "list_documents",
        {},
        { signal: controller.signal },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(producer.calls).toEqual([]);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("lists exactly the admitted program", async () => {
    const { client, target } = await session();
    try {
      const result = await client.execute("list_documents", {});

      if (!result.ok) throw result.error;
      expect(result.value.result).toEqual([target.path]);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});
