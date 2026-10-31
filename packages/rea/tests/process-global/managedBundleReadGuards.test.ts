import { projectCliAnalysisResult } from "../../src/cli/projectCliAnalysisResult.js";
import { getHeapStatistics } from "node:v8";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../../src/server/createServer.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { loadNativeMatchingBundleSources } from "../../src/application/native/NativeMatchingBundleSources.js";
import { NativeMatchingAdmission } from "../../src/application/native/NativeMatchingAdmission.js";
import { matchNativeFunctionsInputSchema } from "../../src/contracts/native/functionMatchingContracts.js";
import {
  createEvidence,
  isImmutableEvidence,
  parseEvidence,
  type Evidence,
} from "../../src/domain/evidence.js";
import { runProviderAnalysis } from "../../src/application/DirectAnalysis.js";
import type { DirectAnalysisDependencies } from "../../src/application/DirectAnalysisDependencies.js";
import { parseConfig } from "../../src/config/parseConfig.js";
import { ok } from "../../src/domain/result.js";
import { observed } from "../fixtures/analysisExecution.js";
import {
  createBinarySessionTargets,
  createTestBinarySession,
} from "../fixtures/binarySession.js";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createImmutableEvidenceBundle,
  safeParseImmutableEvidenceBundle,
} from "../../src/domain/evidenceBundle.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { deliverAnalysisEvidence } from "../../src/application/EvidenceBundleCommands.js";
import { inspectAnalysisView } from "../../src/application/analysisView/AnalysisViewService.js";
import { readImmutableEvidenceBundle } from "../../src/application/EvidenceBundleFiles.js";
import { requireAuthenticationHeadroom } from "../../src/application/JsonAuthenticationHeadroom.js";
import { SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE } from "../../src/contracts/javascript/javascriptApplicationWorkflowExamples.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { holdFirstFileRead } from "../support/holdFirstFileRead.js";

vi.mock("../../src/application/JsonAuthenticationHeadroom.js", { spy: true });
vi.mock("node:v8", { spy: true });
vi.mock("../../src/domain/evidenceBundle.js", { spy: true });
afterEach(() => vi.restoreAllMocks());

it.each(["compare_bundles", "match_native_functions"])(
  "attributes bundle authentication refusal to the actual %s boundary",
  async (operation) => {
    const { path, parent } = await savedParent();
    const actual = await vi.importActual<
      typeof import("../../src/application/JsonAuthenticationHeadroom.js")
    >("../../src/application/JsonAuthenticationHeadroom.js");
    vi.mocked(requireAuthenticationHeadroom).mockImplementation(
      (value, options) =>
        actual.requireAuthenticationHeadroom(value, {
          ...options,
          availableBytes: 0,
        }),
    );
    const resources = new ArtifactResourceScope();
    try {
      if (operation === "match_native_functions") {
        const source = {
          kind: "retained-evidence",
          evidence_id: parent.evidence_id,
        };
        await expect(
          loadNativeMatchingBundleSources({
            input: matchNativeFunctionsInputSchema.parse({
              left: source,
              right: source,
            }),
            paths: [path],
            resources,
            admission: new NativeMatchingAdmission(operation),
          }),
        ).rejects.toMatchObject({
          _tag: "AnalysisResourceConstraintError",
          operation,
        });
      } else {
        const session = createTestBinarySession(() => {
          throw new Error("Comparison must not open a target");
        });
        const server = createServer({ kind: "session", session });
        const client = new Client({
          name: "bundle-operation-refusal",
          version: "1",
        });
        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        try {
          await server.connect(serverTransport);
          await client.connect(clientTransport);
          const result = await client.callTool({
            name: operation,
            arguments: { left_bundle_path: path, right_bundle_path: path },
          });
          expect(result.isError).toBe(true);
          expect(parseMcpToolError(result)).toMatchObject({
            error: { code: "resource_constraint", details: { operation } },
          });
          expect(session.exportEvidenceBundle().records).toEqual([]);
        } finally {
          await client.close();
          await server.close();
          await session.close();
        }
      }
    } finally {
      vi.mocked(requireAuthenticationHeadroom).mockImplementation(
        actual.requireAuthenticationHeadroom,
      );
      await resources.close();
    }
    expect(resources.hasPending).toBe(false);
  },
);

