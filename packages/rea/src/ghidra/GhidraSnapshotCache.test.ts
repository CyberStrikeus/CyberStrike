import { ok as javaProbeOk, err, ok } from "../domain/result.js";
import type { GhidraJavaObservation } from "./GhidraJavaProbe.js";
import { describe, expect, it } from "vitest";

import { createTestBinarySession } from "../../tests/fixtures/binarySession.js";
import { parseConfig } from "../config/parseConfig.js";
import type { AnalysisOperation } from "../application/AnalysisProvider.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { functionDossierSchema } from "../domain/native/functionDossier.js";
import { createAnalysisProfile } from "../domain/analysisProfile.js";
import { ghidraFunctionDossier } from "../domain/ghidraValues.fixture.js";
import { silentLogger } from "../logger.js";
import { GhidraProvider } from "./GhidraProvider.js";
import { GhidraSessionError } from "./GhidraSessionError.js";
import { GHIDRA_SESSION_CAPABILITIES } from "./GhidraSessionValues.js";
import type { RelationshipCoverage } from "../domain/relationshipCoverage.js";

const TARGET: BinaryTarget = {
  path: "/tmp/ghidra-cache-fixture",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "elf",
  architecture: "x86_64",
  availableArchitectures: ["x86_64"],
};

// Exercise the real provider descriptors, profile, input/output projection and
// session cache; only the installed Ghidra process is replaced at its seam.
const fixture = (version = "12.1.4", coverage?: RelationshipCoverage) => {
  const config = parseConfig({ GHIDRA_INSTALL_DIR: "/opt/ghidra" });
  if (!config.ok) throw config.error;
  const calls: string[] = [];
  let name = "original";
  let decompilerFailed = false;
  let cancelStarted: (() => void) | undefined;
  const cancellationReady = new Promise<void>((resolve) => {
    cancelStarted = resolve;
  });
  const provider = new GhidraProvider(
    config.value,
    silentLogger,
    {},
    {
      platform: "linux",
      architecture: "x64",
      readText: () =>
        `application.version=${version}\napplication.java.min=21\n`,
      executable: () => true,
      probeJava: () =>
        javaProbeOk<GhidraJavaObservation>({
          osArch: "amd64",
          osName: "Linux",
          version: "21.0.11",
          major: 21,
          home: "/usr/lib/jvm/jdk-21",
          bits: 64,
          runtime: "jdk",
        }),
    },
    (options) => ({
      start: async () =>
        ok({
          name: "REA Ghidra bridge",
          run_id: "11111111-1111-4111-8111-111111111111",
          profile_digest: options.profileDigest,
          provider: { id: "ghidra", version },
          read_only: false,
          analysis_complete: true,
          analysis_timed_out: false,
          capabilities: [...GHIDRA_SESSION_CAPABILITIES],
          target: {
            name: "fixture",
            language_id: "x86:LE:64:default",
            compiler_spec_id: "gcc",
            image_base: "0x1000",
            default_address_space: "ram",
            sha256: TARGET.sha256,
          },
        }),
      callTool: async (operation, parameters, requestOptions) => {
        calls.push(operation);
        if (requestOptions?.signal !== undefined) {
          const signal = requestOptions.signal;
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
            cancelStarted?.();
          });
          // Active cancellation discards Ghidra's ephemeral annotations; the
          // next request reimports the original artifact under the same profile.
          name = "original";
          return err(new GhidraSessionError("cancelled", "Cancelled"));
        }
        if (operation === "annotate_native_function") {
          if (typeof parameters.name !== "string")
            throw new Error("Expected an annotation name");
          name = parameters.name;
        }
        if (operation === "read_binary_inventory_summary")
          return ok({
            document: "fixture",
            segments: [],
            procedure_count: 0,
            string_count: 0,
          });
        const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
        dossier.procedure.name = name;
        dossier.pseudocode = `void ${name}() {}`;
        if (decompilerFailed) {
          dossier.pseudocode = "";
          dossier.facet_availability = {
            ...dossier.facet_availability,
            pseudocode: {
              available: false,
              reason: "Injected backend failure",
            },
          };
        }
        if (operation === "annotate_native_function")
          return ok({
            annotations: {
              address: dossier.procedure.address,
              name,
              comment: null,
              inline_comment: null,
            },
            dossier,
            effects: {
              scope: "session-analysis-database",
              source_bytes_modified: false,
              persists_after_close: false,
            },
          });
        const value =
          operation === "procedure_pseudo_code" ? dossier.pseudocode : dossier;
        return ok(
          operation === "procedure_pseudo_code" ||
            operation === "analyze_function"
            ? {
                value,
                limitations: [],
                ...(operation === "analyze_function" && decompilerFailed
                  ? { cache_policy: "live" }
                  : {}),
                ...(operation === "analyze_function" && coverage !== undefined
                  ? { relationship_coverage: coverage }
                  : {}),
              }
            : value,
        );
      },
      close: async () => ok(null),
    }),
  );
  return {
    calls,
    cancellationReady,
    setDecompilerFailed: (failed: boolean) => {
      decompilerFailed = failed;
    },
    session: createTestBinarySession(provider),
  };
};

