import { selectArtifactCommandPath } from "../process/ArtifactCommandPath.js";
import {
  pcapCaptureHostSupported,
  PCAP_CAPTURE_UNSUPPORTED_HOST_REASON,
} from "../domain/pcap/pcapAnalysis.js";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, isAbsolute } from "node:path";
import {
  AnalysisError,
  type AnalysisCapturedOutput,
} from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import type { ArtifactAnalysisResources } from "../process/ArtifactAnalysisResources.js";
import {
  BOUNDED_PRODUCER_LIMITS,
  prlimitCeilingArguments,
} from "../process/LinuxResourceLimits.js";
import type { runPcapCommand } from "./PcapCommand.js";
import type { ArtifactCommandPath } from "../process/ArtifactCommandPath.js";

const PRLIMIT_COMMAND_ENV = "REA_TSHARK_PRLIMIT_COMMAND";
/** Capture CPU ceiling, in seconds. */
const PCAP_CPU_SECONDS = 300;

/** Own native capture admission and the exact enforced resource profile. */
export const preparePcapNativeBound = async (
  environment: Readonly<Record<string, string | undefined>>,
  resources: ArtifactAnalysisResources,
  probe: (
    selected: ArtifactCommandPath,
    arguments_: string[],
  ) => Promise<{
    readonly stdout: string;
    readonly capturedOutput: AnalysisCapturedOutput;
  }>,
  signal?: AbortSignal,
  operation:
    | "inspect_pcap_client"
    | "inspect_pcap_capture" = "inspect_pcap_capture",
): Promise<{
  nativeBound: NonNullable<Parameters<typeof runPcapCommand>[0]["nativeBound"]>;
  limitations: readonly string[];
}> => {
  if (process.platform === "win32") {
    return {
      nativeBound: {
        memoryLimitBytes: BOUNDED_PRODUCER_LIMITS.address_space_bytes,
      },
      limitations: [
        "Each owned Windows tool tree has a 1 GiB Job Object committed-memory limit; this is not a machine-wide quota.",
      ],
    };
  }
  if (!pcapCaptureHostSupported(process.platform)) {
    const reason = PCAP_CAPTURE_UNSUPPORTED_HOST_REASON;
    throw new AnalysisCapabilityUnavailableError("pcap", operation, reason, {
      userMessage: reason,
    });
  }
  const configured = environment[PRLIMIT_COMMAND_ENV] ?? "/usr/bin/prlimit";
  let probeFailure: AnalysisError | undefined;
  let capturedOutput: AnalysisCapturedOutput | undefined;
  try {
    if (!isAbsolute(configured))
      throw new Error(`${PRLIMIT_COMMAND_ENV} must be absolute.`);
    const selection = await selectArtifactCommandPath(configured, signal);
    if (!(await stat(selection.resolvedPath)).isFile())
      throw new Error("The selected limiter is not a regular file.");
    await access(selection.resolvedPath, constants.X_OK);
    const readProbe = async (argument: "--version" | "--help") => {
      try {
        const output = await probe(selection, [argument]);
        capturedOutput = output.capturedOutput;
        return output.stdout;
      } catch (cause) {
        if (
          (cause instanceof AnalysisCapabilityUnavailableError ||
            cause instanceof AnalysisOutputError) &&
          !cause.cleanupIncomplete
        ) {
          probeFailure = cause;
          throw new Error(
            cause instanceof AnalysisOutputError
              ? `The selected limiter produced unreadable ${argument === "--version" ? "version" : "help"} output.`
              : "The selected limiter could not be run.",
            { cause },
          );
        }
        throw cause;
      }
    };
    const version = await readProbe("--version");
    const prefix = `${basename(selection.invocationPath)} from util-linux `;
    if (
      !version.startsWith(prefix) ||
      version.slice(prefix.length).trim() === ""
    )
      throw new Error(
        "The selected limiter did not report a util-linux prlimit version.",
      );
    const help = await readProbe("--help");
    for (const flag of ["--as", "--fsize", "--cpu", "--core"]) {
      if (!new RegExp(`(?:^|\\s)${flag}(?:[=\\[\\s,]|$)`, "u").test(help))
        throw new Error(`The selected limiter does not advertise ${flag}.`);
    }
    const limits = await resources.readLimits({
      address_space_bytes: BOUNDED_PRODUCER_LIMITS.address_space_bytes,
      file_bytes: BOUNDED_PRODUCER_LIMITS.file_bytes,
      cpu_seconds: PCAP_CPU_SECONDS,
    });
    const nativeBound = {
      limiter: {
        command: selection,
        arguments: prlimitCeilingArguments(limits),
      },
    };
    const limitations = [
      `Linux prlimit preserves stricter inherited ceilings: ${limits.address_space_bytes} bytes of per-process address space, ${limits.file_bytes} bytes per file and ${limits.cpu_seconds} CPU seconds; core dumps are disabled. These are not aggregate machine quotas.`,
    ];
    return { nativeBound, limitations };
  } catch (cause) {
    if (signal?.aborted === true && !(cause instanceof AnalysisError))
      throw new AnalysisCancelledError(operation, {
        cause: signal.reason,
      });
    if (cause instanceof AnalysisError) throw cause;
    const reason =
      "Cannot establish the selected Linux resource limiter before processing capture bytes.";
    throw new AnalysisCapabilityUnavailableError("pcap", operation, reason, {
      cause,
      capturedOutput: probeFailure?.capturedOutput ?? capturedOutput,
      diagnostics: {
        ...probeFailure?.diagnostics,
        configuration_key: PRLIMIT_COMMAND_ENV,
        configured,
      },
      userMessage: `${reason} (${cause instanceof Error ? cause.message : String(cause)}) Check that ${PRLIMIT_COMMAND_ENV} (default /usr/bin/prlimit) names an absolute, executable util-linux prlimit.`,
    });
  }
};
