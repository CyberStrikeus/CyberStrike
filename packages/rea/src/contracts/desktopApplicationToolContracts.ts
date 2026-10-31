import { z } from "zod";
import {
  desktopApplicationSchema,
  inspectDesktopApplicationInputSchema,
} from "../domain/desktopApplication.js";
import { desktopApplicationSummaryViewResultSchema } from "../domain/analysisView/analysisView.js";
import { evidenceResultOf } from "./toolOutputSchemaPrimitives.js";
import { toolContractMetadata } from "./toolEffects.js";
import type { ToolContract } from "./toolContractTypes.js";

/** Static directory triage belongs to the existing artifact family. */
export const DESKTOP_APPLICATION_TOOL_CONTRACTS = [
  {
    name: "inspect_desktop_application",
    ...toolContractMetadata("inspect_desktop_application"),
    kind: "artifact-provider",
    requiresActiveTarget: true,
    description:
      "Inspect a local desktop application directory using bounded listings, file headers and selected metadata. Returns .NET, Unity Mono/IL2CPP, Unreal, Godot, GameMaker and Electron candidates, supporting paths/range hashes, component path markers and concrete next probes. No target execution, extraction, network or target changes. Default summary retains complete Evidence for inspect_analysis_view kind desktop-application; the view supports paging and field selection. detail complete returns every retained fact inline. Snapshot identity covers examined metadata/read ranges, not all file contents; coverage and unavailable probes remain explicit.",
    inputSchema: inspectDesktopApplicationInputSchema.extend({
      detail: z.enum(["summary", "complete"]).default("summary"),
    }),
    outputSchema: evidenceResultOf(
      z.union([
        desktopApplicationSchema,
        desktopApplicationSummaryViewResultSchema,
      ]),
    ),
    examples: [
      {
        title: "Identify a desktop installation",
        input: { path: "/artifacts/application" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