const savedParent = async () => {
  const root = await createTestTempDirectory("rea-managed-bundle-guard-");
  const path = join(root, "parent.json");
  const parent = SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE.application;
  await writeFile(
    path,
    JSON.stringify(createImmutableEvidenceBundle([parent])),
  );
  return { path, parent };
};

it("keeps the owning operation when native matching reloads a needed earlier bundle", async () => {
  const root = await createTestTempDirectory("rea-native-bundle-reload-");
  const path = join(root, "parent.json"),
    empty = join(root, "empty.json");
  const parent = createEvidence(
    undefined,
    { id: "fixture", name: "Fixture", version: "1" },
    { operation: "list_procedures", parameters: {}, result: {} },
  );
  await writeFile(
    path,
    JSON.stringify(createImmutableEvidenceBundle([parent])),
  );
  await writeFile(empty, JSON.stringify(createImmutableEvidenceBundle([])));
  const actual = await vi.importActual<
    typeof import("../../src/application/JsonAuthenticationHeadroom.js")
  >("../../src/application/JsonAuthenticationHeadroom.js");
  let reads = 0;
  vi.mocked(requireAuthenticationHeadroom).mockImplementation(
    (value, options) =>
      actual.requireAuthenticationHeadroom(
        value,
        ++reads === 3 ? { ...options, availableBytes: 0 } : options,
      ),
  );
  const resources = new ArtifactResourceScope();
  const source = { kind: "retained-evidence", evidence_id: parent.evidence_id };
  try {
    await expect(
      loadNativeMatchingBundleSources({
        input: matchNativeFunctionsInputSchema.parse({
          left: source,
          right: source,
        }),
        paths: [path, empty],
        resources,
        admission: new NativeMatchingAdmission("match_native_functions"),
      }),
    ).rejects.toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      operation: "match_native_functions",
    });
    expect(reads).toBe(3);
  } finally {
    vi.mocked(requireAuthenticationHeadroom).mockImplementation(
      actual.requireAuthenticationHeadroom,
    );
    await resources.close();
  }
  expect(resources.hasPending).toBe(false);
});

it("admits bundle authentication before cloning and hashing retained records", async () => {
  const { path } = await savedParent();
  const actual = await vi.importActual<
    typeof import("../../src/application/JsonAuthenticationHeadroom.js")
  >("../../src/application/JsonAuthenticationHeadroom.js");
  vi.mocked(requireAuthenticationHeadroom).mockImplementationOnce(
    (value, options) =>
      actual.requireAuthenticationHeadroom(value, {
        ...options,
        availableBytes: 0,
      }),
  );
  vi.mocked(safeParseImmutableEvidenceBundle).mockClear();
  const resources = new ArtifactResourceScope();
  try {
    expect(
      await readImmutableEvidenceBundle(path, undefined, resources),
    ).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisResourceConstraintError", resource: "memory" },
    });
    expect(safeParseImmutableEvidenceBundle).not.toHaveBeenCalled();
  } finally {
    await resources.close();
  }
  expect(resources.hasPending).toBe(false);
});

it("preserves the view operation and caller reason when bundle I/O is cancelled", async () => {
  const { path, parent } = await savedParent();
  const held = await holdFirstFileRead(path);
  const controller = new AbortController();
  const reason = new Error("cancel managed bundle page");
  const resources = new ArtifactResourceScope();
  try {
    const pending = inspectAnalysisView(
      {
        source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
        view: { kind: "summary" },
      },
      undefined,
      { evidenceBundlePath: path, resources, signal: controller.signal },
    );
    await held.firstRead;
    controller.abort(reason);
    held.release();
    const result = await pending;
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "inspect_analysis_view",
      },
    });
    if (result.ok) throw new Error("Expected cancelled bundle read");
    expect(result.error.cause).toBe(reason);
  } finally {
    held.release();
    await resources.close();
  }
  expect(resources.hasPending).toBe(false);
});

