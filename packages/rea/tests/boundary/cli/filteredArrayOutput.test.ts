import { Writable } from "node:stream";

import { Cli, Formatter } from "incur";
import { estimateTokenCount } from "tokenx";
import { expect, it } from "vitest";

import {
  parseCliOutputArguments,
  renderCliDocument,
} from "../../../src/cliOutput.js";
import { adaptCliOutputArgumentsForIncur } from "../../../src/cliBuiltinArguments.js";
import {
  createCliResultOutput,
  streamCliCommandResults,
} from "../../../src/cli/cliResultOutput.js";

const source = [{ selected: 1 }, { other: 2 }, { selected: null }];

const freezeRecursively = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) freezeRecursively(child);
  return Object.freeze(value);
};

const runFilteredCli = async (
  value: unknown,
  format: "json" | "jsonl" | "yaml" | "toon" | "md" | "csv" | "tsv",
  filter?: string,
  fields?: readonly string[],
  expectedExitCode = 0,
): Promise<string> => {
  const cli = Cli.create("filtered-array-test", { sync: false });
  cli.command("rows", { run: () => value });
  const args = [
    "rows",
    "--format",
    format,
    ...(filter === undefined ? [] : ["--filter-output", filter]),
    ...(fields === undefined ? [] : ["--columns", fields.join(",")]),
  ];
  const chunks: Buffer[] = [];
  const output = createCliResultOutput(
    parseCliOutputArguments(args),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  );
  if (output === undefined) throw new Error("Missing CLI output owner");
  streamCliCommandResults(cli, output);
  let fallback = "";
  await cli.serve(adaptCliOutputArgumentsForIncur(args), {
    exit: (code) => {
      expect(code).toBe(expectedExitCode);
    },
    stdout: (text) => {
      if (!output.handled) fallback += text;
    },
  });
  expect(fallback).toBe("");
  expect(output.handled).toBe(true);
  expect(output.failed).toBe(false);
  return Buffer.concat(chunks).toString("utf8");
};

it.each(["csv", "tsv"] as const)(
  "exports only explicitly selected %s fields and retains page metadata",
  async (format) => {
    const value = {
      normalized_result: {
        rows: [{ name: "alpha", note: "café", other: "not selected" }],
        coverage: {
          status: "page",
          examined: 1,
          total: 3,
          next_offset: 1,
          exhausted: false,
        },
        source_coverage: { status: "partial" },
        source_complete: false,
        view: { offset: 0, limit: 1, fields: ["name", "note"] },
      },
    };
    const output = await runFilteredCli(
      value,
      format,
      "normalized_result.rows",
      ["note", "name"],
    );
    const [metadataLine, header, row] = output.trimEnd().split(/\r?\n/u);
    expect(
      JSON.parse(metadataLine!.slice("# rea-delimited-v1 ".length)),
    ).toMatchObject({
      selected_path: ["normalized_result", "rows"],
      coverage: { total: 3, next_offset: 1 },
      source_coverage: { status: "partial" },
      source_complete: false,
      view: { offset: 0, limit: 1 },
    });
    expect(header).toBe(format === "csv" ? "note,name" : "note\tname");
    expect(row).toBe(format === "csv" ? "café,alpha" : "café\talpha");
    expect(output).not.toContain("not selected");
  },
);

it("retains owning-view metadata when rows are selected through a nested page", async () => {
  const value = {
    normalized_result: {
      kind: "managed-members",
      parent_evidence_id: "evd_parent",
      parent_operation: "inspect_managed_members",
      parent_digest: "parent",
      coverage: { total: 4, next_offset: 2, exhausted: false },
      source_coverage: { status: "partial" },
      limitations: ["Source bodies were not available"],
      unknowns: [{ reason: "body_unavailable", member: "Run" }],
      view: {
        kind: "managed-members",
        collection: "methods",
        offset: 1,
        limit: 1,
      },
      page: { collection: "methods", rows: [{ name: "Run" }] },
    },
  };
  const output = await runFilteredCli(
    value,
    "csv",
    "normalized_result.page.rows",
    ["name"],
  );
  const [metadataLine] = output.split(/\r?\n/u);
  expect(
    JSON.parse(metadataLine!.slice("# rea-delimited-v1 ".length)),
  ).toMatchObject({
    selected_path: ["normalized_result", "page", "rows"],
    coverage: { total: 4, next_offset: 2 },
    source_coverage: { status: "partial" },
    limitations: ["Source bodies were not available"],
    unknowns: [{ reason: "body_unavailable", member: "Run" }],
    view: { collection: "methods", offset: 1, limit: 1 },
    provenance: {
      parent_evidence_id: "evd_parent",
      parent_operation: "inspect_managed_members",
      parent_digest: "parent",
    },
  });
});

