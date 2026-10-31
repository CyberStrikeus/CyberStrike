import { describe, expect, it } from "vitest";

import { createAnalysisProfile } from "../../domain/analysisProfile.js";
import type { RelationshipCoverage } from "../../domain/relationshipCoverage.js";
import {
  ANALYSIS_SNAPSHOT_PROFILE,
  ANALYSIS_SNAPSHOT_PROVIDER,
  ANALYSIS_SNAPSHOT_TARGET,
} from "../../domain/analysisSnapshot.fixture.js";
import { createEvidence } from "../../domain/evidence.js";
import {
  createEvidenceBundle,
  evidenceBundleForTarget,
} from "../../domain/evidenceBundle.js";
import { ok } from "../../domain/result.js";
import { createAnalysisExecution } from "../AnalysisProvider.js";
import {
  createAnalysisSnapshotWorkflowEntry,
  parseAnalysisSnapshot,
  serializeAnalysisSnapshot,
  snapshotEvidenceForQuery,
  snapshotBinding,
  snapshotTarget,
} from "../../domain/analysisSnapshot.js";
import { REA_WORKFLOW_PROVIDER } from "../../domain/investigationProviders.js";
import { workflowAnalysisProfile } from "../WorkflowAnalysisProfile.js";
import type {
  AnalysisOperation,
  CapabilityDescriptor,
} from "../AnalysisProvider.js";
import {
  AnalysisSnapshotCache,
  SNAPSHOT_CACHE_ENTRY_CEILING,
  isSnapshotCacheable,
  isSourceEvidenceRetainable,
} from "./AnalysisSnapshotCache.js";
import { EvidenceLedger } from "../investigation/EvidenceLedger.js";
import { enhancedOutputSchemas } from "../../contracts/toolOutputSchemaGroups.js";

it.each(["provider", "workflow"] as const)(
  "owns nested %s execution data before returning control to callers",
  (kind) => {
    const cache = new AnalysisSnapshotCache();
    const target = structuredClone(ANALYSIS_SNAPSHOT_TARGET);
    const profile = structuredClone(ANALYSIS_SNAPSHOT_PROFILE);
    const analysisProfile =
      kind === "provider" ? profile : workflowAnalysisProfile(profile);
    const execution = createAnalysisExecution(
      { nested: { value: "original" } },
      structuredClone(
        kind === "provider"
          ? ANALYSIS_SNAPSHOT_PROVIDER
          : REA_WORKFLOW_PROVIDER,
      ),
      {
        rawResult: { nested: { value: "raw" } },
        subject: target,
        analysisProfile,
        locations: [{ kind: "address", address: "0x1000" }],
        relationshipCoverage: {
          status: "partial",
          limitations: ["original coverage"],
        },
      },
    );
    const input = {
      target,
      profile,
      operation: "procedure_info" as const,
      parameters: { address: "0x1000", document: "fixture" },
      execution: { ...execution, analysisProfile },
    };
    if (kind === "provider") cache.record(input);
    else cache.recordWorkflow(input);
    const entries = () =>
      kind === "provider" ? cache.entries() : cache.workflowEntries();
    const expected = entries();
    for (const payload of [execution.result, execution.rawResult]) {
      if (payload === null || typeof payload !== "object")
        throw new Error("Expected structured observation payload");
      Reflect.set(payload, "nested", { value: "caller edit" });
    }
    const location = execution.locations[0];
    if (location !== undefined) Reflect.set(location, "address", "0x2000");
    if (execution.relationshipCoverage?.status === "partial")
      execution.relationshipCoverage.limitations.push("caller edit");
    Reflect.set(execution.limitations, 0, "caller limitation");
    Reflect.set(execution.provider, "name", "caller provider");
    Reflect.set(execution.subject, "path", "/tmp/caller-edited-subject");
    if (kind === "workflow") {
      const upstream = analysisProfile.parameters.upstream_analysis_profile;
      if (upstream === null || typeof upstream !== "object")
        throw new Error("Expected nested workflow profile");
      Reflect.set(upstream, "parameters", { loader: "caller profile" });
    }
    expect(entries()).toEqual(expected);
  },
);

