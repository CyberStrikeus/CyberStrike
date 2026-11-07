import type {
  Devicetree,
  InspectDevicetreeInput,
} from "../../domain/firmware/devicetree.js";
import { BinaryFormatFailure } from "../../native/metadata/BinaryContainer.js";

export class DevicetreeLimitFailure extends Error {
  constructor(
    readonly limit:
      | keyof Omit<InspectDevicetreeInput, "path">
      | "decoded_bytes",
  ) {
    super(
      limit === "decoded_bytes"
        ? "Devicetree exceeds its fixed 32 MiB decoded representation allowance; select a smaller blob. This allowance has no runtime override."
        : `Devicetree exceeds ${limit}; raise that caller-selected limit within its schema ceiling or select a smaller blob.`,
    );
  }
}
const malformed = (message: string): never => {
  throw new BinaryFormatFailure("malformed", message);
};
const align = (n: number) => Math.ceil(n / 4) * 4;
const hex = (n: bigint) => `0x${n.toString(16)}`;

/** Decode one DTB snapshot. Flat nodes retain explicit parent identity without recursive output. */
export const parseDevicetree = (
  bytes: Buffer,
  artifact: Devicetree["artifact"],
  input: InspectDevicetreeInput,
): Devicetree => {
  if (bytes.length > input.max_file_bytes)
    throw new DevicetreeLimitFailure("max_file_bytes");
  if (bytes.length < 28) malformed("Truncated FDT header");
  const u32 = (offset: number) => bytes.readUInt32BE(offset);
  if (u32(0) !== 0xd00dfeed)
    throw new BinaryFormatFailure(
      "unsupported",
      "Not a flattened devicetree blob",
    );
  const version = u32(20);
  if (version !== 16 && version !== 17)
    throw new BinaryFormatFailure(
      "unsupported",
      `FDT version ${version} is unsupported; supported versions are 16 and 17`,
    );
  const headerBytes = version === 17 ? 40 : 36;
  if (bytes.length < headerBytes) malformed("Truncated FDT header");
  const header: Devicetree["header"] = {
    magic: u32(0),
    totalsize: u32(4),
    off_dt_struct: u32(8),
    off_dt_strings: u32(12),
    off_mem_rsvmap: u32(16),
    version,
    last_comp_version: u32(24),
    boot_cpuid_phys: u32(28),
    size_dt_strings: u32(32),
    size_dt_struct: version === 17 ? u32(36) : null,
  };
  const end = header.totalsize;
  if (
    end > bytes.length ||
    end < headerBytes ||
    header.last_comp_version > version ||
    header.last_comp_version > 17
  )
    malformed("Invalid FDT header size or compatibility version");
  let decodedBytes = 0;
  const admit = (size: number) => {
    decodedBytes += size;
    if (decodedBytes > 33554432)
      throw new DevicetreeLimitFailure("decoded_bytes");
  };
  const ranges: { start: number; end: number }[] = [
    { start: 0, end: headerBytes },
  ];
  const range = (start: number, size: number) => {
    if (size < 0 || start < headerBytes || start > end - size)
      malformed("FDT block outside totalsize");
    const r = { start, end: start + size };
    if (ranges.some((other) => r.start < other.end && other.start < r.end))
      malformed("Overlapping FDT blocks");
    ranges.push(r);
  };
  if (header.off_dt_struct % 4 || header.off_mem_rsvmap % 8)
    malformed("Misaligned FDT block");
  range(header.off_dt_strings, header.size_dt_strings);
  // v16 lacks size_dt_struct. Bound the scan by the next declared block or totalsize.
  const structEnd =
    header.size_dt_struct === null
      ? Math.min(
          end,
          ...[header.off_dt_strings, header.off_mem_rsvmap].filter(
            (n) => n > header.off_dt_struct,
          ),
        )
      : header.off_dt_struct + header.size_dt_struct;
  range(header.off_dt_struct, structEnd - header.off_dt_struct);
  const reservations: Devicetree["reservations"] = [];
  let cursor = header.off_mem_rsvmap;
  const reservationEnd = Math.min(
    end,
    ...[header.off_dt_struct, header.off_dt_strings].filter((n) => n >= cursor),
  );
  if (ranges.some((r) => cursor >= r.start && cursor < r.end))
    malformed("Reservation block overlaps another FDT block");
  for (;;) {
    if (cursor > reservationEnd - 16)
      malformed("Unterminated or overlapping FDT reservation block");
    const address = bytes.readBigUInt64BE(cursor),
      size = bytes.readBigUInt64BE(cursor + 8);
    cursor += 16;
    if (address === 0n && size === 0n) break;
    if (reservations.length >= input.max_properties)
      throw new DevicetreeLimitFailure("max_properties");
    admit(128);
    reservations.push({
      offset: cursor - 16,
      address: hex(address),
      size: hex(size),
    });
  }
  range(header.off_mem_rsvmap, cursor - header.off_mem_rsvmap);
  const text = (
    start: number,
    stop: number,
  ): { value: string; next: number } => {
    const nul = bytes.indexOf(0, start);
    if (nul < start || nul >= stop) return malformed("Unterminated FDT name");
    const raw = bytes.subarray(start, nul);
    if (raw.some((c) => c < 0x20 || c > 0x7e)) malformed("Non-ASCII FDT name");
    admit(raw.length * 2);
    return { value: raw.toString("ascii"), next: nul + 1 };
  };
  const names = new Map<number, string>();
  const propertiesByPath = new Map<
    string,
    Map<string, Devicetree["nodes"][number]["properties"][number]>
  >();
  const nodes: Devicetree["nodes"] = [];
  const stack: { node: Devicetree["nodes"][number]; children: boolean }[] = [];
  const paths = new Set<string>();
  let properties = 0,
    finished = false;
  cursor = header.off_dt_struct;
  const need = (n: number) => {
    if (cursor > structEnd - n)
      malformed("Truncated FDT structure token or property");
  };
  while (cursor < structEnd) {
    need(4);
    const offset = cursor,
      token = u32(cursor);
    cursor += 4;
    if (token === 1) {
      if (stack.length >= input.max_depth)
        throw new DevicetreeLimitFailure("max_depth");
      if (nodes.length >= input.max_nodes)
        throw new DevicetreeLimitFailure("max_nodes");
      const name = text(cursor, structEnd);
      cursor = align(name.next);
      need(0);
      const parent = stack.at(-1);
      if (
        name.value.includes("/") ||
        (!parent && (nodes.length > 0 || name.value !== "")) ||
        (parent && !name.value)
      )
        malformed("Invalid FDT node name or multiple roots");
      admit((parent?.node.path.length ?? 0) * 4 + name.value.length * 2 + 128);
      const path = parent
        ? `${parent.node.path === "/" ? "" : parent.node.path}/${name.value}`
        : "/";
      if (paths.has(path)) malformed("Duplicate FDT node path");
      paths.add(path);
      const node = {
        path,
        parent: parent?.node.path ?? null,
        offset,
        properties: [],
      } satisfies Devicetree["nodes"][number];
      if (parent) parent.children = true;
      propertiesByPath.set(path, new Map());
      nodes.push(node);
      stack.push({ node, children: false });
    } else if (token === 2) {
      if (!stack.pop()) malformed("Unbalanced FDT_END_NODE");
    } else if (token === 3) {
      const owner = stack.at(-1);
      if (!owner || owner.children)
        return malformed("FDT property outside node or after children");
      need(8);
      const length = u32(cursor),
        nameoff = u32(cursor + 4);
      cursor += 8;
      need(length);
      if (++properties > input.max_properties)
        throw new DevicetreeLimitFailure("max_properties");
      if (nameoff >= header.size_dt_strings)
        malformed("FDT property string offset out of range");
      let name = names.get(nameoff);
      if (name === undefined) {
        name = text(
          header.off_dt_strings + nameoff,
          header.off_dt_strings + header.size_dt_strings,
        ).value;
        names.set(nameoff, name);
      }
      const propertyMap = propertiesByPath.get(owner.node.path);
      if (!name || propertyMap?.has(name))
        malformed("Empty or duplicate FDT property name");
      admit(name.length * 2 + Math.min(length, 256) * 2 + 256);
      const raw = bytes.subarray(cursor, cursor + length);
      // Only binding-independent standard strings and single-cell declarations are decoded.
      const stringProperty =
        ["compatible", "model", "status", "bootargs", "stdout-path"].includes(
          name,
        ) || owner.node.path === "/aliases";
      if (stringProperty) admit(raw.length * 4);
      let strings: string[] | null = null;
      if (
        stringProperty &&
        raw.length > 0 &&
        raw.at(-1) === 0 &&
        raw.subarray(0, -1).every((c) => c === 0 || (c >= 0x20 && c <= 0x7e))
      ) {
        // Count entries before split allocates its array and individual strings.
        let entries = 0;
        for (const byte of raw) if (byte === 0) entries++;
        admit(entries * 32);
        const repeatedInSummary =
          (owner.node.path === "/" && name === "compatible") ||
          (entries === 1 &&
            ((owner.node.path === "/" && name === "model") ||
              (owner.node.path === "/chosen" &&
                ["bootargs", "stdout-path"].includes(name)) ||
              owner.node.path === "/aliases"));
        // Summary values serialize again, including quotes, commas and escapes.
        if (repeatedInSummary) admit(raw.length * 2 + entries * 3 + 2);
        strings = raw.subarray(0, -1).toString("ascii").split("\0");
      }
      const cells =
        [
          "phandle",
          "linux,phandle",
          "#address-cells",
          "#size-cells",
          "interrupt-parent",
          "remote-endpoint",
          "msi-parent",
        ].includes(name) && length === 4
          ? [raw.readUInt32BE(0)]
          : null;
      const property = {
        name,
        offset: cursor,
        bytes: length,
        hex: raw.subarray(0, 256).toString("hex"),
        truncated: length > 256,
        derived: { confidence: "derived" as const, strings, cells, reg: null },
      };
      owner.node.properties.push(property);
      propertyMap?.set(name, property);
      cursor = align(cursor + length);
      need(0);
    } else if (token === 9) {
      if (stack.length || nodes.length === 0) malformed("Premature FDT_END");
      if (header.size_dt_struct !== null && cursor !== structEnd)
        malformed("FDT_END does not terminate the declared structure block");
      finished = true;
      break;
    } else if (token !== 4) malformed(`Unknown FDT token ${token}`);
  }
  if (!finished) malformed("Missing FDT_END");
  const byPath = new Map(nodes.map((n) => [n.path, n]));
  const prop = (path: string, name: string) =>
    propertiesByPath.get(path)?.get(name);
  const singleString = (path: string, name: string) => {
    const s = prop(path, name)?.derived.strings;
    return s?.length === 1 ? (s[0] ?? null) : null;
  };
  const handles = new Map<number, string | null>();
  const limitations = [
    "Raw property previews are limited to 256 bytes; offsets and lengths identify complete values in the hashed artifact.",
    "Phandle references cover only single-cell interrupt-parent, remote-endpoint and msi-parent; binding-specific arrays and overlays are not resolved.",
  ];
  for (const node of nodes) {
    const canonical = prop(node.path, "phandle");
    const legacy = prop(node.path, "linux,phandle");
    const malformedCanonical =
      canonical !== undefined && canonical.derived.cells === null;
    const declared = [canonical, legacy].flatMap((property) => {
      const handle = property?.derived.cells?.[0];
      return handle === undefined ? [] : [handle];
    });
    if (malformedCanonical) {
      admit(node.path.length * 2 + 256);
      limitations.push(
        `phandle at ${node.path} is not a single cell; this node's reference identity remains unresolved.`,
      );
    }
    // Disagreeing declarations leave both values ambiguous rather than choosing one.
    const conflict = declared.length === 2 && declared[0] !== declared[1];
    if (conflict) {
      admit(node.path.length * 2 + 256);
      limitations.push(
        `phandle at ${node.path} conflicts with linux,phandle (0x${declared[0]?.toString(16)} vs 0x${declared[1]?.toString(16)}); references to either value are unresolved.`,
      );
    }
    const unambiguous = !malformedCanonical && !conflict;
    for (const handle of declared)
      if (handle !== 0 && handle !== 0xffffffff) {
        const existing = handles.get(handle);
        handles.set(
          handle,
          unambiguous && (existing === undefined || existing === node.path)
            ? node.path
            : null,
        );
      }
    const reg = prop(node.path, "reg");
    if (!reg || node.parent === null) continue;
    const count = (name: string, fallback: number) => {
      const p = prop(node.parent ?? "", name);
      return p === undefined ? fallback : p.derived.cells?.[0];
    };
    const addresses = count("#address-cells", 2),
      sizes = count("#size-cells", 1);
    if (
      addresses === undefined ||
      sizes === undefined ||
      addresses > 4 ||
      sizes > 4 ||
      addresses + sizes === 0 ||
      reg.bytes % ((addresses + sizes) * 4)
    ) {
      admit(node.path.length * 2 + 256);
      limitations.push(
        `reg at ${node.path} was not decoded: unsupported or malformed parent cell sizes or tuple length.`,
      );
      continue;
    }
    const readCells = (start: number, n: number) => {
      if (n === 0) return null;
      let value = 0n;
      for (let i = 0; i < n; i++)
        value = (value << 32n) | BigInt(u32(start + i * 4));
      return hex(value);
    };
    admit((reg.bytes / ((addresses + sizes) * 4)) * 160);
    reg.derived.reg = [];
    for (
      let p = reg.offset;
      p < reg.offset + reg.bytes;
      p += (addresses + sizes) * 4
    )
      reg.derived.reg.push({
        address: readCells(p, addresses),
        size: readCells(p + addresses * 4, sizes),
      });
  }
  const references: Devicetree["references"] = [];
  for (const node of nodes)
    for (const property of node.properties) {
      const phandle = property.derived.cells?.[0];
      if (
        ["interrupt-parent", "remote-endpoint", "msi-parent"].includes(
          property.name,
        ) &&
        phandle !== undefined
      ) {
        const target = handles.get(phandle) ?? null;
        // Shared path strings expand again in serialized Evidence for every edge.
        admit(
          256 +
            (node.path.length + property.name.length + (target?.length ?? 0)) *
              2,
        );
        references.push({
          source: node.path,
          property: property.name,
          phandle,
          target,
          confidence: "derived",
        });
      }
    }
  return {
    artifact,
    header,
    reservations,
    nodes,
    references,
    summary: {
      confidence: "derived",
      compatible: prop("/", "compatible")?.derived.strings ?? null,
      model: singleString("/", "model"),
      bootargs: singleString("/chosen", "bootargs"),
      stdout_path: singleString("/chosen", "stdout-path"),
      aliases: (byPath.get("/aliases")?.properties ?? []).map((p) => ({
        name: p.name,
        path: singleString("/aliases", p.name),
      })),
    },
    coverage: {
      status: "complete",
      examined_nodes: nodes.length,
      examined_properties: properties,
    },
    limitations,
  };
};