it("refuses spreadsheet formula-leading text in CSV but preserves it in JSON", async () => {
  const value = { rows: [{ logical_path: "=1+1" }] };
  const csv = await runFilteredCli(value, "csv", "rows", ["logical_path"], 1);
  expect(JSON.parse(csv)).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    message: expect.stringContaining("formula-leading"),
  });
  const json = await runFilteredCli(value, "json");
  expect(JSON.parse(json)).toEqual(value);
});

it("returns a structured limitation when a selected CSV cell is nested", async () => {
  const output = await runFilteredCli(
    { normalized_result: { rows: [{ nested: { value: "not flattened" } }] } },
    "csv",
    "normalized_result.rows",
    ["nested"],
    1,
  );
  expect(JSON.parse(output)).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    details: {
      issues: [
        {
          message: expect.stringContaining("not flattened"),
        },
      ],
    },
  });
});

it("returns a structured limitation when the selected view is not a row array", async () => {
  const output = await runFilteredCli(
    { normalized_result: { summary: { count: 1 } } },
    "tsv",
    "normalized_result.summary",
    ["count"],
    1,
  );
  expect(JSON.parse(output)).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    details: {
      issues: [
        {
          message: expect.stringContaining("row-array path"),
        },
      ],
    },
  });
});

it("renders only each record's own fields in heterogeneous Markdown tables", async () => {
  const value: unknown = JSON.parse(
    '[{"name":"first","constructor":"ctor","toString":"text","__proto__":"proto","enabled":false,"count":0},{"name":"second"},{"name":"third","constructor":0,"toString":false,"__proto__":null}]',
  );
  freezeRecursively(value);
  const json = await runFilteredCli(value, "json");
  expect(JSON.parse(json)).toEqual(value);
  const markdown = await runFilteredCli(value, "md");
  const rows = markdown
    .trim()
    .split("\n")
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  expect(rows[0]).toEqual([
    "name",
    "constructor",
    "toString",
    "\\_\\_proto\\_\\_",
    "enabled",
    "count",
  ]);
  expect(rows.slice(2)).toEqual([
    ["first", "ctor", "text", "proto", "false", "0"],
    ["second", "", "", "", "", ""],
    ["third", "0", "false", "null", "", ""],
  ]);
});

it("formats arrays of empty objects without columns as JSON in Markdown", async () => {
  const value: unknown = [{}, {}];
  freezeRecursively(value);
  const json = await runFilteredCli(value, "json");
  expect(JSON.parse(json)).toEqual(value);
  const markdown = await runFilteredCli(value, "md");
  expect(markdown).toBe("\\[\\{\\},\\{\\}\\]\n");
});

