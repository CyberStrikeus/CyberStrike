# Verification

Verified base: a2d8b94dd50dab8d966239dd63ab84718aa8b4b4 (fetched main).
The change was reapplied without conflicts and relevant checks rerun.

- Focused existing/new parser, provider, service, contract and CLI/MCP tests:
  8 files / 56 tests passed.
- After the final partial-uniqueness correction, reran service and compiled
  CLI/MCP boundary tests: 2 files / 5 tests passed.
- `npm run check`: typecheck, lint, formatting, knip, module boundaries and
  architecture guards passed. Lint reports warnings; no errors.
- `npm run docs:generate`, `npm run docs:check` and
  `npm run verify:test-discovery` passed; every test file was discovered exactly once.
- Real WABT 1.0.42 comparison through compiled CLI and stdio MCP passed:
  equivalent padded LEB128 original encodings, function signatures, all admitted
  kinds, custom memory page size, escaped/BOM names, empty interfaces, explicit
  scope, duplicate imports and unadmitted exception reference signatures.
- Existing real WABT artifact verifier passed after correcting its stale inline
  partial-observation assumption to resolve the MCP retained reference from the
  Evidence bundle and authenticate the original record.

## Independent review

Three findings repaired at their owning boundary:

1. Memory page size omitted: now preserved, default 65536 canonicalized.
2. Shared signature expansion undercounted: charge every retained occurrence.
   Reviewer independently measured the 1000-params/10000-exports case: original
   262956-byte WAT produced 61824014-byte JSON before correction. It now retains
   1949 observations in a partial facet, with 12046676-byte JSON and an explicit
   capacity issue. Original WAT stays available; incomplete coverage prevents
   absence and uniqueness claims.
3. Partial singleton uniqueness: comparison now returns unknown whenever either
   selected inventory is incomplete, including matched names.

Final independent source review reported no actionable findings. Review does not
replace the executed tests or real-tool evidence.

## Scope and measurement limits

On the original implementation base f254f5a, the complete comparison verifier reported 7.98 seconds elapsed, 6.56 user and
3.13 system seconds, and 429441024 bytes maximum RSS via macOS `/usr/bin/time -l`.
These are command-accounting measurements, not aggregate concurrent process-family
memory or model tokens. Token usage and full process-family peak are unmeasured.
Real-tool verification covers macOS arm64 only; Linux/Windows remain unverified.
No module was instantiated/executed and no source was fetched. Static equality
is not runtime compatibility. Full CI is separate from this local verification record.
