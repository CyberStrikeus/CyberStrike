import { EvmInterfaceService } from "../application/evm/EvmInterfaceService.js";
import {
  EvmoleInterfaceProvider,
  evmHostSupported,
  evmLimiterAvailability,
} from "../evm/EvmoleInterfaceProvider.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { INSPECT_EVM_INTERFACE_CONTRACT } from "../contracts/evm/evmToolContracts.js";

/** Compose offline interface analysis without import-time I/O or dependency acquisition. */
export const createEvmInterfaceService = (
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): EvmInterfaceService =>
  new EvmInterfaceService(new EvmoleInterfaceProvider(environment));

export { evmHostSupported, evmLimiterAvailability };

/**
 * Static binding of the existing operation, command and fresh service factory.
 * The host owns injected service identity and its retryable cleanup lifetime.
 * Construction performs no acquisition, target I/O or import-time execution.
 */
export const evmInterfaceModule = {
  contract: INSPECT_EVM_INTERFACE_CONTRACT,
  cliCommand: CLI_COMMANDS.inspectEvmInterface,
  create: createEvmInterfaceService,
} as const;
