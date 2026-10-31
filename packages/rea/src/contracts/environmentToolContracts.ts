import {
  environmentBuildReportSchema,
  exportEnvironmentBundleInputSchema,
} from "../domain/environmentBundleExport.js";
import type { ToolContract } from "./toolContractTypes.js";
import { toolContractMetadata } from "./toolEffects.js";

/** Agent environment bundle contracts shared with the environment-build CLI command. */
export const ENVIRONMENT_TOOL_CONTRACTS = [
  {
    name: "export_environment_bundle",
    ...toolContractMetadata("export_environment_bundle"),
    description:
      "Write an agent environment bundle folder from capture Evidence (capture_browser_scenario, or HAR inspect_web_network_capture Evidence) into an absent absolute output_directory whose parent exists, as rea environment-build does. It projects the environment manifest with the default template rules, derives the state the bundle serves, and reports read tools answered from the state or replayed with their reason, and write tools served or withheld with a hint about what to record next; check the same coverage first with inspect_analysis_view view environment-coverage. dry_run reports without writing. The bundle copies the capture Evidence byte for byte, recorded response bodies included, and its README names how the agentenv framework uses it. Reads that Evidence, and package_tarball when given, and writes only that folder; no network access. dry_run still checks output_directory. Destination refusals name this tool; the others name their stage as environment-build's do.",
    kind: "application",
    inputSchema: exportEnvironmentBundleInputSchema,
    outputSchema: environmentBuildReportSchema,
    examples: [
      {
        title: "Write the bundle for a retained browser scenario capture",
        input: {
          source: {
            kind: "retained-evidence",
            evidence_id:
              "ev_0000000000000000000000000000000000000000000000000000000000000001",
          },
          output_directory: "/tmp/grafana-env",
          name: "grafana",
        },
      },
      {
        title: "Check what a capture file's bundle would serve",
        input: {
          source: { kind: "evidence-file", path: "/tmp/grafana.capture.json" },
          output_directory: "/tmp/grafana-env",
          dry_run: true,
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
