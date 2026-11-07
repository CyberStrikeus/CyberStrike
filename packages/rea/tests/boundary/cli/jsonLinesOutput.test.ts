import { Writable } from "node:stream";

import { Cli, z } from "incur";
import { estimateTokenCount } from "tokenx";
import { describe, expect, it } from "vitest";

import {
  createCliResultOutput,
  streamCliCommandResults,
} from "../../../src/cli/cliResultOutput.js";
import {
  JSON_LINES_SELECTION_REMEDIATION,
  jsonLinesErrorRecord,
} from "../../../src/cli/jsonLines.js";
import { parseCliOutputArguments } from "../../../src/cliOutput.js";
import { logCliCommand } from "../../../src/cliLogging.js";
import { silentLogger } from "../../../src/logger.js";

const capture = (args: readonly string[]) => {
  const chunks: Buffer[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  const output = createCliResultOutput(
    parseCliOutputArguments(args),
    destination,
  );
  if (output === undefined) throw new Error("Missing output owner");
  return {
    output,
    destination,
    text: () => Buffer.concat(chunks).toString("utf8"),
  };
};
const lines = (text: string): unknown[] =>
  text.trimEnd() === ""
    ? []
    : text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
const metadata = { command: "fixture", duration: "1ms", format: "jsonl" };

describe("row-oriented CLI JSON Lines", () => {
  it.each(["rows", "items", "records", "occurrences"])(
    "preserves all context around %s without a field whitelist",
    async (key) => {
      const records = [
        { id: "one", index: 8, text: "first\n雪𝟠" },
        { id: "two", index: 9 },
      ];
      const context = {
        evidence_id: "ev:parent",
        subject: { path: "/local/subject" },
        provider: "actual-provider",
        authority: "static",
        confidence: "derived",
        locations: [{ path: "/source", line: 4 }],
        parameters: { field: "caller choice" },
        raw_result: null,
        evidence_links: ["ev:source"],
        limitations: ["partial source"],
        normalized_result: {
          kind: "inventory",
          parent_digest: "sha256:parent",
          view_digest: "sha256:view",
          artifact: { id: "art:one" },
          coverage: { complete: false, examined: 2, total: null },
          page: { offset: 8, has_more: true },
          [key]: records,
        },
      };
      const stream = capture(["--format", "jsonl"]);
      await stream.output.write(context, metadata);
      const { [key]: _records, ...viewContext } = context.normalized_result;
      expect(lines(stream.text())).toEqual([
        ...records,
        {
          $rea: "jsonl/v1",
          type: "metadata",
          records: { path: ["normalized_result", key], emitted: 2, source: 2 },
          context: { ...context, normalized_result: viewContext },
        },
      ]);
      expect(context.normalized_result[key]).toBe(records);
    },
  );

  it.each([[], [{ id: "row" }]].map((rows) => ({ rows })))(
    "preserves nested pagination without a coverage object (%j)",
    async ({ rows }) => {
      const stream = capture(["--format", "jsonl", "--full-output"]);
      const value = {
        page: { rows, offset: 12, total: 31, next_offset: 14 },
        limitations: ["more pages"],
      };
      await stream.output.write(value, metadata);
      expect(lines(stream.text())).toEqual([
        ...rows,
        {
          $rea: "jsonl/v1",
          type: "metadata",
          records: {
            path: ["data", "page", "rows"],
            emitted: rows.length,
            source: rows.length,
          },
          context: {
            ok: true,
            data: {
              page: { offset: 12, total: 31, next_offset: 14 },
              limitations: value.limitations,
            },
            meta: { command: "fixture", duration: "1ms" },
          },
        },
      ]);
    },
  );
});

type Observed = readonly { path: (string | number)[]; shape: string }[];
const at = (shape: string, ...path: (string | number)[]) => ({ path, shape });

/** Assert the caller-error classification and its structured facts, not prose. */
const selectionRefusal = (
  stream: ReturnType<typeof capture>,
  option: "format" | "filter-output",
  observed: Observed,
) => {
  const error = stream.output.error;
  expect(lines(stream.text())).toEqual([jsonLinesErrorRecord(error)]);
  // A completed analysis refused only by its output selection is a request the
  // caller changes, not unreadable provider output.
  expect(error).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    retryable: false,
    remediation: { action: JSON_LINES_SELECTION_REMEDIATION },
    recovery: { kind: "inspect_input_contract", operation: "fixture" },
    details: {
      operation: "fixture",
      issues: [{ path: [option], reason: "invalid_value", observed }],
    },
  });
  const [issue] = z
    .array(z.object({ message: z.string().min(1) }))
    .parse(error?.details?.issues);
  // The issue explanation is delivered in the top-level message.
  expect(error?.message).toContain(issue?.message);
};

