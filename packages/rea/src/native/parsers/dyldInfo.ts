interface ParsedDyldSymbolFields {
  readonly address: string | null;
  readonly weak: boolean | null;
  readonly reexport: boolean | null;
  readonly source: string | null;
}

interface ParsedDyldImport extends ParsedDyldSymbolFields {
  readonly name: string | null;
  /** Producer text when name, flags, library, or addend boundaries are unknown. */
  readonly raw_name: string | null;
  readonly name_status: "exact" | "ambiguous";
  readonly addend: string | null;
}

interface ParsedDyldExport extends ParsedDyldSymbolFields {
  readonly name: string;
  /** The source library's name for a symbol it re-exports under another name. */
  readonly sourceSymbol?: string;
}

/** Decode Apple's literal import framing; request nm facts for competing names. */
export const parseDyldImports = (
  output: string,
  hasChainedFixups: boolean,
  knownImportNames?: ReadonlySet<string>,
): {
  readonly items: ParsedDyldImport[];
  readonly needsNameInventory: boolean;
} => {
  let needsNameInventory = false;
  const items = output
    .split("\n")
    .flatMap<ParsedDyldImport>((rawLine, index) => {
      const framed = rawLine.startsWith("      ");
      const line = framed ? rawLine.slice(6) : rawLine;
      if (
        line.length === 0 ||
        line.trim() === "-imports:" ||
        (index === 0 && line.endsWith(":"))
      )
        return [];
      // Apple prints "%s %s (from %s)": even an empty weak flag has its
      // own separating spaces. Whitespace inside the name remains payload.
      // Chained rows have one space after the ordinal in current Apple source,
      // but two in installed-tool captures. nm names establish that boundary.
      const ordinal = hasChainedFixups ? /^0x[\da-f]+ /iu.exec(line) : null;
      const row = ordinal === null ? line : line.slice(ordinal[0].length);
      const starts =
        ordinal !== null && row.startsWith(" ") ? [row, row.slice(1)] : [row];
      const readings: { name: string; weak: boolean | null; source: string }[] =
        [];
      for (const start of starts)
        for (const separator of start.matchAll(
          / (?:\[weak-import\])? \(from /gu,
        )) {
          const source = start.slice(separator.index + separator[0].length, -1);
          if (!start.endsWith(")") || source.length === 0) continue;
          const name = start.slice(0, separator.index);
          if (name.length === 0) continue;
          readings.push({
            name,
            weak: separator[0].includes("[weak-import]") ? true : null,
            source,
          });
        }
      if (readings.length > 1 && knownImportNames === undefined)
        needsNameInventory = true;
      const matching =
        readings.length > 1 && knownImportNames !== undefined
          ? readings.filter(({ name }) => knownImportNames.has(name))
          : readings;
      const reading = matching.length === 1 ? matching[0] : undefined;
      const ambiguousSuffix =
        reading !== undefined &&
        hasChainedFixups &&
        /\+0x[\da-f]+$/iu.test(reading.name);
      const unknownName =
        !framed ||
        (hasChainedFixups && ordinal === null) ||
        reading === undefined;
      // Prefix uncertainty need not erase a separately established flag/library.
      const common = readings.every(
        (candidate) =>
          candidate.weak === readings[0]?.weak &&
          candidate.source === readings[0]?.source,
      )
        ? readings[0]
        : undefined;
      return [
        {
          name: unknownName || ambiguousSuffix ? null : reading.name,
          raw_name: unknownName ? line : ambiguousSuffix ? reading.name : null,
          name_status: unknownName || ambiguousSuffix ? "ambiguous" : "exact",
          addend: null,
          address: null,
          weak: (reading ?? common)?.weak ?? null,
          reexport: null,
          source: (reading ?? common)?.source ?? null,
        },
      ];
    });
  return { items, needsNameInventory };
};

/** Apple prints two spaces after the address; one-space captures remain readable. */
export const parseDyldExportAddressRow = (
  line: string,
): { readonly address: string; readonly text: string } | null => {
  const match = /^(0x[\da-f]+)(?: {2}|[ \t])(.+)$/isu.exec(line);
  return match?.[1] === undefined || match[2] === undefined
    ? null
    : { address: match[1], text: match[2] };
};

/** Decode Apple dyld export rows, projecting export offsets to VM addresses. */
export const parseDyldExports = (
  output: string,
  imageBase: string | null,
  knownExportNames: ReadonlySet<string>,
): ParsedDyldExport[] => {
  const offsets = /^\s*offset\s+symbol\s*$/mu.test(output);
  // dyld_info ends rows with LF. A carriage return before it belongs to the
  // symbol name, so export rows keep their trailing text.
  return output.split("\n").flatMap<ParsedDyldExport>((rawLine) => {
    const line = rawLine.trimStart();
    // dyld_info prints `_sym (from lib)`, or `_new (_old from lib)` when the
    // source library names the symbol differently. Split the trailing
    // parenthesized suffix with string scans so a library path containing
    // " from ", or a source symbol containing parentheses such as
    // `operator()`, cannot pull the match into nested lazy quantifiers.
    const reexport = parseReexportRow(line, knownExportNames);
    if (reexport !== null)
      return [
        {
          name: reexport.name,
          address: null,
          weak: null,
          reexport: true,
          source: reexport.source,
          ...(reexport.sourceSymbol === undefined
            ? {}
            : { sourceSymbol: reexport.sourceSymbol }),
        },
      ];
    const row = parseDyldExportAddressRow(line);
    if (row === null) return [];
    const exported = /^(.+?)(?:\s+\[([^\]]+)\])?$/su.exec(row.text);
    if (exported?.[1] === undefined) return [];
    const rawName = row.text;
    const literalName = knownExportNames.has(rawName);
    // If nm establishes both interpretations, the textual row cannot bind an address or flags.
    // Let the caller retain the exact nm names without guessing which one owns this row.
    if (
      literalName &&
      exported[2] !== undefined &&
      knownExportNames.has(exported[1])
    )
      return [];
    const annotation = literalName ? undefined : exported[2];
    const absolute = /\babsolute\b/u.test(annotation ?? "");
    const address =
      offsets && !absolute
        ? imageBase === null
          ? null
          : `0x${(BigInt(imageBase) + BigInt(row.address)).toString(16)}`
        : canonicalHex(row.address);
    return [
      {
        name: literalName ? rawName : exported[1],
        address,
        weak: /\bweak-def\b/u.test(annotation ?? "") ? true : null,
        reexport: false,
        source: null,
      },
    ];
  });
};

