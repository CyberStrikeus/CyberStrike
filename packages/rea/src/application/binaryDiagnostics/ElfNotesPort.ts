import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectElfNotesInput,
  ElfNotes,
} from "../../domain/native/elfNotes.js";
import type { Result } from "../../domain/result.js";

/** Stable read and ELF note-table decoding, independent of a disassembler session. */
export interface ElfNotesPort {
  readonly identity: ProviderIdentity;
  close?(): Promise<void>;
  inspect(
    input: InspectElfNotesInput,
    options?: ExecutionOptions,
  ): Promise<Result<ElfNotes, AnalysisError>>;
}
