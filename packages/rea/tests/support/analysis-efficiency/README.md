# Analysis verification test support

These files support the existing comparison, independent-oracle, receipt and
cleanup regressions. The TypeScript consumers live in `tests/boundary/`,
`tests/evaluation/` and `tests/conformance/`; `npm run test:python` discovers
the Python checks here. Build first for checks that use the compiled runtime.

The agent-harness tests inject command outcomes and own temporary workspaces.
They do not invoke a real model or establish real-provider behavior. The
retained resource observer keeps its process-family CPU, memory and cleanup
guards. Public corpus identities and original receipt provenance stay intact.

The historical [allocation report and receipt JSON](../../../docs/verification/analysis-efficiency/mcp-integer-allocation.md)
belong to documentation. Their numerical sections are produced and checked by:

```sh
node tests/support/analysis-efficiency/mcp-integer-report.mjs --check
```

The full experiment suite was retired. For historical reproduction, use the
recorded runtime and producer revisions; the [archived source tree](https://github.com/morluto/rea/tree/a2e2c29b59e8775b0e6aedb09a9eb16adf32646b/experiments/analysis-efficiency)
preserves the former layout. Current deterministic checks do not requalify
those historical measurements.
