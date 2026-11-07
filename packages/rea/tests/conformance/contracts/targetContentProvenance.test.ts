import { describe, expect, it } from "vitest";

import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import { TARGET_CONTENT_FREE_TOOLS } from "../../../src/contracts/toolEffects.js";

describe("target-content provenance audit", () => {
  it("marks every tool except the audited content-free exceptions", () => {
    const names = new Set<string>(TOOL_CONTRACTS.map(({ name }) => name));
    expect(
      [...TARGET_CONTENT_FREE_TOOLS].filter((name) => !names.has(name)),
    ).toEqual([]);
    for (const contract of TOOL_CONTRACTS)
      expect({
        name: contract.name,
        returnsTargetContent: contract.returnsTargetContent,
      }).toEqual({
        name: contract.name,
        returnsTargetContent: !TARGET_CONTENT_FREE_TOOLS.has(contract.name),
      });
    expect([...TARGET_CONTENT_FREE_TOOLS].sort()).toEqual([
      "export_evidence_bundle",
      "guided_workflows",
      "inspect_analysis_settings",
      "read_guidance_section",
      "record_unknown",
      "search_guidance",
      "update_analysis_settings",
    ]);
  });

  it.each([
    "procedure_pseudo_code",
    "list_strings",
    "search_strings",
    "batch_decompile",
    "inspect_web_page",
    "analyze_web_bundle",
    "export_web_scripts",
    "inspect_web_network_capture",
    "read_adb_logcat",
    "list_adb_directory",
    "decompile_jeb_item",
    "inspect_artifact",
    "analyze_javascript_application",
    "capture_process_scenario",
    "get_evidence_bundle",
    "inspect_analysis_view",
    "binary_session",
    "close_binary",
    "inspect_adb_client",
    "inspect_apktool_client",
    "update_unknown",
  ])("marks %s as returning target content", (name) => {
    expect(
      TOOL_CONTRACTS.find((contract) => contract.name === name)
        ?.returnsTargetContent,
    ).toBe(true);
  });
});
