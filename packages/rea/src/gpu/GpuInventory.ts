import {
  CCOB_MAGIC,
  CLANG_BUNDLE_MAGIC,
  findLegacyCcobRecoveryTotal,
  readClangBundleDirectory,
  readCcobHeader,
} from "./ClangOffloadBundle.js";
import { gpuObject, gpuLocation, type GpuPayloadTarget } from "./GpuObject.js";
import { readCudaTarget } from "./CudaTarget.js";
import { readCudaFatbinary } from "./CudaFatbinary.js";
import { decodeGpuPayload, decodeGpuPayloadStream } from "./GpuPayloadCodec.js";
import { createHash } from "node:crypto";
import { scheduler } from "node:timers/promises";
import type {
  GpuCodeObjectsInput,
  GpuCodeObjects,
  GpuObject,
  GpuKernel,
} from "../domain/gpu/gpuCodeObjects.js";
import {
  BinaryFormatFailure,
  BinaryResourceFailure,
} from "../native/metadata/BinaryContainer.js";
import {
  readElfSectionDirectory,
  readPeSectionDirectory,
  type NativeSectionDirectory,
} from "../native/metadata/NativeSectionDirectory.js";
import { assertArtifactReadActive } from "../artifacts/ArtifactFileOperation.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  GpuBufferSource,
  checkGpuRange,
  GPU_OBJECT_BYTES,
  GPU_REPORT_BYTES,
  GpuReportCapacityFailure,
  gpuCount,
  nextGpuContainerOffset,
  gpuSha256,
  readGpuNativeDirectory,
  rejectGpu,
  type GpuSource,
} from "./GpuSource.js";
import {
  readGpuElfKernels,
  readAmdElfMetadata,
  type AmdElfMetadata,
} from "./GpuElfKernels.js";
import {
  ptxTargetIdentity,
  readPtxKernels,
  readPtxTarget,
} from "./PtxKernels.js";
import type { AmdGpuTargetIdentity } from "./AmdGpuTarget.js";

