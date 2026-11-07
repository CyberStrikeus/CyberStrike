# Implementation plan

1. Add `src/application/environment/environmentSource.ts` to authenticate the
   two Evidence files, require the manifest view kind and the capture
   operation, refuse a parent mismatch, and reduce every cited record to its
   request line, status, content type and retained response text through the
   slice-1 request-line reader, so the server holds only what replay returns.
2. Add `environmentTools.ts` to map manifest tools to MCP tool definitions with
   one hand-built JSON Schema per tool that both `registerTool` (through the
   SDK's `fromJsonSchema`) and the card consume, and to build the card in the
   echo example's key order.
3. Add `environmentReplay.ts` to score cited records by path-segment matches,
   then query matches, keep manifest order on ties, and shape the replay result
   with JSON-like parsing, UTF-8-safe truncation and the replay provenance
   block; export the slice-1 JSON-like predicate instead of restating it.
4. Add `src/server/environment/serveEnvironment.ts` to build the `McpServer`
   whose handlers attach REA's target-content `_meta`, the card and `/agentenv`
   routes (the latter reading its body through the SDK's bounded reader), and
   to serve them through the slice-2 `serveStreamableHttp` with its `routes`
   and `onerror` seams; add `src/config/environmentName.ts` for
   `ENVIRONMENT_NAME`.
5. Add `src/cli/environmentCommands.ts` registering `environment-serve` through
   `withCommandCancellation` and `logCliCommand`, resolving host and port with
   the slice-2 endpoint parser, reading files through `parseCliJsonInput`,
   importing the listener lazily, awaiting the cancellation signal or a
   listener failure and returning one `stopped` document or a typed error;
   register the name in `CLI_COMMANDS` and the lazy module in the startup
   import probe.
6. Share the fixture pair through `tests/fixtures/environmentServe.ts` and the
   listener spawn through a generalised `startListeningProcess`; add services,
   adapters, mcp-boundary, cli-boundary and process-boundary tests.
7. Document the command in `docs/cli.md`, add `docs/agent-environments.md` with
   its sidebar and index entries, and record the spec.

No new dependency is introduced. REA's tool contracts, catalog digests and the
stdio transport are unchanged; the CLI inventory gains one command.