it("exports independent nested query, workflow and Evidence payloads", () => {
  const cache = new AnalysisSnapshotCache();
  const target = ANALYSIS_SNAPSHOT_TARGET;
  const profile = ANALYSIS_SNAPSHOT_PROFILE;
  const result = { nested: [{ text: "ret" }], name: "main" };
  const parameters = { address: "0x1000", document: "fixture" };
  const workflowProfile = workflowAnalysisProfile(profile);
  cache.record({
    target,
    profile,
    operation: "procedure_info",
    parameters,
    execution: createAnalysisExecution(result, ANALYSIS_SNAPSHOT_PROVIDER, {
      subject: target,
      analysisProfile: profile,
      rawResult: result,
    }),
  });
  cache.recordWorkflow({
    target,
    profile,
    operation: "analyze_function",
    parameters,
    execution: {
      ...createAnalysisExecution(result, REA_WORKFLOW_PROVIDER, {
        subject: target,
        rawResult: result,
      }),
      analysisProfile: workflowProfile,
    },
  });
  const bundle = createEvidenceBundle([
    createEvidence(target, ANALYSIS_SNAPSHOT_PROVIDER, {
      operation: "procedure_info",
      parameters,
      result,
      rawResult: result,
      analysisProfile: profile,
    }),
    createEvidence(target, REA_WORKFLOW_PROVIDER, {
      operation: "analyze_function",
      confidence: "derived",
      parameters,
      result,
      rawResult: result,
      analysisProfile: workflowProfile,
    }),
  ]);
  const exported = cache.export(target, profile, bundle);
  if (!exported.ok) throw exported.error;
  const expected = serializeAnalysisSnapshot(exported.value);
  const changed = JSON.stringify(exported.value).replaceAll(
    '"ret"',
    '"changed"',
  );
  // Mutate the returned graph itself, including every duplicated JSON result.
  for (const payload of [
    ...exported.value.entries.flatMap(({ execution }) => [
      execution.result,
      execution.raw_result,
    ]),
    ...exported.value.workflow_entries.flatMap(({ execution }) => [
      execution.result,
      execution.raw_result,
    ]),
    ...exported.value.evidence_bundle.records.flatMap((record) => [
      record.normalized_result,
      record.raw_result,
    ]),
  ]) {
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    )
      throw new Error("Expected nested fixture result");
    Reflect.set(payload, "nested", [{ text: "changed" }]);
  }
  expect(JSON.stringify(exported.value)).toBe(changed);
  const fresh = cache.export(target, profile, bundle);
  if (!fresh.ok) throw fresh.error;
  expect(serializeAnalysisSnapshot(fresh.value)).toBe(expected);
});

it.each(["provider", "workflow"] as const)(
  "refreshes only the authenticated %s display dependency and preserves earlier snapshots",
  (kind) => {
    const cache = new AnalysisSnapshotCache();
    const ledger = new EvidenceLedger();
    const target = ANALYSIS_SNAPSHOT_TARGET;
    const profile = ANALYSIS_SNAPSHOT_PROFILE;
    const parameters = { address: "0x1000", document: "fixture" };
    const operation =
      kind === "provider" ? "procedure_info" : "analyze_function";
    const provider =
      kind === "provider" ? ANALYSIS_SNAPSHOT_PROVIDER : REA_WORKFLOW_PROVIDER;
    const evidenceProfile =
      kind === "provider" ? profile : workflowAnalysisProfile(profile);
    const dependencies = [1, 2].map((source) =>
      createEvidence(target, provider, {
        operation: "source",
        parameters: { source },
        result: source,
      }),
    );
    for (const dependency of dependencies)
      expect(ledger.record(dependency).ok).toBe(true);
    const evidence = createEvidence(target, provider, {
      operation,
      parameters,
      evidenceLinks: dependencies.map(({ evidence_id }) => evidence_id),
      result: "original",
      analysisProfile: evidenceProfile,
      confidence: kind === "provider" ? "observed" : "derived",
    });
    const execution = createAnalysisExecution("original", provider, {
      subject: target,
      analysisProfile: evidenceProfile,
    });
    if (kind === "provider")
      cache.record({ target, profile, operation, parameters, execution });
    else
      cache.recordWorkflow({
        target,
        profile,
        operation,
        parameters,
        execution: { ...execution, analysisProfile: evidenceProfile },
      });
    expect(ledger.record(evidence).ok).toBe(true);
    const before = cache.export(target, profile, ledger.export());
    if (!before.ok) throw before.error;
    const nameOnly = {
      ...evidence,
      subject:
        evidence.subject === null
          ? null
          : { ...evidence.subject, name: "display-only-name" },
    };
    const nameImport = ledger.import(createEvidenceBundle([nameOnly]));
    if (!nameImport.ok) throw nameImport.error;
    cache.refreshEvidenceMetadata(nameImport.value.replacements);
    expect(cache.entries()).toEqual(before.value.entries);
    expect(cache.workflowEntries()).toEqual(before.value.workflow_entries);
    // A different observation for this exact query is not the entry's dependency.
    const alternative = createEvidence(target, provider, {
      operation,
      parameters,
      result: "alternative",
      analysisProfile: evidenceProfile,
      confidence: kind === "provider" ? "observed" : "derived",
    });
    expect(ledger.record(alternative).ok).toBe(true);
    const relocate = (record: typeof evidence) => {
      if (record.subject === null) throw new Error("Expected fixture subject");
      return {
        ...record,
        subject: {
          ...record.subject,
          local_path: "/relocated/fixture",
          name: "renamed",
        },
      };
    };
    const foreign = ledger.import(
      createEvidenceBundle([relocate(alternative)]),
    );
    if (!foreign.ok) throw foreign.error;
    cache.refreshEvidenceMetadata(foreign.value.replacements);
    expect(cache.entries()).toEqual(before.value.entries);
    expect(cache.workflowEntries()).toEqual(before.value.workflow_entries);
    // A result may cite several observations; updating their envelopes does not change its payload.
    const dependentImport = ledger.import(
      createEvidenceBundle(dependencies.map(relocate)),
    );
    if (!dependentImport.ok) throw dependentImport.error;
    cache.refreshEvidenceMetadata(dependentImport.value.replacements);
    expect(cache.entries()).toEqual(before.value.entries);
    expect(cache.workflowEntries()).toEqual(before.value.workflow_entries);
    const relocated = relocate(evidence);
    const imported = ledger.import(createEvidenceBundle([relocated]));
    if (!imported.ok) throw imported.error;
    cache.refreshEvidenceMetadata(imported.value.replacements);
    const after = cache.export(target, profile, ledger.export());
    if (!after.ok) throw after.error;
    const entries =
      kind === "provider" ? after.value.entries : after.value.workflow_entries;
    expect(entries[0]?.execution.subject?.path).toBe("/relocated/fixture");
    expect(entries[0]?.execution.result).toBe("original");
    expect(after.value.evidence_bundle.records).toContainEqual(relocated);
    const originalEntries =
      kind === "provider"
        ? before.value.entries
        : before.value.workflow_entries;
    expect(originalEntries[0]?.execution.subject?.path).toBe(target.path);
  },
);

