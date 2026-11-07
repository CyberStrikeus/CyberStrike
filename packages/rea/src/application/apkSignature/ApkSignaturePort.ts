import type {
  AnalysisExecution,
  ExecutionOptions,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { EvidenceSubjectTarget } from "../../domain/evidence.js";
import type { Result } from "../../domain/result.js";

/** Successful inspection identifies the selected local APK/ZIP. */
export type ApkSignatureExecution = Omit<AnalysisExecution, "subject"> & {
  readonly subject: EvidenceSubjectTarget & {
    readonly format: "file" | "apk" | "zip";
  };
};

/** Replaceable offline APK signature reader, independent of device/adb and network. */
export interface ApkSignaturePort {
  close(): Promise<void>;
  inspect(
    input: { readonly path: string },
    options?: ExecutionOptions,
  ): Promise<Result<ApkSignatureExecution, AnalysisError>>;
}
