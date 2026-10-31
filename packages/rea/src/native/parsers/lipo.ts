import { z } from "zod";
import {
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  NATIVE_COMMAND_OUTPUT_BUDGET_BYTES,
  type NativeCommandCapture,
} from "../CommandRunner.js";
import { machoCpuSubtypeBase } from "../../domain/apple/machoCpuIdentity.js";

const architectureSchema = z.object({
  name: z.string().min(1),
  hidden: z.boolean(),
  cpu_type: z.string().nullable(),
  cpu_subtype: z.string().nullable(),
  cpu_type_code: z.int().nonnegative().nullable(),
  cpu_subtype_code: z.int().nonnegative().nullable(),
  cpu_subtype_base: z.int().nonnegative().nullable(),
  capabilities: z.string().nullable(),
  file_offset: z.int().min(0).nullable(),
  size: z.int().min(0).nullable(),
  alignment: z.int().min(0).nullable(),
});

export type LipoFieldObservation =
  | { readonly kind: "absent" }
  | {
      readonly kind: "parsed";
      readonly sourceLines: readonly string[];
      readonly value: number;
    }
  | {
      readonly kind: "uninterpretable";
      readonly sourceLines: readonly string[];
    };

export type LipoArchitecture = z.infer<typeof architectureSchema> & {
  readonly fields: Readonly<
    Record<"offset" | "size" | "align", LipoFieldObservation>
  >;
  readonly limitations: readonly string[];
};

/** Capacity refusal before retaining expanded per-declaration source facts. */
export class LipoFieldRetentionError extends Error {
  readonly _tag = "LipoFieldRetentionError";
  constructor(readonly requiredBytes: number) {
    super(
      "lipo numeric field observations exceed the retained native output budget",
    );
    this.name = this._tag;
  }
}

interface LipoOutput {
  readonly format: "thin" | "fat";
  /** `nfat_arch` counts visible rows; Apple may append one hidden ARM64 row. */
  readonly declaredArchitectureCount: number | null;
  readonly hiddenArchitectureCount: number | null;
  readonly architectures: LipoArchitecture[];
}