describe("JSON Lines selection refusals", () => {
  it.each<[unknown, Observed]>([
    [null, [at("null")]],
    [{}, [at("object")]],
    ["scalar", [at("string")]],
    [
      { normalized_result: { schema: { tables: [{ name: "t" }] } } },
      [at("object")],
    ],
    [
      { rows: null, page: { items: 3 } },
      [at("null", "rows"), at("number", "page", "items")],
    ],
    [
      { normalized_result: { rows: { columns: ["a"], values: [[1]] } } },
      [at("object", "normalized_result", "rows")],
    ],
    [{ rows: [], items: [] }, [at("array", "rows"), at("array", "items")]],
    [
      { rows: [], normalized_result: { page: { records: [] } } },
      [
        at("array", "rows"),
        at("array", "normalized_result", "page", "records"),
      ],
    ],
    [Object.create({ rows: [{ inherited: true }] }), [at("object")]],
    [
      { rows: [{ id: 1 }, { $rea: "collision" }] },
      [at("string", "rows", 1, "$rea")],
    ],
    [[{ $rea: { nested: true } }], [at("object", 0, "$rea")]],
  ])(
    "refuses an unclear or reserved boundary as a caller selection before writing rows: %j",
    async (value, observed) => {
      const stream = capture(["--format", "jsonl", "--token-count"]);
      await stream.output.write(value, metadata);
      selectionRefusal(stream, "format", observed);
    },
  );

  it.each<[string[], "format" | "filter-output", Observed]>([
    [[], "format", [at("null", "data", "normalized_result", "rows")]],
    [
      ["--filter-output", "normalized_result.missing"],
      "filter-output",
      [at("absent", "data", "normalized_result", "missing")],
    ],
  ])(
    "locates the refusal in the enveloped document with --full-output: %j",
    async (filter, option, observed) => {
      const stream = capture(["--format", "jsonl", "--full-output", ...filter]);
      await stream.output.write(
        { evidence_id: "ev:parent", normalized_result: { rows: null } },
        metadata,
      );
      expect(lines(stream.text())).toEqual([
        jsonLinesErrorRecord({
          ok: false,
          error: stream.output.error,
          meta: { command: "fixture", duration: "1ms" },
        }),
      ]);
      expect(stream.output.error).toMatchObject({
        code: "invalid_request",
        details: { issues: [{ path: [option], observed }] },
      });
    },
  );

  it.each<[string, Observed]>([
    ["missing", [at("absent", "missing")]],
    ["count", [at("number", "count")]],
    ["nested.value", [at("null", "nested", "value")]],
    ["nested.absent", [at("absent", "nested", "absent")]],
    ["nested.list[0,1]", [at("array", "nested", "list")]],
    ["table", [at("object", "table")]],
    ["table.values", [at("array", "table", "values")]],
    ["rows,items", [at("array", "rows"), at("array", "items")]],
    ["count,nested", [at("object")]],
  ])(
    "does not admit a selection merely because a filter exists: %s",
    async (filter, observed) => {
      const stream = capture(["--format", "jsonl", "--filter-output", filter]);
      await stream.output.write(
        {
          rows: [{ id: 1 }],
          items: [{ id: 2 }],
          count: 0,
          nested: { value: null, list: [1, 2] },
          table: {
            columns: ["id"],
            values: [[{ type: "integer", value: "1" }]],
          },
        },
        metadata,
      );
      selectionRefusal(stream, "filter-output", observed);
    },
  );
});

