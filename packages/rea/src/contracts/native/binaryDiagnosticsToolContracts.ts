import {
  inspectDevicetreeInputSchema,
  devicetreeSchema,
} from "../../domain/firmware/devicetree.js";
import {
  devicetreeSummaryViewResultSchema,
  binaryLayoutSummaryViewResultSchema,
  nativeExportsSummaryViewResultSchema,
} from "../../domain/analysisView/analysisView.js";
import {
  inspectPeLoadConfigInputSchema,
  peLoadConfigSchema,
} from "../../domain/native/peLoadConfig.js";
import { inspectByteEntropyInputSchema } from "../../domain/native/byteEntropy.js";
import { byteEntropyOutputSchema } from "../toolOutputSchemaGroups.js";
import {
  inspectRecordedCrashInputSchema,
  recordedCrashSchema,
} from "../../domain/native/recordedCrash.js";
import {
  inspectBinaryLayoutInputSchema,
  binaryLayoutSchema,
} from "../../domain/native/binaryLayout.js";
import {
  analysisDetailOutputSchemaOf,
  analysisDetailSchema,
} from "../analysisDetail.js";
import {
  inspectNativeExportsInputSchema,
  nativeExportsSchema,
} from "../../domain/native/nativeExports.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
import {
  inspectPeResourcesInputSchema,
  peResourcesSchema,
} from "../../domain/native/peResources.js";
import {
  inspectPeCertificatesInputSchema,
  peCertificatesSchema,
} from "../../domain/native/peCertificates.js";
import {
  inspectPeImportsInputSchema,
  peImportsSchema,
} from "../../domain/native/peImports.js";
import {
  inspectElfNotesInputSchema,
  elfNotesSchema,
} from "../../domain/native/elfNotes.js";
import {
  inspectAppleIpsInputSchema,
  appleIpsSchema,
} from "../../domain/native/appleIps.js";
import {
  inspectKernelModuleInputSchema,
  kernelModuleSchema,
} from "../../domain/native/kernelModule.js";

/** Caller-selected delivery of completed binary layout Evidence. */
export const inspectBinaryLayoutRequestSchema =
  inspectBinaryLayoutInputSchema.extend({ detail: analysisDetailSchema });

export const inspectNativeExportsRequestSchema =
  inspectNativeExportsInputSchema.extend({ detail: analysisDetailSchema });

/** Public byte-entropy input retains the producer schema's closed-object policy. */
export const inspectByteEntropyRequestSchema =
  inspectByteEntropyInputSchema.extend({ detail: analysisDetailSchema });

