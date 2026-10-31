import {
  createEvidence,
  type Evidence,
  type EvidenceProvider,
} from "../evidence.js";
import type {
  GpuCodeObjects,
  GpuCodeObjectsInput,
  GpuCodeObjectsPartial,
} from "./gpuCodeObjects.js";

const gpuParameters = (parameters: GpuCodeObjectsInput) => ({
  path: parameters.path,
  analysis: parameters.analysis,
  ...(parameters.object_ids === undefined
    ? {}
    : { object_ids: parameters.object_ids }),
  ...(parameters.targets === undefined ? {} : { targets: parameters.targets }),
  ...(parameters.expected_sha256 === undefined
    ? {}
    : { expected_sha256: parameters.expected_sha256 }),
});

/** One Evidence interpretation for success and observations retained by file finalization failures. */
export const createGpuCodeObjectsEvidence = (
  report: GpuCodeObjects,
  provider: EvidenceProvider,
  parameters: GpuCodeObjectsInput,
): Evidence =>
  createEvidence(
    {
      path: report.artifact.path,
      sha256: report.artifact.sha256,
      format: "file",
    },
    provider,
    {
      operation: "inspect_gpu_code_objects",
      parameters: gpuParameters(parameters),
      result: report,
      confidence: "observed",
      locations: [{ kind: "artifact-path", path: report.artifact.path }],
      limitations: report.limitations,
    },
  );

export const createGpuCodeObjectsPartialEvidence = (
  report: GpuCodeObjectsPartial,
  provider: EvidenceProvider,
  parameters: GpuCodeObjectsInput,
): Evidence =>
  createEvidence(undefined, provider, {
    operation: "inspect_gpu_code_objects",
    parameters: gpuParameters(parameters),
    result: report,
    confidence: "observed",
    subjectUnavailableReason:
      "The interrupted inspection did not complete final file identity verification; root digest and completeness are unknown.",
    locations: [{ kind: "artifact-path", path: report.artifact.path }],
    limitations: report.limitations,
  });
