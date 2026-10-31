import { parseAnalysisInput } from "../AnalysisInput.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import type {
  Il2cppSeedOutput,
  Il2cppSeedWriterPort,
  Il2cppSeedReceipt,
} from "./Il2cppSeedWriterPort.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import {
  requireAnalysisViewRetention,
  summarizeRetainedAnalysis,
  type AnalysisViewRetention,
} from "../analysisView/AnalysisViewService.js";
import type { Il2cppMetadataPort } from "./Il2cppMetadataPort.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  il2cppMetadataSchema,
  inspectIl2cppMetadataInputSchema,
  type Il2cppMetadata,
  type Il2cppMetadataProviderInput,
} from "../../domain/il2cpp/il2cppMetadata.js";
import { err, ok, type Result } from "../../domain/result.js";

const OPERATION = "inspect_il2cpp_metadata";
const NO_RETENTION: AnalysisViewRetention = {
  evidenceById: undefined,
  recordEvidence: undefined,
};

/** Shared exact input validation, artifact-bound Evidence and summary delivery for CLI and MCP. */
export class Il2cppMetadataService {
  constructor(
    readonly provider: Il2cppMetadataPort,
    private readonly seeds?: Il2cppSeedWriterPort,
  ) {}

  async close(): Promise<void> {
    let failure: AnalysisError | undefined;
    for (const close of [
      () => this.provider.close(),
      () => this.seeds?.close(),
    ]) {
      try {
        await close();
      } catch (cause) {
        const next =
          cause instanceof AnalysisError
            ? cause
            : new ProviderCleanupError(
                this.provider.identity.id,
                [],
                {
                  reason:
                    cause instanceof Error ? cause.message : String(cause),
                },
                { cause, operation: OPERATION },
              );
        failure =
          failure === undefined
            ? next
            : analysisErrorWithCleanupFailure(
                failure,
                next,
                OPERATION,
              ).bindCleanupDependencies([failure, next]);
      }
    }
    if (failure !== undefined) throw failure;
  }

  inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
    retention: AnalysisViewRetention = NO_RETENTION,
  ): Promise<Result<Evidence, AnalysisError>> {
    return this.#inspect(rawInput, options, retention);
  }

  /** Explicit output workflow for CLI/SDK callers; ordinary inspection stays read-only. */
  inspectWithGhidraSeeds(
    rawInput: unknown,
    output: Il2cppSeedOutput,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    return this.#inspect(rawInput, options, NO_RETENTION, output);
  }

  /** Inspect one explicitly selected file; detail changes delivery, not decoded coverage. */
  async #inspect(
    rawInput: unknown,
    options: ExecutionOptions | undefined,
    retention: AnalysisViewRetention,
    output?: Il2cppSeedOutput,
  ): Promise<Result<Evidence, AnalysisError>> {
    const input = parseAnalysisInput(
      OPERATION,
      rawInput,
      inspectIl2cppMetadataInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    if (
      input.value.binary_architecture !== undefined &&
      input.value.binary_path === undefined
    )
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["binary_architecture"],
            reason: "invalid_value",
            message: "binary_architecture selects a slice of binary_path.",
          },
        ]),
      );
    if (
      input.value.generic_instances === true &&
      input.value.binary_path === undefined
    )
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["generic_instances"],
            reason: "invalid_value",
            message: "generic_instances links generic methods in binary_path.",
          },
        ]),
      );
    if (output !== undefined) {
      if (input.value.binary_path === undefined)
        return err(
          new AnalysisInputError(OPERATION, undefined, [
            {
              path: ["ghidra_seeds"],
              reason: "invalid_value",
              message:
                "--ghidra-seeds needs --binary to link method addresses.",
            },
          ]),
        );
      if (this.seeds === undefined)
        return err(
          new AnalysisOutputError(
            OPERATION,
            "No seed output adapter is configured.",
          ),
        );
      const ready = await this.seeds.check(output, options);
      if (!ready.ok) return ready;
    }
    const { detail, ...providerInput } = input.value;
    if (detail === "summary") {
      const ready = requireAnalysisViewRetention(OPERATION, retention);
      if (!ready.ok) return ready;
    }
    const inspected = await this.provider.inspect(providerInput, options);
    if (!inspected.ok) return inspected;
    const report = il2cppMetadataSchema.safeParse(inspected.value);
    if (
      !report.success ||
      report.data.artifact.path !== providerInput.path ||
      (report.data.binary?.artifact.path ?? undefined) !==
        providerInput.binary_path ||
      (providerInput.binary_architecture !== undefined &&
        report.data.binary?.architecture !== providerInput.binary_architecture)
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "IL2CPP metadata reader returned malformed metadata or changed the selected artifact identity.",
        ),
      );
    const value = report.data;
    const evidence = this.#evidence(value, providerInput, output);
    let seedReceipt: Il2cppSeedReceipt | undefined;
    const cancelled = () =>
      err(
        new AnalysisCancelledError(OPERATION, {
          cause: options?.signal?.reason,
          partialObservation: evidence,
          ...(seedReceipt === undefined
            ? {}
            : { diagnostics: { published_seed_output: { ...seedReceipt } } }),
        }),
      );
    if (options?.signal?.aborted) return cancelled();
    if (output !== undefined && this.seeds !== undefined) {
      const written = await this.seeds.write(value, output, options);
      if (!written.ok) {
        written.error.retainPartialObservation(evidence);
        return written;
      }
      seedReceipt = written.value;
    }
    if (options?.signal?.aborted) return cancelled();
    return detail === "summary"
      ? summarizeRetainedAnalysis(evidence, retention)
      : ok(evidence);
  }
  #evidence(
    value: Il2cppMetadata,
    providerInput: Il2cppMetadataProviderInput,
    output: Il2cppSeedOutput | undefined,
  ): Evidence {
    return createEvidence(
      {
        path: value.artifact.path,
        sha256: value.artifact.sha256,
        format: "file",
      },
      this.provider.identity,
      {
        operation: OPERATION,
        parameters: {
          ...(Object.fromEntries(
            Object.entries(providerInput).filter(
              ([, value]) => value !== undefined,
            ),
          ) as Record<string, string | boolean>),
          ...(output === undefined
            ? {}
            : {
                ghidra_seeds: output.path,
                ...(output.base === undefined
                  ? {}
                  : { seed_base: output.base }),
              }),
        },
        result: value,
        confidence:
          value.binary === null
            ? "observed"
            : value.binary.code_gen_modules_field === null ||
                value.binary.types_field === null
              ? "inferred"
              : "derived",
        limitations: value.limitations,
        locations: [
          { kind: "artifact-path", path: value.artifact.path },
          ...(value.binary === null
            ? []
            : [
                {
                  kind: "artifact-path" as const,
                  path: value.binary.artifact.path,
                },
              ]),
          ...value.sections
            .filter(
              ({ name, size }) =>
                size > 0 &&
                (name === "images" ||
                  name === "typeDefinitions" ||
                  name === "methods" ||
                  name === "nestedTypes" ||
                  name === "strings" ||
                  name === "fields" ||
                  name === "properties" ||
                  name === "events" ||
                  name === "parameters" ||
                  name === "stringLiterals" ||
                  name === "stringLiteralData"),
            )
            .map(({ offset, size }) => ({
              kind: "file-offset-range" as const,
              start: offset,
              end: offset + size,
            })),
        ],
      },
    );
  }
}
