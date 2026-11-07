import type { CapabilityDescriptor } from "../application/AnalysisProvider.js";
import { MANAGED_STATIC_PROVIDER } from "../domain/investigationProviders.js";
import {
  MANAGED_TOOL_CONTRACTS,
  type ManagedToolName,
} from "../contracts/managed/managedToolContracts.js";

/** Declare managed metadata coverage without opening or loading an assembly. */
export const managedStaticCapabilities = (): readonly CapabilityDescriptor[] =>
  Object.freeze(
    MANAGED_TOOL_CONTRACTS.map((contract) =>
      Object.freeze({
        provider: MANAGED_STATIC_PROVIDER,
        operation: contract.name,
        available: true as const,
        reason: null,
        effects: Object.freeze({
          mutatesArtifact: false,
          launchesProcess: false,
          mayShowUi: false,
          mayAccessNetwork: false,
          mayWriteFilesystem: false,
          changesPermissions: false,
          requiresRoot: false,
        }),
        limitations: limitationsFor(contract.name),
      }),
    ),
  );

const limitationsFor = (operation: ManagedToolName): readonly string[] =>
  Object.freeze(
    operation === "inspect_managed_artifact"
      ? [
          "This capability inventories PE/CLI identity only; inspect_managed_members admits metadata members, signatures, and CIL anchors.",
          "It never loads the target assembly, resolves dependencies through a CLR, decompiles C#, or executes target code.",
        ]
      : operation === "inspect_managed_native_boundaries"
        ? [
            "This capability inventories managed declarations for native boundaries only; native exports, thunks, and addresses require separate native-provider evidence.",
            "It never loads the target assembly, resolves dependencies through a CLR, decompiles C#, or executes target code.",
          ]
        : [
            "This capability decodes PE/CLI metadata members, signatures, and file-backed method bodies; decompiled C# reconstruction and cross-build member comparison are separate operations.",
            "It never loads the target assembly, resolves dependencies through a CLR, decompiles C#, or executes target code.",
          ],
  );