const open = async (session: ReturnType<typeof fixture>["session"]) => {
  const preview = await session.previewTarget(TARGET);
  if (!preview.ok) throw preview.error;
  expect((await session.openResolvedTarget(preview.value)).ok).toBe(true);
};

/**
 * Windows must admit the native source with a live operation before it may
 * replay an imported query. Use a different query so the imported entry is
 * still the one under test.
 */
const admitWindowsNativeSource = async (
  replay: ReturnType<typeof fixture>,
  operation: AnalysisOperation,
): Promise<AnalysisOperation | undefined> => {
  if (process.platform !== "win32") return undefined;
  const admission =
    operation === "read_binary_inventory_summary"
      ? {
          operation: "analyze_function" as const,
          parameters: { procedure: "0xlive" },
        }
      : {
          operation: "read_binary_inventory_summary" as const,
          parameters: {},
        };
  const admitted = await replay.session.execute(
    admission.operation,
    admission.parameters,
  );
  if (!admitted.ok) throw admitted.error;
  expect(replay.calls).toEqual([admission.operation]);
  return admission.operation;
};

describe("Ghidra relationship coverage replay", () => {
  it("retains degraded Evidence without replaying transient failures after recovery or import", async () => {
    const initial = fixture();
    await open(initial.session);
    initial.setDecompilerFailed(true);
    const parameters = { procedure: "0x1000" };
    const degraded = await initial.session.execute(
      "analyze_function",
      parameters,
    );
    if (!degraded.ok) throw degraded.error;
    const snapshot = initial.session.exportAnalysisSnapshot();
    if (!snapshot.ok) throw snapshot.error;
    expect(snapshot.value.entries).toEqual([]);
    expect(snapshot.value.evidence_bundle.records).toHaveLength(1);

    initial.setDecompilerFailed(false);
    const recovered = await initial.session.execute(
      "analyze_function",
      parameters,
    );
    if (!recovered.ok) throw recovered.error;
    expect(
      functionDossierSchema.parse(recovered.value.result).pseudocode,
    ).not.toBe("");
    expect(
      (await initial.session.execute("analyze_function", parameters)).ok,
    ).toBe(true);
    expect(initial.calls).toEqual(["analyze_function", "analyze_function"]);
    await initial.session.close();

    const replay = fixture();
    expect(replay.session.importAnalysisSnapshot(snapshot.value).ok).toBe(true);
    await open(replay.session);
    const imported = await replay.session.execute(
      "analyze_function",
      parameters,
    );
    if (!imported.ok) throw imported.error;
    expect(
      functionDossierSchema.parse(imported.value.result).pseudocode,
    ).not.toBe("");
    expect(replay.calls).toEqual(["analyze_function"]);
    expect(replay.session.exportEvidenceBundle().records).toHaveLength(2);
    await replay.session.close();
  });

  it.each([
    undefined,
    { status: "complete", diagnostics: ["Resolved static references only."] },
    { status: "partial", limitations: ["Instruction coverage was truncated."] },
    { status: "unknown", reason: "Relationship inventory was unavailable." },
    {
      status: "partial",
      limitations: ["Missing callers."],
      limited_directions: ["callers"],
    },
  ] satisfies (RelationshipCoverage | undefined)[])(
    "preserves relationship coverage %j through live execution, cache and snapshot replay",
    async (coverage) => {
      const initial = fixture("12.1.4", coverage);
      await open(initial.session);
      const parameters = { procedure: "0x1000" };
      for (let i = 0; i < 2; i++) {
        const execution = await initial.session.execute(
          "analyze_function",
          parameters,
        );
        if (!execution.ok) throw execution.error;
        expect(execution.value.relationshipCoverage).toEqual(coverage);
      }
      expect(initial.calls).toEqual(["analyze_function"]);
      const snapshot = initial.session.exportAnalysisSnapshot();
      if (!snapshot.ok) throw snapshot.error;
      await initial.session.close();
      const liveCoverage: RelationshipCoverage = {
        status: "unknown",
        reason: "live fixture must not be replayed",
      };
      const replay = fixture("12.1.4", liveCoverage);
      expect(replay.session.importAnalysisSnapshot(snapshot.value).ok).toBe(
        true,
      );
      await open(replay.session);
      const admittedOperation = await admitWindowsNativeSource(
        replay,
        "analyze_function",
      );
      const execution = await replay.session.execute(
        "analyze_function",
        parameters,
      );
      if (!execution.ok) throw execution.error;
      expect(execution.value.relationshipCoverage ?? undefined).toEqual(
        coverage,
      );
      expect(execution.value.limitations).toEqual(
        expect.arrayContaining([
          expect.stringContaining("local REA analysis snapshot"),
        ]),
      );
      expect(replay.calls).toEqual(
        admittedOperation === undefined ? [] : [admittedOperation],
      );
      await replay.session.close();
    },
  );
});

