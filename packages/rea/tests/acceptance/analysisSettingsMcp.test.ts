import { analysisSettingsResultSchema } from "../../src/contracts/analysisSettingsContracts.js";
import { expect, it } from "vitest";
import type { AnySchema } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { join } from "node:path";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { INLINE_EVIDENCE_MCP_ENVIRONMENT } from "../../scripts/lib/mcp-verification-environment.mjs";
import { asarHeaderBytes } from "../fixtures/asarHeader.js";
import { nativeMatchingNamedInventory } from "../fixtures/nativeFunctionMatching.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../src/domain/evidence.js";

it("advertises exact contracts and recovers a full large-index archive over one MCP connection", async () => {
  const root = await createTestTempDirectory("rea-runtime-settings-");
  const archive = join(root, "application.asar");
  // Large header, small payload: tests index admission independently of input/member size.
  const first = Buffer.from("export const answer = 42;\n");
  const second = Buffer.from(
    "import { answer } from './main.js'; export const result = answer;\n",
  );
  const header = asarHeaderBytes(
    " ".repeat(16 * 1024 * 1024) +
      JSON.stringify({
        files: {
          "main.js": { size: first.length, offset: "0" },
          "second.js": { size: second.length, offset: String(first.length) },
        },
      }),
  );
  await writeFile(archive, Buffer.concat([header, first, second]));
  const { client, call: invoke } = await connectLocalToolsMcp();
  try {
    const catalog = await client.listTools();
    const ajv = new Ajv2020({ strict: false });
    for (const name of [
      "inspect_analysis_settings",
      "update_analysis_settings",
    ]) {
      const tool = catalog.tools.find((tool) => tool.name === name)!;
      expect(tool).toBeDefined();
      expect(ajv.validateSchema(tool.inputSchema as AnySchema)).toBe(true);
      expect(ajv.validateSchema(tool.outputSchema as AnySchema)).toBe(true);
    }
    const initial = await invoke("inspect_analysis_settings", {
      settings: ["asar.max_header_bytes"],
    });
    expect(initial.structuredContent).toMatchObject({
      revision: 0,
      settings: [{ value: 16777216 }],
    });
    const opened = await invoke("open_binary", { path: archive });
    expect(opened.isError).not.toBe(true);
    const failed = await invoke("inspect_artifact", {});
    expect(failed.isError).toBe(true);
    const errorText = failed.content.find((item) => item.type === "text");
    if (errorText?.type !== "text") throw new Error("Missing projected error");
    expect(JSON.parse(errorText.text).error).toMatchObject({
      details: {
        limit: {
          setting: "asar.max_header_bytes",
          effective_value: 16777216,
          agent_editable: true,
        },
      },
    });
    const analysisRequest = { input_path: archive };
    expect(
      (await invoke("analyze_javascript_application", analysisRequest)).isError,
    ).toBe(true);
    const updated = await invoke("update_analysis_settings", {
      changes: [
        { setting: "asar.max_header_bytes", action: "set", value: 33554432 },
      ],
    });
    expect(updated.isError).not.toBe(true);
    expect(updated.structuredContent).toMatchObject({
      revision: 1,
      active_work_changed: false,
      rea_restart_required: false,
    });
    const recovered = await invoke("inspect_artifact", {});
    expect(recovered.isError).not.toBe(true);
    expect(recovered.structuredContent).toMatchObject({
      normalized_result: { coverage: { status: "complete-within-substeps" } },
    });
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(recovered.structuredContent).normalized_result,
    );
    const inventoryStep = inspection.substeps.find(
      (substep) => substep.operation === "inventory_artifact",
    );
    if (inventoryStep === undefined)
      throw new Error("Missing inventory substep");
    const inventory = inventoryStep.evidence.normalized_result;
    for (const [path, bytes] of [
      ["main.js", first],
      ["second.js", second],
    ] as const) {
      const occurrence = inventory.occurrences.find(
        (row) => row.logical_path === path,
      );
      expect(occurrence, path).toBeDefined();
      expect(
        inventory.nodes.find(
          (node) => node.artifact_id === occurrence?.artifact_id,
        )?.sha256,
        path,
      ).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    const analyzed = await invoke(
      "analyze_javascript_application",
      analysisRequest,
    );
    expect(analyzed.isError, JSON.stringify(analyzed)).not.toBe(true);
    expect(analyzed.structuredContent).toMatchObject({
      normalized_result: {
        statistics: { parsed_javascript_files: 2, parse_failures: 0 },
      },
    });
    await invoke("close_binary", {});
    expect((await invoke("open_binary", { path: archive })).isError).not.toBe(
      true,
    );
    expect(
      (
        await invoke("inspect_analysis_settings", {
          settings: ["asar.max_header_bytes"],
        })
      ).structuredContent,
    ).toMatchObject({
      revision: 1,
      settings: [{ value: 33554432, source: "runtime" }],
    });
    await invoke("update_analysis_settings", {
      changes: [{ setting: "asar.max_header_bytes", action: "reset" }],
    });
    expect((await invoke("inspect_artifact", {})).isError).toBe(true);
    await invoke("close_binary", {});
    expect(
      (await invoke("inspect_analysis_settings", {})).structuredContent,
    ).toMatchObject({ revision: 2 });
  } finally {
    await client.close();
  }
}, 30000);

