import { setImmediate } from "node:timers";
import { mkdir, open, realpath, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import {
  ArtifactResourceScope,
  type ArtifactResourceOwner,
} from "../../../src/artifacts/ArtifactResourceScope.js";
import { analyzeJavaScriptApplication as analyzeOwnedApplication } from "../../../src/application/javascript/JavaScriptApplicationService.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { AnalysisOutputError } from "../../../src/domain/analysisErrorCore.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { JavaScriptAnalysisWorker } from "../../../src/javascript/analysis/JavaScriptAnalysisWorker.js";

it.each(["worker-phase", "final-cleanup", "no-cancellation"] as const)(
  "preserves the primary through failed worker cleanup and exact-owner retry: %s",
  async (timing) => {
    const root = await createTestTempDirectory("rea-js-primary-cleanup-");
    await writeFile(join(root, "main.js"), "export const observed = 7;");
    const controller = new AbortController();
    const reason = { request: "cancelled while worker resources remain owned" };
    let denyRemoval = true;
    let runtimePath: string | undefined;
    const originalClose = PrivateRuntimeRoot.prototype.close;
    const close = vi
      .spyOn(PrivateRuntimeRoot.prototype, "close")
      .mockImplementation(async function (this: PrivateRuntimeRoot) {
        if (basename(this.path).startsWith("rea-javascript-analysis-")) {
          runtimePath = this.path;
          if (timing === "final-cleanup") controller.abort(reason);
          if (denyRemoval)
            throw new Error(
              "controlled JavaScript worker root removal failure",
            );
        }
        await originalClose.call(this);
      });
    // Exercise physical finalization even after the one healthy source finishes.
    const reuse = vi
      .spyOn(JavaScriptAnalysisWorker.prototype, "canReuse")
      .mockReturnValue(false);
    const scope = new ArtifactResourceScope();
    onTestFinished(async () => {
      denyRemoval = false;
      try {
        await scope.close();
      } finally {
        close.mockRestore();
        reuse.mockRestore();
      }
    });
    const result = await analyzeOwnedApplication(
      { input_path: root, format: "directory" },
      scope,
      {
        signal: controller.signal,
        progress: {
          async report(event) {
            if (
              timing === "worker-phase" &&
              event.phase.startsWith("javascript_worker_")
            )
              controller.abort(reason);
          },
        },
      },
    );
    if (result.ok) throw new Error("Expected cleanup failure");
    expect(runtimePath).toBeDefined();
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toContain(runtimePath);
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: { partial_observation: expect.any(Object) },
    });
    if (timing !== "no-cancellation") {
      expect(result.error.cleanupPrimary).toBeDefined();
      expect(result.error.cleanupPrimary?.cause).toBe(reason);
    }
    denyRemoval = false;
    await scope.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    const projected = projectAnalysisError(result.error);
    expect(projected.code).toBe(
      timing === "no-cancellation" ? "execution_failure" : "cancelled",
    );
    expect(projected.details).toMatchObject({
      partial_observation: expect.any(Object),
    });
  },
);

it.each(["during cleanup", "on the next control turn"] as const)(
  "retains the final source when cancellation arrives %s after analysis",
  async (timing) => {
    const parent = await createTestTempDirectory("rea-js-cancel-handoff-");
    const root = join(parent, "physical");
    const selected = join(parent, "selected");
    await mkdir(root);
    await symlink(
      root,
      selected,
      process.platform === "win32" ? "junction" : "dir",
    );
    const resolved = await realpath(root);
    await writeFile(
      join(root, "main.js"),
      'import { readFile } from "node:fs/promises"; export { readFile };\n',
    );
    const controller = new AbortController();
    const reason = { request: "caller cancelled JavaScript analysis" };
    class CancellingCleanupScope extends ArtifactResourceScope {
      override async release(owner: ArtifactResourceOwner) {
        const result = await super.release(owner);
        if (owner.kind === "javascript-source-analysis") {
          if (timing === "during cleanup") controller.abort(reason);
          else setImmediate(() => controller.abort(reason));
        }
        return result;
      }
    }
    const scope = new CancellingCleanupScope();
    onTestFinished(() => scope.close());
    const result = await analyzeOwnedApplication(
      { input_path: selected, format: "directory" },
      scope,
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Cancelled handoff must not succeed");
    expect(result.error.cause).toBe(reason);
    const projected = projectAnalysisError(result.error);
    expect(projected.code).toBe("cancelled");
    expect(projected).toMatchObject({
      details: {
        partial_observation: {
          parameters: { input_path: selected },
          subject: { local_path: resolved },
          normalized_result: { input_path: resolved },
        },
      },
    });
    const partial = z
      .object({
        details: z.object({
          partial_observation: z.object({
            normalized_result: javascriptApplicationAnalysisResultSchema,
          }),
        }),
      })
      .parse(projected).details.partial_observation.normalized_result;
    expect(partial.statistics).toMatchObject({
      relevant_files: 1,
      parsed_javascript_files: 1,
      parse_failures: 0,
    });
    expect(partial.graph.edges).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          specifier: "node:fs/promises",
          module_link_kind: "import",
        }),
      }),
    );
  },
);

