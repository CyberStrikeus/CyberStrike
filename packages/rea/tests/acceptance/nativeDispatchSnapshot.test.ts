import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { toolContract } from "../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { readAnalysisSnapshot } from "../../src/application/binary/AnalysisSnapshotFiles.js";
import { workflowAnalysisProfile } from "../../src/application/WorkflowAnalysisProfile.js";
import { APPLE_DISPATCH_METADATA_ANALYSIS_PROFILE } from "../../src/native/NativeMacOSProviderMetadata.js";
import {
  CPU,
  machoImage,
} from "../../src/artifacts/apple/MachoImage.fixture.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";
import { nativeObjcClassImportMachO } from "../fixtures/nativeObjcClassImportMachO.js";
import { objcRecordBudgetMacho } from "../fixtures/objcRecordBudgetMacho.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";

cliTest.skipIf(process.platform !== "darwin")(
  "restores the exact profileless workflow commitment after a rejected snapshot switch",
  async () => {
    const root = await createTestTempDirectory("rea-native-snapshot-restore-");
    const first = join(root, "first.macho");
    const second = join(root, "second.macho");
    const saved = join(root, "before.json");
    const conflicting = join(root, "conflicting.json");
    const after = join(root, "after.json");
    const bytes = machoImage({ cpu: CPU.arm64, commands: [] });
    await Promise.all([writeFile(first, bytes), writeFile(second, bytes)]);
    const { call } = await connectLocalToolsMcp({
      PATH: process.env.PATH ?? "",
      REA_ANALYSIS_PROVIDER: "auto",
      HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
      GHIDRA_INSTALL_DIR: "/rea-unconfigured-deep-provider/ghidra",
      JAVA_HOME: "/rea-unconfigured-deep-provider/java",
      REA_IDA_MCP_CONFIG: "/rea-unconfigured-deep-provider/ida-mcp.json",
      REA_KUNA_COMMAND: "/rea-unconfigured-deep-provider/kuna",
      REA_KUNA_CACHE_DIR: "/rea-unconfigured-deep-provider/kuna-cache",
    });
    const good = async (name: string, arguments_: Record<string, unknown>) => {
      const result = await call(name, arguments_);
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return result;
    };
    const unknown = {
      question: "Does this function reach the network?",
      domain: "network",
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      required_authority: "shipped-artifact",
      required_confidence: "observed",
      required_environment: null,
      recommended_probes: [
        { operation: "analyze_function", rationale: "Inspect its callers." },
      ],
      relationships: [],
    };
    await good("open_binary", { path: second });
    await good("inspect_native_dispatch_metadata", { max_records: 100 });
    await good("record_unknown", { ...unknown, severity: "high" });
    await good("close_binary", { snapshot_path: conflicting, overwrite: true });
    await good("open_binary", { path: first });
    const original = parseEvidence(
      (await good("inspect_native_dispatch_metadata", { max_records: 100 }))
        .structuredContent,
    );
    expect(original.analysis_profile).toEqual(
      workflowAnalysisProfile(
        APPLE_DISPATCH_METADATA_ANALYSIS_PROFILE,
        "inspect_native_dispatch_metadata",
      ),
    );
    await good("record_unknown", { ...unknown, severity: "medium" });
    await good("close_binary", { snapshot_path: saved, overwrite: true });
    const savedSnapshot = await readAnalysisSnapshot(saved);
    if (!savedSnapshot.ok) throw savedSnapshot.error;
    expect(savedSnapshot.value.binding.analysis_profile).toEqual(
      APPLE_DISPATCH_METADATA_ANALYSIS_PROFILE,
    );
    expect(
      savedSnapshot.value.workflow_entries[0]?.execution.analysis_profile,
    ).toEqual(original.analysis_profile);
    await good("open_binary", { path: first, snapshot_path: saved });
    const rejected = await call("open_binary", {
      path: second,
      snapshot_path: conflicting,
    });
    expect(parseMcpToolError(rejected)).toMatchObject({
      error: {
        code: "evidence_integrity_mismatch",
        details: { reason: "Conflicting unknown revision" },
      },
    });
    expect((await good("binary_session", {})).structuredContent).toMatchObject({
      result: { open: true, path: first },
    });
    const observed = parseEvidence(
      (await good("inspect_native_dispatch_metadata", { max_records: 1 }))
        .structuredContent,
    );
    expect(observed.analysis_profile).toEqual(original.analysis_profile);
    await good("open_binary", { path: first, snapshot_path: saved });
    await good("close_binary", { snapshot_path: after, overwrite: true });
    const snapshot = await readAnalysisSnapshot(after);
    if (!snapshot.ok) throw snapshot.error;
    expect(snapshot.value.binding.analysis_profile).toEqual(
      savedSnapshot.value.binding.analysis_profile,
    );
    expect(
      snapshot.value.workflow_entries[0]?.execution.analysis_profile,
    ).toEqual(
      savedSnapshot.value.workflow_entries[0]?.execution.analysis_profile,
    );
    expect(Buffer.compare(await readFile(first), Buffer.from(bytes))).toBe(0);
    expect(Buffer.compare(await readFile(second), Buffer.from(bytes))).toBe(0);
  },
  30000,
);

