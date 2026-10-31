import {
  jebInputSchemas,
  jebResultSchemas,
} from "../../domain/jeb/jebAnalysis.js";
import type { ToolContract } from "../toolContractTypes.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
import { toolContractMetadata } from "../toolEffects.js";

/** JEB-backed inspection served by a caller-supplied running engine client. */
export const JEB_TOOL_CONTRACTS = [
  {
    name: "inspect_jeb_client",
    ...toolContractMetadata("inspect_jeb_client"),
    description:
      "Inspect the running JEB client serving MCP: engine version, GUI or headless mode, and startup time. Does not open a target. Requires a caller-started JEB client reachable at REA_JEB_MCP_URL (default http://127.0.0.1:8425/mcp); REA never installs or launches JEB.",
    kind: "jeb-provider",
    inputSchema: jebInputSchemas.inspect_jeb_client,
    outputSchema: evidenceResultOf(jebResultSchemas.inspect_jeb_client),
    examples: [{ title: "Check the engine", input: {} }],
  },
  {
    name: "open_jeb_project",
    ...toolContractMetadata("open_jeb_project"),
    description:
      "Open or create a JEB project from an artifact file or existing .jdb2 database on the engine host. Returns the project's input-file digests and top-level units. The engine analyzes the target itself; REA does not read the file or execute it. Fails when a project is already open.",
    kind: "jeb-provider",
    inputSchema: jebInputSchemas.open_jeb_project,
    outputSchema: evidenceResultOf(jebResultSchemas.open_jeb_project),
    examples: [
      {
        title: "Open a target for analysis",
        input: { path: "/tmp/Example.apk" },
      },
    ],
  },
  {
    name: "list_jeb_units",
    ...toolContractMetadata("list_jeb_units"),
    description:
      "List project units by stable unit path and type, with optional wildcard filter, parent restriction, and pagination. The engine caps pages at 100 units; a full page reports partial coverage because more units may exist. Read-only.",
    kind: "jeb-provider",
    inputSchema: jebInputSchemas.list_jeb_units,
    outputSchema: evidenceResultOf(jebResultSchemas.list_jeb_units),
    examples: [
      {
        title: "List units",
        input: {},
      },
      {
        title: "Find DEX units",
        input: { filter: "*.dex" },
      },
    ],
  },
  {
    name: "decompile_jeb_item",
    ...toolContractMetadata("decompile_jeb_item"),
    description:
      "Decompile one type or method to engine pseudo-code using its decompiler (Dalvik, Java, or native). item_address comes from the engine's code item listing; unit_path defaults to the engine's first code unit and stays unknown when omitted. Read-only with respect to the target file.",
    kind: "jeb-provider",
    inputSchema: jebInputSchemas.decompile_jeb_item,
    outputSchema: evidenceResultOf(jebResultSchemas.decompile_jeb_item),
    examples: [
      {
        title: "Decompile a method",
        input: {
          item_address: "Lcom/example/Main;->onCreate()V",
          item_kind: "method",
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