/** Parse `lipo -detailed_info` framing and deterministic slice metadata. */
export const parseLipoOutput = (
  output: string,
  operandPath?: string,
): LipoOutput => {
  // The echoed FAT operand is one value, even when its pathname contains lines.
  if (operandPath !== undefined) {
    const header = `Fat header in: ${operandPath}`;
    if (output.startsWith(header)) {
      if (output.startsWith("\r\n", header.length))
        output = output.slice(header.length + 2);
      else if (output.startsWith("\n", header.length))
        output = output.slice(header.length + 1);
    }
  }
  // lipo echoes a thin file's pathname verbatim, including embedded newlines.
  // Match its final architecture field before splitting records into lines.
  const thinArchitecture =
    /(?:^|\r?\n)Non-fat file:[\s\S]* is architecture: ([^\s]+)\s*$/u.exec(
      output,
    )?.[1];
  if (thinArchitecture !== undefined)
    return {
      format: "thin",
      declaredArchitectureCount: null,
      hiddenArchitectureCount: null,
      architectures: [
        {
          ...architectureSchema.parse({
            name: thinArchitecture,
            hidden: false,
            cpu_type: null,
            cpu_subtype: null,
            cpu_type_code: null,
            cpu_subtype_code: null,
            cpu_subtype_base: null,
            capabilities: null,
            file_offset: null,
            size: null,
            alignment: null,
          }),
          fields: {
            offset: { kind: "absent" },
            size: { kind: "absent" },
            align: { kind: "absent" },
          },
          limitations: [],
        },
      ],
    };
  const architectures: LipoArchitecture[] = [];
  let declaredArchitectureCount: number | null = null;
  let hiddenArchitectureCount: number | null = null;
  let current: Record<string, string> | undefined;
  let observations: Partial<
    Record<
      "offset" | "size" | "align",
      { readonly sourceLine: string; readonly value: number | null }[]
    >
  > = {};
  let retainedFieldBytes = 0;
  const admitFieldBytes = (bytes: number): void => {
    retainedFieldBytes += bytes;
    if (retainedFieldBytes > NATIVE_COMMAND_OUTPUT_BUDGET_BYTES)
      throw new LipoFieldRetentionError(retainedFieldBytes);
  };
  const flush = (): void => {
    if (current === undefined) return;
    const name = current.architecture ?? current["Non-fat file"];
    if (name !== undefined) {
      const observe = (
        key: "offset" | "size" | "align",
      ): LipoFieldObservation => {
        const observed = observations[key];
        if (observed === undefined) return { kind: "absent" };
        const sourceLines = observed.map(({ sourceLine }) => sourceLine);
        const value = observed[0]?.value;
        return value === null ||
          value === undefined ||
          observed.some((candidate) => candidate.value !== value)
          ? { kind: "uninterpretable", sourceLines }
          : { kind: "parsed", sourceLines, value };
      };
      const fields = {
        offset: observe("offset"),
        size: observe("size"),
        align: observe("align"),
      };
      const value = (field: LipoFieldObservation): number | null =>
        field.kind === "parsed" ? field.value : null;
      const limitations = Object.entries(fields).flatMap(
        ([field, observation]) => {
          if (observation.kind !== "uninterpretable") return [];
          admitFieldBytes(name.length * 14 + 256);
          return [
            `lipo ${field} for ${name} could not be interpreted; ${observation.sourceLines.length === 1 ? "source line: " : "source lines:\n"}${observation.sourceLines.join("\n")}`,
          ];
        },
      );
      architectures.push({
        ...architectureSchema.parse({
          name: name.includes(" is architecture: ")
            ? (name.split(" is architecture: ").at(-1) ?? name)
            : name.replace(/ \(hidden\)$/u, ""),
          hidden: name.endsWith(" (hidden)"),
          cpu_type: current.cputype ?? null,
          cpu_subtype: current.cpusubtype ?? null,
          cpu_type_code: cpuTypeCode(current.cputype),
          cpu_subtype_code: cpuSubtypeCode(
            current.cpusubtype,
            current.capabilities,
          ),
          cpu_subtype_base: cpuSubtypeBase(current.cpusubtype),
          capabilities: current.capabilities ?? null,
          file_offset: value(fields.offset),
          size: value(fields.size),
          alignment: value(fields.align),
        }),
        fields,
        limitations,
      });
    }
    current = undefined;
    observations = {};
  };
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const count = /^nfat_arch\s+(\d+)(?:\s+\(\+(\d+) hidden\))?$/u.exec(line);
    if (count?.[1] !== undefined) {
      declaredArchitectureCount = integer(count[1]);
      hiddenArchitectureCount = integer(count[2] ?? "0");
      continue;
    }
    if (line.startsWith("Non-fat file:")) {
      flush();
      current = { "Non-fat file": line };
      continue;
    }
    if (line.startsWith("architecture ")) {
      flush();
      current = { architecture: line.slice("architecture ".length).trim() };
      continue;
    }
    const numericField = /^\s*(offset|size|align)(?:\s+(.*))?$/u.exec(rawLine);
    if (
      numericField?.[1] === "offset" ||
      numericField?.[1] === "size" ||
      numericField?.[1] === "align"
    ) {
      current ??= {};
      const field = numericField[1];
      // UTF-16 source, joined and rendered strings, worst-case escaped JSON,
      // and per-observation bookkeeping fit the existing native output allowance.
      // Charge before storing another observation; every source line is retained
      // at most once per field and rendered at most once, never per duplicate pair.
      admitFieldBytes(rawLine.length * 18 + 128);
      const sourceValue = (numericField[2] ?? "").trim();
      const observed = {
        sourceLine: rawLine,
        value:
          field === "align" ? alignment(sourceValue) : integer(sourceValue),
      };
      (observations[field] ??= []).push(observed);
      continue;
    }
    const match = /^(cputype|cpusubtype|capabilities)\s+(.+)$/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      current ??= {};
      current[match[1]] = match[2].trim();
    }
  }
  flush();
  if (architectures.length === 0)
    throw new TypeError("lipo output contained no architectures");
  return {
    format: "fat",
    declaredArchitectureCount,
    hiddenArchitectureCount,
    architectures,
  };
};

/** Classify expected lipo parse failures once for all command adapters. */
export const parseLipoOutputResult = (
  output: string,
  operandPath?: string,
): Result<LipoOutput, TypeError | z.ZodError | LipoFieldRetentionError> => {
  try {
    return ok(parseLipoOutput(output, operandPath));
  } catch (cause: unknown) {
    if (
      !(cause instanceof TypeError) &&
      !(cause instanceof z.ZodError) &&
      !(cause instanceof LipoFieldRetentionError)
    )
      throw cause;
    return err(cause);
  }
};

/** Translate classified parse failure into native command output failure. */
export const parseLipoCapture = (
  capture: NativeCommandCapture,
  operation: "inspect_macho" | "list_architectures",
  operandPath: string,
): Result<
  LipoOutput,
  AnalysisOutputError | AnalysisResourceConstraintError