it.each(["provider", "workflow"] as const)(
  "exports target-scoped %s rows without changing retained observations",
  (kind) => {
    const cache = new AnalysisSnapshotCache();
    const ledger = new EvidenceLedger();
    const target = ANALYSIS_SNAPSHOT_TARGET;
    const profile = ANALYSIS_SNAPSHOT_PROFILE;
    const operation = kind === "provider" ? "procedure_info" : "trace_feature";
    const provider =
      kind === "provider" ? ANALYSIS_SNAPSHOT_PROVIDER : REA_WORKFLOW_PROVIDER;
    const analysisProfile =
      kind === "provider"
        ? profile
        : workflowAnalysisProfile(profile, operation);
    const child = { ...target, path: "/tmp/child", sha256: "b".repeat(64) };
    for (const [index, subject] of [target, null, child].entries()) {
      const parameters = { address: `0x${index}000` };
      const result = { observation: index };
      const execution = createAnalysisExecution(result, provider, {
        subject,
        analysisProfile,
      });
      const input = {
        target,
        profile,
        operation,
        parameters,
        execution: { ...execution, subject, analysisProfile },
      };
      if (kind === "provider")
        cache.record({ ...input, operation: "procedure_info" });
      else cache.recordWorkflow(input);
      expect(
        ledger.record(
          createEvidence(subject ?? undefined, provider, {
            operation,
            parameters,
            result,
            analysisProfile,
            confidence: kind === "provider" ? "observed" : "derived",
          }),
        ).ok,
      ).toBe(true);
    }
    const before =
      kind === "provider" ? cache.entries() : cache.workflowEntries();
    expect(before).toHaveLength(3);
    const evidence = ledger.export();
    const exported = cache.export(
      target,
      profile,
      evidenceBundleForTarget(evidence, target.sha256),
    );
    if (!exported.ok) throw exported.error;
    const snapshot = parseAnalysisSnapshot(
      JSON.parse(serializeAnalysisSnapshot(exported.value)),
    );
    const saved =
      kind === "provider" ? snapshot.entries : snapshot.workflow_entries;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.execution.subject?.sha256).toBe(target.sha256);
    expect(snapshot.evidence_bundle.records).toHaveLength(1);
    expect(
      kind === "provider" ? cache.entries() : cache.workflowEntries(),
    ).toEqual(before);
    expect(ledger.export()).toEqual(evidence);
    const restored = new AnalysisSnapshotCache();
    expect(restored.stage(snapshot)).toBe(1);
    expect(
      kind === "provider" ? restored.entries() : restored.workflowEntries(),
    ).toEqual(saved);
    if (kind === "provider") {
      expect(
        cache.lookup(target, profile, "procedure_info", { address: "0x1000" })
          ?.subject,
      ).toBeNull();
      expect(
        cache.lookup(target, profile, "procedure_info", { address: "0x2000" })
          ?.subject?.sha256,
      ).toBe(child.sha256);
    }
  },
);

it("counts newly retained direct and workflow bindings when staging", () => {
  const source = new AnalysisSnapshotCache();
  const target = ANALYSIS_SNAPSHOT_TARGET;
  const profile = ANALYSIS_SNAPSHOT_PROFILE;
  const parameters = { address: "0x1000" };
  const workflowProfile = workflowAnalysisProfile(profile, "trace_feature");
  source.record({
    target,
    profile,
    operation: "procedure_info",
    parameters,
    execution: createAnalysisExecution("direct", ANALYSIS_SNAPSHOT_PROVIDER, {
      subject: target,
      analysisProfile: profile,
    }),
  });
  source.recordWorkflow({
    target,
    profile,
    operation: "trace_feature",
    parameters: { query: "feature" },
    execution: {
      ...createAnalysisExecution("workflow", REA_WORKFLOW_PROVIDER, {
        subject: target,
      }),
      analysisProfile: workflowProfile,
    },
  });
  const bundle = createEvidenceBundle([
    createEvidence(target, ANALYSIS_SNAPSHOT_PROVIDER, {
      operation: "procedure_info",
      parameters,
      result: "direct",
      analysisProfile: profile,
    }),
    createEvidence(target, REA_WORKFLOW_PROVIDER, {
      operation: "trace_feature",
      confidence: "derived",
      parameters: { query: "feature" },
      result: "workflow",
      analysisProfile: workflowProfile,
    }),
  ]);
  const exported = source.export(target, profile, bundle);
  if (!exported.ok) throw exported.error;
  const snapshot = parseAnalysisSnapshot(
    JSON.parse(serializeAnalysisSnapshot(exported.value)),
  );
  expect(snapshot.entries).toHaveLength(1);
  expect(snapshot.workflow_entries).toHaveLength(1);

  const workflowOnly = new AnalysisSnapshotCache();
  expect(workflowOnly.stage({ ...snapshot, entries: [] })).toBe(1);
  expect(workflowOnly.workflowEntries()).toHaveLength(1);

  const staged = new AnalysisSnapshotCache();
  expect(staged.stage(snapshot)).toBe(2);
  expect(staged.entries()).toHaveLength(1);
  expect(staged.workflowEntries()).toHaveLength(1);
  expect(staged.stage(snapshot), "replacements are not new entries").toBe(0);
});

