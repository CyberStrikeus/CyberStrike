import {
  PE_RESOURCE_DIRECTORY_BYTES,
  PE_RESOURCE_ENTRY_BYTES,
  PE_RESOURCE_NAME_PREFIX_BYTES,
  readPeResourceDirectoryFacts,
  readPeResourceEntryFacts,
  readPeResourceNameFacts,
  type PeResourceIdentityDeclaration,
} from "./PeResourceTreeFacts.js";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { assertArtifactReadActive } from "../../artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import type { ArtifactLimitBoundary } from "../../domain/artifactOperationError.js";
import { jsonParts } from "../../domain/jsonSerialization.js";
import type {
  InspectPeResourcesInput,
  PeResourceIdentity,
  PeResources,
} from "../../domain/native/peResources.js";
import {
  peFailure,
  readPeResourceLayout,
  requirePeRange,
} from "./PeResourceLayout.js";

type PeResourceLayout = ReturnType<typeof readPeResourceLayout>;

type Range = { offset: number; bytes: number };
type OccupiedRange = Range & {
  kind: "directory" | "name" | "data-entry" | "payload";
};
/** Complete PE resource result retained before a refusal. */
export const PE_RESOURCE_METADATA_BYTES = 8 * 1024 * 1024;
const METADATA_BYTES = PE_RESOURCE_METADATA_BYTES;
const limit = (message: string, boundary: ArtifactLimitBoundary): never => {
  throw new ArtifactReaderFailure("limit", message, { boundary });
};
/** Count bytes through the canonical bounded JSON writer. */
const jsonBytes = (value: unknown, maximum: number): number => {
  let size = 0;
  for (const part of jsonParts(value)) {
    size += Buffer.byteLength(part, "utf8");
    if (size > maximum) return size;
  }
  return size;
};
const identityKey = (id: PeResourceIdentity): string =>
  id.kind === "id" ? `id:${String(id.id)}` : `name:${id.utf16le_hex}`;

