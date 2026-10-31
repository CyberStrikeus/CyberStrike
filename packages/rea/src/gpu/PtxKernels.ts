import {
  BinaryFormatFailure,
  BinaryResourceFailure,
} from "../native/metadata/BinaryContainer.js";
import type { GpuKernel } from "../domain/gpu/gpuCodeObjects.js";
import { GPU_REPORT_BYTES, rejectGpu } from "./GpuSource.js";
interface Token {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}
/** Byte coordinates are accumulated once, including non-ASCII comments and quoted strings. */
function* tokens(text: string): Generator<Token> {
  let at = 0,
    byte = 0;
  const advance = (): void => {
    const code = text.codePointAt(at)!;
    at += code > 0xffff ? 2 : 1;
    byte += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  };
  while (at < text.length) {
    if (/\s/u.test(text[at]!)) {
      advance();
      continue;
    }
    if (text.startsWith("//", at)) {
      while (at < text.length && text[at] !== "\n") advance();
      continue;
    }
    if (text.startsWith("/*", at)) {
      advance();
      advance();
      while (at < text.length && !text.startsWith("*/", at)) advance();
      if (at === text.length) rejectGpu("Unterminated PTX comment");
      advance();
      advance();
      continue;
    }
    const start = byte,
      position = at;
    if (text[at] === '"') {
      advance();
      let closed = false;
      while (at < text.length) {
        if (text[at] === '"') {
          advance();
          closed = true;
          break;
        }
        if (text[at] === "\\") {
          advance();
          if (at < text.length) advance();
        } else advance();
      }
      if (!closed) rejectGpu("Unterminated PTX string");
      yield { value: '""', start, end: byte };
      continue;
    }
    if (/[.\w$%@]/u.test(text[at]!)) {
      // Dot-prefixed keywords remain separate when their whitespace is omitted.
      // Internal dots in names, instruction mnemonics and version literals stay intact.
      const keyword = text[at] === ".";
      advance();
      while (
        at < text.length &&
        /[.\w$%@]/u.test(text[at]!) &&
        (!keyword || text[at] !== ".")
      )
        advance();
    } else advance();
    if (at - position > 65536)
      throw new BinaryResourceFailure(
        "structure",
        65536,
        "PTX token exceeds the string budget",
      );
    yield { value: text.slice(position, at), start, end: byte };
  }
}
const integer = (token: string | undefined): number | null => {
  if (token === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(token)) return null;
  const value = Number(token);
  return Number.isSafeInteger(value) ? value : null;
};
const alignmentValue = (token: string | undefined): number | null => {
  const value = integer(token);
  return value !== null && value > 0 && Number.isInteger(Math.log2(value))
    ? value
    : null;
};
type PtxVersion = { major: number; minor: number };
const ptxVersion = (token: string | undefined): PtxVersion | null => {
  const match = /^(\d+)\.(\d+)$/u.exec(token ?? "");
  if (match === null) return null;
  const major = Number(match[1]),
    minor = Number(match[2]);
  return Number.isSafeInteger(major) && Number.isSafeInteger(minor)
    ? { major, minor }
    : null;
};
const sizeOf = (type: string | undefined): number | null => {
  const match = /^\.(?:b|u|s|f)(8|16|32|64|128)$/u.exec(type ?? "");
  return match === null ? null : Number(match[1]) / 8;
};
const identifier = /^(?:%?[A-Za-z_$][\w$@.]*|%[0-9][A-Za-z0-9_$]*)$/u;
/** Stream register names/ranges without retaining the declaration token list. */
const registerDeclaration = (
  next: () => Token,
): { type: string; count: number | null } => {
  let type = "";
  let t = next();
  while (!identifier.test(t.value)) {
    if (t.value === ";" || t.value === "}")
      rejectGpu("PTX register declaration has no type or name");
    type += `${type.length === 0 ? "" : " "}${t.value}`;
    t = next();
  }
  if (type.length === 0)
    rejectGpu("PTX register declaration has no type or name");
  const supported = /^\.(?:pred|[busf](?:8|16|32|64|128))$/u.test(type);
  let count = 0;
  const discard = (token: Token): { type: string; count: null } => {
    while (token.value !== ";") {
      if (token.value === "}") rejectGpu("Malformed PTX resource declaration");
      token = next();
    }
    return { type, count: null };
  };
  while (true) {
    let declared = 1;
    let separator = next();
    if (separator.value === "<") {
      const range = next();
      if (range.value === ";" || range.value === "}") return discard(range);
      const close = next();
      if (close.value !== ">") return discard(close);
      const value = integer(range.value);
      if (value === null || value === 0) return discard(next());
      declared = value;
      separator = next();
    }
    if (separator.value === ";") {
      const total = count + declared;
      return {
        type,
        count: supported && Number.isSafeInteger(total) ? total : null,
      };
    }
    if (separator.value !== ",") return discard(separator);
    count += declared;
    if (!Number.isSafeInteger(count) || !supported) return discard(separator);
    const name = next();
    if (name.value === ";" || !identifier.test(name.value))
      return discard(name);
  }
};
const declaration = (
  source: string[],
): {
  name: string | null;
  type: string | null;
  size: number | null;
  align: number | null;
} => {
  const values = source[0] === ".param" ? source.slice(1) : source;
  let at = 0;
  let explicit = values[at] === ".align";
  let alignment = explicit ? alignmentValue(values[++at]) : null;
  if (explicit) at++;
  const vector = values[at] === ".v2" ? 2 : values[at] === ".v4" ? 4 : 1;
  if (vector !== 1) at++;
  const scalar = values[at++],
    unit = sizeOf(scalar);
  let pointer = false,
    layoutKnown = unit !== null && (!explicit || alignment !== null);
  while (values[at]?.startsWith(".")) {
    const qualifier = values[at++]!;
    if (qualifier === ".ptr") {
      if (pointer) layoutKnown = false;
      pointer = true;
    } else if (
      pointer &&
      [".const", ".global", ".local", ".shared"].includes(qualifier)
    ) {
      // Address-space qualifiers describe the pointed-to object.
    } else if (qualifier === ".align") {
      const alignmentToken = values[at];
      if (alignmentToken !== undefined && /^[0-9]+$/u.test(alignmentToken))
        at++;
      const declaredAlignment = alignmentValue(alignmentToken);
      if (declaredAlignment === null) layoutKnown = false;
      if (!pointer) {
        if (explicit) layoutKnown = false;
        explicit = true;
        alignment = declaredAlignment;
      }
    } else layoutKnown = false;
  }
  const name = identifier.test(values[at] ?? "") ? values[at]! : null;
  if (name === null) layoutKnown = false;
  let cursor = at + (name === null ? 0 : 1);
  const dimensions: string[][] = [];
  while (values[cursor] === "[") {
    const start = ++cursor;
    let parentheses = 0;
    while (cursor < values.length) {
      const value = values[cursor]!;
      if (value === "(") parentheses++;
      else if (value === ")") {
        if (parentheses === 0) break;
        parentheses--;
      } else if (value === "]" && parentheses === 0) break;
      cursor++;
    }
    if (values[cursor] !== "]" || parentheses !== 0) {
      layoutKnown = false;
      break;
    }
    dimensions.push(values.slice(start, cursor));
    cursor++;
  }
  if (cursor !== values.length || dimensions.length > 1) layoutKnown = false;
  let size = unit === null ? null : unit * vector;
  const type =
    scalar === undefined
      ? null
      : vector === 1
        ? scalar
        : `.v${vector} ${scalar}`;
  const align = explicit ? alignment : size;
  if (dimensions.length === 1) {
    const dimension = dimensions[0]!,
      count = dimension.length === 1 ? integer(dimension[0]) : null;
    if (count === null || size === null || !Number.isSafeInteger(count * size))
      layoutKnown = false;
    else size *= count;
  }
  if (
    name === null ||
    align === null ||
    align <= 0 ||
    !Number.isInteger(Math.log2(align)) ||
    !layoutKnown
  )
    return { name, type, size: null, align: null };
  return { name, type, size, align };
};

