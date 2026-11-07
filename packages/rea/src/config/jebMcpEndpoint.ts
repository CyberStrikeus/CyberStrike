import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../domain/result.js";
import { urlDeclaresQueryOrFragment } from "../domain/urlComponents.js";

/** Default JEB MCP endpoint documented by the engine's headless client. */
export const DEFAULT_JEB_MCP_ENDPOINT = "http://127.0.0.1:8425/mcp";

/**
 * Normalize the caller-selected JEB MCP endpoint.
 *
 * Only the scheme, host, and port select the engine; credentials, paths with
 * segments beyond the MCP route, queries, and fragments are rejected rather
 * than silently dropped.
 */
export const parseJebMcpEndpoint = (
  value: string | undefined,
): Result<URL, AnalysisError> => {
  const raw = value === undefined || value.length === 0 ? null : value;
  let url: URL;
  try {
    url = new URL(raw ?? DEFAULT_JEB_MCP_ENDPOINT);
  } catch {
    return err(
      new AnalysisInputError("jeb_mcp_endpoint", {
        cause: "Expected an absolute http(s) URL",
      }),
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return err(
      new AnalysisInputError("jeb_mcp_endpoint", {
        cause: "Only http and https JEB MCP endpoints are supported",
      }),
    );
  if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]")
    return err(
      new AnalysisInputError("jeb_mcp_endpoint", {
        cause:
          "JEB MCP endpoint must use a literal loopback host (127.0.0.1 or ::1)",
      }),
    );
  if (url.username !== "" || url.password !== "")
    return err(
      new AnalysisInputError("jeb_mcp_endpoint", {
        cause:
          "Embedding credentials in the JEB MCP endpoint is not supported; configure authentication with the engine",
      }),
    );
  if (url.pathname !== "/mcp" && url.pathname !== "/mcp/")
    return err(
      new AnalysisInputError("jeb_mcp_endpoint", {
        cause: "JEB MCP endpoint must use the /mcp route",
      }),
    );
  if (urlDeclaresQueryOrFragment(url))
    return err(
      new AnalysisInputError("jeb_mcp_endpoint", {
        cause: "JEB MCP endpoint query strings and fragments are not supported",
      }),
    );
  return ok(url);
};