describe("JSON Lines admission and selection", () => {
  it.each([
    { value: [1, "two", null, false, [3]] },
    { value: { rows: [1, "two", null, false, [3]] } },
  ])(
    "emits primitive and array records verbatim, one per line: %j",
    async ({ value }) => {
      const stream = capture(["--format", "jsonl"]);
      await stream.output.write(value, metadata);
      const records = lines(stream.text());
      expect(records.slice(0, 5)).toEqual([1, "two", null, false, [3]]);
      expect(records.length).toBe(Array.isArray(value) ? 5 : 6);
      expect(stream.output.error).toBeUndefined();
    },
  );

  it("emits no lines for an empty top-level array and only metadata for an empty collection", async () => {
    const bare = capture(["--format", "jsonl"]);
    await bare.output.write([], metadata);
    expect(bare.text()).toBe("");
    expect(bare.output.error).toBeUndefined();
    const wrapped = capture(["--format", "jsonl"]);
    await wrapped.output.write(
      { items: [], coverage: { examined: 0 } },
      metadata,
    );
    expect(lines(wrapped.text())).toEqual([
      {
        $rea: "jsonl/v1",
        type: "metadata",
        records: { path: ["items"], emitted: 0, source: 0 },
        context: { coverage: { examined: 0 } },
      },
    ]);
  });

  it("records output selection separately from source coverage and keeps provenance", async () => {
    const value = {
      evidence_id: "ev:parent",
      raw_result: { excluded: "large observation" },
      provider: "source-provider",
      normalized_result: {
        rows: [
          { id: "a", text: "first" },
          { id: "b", text: "second" },
          { id: "c", text: "third" },
        ],
        coverage: { complete: true, examined: 3 },
      },
    };
    const filter = "normalized_result.rows[1,3].id";
    const stream = capture(["--format", "jsonl", "--filter-output", filter]);
    await stream.output.write(value, metadata);
    expect(lines(stream.text())).toEqual([
      { id: "b" },
      { id: "c" },
      {
        $rea: "jsonl/v1",
        type: "metadata",
        records: {
          path: ["normalized_result", "rows"],
          emitted: 2,
          source: 3,
          filter,
        },
        context: {
          evidence_id: "ev:parent",
          provider: "source-provider",
          normalized_result: { coverage: { complete: true, examined: 3 } },
        },
      },
    ]);
  });

  it("disambiguates selected collections without restoring excluded peer rows", async () => {
    const stream = capture([
      "--format",
      "jsonl",
      "--filter-output",
      "normalized_result.rows",
    ]);
    await stream.output.write(
      {
        evidence_id: "ev:parent",
        raw_result: null,
        normalized_result: {
          rows: [{ id: 1 }],
          items: [{ excluded: "peer" }],
          coverage: { status: "unknown" },
        },
      },
      metadata,
    );
    expect(lines(stream.text())).toEqual([
      { id: 1 },
      {
        $rea: "jsonl/v1",
        type: "metadata",
        records: {
          path: ["normalized_result", "rows"],
          emitted: 1,
          source: 1,
          filter: "normalized_result.rows",
        },
        context: {
          evidence_id: "ev:parent",
          normalized_result: { coverage: { status: "unknown" } },
        },
      },
    ]);
  });
});

