import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  createIdaTarget,
  RecordingIdaMcp,
} from "../../tests/fixtures/idaMcp.js";
import {
  callGraphSession as session,
  removeCallGraphSessions,
} from "../../tests/fixtures/idaCallGraph.js";

import { IdaSessionClient } from "./IdaSessionClient.js";

const attachedRoots: string[] = [];
afterEach(async () => {
  await removeCallGraphSessions();
  for (const root of attachedRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});

const xrefs = async (more: boolean | undefined) => {
  const { client, producer } = await session({ callees: [] }, "x86_64");
  const inner = producer.overrideCall;
  producer.overrideCall = (name, args) =>
    name === "xrefs_to"
      ? [{ xrefs: [], ...(more === undefined ? {} : { more }) }]
      : inner?.(name, args);
  try {
    const result = await client.execute("xrefs", { address: "0x1000" });
    if (!result.ok) throw result.error;
    return result.value;
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
};

describe("headless IDA reference coverage", () => {
  it("reports a capped xrefs read as truncated", async () => {
    const execution = await xrefs(true);

    expect(execution.referencesTruncated).toBe(true);
    expect(
      execution.limitations,
      "the diagnostic limitation is still reported",
    ).toContain(
      "Upstream xrefs_to capped results at 1000 references; additional references remain unknown.",
    );
  });

  it("reports an explicitly uncapped xrefs read as not truncated", async () => {
    expect((await xrefs(false)).referencesTruncated).toBe(false);
  });

  it("reports nothing when the producer does not say whether the read was capped", async () => {
    expect((await xrefs(undefined)).referencesTruncated).toBeUndefined();
  });

  it("does not report reference coverage for other operations", async () => {
    const { client } = await session({ callees: [] }, "x86_64");
    try {
      const result = await client.execute("procedure_callees", {
        procedure: "main",
      });

      if (!result.ok) throw result.error;
      expect(result.value.referencesTruncated).toBeUndefined();
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("reports nothing for the legacy profile, whose producer has no cap flag", async () => {
    const { root, target } = await createIdaTarget("x86_64");
    attachedRoots.push(root);
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
      new RecordingIdaMcp(target, "attached"),
    );
    try {
      const result = await client.execute("xrefs", { address: "0x1000" });

      if (!result.ok) throw result.error;
      expect(result.value.referencesTruncated).toBeUndefined();
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});
