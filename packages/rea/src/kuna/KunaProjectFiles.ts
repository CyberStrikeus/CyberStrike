import { z } from "zod";

import { err, ok, type Result } from "../domain/result.js";

/**
 * One function block in a `kuna decompile-project` `.c` file. The span covers
 * its `// Function:` header through the blank line that ends the block, which
 * is how REA serves one function without reading the whole file.
 */
export interface KunaProjectFunction {
  readonly name: string;
  /** Kuna's display address, a lowercase `0x…` virtual address. */
  readonly address: string;
  readonly cOffset: number;
  readonly cLength: number;
  /** Kuna's own failure for this function; its block is then the header alone. */
  readonly error: string | null;
}

// Rendered by kuna-console's `render_c`: `// Function: {name} @ 0x{addr:x}`,
// or `... @ 0x{addr:x}  (error: {message})` for a failed function. A name
// can itself contain " @ ", so the address is the last such field.
const HEADER = /^\/\/ Function: (.+) @ (0x[0-9a-f]+)(?: {2}\(error: (.*)\))?$/u;
const HEADER_PREFIX = "// Function: ";

/** Kuna's completed-export summary on stdout: `functions: N ok, M failed`. */
const SUMMARY = /functions: (\d+) ok, (\d+) failed/u;

/** Function counts Kuna reported for a finished export. */
export interface KunaExportSummary {
  readonly decompiled: number;
  readonly failed: number;
}

/** Read the completed-file summary Kuna prints after finalizing an export. */
export const parseKunaExportSummary = (
  stdout: string,
): KunaExportSummary | undefined => {
  const match = SUMMARY.exec(stdout);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { decompiled: Number(match[1]), failed: Number(match[2]) };
};

/** A structural line longer than this is not one Kuna wrote. */
const MAX_KEPT_LINE_BYTES = 64 * 1024;

/** One line a scan kept: where it starts in the file and its text. */
interface KeptLine {
  readonly offset: number;
  readonly text: string;
}

/**
 * Stream a file's lines, keeping the text of only the lines whose first
 * `headBytes` bytes `keep` accepts. Every other line is skipped without being
 * buffered, so a large export is never held in memory.
 */
const scanLines = async (
  chunks: AsyncIterable<Buffer>,
  headBytes: number,
  keep: (head: Buffer) => boolean,
): Promise<
  Result<
    { readonly lines: readonly KeptLine[]; readonly bytes: number },
    string
  >
> => {
  const lines: KeptLine[] = [];
  let offset = 0;
  let lineStart = 0;
  // The current line's bytes while it is undecided or kept; undefined once skipped.
  let line: Buffer[] | undefined = [];
  let lineBytes = 0;
  let decided = false;
  for await (const chunk of chunks) {
    let position = 0;
    while (position < chunk.length) {
      const newline = chunk.indexOf(0x0a, position);
      const end = newline === -1 ? chunk.length : newline;
      if (line !== undefined) {
        const segment = chunk.subarray(position, end);
        line.push(segment);
        lineBytes += segment.length;
        if (!decided && (lineBytes >= headBytes || newline !== -1)) {
          decided = true;
          if (!keep(Buffer.concat(line).subarray(0, headBytes)))
            line = undefined;
        }
        if (line !== undefined && lineBytes > MAX_KEPT_LINE_BYTES)
          return err(`the line at byte ${String(lineStart)} is too long`);
      }
      if (newline === -1) break;
      if (line !== undefined)
        lines.push({
          offset: lineStart,
          text: Buffer.concat(line).toString("utf8"),
        });
      position = newline + 1;
      lineStart = offset + position;
      line = [];
      lineBytes = 0;
      decided = false;
    }
    offset += chunk.length;
  }
  if (line !== undefined && lineBytes > 0) {
    const head = Buffer.concat(line);
    if (decided || keep(head.subarray(0, headBytes)))
      lines.push({ offset: lineStart, text: head.toString("utf8") });
  }
  return ok({ lines, bytes: offset });
};

const HEADER_PREFIX_BYTES = Buffer.from(HEADER_PREFIX);

/**
 * Split a finished export's `.c` into its function blocks.
 *
 * The `#include` preamble precedes the first header. The header count must
 * equal the functions Kuna reported, and every address must be distinct; an
 * export that fails either check is not a usable function inventory.
 */