it("preserves imported manifest status when cancelled before visiting manifests", async () => {
  const root = await createTestTempDirectory("rea-js-cancel-package-");
  const manifests = [
    ["valid", '{"version":"1.0.0"}', "included"],
    ["malformed", "{", "invalid"],
    ["non-object", "[]", "included"],
    ["unavailable", Buffer.from([0xff]), "unavailable"],
  ] as const;
  await Promise.all(
    manifests.map(async ([name, content]) => {
      const directory = join(root, "z", name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "package.json"), content);
    }),
  );
  await writeFile(
    join(root, "a.cjs"),
    manifests
      .map(
        ([name], index) =>
          `const manifest${index} = require("./z/${name}/package.json");`,
      )
      .join("\n"),
  );
  await writeFile(join(root, "b.cjs"), "module.exports = 1;");
  const controller = new AbortController();
  const reason = { request: "caller cancelled JavaScript analysis" };
  const visited: string[] = [];
  const result = await analyzeJavaScriptApplication(
    { input_path: root, format: "directory" },
    {
      signal: controller.signal,
      progress: {
        async report(event) {
          if (event.phase !== "parse_javascript_source") return;
          visited.push(event.message);
          if (event.message.includes("b.cjs")) controller.abort(reason);
        },
      },
    },
  );
  if (result.ok) throw new Error("Cancelled analysis must return a failure");
  expect(result.error.cause).toBe(reason);
  const failure = projectAnalysisError(result.error);
  expect(failure.code).toBe("cancelled");
  expect(visited).toHaveLength(2);
  const { graph } = z
    .object({
      details: z.object({
        partial_observation: z.object({
          normalized_result: javascriptApplicationAnalysisResultSchema,
        }),
      }),
    })
    .parse(failure).details.partial_observation.normalized_result;
  for (const [name, , status] of manifests)
    expect(
      graph.edges.find(
        ({ properties }) =>
          properties.module_link_kind === "require" &&
          properties.specifier === `./z/${name}/package.json`,
      )?.properties,
    ).toMatchObject({
      resolution_status: "resolved",
      target_file_kind: "package-json",
      target_json_status: status,
    });
});

it("keeps cancellation before native metadata out of AST scopes and semantic modules", async () => {
  const root = await createTestTempDirectory("rea-js-cancel-file-kinds-");
  await Promise.all(
    (
      [
        ["a.js", "export const observed = 7;\n"],
        ["b.node", Buffer.from([0, 1, 2, 3])],
        ["c.json", '{"observed":7}'],
        ["d.html", '<script src="./a.js"></script>'],
        ["package.json", '{"name":"cancellation-control","main":"a.js"}'],
        [
          "z.js.map",
          JSON.stringify({ version: 3, sources: [], names: [], mappings: "" }),
        ],
        ["zz.js", "export const unvisited = true;\n"],
      ] as const
    ).map(([path, content]) => writeFile(join(root, path), content)),
  );
  const controller = new AbortController();
  const reason = { request: "caller cancelled JavaScript analysis" };
  let reachedNativeMetadata = false;
  const result = await analyzeJavaScriptApplication(
    { input_path: root, format: "directory" },
    {
      signal: controller.signal,
      progress: {
        async report(event) {
          if (
            event.phase === "process_javascript_artifact_metadata" &&
            event.message.includes("b.node")
          ) {
            reachedNativeMetadata = true;
            controller.abort(reason);
          }
        },
      },
    },
  );
  expect(reachedNativeMetadata).toBe(true);
  if (result.ok) throw new Error("Cancelled analysis must return a failure");
  expect(result.error.cause).toBe(reason);
  const partial = z
    .object({
      code: z.literal("cancelled"),
      details: z.object({
        partial_observation: z.object({
          normalized_result: javascriptApplicationAnalysisResultSchema,
        }),
      }),
    })
    .parse(projectAnalysisError(result.error)).details
    .partial_observation.normalized_result;
  expect(partial.statistics.parsed_javascript_files).toBe(1);
  expect(partial.graph.nodes.some(({ kind }) => kind === "native-addon")).toBe(
    true,
  );
  const scopes = (path: string) =>
    partial.graph.nodes.flatMap((node) =>
      node.kind !== "unknown"
        ? []
        : node.observations.filter(
            ({ properties }) =>
              properties.path === path &&
              properties.analysis_failure !== undefined,
          ),
    );
  expect({
    native_ast_scopes: scopes("b.node").map(({ properties, evidence }) => ({
      operation: properties.operation,
      authority: evidence.authority,
    })),
    native_semantic_modules: partial.semantic_graph.nodes
      .filter(({ identity }) => identity.module_path === "b.node")
      .map(({ kind, label }) => ({ kind, label })),
  }).toEqual({ native_ast_scopes: [], native_semantic_modules: [] });
  for (const [path, operation] of [
    ["c.json", "parse-json-module"],
    ["d.html", "parse-html-script-references"],
    ["package.json", "parse-package-json"],
    ["z.js.map", "parse-local-source-map"],
    ["zz.js", "analyze-javascript-source"],
  ] as const) {
    expect(scopes(path)).toHaveLength(1);
    expect(scopes(path)[0]).toMatchObject({
      properties: { operation, analysis_status: "not-started" },
      evidence: {
        authority: path === "zz.js" ? "ast-static-analysis" : "artifact-bytes",
        state: "unavailable",
        confidence: "unknown",
      },
    });
  }
  expect(
    partial.semantic_graph.nodes.some(
      ({ kind, identity }) =>
        kind === "module" && identity.module_path === "zz.js",
    ),
  ).toBe(true);
});

