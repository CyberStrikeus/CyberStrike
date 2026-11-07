import { readCudaTarget } from "./CudaTarget.js";
import {
  type AmdGpuTargetIdentity,
  readAmdGpuElfProcessor,
  readAmdGpuNoteTarget,
} from "./AmdGpuTarget.js";
import type { GpuPayloadTarget } from "./GpuObject.js";
import { err, ok, type Result } from "../domain/result.js";
import { elfNoteLayout } from "../domain/native/elfNoteLayout.js";
import {
  CudaMetadataBudget,
  readCudaInfo,
  readCudaParameters,
} from "./CudaInfo.js";
import type { GpuKernel, GpuLocation } from "../domain/gpu/gpuCodeObjects.js";
import {
  BinaryReader,
  BinaryFormatFailure,
  BinaryResourceFailure,
} from "../native/metadata/BinaryContainer.js";
import {
  readElfSectionDirectory,
  type NativeSection,
  type NativeSectionDirectory,
} from "../native/metadata/NativeSectionDirectory.js";
import { readElfString } from "../native/metadata/ElfStringTable.js";
import { readElfSymbol } from "../domain/elfSymbol.js";
import {
  gpuCount,
  readGpuNativeDirectory,
  rejectGpu,
  type GpuSource,
} from "./GpuSource.js";
import {
  AMD_METADATA_BYTES,
  amdCount,
  amdRecord,
  amdString,
  readAmdMetadata,
} from "./AmdGpuMetadata.js";
const sectionBytes = (
  source: GpuSource,
  section: NativeSection,
  budget?: CudaMetadataBudget,
): Promise<Buffer> => {
  if (!section.file_backed || (section.flags & 0x800n) !== 0n)
    rejectGpu("GPU metadata section has no supported uncompressed file range");
  budget?.read(gpuCount(section.size));
  return source.read(gpuCount(section.offset), gpuCount(section.size));
};
const site = (
  source: GpuSource,
  section: NativeSection,
  offset = 0,
  size = gpuCount(section.size),
): GpuLocation => ({
  container_id: source.containerId,
  offset: gpuCount(section.offset) + offset,
  size,
  section_index: section.index,
  section_name: section.name,
});
const blankKernel = (
  source: GpuSource,
  id: string,
  name: string,
  location: GpuLocation,
): GpuKernel => ({
  id: `${source.containerId!}/${id}`,
  object_id: source.containerId!,
  representation: "cuda-elf-metadata",
  name,
  symbol: name,
  parameter_count: null,
  parameter_bytes: null,
  parameters: [],
  registers: {
    physical: null,
    sgpr: null,
    vgpr: null,
    agpr: null,
    virtual: [],
  },
  shared_bytes: null,
  private_bytes: null,
  location,
  sources: { parameters: null, registers: null, shared: null, private: null },
  limitations: [],
});
export const readGpuElfKernels = async (
  source: GpuSource,
  kind: "cubin" | "amdgpu",
  onKernel: (kernel: GpuKernel) => void,
  preparedAmd?: AmdElfMetadata,
  onTarget?: (target: GpuPayloadTarget) => void,
): Promise<{
  limitations: string[];
  coverage: "complete" | "partial";
}> => {
  if (kind === "amdgpu" && preparedAmd !== undefined)
    return amdKernels(source, preparedAmd, onKernel, onTarget);
  const directory = await readGpuNativeDirectory(
    source,
    readElfSectionDirectory(source.size),
  );
  if (directory.machine !== (kind === "cubin" ? 190 : 224))
    rejectGpu("GPU entry kind disagrees with ELF machine");
  if (kind === "cubin") {
    onTarget?.(readCudaTarget(source, directory));
    const coverage = await cudaKernels(source, directory, onKernel);
    return {
      coverage,
      limitations: [
        ...(directory.sections.some((s) => s.name === null)
          ? [
              "Some ELF section names are unknown; named metadata coverage is partial",
            ]
          : []),
        ...(directory.sections.some((s) => s.type === 2 || s.type === 11)
          ? []
          : [
              "No CUBIN symbol table was available; kernel declaration coverage is unknown",
            ]),
      ],
    };
  }
  const metadata = await readAmdElfMetadata(source, directory);
  const parsed = amdKernels(
    source,
    metadata.ok ? metadata.value : metadata.error.partial,
    onKernel,
    onTarget,
  );
  if (!metadata.ok) throw metadata.error.cause;
  return parsed;
};
const indexCudaMetadata = async (
  source: GpuSource,
  directory: NativeSectionDirectory,
) => {
  const infosByText = new Map<number, NativeSection[]>(),
    sharedByText = new Map<number, NativeSection[]>();
  const registerFacts = new Map<string, Map<number, GpuLocation>>();
  const budget = new CudaMetadataBudget(),
    seenMetadata = new Set<string>();
  for (const row of directory.sections) {
    const map =
      row.type === 8 && row.name?.startsWith(".nv.shared.") === true
        ? sharedByText
        : row.type === 0x70000000 && row.name?.startsWith(".nv.info.") === true
          ? infosByText
          : undefined;
    const global = row.type === 0x70000000 && row.name === ".nv.info";
    if (map === undefined && !global) continue;
    // The same scoped byte declaration may be aliased by many ELF headers.
    const key = `${row.type}:${row.flags}:${row.name}:${row.offset}:${row.size}:${row.link}:${row.info}`;
    if (seenMetadata.has(key)) continue;
    budget.retain(key);
    seenMetadata.add(key);
    if (map !== undefined) {
      budget.retain({ text: row.info, section: row.index });
      const values = map.get(row.info) ?? [];
      values.push(row);
      map.set(row.info, values);
    }
    if (global) {
      for (const record of readCudaInfo(
        await sectionBytes(source, row, budget),
        directory.little,
        budget,
      )) {
        if (record.format !== 4 || record.attribute !== 0x2f) continue;
        if (record.data.length !== 8)
          rejectGpu("CUDA register count record has an unsupported extent");
        const r = new BinaryReader(record.data, directory.little),
          key = `${row.link}:${r.u32(0)}`;
        const values = registerFacts.get(key) ?? new Map<number, GpuLocation>();
        const value = r.u32(4);
        if (!values.has(value)) {
          const location = site(source, row, record.offset, record.length);
          budget.retain({ symbol: key, value, location });
          values.set(value, location);
          registerFacts.set(key, values);
        }
      }
    }
  }
  const allNamesKnown = directory.sections.every((row) => row.name !== null);
  return {
    source,
    directory,
    infosByText,
    sharedByText,
    registerFacts,
    allNamesKnown,
    budget,
    parameters: new Map<number, ReturnType<typeof readCudaParameters>>(),
  };
};
type CudaMetadataIndex = Awaited<ReturnType<typeof indexCudaMetadata>>;