it("retains completed parent facts when bundle publication cannot admit authentication", async () => {
  const root = await createTestTempDirectory("rea-managed-delivery-guard-");
  const evidence = SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE.application;
  const actual = await vi.importActual<
    typeof import("../../src/application/JsonAuthenticationHeadroom.js")
  >("../../src/application/JsonAuthenticationHeadroom.js");
  vi.mocked(requireAuthenticationHeadroom).mockImplementationOnce(
    (value, options) =>
      actual.requireAuthenticationHeadroom(value, {
        ...options,
        availableBytes: 0,
      }),
  );
  vi.mocked(createImmutableEvidenceBundle).mockClear();
  const result = await deliverAnalysisEvidence(
    evidence,
    join(root, "parent.json"),
    "summary",
  );
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError", resource: "memory" },
  });
  if (result.ok) throw new Error("Expected refused bundle authentication");
  expect(result.error.partialObservation).toBe(evidence);
  expect(createImmutableEvidenceBundle).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual([]);
});

it("projects a rejected managed parent by reference without cloning under low headroom", async () => {
  const root = await createTestTempDirectory(
    "rea-managed-low-heap-projection-",
  );
  const [target] = await createBinarySessionTargets();
  const source = {
    rows: Array.from({ length: 512 }, (_, token) => ({
      token,
      name: "member",
    })),
  };
  let closes = 0;
  const session = () =>
    createTestBinarySession(() => ({
      execute: async () => observed(source),
      close: async () => {
        closes += 1;
        return ok(null);
      },
    }));
  const dependencies: DirectAnalysisDependencies = {
    readConfiguration: () => parseConfig({}),
    createBinarySession: session,
    createNativeDispatchBinarySession: session,
    createArtifactBinarySession: session,
    createNativeBinarySession: session,
    createManagedBinarySession: session,
  };
  const actual = await vi.importActual<
    typeof import("../../src/application/JsonAuthenticationHeadroom.js")
  >("../../src/application/JsonAuthenticationHeadroom.js");
  let parent: Evidence | undefined;
  vi.mocked(requireAuthenticationHeadroom).mockImplementationOnce(
    (value, options) => {
      parent = parseEvidence(value);
      expect(isImmutableEvidence(parent)).toBe(true);
      expect(parent).toBe(value);
      return actual.requireAuthenticationHeadroom(value, {
        ...options,
        availableBytes: 0,
      });
    },
  );
  const result = await runProviderAnalysis(
    dependencies,
    target,
    "inspect_managed_members",
    {},
    undefined,
    undefined,
    {
      detail: "summary",
      evidenceBundlePath: join(root, "parent.json"),
    },
  ).then(projectCliAnalysisResult);
  expect(result).toMatchObject({
    code: "resource_constraint",
    details: { operation: "inspect_managed_members" },
  });
  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    !("details" in result)
  )
    throw new Error("Expected CLI error");
  const details = result.details;
  if (typeof details !== "object" || details === null || Array.isArray(details))
    throw new Error("Expected CLI error details");
  expect(details.partial_observation).toBe(parent);
  expect(parent?.normalized_result).toEqual(source);
  expect(Object.isFrozen(source.rows[0])).toBe(false);
  expect(closes).toBe(1);
  expect(await readdir(root)).toEqual([]);
});