it.each(["0", "2147483648"])(
  "keeps invalid JADX launch timeout %s local and repairable through MCP",
  async (timeout) => {
    const { client, call } = await connectLocalToolsMcp({
      REA_JADX_OPERATION_TIMEOUT_MS: timeout,
    });
    try {
      expect((await call("binary_session", {})).isError).not.toBe(true);
      const inspect = () =>
        call("inspect_analysis_settings", {
          settings: ["jadx.operation_timeout_ms"],
        });
      const invalid = analysisSettingsResultSchema.parse(
        (await inspect()).structuredContent,
      );
      expect(invalid).toMatchObject({
        settings: [
          {
            source: "invalid",
            configuration_error: {
              code: "configuration_invalid",
              details: {
                settings: [{ setting: "REA_JADX_OPERATION_TIMEOUT_MS" }],
              },
            },
          },
        ],
      });
      expect(invalid.settings[0]).not.toHaveProperty("value");
      expect(invalid.settings[0]).not.toHaveProperty("launch_value");
      const repaired = await call("update_analysis_settings", {
        changes: [
          { setting: "jadx.operation_timeout_ms", action: "set", value: 42000 },
        ],
      });
      expect(repaired.isError).not.toBe(true);
      expect(repaired.structuredContent).toMatchObject({
        settings: [{ value: 42000, source: "runtime" }],
        changes: [{ new_value: 42000 }],
      });
      const reset = await call("update_analysis_settings", {
        changes: [{ setting: "jadx.operation_timeout_ms", action: "reset" }],
      });
      expect(reset.isError).not.toBe(true);
      expect((await inspect()).structuredContent).toMatchObject({
        settings: invalid.settings,
      });
    } finally {
      await client.close();
    }
  },
  30000,
);