describe("Ghidra snapshot profile admission", () => {
  it.each([
    {
      parameter: "instruction_status",
      current: "unlisted-address-without-decode-v1",
      legacy: undefined,
    },
    {
      parameter: "function_boundary_observations",
      current: "ghidra-function-boundary-limitations-v4",
      legacy: "ghidra-function-boundary-limitations-v3",
    },
    {
      parameter: "instruction_references",
      current: "exact-address-incoming-without-synthetic-entry-v2",
      legacy: "exact-address-incoming-v1",
    },
    {
      parameter: "instruction_references",
      current: "exact-address-incoming-without-synthetic-entry-v2",
      legacy: undefined,
    },
    {
      parameter: "call_relationship_coverage",
      current: "function-body-call-coverage-v5",
      legacy: "resolved-call-reference-diagnostics-v1",
    },
    {
      parameter: "call_relationship_coverage",
      current: "function-body-call-coverage-v5",
      legacy: "decoded-call-target-coverage-v2",
    },
    {
      parameter: "call_relationship_coverage",
      current: "function-body-call-coverage-v5",
      legacy: "decoded-call-target-coverage-v3",
    },
    {
      parameter: "call_relationship_coverage",
      current: "function-body-call-coverage-v5",
      legacy: "function-body-call-coverage-v4",
    },
  ])(
    "refuses snapshots with outdated $parameter semantics",
    async ({ parameter, current, legacy: prior }) => {
      const initial = fixture();
      await open(initial.session);
      const snapshot = initial.session.exportAnalysisSnapshot();
      if (!snapshot.ok) throw snapshot.error;
      await initial.session.close();
      const profile = snapshot.value.binding.analysis_profile;
      expect(profile.parameters[parameter]).toBe(current);
      const legacy = {
        ...snapshot.value,
        binding: {
          ...snapshot.value.binding,
          analysis_profile: createAnalysisProfile(profile.provider, {
            ...Object.fromEntries(
              Object.entries(profile.parameters).filter(
                ([key]) => key !== parameter,
              ),
            ),
            ...(prior === undefined ? {} : { [parameter]: prior }),
          }),
        },
      };
      const replay = fixture();
      const imported = replay.session.importAnalysisSnapshot(legacy);
      if (!imported.ok) throw imported.error;
      expect(await replay.session.previewTarget(TARGET)).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceIntegrityError" },
      });
      expect(replay.calls).toEqual([]);
      await replay.session.close();
    },
  );
});

