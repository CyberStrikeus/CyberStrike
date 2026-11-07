export interface ClientJavaScriptEvidenceCandidate {
  readonly evidence_id: string;
  readonly normalized_result: {
    readonly graph: { readonly nodes: readonly unknown[] };
  };
}
export function isClientJavaScriptEvidence(
  value: unknown,
): value is ClientJavaScriptEvidenceCandidate;
export function findClientResult<T>(
  value: unknown,
  matches: (value: object) => value is T & object,
  decodeText?: (text: string) => unknown,
): (T & object) | undefined;
export function findClientResult(
  value: unknown,
  matches: (value: object) => boolean,
  decodeText?: (text: string) => unknown,
): object | undefined;
