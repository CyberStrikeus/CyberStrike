import { expect, it as test } from "vitest";

import { executeFunctionAnalysisEvidence } from "../../../../src/application/FunctionAnalysisEvidence.js";
import { EnhancedTools } from "../../../../src/application/EnhancedTools.js";
import { fakeKunaCalls, setFakeKunaBehavior } from "./fakeKuna.js";
import { FUNCTIONS, run, session } from "./kunaSessionFixture.js";

const it = test.skipIf(process.platform === "win32");

it("resolves graph-only imports as graph roots and path endpoints without exporting C", async () => {
  const { open, kuna } = await session("rea-kuna-graph-only-import-", {
    inventoryImports: false,
  });
  const client = open();
  try {
    expect((await run(client, "list_procedures")).result).not.toContainEqual(
      expect.objectContaining({ address: "0x2000" }),
    );
    const tools = new EnhancedTools(client);
    const graph = await tools.execute("get_call_graph", {
      address: "0x2000",
      direction: "backward",
    });
    if (!graph.ok) throw graph.error;
    expect(graph.value).toMatchObject({
      graph: { "0": [{ address: "0x2000", calls: ["0x1040"] }] },
    });
    for (const [start, goal, direction] of [
      ["main", "0x2000", "forward"],
      ["0x2000", "main", "backward"],
    ] as const) {
      const path = await tools.execute("trace_call_path", {
        start,
        goal,
        direction,
      });
      if (!path.ok) throw path.error;
      expect(path.value).toMatchObject({ goal_status: "reached" });
    }
    expect(
      await client.execute("procedure_address", { procedure: "0x9999" }),
    ).toMatchObject({ ok: false });
    const calls = await fakeKunaCalls(kuna);
    expect(
      calls.filter(({ argv }) => argv[0] === "decompile-graph"),
    ).toHaveLength(1);
    expect(calls.some(({ argv }) => argv[0] === "decompile-project")).toBe(
      false,
    );
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it.each([
  {
    behavior: { graphIndirectCalls: false },
    procedure: "main",
    coverage: { status: "complete" },
    available: true,
  },
  {
    behavior: {},
    procedure: "main",
    coverage: {
      status: "partial",
      limited_directions: ["callers", "callees"],
    },
    available: true,
  },
  {
    behavior: {},
    procedure: "parse",
    coverage: { status: "partial", limited_directions: ["callers"] },
    available: true,
  },
  {
    behavior: { graph: "not-json" as const },
    procedure: "main",
    coverage: {
      status: "unknown",
      reason: expect.stringContaining("call graph cannot be used"),
    },
    available: false,
  },
])(
  "preserves dossier relationship coverage in application Evidence: $procedure $coverage.status",
  async ({ behavior, procedure, coverage, available }) => {
    const { open, target } = await session(
      "rea-kuna-dossier-coverage-",
      behavior,
    );
    const client = open();
    try {
      const answer = await executeFunctionAnalysisEvidence(
        client,
        { procedure },
        target,
      );
      if (!answer.ok) throw answer.error;
      expect(answer.value.relationship_coverage).toMatchObject(coverage);
      expect(answer.value.normalized_result).toMatchObject({
        facet_availability: { callers: { available }, callees: { available } },
      });
    } finally {
      expect(await client.close()).toEqual({ ok: true, value: null });
    }
  },
);

it("shares one body-free graph across both directions without exporting C", async () => {
  const { open, kuna } = await session("rea-kuna-calls-");
  const client = open();
  try {
    const [outgoing, incoming] = await Promise.all([
      run(client, "procedure_callees", { procedure: "main" }),
      run(client, "procedure_callers", { procedure: "parse" }),
    ]);
    expect(outgoing.result).toEqual(["0x1040"]);
    expect(incoming.result).toEqual(["0x1000"]);
    expect(outgoing.relationshipCoverage).toMatchObject({
      status: "partial",
      limited_directions: ["callees"],
    });
    expect(incoming.relationshipCoverage).toMatchObject({
      status: "partial",
      limited_directions: ["callers"],
    });
    expect(outgoing.rawResult).toMatchObject({
      references: {
        kind: "kuna-call-graph",
        schema_version: 4,
        functions: 4,
        edges: 3,
      },
    });
    expect(JSON.stringify(outgoing.rawResult)).not.toContain("codeC");
    expect(
      (await run(client, "procedure_callers", { procedure: "broken" })).result,
    ).toEqual([]);
    const commands = (await fakeKunaCalls(kuna)).map(({ argv }) => argv);
    expect(
      commands.filter((argv) => argv[0] === "decompile-graph"),
    ).toHaveLength(1);
    expect(
      commands.some(
        (argv) => argv[0] === "decompile-project" || argv[0] === "decompile",
      ),
    ).toBe(false);
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("filters forwarding aliases and reuses exact-address xrefs without inventory or C", async () => {
  const { open, kuna } = await session("rea-kuna-xrefs-");
  const client = open();
  try {
    const first = await run(client, "xrefs", { address: "0x2000" });
    expect(first.result).toEqual(["0x1004"]);
    expect(first.rawResult).toMatchObject({
      references: {
        examined_rows: 2,
        excluded_alias_rows: 1,
        target: "0x2000",
      },
    });
    expect(
      (await run(client, "xrefs", { address: "0X00002000" })).result,
    ).toEqual(first.result);
    expect(
      (await fakeKunaCalls(kuna))
        .filter(({ argv }) => argv[0] !== "--version")
        .map(({ argv }) => argv[0]),
    ).toEqual(["xrefs"]);
  } finally {
    await client.close();
  }
});

it("resolves an xref procedure name without starting the project export", async () => {
  const { open, kuna } = await session("rea-kuna-named-xrefs-");
  const client = open();
  try {
    expect((await run(client, "xrefs", { address: "parse" })).result).toEqual([
      "0x1004",
    ]);
    expect(
      (await fakeKunaCalls(kuna)).some(
        ({ argv }) => argv[0] === "decompile-project",
      ),
    ).toBe(false);
  } finally {
    await client.close();
  }
});

it("bounds retained xref work and omits unused native instruction text", async () => {
  const { open, kuna } = await session("rea-kuna-xref-cache-cap-", {
    referencePadding: 9 * 1024 * 1024,
  });
  const client = open();
  try {
    for (const address of ["0x4000", "0x4001", "0x4000"]) {
      const answer = await run(client, "xrefs", { address });
      expect(answer.result).toEqual(["0x1004"]);
      expect(Buffer.byteLength(JSON.stringify(answer))).toBeLessThan(4096);
    }
    expect(
      (await fakeKunaCalls(kuna)).filter(({ argv }) => argv[0] === "xrefs"),
    ).toHaveLength(3);
  } finally {
    await client.close();
  }
});

it("caps distinct pending xrefs and cancels queued work without launching it", async () => {
  const { open, kuna } = await session("rea-kuna-xref-queue-cap-", {
    xrefs: "hang",
  });
  const client = open();
  const pending = Array.from({ length: 8 }, (_, index) =>
    client.execute("xrefs", { address: `0x${(0x4000 + index).toString(16)}` }),
  );
  try {
    await expect
      .poll(
        async () =>
          (await fakeKunaCalls(kuna)).some(({ argv }) => argv[0] === "xrefs"),
        { timeout: 5000 },
      )
      .toBe(true);
    expect(await client.execute("xrefs", { address: "0x5000" })).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisResourceConstraintError" },
    });
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
    for (const result of await Promise.all(pending))
      expect(result.ok).toBe(false);
  }
  expect(
    (await fakeKunaCalls(kuna)).filter(({ argv }) => argv[0] === "xrefs"),
  ).toHaveLength(1);
});

it("retries malformed xrefs without retaining an empty result", async () => {
  const { open, kuna } = await session("rea-kuna-bad-xrefs-", {
    xrefs: "not-json",
  });
  const client = open();
  try {
    expect(await client.execute("xrefs", { address: "0x3000" })).toMatchObject({
      ok: false,
      error: { _tag: "ProviderAdapterError" },
    });
    await setFakeKunaBehavior(kuna, { functions: FUNCTIONS });
    expect((await run(client, "xrefs", { address: "0x3000" })).result).toEqual([
      "0x1004",
    ]);
  } finally {
    await client.close();
  }
});

it.each(["not-json", "miscounted", "with-bodies"] as const)(
  "does not cache an unusable graph: %s",
  async (graph) => {
    const { open, kuna } = await session("rea-kuna-bad-graph-", { graph });
    const client = open();
    const operation = "procedure_callees";
    try {
      expect(
        await client.execute(operation, { procedure: "main" }),
      ).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisOutputError",
          operation,
          diagnostics: { producer_operation: "kuna:call-graph" },
          cause: expect.objectContaining({
            _tag: "AnalysisOutputError",
            operation: "kuna:call-graph",
          }),
        },
      });
      await setFakeKunaBehavior(kuna, { functions: FUNCTIONS });
      expect(
        (await run(client, operation, { procedure: "main" })).result,
      ).toEqual(["0x1040"]);
      expect(
        (await fakeKunaCalls(kuna)).filter(
          ({ argv }) => argv[0] === "decompile-graph",
        ),
      ).toHaveLength(2);
    } finally {
      await client.close();
    }
  },
);

it("lets one graph waiter cancel while another receives its relationships", async () => {
  const { open, kuna } = await session("rea-kuna-shared-calls-", {
    referenceDelayMs: 250,
  });
  const client = open();
  const controller = new AbortController();
  const first = client.execute(
    "procedure_callees",
    { procedure: "main" },
    { signal: controller.signal },
  );
  const second = run(client, "procedure_callers", { procedure: "parse" });
  try {
    await expect
      .poll(async () =>
        (await fakeKunaCalls(kuna)).some(
          ({ argv }) => argv[0] === "decompile-graph",
        ),
      )
      .toBe(true);
    controller.abort();
    expect(await first).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect((await second).result).toEqual(["0x1000"]);
    expect(
      (await fakeKunaCalls(kuna)).filter(
        ({ argv }) => argv[0] === "decompile-graph",
      ),
    ).toHaveLength(1);
  } finally {
    await Promise.allSettled([first, second]);
    await client.close();
  }
});

it("stops an abandoned graph and allows retry on the same session", async () => {
  const { open, kuna } = await session("rea-kuna-abandoned-calls-", {
    graph: "hang",
  });
  const client = open();
  const controller = new AbortController();
  const first = client.execute(
    "procedure_callees",
    { procedure: "main" },
    { signal: controller.signal },
  );
  try {
    await expect
      .poll(async () =>
        (await fakeKunaCalls(kuna)).some(
          ({ argv }) => argv[0] === "decompile-graph",
        ),
      )
      .toBe(true);
    controller.abort();
    expect(await first).toMatchObject({ ok: false });
    await setFakeKunaBehavior(kuna, { functions: FUNCTIONS });
    expect(
      (await run(client, "procedure_callees", { procedure: "main" })).result,
    ).toEqual(["0x1040"]);
  } finally {
    await client.close();
  }
});

it("close cancels a running graph and queued xref before releasing their input", async () => {
  const { open, kuna } = await session("rea-kuna-close-references-", {
    graph: "hang",
  });
  const client = open();
  const graph = client.execute("procedure_callees", { procedure: "main" });
  await expect
    .poll(async () =>
      (await fakeKunaCalls(kuna)).some(
        ({ argv }) => argv[0] === "decompile-graph",
      ),
    )
    .toBe(true);
  const xrefs = client.execute("xrefs", { address: "0x3000" });
  expect(await client.close()).toEqual({ ok: true, value: null });
  for (const result of await Promise.all([graph, xrefs]))
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
  expect(
    (await fakeKunaCalls(kuna)).some(({ argv }) => argv[0] === "xrefs"),
  ).toBe(false);
});
