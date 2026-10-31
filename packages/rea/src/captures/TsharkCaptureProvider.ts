import { artifactFileCancellationCause } from "../artifacts/ArtifactFileOperation.js";
import {
  type InspectPacketFieldsInput,
  packetFieldsCatalogSchema,
} from "../domain/captures/packetFields.js";
import {
  parseFieldDiscovery,
  FieldDiscoveryBudgetError,
  FIELD_RECORD_BUDGET,
} from "./parseFieldDiscovery.js";
import {
  BOUNDED_PRODUCER_LIMITS as LIMITS,
  prlimitArgumentVector,
  readLinuxResourceLimits,
  type LinuxResourceLimits,
} from "../process/LinuxResourceLimits.js";
import { parsePacketOutput } from "./parsePacketOutput.js";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  createAnalysisExecution,
  type AnalysisExecution,
  type ExecutionOptions,
} from "../application/AnalysisProvider.js";
import type { PacketCapturePort } from "../application/captures/PacketCaptureService.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  ArtifactAnalysisResources,
  artifactCommandOutput,
  type ArtifactAnalysisRuntime,
} from "../process/ArtifactAnalysisResources.js";
import { readStableArtifact } from "../artifacts/readStableArtifact.js";
import {
  assertArtifactCommandPath,
  selectArtifactCommandPath,
} from "../process/ArtifactCommandPath.js";
import {
  AnalysisError,
  type AnalysisCapturedOutput,
} from "../domain/analysisErrorBase.js";
import {
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { createEvidence } from "../domain/evidence.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import {
  type InspectPacketCaptureInput,
  packetCaptureSchema,
} from "../domain/captures/packetCapture.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  runOwnedCommand,
  OwnedCommandFailure,
} from "../process/OwnedCommand.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import {
  TSHARK_COMMAND_ENV,
  assertWiresharkExecutableIdentity,
  wiresharkExecutableIdentity,
  locateWiresharkTool,
  parseWiresharkVersion,
  selectWiresharkTool,
} from "../pcap/PcapConfiguration.js";
import { privateWorkspaceFailure } from "../process/privateWorkspaceFailure.js";

const OPERATION = "inspect_packet_capture";
export const TSHARK_PROVIDER_IDENTITY = {
  id: "tshark-capture",
  name: "REA TShark capture adapter",
  version: "tshark@4",
} as const;
type Launcher = NonNullable<Parameters<typeof runOwnedCommand>[2]>["launcher"];

/** Packet inspection runs only on Linux; discovery and execution share this check. */
export const tsharkHostSupported = (platform: NodeJS.Platform): boolean =>
  platform === "linux";

