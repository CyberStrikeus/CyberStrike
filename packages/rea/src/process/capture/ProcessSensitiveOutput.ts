import { ProcessAdmissionError } from "../ProcessAdmissionError.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { ProcessScenario } from "../../domain/process/processScenario.js";
import type { TerminalFrame } from "../../domain/process/processCapture.js";

// A capture-local trie, bounded construction work and a reusable span index.
// These are resource ceilings, not guesses about whether an input is private.
const MAX_STATES = 65_536;
const MAX_BUILD_WORK = 8_388_608;
const MAX_PROJECTION_WORK = 67_108_864;
const MAX_INDEX_BYTES = 33_554_432;

interface Prefix {
  readonly edges: Map<number, number>;
  readonly depth: number;
  failure: number;
  match: number;
}

const capacity = (limit: string, requested: number, maximum: number) =>
  new AnalysisResourceConstraintError(
    "capture_process",
    "capacity",
    `Sensitive terminal redaction exceeded ${limit}. Select a smaller complete sensitive-input/output workload; terminal text is withheld on failure.`,
    { boundary: "terminal-sensitive-input", limit, requested, maximum },
    {
      retryable: false,
      fixedAllowance: { name: "Sensitive terminal redaction", kind: "capture" },
    },
  );

/** Yield terminal text positions while consuming VT controls in linear time.
 * Source positions remain UTF-16 offsets; byte accounting stays with the producer.
 */
const visibleUnits = function* (parts: readonly string[]) {
  let state:
    | "text"
    | "escape"
    | "intermediate"
    | "csi"
    | "osc"
    | "string"
    | "osc_escape"
    | "string_escape" = "text";
  let position = 0;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1, position += 1) {
      const code = part.charCodeAt(index);
      if (code === 0x18 || code === 0x1a) {
        state = "text";
        continue;
      }
      if (state === "osc" || state === "string") {
        if (code === 0x9c || (state === "osc" && code === 7)) state = "text";
        else if (code === 0x1b)
          state = state === "osc" ? "osc_escape" : "string_escape";
        continue;
      }
      if (state === "osc_escape" || state === "string_escape") {
        if (
          code === 0x5c ||
          code === 0x9c ||
          (state === "osc_escape" && code === 7)
        )
          state = "text";
        else if (code !== 0x1b)
          state = state === "osc_escape" ? "osc" : "string";
        continue;
      }
      if (code === 0x1b) {
        state = "escape";
        continue;
      }
      if (state === "escape") {
        state =
          code === 0x5b
            ? "csi"
            : code === 0x5d
              ? "osc"
              : [0x50, 0x58, 0x5e, 0x5f].includes(code)
                ? "string"
                : code >= 0x20 && code <= 0x2f
                  ? "intermediate"
                  : "text";
        continue;
      }
      if (state === "intermediate") {
        if (code < 0x20 || code > 0x2f) state = "text";
        continue;
      }
      if (state === "csi") {
        if (code >= 0x40 && code <= 0x7e) state = "text";
        continue;
      }
      if (code === 0x9b) {
        state = "csi";
        continue;
      }
      if (code === 0x9d) {
        state = "osc";
        continue;
      }
      if ([0x90, 0x98, 0x9e, 0x9f].includes(code)) {
        state = "string";
        continue;
      }
      if (
        (code < 0x20 && code !== 9 && code !== 10 && code !== 13) ||
        (code >= 0x7f && code <= 0x9f)
      )
        continue;
      yield { code, position };
    }
  }
};

/** One run's exact, explicit literals; never shared across captures. */
export class ProcessSensitiveOutput {
  #index = new Uint32Array(0);
  #work = 0;
  #failure: AnalysisError | undefined;

  constructor(private readonly prefixes: readonly Prefix[]) {}

  get failure(): AnalysisError | undefined {
    return this.#failure;
  }

  fail(failure: AnalysisError): void {
    this.#failure ??= failure;
  }