it("interrupts semantic graph commitment before result validation", async () => {
  const root = await createTestTempDirectory("rea-js-cancel-semantic-");
  await writeFile(
    join(root, "main.js"),
    Array.from(
      { length: 500 },
      (_, index) =>
        `export function inspect${index}(value) { return JSON.stringify(value); }`,
    ).join("\n"),
  );
  const controller = new AbortController();
  const reason = { request: "caller cancelled JavaScript analysis" };
  const phases: string[] = [];
  const result = await analyzeJavaScriptApplication(
    { input_path: root, format: "directory" },
    {
      signal: controller.signal,
      progress: {
        async report(event) {
          phases.push(event.phase);
          if (event.phase === "seal_javascript_semantic_graph")
            setImmediate(() => controller.abort(reason));
        },
      },
    },
  );
  if (result.ok)
    throw new Error(
      "Cancelled commitment must not publish a successful analysis",
    );
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "cancelled",
    details: { reason: "cancelled" },
  });
  expect(phases).toContain("seal_javascript_semantic_graph");
  expect(phases).not.toContain("validate_javascript_application_result");
});

it("honors control turns and cancellation while preparing one large source for owned analysis (#1462)", async () => {
  const root = await createTestTempDirectory("rea-js-cancel-in-file-");
  await writeFile(
    join(root, "index.js"),
    Array.from(
      { length: 1200 },
      (_, index) =>
        `export function f${index}(){return {name:'f${index}',value:${index}};}`,
    ).join("\n"),
  );
  const controller = new AbortController();
  const reason = { request: "caller cancelled JavaScript analysis" };
  const phases: string[] = [];
  let turns = 0;
  // Count event-loop turns once the file starts; parsing, analysis and
  // projection of this one file must leave room for them.
  const tick = (): void => {
    turns += 1;
    if (turns === 3) controller.abort(reason);
    else if (!controller.signal.aborted) setImmediate(tick);
  };
  const result = await analyzeJavaScriptApplication(
    { input_path: root, format: "directory" },
    {
      signal: controller.signal,
      progress: {
        async report(event) {
          phases.push(event.phase);
          if (event.phase === "parse_javascript_source") setImmediate(tick);
        },
      },
    },
  );
  if (result.ok) throw new Error("Cancelled analysis must not succeed");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "cancelled",
  });
  expect(phases).toContain("parse_javascript_source");
  expect(phases).not.toContain("build_javascript_application_graph");
});