/** Entry declarations and virtual resources; no instruction semantics or physical register claims. */
export function* readPtxKernels(
  text: string,
  objectId: string,
): Generator<{ kernel: GpuKernel; coverage: "complete" | "partial" }> {
  if (Buffer.byteLength(text) > GPU_REPORT_BYTES)
    throw new BinaryResourceFailure(
      "structure",
      GPU_REPORT_BYTES,
      "PTX text exceeds the 16 MiB retained report budget",
    );
  const iterator = tokens(text);
  const next = (): Token => {
    const value = iterator.next();
    if (value.done) return rejectGpu("Truncated PTX entry declaration");
    return value.value;
  };
  let kernelCount = 0;
  let outerDepth = 0;
  let version: PtxVersion | null = null;
  for (let step = iterator.next(); !step.done; step = iterator.next()) {
    const token = step.value;
    if (token.value === "{") {
      outerDepth++;
      continue;
    }
    if (token.value === "}") {
      if (outerDepth === 0) rejectGpu("Unbalanced PTX body");
      outerDepth--;
      continue;
    }
    if (outerDepth !== 0) continue;
    if (token.value === ".version") {
      const value = iterator.next();
      version = value.done ? null : ptxVersion(value.value.value);
      continue;
    }
    if (token.value !== ".entry") continue;
    const name = next();
    if (!identifier.test(name.value))
      rejectGpu("Malformed PTX entry name or parameters");
    const parameters: GpuKernel["parameters"] = [];
    let part: string[] = [],
      parameterBytes: number | null = 0;
    const flush = (): void => {
      if (part.length === 0) return;
      if (part[0] !== ".param") rejectGpu("Unknown PTX parameter declaration");
      if (parameters.length >= 65536)
        throw new BinaryResourceFailure(
          "structure",
          65536,
          "PTX parameter declarations exceed the facts budget",
        );
      const value = declaration(part);
      let offset: number | null = null;
      if (
        parameterBytes !== null &&
        value.size !== null &&
        value.align !== null &&
        value.align > 0 &&
        Number.isSafeInteger(value.align)
      ) {
        offset = Math.ceil(parameterBytes / value.align) * value.align;
        parameterBytes = Number.isSafeInteger(offset + value.size)
          ? offset + value.size
          : null;
      } else parameterBytes = null;
      parameters.push({
        ordinal: parameters.length,
        name: value.name,
        offset,
        size: value.size,
        type: value.type,
        hidden: null,
      });
      part = [];
    };
    let t = next();
    if (t.value === "(") {
      let parentheses = 0,
        brackets = 0;
      while (true) {
        t = next();
        if (t.value === "(") parentheses++;
        else if (t.value === ")") {
          if (parentheses > 0) parentheses--;
          else if (brackets === 0) break;
          else rejectGpu("Malformed PTX parameter dimension");
        } else if (t.value === "[") brackets++;
        else if (t.value === "]") {
          if (brackets === 0) rejectGpu("Malformed PTX parameter dimension");
          brackets--;
        }
        if (t.value === "," && parentheses === 0 && brackets === 0) flush();
        else part.push(t.value);
        if (part.length > 128)
          throw new BinaryResourceFailure(
            "structure",
            65536,
            "PTX parameter declarations exceed the facts budget",
          );
      }
      flush();
      t = next();
    } else if (t.value !== "{" && t.value !== ";" && !t.value.startsWith(".")) {
      rejectGpu("Malformed PTX entry name or parameters");
    }
    // Entry directives can occur between the parameter list and body.
    let headerTokens = 0;
    while (t.value !== "{" && t.value !== ";") {
      if (++headerTokens > 65536) rejectGpu("PTX entry header is too large");
      if (t.value === ".pragma") {
        t = next();
        if (t.value !== '""') rejectGpu("Malformed PTX entry pragma");
        while (true) {
          if (++headerTokens > 65536)
            rejectGpu("PTX entry header is too large");
          t = next();
          if (t.value === ";") break;
          if (t.value !== ",") rejectGpu("Malformed PTX entry pragma");
          t = next();
          if (t.value !== '""') rejectGpu("Malformed PTX entry pragma");
        }
        t = next();
        continue;
      }
      t = next();
    }
    let end = t.end,
      shared: number | null = t.value === "{" ? 0 : null;
    const virtual = new Map<string, number | null>();
    if (t.value === "{") {
      let depth = 1;
      while (depth > 0) {
        t = next();
        end = t.end;
        if (t.value === "{") {
          depth++;
          continue;
        }
        if (t.value === "}") {
          depth--;
          continue;
        }
        if (
          t.value === ".param" &&
          version !== null &&
          version.major === 1 &&
          version.minor <= 3
        ) {
          const bodyParameter = [t.value];
          for (t = next(); t.value !== ";"; t = next()) {
            if (t.value === "}")
              rejectGpu("Malformed PTX parameter declaration");
            if (bodyParameter.length >= 128)
              throw new BinaryResourceFailure(
                "structure",
                65536,
                "PTX parameter declarations exceed the facts budget",
              );
            bodyParameter.push(t.value);
          }
          part = bodyParameter;
          flush();
          end = t.end;
          continue;
        }
        // Call prototypes contain formal .reg/.param declarations, not entry resources.
        if (t.value === ".callprototype") {
          for (t = next(); t.value !== ";"; t = next()) {
            if (t.value === "}") rejectGpu("Malformed PTX call prototype");
          }
          end = t.end;
          continue;
        }
        if (t.value !== ".reg" && t.value !== ".shared") continue;
        if (t.value === ".reg") {
          const { type, count } = registerDeclaration(next);
          const previous = virtual.get(type);
          const total =
            previous === null || count === null
              ? null
              : (previous ?? 0) + count;
          virtual.set(
            type,
            total === null || !Number.isSafeInteger(total) ? null : total,
          );
          continue;
        }
        const declarationTokens: string[] = [];
        for (t = next(); t.value !== ";"; t = next()) {
          if (t.value === "}" || declarationTokens.length > 128)
            rejectGpu("Malformed PTX resource declaration");
          declarationTokens.push(t.value);
        }
        const value = declaration(declarationTokens);
        if (
          shared === null ||
          value.size === null ||
          value.align === null ||
          value.align === 0
        )
          shared = null;
        else {
          const total =
            Math.ceil(shared / value.align) * value.align + value.size;
          shared = Number.isSafeInteger(total) ? total : null;
        }
      }
    }
    const kernel: GpuKernel = {
      id: `${objectId}/entry@${token.start.toString(16)}`,
      object_id: objectId,
      representation: "ptx-declarations",
      name: name.value,
      symbol: null,
      parameter_count: parameters.length,
      parameter_bytes: parameterBytes,
      parameters,
      registers: {
        physical: null,
        sgpr: null,
        vgpr: null,
        agpr: null,
        virtual: [...virtual].map(([type, count]) => ({ type, count })),
      },
      shared_bytes: shared,
      private_bytes: null,
      location: {
        container_id: objectId,
        offset: token.start,
        size: end - token.start,
        section_index: null,
        section_name: null,
      },
      sources: {
        parameters: {
          container_id: objectId,
          offset: token.start,
          size: end - token.start,
          section_index: null,
          section_name: null,
        },
        registers: null,
        shared: null,
        private: null,
      },
      limitations: [
        "PTX registers are virtual declarations, not physical allocations. Parameter offsets/sizes and entry-local static shared bytes are derived from supported declarations; module shared bytes, dynamic allocation, device ABI and runtime allocation were not verified.",
      ],
    };
    let coverage: "complete" | "partial" = "complete";
    if (parameterBytes === null) {
      coverage = "partial";
      kernel.limitations.push(
        "Unsupported PTX parameter declarations or overflowing layouts leave parameter sizes/offsets and the total byte count unknown.",
      );
    }
    if (shared === null) {
      coverage = "partial";
      kernel.limitations.push(
        "Unsupported, dynamic or overflowing PTX shared declarations, or an absent entry body, leave entry-local static shared bytes unknown.",
      );
    }
    if (kernel.registers.virtual.some((row) => row.count === null)) {
      coverage = "partial";
      kernel.limitations.push(
        "Unsupported PTX register declarations or overflowing totals leave the affected virtual register count unknown.",
      );
    }
    if (++kernelCount > 65536)
      throw new BinaryResourceFailure(
        "structure",
        65536,
        "PTX kernel count exceeds the facts budget",
      );
    yield { kernel, coverage };
  }
  if (outerDepth !== 0) rejectGpu("Unbalanced PTX body");
}

