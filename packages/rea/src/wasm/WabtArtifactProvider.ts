import { WabtAdmissionError } from "./WabtAdmissionError.js";
import { randomUUID, createHash } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { appendCallerPath } from "../filesystem/callerPath.js";
import type {
  WasmArtifactExecutionOptions,
  WasmArtifactExecution,
  WasmArtifactPort,
} from "../application/wasm/WasmArtifactPort.js";
import { createAnalysisExecution } from "../application/AnalysisProvider.js";
import {
  completedStableArtifact,
  readStableArtifact,
  type StableArtifactSnapshot,
} from "../artifacts/readStableArtifact.js";
import {
  ArtifactResourceScope,
  ArtifactResourceRetryFailure,
} from "../artifacts/ArtifactResourceScope.js";
import { AnalysisCleanupLeaseGroup } from "../artifacts/AnalysisCleanupLease.js";
import { bindArtifactFileCleanup } from "../artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type {
  AnalysisError,
  AnalysisCapturedOutput,
} from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisArtifactChangedError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { createEvidence } from "../domain/evidence.js";
import { createAnalysisExecutionEvidence } from "../domain/analysisObservation.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  wasmArtifactSchema,
  DEFAULT_WASM_COMMAND_TIMEOUT_MS,
  type InspectWasmArtifactInput,
  type WasmArtifact,
} from "../domain/wasm/wasmArtifact.js";
import { err, ok, type Result } from "../domain/result.js";
import { runOwnedCommand } from "../process/OwnedCommand.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import { artifactCommandOutput } from "../process/ArtifactAnalysisResources.js";
import {
  assertArtifactCommandPath,
  selectArtifactCommandPath,
  type ArtifactCommandPath,
} from "../process/ArtifactCommandPath.js";
import { WabtRuntime } from "./WabtRuntime.js";
import {
  WABT_PROVIDER_IDENTITY,
  WABT_LIMITS,
  WABT_VERSION,
} from "./WabtRelease.js";
import {
  wabtFailure,
  wabtConfigurationRecoveryAction,
  type WabtVersionProbe,
} from "./WabtFailures.js";
import { parseWabtOutput } from "./WabtOutput.js";
import { parseWabtWat } from "./WabtWat.js";
import { associateWasmGlue } from "./WasmGlueAdapter.js";

type Launcher = NonNullable<Parameters<typeof runOwnedCommand>[2]>["launcher"];
type AcquiredGlue =
  | WasmArtifact["glue"][number]
  | {
      readonly artifact: WasmArtifact["glue"][number]["artifact"];
      readonly parse_status: "not-performed";
      readonly references: [];
    };