const attachCudaResources = (
  kernel: GpuKernel,
  text: NativeSection,
  index: CudaMetadataIndex,
  symbolKey: string,
): "complete" | "partial" => {
  const { source, directory } = index;
  const registerRows = index.registerFacts.get(symbolKey);
  const registerValues = new Set(registerRows?.keys());
  const sectionRegisters = text.info >>> 24;
  kernel.registers.physical =
    registerValues.size === 1
      ? [...registerValues][0]!
      : registerValues.size === 0 && sectionRegisters !== 0
        ? sectionRegisters
        : null;
  if (registerValues.size === 1)
    kernel.sources.registers = registerRows!.values().next().value!;
  else if (sectionRegisters !== 0)
    kernel.sources.registers = {
      container_id: source.containerId,
      offset: text.header_offset,
      size: directory.bits === 64 ? 64 : 40,
      section_index: text.index,
      section_name: text.name,
    };
  const registerConflict =
    registerValues.size > 1 ||
    (kernel.registers.physical !== null &&
      sectionRegisters !== 0 &&
      kernel.registers.physical !== sectionRegisters);
  if (registerConflict) {
    kernel.registers.physical = null;
    kernel.limitations.push(
      "Conflicting CUDA register declarations; physical count remains unknown",
    );
  }
  const shared = index.sharedByText.get(text.index) ?? [];
  kernel.shared_bytes =
    shared.length === 1
      ? gpuCount(shared[0]!.size)
      : shared.length === 0 && index.allNamesKnown
        ? 0
        : null;
  if (shared.length === 1)
    kernel.sources.shared = {
      container_id: source.containerId,
      offset: shared[0]!.header_offset,
      size: directory.bits === 64 ? 64 : 40,
      section_index: shared[0]!.index,
      section_name: shared[0]!.name,
    };
  return registerConflict ? "partial" : "complete";
};