cliTest.skipIf(process.platform !== "darwin")(
  "preserves ambiguous encoded method implementations through the public CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-objc-method-candidates-");
    const target = join(root, "methods.macho");
    const bytes = objcRecordBudgetMacho("class", [0x700, 0x720]);
    await writeFile(target, bytes);
    const environment = {
      PATH: process.env.PATH ?? "",
      REA_ANALYSIS_PROVIDER: "auto",
      HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
      GHIDRA_INSTALL_DIR: "/rea-unconfigured-deep-provider/ghidra",
      JAVA_HOME: "/rea-unconfigured-deep-provider/java",
      REA_IDA_MCP_CONFIG: "/rea-unconfigured-deep-provider/ida-mcp.json",
      REA_KUNA_COMMAND: "/rea-unconfigured-deep-provider/kuna",
      REA_KUNA_CACHE_DIR: "/rea-unconfigured-deep-provider/kuna-cache",
      REA_LOG_LEVEL: "silent",
    };
    const result = await cli.run({
      arguments: ["inspect-native-dispatch-metadata", target, "--json"],
      environment,
    });
    expect(
      result.exitCode,
      `${result.stderr}\n${JSON.stringify(result.json)}`,
    ).toBe(0);
    const cliEvidence = toolContract(
      "inspect_native_dispatch_metadata",
    ).outputSchema.parse(result.json);
    const { client, call } = await connectLocalToolsMcp(environment);
    const opened = await call("open_binary", { path: target });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const inspected = await call("inspect_native_dispatch_metadata", {});
    expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
    const mcpEvidence = parseEvidence(inspected.structuredContent);
    for (const evidence of [cliEvidence, mcpEvidence]) {
      expect(evidence.normalized_result).toMatchObject({
        result: {
          objc_classes: [
            {
              name: "FixtureClass",
              methods: [{ selector: "classMethod", address: null }],
            },
          ],
          objc_dispatch_implementations: [
            { selector: "classMethod", implementation_address: "0x100000700" },
            { selector: "classMethod", implementation_address: "0x100000720" },
          ],
        },
      });
    }
    expect(Buffer.compare(await readFile(target), bytes)).toBe(0);
    await client.ping();
  },
  30000,
);

