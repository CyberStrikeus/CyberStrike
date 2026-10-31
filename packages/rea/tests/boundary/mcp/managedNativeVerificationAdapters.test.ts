import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect } from "vitest";

import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";
import {
  MANAGED_APPLICATION_GRAPH_EXAMPLE,
  MANAGED_NATIVE_VERIFICATION_EXAMPLE,
} from "../../../src/contracts/managed/managedWorkflowExamples.js";
import { managedMemberInspectionSchema } from "../../../src/domain/managed/managedArtifact.js";
import { managedApplicationGraphReferenceInputSchema } from "../../../src/domain/managed/managedApplicationGraph.js";
import { managedNativeVerificationResultSchema } from "../../../src/domain/managed/managedNativeVerificationSchemas.js";
import { buildManagedPeFixture } from "../../../src/dotnet/ManagedPe.fixture.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

const client = new Client({ name: "managed-native-adapters", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("scripts/rea.mjs"), "mcp"],
  cwd: process.cwd(),
  env: { PATH: process.env.PATH ?? "" },
  stderr: "pipe",
});
beforeAll(async () => {
  await client.connect(transport);
  transport.stderr?.on("data", () => undefined);
});
afterAll(async () => {
  await Promise.all([client.close(), transport.close()]);
});

cliTest(
  "preserves managed graph identity failures and wrong-role controls through CLI and stdio MCP",
  async ({ cli }) => {
    const original = MANAGED_APPLICATION_GRAPH_EXAMPLE.managed_members;
    const members = managedMemberInspectionSchema.parse(
      original.normalized_result,
    );
    const otherDigest = "b".repeat(64);
    const otherMvid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    for (const variant of [
      "subject-sha256",
      "scope-sha256",
      "scope-mvid",
    ] as const) {
      const source = createEvidence(
        variant === "subject-sha256"
          ? { path: members.artifact.path, format: "pe", sha256: otherDigest }
          : undefined,
        original.provider,
        {
          operation: original.operation,
          parameters: {},
          result: {
            ...members,
            identity_scope: {
              ...members.identity_scope,
              ...(variant === "scope-sha256"
                ? { requires_artifact_sha256: otherDigest }
                : {}),
              ...(variant === "scope-mvid" ? { requires_mvid: otherMvid } : {}),
            },
          },
          rawResult: null,
        },
      );
      // The record authenticates and the request has the advertised shape;
      // rejection must identify the contradictory identities within that record.
      const input = managedApplicationGraphReferenceInputSchema.parse({
        managed_members: parseEvidence(JSON.parse(JSON.stringify(source))),
      });
      const response = await client.callTool({
        name: "project_managed_application_graph",
        arguments: input,
      });
      const error = parseMcpToolError(response).error;
      const contradiction =
        variant === "subject-sha256"
          ? `subject SHA-256 ${otherDigest} does not match normalized artifact SHA-256 ${members.artifact.sha256}`
          : variant === "scope-sha256"
            ? `token scope SHA-256 ${otherDigest} does not match normalized artifact SHA-256 ${members.artifact.sha256}`
            : `token scope MVID ${otherMvid} does not match module MVID ${String(members.module?.mvid)}`;
      expect(error).toMatchObject({
        code: "evidence_integrity_mismatch",
        category: "integrity_mismatch",
        retryable: false,
        details: {
          reason: `Managed Evidence inspect_managed_members (${source.evidence_id}) ${contradiction}`,
        },
      });
      expect(error.recovery).toBeUndefined();
      expect(response.structuredContent).toBeUndefined();
      const command = await cli.run({
        arguments: [
          "project-managed-application-graph",
          JSON.stringify(input),
          "--json",
        ],
      });
      expect(command.exitCode, command.stderr).toBe(1);
      expect(command.json).toMatchObject(error);
      expect(command.json).not.toHaveProperty("recovery");
      expect(command.json).not.toHaveProperty("evidence_id");
    }

    const wrongRole = MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries;
    const wrongInput = { managed_members: wrongRole };
    const wrongResponse = await client.callTool({
      name: "project_managed_application_graph",
      arguments: wrongInput,
    });
    const wrongError = parseMcpToolError(wrongResponse).error;
    expect(wrongError).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      recovery: {
        kind: "inspect_input_contract",
        operation: "project_managed_application_graph",
      },
      details: {
        issues: [
          {
            path: ["managed_members"],
            reason: "invalid_value",
            message: `Expected rea.analysis inspect_managed_members Evidence, received ${wrongRole.predicate_type} ${wrongRole.operation}`,
          },
        ],
      },
    });
    const wrongCommand = await cli.run({
      arguments: [
        "project-managed-application-graph",
        JSON.stringify(wrongInput),
        "--json",
      ],
    });
    expect(wrongCommand.exitCode, wrongCommand.stderr).toBe(1);
    expect(wrongCommand.json).toMatchObject(wrongError);

    const control = await client.callTool({
      name: "project_managed_application_graph",
      arguments: MANAGED_APPLICATION_GRAPH_EXAMPLE,
    });
    expect(control.isError, JSON.stringify(control.content)).not.toBe(true);
    const commandControl = await cli.run({
      arguments: [
        "project-managed-application-graph",
        JSON.stringify(MANAGED_APPLICATION_GRAPH_EXAMPLE),
        "--json",
      ],
    });
    expect(commandControl.exitCode, commandControl.stderr).toBe(0);
    const evidence = parseEvidence(control.structuredContent);
    expect(parseEvidence(commandControl.json).normalized_result).toEqual(
      evidence.normalized_result,
    );
    expect(evidence.evidence_links).toEqual([original.evidence_id]);
  },
  60_000,
);

