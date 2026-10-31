import { createRequire } from "node:module";
import type { TerminalRetention } from "../../domain/process/processCaptureCoverage.js";
import type { BoundedProcessTextNormalization } from "./ProcessNormalization.js";

import type {
  RecordProcessCaptureEvent,
  RenderedTerminalFrame,
} from "../../domain/process/processCapture.js";

const require = createRequire(import.meta.url);
// SAFETY: both pinned xterm packages publish CommonJS at runtime and matching declarations.
const HeadlessPackage =
  require("@xterm/headless") as typeof import("@xterm/headless");
// SAFETY: the addon package is pinned with the compatible headless xterm release.
const SerializePackage =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

const TRAILING_SPACES = / +$/u;

interface TerminalRendererOptions {
  readonly columns: number;
  readonly rows: number;
  readonly scrollback: number;
  readonly maxBytes: number;
  readonly normalize: (
    value: string,
    maxBytes: number,
  ) => BoundedProcessTextNormalization;
  readonly recordEvent?: RecordProcessCaptureEvent;
}

/**
 * Owns one headless terminal and serializes writes into deterministic frames.
 * Reconstructs bounded terminal states while raw PTY chunks remain authoritative.
 *
 * Rendered frames answer what an operator saw after control-sequence handling;
 * raw frames preserve byte/chunk differences that can render identically.
 * Comparisons retain both because neither representation subsumes the other.
 */
export class TerminalRenderer {
  readonly #terminal: InstanceType<typeof HeadlessPackage.Terminal>;
  readonly #serializeAddon = new SerializePackage.SerializeAddon();
  readonly #frames: RenderedTerminalFrame[] = [];
  #pending: Promise<void> = Promise.resolve();
  #operations: Array<() => void | Promise<void>> = [];
  #capturedBytes = 0;
  #observedBytes = 0;
  #observedFrames = 0;
  #truncated = false;
  #unknownSizeFrames = 0;
  #normalizationOverBudgetFrames = 0;

  constructor(private readonly options: TerminalRendererOptions) {
    this.#terminal = new HeadlessPackage.Terminal({
      allowProposedApi: true,
      cols: options.columns,
      rows: options.rows,
      scrollback: options.scrollback,
    });
    this.#terminal.loadAddon(this.#serializeAddon);
  }

  /** Queue one PTY chunk and capture state only after xterm has parsed it. */
  write(data: string | (() => string), atMs: number): void {
    this.#queue(
      () =>
        new Promise<void>((resolveWrite, rejectWrite) => {
          this.#terminal.write(typeof data === "string" ? data : data(), () => {
            try {
              this.#capture(atMs);
              resolveWrite();
            } catch (error) {
              rejectWrite(error);
            }
          });
        }),
    );
  }

  /** Queue a terminal resize after every preceding write. */
  resize(columns: number, rows: number, atMs: number): void {
    this.#queue(() => {
      this.#terminal.resize(columns, rows);
      this.#capture(atMs);
    });
  }

  /** Await all queued parsing and return immutable rendered observations. */
  async frames(): Promise<readonly RenderedTerminalFrame[]> {
    do {
      const operations = this.#operations;
      this.#operations = [];
      for (const operation of operations)
        this.#pending = this.#pending.then(operation);
      await this.#pending;
    } while (this.#operations.length > 0);
    return structuredClone(this.#frames);
  }

  /** Whether a rendered observation exceeded its independent capture budget. */
  truncated(): boolean {
    return this.#truncated;
  }

  /** Budget accounting after awaiting queued writes with frames(). */
  retention(): TerminalRetention {
    return {
      budget_bytes: this.options.maxBytes,
      observed_bytes: this.#observedBytes,
      retained_bytes: this.#capturedBytes,
      observed_frames: this.#observedFrames,
      retained_frames: this.#frames.length,
      ...(this.#unknownSizeFrames === 0
        ? {}
        : { unknown_size_frames: this.#unknownSizeFrames }),
      ...(this.#normalizationOverBudgetFrames === 0
        ? {}
        : {
            normalization_over_budget_frames:
              this.#normalizationOverBudgetFrames,
          }),
    };
  }

  /** Release addon and terminal resources after all writes settle. */
  async dispose(): Promise<void> {
    // frames() owns observation failures; cleanup reports only disposal failures.
    await this.#pending.catch(() => undefined);
    this.#operations = [];
    // xterm owns and disposes every addon loaded through loadAddon().
    this.#terminal.dispose();
  }

  #queue(operation: () => void | Promise<void>): void {
    // Raw chunks are already retained by the capture byte owner. Keep their
    // references and resize order; render once after sampled identities settle.
    this.#operations.push(operation);
  }

  #capture(atMs: number): void {
    const buffer = this.#terminal.buffer.active;
    const lines: string[] = [];
    this.#observedFrames += 1;
    let remainingBytes = this.options.maxBytes - this.#capturedBytes;
    let bytes = 0;
    for (let row = 0; row < this.#terminal.rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row);
      const renderedLine =
        line?.translateToString(false, 0, this.#terminal.cols) ??
        " ".repeat(this.#terminal.cols);
      const trailingSpaceBytes = Buffer.byteLength(
        renderedLine.match(TRAILING_SPACES)?.[0] ?? "",
      );
      const normalized = this.options.normalize(
        renderedLine,
        Math.min(Number.MAX_SAFE_INTEGER, remainingBytes + trailingSpaceBytes),
      );
      if (normalized.state === "over_budget") {
        if (normalized.reason === "normalization")
          this.#normalizationOverBudgetFrames += 1;
        this.#unknownSizeFrames += 1;
        this.#truncated = true;
        return;
      }
      const normalizedLine = normalized.value.replace(TRAILING_SPACES, "");
      const lineBytes = Buffer.byteLength(normalizedLine);
      if (lineBytes > remainingBytes) {
        this.#unknownSizeFrames += 1;
        this.#truncated = true;
        return;
      }
      remainingBytes -= lineBytes;
      bytes += lineBytes;
      // Trailing blank cells carry no information beyond `columns`; dropping
      // them keeps sparse screens from costing a full row per blank line.
      lines.push(normalizedLine);
    }
    const normalizedState = this.options.normalize(
      this.#serializeAddon.serialize(),
      remainingBytes,
    );
    if (normalizedState.state === "over_budget") {
      if (normalizedState.reason === "normalization")
        this.#normalizationOverBudgetFrames += 1;
      this.#unknownSizeFrames += 1;
      this.#truncated = true;
      return;
    }
    bytes += normalizedState.utf8Bytes;
    this.#observedBytes += bytes;
    this.#capturedBytes += bytes;
    const sequence = this.#frames.length;
    this.#frames.push({
      sequence,
      at_ms: atMs,
      columns: this.#terminal.cols,
      rows: this.#terminal.rows,
      cursor_x: buffer.cursorX,
      cursor_y: buffer.cursorY,
      active_buffer: buffer.type,
      lines,
      serialized_state: normalizedState.value,
    });
    this.options.recordEvent?.("rendered_frames", sequence);
  }
}