cliTest.skipIf(process.platform !== "darwin")(
  "retains and reopens profileless native dispatch workflow snapshots through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-native-dispatch-snapshot-");
    const target = join(root, "minimal.macho");
    const cliSnapshot = join(root, "cli-snapshot.json");
    const mcpSnapshot = join(root, "mcp-snapshot.json");
    const bytes = machoImage({ cpu: CPU.arm64, commands: [] });
    await writeFile(target, bytes);
    const isolatedProviderEnvironment = {
      PATH: process.env.PATH ?? "",
      REA_ANALYSIS_PROVIDER: "auto",
      HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
      GHIDRA_INSTALL_DIR: "/rea-unconfigured-deep-provider/ghidra",
      JAVA_HOME: "/rea-unconfigured-deep-provider/java",
      REA_IDA_MCP_CONFIG: "/rea-unconfigured-deep-provider/ida-mcp.json",
      REA_KUNA_COMMAND: "/rea-unconfigured-deep-provider/kuna",
      REA_KUNA_CACHE_DIR: "/rea-unconfigured-deep-provider/kuna-cache",
    };

    const cliArguments = [
      "inspect-native-dispatch-metadata",
      target,
      "--snapshot",
      cliSnapshot,
      "--json",
    ];
    const firstCli = await cli.run({
      arguments: cliArguments,
      environment: isolatedProviderEnvironment,
    });
    expect(firstCli.exitCode, firstCli.stderr).toBe(0);
    const cliEvidence = toolContract(
      "inspect_native_dispatch_metadata",
    ).outputSchema.parse(firstCli.json);
    expect(cliEvidence.caller_input_path).toBe(target);
    const cliSaved = await readAnalysisSnapshot(cliSnapshot);
    if (!cliSaved.ok) throw cliSaved.error;
    expect(cliSaved.value.binding.analysis_profile).toEqual(
      APPLE_DISPATCH_METADATA_ANALYSIS_PROFILE,
    );
    expect(cliSaved.value.entries).toEqual([]);
    expect(cliSaved.value.workflow_entries).toHaveLength(1);
    expect(
      cliSaved.value.evidence_bundle.records.find(
        (record) => record.evidence_id === cliEvidence.evidence_id,
      )?.caller_input_path,
    ).toBe(target);
    const savedQueryId = cliSaved.value.workflow_entries[0]?.query_id;
    const replayCli = await cli.run({
      arguments: [
        "inspect-native-dispatch-metadata",
        "minimal.macho",
        "--snapshot",
        cliSnapshot,
        "--json",
      ],
      cwd: root,
      environment: isolatedProviderEnvironment,
    });
    expect(replayCli.exitCode, replayCli.stderr).toBe(0);
    const replayEvidence = toolContract(
      "inspect_native_dispatch_metadata",
    ).outputSchema.parse(replayCli.json);
    expect(replayEvidence).toEqual({
      ...cliEvidence,
      caller_input_path: "minimal.macho",
    });
    const replaySaved = await readAnalysisSnapshot(cliSnapshot);
    if (!replaySaved.ok) throw replaySaved.error;
    expect(replaySaved.value.workflow_entries[0]?.query_id).toBe(savedQueryId);
    expect(replaySaved.value.workflow_entries[0]?.parameters).toEqual(
      cliSaved.value.workflow_entries[0]?.parameters,
    );
    expect(
      replaySaved.value.evidence_bundle.records.find(
        (record) => record.evidence_id === cliEvidence.evidence_id,
      )?.caller_input_path,
    ).toBe(target);
    const changedLimitCli = await cli.run({
      arguments: [...cliArguments, "--max-records", "1"],
      environment: isolatedProviderEnvironment,
    });
    expect(changedLimitCli.exitCode, changedLimitCli.stderr).toBe(0);
    const changedLimitEvidence = parseEvidence(changedLimitCli.json);
    expect(changedLimitEvidence.parameters.max_records).toBe(1);
    expect(changedLimitEvidence.evidence_id).not.toBe(cliEvidence.evidence_id);
    const changedLimitSnapshot = await readAnalysisSnapshot(cliSnapshot);
    if (!changedLimitSnapshot.ok) throw changedLimitSnapshot.error;
    expect(changedLimitSnapshot.value.workflow_entries).toHaveLength(2);

    const { client, call } = await connectLocalToolsMcp(
      isolatedProviderEnvironment,
    );
    const opened = await call("open_binary", { path: target });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const firstMcp = await call("inspect_native_dispatch_metadata", {
      max_records: 100,
    });
    expect(firstMcp.isError, JSON.stringify(firstMcp)).not.toBe(true);
    const mcpEvidence = parseEvidence(firstMcp.structuredContent);
    expect(mcpEvidence).not.toHaveProperty("caller_input_path");
    const closed = await call("close_binary", {
      snapshot_path: mcpSnapshot,
      overwrite: true,
    });
    expect(closed.isError, JSON.stringify(closed)).not.toBe(true);
    const mcpSaved = await readAnalysisSnapshot(mcpSnapshot);
    if (!mcpSaved.ok) throw mcpSaved.error;
    expect(mcpSaved.value.binding.analysis_profile).toEqual(
      APPLE_DISPATCH_METADATA_ANALYSIS_PROFILE,
    );
    expect(mcpSaved.value.entries).toEqual([]);
    expect(mcpSaved.value.workflow_entries).toHaveLength(1);
    expect(mcpSaved.value.evidence_bundle.records[0]).not.toHaveProperty(
      "caller_input_path",
    );

    const reopened = await call("open_binary", {
      path: target,
      snapshot_path: mcpSnapshot,
    });
    expect(reopened.isError, JSON.stringify(reopened)).not.toBe(true);
    const reobserved = await call("inspect_native_dispatch_metadata", {
      max_records: 100,
    });
    expect(reobserved.isError, JSON.stringify(reobserved)).not.toBe(true);
    expect(parseEvidence(reobserved.structuredContent)).toEqual(mcpEvidence);
    expect(Buffer.compare(await readFile(target), Buffer.from(bytes))).toBe(0);
    await client.ping();
  },
  30000,
);