/** Authentic native Evidence whose operation the workflow cannot read symbols from. */
const signatureEvidence = () =>
  createEvidence(
    {
      path: "/usr/bin/true",
      sha256: "a".repeat(64),
      format: "mach-o",
      architecture: "arm64",
    },
    { id: "native", name: "Native", version: "simulated" },
    {
      predicateType: "rea.native-signature",
      operation: "inspect_signature",
      parameters: {},
      result: { signed: true },
      limitations: ["No native provider executed."],
    },
  );

const platformPinvokeCases = [
  {
    format: "pe",
    scope: "nativehelper.dll",
    module: "nativehelper.dll",
    status: "verified",
  },
  {
    format: "pe",
    scope: "nativehelper.dll",
    module: "nativehelper.exe",
    status: "contradicted",
  },
  {
    format: "pe",
    scope: "nativehelper.dll",
    module: "nativehelper.node",
    status: "contradicted",
  },
  {
    format: "pe",
    scope: "nativehelper",
    module: "nativehelper.dll",
    status: "verified",
  },
  {
    scope: "nativedep.so.6",
    module: "libnativedep.so.6",
    format: "elf",
    status: "verified",
  },
  {
    scope: "nativehelper",
    module: "libnativehelper.so",
    format: "elf",
    flags: 0x202,
    symbol: "open_nativeA",
    status: "unresolved",
  },
  {
    scope: "nativehelper",
    module: "libnativehelper.dylib",
    format: "mach-o",
    flags: 0x204,
    symbol: "open_nativeW",
    status: "unresolved",
  },
  {
    scope: "nativehelper",
    module: "libnativehelper.so",
    format: "elf",
    flags: 0x204,
    symbol: "open_native",
    status: "verified",
  },
  {
    scope: "nativehelper",
    module: "nativehelper.dll",
    format: "pe",
    flags: 0x202,
    symbol: "open_nativeA",
    status: "inferred",
  },
] as const;

