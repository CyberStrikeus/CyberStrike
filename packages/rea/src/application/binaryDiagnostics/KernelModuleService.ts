import { isAbsolute } from "node:path";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { KernelModulePort } from "./KernelModulePort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { elfObjectTypeName } from "../../domain/native/elfNotes.js";
import {
  inspectKernelModuleInputSchema,
  kernelModuleSchema,
  KERNEL_MODULE_VERSION_ENTRY_BYTES,
  MAX_KERNEL_MODULE_RAW_BYTES,
  MODULE_SIGNATURE_INFO_BYTES,
  MODULE_SIGNATURE_MAGIC,
  MODULE_SIGNATURE_PKCS7_ID_TYPE,
  type KernelModule,
} from "../../domain/native/kernelModule.js";
import { BINARY_ARCHITECTURES } from "../../domain/binaryTargetTypes.js";
import { elfArchitecture } from "../../domain/elfFixedHeader.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

const OPERATION = "inspect_kernel_module";

type Range = { readonly offset: number; readonly bytes: number };

/** Shared caller validation, output parsing and Evidence provenance for CLI/MCP. */
export class KernelModuleService {
  constructor(readonly provider: KernelModulePort) {}

  close(): Promise<void> {
    return this.provider.close?.() ?? Promise.resolve();
  }

  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const input = parseAnalysisInput(
      OPERATION,
      rawInput,
      inspectKernelModuleInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    if (!isAbsolute(input.value.path))
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: "Expected an absolute filesystem path on this host.",
          },
        ]),
      );
    const result = await this.provider.inspect(input.value, options);
    if (!result.ok) return result;
    const report = kernelModuleSchema.safeParse(result.value);
    if (
      !report.success ||
      report.data.artifact.path !== input.value.path ||
      !validReport(
        report.data,
        input.value.max_entries,
        input.value.max_file_bytes,
      )
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Kernel module provider returned malformed output or changed artifact identity.",
        ),
      );
    const value = report.data;
    const machine = value.machine;
    const mapped = machine === null ? undefined : elfArchitecture(machine);
    const architecture = BINARY_ARCHITECTURES.find(
      (supported) => supported === mapped,
    );
    const locations = [
      { kind: "artifact-path" as const, path: value.artifact.path },
      ...rangesOf(value).map((range) => ({
        kind: "file-offset-range" as const,
        start: range.offset,
        end: range.offset + range.bytes,
      })),
    ];
    return completeProviderEvidence(
      createEvidence(
        {
          path: value.artifact.path,
          format: value.applicability === "unsupported" ? "file" : "elf",
          sha256: value.artifact.sha256,
          ...(architecture === undefined ? {} : { architecture }),
        },
        this.provider.identity,
        {
          operation: OPERATION,
          parameters: input.value,
          result: value,
          confidence: "observed",
          limitations: value.limitations,
          locations,
        },
      ),
      options?.signal,
    );
  }
}

const inside =
  (fileBytes: number) =>
  (range: Range): boolean =>
    range.bytes <= fileBytes && range.offset <= fileBytes - range.bytes;

const rangesOf = (report: KernelModule): Range[] => {
  const found: Range[] = [];
  const add = (range: Range | null | undefined): void => {
    if (range !== null && range !== undefined) found.push(range);
  };
  add(report.modinfo?.location);
  for (const entry of report.modinfo?.entries ?? []) add(entry.location);
  add(report.versions?.location);
  for (const entry of report.versions?.entries ?? []) add(entry.location);
  add(report.this_module?.location);
  add(report.init_text?.location);
  add(report.exit_text?.location);
  for (const section of report.ksymtab?.sections ?? []) add(section.location);
  add(report.signature?.magic);
  add(report.signature?.info?.location);
  add(report.signature?.pkcs7?.location);
  return found;
};

const modinfoConsistent = (
  modinfo: NonNullable<KernelModule["modinfo"]>,
): boolean => {
  const closed =
    modinfo.status === "malformed" || modinfo.status === "unsupported";
  if (closed) {
    if (modinfo.reason === null || modinfo.entries.length !== 0) return false;
  } else if (modinfo.reason !== null) return false;
  if (modinfo.status === "absent" || modinfo.status === "unknown") {
    if (
      modinfo.location !== null ||
      modinfo.sha256 !== null ||
      modinfo.entries.length !== 0
    )
      return false;
  }
  if (
    modinfo.status === "present" &&
    (modinfo.location === null || modinfo.sha256 === null)
  )
    return false;
  return modinfo.entries.every((entry, index) => {
    if (entry.index !== index) return false;
    const rawFits = entry.location.bytes <= MAX_KERNEL_MODULE_RAW_BYTES;
    if (rawFits) {
      if (
        entry.raw_hex === null ||
        entry.raw_hex.length !== entry.location.bytes * 2
      )
        return false;
    } else if (entry.raw_hex !== null) return false;
    if (entry.status === "observed")
      return (
        entry.reason === null && entry.key !== null && entry.value !== null
      );
    return entry.reason !== null;
  });
};