describe("Ghidra snapshot cache", () => {
  it.each([
    { operation: "read_binary_inventory_summary", parameters: {} },
    { operation: "analyze_function", parameters: { procedure: "0x1000" } },
    {
      operation: "procedure_pseudo_code",
      parameters: { procedure: "0x1000", document: "fixture" },
    },
  ] as const)(
    "replays repeated $operation calls and imported snapshots despite private project writes",
    async ({ operation, parameters }) => {
      const initial = fixture();
      await open(initial.session);
      const first = await initial.session.execute(operation, parameters);
      expect(first.ok).toBe(true);
      const second = await initial.session.execute(operation, parameters);
      expect(second).toMatchObject({
        ok: true,
        value: {
          limitations: expect.arrayContaining([
            expect.stringContaining("local REA analysis snapshot"),
          ]),
        },
      });
      expect(second.ok && second.value.result).toEqual(
        first.ok && first.value.result,
      );
      expect(initial.calls).toEqual([operation]);
      const snapshot = initial.session.exportAnalysisSnapshot();
      if (!snapshot.ok) throw snapshot.error;
      expect(snapshot.value.entries).toHaveLength(1);
      expect(snapshot.value.binding.analysis_profile.provider.version).toBe(
        "12.1.4",
      );
      await initial.session.close();

      const replay = fixture();
      expect(replay.session.importAnalysisSnapshot(snapshot.value).ok).toBe(
        true,
      );
      await open(replay.session);
      const admittedOperation = await admitWindowsNativeSource(
        replay,
        operation,
      );
      const imported = await replay.session.execute(operation, parameters);
      expect(imported).toMatchObject({
        ok: true,
        value: {
          limitations: expect.arrayContaining([
            expect.stringContaining("local REA analysis snapshot"),
          ]),
        },
      });
      expect(imported.ok && imported.value.result).toEqual(
        first.ok && first.value.result,
      );
      expect(replay.calls).toEqual(
        admittedOperation === undefined ? [] : [admittedOperation],
      );
      await replay.session.close();

      const changed = fixture("12.1.5");
      expect(changed.session.importAnalysisSnapshot(snapshot.value).ok).toBe(
        true,
      );
      expect(await changed.session.previewTarget(TARGET)).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceIntegrityError" },
      });
      expect(changed.calls).toEqual([]);
    },
  );

  it("keeps annotation-dependent reads live after cancellation reimports the original artifact", async () => {
    const { session, calls, cancellationReady } = fixture();
    await open(session);
    expect(
      (await session.execute("read_binary_inventory_summary", {})).ok,
    ).toBe(true);
    const parameters = { procedure: "0x1000", document: "fixture" };
    expect(
      await session.execute("procedure_pseudo_code", parameters),
    ).toMatchObject({
      ok: true,
      value: { result: "void original() {}" },
    });
    expect(
      (
        await session.execute("annotate_native_function", {
          procedure: "0x1000",
          name: "renamed",
        })
      ).ok,
    ).toBe(true);
    for (let index = 0; index < 2; index += 1) {
      expect(
        (await session.execute("read_binary_inventory_summary", {})).ok,
      ).toBe(true);
      expect(
        await session.execute("procedure_pseudo_code", parameters),
      ).toMatchObject({
        ok: true,
        value: { result: "void renamed() {}" },
      });
    }
    expect(session.exportAnalysisSnapshot().ok).toBe(false);
    const controller = new AbortController();
    const cancelled = session.execute(
      "analyze_function",
      { procedure: "0x2000" },
      { signal: controller.signal },
    );
    await cancellationReady;
    controller.abort();
    expect(await cancelled).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    for (let index = 0; index < 2; index += 1) {
      expect(
        (await session.execute("read_binary_inventory_summary", {})).ok,
      ).toBe(true);
      expect(
        await session.execute("procedure_pseudo_code", parameters),
      ).toMatchObject({
        ok: true,
        value: { result: "void original() {}" },
      });
    }
    expect(
      calls.filter(
        (operation) => operation === "read_binary_inventory_summary",
      ),
    ).toHaveLength(5);
    expect(
      calls.filter((operation) => operation === "procedure_pseudo_code"),
    ).toHaveLength(5);
    expect(session.exportAnalysisSnapshot().ok).toBe(false);
    await session.close();
  });
});
