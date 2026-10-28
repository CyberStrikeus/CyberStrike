import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const McpHandler = HttpApiBuilder.group(Api, "server.mcp", (handlers) =>
  handlers
    .handle("mcp.list", () => unavailable)
    .handle("mcp.add", () => unavailable)
    .handle("mcp.remove", () => unavailable)
    .handle("mcp.connect", () => unavailable)
    .handle("mcp.disconnect", () => unavailable)
    .handle("mcp.resource.catalog", () => unavailable)
    .handle("mcp.clientToken", () => unavailable)
    .handle("mcp.client", () => unavailable)
)