it("rebinds replayed target subjects while preserving child artifact subjects", () => {
  const cache = new AnalysisSnapshotCache();
  const target = ANALYSIS_SNAPSHOT_TARGET;
  const profile = ANALYSIS_SNAPSHOT_PROFILE;
  const relocatedTarget = { ...target, path: "/tmp/relocated-app" };
  const parameters = { address: "0x1000" };
  const locations = [{ kind: "address" as const, address: "0x1000" }];
  cache.record({
    target,
    profile,
    operation: "procedure_info",
    parameters,
    execution: createAnalysisExecution(
      { name: "main" },
      ANALYSIS_SNAPSHOT_PROVIDER,
      {
        subject: target,
        rawResult: { provider: "raw" },
        locations,
        analysisProfile: profile,
      },
    ),
  });

  const replayedTarget = cache.lookup(
    relocatedTarget,
    profile,
    "procedure_info",
    parameters,
  );
  expect(replayedTarget?.subject?.path).toBe(relocatedTarget.path);
  expect(replayedTarget?.rawResult).toEqual({ provider: "raw" });
  expect(replayedTarget?.locations).toEqual(locations);

  const childSubject = {
    path: "/tmp/child.zip",
    sha256: "b".repeat(64),
    format: "zip" as const,
  };
  const childParameters = { address: "0x2000" };
  cache.record({
    target,
    profile,
    operation: "procedure_info",
    parameters: childParameters,
    execution: createAnalysisExecution(
      { name: "child" },
      ANALYSIS_SNAPSHOT_PROVIDER,
      { subject: childSubject, analysisProfile: profile },
    ),
  });
  expect(
    cache.lookup(relocatedTarget, profile, "procedure_info", childParameters)
      ?.subject,
  ).toMatchObject(childSubject);
});

it("binds an omitted subject to the selected target in snapshot replay", () => {
  const cache = new AnalysisSnapshotCache();
  const target = ANALYSIS_SNAPSHOT_TARGET;
  const profile = ANALYSIS_SNAPSHOT_PROFILE;
  const relocatedTarget = { ...target, path: "/tmp/relocated-default-target" };
  const parameters = { address: "0x2a00" };
  const execution = createAnalysisExecution(
    { name: "default-bound" },
    ANALYSIS_SNAPSHOT_PROVIDER,
    { analysisProfile: profile },
  );
  expect(execution).not.toHaveProperty("subject");
  cache.record({
    target,
    profile,
    operation: "procedure_info",
    parameters,
    execution,
  });

  const snapshot = cache.export(
    target,
    profile,
    createEvidenceBundle([
      createEvidence(target, ANALYSIS_SNAPSHOT_PROVIDER, {
        operation: "procedure_info",
        parameters,
        result: { name: "default-bound" },
        analysisProfile: profile,
      }),
    ]),
  );
  if (!snapshot.ok) throw snapshot.error;
  expect(snapshot.value.entries[0]?.execution.subject?.path).toBe(target.path);
  const reparsed = parseAnalysisSnapshot(
    JSON.parse(serializeAnalysisSnapshot(snapshot.value)),
  );
  expect(reparsed.entries[0]?.execution.subject?.path).toBe(target.path);
  cache.clear();
  const imported = cache.import(
    reparsed,
    { target: relocatedTarget, profile },
    () => ok(0),
  );
  expect(imported.ok).toBe(true);
  expect(
    cache.lookup(relocatedTarget, profile, "procedure_info", parameters)
      ?.subject?.path,
  ).toBe(relocatedTarget.path);
});

it("preserves an explicitly unbound subject through snapshot replay", () => {
  const cache = new AnalysisSnapshotCache();
  const target = ANALYSIS_SNAPSHOT_TARGET;
  const profile = ANALYSIS_SNAPSHOT_PROFILE;
  const parameters = { address: "0x3000" };
  cache.record({
    target,
    profile,
    operation: "procedure_info",
    parameters,
    execution: createAnalysisExecution(
      { name: "unbound" },
      ANALYSIS_SNAPSHOT_PROVIDER,
      { subject: null, analysisProfile: profile },
    ),
  });

  expect(
    cache.lookup(
      { ...target, path: "/tmp/relocated-unbound-target" },
      profile,
      "procedure_info",
      parameters,
    )?.subject,
  ).toBeNull();
});