  #prefix(index: number): Prefix {
    const value = this.prefixes[index];
    if (value === undefined)
      throw new ProcessAdmissionError("prefix_identity_lost");
    return value;
  }

  #consume(units: number): void {
    this.#work += units;
    if (this.#work > MAX_PROJECTION_WORK)
      throw capacity("projection_work_units", this.#work, MAX_PROJECTION_WORK);
  }

  #advance(state: number, code: number): number {
    this.#consume(1);
    let next = this.#prefix(state).edges.get(code);
    while (next === undefined && state !== 0) {
      this.#consume(1);
      state = this.#prefix(state).failure;
      next = this.#prefix(state).edges.get(code);
    }
    return next ?? 0;
  }

  #contains(parts: readonly string[], includeTrailingPrefix: boolean): boolean {
    let state = 0;
    for (const part of parts)
      for (let index = 0; index < part.length; index += 1) {
        state = this.#advance(state, part.charCodeAt(index));
        if (this.#prefix(state).match > 0) return true;
      }
    if (includeTrailingPrefix && this.#prefix(state).depth > 0) return true;
    state = 0;
    for (const { code } of visibleUnits(parts)) {
      state = this.#advance(state, code);
      if (this.#prefix(state).match > 0) return true;
    }
    return includeTrailingPrefix && this.#prefix(state).depth > 0;
  }

  /** Nonexpanding projection, including matches across original chunk boundaries. */
  project(
    parts: readonly string[],
    includeTrailingPrefix = false,
  ): Result<readonly string[], AnalysisError> {
    if (this.#failure !== undefined) return err(this.#failure);
    try {
      let size = 0;
      let controls = false;
      for (const part of parts) {
        size += part.length;
        controls ||=
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(part);
      }
      const words = size + 1 + (controls ? size : 0);
      if (words > MAX_INDEX_BYTES / Uint32Array.BYTES_PER_ELEMENT)
        return this.#reject(
          capacity(
            "projection_index_bytes",
            words * Uint32Array.BYTES_PER_ELEMENT,
            MAX_INDEX_BYTES,
          ),
        );
      if (size === 0) return ok(parts);
      this.#consume(size);
      if (this.#index.length < words) this.#index = new Uint32Array(words);
      const next = this.#index.subarray(0, size + 1);
      next.fill(0);
      const positions = this.#index.subarray(size + 1, words);
      let changed = false;
      const find = (index: number): number => {
        let root = index;
        while (root < size && (next[root] ?? 0) !== 0) {
          this.#consume(1);
          root = (next[root] ?? 0) - 1;
        }
        while (index !== root) {
          const parent = (next[index] ?? 0) - 1;
          next[index] = root + 1;
          index = parent;
        }
        return root;
      };
      const mark = (start: number, end: number): void => {
        changed = true;
        for (let index = find(start); index < end; index = find(index)) {
          this.#consume(1);
          next[index] = index + 2;
        }
      };
      let state = 0,
        position = 0;
      for (const part of parts)
        for (let index = 0; index < part.length; index += 1, position += 1) {
          state = this.#advance(state, part.charCodeAt(index));
          const length = this.#prefix(state).match;
          if (length > 0) mark(position + 1 - length, position + 1);
        }
      if (includeTrailingPrefix && this.#prefix(state).depth > 0)
        mark(size - this.#prefix(state).depth, size);
      if (controls) {
        state = 0;
        let logical = 0;
        for (const unit of visibleUnits(parts)) {
          positions[logical] = unit.position;
          state = this.#advance(state, unit.code);
          const length = this.#prefix(state).match;
          if (length > 0)
            mark(positions[logical + 1 - length] ?? 0, unit.position + 1);
          logical += 1;
        }
        if (includeTrailingPrefix && this.#prefix(state).depth > 0)
          mark(positions[logical - this.#prefix(state).depth] ?? 0, size);
      }
      if (!changed) return ok(parts);
      const projected: string[] = [];
      position = 0;
      for (const part of parts) {
        let value = "",
          start = 0;
        for (let index = 0; index < part.length; index += 1) {
          if ((next[position + index] ?? 0) === 0) continue;
          value += part.slice(start, index);
          start = index + 1;
        }
        projected.push(start === 0 ? part : value + part.slice(start));
        position += part.length;
      }
      // Removing a literal can join two public fragments into another declared
      // literal. Never put that newly formed spelling into retained Evidence.
      return ok(
        this.#contains(projected, includeTrailingPrefix)
          ? projected.map(() => "")
          : projected,
      );
    } catch (cause) {
      if (!(cause instanceof AnalysisError)) throw cause;
      return this.#reject(cause);
    }
  }

  #reject(failure: AnalysisError): Result<never, AnalysisError> {
    this.fail(failure);
    return err(failure);
  }

  /** Publish no original-value backup, while retaining frame identity/order. */
  projectRawFrames(
    frames: TerminalFrame[],
    coverageGap: boolean,
  ): Result<number, AnalysisError> {
    const originals = frames.map(({ raw_data, data }) => raw_data ?? data);
    const projected = coverageGap
      ? ok(originals.map(() => ""))
      : this.project(originals, true);
    if (!projected.ok) return projected;
    let removed = 0;
    for (const [index, frame] of frames.entries()) {
      const raw = projected.value[index] ?? "";
      removed +=
        Buffer.byteLength(originals[index] ?? "") - Buffer.byteLength(raw);
      frames[index] = {
        sequence: frame.sequence,
        at_ms: frame.at_ms,
        data: raw,
      };
    }
    return ok(removed);
  }

  projectNormalizedFrames(
    frames: TerminalFrame[],
  ): Result<number, AnalysisError> {
    const projected = this.project(
      frames.map(({ data }) => data),
      true,
    );
    if (!projected.ok) return projected;
    let bytes = 0;
    for (const [index, frame] of frames.entries()) {
      const raw = frame.raw_data ?? frame.data;
      const data = projected.value[index] ?? "";
      bytes += Buffer.byteLength(data);
      frames[index] = {
        sequence: frame.sequence,
        at_ms: frame.at_ms,
        data,
        ...(raw === data ? {} : { raw_data: raw }),
      };
    }
    return ok(bytes);
  }
}

/** Compile once before launch; CR/LF frame input rather than private payload. */
export const createProcessSensitiveOutput = (
  scenario: ProcessScenario,
): Result<ProcessSensitiveOutput | undefined, AnalysisError> => {
  const prefixes: Prefix[] = [
    { edges: new Map(), depth: 0, failure: 0, match: 0 },
  ];
  const seen = new Set<string>();
  let work = 0;
  const step = () => {
    work += 1;
    if (work > MAX_BUILD_WORK)
      throw capacity("matcher_build_work_units", work, MAX_BUILD_WORK);
  };
  const read = (index: number): Prefix => {
    const node = prefixes[index];
    if (node === undefined)
      throw new ProcessAdmissionError("prefix_unavailable");
    return node;
  };
  try {
    for (const event of scenario.events) {
      if (event.type !== "input" || !event.sensitive) continue;
      work += event.data.length;
      if (work > MAX_BUILD_WORK)
        return err(capacity("matcher_build_work_units", work, MAX_BUILD_WORK));
      const wire = Buffer.from(event.data, "utf8").toString("utf8");
      let visible = "";
      for (const { code } of visibleUnits([wire]))
        visible += String.fromCharCode(code);
      for (const source of wire === visible ? [wire] : [wire, visible]) {
        for (const match of source.matchAll(/[^\r\n]+/gu)) {
          const literal = match[0];
          if (seen.has(literal)) continue;
          if (literal.length + 1 > MAX_STATES)
            return err(
              capacity("matcher_prefix_states", literal.length + 1, MAX_STATES),
            );
          seen.add(literal);
          let state = 0;
          for (let index = 0; index < literal.length; index += 1) {
            step();
            const code = literal.charCodeAt(index);
            let next = read(state).edges.get(code);
            if (next === undefined) {
              if (prefixes.length >= MAX_STATES)
                return err(
                  capacity(
                    "matcher_prefix_states",
                    prefixes.length + 1,
                    MAX_STATES,
                  ),
                );
              next = prefixes.length;
              prefixes.push({
                edges: new Map(),
                depth: read(state).depth + 1,
                failure: 0,
                match: 0,
              });
              read(state).edges.set(code, next);
            }
            state = next;
          }
          read(state).match = literal.length;
        }
      }
    }
    if (seen.size === 0) return ok(undefined);
    const queue = [...read(0).edges.values()];
    for (let index = 0; index < queue.length; index += 1) {
      const parent = queue[index];
      if (parent === undefined) break;
      for (const [code, child] of read(parent).edges) {
        step();
        let failure = read(parent).failure;
        while (failure !== 0 && !read(failure).edges.has(code)) {
          step();
          failure = read(failure).failure;
        }
        const target = read(failure).edges.get(code) ?? 0;
        read(child).failure = target;
        read(child).match = Math.max(read(child).match, read(target).match);
        queue.push(child);
      }
    }
    return ok(new ProcessSensitiveOutput(prefixes));
  } catch (cause) {
    if (!(cause instanceof AnalysisError)) throw cause;
    return err(cause);
  }
};