it.each(
  (["json", "jsonl"] as const).flatMap((format) =>
    [false, true].map((full) => ({ format, full })),
  ),
)(
  "preserves filtered array positions in $format (full: $full)",
  async ({ format, full }) => {
    const value = Object.freeze(
      source.map((item) => Object.freeze({ ...item })),
    );
    const cli = Cli.create("filtered-array-test", { sync: false });
    cli.command("rows", { run: () => value });
    const args = [
      "rows",
      "--format",
      format,
      "--filter-output",
      "selected",
      ...(full ? ["--full-output"] : []),
    ];
    const chunks: Buffer[] = [];
    const output = createCliResultOutput(
      parseCliOutputArguments(args),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );
    if (output === undefined) throw new Error("Missing CLI output owner");
    streamCliCommandResults(cli, output);
    let fallback = "";
    let status = 0;
    await cli.serve(args, {
      stdout: (text) => {
        if (!output.handled) fallback += text;
      },
      exit: (code) => {
        status = code;
      },
    });
    const text = Buffer.concat(chunks).toString("utf8");
    if (full && format === "jsonl") {
      const records = text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(records.slice(0, -1)).toEqual([1, null, null]);
      expect(records.at(-1)).toMatchObject({
        $rea: "jsonl/v1",
        type: "metadata",
        records: { path: ["data"], emitted: 3, source: 3, filter: "selected" },
        context: { ok: true, meta: { command: "rows" } },
      });
    } else if (full)
      expect(JSON.parse(text)).toMatchObject({
        ok: true,
        data: [1, null, null],
        meta: { command: "rows" },
      });
    else if (format === "json")
      expect(JSON.parse(text)).toEqual([1, null, null]);
    else expect(text).toBe("1\nnull\nnull\n");
    expect(fallback).toBe("");
    expect(status).toBe(0);
    expect(output.handled).toBe(true);
    expect(output.failed).toBe(false);
    expect(value).toEqual(source);
  },
);

it.each(["json", "jsonl"] as const)(
  "counts the normalized filtered %s records",
  async (format) => {
    const cli = Cli.create("filtered-count-test", { sync: false });
    cli.command("rows", { run: () => source });
    const args = [
      "rows",
      "--format",
      format,
      "--filter-output",
      "selected",
      "--token-count",
    ];
    const chunks: Buffer[] = [];
    const output = createCliResultOutput(
      parseCliOutputArguments(args),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );
    if (output === undefined) throw new Error("Missing CLI output owner");
    streamCliCommandResults(cli, output);
    let fallback = "";
    await cli.serve(args, {
      exit: (code) => {
        expect(code).toBe(0);
      },
      stdout: (text) => {
        if (!output.handled) fallback += text;
      },
    });
    expect(Buffer.concat(chunks).toString()).toBe(
      `${estimateTokenCount(Formatter.format([1, null, null], format))}\n`,
    );
    expect(fallback).toBe("");
  },
);

it.each(["selected", "toString", "constructor"])(
  "normalizes only owned nested selection arrays for %s",
  async (filter) => {
    const value = [[{ selected: false }, {}], [{ selected: 0 }], []];
    const before = structuredClone(value);
    const chunks: Buffer[] = [];
    const output = createCliResultOutput(
      parseCliOutputArguments(["--json", "--filter-output", filter]),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );
    await output?.write(value, {
      command: "rows",
      duration: "0ms",
      format: "json",
    });
    expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(
      filter === "selected"
        ? [[false, null], [0], []]
        : [[null, null], [null], []],
    );
    expect(value).toEqual(before);
  },
);

it("finishes JSONL after a bounded large record before a missing selection", async () => {
  const value = [{ selected: "x".repeat(80 * 1024) }, {}];
  const chunks: Buffer[] = [];
  const output = createCliResultOutput(
    parseCliOutputArguments([
      "--format",
      "jsonl",
      "--filter-output",
      "selected",
    ]),
    new Writable({
      highWaterMark: 1,
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        setImmediate(callback);
      },
    }),
  );
  if (output === undefined) throw new Error("Missing CLI output owner");
  await output.write(value, {
    command: "rows",
    duration: "0ms",
    format: "jsonl",
  });
  const lines = Buffer.concat(chunks).toString().trimEnd().split("\n");
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    value[0]?.selected,
    null,
  ]);
  expect(output.failed).toBe(false);
});

it("does not invent selected JSON members from the object prototype", async () => {
  const value = freezeRecursively({ selected: { present: 7 } });
  const output = await runFilteredCli(value, "json", "selected.__proto__");
  expect(JSON.parse(output)).toEqual({ selected: {} });
  expect(value).toEqual({ selected: { present: 7 } });
});

