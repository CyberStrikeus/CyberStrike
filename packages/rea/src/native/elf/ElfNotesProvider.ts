import {
  projectStableArtifactFailure,
  projectArtifactCloseFailure,
} from "../../artifacts/StableArtifactFailure.js";
import { isSelectedRegularFileError } from "../../filesystem/RegularFile.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { readStableArtifact } from "../../artifacts/readStableArtifact.js";
import {
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
  artifactFileCancellationCause,
} from "../../artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type { ElfNotesPort } from "../../application/binaryDiagnostics/ElfNotesPort.js";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../../domain/analysisErrorCore.js";
import { fixedAllowanceOptions } from "../../domain/fixedAllowanceRemediation.js";
import {
  MAX_INSPECT_ELF_NOTE_ENTRIES,
  MAX_INSPECT_ELF_NOTE_FILE_BYTES,
  type InspectElfNotesInput,
} from "../../domain/native/elfNotes.js";
import { err, ok } from "../../domain/result.js";
import { ELF_NOTES_PROVIDER } from "../../domain/investigationProviders.js";
import { BinaryFormatFailure } from "../metadata/BinaryContainer.js";
import {
  ElfNoteSectionNameBudgetFailure,
  parseElfNotes,
} from "./ElfNoteParser.js";

const OPERATION = "inspect_elf_notes";

/** Portable parser over one bounded, identity-checked regular file. */
export class ElfNotesProvider implements ElfNotesPort {
  readonly identity = ELF_NOTES_PROVIDER;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        ELF_NOTES_PROVIDER.id,
        OPERATION,
      );
    }
  }

  async inspect(input: InspectElfNotesInput, options?: ExecutionOptions) {
    try {
      return await this.#resources.run(async () => {
        const snapshot = await readStableArtifact(
          input.path,
          input.max_file_bytes,
          options?.signal,
          undefined,
          this.#resources,
        );
        return ok(
          parseElfNotes(
            snapshot.bytes,
            {
              path: input.path,
              sha256: snapshot.sha256,
              bytes: snapshot.bytes.length,
            },
            input,
          ),
        );
      });
    } catch (cause) {
      return err(elfNotesFailure(cause, input));
    }
  }
}

const NOTE_TEXT_BUDGET =
  "The ELF note text, hash, and scan budget fixed by the admitted image length plus decoded section names";

const inputBudgetRemediation = (
  boundary: "file-size" | "capacity",
  input: InspectElfNotesInput,
): string =>
  boundary === "file-size"
    ? input.max_file_bytes >= MAX_INSPECT_ELF_NOTE_FILE_BYTES
      ? `The image exceeds the ${String(MAX_INSPECT_ELF_NOTE_FILE_BYTES)}-byte input ceiling this operation accepts; select a smaller artifact.`
      : `Raise max_file_bytes above ${String(input.max_file_bytes)} bytes or select a smaller artifact; the limit is the caller-selected input read budget.`
    : input.max_entries >= MAX_INSPECT_ELF_NOTE_ENTRIES
      ? `The image exceeds the ${String(MAX_INSPECT_ELF_NOTE_ENTRIES)}-entry note-table ceiling this operation accepts; select a smaller artifact.`
      : `Raise max_entries above ${String(input.max_entries)} or select a smaller artifact; the limit is the caller-selected note entry budget.`;

const sectionNameBudgetRemediation = (
  cause: ElfNoteSectionNameBudgetFailure,
): string =>
  cause.minimumMaxFileBytes <= BigInt(MAX_INSPECT_ELF_NOTE_FILE_BYTES)
    ? `Raise max_file_bytes to at least ${String(cause.minimumMaxFileBytes)} bytes to admit the source and decoded ELF section names.`
    : `The source and decoded ELF section names require ${String(cause.minimumMaxFileBytes)} bytes, above this operation's ${String(MAX_INSPECT_ELF_NOTE_FILE_BYTES)}-byte maximum; select an image with a smaller section-name table.`;

const elfNotesFailurePrimary = (
  facts: ArtifactFilePrimaryFacts,
  input: InspectElfNotesInput,
) => {
  const { cause, origin } = facts;
  if (cause instanceof ElfNoteSectionNameBudgetFailure)
    return new AnalysisResourceConstraintError(
      OPERATION,
      "memory",
      cause.message,
      {
        max_file_bytes: cause.selectedMaxFileBytes,
        minimum_required_bytes: cause.minimumMaxFileBytes.toString(),
      },
      {
        cause,
        retryable: false,
        remediationAction: sectionNameBudgetRemediation(cause),
      },
    );
  if (cause instanceof BinaryFormatFailure)
    return cause.kind === "unsupported"
      ? new AnalysisUnsupportedTargetError(
          OPERATION,
          input.path,
          cause.message,
          { cause },
        )
      : new AnalysisInputError(OPERATION, { cause }, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: cause.message,
          },
        ]);
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "integrity"
  )
    return new AnalysisArtifactChangedError(
      OPERATION,
      input.path,
      cause.message,
      {
        cause,
      },
    );
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "cancelled"
  )
    return new AnalysisCancelledError(OPERATION, {
      cause: artifactFileCancellationCause(cause),
    });
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  ) {
    if (cause.reason === "limit") {
      // Caller-selected read and entry budgets name the bound to raise.
      // The note text, hash, and scan ceiling equals the admitted image
      // length plus decoded section names, so host memory cannot raise it.
      const noteTextBudget = cause.boundary === "memory";
      return new AnalysisResourceConstraintError(
        OPERATION,
        cause.boundary ?? "memory",
        cause.message,
        {
          max_file_bytes: input.max_file_bytes,
          max_entries: input.max_entries,
        },
        {
          cause,
          ...(cause.boundary === undefined
            ? {}
            : noteTextBudget
              ? fixedAllowanceOptions(NOTE_TEXT_BUDGET, "parser")
              : {
                  retryable: false as const,
                  remediationAction: inputBudgetRemediation(
                    cause.boundary,
                    input,
                  ),
                }),
        },
      );
    }
    if (cause.reason === "path" || cause.reason === "format")
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: "invalid_format",
          message: cause.message,
        },
      ]);
  }
  if (cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(OPERATION, input.path, cause.code, {
        cause,
      });
    if (isSelectedRegularFileError(cause))
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `Selected ELF image could not be read (${String(cause.code)}): ${input.path}.`,
        },
      ]);
  }
  return new ArtifactOperationError(
    OPERATION,
    origin === "owned-or-classified" && cause instanceof ArtifactReaderFailure
      ? cause.reason
      : "io",
    undefined,
    cause instanceof Error ? cause.message : "ELF note inspection failed.",
    { cause },
  );
};

const elfNotesFailure = (cause: unknown, input: InspectElfNotesInput) => {
  const primary = elfNotesFailurePrimary(
    artifactFilePrimaryFacts(cause),
    input,
  );
  return projectStableArtifactFailure(
    cause,
    primary,
    input.path,
    ELF_NOTES_PROVIDER.id,
    OPERATION,
  );
};