/** Inspect selected capture files only, retaining cleanup ownership across failures. */
export class TsharkCaptureProvider implements PacketCapturePort {
  readonly #resources: ArtifactAnalysisResources;
  constructor(
    readonly environment: Readonly<NodeJS.ProcessEnv> = process.env,
    readonly launcher?: Launcher,
    readonly createRuntime: () => Promise<ArtifactAnalysisRuntime> = () =>
      PrivateRuntimeRoot.create({ prefix: "rea-tshark-" }),
    readonly platform: NodeJS.Platform = process.platform,
    readonly readArtifact: typeof readStableArtifact = readStableArtifact,
    readonly readLimits: typeof readLinuxResourceLimits = readLinuxResourceLimits,
  ) {
    this.#resources = new ArtifactAnalysisResources(
      TSHARK_PROVIDER_IDENTITY.id,
      OPERATION,
      readArtifact,
      readLimits,
      {
        message:
          "A packet inspection is already active; retry after it completes.",
        details: { max_concurrent_inspections: 1 },
      },
    );
  }
  inspect(
    input: InspectPacketCaptureInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    return this.#resources.run(
      () => this.#executeRequest(input, options),
      options?.signal,
    );
  }
  inspectFields(
    input: InspectPacketFieldsInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    return this.#resources.run(
      () => this.#executeRequest(input, options),
      options?.signal,
      "inspect_packet_fields",
    );
  }
  close(): Promise<void> {
    return this.#resources.close();
  }
  async #executeRequest(
    input: InspectPacketCaptureInput | InspectPacketFieldsInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const operation = "path" in input ? OPERATION : "inspect_packet_fields";
    // TShark 4.6.9 emits a 22.3 MB glossary; keep capture output capped at 4 MiB.
    const limits =
      "path" in input ? LIMITS : { ...LIMITS, output_bytes: 32 * 1024 * 1024 };
    let phase: "configuration" | "workspace" | "producer" | "integrity" =
      "configuration";
    let capturedOutput: AnalysisCapturedOutput | undefined;
    let resourcePath = "path" in input ? input.path : "TShark field glossary";
    let effectiveLimits: LinuxResourceLimits | undefined;
    let root: ArtifactAnalysisRuntime | undefined;
    let result: Result<AnalysisExecution, AnalysisError>;
    try {
      if (options?.signal?.aborted)
        throw new AnalysisCancelledError(operation, {
          cause: options.signal.reason,
        });
      await this.#resources.release();
      if (!tsharkHostSupported(this.platform))
        throw new Error(
          "Packet inspection requires Linux with util-linux prlimit and TShark 4.x (on PATH or through absolute REA_TSHARK_COMMAND) so expanded captures are processed under an enforced address-space limit.",
        );
      const selection = selectWiresharkTool(this.environment, "tshark");
      const configured = locateWiresharkTool(selection, this.environment);
      if (configured === undefined)
        throw new Error(
          `TShark 4.x was not found on PATH; add it to PATH or set absolute ${TSHARK_COMMAND_ENV}.`,
        );
      const selectedCommand = await selectArtifactCommandPath(
        configured,
        options?.signal,
      );
      const command = selectedCommand.resolvedPath;
      await access(command, constants.X_OK);
      const toolSnapshot = await this.#resources.read(
        command,
        64 * 1024 * 1024,
        options?.signal,
      );
      const tool = wiresharkExecutableIdentity(toolSnapshot);
      const configuredLimiter =
        this.environment.REA_TSHARK_PRLIMIT_COMMAND ?? "/usr/bin/prlimit";
      if (!isAbsolute(configuredLimiter))
        throw new Error("REA_TSHARK_PRLIMIT_COMMAND must be absolute.");
      const selectedLimiter = await selectArtifactCommandPath(
        configuredLimiter,
        options?.signal,
      );
      const limiter = selectedLimiter.resolvedPath;
      await access(limiter, constants.X_OK);
      const limiterIdentity = await this.#resources.read(
        limiter,
        64 * 1024 * 1024,
        options?.signal,
      );
      effectiveLimits = await this.#resources.readLimits(limits);
      const limitArguments = prlimitArgumentVector(
        effectiveLimits,
        selectedCommand.invocationPath,
      );
      phase = "workspace";
      root = await this.createRuntime();
      this.#resources.retain(root, undefined);
      const snapshotPath = join(root.path, "capture");
      const configurationPath = join(root.path, "configuration");
      await mkdir(configurationPath, { mode: 0o700 });
      const execute = async (args: readonly string[]) => {
        capturedOutput = undefined;
        await assertArtifactCommandPath(selectedCommand, operation, {
          signal: options?.signal,
        });
        await assertArtifactCommandPath(selectedLimiter, operation, {
          signal: options?.signal,
        });
        const output = await runOwnedCommand(
          {
            command: selectedLimiter.invocationPath,
            arguments: [...limitArguments, ...args],
            ...(root === undefined ? {} : { cwd: root.path }),
            expectedCommand: null,
            runId: `rea-tshark-${randomUUID()}`,
            hostEnvironment: {
              ...this.environment,
              WIRESHARK_CONFIG_DIR: configurationPath,
            },
          },
          {
            timeoutMs: limits.command_timeout_ms,
            diagnosticBytes: limits.output_bytes,
            acceptNonZeroExit: true,
          },
          {
            ...(options?.signal === undefined
              ? {}
              : { signal: options.signal }),
            ...(this.launcher === undefined ? {} : { launcher: this.launcher }),
          },
        );
        capturedOutput = artifactCommandOutput(output);
        await assertArtifactCommandPath(selectedCommand, operation, {
          capturedOutput,
        });
        await assertArtifactCommandPath(selectedLimiter, operation, {
          capturedOutput,
        });
        const current = await this.#resources.readCommandAfterRun(
          command,
          { path: limiter, sha256: limiterIdentity.sha256 },
          capturedOutput,
          operation,
        );
        assertWiresharkExecutableIdentity(
          operation,
          command,
          tool,
          wiresharkExecutableIdentity(current),
          { capturedOutput },
        );
        resourcePath = "path" in input ? input.path : command;
        if (output.exitCode !== 0)
          throw new ProviderAdapterError(
            TSHARK_PROVIDER_IDENTITY.id,
            operation,
            {
              diagnostics: {
                exit_code: output.exitCode ?? null,
                stdout: output.stdout.text,
                stderr: output.stderr.text,
              },
            },
          );
        return output;
      };
      phase = "configuration";
      const version = await execute(["--version"]);
      if (parseWiresharkVersion(version.stdout.text, "tshark") === null)
        throw new Error(
          "Expected TShark 4.x; inspect the selected installation.",
        );
      const metadata = (args: readonly string[], diagnostics: string) => ({
        diagnostics,
        tool: {
          configured_path: configured,
          selection_source: selection.source,
          path: command,
          sha256: tool.sha256,
          version_banner: version.stdout.text,
          version_diagnostics: version.stderr.text,
          arguments: [...args],
        },
        resource_limiter: {
          configured_path: configuredLimiter,
          path: limiter,
          sha256: limiterIdentity.sha256,
          arguments: limitArguments,
        },
        limits: { ...limits, ...effectiveLimits },
        hardware_acquisition: "not-performed" as const,
      });
      if (!("path" in input)) {
        phase = "producer";
        const args = ["-G", "fields"];
        const output = await execute(args);
        const report = packetFieldsCatalogSchema.parse({
          selection: input,
          ...parseFieldDiscovery(output.stdout.text, input),
          ...metadata(args, output.stderr.text),
          limits: {
            ...limits,
            ...effectiveLimits,
            record_budget_bytes: FIELD_RECORD_BUDGET,
          },
          configuration: "private-empty-personal-profile",
        });
        result = ok(
          createAnalysisExecution(report, TSHARK_PROVIDER_IDENTITY, {
            subject: { path: command, sha256: tool.sha256, format: "file" },
            limitations: [
              "Protocol and field registrations describe the selected installation, not traffic observed in a capture. Duplicate abbreviations remain distinct producer records with source line numbers.",
              "Each request probes again without caching. The private empty personal profile does not fingerprint or isolate installed libraries, global configuration or plugins; they remain trusted.",
              "No capture file, interface or device is opened. Resource ceilings do not constitute an OS sandbox. Glossary output is capped at 32 MiB and selected record representation at 8 MiB before expansion.",
            ],
          }),
        );
      } else {
        const selected = await this.#resources.readSelectedArtifact({
          path: input.path,
          maximumBytes: LIMITS.input_bytes,
          allowanceName: "the fixed packet-capture input allowance",
          observedOutput: capturedOutput,
          signal: options?.signal,
        });
        phase = "workspace";
        await writeFile(snapshotPath, selected.bytes, {
          flag: "wx",
          mode: 0o400,
        });
        phase = "producer";
        const args = [
          "-n",
          "-r",
          "capture",
          "-T",
          "json",
          "--no-duplicate-keys",
          "--temp-dir=.",
          ...(input.two_pass ? ["-2"] : []),
          ...(input.packet_limit === null
            ? []
            : ["-c", String(input.packet_limit)]),
          ...(input.display_filter === null
            ? []
            : ["-Y", input.display_filter]),
          ...input.decode_as.flatMap((value) => ["-d", value]),
          ...[...new Set(["frame.number", ...input.fields])].flatMap(
            (field) => ["-e", field],
          ),
        ];
        const output = await execute(args);
        phase = "integrity";
        resourcePath = snapshotPath;
        if (
          (await this.#resources.read(snapshotPath, LIMITS.input_bytes))
            .sha256 !== selected.sha256
        )
          throw new AnalysisArtifactChangedError(
            operation,
            snapshotPath,
            "TShark changed the private capture copy.",
            capturedOutput === undefined ? {} : { capturedOutput },
          );
        phase = "producer";
        resourcePath = "path" in input ? input.path : command;
        // TShark resolves `-e` aliases before emitting canonical field names;
        // the command arguments, not output names, own field selection.
        const matchingPackets = parsePacketOutput(output.stdout.text);
        const start = Math.min(input.match_offset, matchingPackets.length);
        const end =
          input.match_limit === null
            ? matchingPackets.length
            : start +
              Math.min(input.match_limit, matchingPackets.length - start);
        const packets = matchingPackets.slice(start, end);
        const report = packetCaptureSchema.parse({
          artifact: {
            path: input.path,
            sha256: selected.sha256,
            bytes: selected.bytes.length,
          },
          selection: input,
          packets,
          output_window: {
            matching_packets: matchingPackets.length,
            returned_packets: packets.length,
            has_more: end < matchingPackets.length,
          },
          read_scope:
            input.packet_limit === null ? "to-eof" : "up-to-input-packet-limit",
          configuration: "private-empty-personal-profile",
          ...metadata(args, output.stderr.text),
        });
        result = ok(
          createAnalysisExecution(report, TSHARK_PROVIDER_IDENTITY, {
            subject: {
              path: input.path,
              sha256: selected.sha256,
              format: "file",
            },
            locations: [{ kind: "artifact-path", path: input.path }],
            limitations: [
              "Fields are TShark dissector observations under the selected filter/decode-as/pass settings, not independently verified protocol semantics. Missing fields are absent from the producer output, not known zero or empty values.",
              "Packet limits count input packets before display filtering. Filtered results do not establish whole-capture or device traffic absence. Two-pass reassembly cannot recover bytes missing from the recording or beyond the read limit.",
              "Repeated field values remain ordered string arrays; raw packet bytes are included only when explicitly selected as a supported field. Export index/score metadata are omitted. All stderr, including warnings on exit zero, is retained.",
              "A private empty personal configuration is used. Installed libraries, global configuration and dissector plugins are trusted and not fully fingerprinted. File-only analysis and disabled name resolution do not constitute an OS sandbox.",
              "Linux prlimit enforces soft and hard ceilings before execution, preserving stricter inherited limits: at most 1 GiB address space per process, 64 MiB per file, 30 CPU seconds and no core dumps. Effective limits are reported. Resident input is capped at 32 MiB, each command at 30 wall-clock seconds and combined output at 4 MiB. Output overflow fails. These are per-process/per-file limits, not aggregate memory or filesystem quotas; caller-supplied tools and the limiter are trusted. REA retains the tighter inherited limit. This release has no runtime override.",
            ],
          }),
        );
      }
    } catch (cause) {
      if (
        root !== undefined &&
        cause instanceof OwnedCommandFailure &&
        cause.cleanupOwner !== undefined
      )
        this.#resources.retain(root, cause.cleanupOwner);
      result = err(
        this.#failure(
          cause,
          phase,
          resourcePath,
          root?.path ?? null,
          effectiveLimits,
          capturedOutput,
          operation,
          limits,
        ),
      );
    }
    return this.#resources.finish(
      result,
      (execution) =>
        createEvidence(execution.subject ?? undefined, execution.provider, {
          operation,
          parameters: input,
          result: execution.result,
          confidence: "observed",
          locations: execution.locations,
          limitations: execution.limitations,
        }),
      operation,
      options?.signal,
    );
  }
  #failure(
    cause: unknown,
    phase: "configuration" | "workspace" | "producer" | "integrity",
    path: string,
    workspacePath: string | null,
    effectiveLimits: LinuxResourceLimits | undefined,
    observedOutput: AnalysisCapturedOutput | undefined,
    operation = OPERATION,
    limits: {
      readonly output_bytes: number;
      readonly command_timeout_ms: number;
    } = LIMITS,
  ): AnalysisError {
    if (cause instanceof AnalysisError) return cause;
    if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined)
      return this.#resources.cleanupFailure(
        cause,
        (primary) =>
          this.#failure(
            primary,
            phase,
            path,
            workspacePath,
            effectiveLimits,
            observedOutput,
            operation,
            limits,
          ),
        observedOutput,
        operation,
      );
    if (cause instanceof ArtifactReaderFailure && cause.reason === "cancelled")
      return new AnalysisCancelledError(operation, {
        cause: artifactFileCancellationCause(cause),
        ...(observedOutput === undefined
          ? {}
          : { capturedOutput: observedOutput }),
      });
    if (cause instanceof FieldDiscoveryBudgetError)
      return new AnalysisResourceConstraintError(
        operation,
        "memory",
        cause.message,
        { record_budget_bytes: FIELD_RECORD_BUDGET },
        {
          cause,
          ...(observedOutput === undefined
            ? {}
            : { capturedOutput: observedOutput }),
          ...fixedAllowanceOptions(
            "The packet-field discovery record allowance",
            "capture",
          ),
        },
      );
    const reason = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof OwnedCommandFailure)
      return this.#resources.commandFailure(
        cause,
        limits,
        effectiveLimits,
        operation,
      );
    if (phase === "workspace")
      return privateWorkspaceFailure(
        TSHARK_PROVIDER_IDENTITY.id,
        operation,
        cause,
        workspacePath,
      );
    if (phase === "integrity")
      return this.#resources.integrityFailure(
        cause,
        path,
        observedOutput,
        operation,
      );
    if (phase === "configuration")
      return new AnalysisCapabilityUnavailableError(
        TSHARK_PROVIDER_IDENTITY.id,
        operation,
        reason,
        {
          cause,
          ...(observedOutput === undefined
            ? {}
            : { capturedOutput: observedOutput }),
          userMessage: `${reason} On Linux, supply TShark 4.x on PATH or through absolute REA_TSHARK_COMMAND, and util-linux prlimit through REA_TSHARK_PRLIMIT_COMMAND (default /usr/bin/prlimit).`,
        },
      );
    if (cause instanceof ArtifactReaderFailure && cause.reason === "integrity")
      return new AnalysisArtifactChangedError(operation, path, reason, {
        cause,
      });
    return new AnalysisOutputError(operation, reason, {
      cause,
      ...(observedOutput === undefined
        ? {}
        : { capturedOutput: observedOutput }),
    });
  }
}