/** File declarations only. Every child range stays in its named parent coordinate space. */
export class GpuInventory {
  readonly objects: GpuObject[] = [];
  readonly kernels: GpuKernel[] = [];
  readonly ptx_artifacts: GpuCodeObjects["ptx_artifacts"] = [];
  readonly limitations = [
    "Static declarations only; no GPU execution, SASS disassembly, host launch correlation or runtime compatibility was verified.",
    "Object IDs are positional identities scoped to artifact.sha256. Locations inside decoded objects name their containing object; they are not file offsets.",
  ];
  discovery: "complete" | "partial" = "complete";
  examined_sections = 0;
  unknown_section_names = 0;
  #factBytes = 0;
  #workBytes = 0;
  readonly #outerTargets = new WeakMap<
    GpuObject,
    string | AmdGpuTargetIdentity | null
  >();
  readonly #selectedObjects: ReadonlySet<string> | undefined;
  readonly #selectedTargets: ReadonlySet<string> | undefined;
  constructor(
    readonly input: GpuCodeObjectsInput,
    readonly signal?: AbortSignal,
  ) {
    this.#selectedObjects =
      input.object_ids === undefined ? undefined : new Set(input.object_ids);
    this.#selectedTargets =
      input.targets === undefined ? undefined : new Set(input.targets);
    this.#retain({ path: input.path, limitations: this.limitations });
    this.#factBytes += 1024;
  }
  #retain(value: JsonValue): void {
    const bytes = jsonValueByteLength(value, GPU_REPORT_BYTES);
    if (bytes + 2 > GPU_REPORT_BYTES - this.#factBytes)
      throw new GpuReportCapacityFailure();
    this.#factBytes += bytes + 2;
  }
  #add(row: GpuObject, amdTarget?: AmdGpuTargetIdentity | null): void {
    if (row.raw_flags !== null || row.bundle_id !== null)
      this.#outerTargets.set(row, amdTarget ?? row.target);
    this.#retain(row);
    this.#retain(" ".repeat(32)); // Reserve all later inspection-state changes.
    this.objects.push(row);
  }
  #decoded(row: GpuObject, sha256: string, size: number): void {
    this.#retain({ sha256, decoded_size: size });
    row.sha256 = sha256;
    row.decoded_size = size;
  }
  #encodedExtent(row: GpuObject, size: number): void {
    this.#retain({ encoded_size: size, size });
    row.encoded_size = size;
    row.location.size = size;
  }
  #objectLimitations(row: GpuObject, messages: string[]): void {
    this.#retain(messages);
    row.limitations.push(...messages);
  }
  /** Reserve input/output work atomically, before any payload allocation or read. */
  #budgetWork(...sizes: number[]): void {
    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (
      sizes.some((size) => size > GPU_OBJECT_BYTES) ||
      total > 512 * 1024 * 1024 - this.#workBytes
    )
      throw new BinaryResourceFailure(
        "structure",
        GPU_OBJECT_BYTES,
        "GPU reads/decoding exceed 128 MiB per buffer or 512 MiB per inspection",
      );
    this.#workBytes += total;
  }
  #selected(row: GpuObject): boolean {
    return (
      (this.#selectedObjects === undefined ||
        this.#selectedObjects.has(row.id)) &&
      (this.#selectedTargets === undefined ||
        (row.target !== null && this.#selectedTargets.has(row.target)))
    );
  }
  async inspect(
    source: GpuSource,
    depth = 0,
  ): Promise<GpuCodeObjects["format"]> {
    assertArtifactReadActive(this.signal);
    if (depth > 8)
      throw new BinaryResourceFailure(
        "structure",
        8,
        "GPU container nesting exceeds eight levels",
      );
    const prefix = await source.read(0, Math.min(32, source.size));
    if (prefix.subarray(0, 4).equals(Buffer.from([0x50, 0xed, 0x55, 0xba]))) {
      await this.#cuda(source);
      return "cuda-fatbin";
    }
    if (
      prefix.subarray(0, CLANG_BUNDLE_MAGIC.length).equals(CLANG_BUNDLE_MAGIC)
    ) {
      await this.#hip(source, depth);
      return "hip-bundle";
    }
    if (prefix.subarray(0, CCOB_MAGIC.length).equals(CCOB_MAGIC)) {
      await this.#hip(source, depth);
      return "hip-bundle";
    }
    if (
      prefix.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      (prefix[0] === 0x4d && prefix[1] === 0x5a)
    ) {
      const elf = prefix[0] === 0x7f;
      const directory = await readGpuNativeDirectory(
        source,
        elf
          ? readElfSectionDirectory(source.size)
          : readPeSectionDirectory(source.size),
      );
      if (elf && (directory.machine === 190 || directory.machine === 224)) {
        const row = gpuObject(source, {
          offset: 0,
          size: source.size,
          kind: directory.machine === 190 ? "cubin" : "amdgpu",
        });
        this.#add(row);
        if (directory.machine === 190) {
          this.#target(row, readCudaTarget(source, directory));
        }
        if (directory.machine === 224)
          await this.#amdPayload(source, row, directory);
        else await this.#payload(source, row);
      } else {
        for (const section of directory.sections) {
          this.examined_sections++;
          if (section.name === null) {
            this.unknown_section_names++;
            this.discovery = "partial";
            continue;
          }
          if (!isGpuSection(section.name)) continue;
          if (
            !section.file_backed ||
            (directory.format === "elf" && (section.flags & 0x800n) !== 0n)
          ) {
            this.discovery = "partial";
            const message = `GPU section ${section.index} has no supported uncompressed file range`;
            this.#retain(message);
            this.limitations.push(message);
            continue;
          }
          const offset = gpuCount(section.offset),
            size = gpuCount(section.size);
          const borrowed: GpuSource = {
            size,
            containerId: source.containerId,
            read: (start, length) => {
              checkGpuRange(size, start, length);
              return source.read(offset + start, length);
            },
          };
          // A section is a coordinate space with an explicit physical backing, including PE short names.
          const row = gpuObject(source, {
            offset: offset,
            size: size,
            kind: "native-section",
            metadata: {
              offset: section.header_offset,
              size:
                directory.format === "elf"
                  ? directory.bits === 64
                    ? 64
                    : 40
                  : 40,
            },
          });
          row.location.section_index = section.index;
          row.location.section_name = section.name;
          this.#add(row);
          const sectionSource: GpuSource = { ...borrowed, containerId: row.id };
          try {
            await this.inspect(sectionSource, depth + 1);
            row.inspection = "complete";
          } catch (cause) {
            this.#retainFailure(row, cause);
            this.discovery = "partial";
          }
        }
      }
      return directory.format;
    }
    // PTX is positively identified by its directives, never by extension or arbitrary embedded text.
    let probe = await source.read(0, Math.min(source.size, 64 * 1024));
    let targetFacts = readPtxTarget(probe.toString("utf8"));
    if (probe.length < Math.min(source.size, GPU_REPORT_BYTES)) {
      probe = await source.read(0, Math.min(source.size, GPU_REPORT_BYTES));
      targetFacts = readPtxTarget(probe.toString("utf8"));
    }
    if (targetFacts.recognized) {
      const target = probe.length === source.size ? targetFacts.target : null;
      const limitation =
        probe.length < source.size
          ? "PTX target scan reached the 16 MiB text budget before all module directives were examined."
          : targetFacts.limitation;
      const row = gpuObject(source, {
        offset: 0,
        size: source.size,
        kind: "ptx",
      });
      row.target = target;
      if (limitation !== null) {
        row.inspection = "partial";
        row.limitations.push(limitation);
        this.discovery = "partial";
      }
      this.#add(row);
      await this.#payload(
        probe.length === source.size
          ? new GpuBufferSource(probe, source.containerId)
          : source,
        row,
      );
      return "ptx";
    }
    if (probe.length < source.size)
      throw new BinaryResourceFailure(
        "structure",
        GPU_REPORT_BYTES,
        "Standalone text recognition exceeds the 16 MiB PTX budget before a target was established",
      );
    throw new BinaryFormatFailure(
      "unsupported",
      "No supported CUDA/HIP container or PTX declarations were identified",
    );
  }
  #retainFailure(row: GpuObject, cause: unknown): void {
    if (cause instanceof GpuReportCapacityFailure) throw cause;
    if (
      !(cause instanceof BinaryFormatFailure) &&
      !(cause instanceof BinaryResourceFailure)
    )
      throw cause;
    row.inspection =
      cause instanceof BinaryResourceFailure
        ? "capacity"
        : cause.kind === "unsupported"
          ? "unsupported"
          : "malformed";
    this.#objectLimitations(row, [cause.message]);
  }
  async #payload(
    source: GpuSource,
    row: GpuObject,
    preparedAmd?: AmdElfMetadata,
  ): Promise<void> {
    if (this.input.analysis !== "kernels") return;
    if (!this.#selected(row)) {
      row.inspection = "not-selected";
      return;
    }
    if (row.compression === "unsupported") {
      row.inspection = "unsupported";
      return;
    }
    try {
      let coverage: "complete" | "partial" = "complete";
      if (
        row.kind === "ptx" &&
        (row.decoded_size === null || row.decoded_size > GPU_REPORT_BYTES)
      )
        throw new BinaryResourceFailure(
          "structure",
          GPU_REPORT_BYTES,
          "PTX text exceeds the 16 MiB retained report budget",
        );
      const compression = row.compression;
      const compressed =
        compression === "zstd" ||
        compression === "zlib" ||
        compression === "lz4";
      if (compressed && row.decoded_size === null)
        rejectGpu("Compressed GPU object has no decoded length");
      this.#budgetWork(
        row.location.size,
        ...(compressed ? [row.decoded_size!] : []),
      );
      let bytes = await source.read(row.location.offset, row.location.size);
      if (compressed) {
        try {
          bytes = await decodeGpuPayload(
            bytes,
            compression,
            row.decoded_size!,
            this.signal,
          );
        } catch (cause) {
          if (cause instanceof BinaryResourceFailure) throw cause;
          assertArtifactReadActive(this.signal);
          throw new BinaryFormatFailure(
            "malformed",
            "GPU payload decompression failed",
          );
        }
      }
      this.#decoded(row, gpuSha256(bytes), bytes.length);
      const decoded = new GpuBufferSource(bytes, row.id);
      if (row.kind === "ptx") {
        // NVIDIA appends NUL alignment padding to an uncompressed PTX entry.
        let length = bytes.length;
        if (row.raw_flags !== null)
          while (length > 0 && bytes[length - 1] === 0) length--;
        const content = bytes.subarray(0, length);
        let text: string;
        try {
          text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(content);
        } catch {
          return rejectGpu("PTX is not valid UTF-8 text");
        }
        const target = readPtxTarget(text);
        const conflict = this.#target(row, {
          value: target.target,
          key: target.target,
          scope: "exact",
          ...(target.limitation === null
            ? {}
            : { limitation: target.limitation }),
        });
        if (conflict !== undefined) coverage = "partial";
        const parsed = readPtxKernels(text, row.id);
        const artifact = {
          id: `${row.id}/ptx`,
          object_id: row.id,
          sha256: gpuSha256(content),
          media_type: "text/x-ptx" as const,
          encoding: "utf-8" as const,
          byte_length: content.length,
          text,
          location: gpuLocation(decoded, 0, content.length),
        };
        this.#retain(artifact);
        this.ptx_artifacts.push(artifact);
        for (const { kernel, coverage: kernelCoverage } of parsed) {
          if (conflict !== undefined) kernel.limitations.push(conflict);
          if (kernelCoverage === "partial") coverage = "partial";
          this.#retain(kernel);
          this.kernels.push(kernel);
        }
      } else if (row.kind === "cubin" || row.kind === "amdgpu") {
        if (row.kind === "amdgpu" && isLlvmBitcode(bytes))
          throw new BinaryFormatFailure("unsupported", LLVM_BITCODE_LIMITATION);
        coverage = await this.#elfFacts(decoded, row, row.kind, preparedAmd);
      } else {
        row.inspection = "unsupported";
        this.#objectLimitations(row, [
          "Payload kind is outside kernel metadata coverage",
        ]);
        return;
      }
      row.inspection = coverage;
    } catch (cause) {
      this.#retainFailure(row, cause);
    }
  }
  #target(row: GpuObject, payload: GpuPayloadTarget): string | undefined {
    const selectedTarget = row.target;
    const outerIdentity = this.#outerTargets.get(row) ?? null;
    const outer =
      typeof outerIdentity === "string"
        ? outerIdentity
        : (outerIdentity?.key ?? null);
    const payloadKey =
      payload.scope === "amdgpu"
        ? (payload.identity?.key ?? null)
        : payload.key;
    const hasOuter = outer !== null;
    let state: GpuObject["target_consistency"] = "unknown";
    if (payload.value !== null && !hasOuter) state = "single-source";
    else if (outer !== null && payloadKey !== null) {
      if (payload.scope === "cuda-base") {
        const base = /^sm_([0-9]+)[a-z]*$/u.exec(outer)?.[1];
        const inner = /^sm_([0-9]+)$/u.exec(payloadKey)?.[1];
        if (base !== undefined && inner !== undefined)
          state = base === inner ? "base-only" : "conflict";
      } else if (payload.scope === "amdgpu") {
        if (outer === payloadKey) state = "consistent";
        else
          state =
            typeof outerIdentity === "object" &&
            outerIdentity !== null &&
            payload.identity !== null &&
            outerIdentity.processor === payload.identity.processor
              ? "unknown"
              : "conflict";
      } else if (ptxTargetIdentity(outer) === ptxTargetIdentity(payloadKey))
        state = "consistent";
      else state = "conflict";
    }
    this.#retain({
      payload_target: payload.value,
      cuda_target_header: payload.cudaHeader ?? null,
      amd_target_metadata: payload.amdMetadata ?? null,
      target_consistency: state,
      target: selectedTarget ?? payload.value,
    });
    row.payload_target = payload.value;
    row.cuda_target_header = payload.cudaHeader ?? null;
    row.amd_target_metadata = payload.amdMetadata ?? null;
    row.target_consistency = state;
    if (selectedTarget === null) row.target = payload.value;
    if (row.target === null) this.discovery = "partial";
    if (state !== "conflict" && payload.limitation === undefined) return;
    const message =
      state === "conflict"
        ? `Conflicting target declarations: inventory ${outer}; payload ${payload.value}. Target agreement is not established.`
        : payload.limitation!;
    if (!row.limitations.includes(message))
      this.#objectLimitations(row, [message]);
    return message;
  }
  async #amdPayload(
    source: GpuSource,
    row: GpuObject,
    directory?: NativeSectionDirectory,
  ): Promise<void> {
    const child: GpuSource = {
      size: row.location.size,
      containerId: row.id,
      read: (offset, size) => {
        checkGpuRange(row.location.size, offset, size);
        this.#budgetWork(size);
        return source.read(row.location.offset + offset, size);
      },
    };

    try {
      // An AMD target declaration does not establish an ELF representation.
      // Without an outer target, inventory must still avoid an ELF corruption
      // claim for recognizable bitcode; its inner target remains unexamined.
      if (
        directory === undefined &&
        isLlvmBitcode(await child.read(0, Math.min(4, child.size)))
      ) {
        this.discovery = "partial";
        if (this.input.analysis !== "kernels" || !this.#selected(row))
          this.#objectLimitations(row, [LLVM_BITCODE_LIMITATION]);
        await this.#payload(source, row);
        return;
      }
      const native =
        directory ??
        (await readGpuNativeDirectory(
          child,
          readElfSectionDirectory(child.size),
        ));
      const inspected = await readAmdElfMetadata(child, native);
      const prepared = inspected.ok ? inspected.value : inspected.error.partial;
      if (prepared.limitations.length > 0) this.discovery = "partial";
      this.#target(row, {
        value: prepared.target,
        identity: prepared.targetIdentity,
        amdMetadata: prepared.targetMetadata,
        scope: "amdgpu",
      });
      if (!inspected.ok) {
        this.discovery = "partial";
        if (this.input.analysis === "kernels" && this.#selected(row))
          await this.#elfFacts(child, row, "amdgpu", prepared);
        else this.#objectLimitations(row, prepared.limitations);
        this.#retainFailure(row, inspected.error.cause);
        return;
      }
      const payloadSelected =
        this.input.analysis === "kernels" && this.#selected(row);
      await this.#payload(source, row, prepared);
      if (!payloadSelected && prepared.limitations.length > 0)
        this.#objectLimitations(row, prepared.limitations);
    } catch (cause) {
      this.discovery = "partial";
      this.#retainFailure(row, cause);
    }
  }
  async #elfFacts(
    source: GpuSource,
    row: GpuObject,
    kind: "cubin" | "amdgpu",
    preparedAmd?: AmdElfMetadata,
  ): Promise<"complete" | "partial"> {
    let conflict: string | undefined;
    const parsed = await readGpuElfKernels(
      source,
      kind,
      (kernel) => {
        if (conflict !== undefined) kernel.limitations.push(conflict);
        this.#retain(kernel);
        this.kernels.push(kernel);
      },
      preparedAmd,
      (target) => {
        conflict = this.#target(row, target);
      },
    );
    this.#objectLimitations(row, parsed.limitations);
    return conflict !== undefined ? "partial" : parsed.coverage;
  }
  async #cuda(source: GpuSource): Promise<void> {
    for await (const row of readCudaFatbinary(source, this.signal)) {
      this.#add(row);
      await this.#payload(source, row);
    }
  }
  async #hip(source: GpuSource, depth: number): Promise<void> {
    let base = 0;
    let bundles = 0;
    let legacyWindow: { offset: number; bytes: Buffer } | undefined;
    while (base < source.size) {
      if (++bundles % 128 === 0) {
        await scheduler.yield();
        assertArtifactReadActive(this.signal);
      }
      const prefix = await source.read(base, Math.min(32, source.size - base));
      if (prefix.subarray(0, 24).equals(CLANG_BUNDLE_MAGIC)) {
        const directory = await readClangBundleDirectory(
          source,
          base,
          this.signal,
        );
        for (const { object: row, amdTarget } of directory.declarations) {
          this.#add(row, amdTarget);
          if (row.kind === "host") row.inspection = "complete";
          else if (row.kind === "amdgpu" && row.target === null)
            await this.#amdPayload(source, row);
          else await this.#payload(source, row);
        }
        base = await nextGpuContainerOffset(source, directory.end);
        continue;
      }
      if (!prefix.subarray(0, CCOB_MAGIC.length).equals(CCOB_MAGIC))
        rejectGpu("Unexpected bytes between Clang offload bundles");
      const header = readCcobHeader(prefix, source.size - base),
        { width, decoded, hash, version, method } = header;
      let total = header.total;
      let extentKnown = version !== 1;
      const row = gpuObject(source, {
        offset: base + width,
        size: total - width,
        kind: "hip-bundle",
        metadata: { offset: base, size: width },
      });
      row.compression =
        method === 0 ? "zlib" : method === 1 ? "zstd" : "unsupported";
      row.compression_id = `ccob:${version}:${method}`;
      row.decoded_size = decoded;
      if (extentKnown) this.#add(row);
      if (row.compression === "unsupported") {
        row.inspection = "unsupported";
        this.#objectLimitations(row, ["Unsupported CCOB compression method"]);
        this.discovery = "partial";
      } else
        try {
          // v1 has no encoded size. Supply a bounded suffix, then retain only
          // the codec's completed extent, never an embedded CCOB marker.
          const inputSize =
            version === 1
              ? Math.min(total - width, GPU_OBJECT_BYTES)
              : total - width;
          let data: Buffer;
          if (version === 1) {
            const start = base + width;
            const cached =
              legacyWindow !== undefined &&
              start >= legacyWindow.offset &&
              start < legacyWindow.offset + legacyWindow.bytes.length;
            const readWindow = async (): Promise<Buffer> => {
              this.#budgetWork(inputSize, decoded);
              legacyWindow = undefined;
              const bytes = await source.read(start, inputSize);
              legacyWindow = { offset: start, bytes };
              return bytes;
            };
            if (cached) this.#budgetWork(decoded);
            let encoded: Buffer | undefined = cached
              ? legacyWindow!.bytes.subarray(start - legacyWindow!.offset)
              : await readWindow();
            const available = encoded.length;
            const compression = row.compression;
            const completed = await decodeGpuPayloadStream(
              encoded,
              compression,
              decoded,
              this.signal,
            ).catch(async (cause: unknown) => {
              // A cached window may end inside this sibling. Refill once
              // before treating that incomplete view as a malformed stream.
              if (
                !(cause instanceof BinaryFormatFailure) ||
                !cached ||
                available >= inputSize
              )
                throw cause;
              // Retire the previous window before allocating its replacement.
              encoded = undefined;
              return decodeGpuPayloadStream(
                await readWindow(),
                compression,
                decoded,
                this.signal,
              );
            });
            total = width + completed.consumedBytes;
            extentKnown = true;
            this.#encodedExtent(row, completed.consumedBytes);
            // Publish the completed parent extent before inspecting its children.
            this.#add(row);
            data = completed.buffer;
            if (data.length !== decoded)
              rejectGpu(
                "GPU decompressed length disagrees with its declaration",
              );
          } else {
            this.#budgetWork(inputSize, decoded);
            data = await decodeGpuPayload(
              await source.read(base + width, inputSize),
              row.compression,
              decoded,
              this.signal,
            );
          }
          if (
            createHash("md5").update(data).digest().readBigUInt64LE(0) !== hash
          )
            rejectGpu("CCOB truncated MD5 does not match decoded bytes");
          this.#decoded(row, gpuSha256(data), data.length);
          await this.inspect(new GpuBufferSource(data, row.id), depth + 1);
          row.inspection = "complete";
        } catch (cause) {
          this.#retainFailure(row, cause);
          this.discovery = "partial";
        }
      if (!extentKnown) {
        if (row.inspection !== "capacity")
          try {
            total = await findLegacyCcobRecoveryTotal(source, base);
          } catch (cause) {
            if (!(cause instanceof BinaryResourceFailure)) throw cause;
            this.#retainFailure(row, cause);
          }
        // A capacity refusal cannot establish a boundary for later siblings.
        if (row.inspection === "capacity") {
          this.#objectLimitations(row, [
            "CCOB v1 codec extent is unknown; the retained size is only the containing tail, not a completed codec extent. Later siblings were not inferred.",
          ]);
          this.#add(row);
          return;
        }
        this.#encodedExtent(row, total - width);
        this.#objectLimitations(row, [
          total < source.size - base
            ? "CCOB v1 codec extent is unknown; the next CCOB marker is only an uncertain recovery candidate."
            : "CCOB v1 codec extent is unknown; the retained range extends to the container end.",
        ]);
        this.#add(row);
      }
      base = await nextGpuContainerOffset(source, base + total);
    }
  }
}
const LLVM_BITCODE_LIMITATION =
  "LLVM bitcode kernel metadata is outside current coverage; bitcode validity and inner target were not inspected.";
/** LLVM raw and wrapper signatures identify representation, not bitcode validity. */
const isLlvmBitcode = (bytes: Buffer): boolean =>
  bytes.length >= 4 &&
  (bytes.readUInt32LE(0) === 0xdec04342 ||
    bytes.readUInt32LE(0) === 0x0b17c0de);
const isGpuSection = (name: string): boolean =>
  [
    ".nv_fatbin",
    ".nv_fatb",
    ".hip_fatbin",
    ".hip_fat",
    ".llvm.offloading",
  ].includes(name);