describe("analysis snapshot cache capacity", () => {
  it("shares capacity across query kinds while allowing replacements and fresh partitions", () => {
    const cache = new AnalysisSnapshotCache();
    const target = ANALYSIS_SNAPSHOT_TARGET;
    const profile = ANALYSIS_SNAPSHOT_PROFILE;
    const execution = {
      ...createAnalysisExecution("workflow", REA_WORKFLOW_PROVIDER, {
        subject: target,
      }),
      analysisProfile: workflowAnalysisProfile(profile),
    };
    const workflowInput = {
      target,
      profile,
      operation: "trace_feature",
      parameters: { query: "existing" },
      execution,
    };
    for (let index = 0; index < SNAPSHOT_CACHE_ENTRY_CEILING - 1; index += 1)
      cache.recordWorkflow({
        ...workflowInput,
        parameters: { query: String(index) },
      });
    // Staging and recording both spend the same budget; an existing query can
    // still be refreshed when no space remains for a new binding.
    const directInput = {
      target,
      profile,
      operation: "address_name" as const,
      parameters: { address: "0x1000", document: "fixture" },
      execution: createAnalysisExecution(
        "initial",
        ANALYSIS_SNAPSHOT_PROVIDER,
        { subject: target, analysisProfile: profile },
      ),
    };
    cache.record(directInput);
    cache.record({
      ...directInput,
      parameters: { address: "0x2000", document: "fixture" },
    });
    cache.recordWorkflow(workflowInput);
    expect(cache.entries()).toHaveLength(1);
    expect(cache.workflowEntries()).toHaveLength(
      SNAPSHOT_CACHE_ENTRY_CEILING - 1,
    );

    cache.record({
      ...directInput,
      execution: { ...directInput.execution, result: "updated" },
    });
    cache.recordWorkflow({
      ...workflowInput,
      parameters: { query: "0" },
      execution: { ...execution, result: "updated" },
    });
    expect(
      cache.lookup(target, profile, "address_name", directInput.parameters)
        ?.result,
    ).toBe("updated");
    expect(
      cache.workflowEntries().find(({ parameters }) => parameters.query === "0")
        ?.execution.result,
    ).toBe("updated");

    const incoming = createAnalysisSnapshotWorkflowEntry({
      ...workflowInput,
      target: snapshotTarget(target),
      binding: snapshotBinding(profile),
    });
    const evidence = createEvidence(target, REA_WORKFLOW_PROVIDER, {
      operation: workflowInput.operation,
      confidence: "derived",
      parameters: workflowInput.parameters,
      result: execution.result,
      rawResult: execution.rawResult,
      analysisProfile: execution.analysisProfile,
      limitations: execution.limitations,
      locations: execution.locations,
    });
    expect(
      cache.stage(
        parseAnalysisSnapshot({
          target: snapshotTarget(target),
          binding: snapshotBinding(profile),
          entries: [],
          workflow_entries: [incoming],
          evidence_bundle: createEvidenceBundle([evidence]),
        }),
      ),
      "a capacity-refused workflow binding is not counted",
    ).toBe(0);
    expect(cache.workflowEntries()).toHaveLength(
      SNAPSHOT_CACHE_ENTRY_CEILING - 1,
    );

    const otherTarget = { ...target, sha256: "b".repeat(64) };
    cache.recordWorkflow({
      ...workflowInput,
      target: otherTarget,
      execution: { ...execution, subject: otherTarget },
    });
    expect(cache.entries()).toEqual([]);
    expect(cache.workflowEntries()).toHaveLength(1);
    cache.clear();
    cache.record({
      ...directInput,
      target: otherTarget,
      execution: { ...directInput.execution, subject: otherTarget },
    });
    expect(cache.entries()).toHaveLength(1);
    expect(cache.workflowEntries()).toEqual([]);
  });
});

describe("analysis snapshot cache policy", () => {
  it.each<{
    policy?: CapabilityDescriptor["cachePolicy"];
    operation?: CapabilityDescriptor["operation"];
    effects?: Partial<CapabilityDescriptor["effects"]>;
    parameters?: Record<string, string>;
    cacheable: boolean;
  }>([
    { cacheable: false },
    { policy: "snapshot", cacheable: true },
    { policy: "live", cacheable: false },
    {
      policy: "live",
      effects: { mayWriteFilesystem: false },
      cacheable: false,
    },
    {
      policy: "snapshot",
      effects: { mutatesArtifact: true },
      cacheable: false,
    },
    {
      policy: "snapshot",
      effects: { changesPermissions: true },
      cacheable: false,
    },
    {
      policy: "snapshot",
      operation: "decode_interface_builder",
      cacheable: false,
    },
    {
      policy: "snapshot",
      operation: "inspect_asset_catalog",
      cacheable: false,
    },
    {
      policy: "snapshot",
      operation: "inspect_keyed_archive",
      cacheable: false,
    },
    {
      policy: "snapshot",
      operation: "trace_dylib_resolution",
      cacheable: false,
    },
    { policy: "snapshot", operation: "list_documents", cacheable: false },
    { policy: "snapshot", operation: "list_strings", cacheable: false },
    {
      policy: "snapshot",
      operation: "address_name",
      parameters: { document: "fixture" },
      cacheable: false,
    },
  ])(
    "keeps explicit cache policy within immutable and state-independent boundaries: %j",
    ({
      policy,
      operation = "analyze_function",
      effects,
      parameters = {},
      cacheable,
    }) => {
      const descriptor: CapabilityDescriptor = {
        provider: ANALYSIS_SNAPSHOT_PROVIDER,
        operation,
        available: true,
        reason: null,
        ...(policy === undefined ? {} : { cachePolicy: policy }),
        effects: {
          mutatesArtifact: false,
          launchesProcess: true,
          mayShowUi: false,
          mayAccessNetwork: false,
          mayWriteFilesystem: true,
          changesPermissions: false,
          requiresRoot: false,
          ...effects,
        },
        limitations: [],
      };
      expect(isSnapshotCacheable(operation, descriptor, parameters)).toBe(
        cacheable,
      );
    },
  );

  it("retains caller observations without a document while refusing to replay them", () => {
    const descriptor: CapabilityDescriptor = {
      operation: "procedure_callers",
      provider: ANALYSIS_SNAPSHOT_PROVIDER,
      available: true,
      reason: null,
      effects: {
        mutatesArtifact: false,
        launchesProcess: false,
        mayShowUi: false,
        mayAccessNetwork: false,
        mayWriteFilesystem: false,
        changesPermissions: false,
        requiresRoot: false,
      },
      limitations: [],
    };
    const parameters = { procedure: "0x1000" };
    expect(
      isSourceEvidenceRetainable("procedure_callers", descriptor, parameters),
    ).toBe(true);
    expect(
      isSnapshotCacheable("procedure_callers", descriptor, parameters),
    ).toBe(false);
    expect(
      isSnapshotCacheable("procedure_callers", descriptor, {
        ...parameters,
        document: "fixture",
      }),
    ).toBe(true);
    const callees = { ...descriptor, operation: "procedure_callees" as const };
    expect(
      isSourceEvidenceRetainable("procedure_callees", callees, parameters),
    ).toBe(true);
    const pseudocode = {
      ...descriptor,
      operation: "procedure_pseudo_code" as const,
    };
    expect(
      isSourceEvidenceRetainable(
        "procedure_pseudo_code",
        pseudocode,
        parameters,
      ),
    ).toBe(false);
    expect(
      isSourceEvidenceRetainable("procedure_pseudo_code", pseudocode, {
        ...parameters,
        document: "fixture",
      }),
    ).toBe(true);
  });
});

