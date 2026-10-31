import { build } from "plist";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { sqliteDatabaseCapability } from "../../../src/application/sqlite/SqliteDatabaseCapability.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { analysisErrorRemediationAction } from "../../../src/domain/analysisErrorPresentation.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ResourceSnapshotMismatchError } from "../../../src/domain/evidenceErrors.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const resourceOperations = [
  "inspect_plist",
  "decode_interface_builder",
  "inspect_asset_catalog",
  "inspect_keyed_archive",
] as const;

const expectUnsupportedArtifactOperations = (content: unknown) => {
  const parsed = toolContract("binary_session").outputSchema.parse(content);
  for (const name of [
    "inspect_artifact",
    "extract_artifact",
    "trace_dylib_resolution",
  ])
    expect(
      parsed.result.tool_availability.groups.find((group) =>
        group.names.includes(name),
      ),
    ).toMatchObject({
      available: false,
      reason: "target_unsupported",
      remediation: expect.stringContaining("open_binary"),
    });
};

const expectIndependentResourceWorkflows = async (
  call: Awaited<ReturnType<typeof connectLocalToolsMcp>>["call"],
  root: string,
  firstBundle: string,
): Promise<void> => {
  for (const detail of ["summary", "complete"] as const) {
    const status = await call("binary_session", { detail });
    expectUnsupportedArtifactOperations(status.structuredContent);
    const parsed = toolContract("binary_session").outputSchema.parse(
      status.structuredContent,
    );
    for (const name of ["inspect_desktop_application"])
      expect(
        parsed.result.tool_availability.groups.find((group) =>
          group.names.includes(name),
        ),
      ).toMatchObject({ available: true });
  }
  const capability = sqliteDatabaseCapability(process.versions.node);
  const status = await call("binary_session", { detail: "complete" });
  const parsed = toolContract("binary_session").outputSchema.parse(
    status.structuredContent,
  );
  expect(
    parsed.result.tool_availability.groups.find((group) =>
      group.names.includes("inspect_sqlite_database"),
    ),
  ).toMatchObject(
    capability.available
      ? { available: true }
      : {
          available: false,
          reason: "provider_unavailable",
          remediation: capability.reason,
        },
  );
  const desktop = await call("inspect_desktop_application", {
    path: firstBundle,
  });
  expect(desktop.isError, JSON.stringify(desktop)).not.toBe(true);
  if (!capability.available) return;
  const databasePath = join(root, "fixture.sqlite");
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)");
  database.close();
  const result = await call("inspect_sqlite_database", { path: databasePath });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
};