const canonicalHex = (value: string | undefined): string | null =>
  value === undefined ? null : `0x${BigInt(value).toString(16)}`;

interface ReexportRow {
  readonly name: string;
  readonly source: string | null;
  readonly sourceSymbol?: string;
}

/**
 * Split a `[re-export]` row without nested lazy quantifiers.
 *
 * Returns null when the line is not a re-export row so callers fall through
 * to the plain export parser. Known names disambiguate nested parentheses;
 * when that inventory is incomplete, retain the suffix-based fallback.
 */
const parseReexportRow = (
  line: string,
  knownNames: ReadonlySet<string>,
): ReexportRow | null => {
  const prefix = /^\[re-export\] /u.exec(line);
  if (prefix === null) return null;
  const rest = line.slice(prefix[0].length);
  if (rest.length === 0) return null;
  if (!rest.endsWith(")")) return { name: rest, source: null };
  const candidates: ReexportRow[] = [];
  for (const match of rest.matchAll(/\s+\(/gu)) {
    const name = rest.slice(0, match.index);
    if (!knownNames.has(name)) continue;
    const parsed = reexportSuffix(
      name,
      rest.slice(match.index + match[0].length, -1),
    );
    if (parsed !== null) candidates.push(parsed);
  }
  // Exact nm identities establish a boundary even when names contain parentheses.
  // Competing known interpretations remain unknown rather than creating a new name.
  if (candidates.length > 0)
    return candidates.length === 1 ? candidates[0]! : null;
  if (knownNames.has(rest)) return { name: rest, source: null };
  let depth = 0;
  for (let index = rest.length - 1; index >= 0; index--) {
    if (rest[index] === ")") depth++;
    else if (rest[index] === "(" && --depth === 0) {
      if (index === 0 || !/\s/u.test(rest[index - 1]!)) break;
      const name = rest.slice(0, index).trimEnd();
      return (
        reexportSuffix(name, rest.slice(index + 1, -1)) ?? {
          name: rest,
          source: null,
        }
      );
    }
  }
  return { name: rest, source: null };
};

const reexportSuffix = (name: string, inner: string): ReexportRow | null => {
  if (name.length === 0) return null;
  if (inner.startsWith("from ") && inner.length > 5)
    return { name, source: inner.slice(5) };
  const separator = /\s+from /u.exec(inner);
  if (separator === null) return null;
  const sourceSymbol = inner.slice(0, separator.index);
  const source = inner.slice(separator.index + separator[0].length);
  return sourceSymbol.length > 0 && source.length > 0
    ? { name, source, sourceSymbol }
    : null;
};
