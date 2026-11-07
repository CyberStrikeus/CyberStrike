import {
  Client,
  type CallToolResult,
  type Request,
  type RequestMethod,
  type RequestOptions,
  type ResultTypeMap,
  type StandardSchemaV1,
} from "@modelcontextprotocol/client";

const isSchema = (
  value: RequestOptions | StandardSchemaV1 | undefined,
): value is StandardSchemaV1 =>
  typeof value === "object" && value !== null && "~standard" in value;

/** Preserve observed structured dictionaries across the SDK's era-specific result validation. */
export class StructuredContentMcpClient extends Client {
  readonly #toolResult: StandardSchemaV1<unknown, CallToolResult> = {
    "~standard": {
      version: 1,
      vendor: "rea-mcp-structured-content",
      validate: (input) => {
        const parsed = this._wireCodec().validateResult("tools/call", input);
        if (!parsed.ok)
          return {
            issues: [
              {
                message:
                  parsed.reason === "invalid"
                    ? parsed.message
                    : "not-in-era: tools/call",
              },
            ],
          };
        // Retain the SDK's envelope normalization, replacing only the dictionary
        // its legacy record parser may clone without own __proto__ members.
        if (
          typeof input === "object" &&
          input !== null &&
          Object.hasOwn(input, "structuredContent")
        )
          return {
            value: {
              ...parsed.value,
              structuredContent: (input as { structuredContent: unknown })
                .structuredContent,
            },
          };
        return { value: parsed.value };
      },
    },
  };

  override request<Method extends RequestMethod>(
    request: { method: Method; params?: Record<string, unknown> },
    options?: RequestOptions,
  ): Promise<ResultTypeMap[Method]>;
  override request<Schema extends StandardSchemaV1>(
    request: Request,
    resultSchema: Schema,
    options?: RequestOptions,
  ): Promise<StandardSchemaV1.InferOutput<Schema>>;
  override request(
    request: Request,
    schemaOrOptions?: RequestOptions | StandardSchemaV1,
    options?: RequestOptions,
  ): Promise<unknown> {
    if (isSchema(schemaOrOptions))
      return super.request(request, schemaOrOptions, options);
    if (request.method === "tools/call")
      return super.request(request, this.#toolResult, schemaOrOptions);
    return super.request(
      request as { method: RequestMethod; params?: Record<string, unknown> },
      schemaOrOptions,
    );
  }
}