export const scanKunaProjectSource = async (
  chunks: AsyncIterable<Buffer>,
  summary: KunaExportSummary,
): Promise<Result<readonly KunaProjectFunction[], string>> => {
  const scanned = await scanLines(chunks, HEADER_PREFIX_BYTES.length, (head) =>
    head.equals(HEADER_PREFIX_BYTES),
  );
  if (!scanned.ok) return scanned;
  const headers: {
    readonly name: string;
    readonly address: string;
    readonly error: string | null;
    readonly offset: number;
  }[] = [];
  for (const { offset, text } of scanned.value.lines) {
    const match = HEADER.exec(text);
    if (match?.[1] === undefined || match[2] === undefined)
      return err(`unrecognized function header at byte ${String(offset)}`);
    headers.push({
      name: match[1],
      address: match[2],
      error: match[3] ?? null,
      offset,
    });
  }
  const total = scanned.value.bytes;
  const expected = summary.decompiled + summary.failed;
  if (headers.length !== expected)
    return err(
      `the .c holds ${String(headers.length)} function headers but Kuna reported ${String(expected)} functions`,
    );
  const failed = headers.filter(({ error }) => error !== null).length;
  if (failed !== summary.failed)
    return err(
      `the .c marks ${String(failed)} failed functions but Kuna reported ${String(summary.failed)}`,
    );
  const addresses = new Set<string>();
  const functions: KunaProjectFunction[] = [];
  for (const [index, header] of headers.entries()) {
    if (addresses.has(header.address))
      return err(`the .c repeats address ${header.address}`);
    addresses.add(header.address);
    const end = headers[index + 1]?.offset ?? total;
    functions.push({
      name: header.name,
      address: header.address,
      cOffset: header.offset,
      cLength: end - header.offset,
      error: header.error,
    });
  }
  return ok(functions);
};

const inventorySchema = z.object({
  functions: z.array(
    z.object({
      name: z.string(),
      address_hex: z.string().regex(/^0x[0-9a-f]+$/u),
      aliases: z.array(z.string()),
      size: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }),
  ),
});

/** One callable entry from `kuna functions --json`, including imports Kuna does not decompile. */
export interface KunaInventoryFunction {
  readonly name: string;
  readonly address: string;
  readonly aliases: readonly string[];
  /** Inventory extent: an upper bound clipped at the next entry, or 0 when unmeasured. */
  readonly size: number;
}

/** Parse the callable-symbol inventory `kuna functions --json` writes. */
export const parseKunaInventory = (
  text: string,
): Result<readonly KunaInventoryFunction[], string> => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err("the function inventory is not JSON");
  }
  const parsed = inventorySchema.safeParse(value);
  if (!parsed.success)
    return err(
      `the function inventory does not match Kuna's document: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  return ok(
    parsed.data.functions.map((entry) => ({
      name: entry.name,
      address: entry.address_hex,
      aliases: entry.aliases,
      size: entry.size,
    })),
  );
};

/** One labeled span of an export's `.asm`. */
export interface KunaAssemblySpan {
  readonly name: string;
  readonly address: string;
  readonly offset: number;
  readonly length: number;
}

/** Function listings and data labels found in an export's `.asm`. */
export interface KunaAssemblyIndex {
  /** Code labels, which name the same functions as the `.c`, by address. */
  readonly code: ReadonlyMap<string, KunaAssemblySpan>;
  /** Labels in the `; --- data ---` tail: named globals and Kuna's `dat_`/`s_` names. */
  readonly data: ReadonlyMap<string, string>;
}

// Rendered by kuna-console: `{name}:  ; 0x{addr:x}` at column 0, optionally
// followed by ` = dat_{addr:x}` in the data tail. A code label's listing runs
// to the next label, the next `; --- ` section marker, or the end of the file.
const LABEL = /^(.+):  ; (0x[0-9a-f]+)(?: = dat_[0-9a-f]+)?$/u;
const SECTION_MARKER = "; --- ";
const DATA_MARKER = "; --- data ---";
const SPACE = 0x20;
const TAB = 0x09;

/** Index the labels of an export's `.asm` without holding the file in memory. */
export const scanKunaAssembly = async (
  chunks: AsyncIterable<Buffer>,
): Promise<Result<KunaAssemblyIndex, string>> => {
  const scanned = await scanLines(
    chunks,
    1,
    (head) => head[0] !== SPACE && head[0] !== TAB && head.length > 0,
  );
  if (!scanned.ok) return scanned;
  const code = new Map<string, KunaAssemblySpan>();
  const data = new Map<string, string>();
  let inData = false;
  let open: { name: string; address: string; offset: number } | undefined;
  const close = (end: number) => {
    if (open === undefined) return;
    code.set(open.address, { ...open, length: end - open.offset });
    open = undefined;
  };
  for (const { offset, text } of scanned.value.lines) {
    if (text.startsWith(SECTION_MARKER)) {
      close(offset);
      if (text.startsWith(DATA_MARKER)) inData = true;
      continue;
    }
    const match = LABEL.exec(text);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    if (inData) {
      if (!data.has(match[2])) data.set(match[2], match[1]);
      continue;
    }
    close(offset);
    if (code.has(match[2]))
      return err(`the .asm repeats code address ${match[2]}`);
    open = { name: match[1], address: match[2], offset };
  }
  close(scanned.value.bytes);
  return ok({ code, data });
};