const OPERATION = "inspect_wasm_artifact";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const warningOutput = (text: string): readonly string[] | null => {
  if (text === "") return [];
  const lines = text.trimEnd().split("\n");
  return lines.every(
    (line) =>
      /^\S+: warning: /u.test(line) ||
      /^[\da-f]+: error: invalid utf-8 encoding: section name$/u.test(line),
  )
    ? lines
    : null;
};
/** Run caller-supplied WABT against private copies of exactly selected bytes. */
export class WabtArtifactProvider implements WasmArtifactPort {
  readonly #resources = new ArtifactResourceScope();
  constructor(
    readonly environment: Readonly<NodeJS.ProcessEnv> = process.env,
    readonly launcher?: Launcher,
    readonly createRuntime: () => Promise<
      Pick<PrivateRuntimeRoot, "path" | "close">
    > = () => PrivateRuntimeRoot.create({ prefix: "rea-wabt-" }),
  ) {}
  /** Retry retained cleanup without discarding roots that still cannot be removed. */
  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw resourceCleanupFailure(cause);
    }
  }
  async inspect(
    input: InspectWasmArtifactInput,
    options?: WasmArtifactExecutionOptions,
  ): Promise<Result<WasmArtifactExecution, AnalysisError>> {
    const environment = snapshotEnvironment(this.environment);
    try {
      return await this.#resources.run(() =>
        this.#inspect(input, environment, options),
      );
    } catch (cause: unknown) {
      if (cause instanceof ArtifactResourceRetryFailure)
        return err(resourceCleanupFailure(cause));
      if (
        cause instanceof ArtifactReaderFailure &&
        cause.reason === "unavailable" &&
        cause.cleanup === undefined
      )
        return err(this.#closedError());
      return err(wabtFailure(cause, "artifact", input.path));
    }
  }

  #closedError(): AnalysisCapabilityUnavailableError {
    return new AnalysisCapabilityUnavailableError(
      WABT_PROVIDER_IDENTITY.id,
      OPERATION,
      "Provider is closing",
    );
  }

  async #inspect(
    input: InspectWasmArtifactInput,
    environment: Readonly<NodeJS.ProcessEnv>,
    options?: WasmArtifactExecutionOptions,
  ): Promise<Result<WasmArtifactExecution, AnalysisError>> {
    let runtime: WabtRuntime | undefined;
    let phase: "configuration" | "artifact" | "producer" = "configuration";
    let result: Result<WasmArtifactExecution, AnalysisError>;
    let capturedOutput: AnalysisCapturedOutput | undefined;
    let versionProbe: WabtVersionProbe | undefined;
    let artifactInput: { path: string; field: (string | number)[] } = {
      path: input.path,
      field: ["path"],
    };
    let toolProfile: WasmArtifact["tool_profile"] | undefined;
    let artifact: WasmArtifact["artifact"] | undefined;
    const candidates: WasmArtifact["candidates"] = [];
    const glue: AcquiredGlue[] = [];
    let validationState: "unknown" | "valid" = "unknown";
    const acquiredFacts = () => ({
      ...(artifact === undefined ? {} : { artifact }),
      ...(toolProfile === undefined ? {} : { tool_profile: toolProfile }),
      candidates: [...candidates],
      glue: [...glue],
    });
    const acquiredEvidence = () =>
      toolProfile === undefined
        ? undefined
        : createEvidence(
            artifact === undefined
              ? undefined
              : {
                  path: artifact.path,
                  format: "file",
                  sha256: artifact.sha256,
                },
            WABT_PROVIDER_IDENTITY,
            {
              operation: OPERATION,
              parameters: input,
              result: { ...acquiredFacts(), validation: validationState },
              confidence: "observed",
              locations: [{ kind: "artifact-path", path: input.path }],
              limitations: [
                artifact === undefined
                  ? "The selected WASM byte identity was not acquired. The admitted WABT tool profile does not establish module validity or runtime behavior."
                  : validationState === "valid"
                    ? "WABT validated the selected module, but inspection did not complete. Acquired file identities and glue references do not establish runtime loading or execution."
                    : "WABT validation has no completed result. Acquired file identities and glue references do not establish module validity, runtime loading or execution.",
              ],
            },
          );
    const readSelectedInput = async (
      path: string,
      onCompleted: (snapshot: StableArtifactSnapshot) => void,
    ): Promise<StableArtifactSnapshot> => {
      try {
        const snapshot = await readStableArtifact(
          path,
          WABT_LIMITS.inputBytes,
          options?.signal,
          undefined,
          this.#resources,
        );
        onCompleted(snapshot);
        return snapshot;
      } catch (cause: unknown) {
        const completed = completedStableArtifact(cause);
        if (completed !== undefined) onCompleted(completed);
        throw cause;
      }
    };
    const commandTimeoutMs =
      input.command_timeout_ms ??
      options?.commandTimeoutMs ??
      DEFAULT_WASM_COMMAND_TIMEOUT_MS;
    try {
      if (options?.signal?.aborted)
        throw new AnalysisCancelledError(OPERATION, {
          cause: options.signal.reason,
        });
      const directory = environment.REA_WABT_BIN_DIRECTORY ?? "";
      if (!isAbsolute(directory))
        throw new WabtAdmissionError("directory_not_absolute", {
          setting: "REA_WABT_BIN_DIRECTORY",
        });
      const commands: {
        tool: "wasm-validate" | "wasm-objdump" | "wasm2wat";
        path: string;
        sha256: string;
        version_banner: string;
        arguments: string[];
        selection: ArtifactCommandPath;
      }[] = [];
      for (const tool of [
        "wasm-validate",
        "wasm-objdump",
        "wasm2wat",
      ] as const) {
        const selection = await selectArtifactCommandPath(
          appendCallerPath(
            directory,
            `${tool}${process.platform === "win32" ? ".exe" : ""}`,
          ),
          options?.signal,
        );
        const path = selection.resolvedPath;
        await access(path, constants.X_OK);
        const binary = await readStableArtifact(
          path,
          WABT_LIMITS.toolBytes,
          options?.signal,
          undefined,
          this.#resources,
        );
        commands.push({
          tool,
          path,
          selection,
          sha256: binary.sha256,
          version_banner: "",
          arguments:
            tool === "wasm-objdump"
              ? ["-h", "-x", "module.wasm"]
              : [
                  "--enable-all",
                  "--ignore-custom-section-errors",
                  "module.wasm",
                ],
        });
      }
      const root = await this.createRuntime();
      runtime = new WabtRuntime(root);
      const snapshotPath = join(root.path, "module.wasm");
      let snapshotHash: string | undefined;
      const verifySnapshot = async () => {
        if (snapshotHash === undefined) return;
        const bytes = await readStableArtifact(
          snapshotPath,
          WABT_LIMITS.inputBytes,
          options?.signal,
          undefined,
          this.#resources,
        );
        if (bytes.sha256 !== snapshotHash)
          throw new AnalysisArtifactChangedError(
            OPERATION,
            input.path,
            "Private WASM snapshot bytes changed.",
            { capturedOutput },
          );
      };
      const execute = async (
        command: (typeof commands)[number],
        args: readonly string[],
        acceptNonZeroExit = false,
      ) => {
        capturedOutput = undefined;
        await assertArtifactCommandPath(command.selection, OPERATION, options);
        await verifySnapshot();
        const snapshot = await runOwnedCommand(
          {
            command: command.selection.invocationPath,
            arguments: args,
            cwd: root.path,
            // Trusted caller tools may be interpreter shims; run-token, parent
            // and process-group identity own cleanup after their exec handoff.
            expectedCommand: null,
            runId: `rea-wabt-${randomUUID()}`,
            hostEnvironment: environment,
          },
          {
            timeoutMs: commandTimeoutMs,
            diagnosticBytes: WABT_LIMITS.outputBytes,
            acceptNonZeroExit,
          },
          {
            ...(options?.signal === undefined
              ? {}
              : { signal: options.signal }),
            ...(this.launcher === undefined ? {} : { launcher: this.launcher }),
          },
        );
        capturedOutput = artifactCommandOutput(snapshot);
        await assertArtifactCommandPath(command.selection, OPERATION, {
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
          capturedOutput,
        });
        const current = await readStableArtifact(
          command.path,
          WABT_LIMITS.toolBytes,
          options?.signal,
          undefined,
          this.#resources,
        );
        if (current.sha256 !== command.sha256)
          throw new AnalysisOutputError(
            OPERATION,
            "Configured WABT executable changed during inspection.",
            { capturedOutput },
          );
        await verifySnapshot();
        return snapshot;
      };
      for (const command of commands) {
        versionProbe = {
          configuration_key: "REA_WABT_BIN_DIRECTORY",
          executable_path: command.path,
          tool: command.tool,
          expected_version: WABT_VERSION,
        };
        const version = await execute(command, ["--version"]);
        if (
          version.stdout.text.trim() !== WABT_VERSION ||
          version.stderr.text !== ""
        ) {
          const reason = `Unsupported ${command.tool} version banner; expected ${WABT_VERSION}.`;
          throw new AnalysisCapabilityUnavailableError(
            WABT_PROVIDER_IDENTITY.id,
            OPERATION,
            reason,
            {
              userMessage: reason,
              diagnostics: versionProbe,
              capturedOutput: {
                stdout: version.stdout.text,
                stderr: version.stderr.text,
                truncated: version.diagnosticTruncated === true,
              },
              remediationAction: wabtConfigurationRecoveryAction(),
            },
          );
        }
        command.version_banner = version.stdout.text;
        versionProbe = undefined;
      }
      // Success and validation failure report the same admitted tool/execution facts.
      toolProfile = {
        source: "https://github.com/WebAssembly/wabt",
        release: WABT_VERSION,
        source_commit: "ff0ef7e0009402740c805a9744c09b05be063e48",
        commands: commands.map(
          ({ selection: _selection, ...command }) => command,
        ),
        timeout_ms: commandTimeoutMs,
        output_budget_bytes: WABT_LIMITS.outputBytes,
      };
      capturedOutput = undefined;
      phase = "artifact";
      const selected = await readSelectedInput(input.path, (snapshot) => {
        const observed = {
          path: input.path,
          sha256: snapshot.sha256,
          bytes: snapshot.bytes.length,
        };
        artifact = observed;
        candidates.push(observed);
      });
      for (const path of new Set([input.path, ...input.candidate_paths])) {
        if (path === input.path) continue;
        artifactInput = {
          path,
          field: ["candidate_paths", input.candidate_paths.indexOf(path)],
        };
        await readSelectedInput(path, (snapshot) => {
          candidates.push({
            path,
            sha256: snapshot.sha256,
            bytes: snapshot.bytes.length,
          });
        });
      }
      for (const [index, path] of input.glue_paths.entries()) {
        artifactInput = { path, field: ["glue_paths", index] };
        const glueIndex = glue.length;
        const bytes = await readSelectedInput(path, (snapshot) => {
          glue.push({
            artifact: {
              path,
              sha256: snapshot.sha256,
              bytes: snapshot.bytes.length,
            },
            parse_status: "not-performed",
            references: [],
          });
        });
        const glueArtifact = {
          path,
          sha256: bytes.sha256,
          bytes: bytes.bytes.length,
        };
        try {
          // Keep source characters intact so locations match the hashed artifact.
          const source = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(bytes.bytes);
          glue[glueIndex] = {
            artifact: glueArtifact,
            ...associateWasmGlue(
              source,
              path,
              candidates.map((candidate) => candidate.path),
            ),
          };
        } catch (cause: unknown) {
          glue[glueIndex] = {
            artifact: glueArtifact,
            parse_status: "failed",
            references: [],
          };
          throw cause;
        }
      }
      phase = "producer";
      await writeFile(snapshotPath, selected.bytes, {
        flag: "wx",
        mode: 0o400,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      snapshotHash = selected.sha256;
      phase = "producer";
      const [validate, objdump, decode] = commands;
      if (
        validate === undefined ||
        objdump === undefined ||
        decode === undefined
      )
        throw new WabtAdmissionError("incomplete_tool_profile");
      const validation = await execute(validate, validate.arguments, true);
      if (validation.exitCode !== 0)
        throw new AnalysisInputError(
          OPERATION,
          {
            partialObservation: createEvidence(
              { path: input.path, format: "file", sha256: selected.sha256 },
              WABT_PROVIDER_IDENTITY,
              {
                operation: OPERATION,
                parameters: input,
                result: {
                  ...acquiredFacts(),
                  validation: "rejected-by-selected-profile",
                  exit_code: validation.exitCode ?? null,
                  stdout: validation.stdout.text,
                  stderr: validation.stderr.text,
                },
                confidence: "observed",
                locations: [{ kind: "artifact-path", path: input.path }],
                limitations: [
                  "WABT rejected these exact selected bytes with --enable-all and --ignore-custom-section-errors; no complete inspection or target execution occurred.",
                ],
              },
            ),
            capturedOutput: artifactCommandOutput(validation),
          },
          [
            {
              path: ["path"],
              reason: "invalid_format",
              message:
                "Selected bytes failed WABT validation with --enable-all and --ignore-custom-section-errors; inspect retained upstream diagnostics.",
            },
          ],
        );
      validationState = "valid";
      const customSectionWarnings: {
        tool: (typeof commands)[number]["tool"];
        text: string;
      }[] = [];
      const optionalLimitations: string[] = [];
      const retainWarnings = (
        tool: (typeof commands)[number]["tool"],
        output: typeof validation,
      ) => {
        const warnings = warningOutput(output.stderr.text);
        if (warnings === null)
          throw new AnalysisOutputError(
            OPERATION,
            "Unexpected WABT diagnostic output.",
            {
              capturedOutput: artifactCommandOutput(output),
            },
          );
        if (warnings.length > 0)
          customSectionWarnings.push({ tool, text: output.stderr.text });
      };
      retainWarnings("wasm-validate", validation);
      const dump = await execute(objdump, objdump.arguments);
      retainWarnings("wasm-objdump", dump);
      const wat = await execute(decode, decode.arguments);
      retainWarnings("wasm2wat", wat);
      if (!wat.stdout.text.startsWith("(module"))
        throw new AnalysisOutputError(
          OPERATION,
          "Unexpected WABT decoding output.",
          { capturedOutput },
        );
      const {
        imports,
        exports,
        customSectionNames,
        debugModuleNames,
        debugNameMetadata: decodedNameMetadata,
        interface: interfaceFacts,
      } = parseWabtWat(wat.stdout.text);
      // WAT framing reads module names, not every inner name map. A producer
      // warning may concern a skipped body or another custom section; without
      // section attribution it cannot establish complete debug-name coverage.
      capturedOutput = artifactCommandOutput(dump);
      const { sections, headers, details, invalidNameEnds } = parseWabtOutput(
        dump.stdout.text,
        selected.bytes.length,
        customSectionNames,
        debugModuleNames,
        selected.bytes,
      );
      for (const warning of customSectionWarnings) {
        for (const line of warning.text.trimEnd().split("\n")) {
          const error =
            /^([\da-f]+): error: invalid utf-8 encoding: section name$/u.exec(
              line,
            );
          if (
            error !== null &&
            !invalidNameEnds.includes(Number.parseInt(error[1] ?? "", 16))
          )
            throw new AnalysisOutputError(
              OPERATION,
              "Unexpected WABT diagnostic output.",
              {
                capturedOutput: artifactCommandOutput(
                  warning.tool === "wasm-validate"
                    ? validation
                    : warning.tool === "wasm-objdump"
                      ? dump
                      : wat,
                ),
              },
            );
        }
      }
      const debugNameMetadata =
        invalidNameEnds.length > 0 ||
        (decodedNameMetadata === "complete" && customSectionWarnings.length > 0)
          ? "unknown"
          : decodedNameMetadata;
      if (debugNameMetadata === "uninterpretable")
        optionalLimitations.push(
          "The optional WebAssembly name custom section could not be fully interpreted; its original payload remains in decoded WAT. Observed module-name displays are retained for producer framing; complete debug-name coverage remains unknown.",
        );
      else if (debugNameMetadata === "unknown")
        optionalLimitations.push(
          "WABT custom-section warning attribution is unknown, so complete debug-name coverage remains unknown. Observed module-name displays are retained for producer framing.",
        );
      if (customSectionWarnings.length > 0)
        optionalLimitations.push(
          "WABT reported optional custom-section interpretation warnings; exact warning output is retained in custom_section_warnings.",
        );
      if (invalidNameEnds.length > 0)
        optionalLimitations.push(
          "An optional custom-section name is invalid UTF-8 and was omitted from decoded WAT. Its original bytes and objdump section range remain available; its identity and debug-name coverage are unknown.",
        );
      const limitations = [
        "WAT is a decoded representation, not original source or proof of runtime behavior. Custom annotations may retain payloads, but WAT does not establish original binary layout or round-trip byte identity. Original bytes and objdump output remain authoritative.",
        "Imports and exports retain exact top-level WABT WAT forms. Names remain escaped producer text; unescaped objdump display names are not parsed as unambiguous identifiers.",
        "JavaScript references are AST-observed static literals only. Candidate matches are associations, not proven data flow, URL-to-file identity or runtime loading. Computed references and aliases are not resolved.",
        "No target execution or implicit fetch. WABT tools are trusted caller-supplied executables; SHA-256 identifies their bytes, not publisher authenticity. No OS memory sandbox is claimed.",
        `Each WABT command has a ${String(commandTimeoutMs)} ms deadline and a fixed 32 MiB combined output budget. The deadline is not a whole-inspection budget. Oversized output fails instead of producing truncated success.`,
        ...optionalLimitations,
      ];
      const report = wasmArtifactSchema.parse({
        artifact,
        validation: "valid",
        sections,
        imports,
        exports,
        interface: interfaceFacts,
        debug_name_metadata: debugNameMetadata,
        custom_section_warnings: customSectionWarnings,
        headers,
        details,
        wat: {
          text: wat.stdout.text,
          sha256: digest(wat.stdout.text),
          representation: "decoded-wat",
        },
        tool_profile: toolProfile,
        candidates,
        glue,
        runtime_execution: "not-performed",
        network_fetch: "not-performed",
        limitations,
      });
      result = ok(
        createAnalysisExecution(report, WABT_PROVIDER_IDENTITY, {
          subject: {
            path: input.path,
            format: "file",
            sha256: selected.sha256,
          },
          locations: [{ kind: "artifact-path", path: input.path }],
          limitations,
        }),
      );
    } catch (cause: unknown) {
      const failure = wabtFailure(
        cause,
        phase,
        phase === "artifact" ? artifactInput.path : input.path,
        {
          commandTimeoutMs,
          inputField: artifactInput.field,
          observedOutput: capturedOutput,
          ...(versionProbe === undefined ? {} : { versionProbe }),
        },
      );
      if (failure.partialObservation === undefined) {
        const partial = acquiredEvidence();
        if (partial !== undefined) failure.retainPartialObservation(partial);
      }
      runtime?.retainCommandFailure(cause, failure, this.#resources);
      result = err(failure);
    }
    if (runtime !== undefined) {
      const cleanup = await this.#resources.release({
        kind: "lease",
        resource: runtime.path,
        lease: runtime.lease,
      });
      let partialObservation = result.ok
        ? undefined
        : result.error.partialObservation;
      if (
        result.ok &&
        (options?.signal?.aborted || cleanup.kind === "failed")
      ) {
        partialObservation = createAnalysisExecutionEvidence(
          OPERATION,
          input,
          result.value,
          "observed",
        );
      }
      if (result.ok && options?.signal?.aborted) {
        result = err(
          new AnalysisCancelledError(OPERATION, {
            cause: options?.signal?.reason,
            ...(partialObservation === undefined ? {} : { partialObservation }),
          }),
        );
      }
      if (cleanup.kind === "failed") {
        const cause = cleanup.cause;
        const retainedObservation = result.ok
          ? partialObservation
          : result.error.partialObservation;
        const failure = new ProviderCleanupError(
          WABT_PROVIDER_IDENTITY.id,
          [runtime.path],
          {
            reason: cause instanceof Error ? cause.message : String(cause),
            previous_error: result.ok
              ? null
              : projectAnalysisError(result.error),
          },
          {
            operation: OPERATION,
            cause,
            ...(retainedObservation === undefined
              ? {}
              : { partialObservation: retainedObservation }),
          },
        );
        new AnalysisCleanupLeaseGroup(failure, [runtime.lease]);
        result = result.ok
          ? err(failure)
          : err(
              analysisErrorWithCleanupFailure(
                result.error,
                failure,
                OPERATION,
              ).bindCleanupDependencies([result.error, failure]),
            );
      }
    }
    return result;
  }
}

/** Retry errors follow their exact retained leases, including partially released groups. */
const resourceCleanupFailure = (cause: unknown): ProviderCleanupError => {
  const cleanup =
    cause instanceof ArtifactReaderFailure ? cause.cleanup : undefined;
  const failure = new ProviderCleanupError(
    WABT_PROVIDER_IDENTITY.id,
    cleanup?.resources ?? ["artifact-resources"],
    {
      reason:
        cleanup?.reason ??
        (cause instanceof Error ? cause.message : String(cause)),
    },
    { operation: OPERATION, cause },
  );
  bindArtifactFileCleanup(cause, failure);
  return failure;
};
