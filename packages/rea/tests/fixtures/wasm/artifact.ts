import { createHash } from "node:crypto";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import type { WasmArtifactExecution } from "../../../src/application/wasm/WasmArtifactPort.js";
import type { WasmArtifact } from "../../../src/domain/wasm/wasmArtifact.js";
/** Source-owned transport seam; upstream binaries are verified in a separate lane. */
export const wasmArtifactFixture = (
  path = "/artifacts/module.wasm",
): WasmArtifact => ({
  artifact: { path, sha256: "a".repeat(64), bytes: 8 },
  validation: "valid" as const,
  sections: [],
  imports: [],
  exports: [],
  debug_name_metadata: "not-present",
  custom_section_warnings: [],
  headers: "",
  details: "",
  wat: {
    text: "(module)\n",
    sha256: createHash("sha256").update("(module)\n").digest("hex"),
    representation: "decoded-wat" as const,
  },
  tool_profile: {
    source: "https://github.com/WebAssembly/wabt" as const,
    release: "1.0.42" as const,
    source_commit: "ff0ef7e0009402740c805a9744c09b05be063e48" as const,
    commands: (["wasm-validate", "wasm-objdump", "wasm2wat"] as const).map(
      (tool) => ({
        tool,
        path: `/tools/${tool}`,
        sha256: "b".repeat(64),
        version_banner: "1.0.42\n",
        arguments:
          tool === "wasm-objdump"
            ? ["-h", "-x", "module.wasm"]
            : ["--enable-all", "--ignore-custom-section-errors", "module.wasm"],
      }),
    ),
    timeout_ms: 30_000,
    output_budget_bytes: 32 * 1024 * 1024,
  },
  candidates: [{ path, sha256: "a".repeat(64), bytes: 8 }],
  glue: [],
  runtime_execution: "not-performed" as const,
  network_fetch: "not-performed" as const,
  limitations: ["Source-owned transport seam."],
});
export const wasmArtifactExecution = (
  value = wasmArtifactFixture(),
): WasmArtifactExecution => {
  return createAnalysisExecution(
    value,
    { id: "fixture-wabt", name: "Source-owned WABT seam", version: "1" },
    {
      subject: {
        path: value.artifact.path,
        format: "file",
        sha256: value.artifact.sha256,
      },
      limitations: value.limitations,
    },
  );
};