describe("JSON Lines counting and transport", () => {
  it.each([false, true])(
    "frames classified failures without filtering/counting them away (full: %s)",
    async (full) => {
      const stream = capture([
        "--format",
        "jsonl",
        "--token-count",
        "--filter-output",
        "missing",
        ...(full ? ["--full-output"] : []),
      ]);
      const failure = {
        healthy: false,
        checks: [{ ok: false, name: "source" }],
        diagnostics: { path: "/caller/path" },
      };
      await stream.output.write(failure, metadata);
      expect(lines(stream.text())).toEqual([
        jsonLinesErrorRecord(
          full
            ? {
                ok: false,
                error: failure,
                meta: { command: "fixture", duration: "1ms" },
              }
            : failure,
        ),
      ]);
    },
  );

  it.each([false, true])(
    "counts array-valued rows as single records (object collection: %s)",
    async (wrapped) => {
      const rows = [[false, null], [0], [], [{ nested: ["雪", "a\nb"] }]];
      const value = wrapped ? { rows, coverage: { complete: false } } : rows;
      const args = ["--format", "jsonl"];
      const stream = capture(args);
      await stream.output.write(value, metadata);
      const counter = capture([...args, "--token-count"]);
      await counter.output.write(value, metadata);
      expect(counter.text()).toBe(`${estimateTokenCount(stream.text())}\n`);
    },
  );

  it("counts exactly the emitted representation, including escaped multiline text and final context", async () => {
    const value = {
      rows: [{ text: "雪𝟠\nline".repeat(4096) }, { text: 'escaped"\\\t' }],
      coverage: { complete: false, reasons: ["unknown remainder"] },
    };
    const args = ["--format", "jsonl", "--full-output"];
    const stream = capture(args);
    await stream.output.write(value, metadata);
    const counter = capture([...args, "--token-count"]);
    await counter.output.write(value, metadata);
    expect(counter.text()).toBe(`${estimateTokenCount(stream.text())}\n`);
  });

  it("bounds a large escaped field and observes destination backpressure through the final metadata", async () => {
    const chunks: Buffer[] = [];
    let maxBytes = 0;
    const destination = new Writable({
      highWaterMark: 1,
      write(chunk: Buffer, _encoding, callback) {
        maxBytes = Math.max(maxBytes, chunk.length);
        setTimeout(() => {
          chunks.push(chunk);
          callback();
        }, 1);
      },
    });
    const output = createCliResultOutput(
      parseCliOutputArguments(["--format", "jsonl"]),
      destination,
    )!;
    const rows = [{ id: "large", text: "\u0000雪𝟠".repeat(32 * 1024) }];
    await output.write({ rows, coverage: { complete: false } }, metadata);
    expect(maxBytes).toBeLessThan(128 * 1024);
    const records = lines(Buffer.concat(chunks).toString("utf8"));
    expect(records[0]).toEqual(rows[0]);
    expect(records[1]).toMatchObject({
      type: "metadata",
      context: { coverage: { complete: false } },
    });
    expect(destination.writableEnded).toBe(false);
  });

  it("retains an explicitly successful error-shaped row as data", async () => {
    const value = [
      {
        code: "not-an-error",
        message: "ordinary row",
        ok: false,
        healthy: false,
      },
    ];
    const stream = capture(["--format", "jsonl"]);
    const cli = Cli.create("explicit-success", { sync: false }).command(
      "rows",
      {
        run: () =>
          logCliCommand(
            silentLogger,
            "rows",
            async () => value,
            () => false,
          ),
      },
    );
    streamCliCommandResults(cli, stream.output);
    await cli.serve(["rows", "--format", "jsonl"], { stdout: () => undefined });
    expect(lines(stream.text())).toEqual(value);
  });
});

describe("SDK-owned JSON Lines parser diagnostics", () => {
  it.each([false, true])(
    "retains counted parser diagnostics (full: %s)",
    async (full) => {
      const args = [
        "rows",
        "--format",
        "jsonl",
        "--token-count",
        ...(full ? ["--full-output"] : []),
      ];
      for (const extra of [[], ["--zzz-bogus"]]) {
        const stream = capture(args);
        const cli = Cli.create("sdk-count", { sync: false }).command("rows", {
          args: z.object({ required: z.string() }),
          run: () => [{ id: "row" }],
        });
        streamCliCommandResults(cli, stream.output);
        let status = 0;
        await cli.serve([...args, ...extra], {
          stdout: (text) => {
            stream.output.captureSdkOutput(text);
          },
          exit: (code) => {
            status = code;
          },
        });
        await stream.output.finishSdkOutput(status);
        expect(status).toBe(1);
        const diagnostic = {
          code: extra.length === 0 ? "VALIDATION_ERROR" : "UNKNOWN",
          message: expect.any(String),
        };
        expect(lines(stream.text())).toEqual([
          expect.objectContaining({
            $rea: "jsonl/v1",
            type: "error",
            ok: false,
            result: full
              ? expect.objectContaining({
                  ok: false,
                  error: expect.objectContaining(diagnostic),
                  meta: expect.any(Object),
                })
              : expect.objectContaining(diagnostic),
          }),
        ]);
      }
    },
  );
});

