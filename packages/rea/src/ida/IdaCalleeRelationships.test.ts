import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createIdaTarget,
  RecordingIdaMcp,
} from "../../tests/fixtures/idaMcp.js";
import {
  callGraphSession as session,
  edge,
  graphRow,
  removeCallGraphSessions,
} from "../../tests/fixtures/idaCallGraph.js";
import { UNRECOGNIZED_CALLEE_LIMITATION } from "./IdaCallGraph.js";
import { IDA_LIMITATIONS } from "./IdaProviderCapabilities.js";
import { IdaSessionClient } from "./IdaSessionClient.js";

const attachedRoots: string[] = [];
afterEach(async () => {
  await removeCallGraphSessions();
  for (const root of attachedRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});

const observedTools = (rawResult: unknown): string[] =>
  z
    .object({ observations: z.array(z.object({ tool: z.string() })) })
    .parse(rawResult)
    .observations.map(({ tool }) => tool);

const callees = async (client: IdaSessionClient) => {
  const result = await client.execute("procedure_callees", {
    procedure: "main",
  });
  if (!result.ok) throw result.error;
  return result.value;
};

describe("headless IDA callee edges on non-x86 targets", () => {
  it("uses the neutral call graph as the sole callee source on non-x86 targets", async () => {
    const { client } = await session({
      callees: [
        { addr: "0x4000", name: "bogus_non_x86_match", type: "internal" },
      ],
      callgraph: graphRow([
        edge("0x1000", "0x2000"),
        edge("0x1000", "0x3000"),
        edge("0x2000", "0x4000"),
      ]),
    });
    try {
      const execution = await callees(client);

      expect(
        execution.result,
        "the root edges are observed and the child edge is ignored",
      ).toEqual(["0x2000", "0x3000"]);
      expect(
        execution.limitations,
        "calls to non-function targets remain unknown",
      ).toContain(UNRECOGNIZED_CALLEE_LIMITATION);
      expect(
        execution.result,
        "the unreliable callees row is neither resolved nor reported",
      ).not.toContain("0x4000");
      expect(
        observedTools(execution.rawResult),
        "non-x86 callees is never queried",
      ).not.toContain("callees");
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});

describe("headless IDA call graph availability and cancellation", () => {
  it("takes the call graph path for a universal target whose loaded slice is unknown", async () => {
    const { client, producer } = await session(
      { callees: [], callgraph: graphRow([edge("0x1000", "0x2000")]) },
      "x86_64",
      ["x86_64", "arm64"],
    );
    try {
      const execution = await callees(client);

      expect(execution.result, "the graph edge is observed").toEqual([
        "0x2000",
      ]);
      expect(
        producer.calls.some(({ name }) => name === "callgraph"),
        "a mixed universal target cannot prove an x86 slice",
      ).toBe(true);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("stops at once when the caller cancels during the call graph request", async () => {
    const controller = new AbortController();
    const { client, producer } = await session({
      callees: [],
      callgraph: graphRow([edge("0x1000", "0x2000")]),
    });
    const inner = producer.beforeCall;
    producer.beforeCall = async (name, args) => {
      await inner?.(name, args);
      if (name === "callgraph") controller.abort();
    };
    try {
      const result = await client.execute(
        "procedure_callees",
        { procedure: "main" },
        { signal: controller.signal },
      );

      if (result.ok) throw new Error("expected cancellation");
      expect(result.error._tag, "cancellation is not swallowed").toBe(
        "AnalysisCancelledError",
      );
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});

describe("headless IDA callee edges on x86 targets", () => {
  it("keeps the requests, result, limitations and observations of an x86 read unchanged", async () => {
    const { client, producer } = await session(
      {
        callees: [
          { addr: "0x2000", name: "imported_puts", type: "external" },
          { addr: "0x3000", name: "printf_stub", type: "internal" },
        ],
      },
      "x86_64",
    );
    try {
      const execution = await callees(client);

      expect(
        execution.result,
        "externals come first, then resolved internals, exactly as before",
      ).toEqual(["0x2000", "0x3000"]);
      expect(
        execution.limitations,
        "exactly the provider's own limitations, nothing added on x86",
      ).toEqual([...IDA_LIMITATIONS]);
      expect(
        producer.calls.map(({ name }) => name),
        "no call graph request is made on an x86-only target",
      ).toEqual([
        "idb_open",
        "idb_list",
        "server_health",
        "lookup_funcs",
        "callees",
        "lookup_funcs",
        "server_health",
      ]);
      expect(
        producer.calls.find(({ name }) => name === "callees")?.args,
        "the callees request is the unchanged scoped one",
      ).toMatchObject({ addrs: ["0x1000"], limit: 500 });
      expect(
        observedTools(execution.rawResult),
        "the raw observations hold no call graph row",
      ).toEqual(["lookup_funcs", "callees", "lookup_funcs"]);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("keeps omitted x86 callee truncation as unknown coverage", async () => {
    const { client, producer } = await session({ callees: [] }, "x86_64");
    const inner = producer.overrideCall;
    producer.overrideCall = (name, args) =>
      name === "callees"
        ? [
            {
              callees: [{ addr: "0x2000", name: "square", type: "internal" }],
            },
          ]
        : inner?.(name, args);
    try {
      const execution = await callees(client);

      expect(execution.result, "observed callees are still returned").toEqual([
        "0x2000",
      ]);
      expect(execution.relationshipCoverage).toMatchObject({
        status: "unknown",
        reason:
          "Upstream callees omitted an explicit truncation marker; additional callees remain unknown.",
      });
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("keeps an empty x86 callees reply an observed empty list without any limitation", async () => {
    const { client, producer } = await session({ callees: [] }, "x86_64");
    try {
      const execution = await callees(client);

      expect(execution.result, "nothing is added").toEqual([]);
      expect(
        execution.limitations,
        "no completeness warning on a trustworthy x86 target",
      ).toEqual([...IDA_LIMITATIONS]);
      expect(
        producer.calls.some(({ name }) => name === "callgraph"),
        "no call graph request even for an empty reply",
      ).toBe(false);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("does not use the call graph for the legacy attached profile on an ARM target", async () => {
    const { root, target } = await createIdaTarget("arm64");
    attachedRoots.push(root);
    const producer = new RecordingIdaMcp(target, "attached");
    const client = new IdaSessionClient(
      {
        command: "fixture",
        args: [],
        env: {},
        mode: "attached",
        timeoutMs: 1000,
        workspaceRoot: root,
      },
      target,
      producer,
    );
    try {
      const result = await client.execute("procedure_callees", {
        procedure: "main",
      });

      expect(result.ok, "the legacy read still works").toBe(true);
      expect(
        producer.calls.some(({ name }) => name === "callgraph"),
        "the legacy profile has no call graph source",
      ).toBe(false);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});
