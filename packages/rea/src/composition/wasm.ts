import type { AnalysisSettingsReader } from "../domain/analysisSettings.js";
import { WasmArtifactService } from "../application/wasm/WasmArtifactService.js";
import { WabtArtifactProvider } from "../wasm/WabtArtifactProvider.js";
import { INSPECT_WASM_ARTIFACT_CONTRACT } from "../contracts/wasm/wasmToolContracts.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
/** Compose the caller-supplied offline toolchain without acquisition or import-time I/O. */
export const createWasmArtifactService = (
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
  settings?: AnalysisSettingsReader,
): WasmArtifactService =>
  new WasmArtifactService(new WabtArtifactProvider(environment), settings);

/**
 * Internal static descriptor for one named domain operation and its lifetime.
 * CLI/MCP share this binding; the service keeps failed resource ownership so
 * close can be retried. Construction performs no acquisition or target I/O.
 */
export const wasmArtifactModule = {
  contract: INSPECT_WASM_ARTIFACT_CONTRACT,
  cliCommand: CLI_COMMANDS.inspectWasmArtifact,
  create(
    environment: Readonly<NodeJS.ProcessEnv>,
    injected?: WasmArtifactService,
    settings?: AnalysisSettingsReader,
  ): Pick<WasmArtifactService, "inspect" | "close"> {
    const service =
      injected ?? createWasmArtifactService(environment, settings);
    return {
      inspect: service.inspect.bind(service),
      close: service.close.bind(service),
    };
  },
} as const;