it("escapes table delimiters and line breaks in Markdown cells", async () => {
  const value = freezeRecursively({
    selected: {
      pipe: "left|right",
      backslash: "left\\right",
      lines: "first line\nsecond line",
    },
  });

  const output = await runFilteredCli(value, "md", "selected");

  expect(output).toContain("left\\|right");
  expect(output).toContain("left\\\\right");
  expect(output).toContain("first line<br>second line");
  expect(output).not.toContain("left|right");
  expect(value.selected).toEqual({
    pipe: "left|right",
    backslash: "left\\right",
    lines: "first line\nsecond line",
  });
});

const projectionSource = freezeRecursively([
  {
    rows: [
      { id: 0, left: "l0", right: "r0", retained: [0, 10] },
      { id: 1, left: "l1", right: "r1", retained: [1, 11] },
      { id: 2, left: "l2", right: "r2", retained: [2, 12] },
      { id: 3, left: "l3", right: "r3", retained: [3, 13] },
    ],
  },
]);

const overlappingPaths = [
  "rows[0,3].left,rows[1,4].right",
  "rows[1,4].right,rows[0,3].left",
] as const;

it("projects consecutive slices through nested root arrays and merges cell fields", async () => {
  const value = freezeRecursively([
    [
      { left: 1, right: 2 },
      { left: 3, right: 4 },
    ],
    [{ left: 5, right: 6 }],
  ]);
  const output = await runFilteredCli(
    value,
    "json",
    "[0,2][0,1].left,[0,1][0,2].right",
  );
  expect(JSON.parse(output)).toEqual([
    [{ left: 1, right: 2 }, { right: 4 }],
    [{ left: 5 }],
  ]);
});

it.each([
  ["rows[0,2][-2,-1]", { rows: [[1], [3]] }],
  ["rows[0,2][1,1]", { rows: [[], []] }],
  ["rows[0,2][invalid,1]", { rows: [[1], [3]] }],
] as const)("retains parsed slice bounds for %s", async (filter, expected) => {
  const output = await runFilteredCli(
    {
      rows: [
        [1, 2],
        [3, 4],
      ],
    },
    "json",
    filter,
  );
  expect(JSON.parse(output)).toEqual(expected);
});