/** Decode the conventional type/name/language tree; never infer payload meaning or runtime loading. */
export const parsePeResources = async (
  bytes: Buffer,
  artifact: PeResources["artifact"],
  input: InspectPeResourcesInput,
  signal?: AbortSignal,
  /** Already admitted from these same bytes; used by carrier probes that own layout failure policy. */
  admittedLayout?: PeResourceLayout,
): Promise<PeResources> => {
  assertArtifactReadActive(signal);
  const layout = admittedLayout ?? readPeResourceLayout(bytes);
  const directories: PeResources["directories"] = [];
  const resources: PeResources["resources"] = [];
  const occupied: OccupiedRange[] = [];
  const names = new Map<number, PeResourceIdentity>();
  let examined = 0;
  let metadataBytes = 0;
  const ensureCapacity = (projectedBytes: number): void => {
    if (metadataBytes + projectedBytes > METADATA_BYTES)
      limit(
        "PE resource metadata exceeds the 8 MiB complete-result allocation budget.",
        "memory",
      );
  };
  const accountBytes = (projectedBytes: number): void => {
    ensureCapacity(projectedBytes);
    metadataBytes += projectedBytes;
  };
  const account = (value: unknown): void => {
    // Rows are retained in arrays; reserve a separator along with each row.
    accountBytes(jsonBytes(value, METADATA_BYTES - metadataBytes - 1) + 1);
  };
  const reserveDecodedName = (utf16Units: number): void => {
    // A JSON string can need six ASCII bytes per UTF-16 code unit (for example,
    // a control character encoded as `\\u0000`). The original spelling and
    // its hex form are both retained in the result.
    const projectedBytes = 10 * utf16Units + 256;
    ensureCapacity(projectedBytes);
  };
  const root = layout.size === 0 ? 0 : layout.map(layout.rva, layout.size);
  const relative = (at: number, length: number): number => {
    if (at > layout.size - length || at < 0)
      peFailure(
        "Resource directory offset leaves the declared resource interval.",
      );
    requirePeRange(bytes, root + at, length);
    return root + at;
  };
  const recordRange = (
    offset: number,
    size: number,
    kind: OccupiedRange["kind"],
  ): Range => {
    const range = { offset, bytes: size };
    if (size > 0) occupied.push({ ...range, kind });
    return range;
  };
  const readIdentity = (
    declaration: PeResourceIdentityDeclaration,
  ): PeResourceIdentity => {
    if (declaration.kind === "id") return { kind: "id", id: declaration.id };
    const at = declaration.offset;
    const previous = names.get(at);
    if (previous !== undefined) return previous;
    if (at % 2 !== 0) peFailure("Unaligned PE resource name.");
    const start = relative(at, PE_RESOURCE_NAME_PREFIX_BYTES);
    const { utf16Units, payloadBytes: length } = readPeResourceNameFacts(
      bytes.subarray(start, start + PE_RESOURCE_NAME_PREFIX_BYTES),
    );
    reserveDecodedName(utf16Units);
    relative(at, PE_RESOURCE_NAME_PREFIX_BYTES + length);
    const raw = bytes.subarray(
      start + PE_RESOURCE_NAME_PREFIX_BYTES,
      start + PE_RESOURCE_NAME_PREFIX_BYTES + length,
    );
    const value: PeResourceIdentity = {
      kind: "name",
      name: raw.toString("utf16le"),
      utf16le_hex: raw.toString("hex"),
      location: recordRange(
        start,
        PE_RESOURCE_NAME_PREFIX_BYTES + length,
        "name",
      ),
    };
    names.set(at, value);
    return value;
  };
  const visit = async (
    at: number,
    path: PeResourceIdentity[],
    entryLocations: Range[],
    ancestors: ReadonlySet<number>,
  ): Promise<void> => {
    if (ancestors.has(at)) peFailure("Cyclic PE resource directory.");
    const header = relative(at, PE_RESOURCE_DIRECTORY_BYTES);
    const facts = readPeResourceDirectoryFacts(
      bytes.subarray(header, header + PE_RESOURCE_DIRECTORY_BYTES),
    );
    const { namedEntries: named, idEntries: ids, entryCount: count } = facts;
    if (count > input.max_entries - examined)
      limit(
        "PE resource directory entry budget exceeded; no partial inventory was returned.",
        "capacity",
      );
    examined += count;
    relative(at, PE_RESOURCE_DIRECTORY_BYTES + PE_RESOURCE_ENTRY_BYTES * count);
    const directory = {
      path,
      entry_locations: entryLocations,
      location: recordRange(
        header,
        PE_RESOURCE_DIRECTORY_BYTES + PE_RESOURCE_ENTRY_BYTES * count,
        "directory",
      ),
      characteristics: facts.characteristics,
      timestamp: facts.timestamp,
      major_version: facts.majorVersion,
      minor_version: facts.minorVersion,
      named_entries: named,
      id_entries: ids,
    };
    account(directory);
    directories.push(directory);
    const keys = new Set<string>();
    const nested = new Set([...ancestors, at]);
    for (let index = 0; index < count; index++) {
      if (index % 128 === 0) {
        await setImmediate();
        assertArtifactReadActive(signal);
      }
      const entry =
        header + PE_RESOURCE_DIRECTORY_BYTES + index * PE_RESOURCE_ENTRY_BYTES;
      const record = readPeResourceEntryFacts(
        bytes.subarray(entry, entry + PE_RESOURCE_ENTRY_BYTES),
      );
      if ((record.identity.kind === "name") !== index < named)
        peFailure(
          "Resource name/ID entry counts disagree with encoded identities.",
        );
      const identity = readIdentity(record.identity);
      const key = identityKey(identity);
      if (keys.has(key))
        peFailure("Duplicate identity within a resource directory.");
      keys.add(key);
      const next = [...path, identity];
      const locations = [
        ...entryLocations,
        { offset: entry, bytes: PE_RESOURCE_ENTRY_BYTES },
      ];
      const { offset } = record.target;
      if (record.target.kind === "directory") {
        if (next.length >= 3)
          peFailure(
            "Unsupported resource tree deeper than type/name/language.",
          );
        await visit(offset, next, locations, nested);
      } else {
        if (next.length !== 3)
          peFailure(
            "Unsupported resource leaf outside the type/name/language profile.",
          );
        const data = relative(offset, 16);
        const rva = bytes.readUInt32LE(data);
        const size = bytes.readUInt32LE(data + 4);
        const payloadOffset = layout.map(rva, size);
        const [type, name, language] = next;
        if (type === undefined || name === undefined || language === undefined)
          return peFailure("Incomplete resource identity.");
        const resource = {
          index: resources.length,
          type,
          name,
          language,
          entry_locations: locations,
          data_entry_location: recordRange(data, 16, "data-entry"),
          code_page: bytes.readUInt32LE(data + 8),
          reserved: bytes.readUInt32LE(data + 12),
          payload: {
            rva,
            location: recordRange(payloadOffset, size, "payload"),
            sha256: "0".repeat(64),
          },
        };
        account(resource);
        resources.push(resource);
      }
    }
  };
  if (layout.size > 0) await visit(0, [], [], new Set());
  rejectOverlappingRanges(occupied);
  const hashes = new Map<string, string>();
  for (const resource of resources) {
    const range = resource.payload.location;
    const key = `${String(range.offset)}:${String(range.bytes)}`;
    let digest = hashes.get(key);
    if (digest === undefined) {
      const hash = createHash("sha256");
      for (let offset = 0; offset < range.bytes; offset += 1048576) {
        await setImmediate();
        assertArtifactReadActive(signal);
        hash.update(
          bytes.subarray(
            range.offset + offset,
            range.offset + Math.min(range.bytes, offset + 1048576),
          ),
        );
      }
      digest = hash.digest("hex");
      hashes.set(key, digest);
    }
    resource.payload.sha256 = digest;
  }
  const iconGroups = readIconGroups(bytes, resources, account, ensureCapacity);
  const report: PeResources = {
    artifact,
    format: layout.format,
    machine: layout.machine,
    directory:
      layout.size === 0
        ? null
        : {
            rva: layout.rva,
            location: { offset: root, bytes: layout.size },
            data_directory_location: { offset: layout.directoryAt, bytes: 8 },
          },
    directories,
    resources,
    icon_groups: iconGroups,
    coverage: {
      status: "complete",
      examined_entries: examined,
      resources: resources.length,
    },
    limitations: [
      "Static PE32/PE32+ type/name/language resource inventory; payloads other than RT_GROUP_ICON remain opaque.",
      "Icon candidates are resource-table relationships. Language fallback, image decoding and actual shell/window loading are not observed.",
      "Exact shared byte ranges are retained; non-identical overlapping resource structures or payloads are rejected.",
    ],
  };
  assertArtifactReadActive(signal);
  if (jsonBytes(report, METADATA_BYTES) > METADATA_BYTES)
    limit("PE resource result exceeds the 8 MiB allocation budget.", "memory");
  return report;
};

