import { AnalysisProtocolError } from "../domain/analysisErrorCore.js";

/** Authored byte-validation failure, distinct from arbitrary upstream protocol diagnostics. */
export class McpHttpUtf8Error extends AnalysisProtocolError {
  constructor(cause: unknown) {
    super("MCP HTTP response body omitted: not valid UTF-8.", { cause });
  }
}

/** Validate accepted MCP message bytes before Fetch or the SDK can replace malformed UTF-8. */
export const validateMcpHttpResponse = (
  response: Response,
  rejectTransport: (failure: McpHttpUtf8Error) => void,
): Response => {
  // Failed HTTP responses belong to each adapter's existing diagnostic policy.
  if (!response.ok || response.body === null) return response;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const validate = (bytes?: Uint8Array): void => {
    try {
      decoder.decode(bytes, { stream: bytes !== undefined });
    } catch (cause: unknown) {
      const failure = new McpHttpUtf8Error(cause);
      // SDK 2.3.1 reports SSE read errors without settling pending tools/call.
      // The lifetime owner closes the actual transport to reject that work.
      rejectTransport(failure);
      throw failure;
    }
  };
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        validate(bytes);
        controller.enqueue(bytes);
      },
      flush() {
        validate();
      },
    }),
  );
  const validated = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  Object.defineProperties(validated, {
    url: { value: response.url },
    redirected: { value: response.redirected },
    type: { value: response.type },
  });
  return validated;
};