/** Offline binary diagnostics are independent of macOS process/UI providers. */
export const BINARY_DIAGNOSTICS_TOOL_CONTRACTS = [
  {
    name: "inspect_devicetree",
    ...toolContractMetadata("inspect_devicetree"),
    kind: "native-provider",
    description:
      "Inspect an explicit local flattened devicetree blob (FDT v16/v17) without execution or external tools. Returns validated header, memory reservations, full node/property tree with bounded raw hex, derived standard strings, cells and parent-sized reg tuples, aliases and selected single-cell phandle references with unresolved targets. Binding-specific arrays, overlays and runtime hardware remain unknown. Malformed structure or exhausted named budgets fails without partial success. Complete detail returns all Evidence inline; summary retains it for inspect_analysis_view kind devicetree, collections nodes, properties (requires exact path), reservations and references, with offset/limit pagination.",
    inputSchema: inspectDevicetreeInputSchema.extend({
      detail: analysisDetailSchema,
    }),
    outputSchema: analysisDetailOutputSchemaOf(
      devicetreeSchema,
      devicetreeSummaryViewResultSchema,
    ),
    examples: [
      {
        title: "Inspect a firmware hardware description",
        input: { path: "/artifacts/board.dtb", detail: "summary" },
      },
    ],
  },
  {
    name: "inspect_pe_load_config",
    ...toolContractMetadata("inspect_pe_load_config"),
    kind: "native-provider",
    description:
      "Inspect PE32/PE32+ TLS callbacks and sized load configuration without executing the image. Returns callback VA/RVA/file offsets and sections, security cookie, SafeSEH (PE32), CFG flags and table pointers/counts, EH continuation and XFG fields. Flag-derived mitigation claims are labeled inferred. Absent directories are null; malformed structures and exhausted budgets fail without partial success. Reads a stable local regular file without a disassembler.",
    inputSchema: inspectPeLoadConfigInputSchema,
    outputSchema: evidenceResultOf(peLoadConfigSchema),
    examples: [
      {
        title: "Inspect PE TLS callbacks and load configuration",
        input: { path: "/artifacts/program" },
      },
    ],
  },

  {
    name: "inspect_elf_notes",
    ...toolContractMetadata("inspect_elf_notes"),
    kind: "native-provider",
    description:
      "Inspect one explicit local ELF32/ELF64 image's PT_NOTE program headers and SHT_NOTE sections without executing it or opening a disassembler. Returns note-table file ranges, owners, types, descriptor SHA-256 and hex previews, plus GNU build-id, ABI-tag and gold-version fields when those descriptors match. A missing table is observed absence of those declarations, not proof the image never carried notes in another container. Reads a stable regular file; malformed ELF headers, truncated notes and exhausted budgets return no partial success. Portable on supported Node hosts; no debug package or catalog is required.",
    inputSchema: inspectElfNotesInputSchema,
    outputSchema: evidenceResultOf(elfNotesSchema),
    examples: [
      {
        title: "Inspect ELF GNU build-id and ABI-tag notes",
        input: { path: "/artifacts/program" },
      },
    ],
  },
  {
    name: "inspect_apple_ips",
    ...toolContractMetadata("inspect_apple_ips"),
    kind: "native-provider",
    description:
      "Inspect one explicit local Apple .ips crash report without executing a target, launching atos, or opening a disassembler. Parses the first-line metadata object and, when bug_type is the string 309, the crash body: process identity, exception and termination facts, threads, usedImages, lossless integer registers, and deterministic classification from documented SIGKILL, EXC_GUARD, pointer-authentication and dyld strings. Other bug_type values, including 288 stackshots, return no crash result. A missing or truncated body fails without partial success. Opened Mach-O and dSYM UUID joins remain unobserved. Portable on supported Node hosts; no Xcode or pwntools required.",
    inputSchema: inspectAppleIpsInputSchema,
    outputSchema: evidenceResultOf(appleIpsSchema),
    examples: [
      {
        title: "Inspect an Apple .ips crash report",
        input: { path: "/artifacts/app.ips" },
      },
    ],
  },
  {
    name: "inspect_kernel_module",
    ...toolContractMetadata("inspect_kernel_module"),
    kind: "native-provider",
    description:
      "Inspect one explicit local ELF32/ELF64 ET_REL Linux kernel module without executing it or opening a disassembler. Returns ordered .modinfo key/value entries (duplicates preserved), __versions symbol CRCs, presence of .gnu.linkonce.this_module and __ksymtab sections, observed .init.text and .exit.text sizes, and an appended module signature trailer with its module_signature fields plus a PKCS#7 byte range and SHA-256. Does not execute the module, decode struct module, or validate certificates. A missing section is observed absence when section names are known, not proof the module never carried that metadata. Other ELF types are not applicable. gzip, xz, and zstd containers are unsupported and name external_decompression as the next probe; neither this tool nor extract_artifact decodes those codecs, so decompress with an external utility and inspect the result. Reads a stable regular file; malformed ELF headers and exhausted entry budgets return no partial success. Portable on supported Node hosts.",
    inputSchema: inspectKernelModuleInputSchema,
    outputSchema: evidenceResultOf(kernelModuleSchema),
    examples: [
      {
        title:
          "Inspect Linux kernel module license, vermagic, and dependencies",
        input: { path: "/artifacts/demo.ko" },
      },
    ],
  },
  {
    name: "inspect_byte_entropy",
    ...toolContractMetadata("inspect_byte_entropy"),
    kind: "native-provider",
    description:
      "Inspect Shannon byte entropy for one explicit local file offline, without execution, extraction or external tools. Returns file-wide SHA-256 and entropy, fixed-block entropy for an optional offset/length window, and adjacent high (>=7.2) and low (<=1.0) runs with exact file offsets. Block size is a power of two from 256 to 65536 (default 4096). Complete output can become very large because it includes one row per selected block, and summary detail still retains that full list. Use a shorter length or a larger block_size; the selected window is limited to 32,768 output blocks. Entropy cannot distinguish compression from encryption. Summary detail returns file entropy plus the ten longest runs; retrieve parent Evidence for the full series. The entire file is read even for a window.",
    inputSchema: inspectByteEntropyRequestSchema,
    outputSchema: byteEntropyOutputSchema,
    examples: [
      {
        title: "Profile firmware bytes before extraction",
        input: { path: "/artifacts/firmware.bin" },
      },
      {
        title: "Summarize a selected byte window",
        input: {
          path: "/artifacts/firmware.bin",
          offset: 4096,
          length: 65536,
          block_size: 4096,
          detail: "summary",
        },
      },
    ],
  },
  {
    name: "inspect_pe_certificates",
    ...toolContractMetadata("inspect_pe_certificates"),
    kind: "native-provider",
    description:
      "Inspect one explicit local PE32/PE32+ image's IMAGE_DIRECTORY_ENTRY_SECURITY table without executing it, verifying signatures or opening a disassembler. Returns WIN_CERTIFICATE file ranges, types and payload SHA-256, plus structurally decoded PKCS#7 signedData digest algorithms, embedded X.509 serial/issuer/subject/validity fields and signer identifiers, including a subject key identifier, when type 2 is present. A missing directory is observed absence of that table, not proof the image is unsigned in every catalog or overlay sense. Authenticode digest coverage, chain validity and timestamp trust remain unobserved. Reads a stable regular file; malformed PE headers, truncated WIN_CERTIFICATE entries, X.509 certificates missing subjectPublicKeyInfo or signatureValue, and non-signedData PKCS#7 return no partial success. Portable on supported Node hosts; no Windows SDK or engine installation required.",
    inputSchema: inspectPeCertificatesInputSchema,
    outputSchema: evidenceResultOf(peCertificatesSchema),
    examples: [
      {
        title: "Inspect PE Authenticode certificate identities",
        input: { path: "/artifacts/application.exe" },
      },
    ],
  },
  {
    name: "inspect_pe_imports",
    ...toolContractMetadata("inspect_pe_imports"),
    kind: "native-provider",
    description:
      "Inspect one explicit local PE32/PE32+ image's IMAGE_DIRECTORY_ENTRY_IMPORT and delay-load tables without executing it or opening a disassembler. Returns DLL names, named and ordinal functions, ILT/IAT RVAs, delay-load descriptors, and the pefile import hash of the standard import table, withheld with a reason when that table is partial or pefile would hash a different row sequence. A missing import directory is observed absence of that table, not proof the image never imported APIs through another table or overlay. Bound snapshots, loaded IAT contents and export-forward resolution remain unobserved. Reads a stable regular file; malformed PE headers and exhausted DLL or function budgets return no partial success. Unreadable names or thunks and descriptors missing a required table are reported as partial coverage with issues. Portable on supported Node hosts; no Windows SDK or engine installation required.",
    inputSchema: inspectPeImportsInputSchema,
    outputSchema: evidenceResultOf(peImportsSchema),
    examples: [
      {
        title: "Inspect PE import and delay-load identities",
        input: { path: "/artifacts/application.exe" },
      },
    ],
  },
  {
    name: "inspect_pe_resources",
    ...toolContractMetadata("inspect_pe_resources"),
    kind: "native-provider",
    description:
      "Inspect one explicit local PE32/PE32+ image's complete bounded type/name/language resource tree without executing it or opening a disassembler. Returns numeric IDs versus original UTF-16 names, directory identity paths including empty branches, directory/data-entry file locations, payload RVA/file ranges, complete SHA-256 hashes and static RT_GROUP_ICON image-resource candidates. Language fallback, image decoding and actual shell/window loading remain unobserved. Reads a stable regular file; malformed or ambiguous mappings, non-identical overlapping ranges and exhausted budgets return no partial success. Portable on supported Node hosts; no Windows SDK or engine installation required.",
    inputSchema: inspectPeResourcesInputSchema,
    outputSchema: evidenceResultOf(peResourcesSchema),
    examples: [
      {
        title: "Inspect PE resource identities and icon relationships",
        input: { path: "/artifacts/application.exe" },
      },
    ],
  },
  {
    name: "inspect_native_exports",
    ...toolContractMetadata("inspect_native_exports"),
    kind: "native-provider",
    description:
      "Inspect one explicit local PE or ELF image's export table without executing it or opening an engine: PE export-directory names, ordinals, addresses and forwarders, or ELF defined default/protected global, weak and unique .dynsym symbols with type, binding and symbol version. Ordinal-only, forwarded and hidden-version exports stay distinct. Portable on any supported host. Coverage is partial when table entries are unreadable and unsupported when ELF dynamic symbols cannot be enumerated from the available section metadata; an empty complete inventory means the image declares no exports. Mach-O exports use inspect_macho. Omitted/complete detail preserves inline delivery. Select detail summary to retain complete Evidence and return identity, counts and source coverage. Query inspect_analysis_view kind native-exports, collection exports or issues, with exact names/original indices, fields and matching-row pagination. Names return every version or alias; source_index is scoped to the parent Evidence. ELF name projections keep raw-byte and encoding qualifications.",
    inputSchema: inspectNativeExportsRequestSchema,
    outputSchema: analysisDetailOutputSchemaOf(
      nativeExportsSchema,
      nativeExportsSummaryViewResultSchema,
    ),
    examples: [
      {
        title: "List a native library's exports",
        input: { path: "/artifacts/native/libexample.so" },
      },
    ],
  },
  {
    name: "inspect_binary_layout",
    ...toolContractMetadata("inspect_binary_layout"),
    kind: "native-provider",
    description:
      "Inspect an explicit local binary without launching it as a host process. Returns file-backed section/segment ranges, linked addresses, original symbol/REL/RELA table identities, complete encoded RELR tables and upstream-derived offsets with unknown per-word locations/addends, raw name bytes, dependency/interpreter names and static mitigation inferences inline with artifact SHA-256 Evidence. Profile: EXEC/DYN/REL ELF64 x86-64, ELF32 i386, ELF32 little-endian ARM and ELF32 little- or big-endian MIPS on Linux x64 via caller-supplied Python with unchanged pwntools 4.15.0, pyelftools 0.33 and Unicorn 2.1.2. Runtime addresses/library paths, overall relocation inventory completeness and complete derived GOT/PLT coverage remain unknown. Zero executable entry values mean absence; relocatable entries are not applicable. Upstream can emulate PLT instructions with Unicorn for derived static maps. Uses bounded complete output and owned temporary files/processes; malformed, unsupported or oversized objects return no partial success. Select detail summary to retain the complete layout Evidence in this session and receive only its summary view, then inspect sections, symbols, mitigations or linkage with inspect_analysis_view. pwntools_timeout_ms is each owned pwntools command's deadline (omitted means 30000 ms, range 1..2147483647, next call). cpuSeconds 30 and the output, diagnostic, and address-space byte allowances have no runtime override.",
    inputSchema: inspectBinaryLayoutRequestSchema,
    outputSchema: analysisDetailOutputSchemaOf(
      binaryLayoutSchema,
      binaryLayoutSummaryViewResultSchema,
    ),
    examples: [
      {
        title: "Inspect ELF linked and file layout",
        input: { path: "/artifacts/application.elf" },
      },
      {
        title: "Retain the complete layout and return its summary view",
        input: { path: "/artifacts/application.elf", detail: "summary" },
      },
    ],
  },
  {
    name: "inspect_recorded_crash",
    ...toolContractMetadata("inspect_recorded_crash"),
    kind: "native-provider",
    description:
      "Inspect a supplied Linux ELF64 amd64 or AArch64 little-endian core without launching its target or attaching to any live PID. Returns all recorded segments, raw note owners/descriptors and source ranges, every Linux CORE PRSTATUS thread/register and SIGINFO fields inline with SHA-256 Evidence. Historical PID is recorded metadata; current process/file identity, note coverage and signal-thread associations stay unknown. Optionally add derived core-only GDB/pwndbg mapping candidates through explicit BYO configuration; zero map flags mean unknown permissions. Uses the same stable snapshot for both stages, bounded complete output and owned cleanup. Linux x64 host profile: unchanged pwntools 4.15.0/pyelftools 0.33/Unicorn 2.1.2; optional unchanged pwndbg 2026.09.15. No implicit executable/library pairing, GDB command language, host configuration changes or dependency installation. pwntools_timeout_ms is each owned pwntools command's deadline (omitted means 30000 ms, range 1..2147483647, next call). cpuSeconds 30 and the output, diagnostic, and address-space byte allowances have no runtime override.",
    inputSchema: inspectRecordedCrashInputSchema,
    outputSchema: evidenceResultOf(recordedCrashSchema),
    examples: [
      {
        title: "Inspect recorded registers and signal evidence",
        input: { path: "/artifacts/crash.core" },
      },
      {
        title: "Add core-only debugger mapping candidates",
        input: {
          path: "/artifacts/crash.core",
          include_debugger_context: true,
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
