import type { z } from "zod";

import type { objcPropertySchema } from "../domain/native/objcSwiftMetadata.js";
import { issue, type DecodeIssue } from "./AppleDispatchDecodeFacts.js";

type ObjcProperty = z.infer<typeof objcPropertySchema>;

/** Byte readers needed to decode an Objective-C `property_list_t`. */
export interface ObjcPropertyReaders {
  u32(address: bigint): number;
  pointer(address: bigint): bigint;
  string(address: bigint): string;
}

/**
 * Decode one attribute string. An unfinished quoted or templated type leaves
 * later attributes ambiguous, so a missing `N` or `R` does not establish the
 * Objective-C defaults.
 */
const decodePropertyAttributes = (
  name: string,
  attributes: string,
): { readonly property: ObjcProperty; readonly complete: boolean } => {
  const { tokens, complete } =
    attributes.length === 0
      ? { tokens: [], complete: true }
      : splitAttributes(attributes);
  const typeAttributes = tokens.filter((token) => token[0] === "T");
  const typeAttribute =
    typeAttributes.length === 1 ? typeAttributes[0] : undefined;
  const typeEncoding =
    typeAttribute !== undefined && typeAttribute.length > 1
      ? typeAttribute.slice(1)
      : null;
  const value = (code: string): string | null =>
    tokens.find((token) => token[0] === code)?.slice(1) ?? null;
  const defaultsEstablished = typeEncoding !== null && complete;
  const property: ObjcProperty = {
    name,
    type_encoding: typeEncoding,
    attributes: tokens.map((token) => ({
      name: token.slice(0, 1),
      value: token.slice(1),
    })),
    atomicity: tokens.includes("N")
      ? "nonatomic"
      : defaultsEstablished
        ? "atomic"
        : null,
    is_readonly: tokens.includes("R")
      ? true
      : defaultsEstablished
        ? false
        : null,
    getter: value("G"),
    setter: value("S"),
  };
  return { property, complete };
};

/**
 * Split on separators outside quoted names and C++ template arguments in the
 * type attribute, and report whether those constructs are complete.
 */
const splitAttributes = (
  attributes: string,
): { readonly tokens: string[]; readonly complete: boolean } => {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  let templateDepth = 0;
  for (const character of attributes) {
    if (character === '"') quoted = !quoted;
    const inTypeAttribute = current.startsWith("T");
    if (!quoted && inTypeAttribute && character === "<") templateDepth += 1;
    else if (
      !quoted &&
      inTypeAttribute &&
      character === ">" &&
      templateDepth > 0
    )
      templateDepth -= 1;
    if (character === "," && !quoted && templateDepth === 0) {
      tokens.push(current);
      current = "";
    } else current += character;
  }
  tokens.push(current);
  return {
    tokens: tokens.filter((token) => token.length > 0),
    complete: !quoted && templateDepth === 0,
  };
};

/** One property-level decode problem, relative to the list's owner. */
interface PropertyListIssue {
  readonly code: "property_decode_failed" | "property_attributes_incomplete";
  readonly message: string;
  readonly location: string;
}

/**
 * Decode `property_list_t { entsize_and_flags, count, property_t[] }`. Each
 * entry is decoded on its own, so one malformed entry is reported without
 * discarding the properties decoded before or after it.
 */
export const readObjcPropertyList = (
  read: ObjcPropertyReaders,
  list: bigint,
  admit: () => boolean,
  onTruncated?: () => void,
): {
  readonly properties: ObjcProperty[];
  readonly issues: PropertyListIssue[];
} => {
  const properties: ObjcProperty[] = [];
  const issues: PropertyListIssue[] = [];
  if (list === 0n) return { properties, issues };
  const entrySize = read.u32(list) & ~3;
  const count = read.u32(list + 4n);
  if (entrySize !== 16)
    throw new TypeError(
      `Unsupported Objective-C property entry size ${entrySize}`,
    );
  for (let index = 0; index < count; index++) {
    if (!admit()) {
      onTruncated?.();
      break;
    }
    const entry = list + 8n + BigInt(index * entrySize);
    const location = `0x${entry.toString(16)}`;
    try {
      const name = read.string(read.pointer(entry));
      if (name.length === 0) throw new TypeError("the property name is empty");
      const decoded = decodePropertyAttributes(
        name,
        read.string(read.pointer(entry + 8n)),
      );
      properties.push(decoded.property);
      if (!decoded.complete)
        issues.push({
          code: "property_attributes_incomplete",
          message: `property ${name} has an incomplete quoted name or template argument in its type attribute, so atomicity and unestablished read-only state are unknown`,
          location,
        });
    } catch (cause: unknown) {
      issues.push({
        code: "property_decode_failed",
        message: `property ${String(index)} could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}`,
        location,
      });
    }
  }
  return { properties, issues };
};

/** Decode a property list, recording a failure for `owner` instead of throwing. */
export const readObjcPropertiesOf = (
  read: ObjcPropertyReaders,
  list: bigint,
  context: {
    readonly owner: string;
    readonly admit: () => boolean;
    readonly issues: DecodeIssue[];
    readonly location?: string;
    readonly onTruncated?: () => void;
  },
): ObjcProperty[] => {
  try {
    const { properties, issues } = readObjcPropertyList(
      read,
      list,
      context.admit,
      context.onTruncated,
    );
    for (const item of issues)
      context.issues.push(
        issue(
          "objc_properties_categories",
          item.code,
          `${context.owner}: ${item.message}`,
          item.location,
        ),
      );
    return properties;
  } catch (cause: unknown) {
    context.issues.push(
      issue(
        "objc_properties_categories",
        "property_decode_failed",
        `${context.owner}: ${cause instanceof Error ? cause.message : String(cause)}`,
        context.location,
      ),
    );
    return [];
  }
};
