import { isUtf8 } from "node:buffer";

import {
  collectUnparsedLines,
  type AdbUnparsedLines,
} from "./AdbUnparsedLines.js";

interface AdbDirectoryEntry {
  readonly name: string;
  readonly kind: "directory" | "file" | "symlink" | "other";
  readonly permissions: string | null;
  readonly owner: string | null;
  readonly group: string | null;
  readonly bytes: number | null;
  readonly date: string | null;
  readonly link_target: string | null;
}

/**
 * List direct children with Android 8 Toybox's batched `find -exec` and
 * `stat -c` support. Names and link targets are NUL-framed; neither is ever
 * inserted into a line-oriented metadata record or command substitution.
 */
export const ADB_DIRECTORY_BATCH_SCRIPT = String.raw`metadata=$(stat -c '%A|%U|%G|%s|%y' "$@") || exit
printf '%s\n' "$metadata" | {
  while IFS= read -r metadata; do
    [ "$#" -gt 0 ] || exit 1
    path=$1
    shift
    printf '%s\000%s\000' "$metadata" "${"${path##*/}"}"
    case "$metadata" in
      l*) readlink -n "$path" || exit 1 ;;
    esac
    printf '\000'
  done
  [ "$#" -eq 0 ]
}`;

const METADATA =
  /^([bcdlps-][rwxstST-]{9})\|([^|\n]+)\|([^|\n]+)\|(\d+)\|([^|\n]+)$/u;

const parseEntry = (
  metadata: string,
  name: string,
  linkTarget: string,
): AdbDirectoryEntry | null => {
  const match = METADATA.exec(metadata);
  if (match === null || name === "" || name.includes("/")) return null;
  const permissions = match[1]!;
  const bytes = Number(match[4]!);
  if (!Number.isSafeInteger(bytes)) return null;

  const isSymlink = permissions.startsWith("l");
  if (isSymlink ? linkTarget === "" : linkTarget !== "") return null;

  return {
    name,
    kind: permissions.startsWith("d")
      ? "directory"
      : isSymlink
        ? "symlink"
        : permissions.startsWith("-")
          ? "file"
          : "other",
    permissions,
    owner: match[2]!,
    group: match[3]!,
    bytes,
    date: match[5]!,
    link_target: isSymlink ? linkTarget : null,
  };
};

/** Parse metadata/name/target NUL triples from `ADB_DIRECTORY_BATCH_SCRIPT`. */
export const parseAdbDirectoryListing = (
  stdout: Buffer,
): {
  entries: readonly AdbDirectoryEntry[];
  unparsedLines: AdbUnparsedLines;
} => {
  const entries: AdbDirectoryEntry[] = [];
  const unparsed = collectUnparsedLines();
  let offset = 0;
  while (offset < stdout.length) {
    const metadataEnd = stdout.indexOf(0, offset);
    const nameEnd = metadataEnd < 0 ? -1 : stdout.indexOf(0, metadataEnd + 1);
    const targetEnd = nameEnd < 0 ? -1 : stdout.indexOf(0, nameEnd + 1);
    if (targetEnd < 0) {
      unparsed.add(describeUnparsedRecord(stdout.subarray(offset)));
      break;
    }
    const rawRecord = stdout.subarray(offset, targetEnd + 1);
    if (!isUtf8(rawRecord)) {
      unparsed.add(describeUnparsedRecord(rawRecord));
    } else {
      const entry = parseEntry(
        stdout.toString("utf8", offset, metadataEnd),
        stdout.toString("utf8", metadataEnd + 1, nameEnd),
        stdout.toString("utf8", nameEnd + 1, targetEnd),
      );
      if (entry === null) unparsed.add(rawRecord.toString("utf8"));
      else entries.push(entry);
    }
    offset = targetEnd + 1;
  }

  return { entries, unparsedLines: unparsed.facts() };
};

const describeUnparsedRecord = (record: Buffer): string =>
  isUtf8(record)
    ? record.toString("utf8")
    : `Invalid UTF-8 directory record (hex): ${record.toString("hex")}`;
