/** Parsed declarations borrow source strings; they do not decode bodies or normalize media types. */
export type RecordedRequestBody =
  | { readonly kind: "request-unavailable" }
  | {
      readonly kind: "request";
      readonly bodySize:
        | { readonly kind: "missing" | "invalid" }
        | { readonly kind: "number"; readonly value: number };
      readonly postData:
        | { readonly kind: "missing" | "null" | "malformed" }
        | {
            readonly kind: "object";
            readonly text: string | undefined;
            readonly mimeType: string | undefined;
            readonly params:
              | { readonly kind: "missing" | "invalid" }
              | { readonly kind: "array"; readonly count: number };
          };
    };

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Read HAR request body declarations once without turning omission or null into absence. */
export const readRecordedRequestBody = (
  reported: unknown,
): RecordedRequestBody => {
  const request = object(object(reported)?.request);
  if (request === undefined) return { kind: "request-unavailable" };
  const size = request.bodySize;
  const bodySize: Extract<
    RecordedRequestBody,
    { kind: "request" }
  >["bodySize"] =
    size === undefined
      ? { kind: "missing" }
      : typeof size === "number" && Number.isFinite(size)
        ? { kind: "number", value: size }
        : { kind: "invalid" };
  const source = request.postData;
  const postData = object(source);
  return {
    kind: "request",
    bodySize,
    postData:
      postData === undefined
        ? {
            kind:
              source === undefined
                ? "missing"
                : source === null
                  ? "null"
                  : "malformed",
          }
        : {
            kind: "object",
            text: typeof postData.text === "string" ? postData.text : undefined,
            mimeType:
              typeof postData.mimeType === "string"
                ? postData.mimeType
                : undefined,
            params:
              postData.params === undefined
                ? { kind: "missing" }
                : Array.isArray(postData.params)
                  ? { kind: "array", count: postData.params.length }
                  : { kind: "invalid" },
          },
  };
};