cliTest(
  "preserves platform-specific P/Invoke names and module matching through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-managed-native-module-names-",
    );
    const nativeProvider = {
      id: "native-fixture",
      name: "Synthetic native fixture",
      version: "1",
    };
    const dossier = functionDossierSchema.parse({
      procedure: {
        address: "0x1000",
        name: "open_native",
        classification: {
          external: false,
          thunk: false,
          thunk_target: null,
          provenance: "synthetic-provider",
        },
        body: { available: false, reason: "Synthetic test Evidence only." },
        signature: null,
        locals: [],
      },
      pseudocode: "",
      assembly: [],
      comments: [],
      callers: [],
      callees: [],
      incoming_references: [],
      outgoing_references: [],
      referenced_strings: [],
      referenced_names: [],
      basic_blocks: [],
      native_api: null,
      native_value_flow: null,
      limitations: ["No native provider was executed."],
    });

    for (const [index, item] of platformPinvokeCases.entries()) {
      const managedPath = join(root, `managed-${String(index)}.dll`);
      await writeFile(
        managedPath,
        buildManagedPeFixture({
          pinvoke: {
            importName: "open_native",
            moduleName: item.scope,
            ...("flags" in item ? { mappingFlags: item.flags } : {}),
          },
        }),
      );
      const inspected = await client.callTool({
        name: "inspect_managed_native_boundaries",
        arguments: { path: managedPath },
      });
      expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(
        true,
      );
      const managed = parseEvidence(inspected.structuredContent);
      const native = createEvidence(
        {
          path: `/synthetic/${item.module}`,
          sha256: "8".repeat(64),
          format: item.format ?? "pe",
        },
        nativeProvider,
        {
          operation: "analyze_function",
          parameters: {},
          result: {
            ...dossier,
            procedure: {
              ...dossier.procedure,
              name: "symbol" in item ? item.symbol : "open_native",
            },
          },
          rawResult: null,
          limitations: ["Synthetic native Evidence; no provider executed."],
        },
      );
      const input = {
        managed_boundaries: managed,
        native_observations: [native],
      };
      const mcp = await client.callTool({
        name: "verify_managed_native_boundaries",
        arguments: input,
      });
      expect(mcp.isError, JSON.stringify(mcp.content)).not.toBe(true);
      const mcpResult = managedNativeVerificationResultSchema.parse(
        parseEvidence(mcp.structuredContent).normalized_result,
      );
      const request = join(root, `verify-${String(index)}.json`);
      await writeFile(request, JSON.stringify(input));
      const invocation = {
        arguments: ["verify-managed-native-boundaries", request, "--json"],
      };
      const cliRun =
        index === 0
          ? await cli.run(invocation)
          : await runFileCli(cli, invocation);
      expect(cliRun.exitCode, cliRun.stderr).toBe(0);
      const cliResult = managedNativeVerificationResultSchema.parse(
        parseEvidence(cliRun.json).normalized_result,
      );
      expect(mcpResult).toEqual(cliResult);
      expect(mcpResult.pinvoke_imports[0]).toMatchObject({
        status: item.status,
        ...(item.status === "contradicted" ? { basis: "module-mismatch" } : {}),
        ...(item.status === "unresolved"
          ? {
              basis: "no-native-candidate",
              candidates: [],
              matched_native: null,
            }
          : {}),
      });
      expect(mcpResult.evidence_links).toEqual([
        managed.evidence_id,
        native.evidence_id,
      ]);
    }
  },
  60_000,
);

cliTest(
  "counts authentic unsupported native Evidence identically through MCP and CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-native-adapters-");
    const path = join(root, "fixture.dll");
    await writeFile(path, buildManagedPeFixture({ pinvoke: {} }));
    const inspected = await client.callTool({
      name: "inspect_managed_native_boundaries",
      arguments: { path },
    });
    expect(inspected.isError).not.toBe(true);
    const managed = parseEvidence(inspected.structuredContent);
    const native = signatureEvidence();
    const input = {
      managed_boundaries: managed,
      native_observations: [native],
    };

    const mcp = await client.callTool({
      name: "verify_managed_native_boundaries",
      arguments: input,
    });
    expect(mcp.isError, JSON.stringify(mcp.content)).not.toBe(true);
    const mcpResult = managedNativeVerificationResultSchema.parse(
      parseEvidence(mcp.structuredContent).normalized_result,
    );

    const request = join(root, "verify.json");
    await writeFile(request, JSON.stringify(input));
    const cliRun = await cli.run({
      arguments: ["verify-managed-native-boundaries", request, "--json"],
    });
    expect(cliRun.exitCode, cliRun.stderr).toBe(0);
    const cliResult = managedNativeVerificationResultSchema.parse(
      parseEvidence(cliRun.json).normalized_result,
    );

    expect(mcpResult).toEqual(cliResult);
    expect(mcpResult).toMatchObject({
      native_observations: {
        total: 1,
        accepted: 0,
        unsupported: 1,
        symbols: 0,
      },
      summary: { unresolved: 1 },
      pinvoke_imports: [
        expect.objectContaining({ basis: "unsupported-native-evidence" }),
      ],
      coverage: { status: "partial" },
      evidence_links: [managed.evidence_id, native.evidence_id],
    });
    expect(mcpResult.limitations).toContain(
      "Some native Evidence operations were unsupported by this workflow.",
    );

    const tampered = await client.callTool({
      name: "verify_managed_native_boundaries",
      arguments: {
        ...input,
        native_observations: [{ ...native, operation: "inspect_macho" }],
      },
    });
    expect(parseMcpToolError(tampered)).toMatchObject({
      error: { code: "evidence_integrity_mismatch" },
    });
  },
  60_000,
);