const versionsConsistent = (
  versions: NonNullable<KernelModule["versions"]>,
): boolean => {
  if (
    versions.layout === null ||
    versions.entry_bytes !== KERNEL_MODULE_VERSION_ENTRY_BYTES
  )
    return false;
  const closed =
    versions.status === "malformed" || versions.status === "unsupported";
  if (closed) {
    if (versions.reason === null || versions.entries.length !== 0) return false;
  } else if (versions.reason !== null) return false;
  if (versions.status === "absent" || versions.status === "unknown") {
    if (
      versions.location !== null ||
      versions.sha256 !== null ||
      versions.entries.length !== 0
    )
      return false;
  }
  if (
    versions.status === "present" &&
    (versions.location === null || versions.sha256 === null)
  )
    return false;
  const width = versions.layout === "elf64_unsigned_long_name56" ? 16 : 8;
  return versions.entries.every((entry, index) => {
    if (entry.index !== index || entry.crc_hex.length !== width) return false;
    if (entry.location.bytes !== KERNEL_MODULE_VERSION_ENTRY_BYTES)
      return false;
    if (entry.status === "observed")
      return entry.reason === null && entry.name !== null;
    return entry.reason !== null && entry.name === null;
  });
};

const signatureConsistent = (
  signature: NonNullable<KernelModule["signature"]>,
): boolean => {
  if (signature.status === "absent")
    return (
      signature.reason === null &&
      signature.magic === null &&
      signature.info === null &&
      signature.pkcs7 === null
    );
  if (signature.magic === null || signature.reason === null) {
    if (signature.status !== "present") return false;
  }
  if (signature.status === "present") {
    const info = signature.info;
    const pkcs7 = signature.pkcs7;
    if (
      signature.reason !== null ||
      signature.magic === null ||
      info === null ||
      pkcs7 === null
    )
      return false;
    return (
      info.id_type === MODULE_SIGNATURE_PKCS7_ID_TYPE &&
      info.algo === 0 &&
      info.hash === 0 &&
      info.signer_len === 0 &&
      info.key_id_len === 0 &&
      info.pad.every((value) => value === 0) &&
      info.sig_len === pkcs7.location.bytes &&
      pkcs7.location.offset + pkcs7.location.bytes === info.location.offset &&
      signature.magic.offset === info.location.offset + info.location.bytes &&
      signature.magic.bytes === MODULE_SIGNATURE_MAGIC.length &&
      info.location.bytes === MODULE_SIGNATURE_INFO_BYTES &&
      info.sig_len < info.location.offset
    );
  }
  if (signature.pkcs7 !== null || signature.reason === null) return false;
  if (signature.status === "unsupported")
    return (
      signature.reason === "signature_id_type_not_pkcs7" &&
      signature.info !== null &&
      signature.magic !== null
    );
  if (signature.reason === "signature_trailer_truncated")
    return signature.info === null && signature.magic !== null;
  return signature.info !== null && signature.magic !== null;
};

const sizedConsistent = (
  section: NonNullable<KernelModule["init_text"]>,
): boolean => {
  if (section.status === "absent" || section.status === "unknown")
    return (
      section.location === null &&
      section.bytes === null &&
      section.compressed === null
    );
  if (section.location === null) return section.bytes === null;
  return (
    section.bytes === section.location.bytes && section.compressed !== null
  );
};

const metadataAbsent = (report: KernelModule): boolean =>
  report.modinfo === null &&
  report.versions === null &&
  report.this_module === null &&
  report.ksymtab === null &&
  report.init_text === null &&
  report.exit_text === null &&
  report.signature === null;

const validReport = (
  report: KernelModule,
  maxEntries: number,
  maxBytes: number,
): boolean => {
  if (
    report.artifact.bytes > maxBytes ||
    report.coverage.examined_entries > maxEntries ||
    !rangesOf(report).every(inside(report.artifact.bytes))
  )
    return false;
  if (report.applicability === "unsupported")
    return (
      report.coverage.status === "unsupported" &&
      report.coverage.examined_entries === 0 &&
      report.compression !== null &&
      report.next_probe?.operation === "external_decompression" &&
      report.format === null &&
      report.byte_order === null &&
      report.machine === null &&
      report.type === null &&
      report.type_name === null &&
      metadataAbsent(report)
    );
  if (
    report.format === null ||
    report.byte_order === null ||
    report.machine === null ||
    report.type === null ||
    report.type_name !== elfObjectTypeName(report.type) ||
    report.compression !== null ||
    report.next_probe !== null
  )
    return false;
  if (report.applicability === "not_applicable")
    return (
      report.coverage.status === "not_applicable" &&
      report.coverage.examined_entries === 0 &&
      report.type !== 1 &&
      metadataAbsent(report)
    );
  if (report.applicability !== "applicable") return false;
  if (
    report.coverage.status !== "complete" ||
    report.modinfo === null ||
    report.versions === null ||
    report.this_module === null ||
    report.this_module.layout !== "unknown" ||
    report.ksymtab === null ||
    report.init_text === null ||
    report.exit_text === null ||
    report.signature === null
  )
    return false;
  if (
    report.coverage.examined_entries !==
    report.modinfo.entries.length +
      report.versions.entries.length +
      report.ksymtab.sections.length
  )
    return false;
  if (
    !report.ksymtab.sections.every(
      (section) => (section.name === null) === (section.reason !== null),
    )
  )
    return false;
  if (report.type !== 1) return false;
  return (
    modinfoConsistent(report.modinfo) &&
    versionsConsistent(report.versions) &&
    signatureConsistent(report.signature) &&
    sizedConsistent(report.init_text) &&
    sizedConsistent(report.exit_text)
  );
};