> => {
  const parsed = parseLipoOutputResult(capture.stdout, operandPath);
  if (parsed.ok) return parsed;
  const capturedOutput = {
    stdout: capture.stdout,
    stderr: capture.stderr,
    truncated: false,
    stdout_bytes: capture.stdoutBytes,
    stderr_bytes: capture.stderrBytes,
    exit_code: capture.exitCode,
    signal: capture.signal,
  };
  if (parsed.error instanceof LipoFieldRetentionError)
    return err(
      new AnalysisResourceConstraintError(
        operation,
        "memory",
        parsed.error.message,
        {
          maximum_retained_bytes: NATIVE_COMMAND_OUTPUT_BUDGET_BYTES,
          required_retained_bytes: parsed.error.requiredBytes,
        },
        { cause: parsed.error, retryable: false, capturedOutput },
      ),
    );
  return err(
    new AnalysisOutputError(
      operation,
      "lipo did not produce readable architecture records",
      {
        cause: parsed.error,
        capturedOutput,
      },
    ),
  );
};

const integer = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d+$/u.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const CPU_TYPES: Readonly<Record<string, number>> = {
  CPU_TYPE_X86: 7,
  CPU_TYPE_X86_64: 0x01000007,
  CPU_TYPE_ARM: 12,
  CPU_TYPE_ARM64: 0x0100000c,
  CPU_TYPE_ARM64_32: 0x0200000c,
  CPU_TYPE_POWERPC: 18,
  CPU_TYPE_POWERPC64: 0x01000012,
};

const CPU_SUBTYPES: Readonly<Record<string, number>> = {
  CPU_SUBTYPE_X86_ALL: 3,
  CPU_SUBTYPE_X86_64_ALL: 3,
  CPU_SUBTYPE_X86_64_H: 8,
  CPU_SUBTYPE_ARM64_ALL: 0,
  CPU_SUBTYPE_ARM64_V8: 1,
  CPU_SUBTYPE_ARM64E: 2,
  CPU_SUBTYPE_ARM64_32_ALL: 0,
  CPU_SUBTYPE_ARM64_32_V8: 1,
  CPU_SUBTYPE_ARM_V7: 9,
  CPU_SUBTYPE_ARM_V7S: 11,
  CPU_SUBTYPE_ARM_V7K: 12,
  CPU_SUBTYPE_POWERPC_ALL: 0,
  CPU_SUBTYPE_POWERPC_970: 100,
};

/** Normalize known lipo names while retaining the producer's original text. */
const cpuTypeCode = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const numeric = unsigned32(value);
  return numeric ?? CPU_TYPES[value] ?? null;
};

/** Normalize the subtype and its separately printed capability bits. */
const cpuSubtypeCode = (
  value: string | undefined,
  capabilities: string | undefined,
): number | null => {
  if (value === undefined) return null;
  const numeric = unsigned32(value);
  if (numeric !== null) return numeric;
  const subtype = CPU_SUBTYPES[value];
  if (subtype === undefined) return null;
  if (value !== "CPU_SUBTYPE_ARM64E") {
    // Recent lipo prints an empty capabilities line, even for LIB64 slices.
    const bits = capabilityBits(capabilities);
    return bits === null ? null : ((bits << 24) | subtype) >>> 0;
  }
  const version = /PTR_AUTH_VERSION\s+USERSPACE\s+(\d+)/u.exec(
    capabilities ?? "",
  )?.[1];
  if (version === undefined) return null;
  const parsedVersion = Number(version);
  if (
    !Number.isInteger(parsedVersion) ||
    parsedVersion < 0 ||
    parsedVersion > 15
  )
    return null;
  return (0x80000000 | (parsedVersion << 24) | subtype) >>> 0;
};

/** The subtype bits a lipo record names, without its capability byte. */
const cpuSubtypeBase = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const subtype = unsigned32(value) ?? CPU_SUBTYPES[value];
  return subtype === undefined ? null : machoCpuSubtypeBase(subtype);
};

/** lipo names the LIB64 capability and prints other capability bits in hex. */
const capabilityBits = (capabilities: string | undefined): number | null => {
  if (capabilities === "CPU_SUBTYPE_LIB64") return 0x80;
  const bits = /^0x([\da-f]{1,2})$/iu.exec(capabilities ?? "")?.[1];
  return bits === undefined ? null : Number.parseInt(bits, 16);
};

const unsigned32 = (value: string): number | null => {
  if (!/^(?:\d+|0x[\da-f]+)$/iu.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff
    ? parsed >>> 0
    : null;
};

const alignment = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const exponent = /^2\^(\d+)(?: \((\d+)\))?$/u.exec(value);
  const powerText = exponent?.[1];
  if (powerText !== undefined) {
    const power = Number.parseInt(powerText, 10);
    if (power > 52) return null;
    const alignment = 2 ** power;
    const reported = exponent?.[2];
    return reported === undefined || integer(reported) === alignment
      ? alignment
      : null;
  }
  return integer(value);
};