describe("analysis snapshot cache partitioning", () => {
  it.each<{
    operation: Exclude<AnalysisOperation, "health">;
    parameters: Record<string, string>;
    cacheable: boolean;
  }>([
    { operation: "list_strings", parameters: {}, cacheable: false },
    {
      operation: "list_strings",
      parameters: { document: "fixture" },
      cacheable: true,
    },
    {
      operation: "address_name",
      parameters: { document: "fixture" },
      cacheable: false,
    },
    {
      operation: "address_name",
      parameters: { document: "fixture", address: "0x1000" },
      cacheable: true,
    },
    { operation: "binary_overview", parameters: {}, cacheable: true },
  ])(
    "retains explicit document and cursor requirements for $operation",
    ({ operation, parameters, cacheable }) => {
      const descriptor: CapabilityDescriptor = {
        operation,
        provider: ANALYSIS_SNAPSHOT_PROVIDER,
        available: true,
        reason: null,
        effects: {
          mutatesArtifact: false,
          launchesProcess: false,
          mayShowUi: false,
          mayAccessNetwork: false,
          mayWriteFilesystem: false,
          changesPermissions: false,
          requiresRoot: false,
        },
        limitations: [],
      };
      expect(isSnapshotCacheable(operation, descriptor, parameters)).toBe(
        cacheable,
      );
    },
  );

  it("returns detached data only from the exact provider/profile partition", () => {
    const cache = new AnalysisSnapshotCache();
    const execution = createAnalysisExecution(
      "main",
      ANALYSIS_SNAPSHOT_PROVIDER,
      {
        analysisProfile: ANALYSIS_SNAPSHOT_PROFILE,
        rawResult: "main",
        subject: {
          path: ANALYSIS_SNAPSHOT_TARGET.path,
          sha256: ANALYSIS_SNAPSHOT_TARGET.sha256,
          format: ANALYSIS_SNAPSHOT_TARGET.format,
          ...(ANALYSIS_SNAPSHOT_TARGET.architecture === undefined
            ? {}
            : { architecture: ANALYSIS_SNAPSHOT_TARGET.architecture }),
        },
      },
    );
    cache.record({
      target: ANALYSIS_SNAPSHOT_TARGET,
      profile: ANALYSIS_SNAPSHOT_PROFILE,
      operation: "address_name",
      parameters: { address: "0x1000", document: "fixture" },
      execution,
    });
    const evidence = createEvidence(
      ANALYSIS_SNAPSHOT_TARGET,
      ANALYSIS_SNAPSHOT_PROVIDER,
      {
        operation: "address_name",
        parameters: { address: "0x1000", document: "fixture" },
        result: "main",
        rawResult: "main",
        analysisProfile: ANALYSIS_SNAPSHOT_PROFILE,
      },
    );
    const exported = cache.export(
      ANALYSIS_SNAPSHOT_TARGET,
      ANALYSIS_SNAPSHOT_PROFILE,
      createEvidenceBundle([evidence]),
    );
    if (!exported.ok) throw exported.error;
    const tampered = structuredClone(exported.value);
    const tamperedEntry = tampered.entries[0];
    if (tamperedEntry === undefined)
      throw new Error("exported snapshot entry missing");
    tamperedEntry.execution.result = "changed without Evidence";
    let mergedEvidence = false;
    expect(
      new AnalysisSnapshotCache().import(tampered, undefined, () => {
        mergedEvidence = true;
        return ok(0);
      }).ok,
    ).toBe(false);
    expect(mergedEvidence).toBe(false);
    const entry = exported.value.entries[0];
    if (entry === undefined) throw new Error("exported snapshot entry missing");
    Reflect.set(entry.execution, "provider", {
      id: "forged",
      name: "Forged",
      version: "9",
    });
    entry.execution.limitations.push("forged");

    expect(
      cache.lookup(
        ANALYSIS_SNAPSHOT_TARGET,
        ANALYSIS_SNAPSHOT_PROFILE,
        "address_name",
        { address: "0x1000", document: "fixture" },
      ),
    ).toMatchObject({
      provider: ANALYSIS_SNAPSHOT_PROVIDER,
      analysisProfile: ANALYSIS_SNAPSHOT_PROFILE,
      limitations: [expect.stringContaining("local REA analysis snapshot")],
    });
    const changedProfile = createAnalysisProfile(ANALYSIS_SNAPSHOT_PROVIDER, {
      loader: "configured-override",
    });
    expect(
      cache.lookup(ANALYSIS_SNAPSHOT_TARGET, changedProfile, "address_name", {
        address: "0x1000",
        document: "fixture",
      }),
    ).toBeUndefined();
    const changedProviderProfile = createAnalysisProfile(
      { id: "other", name: "Other", version: "1" },
      { loader: "mach-o-arm64" },
    );
    expect(
      cache.lookup(
        ANALYSIS_SNAPSHOT_TARGET,
        changedProviderProfile,
        "address_name",
        { address: "0x1000", document: "fixture" },
      ),
    ).toBeUndefined();
  });
});