const cudaKernels = async (
  source: GpuSource,
  directory: NativeSectionDirectory,
  onKernel: (kernel: GpuKernel) => void,
): Promise<"complete" | "partial"> => {
  const index = await indexCudaMetadata(source, directory);
  let complete = index.allNamesKnown;
  let symbolTables = 0;
  for (const section of directory.sections) {
    if (section.type !== 2 && section.type !== 11) continue;
    symbolTables++;
    const width = gpuCount(section.entry_size),
      minimum = directory.bits === 64 ? 24 : 16;
    if (width < minimum || section.size % BigInt(width) !== 0n)
      rejectGpu("CUBIN symbol table width is invalid");
    const namesSection = directory.sections[section.link];
    if (namesSection === undefined || namesSection.type !== 3)
      rejectGpu("CUBIN symbol string table is invalid");
    const names = await sectionBytes(source, namesSection!, index.budget);
    const bytes = await sectionBytes(source, section, index.budget);
    const symbolCount = bytes.length / width;
    let extendedIndices: Buffer | null = null;
    for (let offset = 0; offset < bytes.length; offset += width) {
      index.budget.visit();
      const parsedSymbol = readElfSymbol(
        bytes.subarray(offset, offset + width),
        directory.bits,
        directory.little,
      );
      if (!parsedSymbol.ok)
        throw new BinaryFormatFailure(
          parsedSymbol.error.kind,
          parsedSymbol.error.message,
        );
      const symbol = parsedSymbol.value;
      // STO_CUDA_ENTRY distinguishes launchable kernels from ordinary device functions.
      if (symbol.type !== 2 || (symbol.other & 0x10) === 0) continue;
      let sectionIndex = symbol.section_index;
      if (sectionIndex === 0xffff) {
        if (extendedIndices === null) {
          const matches = directory.sections.filter(
            (row) => row.type === 18 && row.link === section.index,
          );
          if (matches.length !== 1)
            rejectGpu(
              "CUBIN extended symbol section-index table is unavailable",
            );
          const extended = matches[0]!;
          if (
            extended.entry_size !== 4n ||
            extended.size !== BigInt(symbolCount) * 4n
          )
            rejectGpu(
              "CUBIN extended symbol section-index table has an invalid extent",
            );
          extendedIndices = await sectionBytes(source, extended, index.budget);
        }
        sectionIndex = new BinaryReader(extendedIndices, directory.little).u32(
          (offset / width) * 4,
        );
      }
      const text = directory.sections[sectionIndex];
      if (text === undefined || text.type !== 1 || (text.flags & 4n) === 0n)
        rejectGpu("CUBIN kernel symbol has no executable section");
      const kernel = blankKernel(
        source,
        `sym:${section.index}:${offset / width}`,
        readElfString(names, symbol.name_offset),
        site(source, section, offset, width),
      );
      if (
        attachCudaResources(
          kernel,
          text!,
          index,
          `${section.index}:${offset / width}`,
        ) === "partial"
      )
        complete = false;
      const infos = index.infosByText.get(text!.index) ?? [];
      if (infos.length === 1) {
        const info = infos[0]!;
        let decoded = index.parameters.get(info.index);
        if (decoded === undefined) {
          decoded = readCudaParameters(
            await sectionBytes(source, info, index.budget),
            directory.little,
            index.budget,
          );
          index.budget.retain({ parameter_section: info.index });
          index.parameters.set(info.index, decoded);
        }
        if (decoded.limitations.length > 0) complete = false;
        kernel.sources.parameters = site(source, infos[0]!);
        kernel.parameter_bytes = decoded.parameter_bytes;
        kernel.parameter_count = decoded.parameter_count;
        kernel.parameters = decoded.parameters;
        kernel.limitations.push(...decoded.limitations);
      } else {
        complete = false;
        kernel.limitations.push(
          "Exactly one matching CUDA nv.info parameter section was not available",
        );
      }
      kernel.limitations.push(
        "CUDA metadata fields are declarations from ELF symbols, section headers and nv.info; SASS and runtime behavior were not inspected",
      );
      onKernel(kernel);
    }
  }
  return complete && symbolTables > 0 ? "complete" : "partial";
};
export interface AmdElfMetadata {
  readonly target: string | null;
  readonly targetIdentity: AmdGpuTargetIdentity | null;
  readonly targetMetadata: import("../domain/gpu/gpuCodeObjects.js").GpuObject["amd_target_metadata"];
  readonly limitations: string[];
  readonly notes: {
    section: NativeSection;
    noteOffset: number;
    desc: number;
    size: number;
    kernels: unknown[];
  }[];
}
/** One bounded parsed owner for target discovery and later selected kernel projection. */
export const readAmdElfMetadata = async (
  source: GpuSource,
  directory: NativeSectionDirectory,
): Promise<
  Result<
    AmdElfMetadata,
    { kind: "incomplete-amd-metadata"; cause: unknown; partial: AmdElfMetadata }
  >
