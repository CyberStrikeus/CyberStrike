import type { GpuLocation, GpuObject } from "../domain/gpu/gpuCodeObjects.js";
import type { GpuSource } from "./GpuSource.js";
import type { AmdGpuTargetIdentity } from "./AmdGpuTarget.js";
export type GpuPayloadTarget = {
  readonly value: string | null;
  readonly amdMetadata?: GpuObject["amd_target_metadata"];
  readonly cudaHeader?: GpuObject["cuda_target_header"];
  readonly limitation?: string;
} & (
  | { readonly scope: "exact" | "cuda-base"; readonly key: string | null }
  | { readonly scope: "amdgpu"; readonly identity: AmdGpuTargetIdentity | null }
);
export const gpuLocation = (
  source: GpuSource,
  offset: number,
  size: number,
): GpuLocation => ({
  container_id: source.containerId,
  offset,
  size,
  section_index: null,
  section_name: null,
});
/** Row identity and both encoded/header locations belong to the same coordinate space. */
export const gpuObject = (
  source: GpuSource,
  input: {
    offset: number;
    size: number;
    kind: GpuObject["kind"];
    metadata?: { offset: number; size: number };
  },
): GpuObject => {
  const { offset, size, kind, metadata = { offset, size: 0 } } = input;
  return {
    id: `${source.containerId ?? "file"}@${metadata.offset.toString(16)}`,
    parent_id: source.containerId,
    kind,
    target: null,
    payload_target: null,
    cuda_target_header: null,
    amd_target_metadata: null,
    target_consistency: "unexamined",
    bundle_id: null,
    compression: "none",
    compression_id: null,
    encoded_size: size,
    decoded_size: size,
    sha256: null,
    raw_flags: null,
    location: gpuLocation(source, offset, size),
    metadata_location: gpuLocation(source, metadata.offset, metadata.size),
    inspection: "inventory",
    limitations: [],
  };
};
