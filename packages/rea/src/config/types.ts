import type { GhidraProjectSelection } from "./ghidraExistingProject.js";
import type { McpToolFamilies } from "./mcpToolFamilies.js";
import type { LogLevel } from "./processStart.js";
import type { ReferenceSourcePolicy } from "../domain/referenceSourcePolicy.js";
import type { AnalysisProviderSelector } from "../domain/providerSelection.js";

import type { GhidraLanguageOverride } from "./ghidraLanguageOverride.js";
import type { McpInputSchemaProfile } from "./mcpInputSchemaProfile.js";
import type { McpOutputSchemaProfile } from "./mcpOutputSchemaProfile.js";
import type { BridgeMaxRequestBytes } from "./bridgeMaxRequestBytes.js";
import type { RegexMatchingDeadline } from "./regexMatchingDeadline.js";
import type { RegexWorkerHeapRequest } from "./regexWorkerHeapRequest.js";
import type { HopperCallerScanBudget } from "./hopperCallerScanBudget.js";

export interface AppConfig {
  readonly mcpToolFamilies?: readonly McpToolFamilies[number][];
  readonly mcpMaxResponseBytes?: number;
  readonly mcpMaxInputElements?: number;
  readonly mcpInputSchemaProfile?: McpInputSchemaProfile;
  readonly mcpOutputSchemaProfile?: McpOutputSchemaProfile;
  readonly analysisProvider: AnalysisProviderSelector;
  readonly idaMcpConfigPath?: string;
  readonly ghidraInstallDir: string | undefined;
  readonly ghidraJavaHome: string | undefined;
  readonly ghidraStartupTimeoutMs: number;
  /** Per-function native decompiler limit; absent leaves decompiles unbounded. */
  readonly ghidraDecompileTimeoutSeconds?: number | undefined;
  readonly ghidraLanguageOverride?: GhidraLanguageOverride;
  readonly ghidraDisabledAnalyzers?: readonly string[];
  readonly ghidraSeedFile?: string;
  readonly ghidraExistingProject?: GhidraProjectSelection;
  readonly ghidraNativeAotJar?: string;
  readonly ilspyCmdPath: string | undefined;
  readonly hopperLauncherPath: string;
  readonly hopperStartupTimeoutMs: number;
  /** Cooperative per-operation budget for forward caller reconciliation. */
  readonly hopperCallerScanBudget: HopperCallerScanBudget;
  readonly hopperTargetPath: string | undefined;
  readonly hopperTargetKind: "executable" | "database";
  readonly hopperLoaderArgs: readonly string[];
  readonly logLevel: LogLevel;
  readonly referenceSourcePolicy: ReferenceSourcePolicy;
  /** Hopper and Cutter request payload ceiling resolved at startup. */
  readonly bridgeMaxRequestBytes: BridgeMaxRequestBytes;
  /** Supervised ECMAScript matching deadline resolved at startup. */
  readonly regexMatchingDeadline: RegexMatchingDeadline;
  /** Regex worker old-generation request resolved at startup. */
  readonly regexWorkerHeapRequest: RegexWorkerHeapRequest;
}
