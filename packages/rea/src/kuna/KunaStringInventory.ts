import { z } from "zod";

import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { analysisStringSchema } from "../domain/native/nativeString.js";
import { err, ok, type Result } from "../domain/result.js";
import { compareKunaAddresses } from "./KunaAddress.js";
import { KunaDocumentError } from "./KunaDocumentError.js";
import { KunaJsonDocumentReader, parseKunaRow } from "./KunaJsonStream.js";
import { KUNA_STRING_MIN_LENGTH } from "./KunaLimits.js";

const count = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const address = z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/u);
const header = z.object({
  binary: z.string(),
  encoding: z.literal("all"),
  min_length: z.literal(KUNA_STRING_MIN_LENGTH),
  filter: z.null(),
  section: z.null(),
  termination: z.literal("any"),
  scanned: z.enum(["sections", "segments"]),
  xrefs: z.literal(false),
  count,
});
const row = z.object({
  address,
  address_hex: address,
  text: z.string(),
  length: count,
  byte_length: count,
  nul_terminated: z.boolean(),
  encoding: z.enum(["ascii", "utf8", "utf16"]),
  section: z.string().nullable(),
  xrefs_count: z.literal(0),
  functions: z.tuple([]),
});

const ROWS = "strings";
const DOCUMENT = {
  header: new Set(Object.keys(header.shape)),
  sections: new Map(),
  rows: new Map([
    [
      ROWS,
      {
        fields: new Set(
          Object.keys(row.shape).filter(
            (key) => key !== "address" && key !== "functions",
          ),
        ),
        addresses: new Set(["address"]),
        // Rows are scanned with --no-xrefs, so `functions` must be empty.
        empty: new Set(["functions"]),
        nulls: new Set<string>(),
      },
    ],
  ]),
} as const;

/** JSON text omits terminators; native lengths describe the encoded source. */
const validateStringFacts = (entry: z.infer<typeof row>): void => {
  let characters = 0;
  for (const character of entry.text) {
    const point = character.codePointAt(0)!;
    if (
      point === 0 ||
      (point >= 0xd800 && point <= 0xdfff) ||
      (entry.encoding === "ascii" && point > 0x7f) ||
      (entry.encoding === "utf16" && point > 0xff)
    )
      throw new KunaDocumentError("encoding_contradicts_text");
    characters += 1;
  }
  const textBytes =
    entry.encoding === "utf16"
      ? entry.text.length * 2
      : entry.encoding === "ascii"
        ? entry.text.length
        : Buffer.byteLength(entry.text);
  const terminatorBytes = entry.nul_terminated
    ? entry.encoding === "utf16"
      ? 2
      : 1
    : 0;
  if (
    characters < KUNA_STRING_MIN_LENGTH ||
    entry.length !== characters ||
    entry.byte_length !== textBytes + terminatorBytes
  )
    throw new KunaDocumentError("length_contradicts_text");
};

export type KunaStringItem = z.infer<typeof analysisStringSchema>;

export interface KunaStringInventory {
  /** Canonical address order, then encoding; identities are unique. */
  readonly items: readonly KunaStringItem[];
  readonly sha256: string;
  readonly bytes: number;
  readonly scanned: "sections" | "segments";
}

/** Locate every encoding at a canonical address without copying an index. */
export const kunaStringsAtAddress = (
  inventory: KunaStringInventory,
  address: string,
): KunaStringItem[] => {
  const { items } = inventory;
  let start = 0;
  let end = items.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (compareKunaAddresses(items[middle]!.address, address) < 0)
      start = middle + 1;
    else end = middle;
  }
  end = start;
  while (end < items.length && items[end]!.address === address) end += 1;
  return items.slice(start, end);
};

/** Validates `kuna strings --json` row by row as Kuna writes it. */
export class KunaStringInventoryReader extends KunaJsonDocumentReader<KunaStringInventory> {
  readonly #items: KunaStringItem[] = [];
  readonly #identities = new Set<string>();

  constructor() {
    super("kuna:strings", "Kuna's string inventory", DOCUMENT);
  }

  override finish(input: string): Result<KunaStringInventory, AnalysisError> {
    const completed = this.complete();
    if (!completed.ok) return completed;
    const fields = header.safeParse(completed.value.header);
    if (!fields.success)
      return err(
        this.unusable("the string inventory header is not Kuna's scan"),
      );
    if (fields.data.binary !== input)
      return err(this.unusable("string inventory names a different input"));
    if (fields.data.count !== this.#items.length)
      return err(
        this.unusable("string inventory count disagrees with examined rows"),
      );
    this.#items.sort(
      (left, right) =>
        compareKunaAddresses(left.address, right.address) ||
        (left.string?.encoding ?? "").localeCompare(
          right.string?.encoding ?? "",
          "en",
        ),
    );
    return ok({
      items: this.#items,
      sha256: completed.value.sha256,
      bytes: completed.value.bytes,
      scanned: fields.data.scanned,
    });
  }

  protected override acceptRow(
    _member: string,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    const entry = parseKunaRow(row, "string", fields);
    validateStringFacts(entry);
    if (entry.address !== entry.address_hex)
      throw new KunaDocumentError("address_hex_disagrees");
    const identity = `${entry.address}:${entry.encoding}`;
    if (this.#identities.has(identity))
      throw new KunaDocumentError("repeated_identity");
    this.#identities.add(identity);
    this.#items.push({
      address: entry.address,
      value: entry.text,
      string: {
        encoding: entry.encoding,
        encoding_status: "observed",
        termination: entry.nul_terminated
          ? "present_or_not_required"
          : "missing",
        byte_length: entry.byte_length,
      },
    });
  }

  protected override discardRows(): void {
    this.#items.length = 0;
    this.#identities.clear();
  }
}
