import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const assertRetainedMemoryFailure = (value: unknown, path: string): void => {
  const parsed = z
    .object({
      code: z.literal("resource_constraint"),
      message: z.string(),
      details: z.object({
        operation: z.literal("analyze_javascript_application"),
        resource: z.literal("memory"),
        reported_limits: z.record(z.string(), z.unknown()),
      }),
      remediation: z.object({ action: z.string() }),
    })
    .safeParse(value);
  if (!parsed.success)
    throw new Error(
      `Expected a typed memory constraint for ${path}; got ${JSON.stringify(value)}`,
      { cause: parsed.error },
    );
  const failure = parsed.data;
  const limits = failure.details.reported_limits;
  const graphAdmission = z
    .object({
      parent_available_result_budget_bytes: z.number(),
      module_retention_estimate_bytes: z.number(),
      graph_retention_estimate_bytes: z.number(),
    })
    .safeParse(limits);
  if (graphAdmission.success) {
    expect(
      graphAdmission.data.module_retention_estimate_bytes +
        graphAdmission.data.graph_retention_estimate_bytes,
    ).toBeGreaterThan(graphAdmission.data.parent_available_result_budget_bytes);
    expect(failure.message).toContain(
      `Semantic graph for ${path} exceeds the parent's remaining result budget`,
    );
    expect(failure.remediation.action).toContain("parent result budget");
    expect(failure.remediation.action).toContain(
      "retained static and module facts",
    );
    return;
  }
};

cliTest.skipIf(process.versions.bun !== undefined).for([
  { laterSources: 1, heapMb: 640, methodsCount: 400, retainGraph: true },
  { laterSources: 10, heapMb: 640, methodsCount: 400, retainGraph: true },
  // Exercise retained evidence and later checkpoints under real heap pressure.
  // The controlled worker test proves graph-only admission independently of GC.
  { laterSources: 1, heapMb: 448, methodsCount: 600, retainGraph: false },
])(
  "preserves evidence with $laterSources later checkpoints and a $heapMb MiB parent heap",
  { timeout: 90_000 },
  async ({ laterSources, heapMb, methodsCount, retainGraph }, { cli }) => {
    const root = await createTestTempDirectory("rea-js-checkpoint-reserve-");
    const source = Array.from(
      { length: methodsCount },
      (_, index) =>
        `export function method_${String(index)}(input) { const value = input + ${String(index)}; const pair = { value }; return pair.value; }`,
    ).join("\n");
    const files: readonly (readonly [string, string])[] = [
      ["a-large.mjs", source],
      ...Array.from(
        { length: laterSources },
        (_, index) =>
          [
            `z-tiny-${String(index)}.mjs`,
            `export const tiny${String(index)} = 1;\n`,
          ] as const,
      ),
    ];
    for (const [name, text] of files) await writeFile(join(root, name), text);
    const response = await cli.run({
      arguments: ["analyze", root, "--format", "json"],
      environment: {
        NODE_OPTIONS: `--max-old-space-size=${String(heapMb)} --max-semi-space-size=8`,
      },
      timeoutMs: 60_000,
    });
    expect(response.exitCode).toBe(0);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(response.json).normalized_result,
    );
    expect(result.statistics.parsed_javascript_files).toBe(laterSources + 1);
    expect(result.statistics.parse_failures).toBe(0);
    const failures = result.graph.nodes.flatMap((node) =>
      node.observations.flatMap(({ properties }) =>
        properties.analysis_failure === undefined
          ? []
          : [
              {
                kind: node.kind,
                identity: node.identity,
                path: properties.path,
                failure: properties.analysis_failure,
              },
            ],
      ),
    );
    const methods = result.semantic_graph.nodes.filter(
      ({ kind, identity }) =>
        kind === "function" && identity.module_path === "a-large.mjs",
    );
    if (retainGraph)
      expect(methods.map(({ label }) => label).sort()).toEqual(
        Array.from(
          { length: methodsCount },
          (_, index) => `method_${String(index)}`,
        ).sort(),
      );
    else {
      expect(methods).toHaveLength(0);
      expect([
        result.graph.coverage.status,
        result.semantic_graph.coverage.status,
      ]).toContain("partial");
    }
    expect(
      result.semantic_graph.nodes.some(
        ({ identity, label }) =>
          identity.module_path === `z-tiny-${String(laterSources - 1)}.mjs` &&
          label === `tiny${String(laterSources - 1)}`,
      ),
    ).toBe(true);
    for (const [name, text] of files) {
      const digest = createHash("sha256").update(text).digest("hex");
      const node = result.graph.nodes.find(
        ({ kind, identity }) =>
          kind === "javascript-asset" &&
          identity.strategy === "content-digest" &&
          identity.sha256 === digest,
      );
      expect(node?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              path: name,
              parse_status: "complete",
            }),
          }),
        ]),
      );
      if (retainGraph) expect(failures).toEqual([]);
      expect(await readFile(join(root, name), "utf8")).toBe(text);
      if (!retainGraph && name === "a-large.mjs") {
        const failureRecord = failures.find(
          ({ kind, identity, path }) =>
            kind === "unknown" &&
            path === name &&
            identity.strategy === "artifact-local-key" &&
            identity.artifact_sha256 === digest &&
            identity.namespace === "static-parse-scope" &&
            identity.key === `analyze-javascript-source:${name}`,
        );
        if (failureRecord === undefined)
          throw new Error(`Missing analysis failure for ${name}`);
        assertRetainedMemoryFailure(failureRecord.failure, name);
      }
    }
    expect(response.stderr).not.toMatch(/FATAL ERROR:.*heap/iu);
  },
);