const createRelationshipCoverageSnapshot = (
  relationshipCoverage?: RelationshipCoverage,
) => {
  const operation = "procedure_callees" as const;
  const parameters = { procedure: "0x1000", document: "fixture" };
  const cache = new AnalysisSnapshotCache();
  const execution = createAnalysisExecution(
    ["0x2000"],
    ANALYSIS_SNAPSHOT_PROVIDER,
    {
      analysisProfile: ANALYSIS_SNAPSHOT_PROFILE,
      rawResult: ["0x2000"],
      subject: ANALYSIS_SNAPSHOT_TARGET,
      ...(relationshipCoverage === undefined ? {} : { relationshipCoverage }),
    },
  );
  cache.record({
    target: ANALYSIS_SNAPSHOT_TARGET,
    profile: ANALYSIS_SNAPSHOT_PROFILE,
    operation,
    parameters,
    execution,
  });
  const evidence = createEvidence(
    ANALYSIS_SNAPSHOT_TARGET,
    ANALYSIS_SNAPSHOT_PROVIDER,
    {
      operation,
      parameters,
      result: ["0x2000"],
      rawResult: ["0x2000"],
      analysisProfile: ANALYSIS_SNAPSHOT_PROFILE,
      ...(relationshipCoverage === undefined ? {} : { relationshipCoverage }),
    },
  );
  const exported = cache.export(
    ANALYSIS_SNAPSHOT_TARGET,
    ANALYSIS_SNAPSHOT_PROFILE,
    createEvidenceBundle([evidence]),
  );
  if (!exported.ok) throw exported.error;
  return { cache, operation, parameters, snapshot: exported.value };
};

describe("relationship coverage snapshot replay", () => {
  it("authenticates coverage and rejects missing serialized fields", () => {
    const coverage: RelationshipCoverage = {
      status: "complete",
      diagnostics: ["The provider retained an unresolved call target."],
    };
    const { cache, operation, parameters, snapshot } =
      createRelationshipCoverageSnapshot(coverage);
    expect(
      cache.lookup(
        ANALYSIS_SNAPSHOT_TARGET,
        ANALYSIS_SNAPSHOT_PROFILE,
        operation,
        parameters,
      )?.relationshipCoverage,
    ).toEqual(coverage);

    const tampered = structuredClone(snapshot);
    const tamperedEntry = tampered.entries[0];
    if (tamperedEntry === undefined) throw new Error("snapshot entry missing");
    tamperedEntry.execution.relationship_coverage = {
      status: "complete",
      diagnostics: ["forged coverage"],
    };
    expect(
      new AnalysisSnapshotCache().import(tampered, undefined, () => ok(0)).ok,
    ).toBe(false);

    const missingCoverage = structuredClone(snapshot);
    const missingCoverageEntry = missingCoverage.entries[0];
    if (missingCoverageEntry === undefined)
      throw new Error("snapshot entry missing");
    Reflect.deleteProperty(
      missingCoverageEntry.execution,
      "relationship_coverage",
    );
    const missingCoverageEvidence = missingCoverage.evidence_bundle.records[0];
    if (missingCoverageEvidence === undefined)
      throw new Error("snapshot Evidence missing");
    Reflect.deleteProperty(missingCoverageEvidence, "relationship_coverage");
    expect(() => parseAnalysisSnapshot(missingCoverage)).toThrow();
    expect(
      new AnalysisSnapshotCache().import(missingCoverage, undefined, () =>
        ok(0),
      ).ok,
    ).toBe(false);
  });

  it("replays absent coverage as explicitly unknown", () => {
    const { operation, parameters, snapshot } =
      createRelationshipCoverageSnapshot();
    expect(snapshot.entries[0]?.execution.relationship_coverage).toBeNull();
    expect(
      snapshot.evidence_bundle.records[0]?.relationship_coverage,
    ).toBeNull();

    const replayCache = new AnalysisSnapshotCache();
    expect(replayCache.import(snapshot, undefined, () => ok(0)).ok).toBe(true);
    expect(
      replayCache.lookup(
        ANALYSIS_SNAPSHOT_TARGET,
        ANALYSIS_SNAPSHOT_PROFILE,
        operation,
        parameters,
      )?.relationshipCoverage,
    ).toEqual({
      status: "unknown",
      reason: "Snapshot entry does not report relationship coverage.",
    });
  });
});