it.each(["json", "jsonl", "yaml", "toon", "md"] as const)(
  "unions overlapping sibling slices independent of path order in %s",
  async (format) => {
    const expected = [
      {
        rows: [
          { left: "l0" },
          { left: "l1", right: "r1" },
          { left: "l2", right: "r2" },
          { right: "r3" },
        ],
      },
    ];
    const outputs = await Promise.all(
      overlappingPaths.map((filter) =>
        runFilteredCli(projectionSource, format, filter),
      ),
    );
    expect(outputs[0]).toBe(outputs[1]);
    if (format === "json") expect(JSON.parse(outputs[0]!)).toEqual(expected);
    else if (format === "jsonl")
      expect(
        outputs[0]!
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual(expected);
    else if (format === "md")
      expect(outputs[0]).toBe(renderCliDocument(expected, format, false));
    else expect(outputs[0]).toBe(`${Formatter.format(expected, format)}\n`);
    expect(projectionSource[0]?.rows[0]?.retained).toEqual([0, 10]);
  },
);

const parentAndChildPaths = [
  "rows[0,2],rows[1,3].right",
  "rows[1,3].right,rows[0,2]",
] as const;

it.each(["json", "jsonl", "yaml", "toon", "md"] as const)(
  "preserves missing selected array values in %s",
  async (format) => {
    const value = freezeRecursively([{ selected: 1 }, {}, { selected: null }]);
    const selected = [1, undefined, null];
    const output = await runFilteredCli(value, format, "selected");
    if (format === "json") expect(JSON.parse(output)).toEqual([1, null, null]);
    else if (format === "jsonl")
      expect(
        output
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual([1, null, null]);
    else if (format === "md") expect(output).toBe("\\[1,null,null\\]\n");
    else expect(output).toBe(`${Formatter.format(selected, format)}\n`);
    expect(value).toEqual([{ selected: 1 }, {}, { selected: null }]);
  },
);

it.each(["json", "jsonl", "yaml", "toon", "md"] as const)(
  "lets whole-parent selection dominate child paths without mutating source in %s",
  async (format) => {
    const expected = [
      {
        rows: [
          projectionSource[0]!.rows[0],
          projectionSource[0]!.rows[1],
          { right: "r2" },
        ],
      },
    ];
    const before = structuredClone(projectionSource);
    const outputs = await Promise.all(
      parentAndChildPaths.map((filter) =>
        runFilteredCli(projectionSource, format, filter),
      ),
    );
    expect(outputs[0]).toBe(outputs[1]);
    if (format === "json") expect(JSON.parse(outputs[0]!)).toEqual(expected);
    else if (format === "jsonl")
      expect(
        outputs[0]!
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual(expected);
    else if (format === "md")
      expect(outputs[0]).toBe(renderCliDocument(expected, format, false));
    else expect(outputs[0]).toBe(`${Formatter.format(expected, format)}\n`);
    expect(projectionSource).toEqual(before);
  },
);

it.each(["[0,1].left,right", "right,[0,1].left"])(
  "preserves root implicit keys with slices for %s",
  async (filter) => {
    expect(
      JSON.parse(
        await runFilteredCli(
          [
            { left: 1, right: 2 },
            { left: 3, right: 4 },
          ],
          "json",
          filter,
        ),
      ),
    ).toEqual([{ left: 1, right: 2 }, { right: 4 }]);
  },
);

it("keeps root numeric keys as per-item keys when mixed with slices", async () => {
  expect(
    JSON.parse(
      await runFilteredCli(
        [{ left: 1, "1": { right: 2 } }, { "1": { right: 4 } }],
        "json",
        "[0,1].left,1.right",
      ),
    ),
  ).toEqual([{ left: 1, "1": { right: 2 } }, { "1": { right: 4 } }]);
});

it.each([
  ["rows[0,1].left,rows.1.right", { rows: [{ left: 1 }, { right: 4 }] }],
  ["rows.1.right,rows[0,1].left", { rows: [{ left: 1 }, { right: 4 }] }],
  ["rows.1.right", { rows: { "1": { right: 4 } } }],
  ["rows[0,1].left,rows.99.right", { rows: [{ left: 1 }] }],
  ["rows[0,1].left,rows.0.right", { rows: [{ left: 1, right: 2 }] }],
] as const)(
  "preserves sibling and key-only projections for %s",
  async (filter, expected) => {
    expect(
      JSON.parse(
        await runFilteredCli(
          {
            rows: [
              { left: 1, right: 2 },
              { left: 3, right: 4 },
            ],
          },
          "json",
          filter,
        ),
      ),
    ).toEqual(expected);
  },
);

it("retains sparse slice positions while ignoring an absent explicit index", async () => {
  const rows = new Array(3);
  rows[2] = { value: 3 };
  expect(
    JSON.parse(
      await runFilteredCli(
        { rows },
        "json",
        "rows[0,1],rows.1.value,rows.2.value",
      ),
    ),
  ).toEqual({ rows: [null, { value: 3 }] });
});

it.each(["json", "jsonl", "yaml", "toon", "md"] as const)(
  "refuses incompatible array properties in %s",
  async (format) => {
    const args = [
      "--format",
      format,
      "--filter-output",
      "rows[0,1],rows.length",
    ];
    const chunks: Buffer[] = [];
    const output = createCliResultOutput(
      parseCliOutputArguments(args),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );
    await output?.write(
      { rows: [1, 2] },
      { command: "rows", duration: "0ms", format },
    );
    expect(output?.error).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("non-index property"),
    });
    expect(Buffer.concat(chunks).toString()).toContain("invalid_request");
  },
);

it.each(["[0,1][0,1].left,right", "right,[0,1][0,1].left"])(
  "merges recursively implicit root fields for %s",
  async (filter) => {
    const value = freezeRecursively([
      [{ left: 1, right: 2 }, { right: 4 }],
      [[{ right: 6 }]],
      [],
      [{ left: 7 }],
    ]);
    expect(JSON.parse(await runFilteredCli(value, "json", filter))).toEqual([
      [{ left: 1, right: 2 }, { right: 4 }],
      [[{ right: 6 }]],
    ]);
  },
);