cliTest.skipIf(process.platform !== "darwin")(
  "inspects a keyless app resource root through the compiled CLI",
  async ({ cli }) => {
    const temporaryRoot = await createTestTempDirectory(
      "rea-bundle-resource-acceptance-",
    );
    const firstBundle = await createKeylessBundle(temporaryRoot, "First");

    for (const scenario of cliScenarios(firstBundle)) {
      const response = await cli.run({
        arguments: [...scenario.arguments, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(
        response.exitCode,
        `${scenario.operation}: ${response.stdout} ${response.stderr}`,
      ).toBe(0);
      const evidence = expectResourceEvidence(
        response.json,
        scenario.operation,
        firstBundle,
      );
      if (scenario.operation === "inspect_keyed_archive")
        expect(evidence.normalized_result).toMatchObject({
          archive_path: "Resources/Archive.plist",
          objects: expect.arrayContaining([
            expect.objectContaining({ value: "resource-only-value" }),
          ]),
        });
    }
  },
);

cliTest.skipIf(process.platform !== "darwin")(
  "retains and switches keyless resource sessions through stdio MCP",
  async () => {
    const root = await createTestTempDirectory(
      "rea-resource-session-acceptance-",
    );
    const firstBundle = await createKeylessBundle(root, "First");
    const secondBundle = await createKeylessBundle(root, "Second");
    const { call } = await connectLocalToolsMcp();
    const opened = await call("open_bundle_resources", { path: firstBundle });
    expect(opened.isError).not.toBe(true);
    expect(
      toolContract("open_bundle_resources").outputSchema.parse(
        opened.structuredContent,
      ),
    ).toMatchObject({
      result: {
        caller_path: firstBundle,
        canonical_path: firstBundle,
        executable_sha256: null,
      },
    });

    const firstStatus = await call("binary_session", {});
    expect(firstStatus.isError).not.toBe(true);
    expect(
      toolContract("binary_session").outputSchema.parse(
        firstStatus.structuredContent,
      ),
    ).toMatchObject({
      result: {
        open: true,
        session_kind: "bundle_resources",
        analysis_provider_binding: null,
        analysis_provider_candidates: [],
        resource_root: {
          canonical_path: firstBundle,
          executable_sha256: null,
        },
      },
    });

    await expectIndependentResourceWorkflows(call, root, firstBundle);
    for (const [name, input] of [
      ["inspect_artifact", {}],
      ["extract_artifact", { integrity_policy: "fail" }],
      ["trace_dylib_resolution", { roots: ["Absent"] }],
    ] as const) {
      const refused = await call(name, input);
      expect(refused.isError).toBe(true);
      expect(errorBody(refused)).toMatchObject({
        error: { code: "capability_unavailable" },
      });
    }
    const afterRefusals = await call("binary_session", { detail: "complete" });
    expectUnsupportedArtifactOperations(afterRefusals.structuredContent);
    const refusedSnapshot = await call("close_binary", {
      snapshot_path: join(root, "snapshot.json"),
    });
    expect(refusedSnapshot.isError).toBe(true);
    expect(errorBody(refusedSnapshot)).toMatchObject({
      error: {
        code: "evidence_integrity_mismatch",
        category: "integrity_mismatch",
        retryable: false,
        remediation: {
          action: analysisErrorRemediationAction(
            new ResourceSnapshotMismatchError("export"),
          ),
        },
      },
    });
    await expect(lstat(join(root, "snapshot.json"))).rejects.toThrow("ENOENT");
    for (const operation of resourceOperations) {
      const arguments_ =
        operation === "inspect_keyed_archive"
          ? { path: "Resources/Archive.plist" }
          : {};
      const response = await call(operation, arguments_);
      expect(response.isError, operation).not.toBe(true);
      const evidence = expectResourceEvidence(
        response.structuredContent,
        operation,
        firstBundle,
      );
      if (operation === "inspect_keyed_archive")
        expect(evidence.normalized_result).toMatchObject({
          archive_path: "Resources/Archive.plist",
          objects: expect.arrayContaining([
            expect.objectContaining({ value: "resource-only-value" }),
          ]),
        });
    }

    const retained = await call("get_evidence_bundle", {});
    expect(retained.isError).not.toBe(true);
    const evidenceBundle = toolContract(
      "get_evidence_bundle",
    ).outputSchema.parse(retained.structuredContent);
    for (const operation of resourceOperations) {
      const record = evidenceBundle.result.records.find(
        (record) => record.operation === operation,
      );
      expectResourceEvidence(record, operation, firstBundle);
    }

    const switched = await call("open_bundle_resources", {
      path: secondBundle,
    });
    expect(switched.isError).not.toBe(true);
    expect(
      toolContract("open_bundle_resources").outputSchema.parse(
        switched.structuredContent,
      ),
    ).toMatchObject({ result: { canonical_path: secondBundle } });
    const switchedStatus = await call("binary_session", {});
    expect(switchedStatus.isError).not.toBe(true);
    expect(
      toolContract("binary_session").outputSchema.parse(
        switchedStatus.structuredContent,
      ),
    ).toMatchObject({
      result: {
        open: true,
        session_kind: "bundle_resources",
        resource_root: {
          caller_path: secondBundle,
          canonical_path: secondBundle,
          executable_sha256: null,
        },
      },
    });

    const closed = await call("close_binary", {});
    expect(closed.isError).not.toBe(true);
    toolContract("close_binary").outputSchema.parse(closed.structuredContent);
    const finalStatus = await call("binary_session", {});
    expect(finalStatus.isError).not.toBe(true);
    expect(
      toolContract("binary_session").outputSchema.parse(
        finalStatus.structuredContent,
      ),
    ).toMatchObject({ result: { open: false, cleanup_pending: false } });
  },
);

const errorBody = (response: {
  content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}): unknown => {
  const text = response.content.find((item) => item.type === "text");
  if (typeof text?.text !== "string") throw new Error("Expected error text");
  return JSON.parse(text.text) as unknown;
};

const createKeylessBundle = async (
  root: string,
  name: string,
): Promise<string> => {
  const bundle = join(root, `${name}.app`);
  await mkdir(join(bundle, "Resources"), { recursive: true });
  await mkdir(join(bundle, "Assets.xcassets"));
  await writeFile(
    join(bundle, "Info.plist"),
    build({ CFBundleIdentifier: `org.example.${name.toLowerCase()}` }),
  );
  await writeFile(
    join(bundle, "Resources", "Archive.plist"),
    build({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: ["$null", "resource-only-value"],
      $top: { root: { UID: 1 } },
    }),
  );
  return bundle;
};

const cliScenarios = (bundle: string) =>
  [
    { operation: "inspect_plist", arguments: ["inspect-plist", bundle] },
    {
      operation: "decode_interface_builder",
      arguments: ["decode-interface-builder", bundle],
    },
    {
      operation: "inspect_asset_catalog",
      arguments: ["inspect-asset-catalog", bundle],
    },
    {
      operation: "inspect_keyed_archive",
      arguments: ["inspect-keyed-archive", bundle, "Resources/Archive.plist"],
    },
  ] as const;

const expectResourceEvidence = (
  value: unknown,
  operation: (typeof resourceOperations)[number],
  bundle: string,
) => {
  const evidence = parseEvidence(
    toolContract(operation).outputSchema.parse(value),
  );
  expect(evidence).toMatchObject({
    operation,
    subject: null,
    normalized_result: {
      resource_root: {
        caller_path: bundle,
        canonical_path: bundle,
        executable_sha256: null,
      },
    },
  });
  if (operation === "inspect_plist")
    expect(evidence.normalized_result).toMatchObject({
      source_path: join(bundle, "Info.plist"),
      bundle: { executable: null },
    });
  else
    expect(evidence.normalized_result).toMatchObject({ target_sha256: null });
  return evidence;
};
