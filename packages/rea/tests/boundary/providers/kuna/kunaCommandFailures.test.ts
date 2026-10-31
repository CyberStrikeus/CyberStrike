import { expect, it as test } from "vitest";

import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { inspectKunaInstallationOwned as inspectKunaInstallation } from "./kunaResourceScope.js";
import { KunaTargetCommands } from "../../../../src/kuna/KunaTargetCommands.js";
import { fakeKunaCalls } from "./fakeKuna.js";
import { session } from "./kunaSessionFixture.js";

const it = test.skipIf(process.platform === "win32");

it("reports output beyond REA's fixed buffer as a deterministic memory bound", async () => {
  const { kuna, target, cacheRoot } = await session("rea-kuna-output-limit-");
  const installed = await inspectKunaInstallation({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: cacheRoot,
  });
  if (!installed.ok) throw new Error(installed.error.reason);
  const controller = new AbortController();
  const commands = new KunaTargetCommands(target, {
    signal: controller.signal,
  });
  try {
    // The fake's inventory is a few hundred bytes; admit fewer.
    const result = await commands.run({
      installation: installed.value,
      operation: "list_procedures",
      arguments: (input) => ["functions", input, "--json"],
      deadline: { setting: "REA_KUNA_TIMEOUT_MS", ms: 10_000 },
      outputBytes: 100,
      signal: controller.signal,
    });
    if (result.ok) throw new Error("the oversized inventory was admitted");
    expect(result.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      resource: "memory",
      reportedLimits: { output_limit_bytes: 100 },
      // A cut-off document's tail explains nothing; it is not returned.
      capturedOutput: { stdout: "", truncated: true },
    });
    // The same target and executable overflow the same buffer again, so the
    // caller is not told to wait and retry.
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "resource_constraint",
      retryable: false,
      remediation: {
        action:
          "REA buffers at most 100 bytes of kuna functions output, so repeating this request for this target fails the same way. Use another provider for it.",
      },
    });
  } finally {
    controller.abort();
    expect(await commands.close()).toEqual({ ok: true, value: null });
  }
});

it("parses a graph larger than any fixed output buffer as it streams", async () => {
  const padding = 40 * 1024 * 1024;
  const { open } = await session("rea-kuna-graph-large-", {
    graphPadding: padding,
  });
  const client = open();
  try {
    const result = await client.execute("procedure_callees", {
      procedure: "main",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        result: ["0x1040"],
        rawResult: {
          references: { kind: "kuna-call-graph", functions: 4, edges: 3 },
        },
      },
    });
    if (!result.ok) return;
    expect(
      (result.value.rawResult as { references: { bytes: number } }).references
        .bytes,
    ).toBeGreaterThan(padding);
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("reports graph diagnostics beyond REA's buffer once per session instead of rebuilding it", async () => {
  const { kuna, open } = await session("rea-kuna-graph-overflow-", {
    graph: "noisy",
  });
  const client = open();
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await client.execute("procedure_callers", {
        procedure: "0x1000",
      });
      if (result.ok) throw new Error("the overflowing graph was admitted");
      expect(result.error).toMatchObject({
        _tag: "AnalysisResourceConstraintError",
        resource: "memory",
      });
      expect(projectAnalysisError(result.error).retryable).toBe(false);
    }
    // The second query reused the failure instead of walking the program again.
    expect(
      (await fakeKunaCalls(kuna)).filter(
        ({ argv }) => argv[0] === "decompile-graph",
      ),
    ).toHaveLength(1);
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("says why Kuna cannot answer instead of a generic unavailable message", async () => {
  const { open } = await session("rea-kuna-unavailable-reasons-");
  const client = open();
  try {
    const cases = [
      {
        operation: "procedure_assembly",
        parameters: { procedure: "0x2000" },
        message:
          "Kuna's export lists no code at 0x2000; import slots and data entries have no listing.",
      },
      {
        operation: "procedure_callers",
        parameters: { procedure: "0x1004" },
        message:
          "Kuna's graph has no function node at 0x1004; its relationships are unknown.",
      },
      {
        operation: "list_segments",
        parameters: {},
        message:
          "Kuna answers procedure and string queries, pseudocode, assembly and references; this operation needs another provider.",
      },
    ] as const;
    for (const { operation, parameters, message } of cases) {
      const result = await client.execute(operation, parameters);
      if (result.ok) throw new Error(`${operation} unexpectedly succeeded`);
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "capability_unavailable",
        message,
        retryable: false,
      });
    }
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});
