import { createHash } from "node:crypto";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import type { EvmInterfaceExecution } from "../../../src/application/evm/EvmInterfacePort.js";
import type { EvmInterface } from "../../../src/domain/evm/evmInterface.js";

/** Source-owned transport seam, independent of real engine verification. */
export const evmInterfaceFixture = (
  path = "/artifacts/source-owned.hex",
): EvmInterface => ({
  artifact: { path, sha256: "a".repeat(64), bytes: 10, encoding: "hex" },
  bytecode: {
    sha256: createHash("sha256")
      .update(Buffer.from("60006000f3", "hex"))
      .digest("hex"),
    bytes: 5,
    hex: "60006000f3",
    digest_algorithm: "sha256",
    kind: "unknown",
    deployment_authenticity: "unknown",
    hardfork: "unknown",
    metadata: null,
  },
  evidence_kind: "inferred",
  functions: [],
  discovery_completeness: "unknown",
  runtime_execution: "not-performed",
  diagnostics: { stdout: "", stderr: "", truncated: false },
  limitations: ["Interface completeness remains unknown."],
});

/** Bind a fixture to its explicit producing seam and carrier identity. */
export const evmInterfaceExecution = (
  value = evmInterfaceFixture(),
): EvmInterfaceExecution => {
  return createAnalysisExecution(
    value,
    { id: "fixture-evm", name: "Source-owned EVM seam", version: "1" },
    {
      rawResult: { functions: [] },
      subject: {
        path: value.artifact.path,
        format: "file",
        sha256: value.artifact.sha256,
      },
      limitations: value.limitations,
      locations: [{ kind: "artifact-path", path: value.artifact.path }],
    },
  );
};
