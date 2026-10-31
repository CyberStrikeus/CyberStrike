# Tasks

- [x] Define single-feature requirements and implementation plan before code.
- [x] Widen the runtime serve seam and shutdown handle to transport-neutral types.
- [x] Implement the node:http bridge and the streamable HTTP listener module.
- [x] Parse flags and `MCP_HOST`/`MCP_PORT`, route the dispatcher, add signals-only shutdown.
- [x] Document the transport, CLI entry, exit status and architecture label.
- [x] Verify bridge, listener, dispatcher, SDK client, Python client and shutdown behavior.
- [x] Keep providers alive across sessions, replace a session left open, name the bind cause in the log.
- [x] Resolve the re-review: capture the shutdown hook once, one shutdown registration primitive, flags-only HTTP routing.
- [x] Run relevant repository checks and prepare a separately scoped PR.
