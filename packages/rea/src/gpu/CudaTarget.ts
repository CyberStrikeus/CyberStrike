import type { NativeSectionDirectory } from "../native/metadata/NativeSectionDirectory.js";
import { gpuLocation, type GpuPayloadTarget } from "./GpuObject.js";
import { rejectGpu, type GpuSource } from "./GpuSource.js";

/** ABI-qualified e_flags layouts, checked against NVIDIA producer/cuobjdump oracles. */
export const readCudaTarget = (
  source: GpuSource,
  directory: NativeSectionDirectory,
): GpuPayloadTarget => {
  if (
    directory.format !== "elf" ||
    directory.machine !== 190 ||
    directory.elf_os_abi === null
  )
    return rejectGpu("CUDA target declaration requires a CUDA ELF header");
  const flags = directory.flags;
  const legacy = directory.elf_os_abi === 0x33;
  const newer =
    directory.elf_os_abi === 0x41 &&
    directory.bits === 64 &&
    directory.little &&
    (flags & 0x00ff00ff) === 2;
  const architecture = legacy
    ? flags & 0xff
    : newer
      ? (flags >>> 8) & 0xff
      : null;
  const value =
    architecture !== null && architecture >= 10 ? `sm_${architecture}` : null;
  const cudaHeader = {
    os_abi: directory.elf_os_abi,
    flags: `0x${flags.toString(16).padStart(8, "0")}`,
    location: gpuLocation(source, 0, directory.bits === 64 ? 64 : 52),
  };
  return {
    value,
    key: value,
    scope: "cuda-base",
    cudaHeader,
    ...(value === null
      ? {
          limitation: `CUDA ELF target encoding is unknown for OS ABI 0x${directory.elf_os_abi?.toString(16)} and flags ${cudaHeader.flags}; the raw header remains available.`,
        }
      : {}),
  };
};
