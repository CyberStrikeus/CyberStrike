import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";
import { PcapAnalysisService } from "../application/pcap/PcapAnalysisService.js";
import type { PcapAnalysisPort } from "../application/pcap/PcapAnalysisPort.js";
import { createPcapAnalysisProvider } from "../composition/pcap.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { PcapOperation } from "../domain/pcap/pcapAnalysis.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { bindCliEvidenceCallerPath } from "./cliEvidenceCallerPath.js";

/** Expose the same explicit pcap requests through one-shot CLI commands. */
export const registerPcapCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
  provider: PcapAnalysisPort = createPcapAnalysisProvider(environment),
): void => {
  const service = new PcapAnalysisService(provider);
  const execute = (
    name: string,
    operation: PcapOperation,
    input: unknown,
    callerPath?: string,
  ) =>
    withCommandCancellation((signal) =>
      logCliCommand(logger, name, () =>
        finishAnalysisCommand(
          callerPath === undefined
            ? () => service.execute(operation, input, { signal })
            : bindCliEvidenceCallerPath(callerPath, () =>
                service.execute(operation, input, { signal }),
              ),
          { close: () => provider.close() },
          "pcap",
          operation,
          signal,
        ).then(projectCliAnalysisResult),
      ),
    );

  cli.command(CLI_COMMANDS.inspectPcapClient, {
    description:
      "Inspect the caller-selected tshark and capinfos binaries without reading a capture",
    args: z.object({}),
    run: () =>
      execute(CLI_COMMANDS.inspectPcapClient, "inspect_pcap_client", {}),
  });
  cli.command(CLI_COMMANDS.inspectPcapCapture, {
    description:
      "Inspect one pcap/pcapng capture: endpoints, DNS, TLS SNI, and protocol distribution",
    args: z.object({
      path: z
        .string()
        .min(1)
        .describe("Local pcap or pcapng capture file to inspect"),
    }),
    run: ({ args }) =>
      execute(
        CLI_COMMANDS.inspectPcapCapture,
        "inspect_pcap_capture",
        {
          path: args.path,
        },
        args.path,
      ),
  });
};
