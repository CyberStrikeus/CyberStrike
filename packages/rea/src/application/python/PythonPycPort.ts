import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectPythonPycInput,
  PythonPyc,
} from "../../domain/python/pythonPyc.js";
import type { Result } from "../../domain/result.js";

/** Stable read and CPython pyc decoding, independent of a disassembler session. */
export interface PythonPycPort {
  readonly identity: ProviderIdentity;
  close(): Promise<void>;
  inspect(
    input: InspectPythonPycInput,
    options?: ExecutionOptions,
  ): Promise<Result<PythonPyc, AnalysisError>>;
}