> => {
  const limitations: string[] = [];
  const notes: AmdElfMetadata["notes"] = [];
  let retainedBytes = 0;
  let unsupportedNotes = false;
  let targetMetadata: AmdElfMetadata["targetMetadata"] = null;
  const observed = (): AmdElfMetadata => {
    const targets = new Set(
      (targetMetadata?.notes ?? []).flatMap(({ target }) =>
        target === null ? [] : [target],
      ),
    );
    const processor = targetMetadata?.processor ?? null;
    const noteTarget = targets.size === 1 ? [...targets][0]! : null;
    const noteIdentity =
      noteTarget === null ? null : readAmdGpuNoteTarget(noteTarget);
    const noteConflict = targets.size > 1;
    const processorConflict =
      processor !== null &&
      noteIdentity !== null &&
      processor !== noteIdentity.processor;
    const invalidTarget = (targetMetadata?.notes ?? []).some(
      ({ target_state }) => target_state === "invalid",
    );
    const conflict = noteConflict || processorConflict || invalidTarget;
    const limitation = invalidTarget
      ? "AMDGPU note target is not a string; processor identity is unknown"
      : noteConflict
        ? "AMDGPU notes declare conflicting processor targets; processor identity is unknown"
        : processorConflict
          ? "AMDGPU ELF processor flags conflict with target note metadata; processor identity is unknown"
          : null;
    if (limitation !== null && !limitations.includes(limitation))
      limitations.push(limitation);
    const target = conflict ? null : (noteTarget ?? processor);
    // LLVM notes use both the empty and explicit `unknown` environment forms.
    const targetIdentity = conflict
      ? null
      : (noteIdentity ??
        (noteTarget === null && processor !== null
          ? { key: processor, processor }
          : null));
    return { target, targetIdentity, targetMetadata, limitations, notes };
  };
  try {
    if (directory.machine !== 224)
      rejectGpu("AMDGPU metadata requires an AMDGPU ELF machine");
    targetMetadata = {
      flags: `0x${directory.flags.toString(16).padStart(8, "0")}`,
      processor: readAmdGpuElfProcessor(directory.flags),
      header_location: {
        container_id: source.containerId,
        offset: 0,
        size: directory.bits === 64 ? 64 : 52,
        section_index: null,
        section_name: null,
      },
      note_coverage: "partial",
      notes: [],
    };

    for (const section of directory.sections) {
      if (section.type !== 7) continue;
      const sectionSize = gpuCount(section.size);
      if (sectionSize > AMD_METADATA_BYTES - retainedBytes)
        throw new BinaryResourceFailure(
          "structure",
          AMD_METADATA_BYTES,
          "AMDGPU ELF note discovery exceeds the 8 MiB retained metadata budget",
        );
      retainedBytes += sectionSize;
      const bytes = await sectionBytes(source, section),
        r = new BinaryReader(bytes, directory.little);
      for (let p = 0; p < bytes.length;) {
        if (bytes.length - p < 12) rejectGpu("Truncated ELF note header");
        const namesize = r.u32(p),
          size = r.u32(p + 4),
          type = r.u32(p + 8);
        // AMDGPU metadata uses four-byte note padding regardless of section alignment.
        const layout = elfNoteLayout(namesize, size, 4);
        const nameOffset = p + 12,
          desc = p + layout.descriptor,
          end = p + layout.next;
        r.range(nameOffset, namesize, "ELF note vendor");
        r.range(desc, size, "ELF note descriptor");
        if (end > bytes.length)
          rejectGpu("ELF note alignment extends outside its section");
        const vendor = bytes
          .subarray(nameOffset, nameOffset + namesize)
          .toString("latin1")
          .replace(/\0$/u, "");
        if (vendor === "AMDGPU" && type === 32) {
          const metadata = amdRecord(
            readAmdMetadata(bytes.subarray(desc, desc + size)),
          );
          if (metadata === null) rejectGpu("AMDGPU metadata is not a map");
          const target = amdString(metadata?.["amdhsa.target"]);
          const target_state = !Object.hasOwn(metadata!, "amdhsa.target")
            ? "absent"
            : target === null
              ? "invalid"
              : "declared";
          if (target_state === "invalid") unsupportedNotes = true;
          targetMetadata.notes.push({
            target,
            target_state,
            location: site(source, section, desc, size),
          });
          const kernels = metadata?.["amdhsa.kernels"];
          if (!Array.isArray(kernels))
            return rejectGpu("AMDGPU metadata has no valid kernel array");
          notes.push({ section, noteOffset: p, desc, size, kernels });
        } else if (vendor === "AMD" && (type === 10 || type === 11)) {
          unsupportedNotes = true;
          limitations.push(
            "Legacy AMDGPU YAML metadata is outside MessagePack coverage",
          );
        }
        p = end;
      }
    }
    targetMetadata.note_coverage =
      unsupportedNotes || directory.sections.length === 0
        ? "partial"
        : "complete";
    if (notes.length === 0)
      throw new BinaryFormatFailure(
        "unsupported",
        "No AMDGPU v3+ MessagePack kernel metadata was available",
      );
    return ok(observed());
  } catch (cause) {
    return err({ kind: "incomplete-amd-metadata", cause, partial: observed() });
  }
};

