import type { ManagedMethodImplementationFlags } from "./ManagedMethodDefinitionRows.js";
import {
  admitManagedProjection,
  type ManagedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import type { ManagedPeLayout } from "./ManagedPeReader.js";
import type {
  ManagedMethodBody,
  ParsedTokenInstruction,
} from "./ManagedMemberInspectorCore.js";
import {
  decodeInstructions,
  parseExceptionRegions,
} from "./ManagedMemberInstructionDecoder.js";
import { validateExceptionRegionRanges } from "./ManagedExceptionRegionValidation.js";
import {
  metadataRowCursor,
  metadataTokenFact,
  type MetadataTokenFact,
  readMetadataBlob,
  sha256Bytes,
} from "./ManagedMetadataHeaps.js";
import {
  readLocalSignatureFacts,
  isParsedTokenInstruction,
} from "./ManagedMemberInspectorCore.js";
import { ManagedReaderFailure } from "./ManagedReaderFailure.js";
import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";

const EMPTY_CATCH_TOKENS: ReadonlyMap<number, MetadataTokenFact> = new Map();

const bodyStatus = (
  decodedIssue: string | null,
  truncatedInstructions: number,
  exceptionRegions: ReturnType<typeof parseExceptionRegions> | null,
  localSigFailure: "malformed" | "partial" | null,
): "malformed" | "partial" | "present" => {
  if (
    decodedIssue !== null ||
    exceptionRegions?.status === "malformed" ||
    localSigFailure === "malformed"
  )
    return "malformed";
  if (truncatedInstructions > 0 || localSigFailure === "partial")
    return "partial";
  return "present";
};

interface MethodBodyHeader {
  readonly format: "tiny" | "fat";
  readonly size: number;
  readonly flags: number;
  readonly maxStack: number;
  readonly ilSize: number;
  readonly localSig: number;
}

const readMethodBodyHeader = (
  bytes: Buffer,
  offset: number,
): MethodBodyHeader => {
  const first = bytes.readUInt8(offset);
  if ((first & 3) === 2)
    return {
      format: "tiny",
      size: 1,
      flags: 0,
      maxStack: 8,
      ilSize: first >> 2,
      localSig: 0,
    };
  if ((first & 3) !== 3) throw new RangeError("Unsupported method body header");
  if (offset > bytes.length - 12)
    throw new RangeError("Fat method body header leaves artifact");
  const flagsAndSize = bytes.readUInt16LE(offset);
  const headerDwords = flagsAndSize >>> 12;
  if (headerDwords < 3)
    throw new RangeError("Fat method body header is smaller than 12 bytes");
  const size = headerDwords * 4;
  if (offset > bytes.length - size)
    throw new RangeError("Method body header leaves artifact");
  return {
    format: "fat",
    size,
    flags: flagsAndSize & 0x0fff,
    maxStack: bytes.readUInt16LE(offset + 2),
    ilSize: bytes.readUInt32LE(offset + 4),
    localSig: bytes.readUInt32LE(offset + 8),
  };
};

export interface MethodBodyContext {
  readonly implementation: ManagedMethodImplementationFlags;
  readonly budget: ManagedDecodeBudget;
  readonly metadataLayout: ManagedMetadataLayout;
  readonly methodToken: string;
  readonly memberRefKinds: ReadonlyMap<string, "field" | "method">;
}

/** Decode admitted managed CIL, retaining unavailable implementation metadata as partial. */
export const methodBody = (
  bytes: Buffer,
  pe: ManagedPeLayout,
  rva: number,
  context: MethodBodyContext,
): {
  readonly body: ManagedMethodBody;
  readonly tokenInstructions: readonly ParsedTokenInstruction[];
  readonly catchTokens: ReadonlyMap<number, MetadataTokenFact>;
  readonly issues: readonly ManagedParseIssue[];
  /**
   * Whether every CIL instruction was decoded, independent of exception-region
   * validity. A body with no CIL, absent or native, has nothing left unscanned.
   */
  readonly scanned: boolean;
} => {
  const issues: ManagedParseIssue[] = [];
  // Without CIL there is nothing left unscanned.
  if (rva === 0)
    return {
      body: emptyMethodBody(rva, "absent", null),
      tokenInstructions: [],
      catchTokens: EMPTY_CATCH_TOKENS,
      scanned: true,
      issues,
    };
  const native =
    context.implementation.codeType !== "il" ||
    context.implementation.managedKind !== "managed" ||
    context.implementation.pinvokeFlag;
  if (native) {
    const issue =
      "CIL decoding is unavailable for native, runtime, unmanaged, or P/Invoke implementations";
    return {
      body: emptyMethodBody(rva, "partial", issue),
      tokenInstructions: [],
      catchTokens: EMPTY_CATCH_TOKENS,
      scanned: true,
      issues,
    };
  }
  try {
    const { offset, available: methodExtent } = pe.rvaFileRange(
      rva,
      "method.body",
    );
    const header = readMethodBodyHeader(bytes, offset);
    if (
      header.size > methodExtent ||
      header.ilSize > methodExtent - header.size
    )
      throw new RangeError("Method body leaves file-backed PE section data");
    const ilOffset = offset + header.size;
    if (ilOffset > bytes.length - header.ilSize)
      throw new RangeError("Method IL bytes leave artifact");
    const il = bytes.subarray(ilOffset, ilOffset + header.ilSize);
    // Bound the actual instruction records before allocating them. One raw
    // byte is only an upper bound on count; wide operands do not create a
    // separate instruction for every byte. Retained output is charged below.
    const decoded = decodeInstructions(
      il,
      (start, hasReference) => {
        context.budget.admitTransient(256, ilOffset + start);
        if (hasReference) context.budget.admitTransient(256, ilOffset + start);
      },
      (token) => context.memberRefKinds.get(token),
    );
    const opcodeCounts: Record<string, number> = {};
    for (const instruction of decoded.parsed)
      opcodeCounts[instruction.opcode] =
        (opcodeCounts[instruction.opcode] ?? 0) + 1;
    // Keep every decoded instruction: implicit constants such as ldc.i4.N
    // are encoded in opcodes whose operand kind is "none".
    const anchors = decoded.parsed.map((instruction) => ({
      il_offset: instruction.offset,
      opcode: instruction.opcode,
      operand_kind: instruction.operandKind,
      operand: instruction.operand,
    }));
    const normalized = Buffer.from(
      JSON.stringify(
        decoded.parsed.map(({ opcode, operandKind, operand }) => [
          opcode,
          operandKind,
          operand,
        ]),
      ),
      "utf8",
    );
    const methodEnd = ilOffset + header.ilSize;
    const sectionOffset = Math.ceil(methodEnd / 4) * 4;
    const exceptionRegions =
      header.format === "fat" && (header.flags & 8) !== 0
        ? validateExceptionRegionRanges(
            parseExceptionRegions(
              bytes,
              sectionOffset,
              offset + methodExtent,
              context.budget,
            ),
            header.ilSize,
            decoded.instructionStarts,
          )
        : null;
    let localVarSignature: ManagedMethodBody["local_var_signature"] = null;
    let localSigIssue: string | null = null;
    let localSigFailure: "malformed" | "partial" | null = null;
    const localSignature =
      header.localSig === 0 ? null : metadataTokenFact(header.localSig);
    if (localSignature !== null) {
      const { table, row, token } = localSignature;
      const rows = context.metadataLayout.table(17)?.rowCount ?? 0;
      if (table !== 17 || row === 0 || row > rows) {
        localSigIssue = `LocalVarSigTok ${token} does not name an existing StandAloneSig row`;
        localSigFailure = "malformed";
        issues.push({
          code: "invalid-row",
          scope: `MethodDef:${context.methodToken}.body.local_var_sig_token`,
          offset: offset + 8,
          detail: localSigIssue,
        });
      } else {
        const signatureScope = `metadata.StandAloneSig:${token}.signature`;
        try {
          const cursor = metadataRowCursor(
            bytes,
            context.metadataLayout,
            17,
            row,
          );
          const blob = readMetadataBlob(
            bytes,
            context.metadataLayout,
            cursor.readIndex(context.metadataLayout.blobIndexSize),
            context.metadataLayout.blob?.size ?? 0,
          );
          const signatureFacts = readLocalSignatureFacts(
            context.metadataLayout,
            blob,
            {
              scope: signatureScope,
              blobOffset: blob.byteOffset - bytes.byteOffset,
            },
            context.budget,
          );
          if (signatureFacts.ok) localVarSignature = signatureFacts.value;
          else {
            const signatureIssue = signatureFacts.error;
            localSigIssue = signatureIssue.detail;
            localSigFailure =
              signatureIssue.code === "unsupported-signature"
                ? "partial"
                : "malformed";
            issues.push(signatureIssue);
          }
        } catch (cause: unknown) {
          if (
            cause instanceof ManagedReaderFailure &&
            cause.issue.code === "resource-limit"
          )
            throw cause;
          if (!(cause instanceof ManagedReaderFailure)) throw cause;
          localSigIssue = cause.issue.detail;
          localSigFailure = "malformed";
          issues.push({ ...cause.issue, scope: signatureScope });
        }
      }
    }
    const status = bodyStatus(
      decoded.issue,
      decoded.truncated,
      exceptionRegions,
      localSigFailure,
    );
    // Independent decoding failures must survive together. Present malformed
    // instruction/section facts before local-signature limitations.
    const bodyIssues = [
      decoded.issue,
      exceptionRegions?.status === "malformed" ? exceptionRegions.issue : null,
      localSigIssue,
      decoded.truncated > 0
        ? "Instruction decoding stopped before the end of the method body"
        : null,
    ].filter((issue): issue is string => issue !== null);
    const body: ManagedMethodBody = {
      status,
      header_format: header.format,
      rva,
      file_offset: offset,
      max_stack: header.maxStack,
      init_locals: (header.flags & 0x10) !== 0,
      local_var_sig_token: localSignature?.token ?? null,
      local_var_signature: localVarSignature,
      il_size: header.ilSize,
      il_sha256: sha256Bytes(il),
      normalized_il_sha256:
        status === "present" ? sha256Bytes(normalized) : null,
      instruction_count: decoded.count,
      decoded_instruction_count: decoded.parsed.length,
      truncated_instructions: decoded.truncated,
      opcode_counts: opcodeCounts,
      anchors,
      exception_regions: exceptionRegions?.regions ?? [],
      issue: bodyIssues.length > 0 ? bodyIssues.join("; ") : null,
    };
    const admittedBody = admitManagedProjection(body, context.budget);
    const tokenInstructions: ParsedTokenInstruction[] = [];
    // These records outlive transient decoding; the public projection contains only strings.
    for (const instruction of decoded.parsed) {
      if (!isParsedTokenInstruction(instruction)) continue;
      context.budget.reserve(
        256 + (tokenInstructions.length === 0 ? 64 : 0),
        ilOffset + instruction.offset,
      );
      tokenInstructions.push(instruction);
    }
    const catchTokens = exceptionRegions?.catchTokens.size
      ? exceptionRegions.catchTokens
      : EMPTY_CATCH_TOKENS;
    if (catchTokens.size > 0)
      context.budget.reserve(64 + catchTokens.size * 256, sectionOffset);
    return {
      body: admittedBody,
      tokenInstructions,
      catchTokens,
      scanned: decoded.issue === null && decoded.truncated === 0,
      issues,
    };
  } catch (cause: unknown) {
    if (
      cause instanceof ManagedReaderFailure &&
      cause.issue.code === "resource-limit"
    )
      throw cause;
    if (
      !(cause instanceof ManagedReaderFailure) &&
      !(cause instanceof RangeError)
    )
      throw cause;
    return {
      body: emptyMethodBody(
        rva,
        "malformed",
        cause instanceof Error ? cause.message : "Method body parse failed",
      ),
      tokenInstructions: [],
      catchTokens: EMPTY_CATCH_TOKENS,
      scanned: false,
      issues,
    };
  } finally {
    // IL and exception-section bookkeeping coexist until the body is built.
    context.budget.releaseTransient();
  }
};

const emptyMethodBody = (
  rva: number,
  status: "absent" | "malformed" | "partial",
  issue: string | null,
): ManagedMethodBody => ({
  status,
  header_format: status === "absent" ? "none" : "unknown",
  rva,
  file_offset: null,
  max_stack: null,
  init_locals: null,
  local_var_sig_token: null,
  local_var_signature: null,
  il_size: 0,
  il_sha256: null,
  normalized_il_sha256: null,
  instruction_count: 0,
  decoded_instruction_count: 0,
  truncated_instructions: 0,
  opcode_counts: {},
  anchors: [],
  exception_regions: [],
  issue,
});