it.each([
  "parse_javascript_source",
  "build_javascript_application_graph",
  "seal_javascript_application_graph",
  "build_javascript_semantic_graph",
  "seal_javascript_semantic_graph",
  "validate_javascript_application_result",
  "create_javascript_application_evidence",
  "seal_javascript_application_result",
  "validate_javascript_application_evidence",
  "hash_javascript_application_evidence",
])("rejects cancellation scheduled during %s", async (phase) => {
  const root = await createTestTempDirectory("rea-js-cancel-phase-");
  await writeFile(
    join(root, "main.js"),
    "export function inspect(value) { return JSON.stringify(value); }\n",
  );
  const controller = new AbortController();
  const reason = { request: "caller cancelled JavaScript analysis" };
  let requested = false;
  const terminal: string[] = [];
  const result = await analyzeJavaScriptApplication(
    { input_path: root, format: "directory" },
    {
      signal: controller.signal,
      progress: {
        async report(event) {
          if (event.terminal) terminal.push(event.phase);
          if (event.phase === phase) {
            requested = true;
            setImmediate(() => controller.abort(reason));
          }
        },
      },
    },
  );
  expect(requested).toBe(true);
  if (result.ok) throw new Error("Cancelled analysis must return a failure");
  expect(result.error.cause).toBe(reason);
  const failure = projectAnalysisError(result.error);
  expect(failure).toMatchObject({ code: "cancelled" });
  expect(failure).toMatchObject({
    details: {
      operation: "analyze_javascript_application",
      partial_observation: {
        normalized_result: {
          statistics: {
            relevant_files: 1,
            parsed_javascript_files:
              phase === "parse_javascript_source" ? 0 : 1,
            parse_failures: 0,
          },
        },
      },
    },
  });
  if (phase === "parse_javascript_source")
    expect(failure.details).toMatchObject({ cleanup: "complete" });
  expect(terminal).toEqual([]);
});

it("honors cancellation observed during the terminal publication race", async () => {
  const root = await createTestTempDirectory("rea-js-cancel-terminal-");
  await writeFile(join(root, "main.js"), "export const value = 1;\n");
  const controller = new AbortController();
  const reason = { request: "caller cancelled JavaScript analysis" };
  const result = await analyzeJavaScriptApplication(
    { input_path: root, format: "directory" },
    {
      signal: controller.signal,
      progress: {
        async report(event) {
          if (event.terminal) controller.abort(reason);
        },
      },
    },
  );
  if (result.ok) throw new Error("Expected cancellation before admission");
  expect(result.error.cause).toBe(reason);
  const failure = projectAnalysisError(result.error);
  expect(failure).toMatchObject({
    details: { reason: "cancelled" },
  });
  expect(failure).toMatchObject({
    details: {
      partial_observation: {
        normalized_result: {
          statistics: { relevant_files: 1, parsed_javascript_files: 1 },
        },
      },
    },
  });
});

it("keeps the exact retained descriptor owner through application failure translation and retry", async () => {
  const root = await createTestTempDirectory("rea-js-retained-cleanup-");
  const paths = [join(root, "first.js"), join(root, "second.js")];
  await Promise.all(
    paths.map((path) => writeFile(path, "export const value = 1;")),
  );
  const files = await Promise.all(paths.map((path) => open(path, "r")));
  const scope = new ArtifactResourceScope();
  let allowClose = false;
  const attempts = [0, 0];
  files.forEach((file, index) =>
    scope.retain({
      kind: "lease",
      resource: paths[index]!,
      lease: {
        async release() {
          attempts[index]! += 1;
          if (index === 0 && !allowClose)
            throw new Error("injected descriptor close denial");
          await file.close();
        },
      },
    }),
  );
  onTestFinished(async () => {
    allowClose = true;
    await scope.close();
  });
  const result = await analyzeOwnedApplication(
    { input_path: root, format: "directory" },
    scope,
  );
  if (result.ok) throw new Error("Expected retained cleanup to block analysis");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "cleanup_incomplete",
    retryable: false,
  });
  expect(attempts).toEqual([1, 1]);
  allowClose = true;
  await scope.close();
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(attempts).toEqual([2, 1]);
});

it.each(["native-error", "analysis-error", "abort-reason"] as const)(
  "classifies the producer progress failure under late cancellation (%s)",
  async (kind) => {
    const root = await createTestTempDirectory("rea-js-progress-primary-");
    await writeFile(join(root, "main.js"), "export const observed = 1;");
    const controller = new AbortController();
    const reason = { request: "unrelated cancellation" };
    const failure =
      kind === "abort-reason"
        ? reason
        : kind === "analysis-error"
          ? new AnalysisOutputError(
              "analyze_javascript_application",
              "progress callback failed",
            )
          : new Error("progress callback failed");
    const result = await analyzeJavaScriptApplication(
      { input_path: root, format: "directory" },
      {
        signal: controller.signal,
        progress: {
          async report(event) {
            if (event.phase === "parse_javascript_source") {
              controller.abort(reason);
              throw failure;
            }
          },
        },
      },
    );
    if (result.ok) throw new Error("Expected progress failure");
    if (kind === "abort-reason") {
      expect(projectAnalysisError(result.error).code).toBe("cancelled");
      expect(result.error.cause).toBe(reason);
    } else if (kind === "analysis-error") expect(result.error).toBe(failure);
    else {
      expect(result.error).toMatchObject({ _tag: "ProviderAdapterError" });
      expect(result.error.cause).toBe(failure);
    }
  },
);