it.each(["JSON assembly", "bundle authentication"])(
  "attributes low-headroom %s to the invoking view",
  async (stage) => {
    const { path, parent } = await savedParent();
    const actualV8 = await vi.importActual<typeof import("node:v8")>("node:v8");
    if (stage === "JSON assembly") {
      vi.mocked(getHeapStatistics).mockReturnValue({
        ...getHeapStatistics(),
        total_available_size: 0,
      });
    } else {
      const actual = await vi.importActual<
        typeof import("../../src/application/JsonAuthenticationHeadroom.js")
      >("../../src/application/JsonAuthenticationHeadroom.js");
      vi.mocked(requireAuthenticationHeadroom).mockImplementationOnce(
        (value, options) =>
          actual.requireAuthenticationHeadroom(value, {
            ...options,
            availableBytes: 0,
          }),
      );
    }
    const resources = new ArtifactResourceScope();
    try {
      expect(
        await inspectAnalysisView(
          {
            source: {
              kind: "retained-evidence",
              evidence_id: parent.evidence_id,
            },
            view: { kind: "summary" },
          },
          undefined,
          { evidenceBundlePath: path, resources },
        ),
      ).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisResourceConstraintError",
          operation: "inspect_analysis_view",
        },
      });
    } finally {
      vi.mocked(getHeapStatistics).mockImplementation(
        actualV8.getHeapStatistics,
      );
      await resources.close();
    }
    expect(resources.hasPending).toBe(false);
  },
);

it("authenticates escaped payloads without serializing either complete bundle", async () => {
  const root = await createTestTempDirectory("rea-escaped-bundle-");
  const path = join(root, "parent.json");
  const escaped = '\u0000\u0001\\"😀\ud800'.repeat(20000);
  const example = SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE.application;
  const parent = createEvidence(undefined, example.provider, {
    predicateType: example.predicate_type,
    operation: example.operation,
    parameters: example.parameters,
    result: example.normalized_result,
    rawResult: { escaped },
  });
  await writeFile(
    path,
    JSON.stringify(createImmutableEvidenceBundle([parent])),
  );
  const stringify = JSON.stringify;
  const fullDocuments: unknown[] = [];
  vi.spyOn(JSON, "stringify").mockImplementation((value: unknown) => {
    if (
      typeof value === "object" &&
      value !== null &&
      Object.hasOwn(value, "records")
    ) {
      fullDocuments.push(value);
      throw new Error(
        "Document-sized JSON allocation forbidden during authentication",
      );
    }
    return stringify(value);
  });
  const resources = new ArtifactResourceScope();
  try {
    const loaded = await readImmutableEvidenceBundle(
      path,
      undefined,
      resources,
    );
    if (!loaded.ok) throw loaded.error;
    expect(loaded.value.records[0]?.evidence_id).toBe(parent.evidence_id);
    expect(loaded.value.records[0]?.raw_result).toEqual({ escaped });
    expect(fullDocuments).toEqual([]);
  } finally {
    await resources.close();
  }
  expect(resources.hasPending).toBe(false);
});

it("seals a fresh object-heavy Evidence tree without retaining a set of completed rows", () => {
  const provider = { id: "fixture", name: "Fixture", version: "1" };
  const row = { seal_probe: true, fields: [1, 2] };
  const result = { rows: Array.from({ length: 512 }, () => row) };
  const observation = {
    operation: "inspect_managed_members",
    parameters: {},
    result,
  };
  const complete = createEvidence(undefined, provider, observation);
  const add = Set.prototype.add;
  const guarded = vi.spyOn(Set.prototype, "add").mockImplementation(function (
    this: Set<unknown>,
    value: unknown,
  ) {
    if (
      typeof value === "object" &&
      value !== null &&
      Object.hasOwn(value, "seal_probe") &&
      this.size > 32
    )
      throw new Error(
        "Sealing retained completed rows beyond its ancestry budget",
      );
    return add.call(this, value);
  });
  let sealed;
  try {
    sealed = createEvidence(undefined, provider, observation, {
      immutable: true,
    });
  } finally {
    guarded.mockRestore();
  }
  expect(sealed).toEqual(complete);
  expect(isImmutableEvidence(sealed)).toBe(true);
  const data = sealed.normalized_result as typeof result;
  expect(data.rows[0]).not.toBe(row);
  expect(data.rows[0]).not.toBe(data.rows[1]);
  expect(Object.isFrozen(data.rows[0]!.fields)).toBe(true);
  expect(Object.isFrozen(row)).toBe(false);
  expect(parseEvidence(sealed)).toBe(sealed);
});