it("lowers, restores and seeds the native matching allowance over MCP", async () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    address: `0x${(0x1000 + i * 16).toString(16)}`,
    value: `function_${i}`,
  }));
  const request = {
    left: nativeMatchingNamedInventory("1", rows),
    right: nativeMatchingNamedInventory("2", rows),
  };
  const limitOf = (result: {
    content: readonly { type: string; text?: string }[];
  }) => {
    const text = result.content.find((item) => item.type === "text")?.text;
    if (text === undefined) throw new Error("Missing projected error");
    return JSON.parse(text).error.details.limit as unknown;
  };
  const runtime = await connectLocalToolsMcp(INLINE_EVIDENCE_MCP_ENVIRONMENT);
  try {
    expect(
      (await runtime.call("match_native_functions", request)).isError,
    ).not.toBe(true);
    await runtime.call("update_analysis_settings", {
      changes: [
        {
          setting: "native.matching_representation_bytes",
          action: "set",
          value: 4096,
        },
      ],
    });
    const refused = await runtime.call("match_native_functions", request);
    expect(refused.isError).toBe(true);
    expect(limitOf(refused)).toMatchObject({
      setting: "native.matching_representation_bytes",
      effective_value: 4096,
      source: "runtime",
      agent_editable: true,
    });
    await runtime.call("update_analysis_settings", {
      changes: [
        { setting: "native.matching_representation_bytes", action: "reset" },
      ],
    });
    expect(
      (await runtime.call("match_native_functions", request)).isError,
    ).not.toBe(true);
  } finally {
    await runtime.client.close();
  }
  const seeded = await connectLocalToolsMcp({
    ...INLINE_EVIDENCE_MCP_ENVIRONMENT,
    REA_NATIVE_MATCHING_REPRESENTATION_BYTES: "4096",
  });
  try {
    expect(
      (
        await seeded.call("inspect_analysis_settings", {
          operation: "match_native_functions",
        })
      ).structuredContent,
    ).toMatchObject({
      settings: [
        {
          setting: "native.matching_representation_bytes",
          value: 4096,
          launch_value: 4096,
          default_value: 100663296,
          source: "setting",
          environment: "REA_NATIVE_MATCHING_REPRESENTATION_BYTES",
        },
      ],
    });
    const refused = await seeded.call("match_native_functions", request);
    expect(refused.isError).toBe(true);
    expect(limitOf(refused)).toMatchObject({
      effective_value: 4096,
      source: "setting",
    });
  } finally {
    await seeded.client.close();
  }
  // An invalid seed is refused by matching alone; MCP stays available and a
  // runtime override repairs the effective allowance.
  const invalid = await connectLocalToolsMcp({
    ...INLINE_EVIDENCE_MCP_ENVIRONMENT,
    REA_NATIVE_MATCHING_REPRESENTATION_BYTES: "0",
  });
  try {
    expect((await invalid.call("binary_session", {})).isError).not.toBe(true);
    const inspected = analysisSettingsResultSchema.parse(
      (
        await invalid.call("inspect_analysis_settings", {
          settings: ["native.matching_representation_bytes"],
        })
      ).structuredContent,
    );
    expect(inspected.settings[0]).toMatchObject({
      source: "invalid",
      configuration_error: {
        code: "configuration_invalid",
        remediation: {
          action: expect.stringContaining("update_analysis_settings"),
        },
      },
    });
    expect(inspected.settings[0]).not.toHaveProperty("value");
    const refused = await invalid.call("match_native_functions", request);
    expect(refused.isError).toBe(true);
    const text = refused.content.find((item) => item.type === "text");
    if (text?.type !== "text") throw new Error("Missing projected error");
    expect(JSON.parse(text.text).error).toMatchObject({
      code: "configuration_invalid",
      remediation: {
        action: expect.stringContaining("update_analysis_settings"),
      },
      details: {
        settings: [{ setting: "REA_NATIVE_MATCHING_REPRESENTATION_BYTES" }],
      },
    });
    const repaired = await invalid.call("update_analysis_settings", {
      changes: [
        {
          setting: "native.matching_representation_bytes",
          action: "set",
          value: 100663296,
        },
      ],
    });
    expect(repaired.structuredContent).toMatchObject({
      settings: [
        {
          source: "runtime",
          value: 100663296,
          configuration_error: inspected.settings[0]!.configuration_error,
        },
      ],
    });
    expect(
      (await invalid.call("match_native_functions", request)).isError,
    ).not.toBe(true);
  } finally {
    await invalid.client.close();
  }
}, 30000);
