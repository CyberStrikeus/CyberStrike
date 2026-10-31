import { readObjcPropertyList } from "./AppleObjcProperties.js";
import type { ObjcSwiftMetadata } from "../domain/native/objcSwiftMetadata.js";
import type { SwiftNominalReaders } from "./AppleSwiftNominalTypes.js";

/** Read protocol lists and absolute protocol method declarations with cycle-safe identities. */
export const createObjcProtocolReader = (input: {
  readers: Pick<
    SwiftNominalReaders,
    "u32" | "string" | "location" | "evidence" | "admit"
  > & {
    pointer(address: bigint): bigint;
    /** Plain 64-bit data, never a fixup. */
    u64(address: bigint): bigint;
    i32(address: bigint): number;
  };
  result: ObjcSwiftMetadata;
  failures: string[];
}) => {
  const { readers: read, result, failures } = input;
  const visited = new Set<bigint>();
  const name = (address: bigint) => read.string(read.pointer(address + 8n));
  const list = (address: bigint, onTruncated?: () => void): string[] => {
    if (address === 0n) return [];
    // `count` is plain uintptr_t data, not a pointer fixup.
    const count = read.u64(address);
    if (count > 20000n)
      throw new RangeError("Protocol list exceeds 20000 entries");
    const names: string[] = [];
    for (let index = 0n; index < count; index++) {
      if (!read.admit()) {
        onTruncated?.();
        break;
      }
      const protocol = read.pointer(address + 8n + index * 8n);
      names.push(name(protocol));
      record(protocol);
    }
    return names;
  };
  const methods = (
    address: bigint,
    required: boolean,
    instance: boolean,
    /** Entries skipped for an empty selector, reported by the declaring protocol. */
    emptySelectors: string[],
    onTruncated?: () => void,
  ) => {
    const output: ObjcSwiftMetadata["objc_protocols"][number]["methods"] = [];
    if (address === 0n) return output;
    const flags = read.u32(address),
      count = read.u32(address + 4n);
    const relative = (flags & 0x80000000) !== 0;
    const stride = flags & 0xfffc;
    if (stride !== (relative ? 12 : 24))
      throw new TypeError("Unsupported Objective-C protocol method entry size");
    for (let index = 0; index < count; index++) {
      if (!read.admit()) {
        onTruncated?.();
        break;
      }
      const entry = address + 8n + BigInt(index * stride);
      let selector = relative
        ? entry + BigInt(read.i32(entry))
        : read.pointer(entry);
      if (relative && (flags & 0x40000000) === 0)
        selector = read.pointer(selector);
      // One empty selector is reported on its own, so the protocol and its
      // other method declarations keep their decoded records.
      const selectorName = read.string(selector);
      if (selectorName.length === 0) {
        emptySelectors.push(
          `${required ? "required" : "optional"} ${instance ? "instance" : "class"} method ${String(index)} at 0x${entry.toString(16)} has an empty selector`,
        );
        continue;
      }
      output.push({
        selector: selectorName,
        method_type: instance ? "instance" : "class",
        address: null,
        is_required: required,
        is_optional: !required,
      });
    }
    return output;
  };
  const record = (address: bigint) => {
    if (address === 0n || visited.has(address) || !read.admit()) return;
    visited.add(address);
    try {
      const protocolSize = read.u32(address + 64n);
      if (protocolSize < 72)
        throw new RangeError("Truncated Objective-C protocol declaration");
      const protocolName = name(address);
      // Adopted protocols are independent declarations; decode them before
      // rejecting a parent whose own name is empty.
      let budgetTruncated = false;
      const onTruncated = () => {
        budgetTruncated = true;
      };
      const adopted = list(read.pointer(address + 16n), onTruncated);
      if (protocolName.length === 0)
        throw new TypeError("Objective-C protocol has an empty name");
      const skipped: string[] = [];
      const required = [
        ...methods(
          read.pointer(address + 24n),
          true,
          true,
          skipped,
          onTruncated,
        ),
        ...methods(
          read.pointer(address + 32n),
          true,
          false,
          skipped,
          onTruncated,
        ),
      ];
      const optional = [
        ...methods(
          read.pointer(address + 40n),
          false,
          true,
          skipped,
          onTruncated,
        ),
        ...methods(
          read.pointer(address + 48n),
          false,
          false,
          skipped,
          onTruncated,
        ),
      ];
      for (const message of skipped)
        failures.push(
          `Protocol 0x${address.toString(16)}: Objective-C protocol ${protocolName} ${message}`,
        );
      let properties: ObjcSwiftMetadata["objc_protocols"][number]["properties"] =
        [];
      const propertyReasons: string[] = [];
      try {
        const decoded = readObjcPropertyList(
          read,
          read.pointer(address + 56n),
          () => read.admit(),
          onTruncated,
        );
        properties = decoded.properties;
        for (const problem of decoded.issues)
          propertyReasons.push(problem.message);
        // Older protocol revisions end at size/flags. The later class-property
        // list has no class/instance discriminator in the public property shape.
        if (protocolSize >= 96 && read.pointer(address + 88n) !== 0n)
          propertyReasons.push("protocol class properties are not decoded");
      } catch (cause) {
        propertyReasons.push(
          cause instanceof Error ? cause.message : String(cause),
        );
      }
      for (const message of propertyReasons)
        failures.push(
          `Protocol 0x${address.toString(16)}: Objective-C protocol ${protocolName} properties: ${message}`,
        );
      const decodeReasons = [
        ...propertyReasons,
        ...(skipped.length === 0 ? [] : ["protocol_method_selector_empty"]),
        ...(budgetTruncated ? ["max_records_reached"] : []),
      ];
      result.objc_protocols.push({
        name: protocolName,
        methods: required,
        optional_methods: optional,
        properties,
      });
      result.objc_protocol_records.push({
        name: protocolName,
        adopted_protocols: adopted,
        methods: required,
        optional_methods: optional,
        location: read.location(address),
        decode:
          decodeReasons.length === 0
            ? { status: "decoded", reason: null }
            : { status: "partial", reason: decodeReasons.join("; ") },
        evidence: read.evidence(
          address,
          "Objective-C protocol declaration and encoded method lists; IMP fields are not handler targets",
        ),
      });
    } catch (cause) {
      failures.push(
        `Protocol 0x${address.toString(16)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };
  return { list, record };
};
