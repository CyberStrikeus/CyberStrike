import { AsyncLocalStorage } from "node:async_hooks";
import type { AnalysisError } from "../domain/analysisErrorBase.js";

export interface PublishedEvidenceReceipt {
  readonly path?: string;
  readonly bytes: number;
}

interface PublicationContext {
  receipt?: PublishedEvidenceReceipt;
}
const publication = new AsyncLocalStorage<PublicationContext>();

/** Keep publication state in the invocation that owns delivery and formatting. */
export const withCliEvidencePublication = <Value>(run: () => Value): Value =>
  publication.run({}, run);

export const recordCliEvidencePublication = (
  receipt: PublishedEvidenceReceipt,
): void => {
  const context = publication.getStore();
  if (context !== undefined) context.receipt = receipt;
};

/** Snapshot a receipt for output recovery after the invocation context ends. */
export const cliEvidencePublicationReceipt = ():
  | PublishedEvidenceReceipt
  | undefined => publication.getStore()?.receipt;

/** Preserve an already committed file when subsequent output selection fails. */
export const retainCliPublicationOnError = <ErrorType extends AnalysisError>(
  error: ErrorType,
  receipt = cliEvidencePublicationReceipt(),
): ErrorType => {
  return receipt === undefined
    ? error
    : error.retainDiagnostics({ evidence_bundle: { ...receipt } });
};