cliTest.skipIf(process.platform !== "darwin")(
  "reports exact Objective-C class imports through the compiled native MCP adapter",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-objc-import-mcp-");
    const target = join(root, "class-import.macho");
    const fixture = nativeObjcClassImportMachO();
    await writeFile(target, fixture.bytes);
    const environment = {
      PATH: process.env.PATH ?? "",
      REA_ANALYSIS_PROVIDER: "auto",
      HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
      GHIDRA_INSTALL_DIR: "/rea-unconfigured-deep-provider/ghidra",
      JAVA_HOME: "/rea-unconfigured-deep-provider/java",
      REA_IDA_MCP_CONFIG: "/rea-unconfigured-deep-provider/ida-mcp.json",
      REA_KUNA_COMMAND: "/rea-unconfigured-deep-provider/kuna",
      REA_KUNA_CACHE_DIR: "/rea-unconfigured-deep-provider/kuna-cache",
      REA_LOG_LEVEL: "silent",
    };

    const cliResult = await cli.run({
      arguments: ["inspect-native-dispatch-metadata", target, "--json"],
      environment,
    });
    expect(cliResult.exitCode, cliResult.stderr).toBe(0);
    const cliEvidence = toolContract(
      "inspect_native_dispatch_metadata",
    ).outputSchema.parse(cliResult.json);
    expect(cliEvidence.normalized_result).toMatchObject({
      result: {
        target_selection: {
          container: "thin",
          offset: 0,
          cpu_type: CPU.arm64.type,
          cpu_subtype: CPU.arm64.subtype,
        },
      },
    });

    const { client, call } = await connectLocalToolsMcp(environment);
    const opened = await call("open_binary", { path: target });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const inspected = await call("inspect_native_dispatch_metadata", {
      max_records: 100,
      objc_class_import_addresses: [fixture.address, fixture.unboundAddress],
      objc_class_import_addresses_complete: true,
    });
    expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
    const evidence = parseEvidence(inspected.structuredContent);
    expect(evidence.normalized_result).toMatchObject({
      target_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      target_architecture: "arm64",
      provider: { id: "native-macos" },
      result: {
        target_selection: {
          container: "thin",
          offset: 0,
          cpu_type: CPU.arm64.type,
          cpu_subtype: CPU.arm64.subtype,
        },
        objc_class_import_bindings: [
          {
            requested_address: fixture.address,
            symbol: "_OBJC_CLASS_$_Document",
            library: "/System/Library/Frameworks/AppKit.framework/AppKit",
          },
        ],
        objc_class_import_binding_coverage: {
          status: "complete",
          examined: 2,
          decoded: 1,
        },
      },
    });
    await client.ping();
  },
);