it("does not replay pre-envelope call graphs under the revised workflow profile", () => {
  const cache = new AnalysisSnapshotCache();
  const target = ANALYSIS_SNAPSHOT_TARGET;
  const profile = ANALYSIS_SNAPSHOT_PROFILE;
  const operation = "get_call_graph" as const;
  const parameters = { address: "0x1000", direction: "forward" };
  const oldProfile = workflowAnalysisProfile(profile);
  const revisedProfile = workflowAnalysisProfile(profile, operation);
  const oldResult = { "0": [] };
  cache.recordWorkflow({
    target,
    profile,
    operation,
    parameters,
    execution: {
      ...createAnalysisExecution(oldResult, REA_WORKFLOW_PROVIDER, {
        subject: target,
        rawResult: oldResult,
      }),
      analysisProfile: oldProfile,
    },
  });
  const evidence = createEvidence(target, REA_WORKFLOW_PROVIDER, {
    operation,
    confidence: "derived",
    parameters,
    result: oldResult,
    rawResult: oldResult,
    analysisProfile: oldProfile,
  });
  const exported = cache.export(
    target,
    profile,
    createEvidenceBundle([evidence]),
  );
  if (!exported.ok) throw exported.error;
  const snapshot = parseAnalysisSnapshot(exported.value);

  expect(
    snapshotEvidenceForQuery(snapshot, {
      target,
      bindingProfile: profile,
      operation,
      parameters,
      provider: REA_WORKFLOW_PROVIDER,
      evidenceProfile: revisedProfile,
    }),
  ).toBeUndefined();
  expect(
    enhancedOutputSchemas.get_call_graph.safeParse({
      normalized_result: oldResult,
    }).success,
  ).toBe(false);
});

it("declines source-bearing snapshot entries while replaying omitted and empty source controls", () => {
  const cache = new AnalysisSnapshotCache();
  const target = ANALYSIS_SNAPSHOT_TARGET;
  const profile = ANALYSIS_SNAPSHOT_PROFILE;
  const source = createEvidence(target, ANALYSIS_SNAPSHOT_PROVIDER, {
    operation: "source",
    parameters: {},
    result: "observed source",
  });
  const parameters = { address: "0x1000", document: "fixture" };
  cache.record({
    target,
    profile,
    operation: "procedure_info",
    parameters,
    execution: createAnalysisExecution(
      "parent observation",
      ANALYSIS_SNAPSHOT_PROVIDER,
      {
        subject: target,
        analysisProfile: profile,
        sourceEvidence: [source],
      },
    ),
  });
  expect(
    cache.lookup(target, profile, "procedure_info", parameters),
  ).toBeUndefined();
  expect(cache.entries()).toEqual([]);

  for (const sourceEvidence of [undefined, []] as const) {
    const control = {
      address: sourceEvidence === undefined ? "0x2000" : "0x3000",
      document: "fixture",
    };
    cache.record({
      target,
      profile,
      operation: "procedure_info",
      parameters: control,
      execution: createAnalysisExecution(
        "source-free observation",
        ANALYSIS_SNAPSHOT_PROVIDER,
        {
          subject: target,
          analysisProfile: profile,
          ...(sourceEvidence === undefined ? {} : { sourceEvidence }),
        },
      ),
    });
    expect(
      cache.lookup(target, profile, "procedure_info", control)?.result,
    ).toBe("source-free observation");
  }
  expect(cache.entries()).toHaveLength(2);
});

describe("executions that report truncated references", () => {
  const record = (referencesTruncated: boolean | undefined) => {
    const cache = new AnalysisSnapshotCache();
    const parameters = { address: "0x1000", document: "fixture" };
    cache.record({
      target: ANALYSIS_SNAPSHOT_TARGET,
      profile: ANALYSIS_SNAPSHOT_PROFILE,
      operation: "xrefs",
      parameters,
      execution: createAnalysisExecution(
        ["0x2000"],
        ANALYSIS_SNAPSHOT_PROVIDER,
        {
          subject: ANALYSIS_SNAPSHOT_TARGET,
          analysisProfile: ANALYSIS_SNAPSHOT_PROFILE,
          ...(referencesTruncated === undefined ? {} : { referencesTruncated }),
        },
      ),
    });
    return cache.lookup(
      ANALYSIS_SNAPSHOT_TARGET,
      ANALYSIS_SNAPSHOT_PROFILE,
      "xrefs",
      parameters,
    );
  };

  it("are not replayed, because a replay would lose the truncation", () => {
    expect(record(true)).toBeUndefined();
  });

  it("do not stop an execution that is complete or silent from being replayed", () => {
    expect(record(false)?.result).toEqual(["0x2000"]);
    expect(record(undefined)?.result).toEqual(["0x2000"]);
  });
});

it("revises the trace_feature workflow profile so earlier results are not replayed", () => {
  const profile = ANALYSIS_SNAPSHOT_PROFILE;

  expect(workflowAnalysisProfile(profile, "trace_feature")).not.toEqual(
    workflowAnalysisProfile(profile),
  );
  expect(
    workflowAnalysisProfile(profile, "trace_call_path"),
    "other workflows keep their profile",
  ).toEqual(workflowAnalysisProfile(profile));
});