const amdKernels = (
  source: GpuSource,
  prepared: AmdElfMetadata,
  onKernel: (kernel: GpuKernel) => void,
  onTarget?: (target: GpuPayloadTarget) => void,
): { limitations: string[]; coverage: "complete" | "partial" } => {
  onTarget?.({
    value: prepared.target,
    identity: prepared.targetIdentity,
    amdMetadata: prepared.targetMetadata,
    scope: "amdgpu",
  });
  for (const {
    section,
    noteOffset,
    desc,
    size,
    kernels: rows,
  } of prepared.notes) {
    for (let index = 0; index < rows.length; index++) {
      const value = amdRecord(rows[index]);
      const name = value === null ? null : amdString(value[".name"]);
      if (value === null || name === null)
        rejectGpu("AMDGPU kernel metadata has no name");
      const kernel = blankKernel(
        source,
        `note:${section.index}:${noteOffset}:${index}`,
        name!,
        site(source, section, desc, size),
      );
      kernel.representation = "amdgpu-metadata";
      kernel.sources = {
        parameters: kernel.location,
        registers: kernel.location,
        shared: kernel.location,
        private: kernel.location,
      };
      kernel.symbol = amdString(value![".symbol"]);
      kernel.parameter_bytes = amdCount(value![".kernarg_segment_size"]);
      kernel.shared_bytes = amdCount(value![".group_segment_fixed_size"]);
      kernel.private_bytes = amdCount(value![".private_segment_fixed_size"]);
      kernel.registers.sgpr = amdCount(value![".sgpr_count"]);
      kernel.registers.vgpr = amdCount(value![".vgpr_count"]);
      kernel.registers.agpr = amdCount(value![".agpr_count"]);
      const args = value![".args"];
      if (Array.isArray(args)) {
        kernel.parameter_count = args.length;
        kernel.parameters = args.map((argument, ordinal) => {
          const row = amdRecord(argument);
          if (row === null) rejectGpu("Malformed AMDGPU argument metadata");
          const kind = amdString(row![".value_kind"]);
          return {
            ordinal,
            name: amdString(row![".name"]),
            offset: amdCount(row![".offset"]),
            size: amdCount(row![".size"]),
            type: amdString(row![".type_name"]),
            hidden: kind === null ? null : kind.startsWith("hidden_"),
          };
        });
      }
      kernel.limitations.push(
        "AMDGPU parameter count includes hidden ABI arguments when present; missing fields remain unknown. Kernel metadata is a declaration, not runtime verification.",
      );
      onKernel(kernel);
    }
  }
  return {
    limitations: prepared.limitations,
    coverage: prepared.limitations.length === 0 ? "complete" : "partial",
  };
};
