# Streamable HTTP transport for the MCP server

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

`rea mcp --http [--host H] [--port N]` serves the existing MCP tool catalog over
the pinned SDK's streamable HTTP transport instead of stdio, so an agent
environment runtime or any HTTP MCP client can reach REA on a local URL. The
listener is opt-in: bare `rea mcp`, `rea mcp doctor`, `rea mcp add` and every
client registration keep stdio.

## Requirements

- Route `mcp --http ...` and `--mcp --http ...` to the MCP runtime in the
  dispatcher without changing bare `mcp`, `mcp doctor` or `mcp add`.
- Resolve host and port from the flags, then `MCP_HOST`/`MCP_PORT` from the
  environment snapshot, then `127.0.0.1` and port `0`; announce the bound URL as
  one pino JSON line on stderr at every log level and leave stdout unused.
- Use `WebStandardStreamableHTTPServerTransport` in stateful mode around one
  server instance built once, after the listener has bound. `DELETE` ends the session on its transport without
  running the instance's shutdown hooks, so the same instance keeps its
  providers and serves the next client on a fresh transport; the hooks run when
  the listener closes.
- Let a new client's `initialize` replace a session that is still open, closing
  the earlier transport the same way, so a client that left without `DELETE`
  cannot block the listener; the replaced client's later requests are refused
  (`404` while the replacing session is open).
- Bridge node:http to web Request/Response in `src/server/http/`, streaming
  response chunks as they are produced and turning a client disconnect into a
  request abort and body cancellation.
- Classify a loopback bind by the actual bound IP (`127.0.0.0/8`, `::1`, or
  IPv4-mapped loopback), without using the configured DNS name as evidence; validate
  the `Host` and `Origin` headers with the SDK loopback allowlist plus the
  configured name and the bound address on such binds, and relax both for
  other binds and log that relaxation. Refuse scoped IPv6 literals before
  binding, close the listener if its URL cannot be formed, and forward
  listener errors to `onerror` only after a successful bind.
- Let the caller own instance cleanup (`closeInstance: false`) when its factory
  owner already closes every instance, as the MCP runtime does.
- Let only an `initialize` that carries the streamable headers and passes those
  checks replace an open session; refuse requests once the slot is closed, join
  an arming session during shutdown, and keep close stages retryable.
- End the HTTP listener on SIGINT/SIGTERM only, never on stdin EOF, and exit with
  the signal status (`130`/`143`) after cleanup settles; latch a signal that
  arrives during startup so it is acted on as soon as the lifecycle owner exists,
  and exit at once on a second one.
- Export `serveStreamableHttp({ host, port, createMcpServer, routes, logger })`
  returning `{ url, close }` so an agent environment server can add plain routes
  beside `/mcp` without a second bridge.
- Keep listener failure causes out of stderr behind a fixed message while the
  typed listen error carries the system cause (such as `EADDRINUSE`) into the
  error-level log line.

## Acceptance and limits

Adapters tests cover the bridge (method, URL, headers, body, GET without body,
incremental streaming, abort and cancel) and the listener (listening line, one
factory call across three sessions, replacement of an open session by the next
`initialize`, two `initialize` requests racing to replace one session while the
instance's shutdown hook stays installed, a working tool call after `DELETE`,
the instance's shutdown hook firing only when the listener closes, plain
routes, 404, Host refusal, port release, typed bind failure naming
`EADDRINUSE`). The dispatcher test covers the new routes and keeps `mcp add
--http` with the CLI. An mcp-boundary test spawns the built CLI and drives
initialize, tools/list, `binary_session` and `DELETE` with the SDK streamable
HTTP client, then proves `binary_session` still answers in the next session and
in a session that replaced one left open; a process-boundary test asserts
`143`/`130` exits and a released port. Concurrent clients are not supported:
the newest `initialize` owns the server. Non-loopback binds require the
operator's parsed hostname allowlist, retain Host/Origin gates, and announce a
client URL admitted by that list. Current listener regressions exercise a
wildcard bind, refusal/port release and a direct SDK connection to the
announced endpoint. Response
budgets keep their stdio-derived floor; registrations, `rea mcp doctor` and
`server.json` stay stdio.

## Deferred issue criteria

Serving an environment manifest with replayed records, its environment card and
the exported bundle are later increments of #4933. This PR must reference rather
than close the issue.
