import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { inspectAddressContext } from "../../../../src/application/AnalysisContextQueries.js";
import { EnhancedTools } from "../../../../src/application/EnhancedTools.js";
import { IdaSessionClient } from "../../../../src/ida/IdaSessionClient.js";
import { createIdaTarget, RecordingIdaMcp } from "../../../fixtures/idaMcp.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

const session = async (cappedReferences = false) => {
  const { root, target } = await createIdaTarget("arm64");
  roots.push(root);
  const producer = new RecordingIdaMcp(target, "headless");
  if (cappedReferences) {
    const inner = producer.overrideCall;
    producer.overrideCall = (name, args) =>
      name === "xrefs_to"
        ? [
            {
              xrefs: [
                {
                  addr: "0x1004",
                  type: "code",
                  fn: { addr: "0x1000", name: "main", size: "0x20" },
                },
              ],
              more: true,
            },
          ]
        : inner?.(name, args);
  }
  const client = new IdaSessionClient(
    {
      command: "fixture",
      args: [],
      env: {},
      mode: "headless",
      timeoutMs: 1000,
      workspaceRoot: root,
    },
    target,
    producer,
  );
  return { client, target };
};

const MAIN = {
  found: true,
  procedure: { address: "0x1000", name: "main" },
};

describe("trace_feature on headless IDA", () => {
  it("attributes a reference to its containing procedure", async () => {
    const { client } = await session();
    try {
      const result = await new EnhancedTools(client).execute("trace_feature", {
        query: "a.b",
      });

      if (!result.ok) throw result.error;
      expect(result.value).toMatchObject({
        matches: [{ type: "string", address: "0x3000" }],
        references: [
          {
            target_address: "0x3000",
            source_address: "0x1004",
            containing_procedure: MAIN,
          },
        ],
        truncated: false,
        residual_unknowns: [],
      });
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("keeps an upstream reference cap visible once containment makes the trace run", async () => {
    const { client } = await session(true);
    try {
      const result = await new EnhancedTools(client).execute("trace_feature", {
        query: "a.b",
      });

      if (!result.ok) throw result.error;
      expect(result.value).toMatchObject({
        references: [{ source_address: "0x1004", containing_procedure: MAIN }],
        truncated: true,
        residual_unknowns: [
          "References to 0x3000 were truncated by the provider; additional references may exist.",
        ],
      });
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});

describe("inspect_address_context on headless IDA", () => {
  it("resolves the admitted program as the document and reports the containing procedure", async () => {
    const { client, target } = await session();
    try {
      const result = await inspectAddressContext(client, {
        address: "0x1004",
      });

      if (!result.ok) throw result.error;
      expect(result.value).toMatchObject({
        address: "0x1004",
        document: target.path,
        procedure: { state: "available", value: MAIN },
        name: { state: "unavailable" },
        comment: { state: "unavailable" },
        inline_comment: { state: "unavailable" },
        bookmarks: { state: "unavailable" },
      });
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("answers the same way for an explicit admitted document", async () => {
    const { client, target } = await session();
    try {
      const implicit = await inspectAddressContext(client, {
        address: "0x1004",
      });
      const explicit = await inspectAddressContext(client, {
        address: "0x1004",
        document: target.path,
      });

      if (!implicit.ok) throw implicit.error;
      if (!explicit.ok) throw explicit.error;
      expect(explicit.value).toEqual(implicit.value);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});