const rejectOverlappingRanges = (ranges: OccupiedRange[]): void => {
  ranges.sort(
    (left, right) => left.offset - right.offset || right.bytes - left.bytes,
  );
  let previous: OccupiedRange | undefined;
  for (const current of ranges) {
    if (
      previous !== undefined &&
      current.offset < previous.offset + previous.bytes &&
      (current.offset !== previous.offset ||
        current.bytes !== previous.bytes ||
        current.kind !== previous.kind)
    )
      peFailure("Non-identical resource byte ranges overlap.");
    previous = current;
  }
};

const readIconGroups = (
  bytes: Buffer,
  resources: PeResources["resources"],
  account: (value: unknown) => void,
  ensureCapacity: (projectedBytes: number) => void,
): PeResources["icon_groups"] => {
  const imagesById = new Map<number, PeResources["resources"]>();
  for (const resource of resources) {
    if (
      resource.type.kind !== "id" ||
      resource.type.id !== 3 ||
      resource.name.kind !== "id"
    )
      continue;
    const candidates = imagesById.get(resource.name.id) ?? [];
    candidates.push(resource);
    imagesById.set(resource.name.id, candidates);
  }
  return resources
    .filter(
      (resource) => resource.type.kind === "id" && resource.type.id === 14,
    )
    .map((group) => {
      const { offset, bytes: size } = group.payload.location;
      if (
        size < 6 ||
        bytes.readUInt16LE(offset) !== 0 ||
        bytes.readUInt16LE(offset + 2) !== 1
      )
        peFailure("Malformed RT_GROUP_ICON header.");
      const count = bytes.readUInt16LE(offset + 4);
      if (size !== 6 + count * 14)
        peFailure("RT_GROUP_ICON length does not match its image count.");
      const images: PeResources["icon_groups"][number]["images"] = [];
      for (let index = 0; index < count; index++) {
        const at = offset + 6 + index * 14;
        const id = bytes.readUInt16LE(at + 12);
        const candidates = imagesById.get(id) ?? [];
        const exact = candidates.find(
          (resource) =>
            identityKey(resource.language) === identityKey(group.language),
        );
        // Indices are uint32 values and each needs at most ten decimal digits
        // plus a comma. Check the expanded candidate list before allocating it.
        ensureCapacity(302 + candidates.length * 11);
        const declaredBytes = bytes.readUInt32LE(at + 8);
        const image = {
          location: { offset: at, bytes: 14 },
          width: bytes[at] ?? 0,
          height: bytes[at + 1] ?? 0,
          color_count: bytes[at + 2] ?? 0,
          reserved: bytes[at + 3] ?? 0,
          planes: bytes.readUInt16LE(at + 4),
          bit_count: bytes.readUInt16LE(at + 6),
          declared_bytes: declaredBytes,
          resource_id: id,
          candidate_resource_indices: candidates.map(({ index }) => index),
          same_language_resource_index: exact?.index ?? null,
          size_matches:
            exact === undefined
              ? null
              : exact.payload.location.bytes === declaredBytes,
        };
        account(image);
        images.push(image);
      }
      account({ resource_index: group.index, images: [] });
      return { resource_index: group.index, images };
    });
};
