# Bring-your-own WABT

REA does not bundle, patch, install or download WABT executables. Operators select
an existing tool directory with `REA_WABT_BIN_DIRECTORY`.

- Upstream: https://github.com/WebAssembly/wabt
- Admitted release: https://github.com/WebAssembly/wabt/releases/tag/1.0.42
- Source commit: `ff0ef7e0009402740c805a9744c09b05be063e48`
- Upstream license: Apache-2.0, https://github.com/WebAssembly/wabt/blob/1.0.42/LICENSE
- Runtime tools: `wasm-validate`, `wasm-objdump`, `wasm2wat`.
- Verification fixture compiler: `wat2wasm` (not a runtime prerequisite).

The adapter requires every version banner to report `1.0.42` and records the
resolved executable path, SHA-256, exact banner and arguments for each tool.
Version admission identifies the supported producer profile; it does not certify
publisher authenticity. Operators remain responsible for trusted executable
provenance. No `wasm-interp`, decompiler, replacement binary parser or target
execution is used.

Real verification on macOS arm64 used the unchanged official
`wabt-1.0.42-macos-arm64.tar.gz` release asset, whose SHA-256 was checked against
GitHub release metadata:
`3f654779b436c628db3ca4323c51538815f5fbc887a6d5f3bb1c18d36281e240`.
This identifies that verification archive, not arbitrary operator-supplied tools.
