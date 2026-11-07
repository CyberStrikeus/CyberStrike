# Implementation plan

1. Widen the runtime `serve` dependency to a transport-neutral factory that may
   bind asynchronously. `startMcpTransport` awaits it, hands it the server
   logger, and keeps stdio as the default; the shutdown handle type loses its
   stdio name.
2. Add `src/server/http/nodeHttpBridge.ts` to turn an IncomingMessage into a web
   Request (headers, streamed body, abort on client close) and to pipe a web
   Response back with flushed headers, and `src/server/http/serveStreamableHttp.ts`
   to own one `McpServer` instance and one stateful transport per session,
   ended by `DELETE` or replaced by the next client's `initialize` without
   running the instance's shutdown hooks, plus plain routes, loopback Host
   validation, the listening log line and idempotent close. The typed listen
   error lives in its own module so the stdio entry never loads the listener.
3. Parse `--http`, `--host` and `--port` in `src/main/mcpHttpArguments.ts` from
   one schema that also renders help; resolve `MCP_HOST`/`MCP_PORT` in
   `src/config/mcpHttpEndpoint.ts` as a `Result` that names rejected settings
   without their values.
4. Route the dispatcher to `runMcpHttpEntrypoint` when the `mcp` entry carries
   `--http`; compose HTTP dependencies in `src/main.ts` with the shared
   `run()` path so configuration, session, providers and shutdown stay common.
5. Register signals only for HTTP mode through `registerSignalShutdown`, a
   projection of `registerProcessShutdown` without stdin that sets the signal
   exit status before the idempotent shutdown runs; stdio keeps its stdin
   end/close triggers.
6. Document the transport in docs/mcp-contracts.md and docs/cli.md, relabel the
   architecture diagram, and cover each boundary with adapters, dispatcher,
   mcp-boundary and process-boundary tests plus a Python SDK client exchange.

No new dependency is introduced: the transport, Host validation and body bound
come from the already pinned `@modelcontextprotocol/server` root export. Tool
contracts, catalog digests, response budgets and stdio behaviour are unchanged.