describe("SDK-owned JSON Lines outcomes", () => {
  it("uses SDK status to frame validation errors and resets ownership between invocations", async () => {
    const stream = capture(["--format", "jsonl"]);
    const cli = Cli.create("sdk-status", { sync: false }).command("rows", {
      args: z.object({ required: z.string() }),
      run: () => [{ id: "row" }],
    });
    streamCliCommandResults(cli, stream.output);
    const serve = async (args: string[]) => {
      let status = 0;
      stream.output.begin(parseCliOutputArguments(args));
      await cli.serve(args, {
        stdout: (text) => {
          if (!stream.output.handled && !stream.output.captureSdkOutput(text))
            throw new Error("Unexpected delegation");
        },
        exit: (code) => {
          status = code;
        },
      });
      await stream.output.finishSdkOutput(status);
      return status;
    };
    expect(await serve(["rows", "--format", "jsonl"])).toBe(1);
    expect(lines(stream.text())[0]).toMatchObject({
      $rea: "jsonl/v1",
      type: "error",
      result: { code: "VALIDATION_ERROR" },
    });
    expect(await serve(["rows", "present", "--format", "jsonl"])).toBe(0);
    expect(lines(stream.text())[1]).toEqual({ id: "row" });
    expect(stream.output.error).toBeUndefined();
  });

  it.each([
    { failure: false, count: false },
    { failure: true, count: false },
    { failure: false, count: true },
    { failure: true, count: true },
  ])(
    "preserves sentinel outcomes under counting (%j)",
    async ({ failure, count }) => {
      const args = [
        "result",
        "--format",
        "jsonl",
        ...(count ? ["--token-count"] : []),
      ];
      const stream = capture(args);
      const cli = Cli.create("sdk-sentinel", { sync: false }).command(
        "result",
        {
          run: (context) =>
            failure
              ? context.error({
                  code: "EXPLICIT_FAILURE",
                  message: "Caller-owned error",
                })
              : context.ok({
                  code: "EXPLICIT_FAILURE",
                  message: "Successful data",
                }),
        },
      );
      streamCliCommandResults(cli, stream.output);
      let status = 0;
      await cli.serve(args, {
        stdout: (text) => {
          stream.output.captureSdkOutput(text);
        },
        exit: (code) => {
          status = code;
        },
      });
      expect(stream.text()).toBe("");
      await stream.output.finishSdkOutput(status);
      expect(lines(stream.text())[0]).toEqual(
        count && !failure
          ? estimateTokenCount(
              JSON.stringify({
                code: "EXPLICIT_FAILURE",
                message: "Successful data",
              }) + "\n",
            )
          : failure
            ? jsonLinesErrorRecord({
                code: "EXPLICIT_FAILURE",
                message: "Caller-owned error",
              })
            : { code: "EXPLICIT_FAILURE", message: "Successful data" },
      );
    },
  );

  it("delegates generator events immediately without retaining the stream", async () => {
    const stream = capture(["--format", "jsonl"]);
    const delegated: string[] = [];
    const cli = Cli.create("sdk-stream", { sync: false }).command("events", {
      run: async function* () {
        yield { text: "first" };
        expect(delegated.length).toBeGreaterThan(0);
        yield { text: "second" };
      },
    });
    streamCliCommandResults(cli, stream.output);
    await cli.serve(["events", "--format", "jsonl"], {
      stdout: (text) => {
        expect(stream.output.captureSdkOutput(text)).toBe(false);
        delegated.push(text);
      },
    });
    await stream.output.finishSdkOutput(0);
    expect(stream.text()).toBe("");
    expect(delegated.join("")).toContain("first");
    expect(delegated.join("")).toContain("second");
  });
});