export interface PtxTargetFacts {
  readonly recognized: boolean;
  readonly target: string | null;
  readonly limitation: string | null;
}

/** PTX's compute spelling is an alias for the corresponding baseline SM target. */
export const ptxTargetIdentity = (target: string): string =>
  target.replace(/^compute_(\d+[a-z]?)$/u, "sm_$1");

/** Resolve all module-scope targets through the highest numbered architecture. */
export const readPtxTarget = (text: string): PtxTargetFacts => {
  const stream = tokens(text);
  let depth = 0,
    target: string | null = null,
    targetIdentity: string | null = null,
    targetArchitecture = -1,
    ambiguous = false,
    unsupported = false,
    malformed = false;
  try {
    const first = stream.next();
    if (first.done || first.value.value !== ".version")
      return { recognized: false, target: null, limitation: null };
    const declaredVersion = stream.next();
    if (
      declaredVersion.done ||
      ptxVersion(declaredVersion.value.value) === null
    )
      return { recognized: false, target: null, limitation: null };
    for (const token of stream) {
      if (token.value === "{") {
        depth++;
        continue;
      }
      if (token.value === "}") {
        if (depth > 0) depth--;
        continue;
      }
      if (depth !== 0) continue;
      if (token.value !== ".target") continue;
      const value = stream.next();
      if (value.done) {
        unsupported = true;
        continue;
      }
      const spelling = value.value.value,
        match = /^(?:sm_|compute_)([0-9]+)(?:a|f)?$/u.exec(spelling);
      if (match === null) {
        unsupported = true;
        continue;
      }
      const architecture = Number(match[1]);
      if (!Number.isSafeInteger(architecture)) {
        unsupported = true;
        continue;
      }
      const identity = ptxTargetIdentity(spelling);
      if (architecture > targetArchitecture) {
        target = spelling;
        targetIdentity = identity;
        targetArchitecture = architecture;
        ambiguous = false;
      } else if (
        architecture === targetArchitecture &&
        targetIdentity !== identity
      ) {
        ambiguous = true;
      }
    }
  } catch (cause) {
    if (!(cause instanceof BinaryFormatFailure)) throw cause;
    malformed = true;
  }
  const recognized = target !== null;
  const limitation = !recognized
    ? null
    : unsupported
      ? "Unsupported PTX target directives leave the effective target unknown."
      : ambiguous
        ? "Same-generation PTX target profiles cannot be represented by one effective target."
        : malformed
          ? "Malformed PTX text prevents complete target discovery."
          : null;
  return {
    recognized,
    target: limitation === null ? target : null,
    limitation,
  };
};
