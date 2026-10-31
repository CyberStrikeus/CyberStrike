import type {
  NativeMetadataEvidence,
  NativeMetadataLocation,
  ObjcSwiftMetadata,
} from "../domain/native/objcSwiftMetadata.js";
import { issue, type FacetDecodeFacts } from "./AppleDispatchDecodeFacts.js";
import {
  unresolvedSwiftRelativeReason,
  type SwiftRelativeField,
  type SwiftRelativeValue,
} from "./AppleSwiftDispatchFacets.js";
import { expectedSwiftMetadataReadFailure } from "./AppleSwiftMetadataReadFailure.js";

/** Byte readers shared with the validated Mach-O metadata boundary. */
export interface SwiftNominalReaders {
  u32(address: bigint): number;
  relative(address: bigint, kind: SwiftRelativeField): SwiftRelativeValue;
  string(address: bigint): string;
  location(address: bigint): NativeMetadataLocation;
  evidence(address: bigint, description: string): NativeMetadataEvidence[];
  executable(address: bigint): boolean;
  admit(): boolean;
}

/** A `__swift5_types` descriptor whose kind and own name were read. */
export interface SwiftNominalDescriptor {
  readonly record: bigint;
  readonly descriptor: bigint;
  readonly flags: number;
  readonly name: string;
  readonly context: SwiftContextFacts;
}

/** A `__swift5_types` record that may be a class whose name is unknown. */
export interface SwiftNominalRecordFailure {
  readonly record: bigint;
  readonly message: string;
}

/**
 * Receives each descriptor with its shared context facts, so a
 * consumer spends the record budget in record order rather than after every
 * declaration.
 */
export interface SwiftNominalVisitor {
  descriptor(descriptor: SwiftNominalDescriptor): void;
  failure(failure: SwiftNominalRecordFailure): void;
}

const FACET = "swift_declarations";
const CLASS = 16;
const STRUCT = 17;
const ENUM = 18;
const MODULE = 0;
const EXTENSION = 1;
const ANONYMOUS = 2;
const PROTOCOL = 3;
const GENERIC = 0x80;
const CLASS_IS_ACTOR = 0x80;
/** Swift nesting is shallow; a longer chain is malformed or cyclic. */
const MAXIMUM_CONTEXT_DEPTH = 32;
/** Same bound as one metadata name, so nesting cannot multiply name storage. */
const MAXIMUM_QUALIFIED_NAME_LENGTH = 4096;

const hex = (value: bigint) => `0x${value.toString(16)}`;

/**
 * Facts of one context. `depth` counts contexts up to and including its
 * module, so a cached result is valid wherever a walk reaches it.
 */
export interface SwiftContextFacts {
  readonly module: string | null;
  /** Dotted named path below the module; null when unresolved. */
  readonly path: string | null;
  readonly depth: number;
  readonly anonymous: boolean;
  readonly reason: string | null;
  /** The walk stopped at its own bound; the result depends on its start. */
  readonly walkLimited: boolean;
}

const unresolved = (
  reason: string,
  walkLimited = false,
): SwiftContextFacts => ({
  module: null,
  path: null,
  depth: 0,
  anonymous: false,
  reason,
  walkLimited,
});

const tooDeep = (): SwiftContextFacts =>
  unresolved(
    `Swift context parent chain exceeds ${MAXIMUM_CONTEXT_DEPTH} contexts or is cyclic`,
  );

/** One snapshot-scoped owner of nominal names and parent-context identity. */
export const createSwiftContextReader = (
  read: Pick<SwiftNominalReaders, "u32" | "relative" | "string">,
) => {
  const contexts = new Map<bigint, SwiftContextFacts>();
  const names = new Map<bigint, string>();

  const namedContext = (
    descriptor: bigint,
    field: "typeName" | "protocolName",
  ): string => {
    const known = names.get(descriptor);
    if (known !== undefined) return known;
    const value = read.relative(descriptor + 8n, field);
    if (value.kind !== "target")
      throw new RangeError(unresolvedSwiftRelativeReason(value, field));
    const name = read.string(value.target);
    if (name.length === 0)
      throw new RangeError(
        `Swift ${field === "protocolName" ? "protocol" : "type"} descriptor name is empty`,
      );
    names.set(descriptor, name);
    return name;
  };

  const parentOf = (context: bigint, walk: number): SwiftContextFacts => {
    const value = read.relative(context + 4n, "contextParent");
    if (value.kind === "target") return contextOf(value.target, walk + 1);
    return unresolved(
      value.kind === "null"
        ? "Swift context descriptor has no parent module"
        : unresolvedSwiftRelativeReason(value, "contextParent"),
    );
  };

  /** One level below `parent`, bounded in depth and qualified-name length. */
  const child = (
    parent: SwiftContextFacts,
    facts: Partial<SwiftContextFacts>,
  ): SwiftContextFacts => {
    if (parent.depth + 1 > MAXIMUM_CONTEXT_DEPTH)
      return { ...tooDeep(), walkLimited: parent.walkLimited };
    const next = {
      ...parent,
      depth: parent.reason === null ? parent.depth + 1 : 0,
      ...facts,
    };
    return next.path !== null &&
      next.path.length > MAXIMUM_QUALIFIED_NAME_LENGTH
      ? {
          ...next,
          path: null,
          reason:
            next.reason ??
            `Swift qualified type name exceeds ${MAXIMUM_QUALIFIED_NAME_LENGTH} characters`,
        }
      : next;
  };

  const readContext = (context: bigint, walk: number): SwiftContextFacts => {
    const kind = read.u32(context) & 31;
    switch (kind) {
      case MODULE: {
        const value = read.relative(context + 8n, "moduleName");
        if (value.kind !== "target")
          return unresolved(unresolvedSwiftRelativeReason(value, "moduleName"));
        const module = read.string(value.target);
        return module.length === 0
          ? unresolved("Swift module context name is empty")
          : {
              module,
              path: "",
              depth: 1,
              anonymous: false,
              reason: null,
              walkLimited: false,
            };
      }
      case PROTOCOL:
      case CLASS:
      case STRUCT:
      case ENUM: {
        const name = namedContext(
          context,
          kind === PROTOCOL ? "protocolName" : "typeName",
        );
        const parent = parentOf(context, walk);
        return child(parent, {
          path:
            parent.path === null
              ? null
              : parent.path === ""
                ? name
                : `${parent.path}.${name}`,
        });
      }
      case ANONYMOUS:
        return child(parentOf(context, walk), { anonymous: true });
      case EXTENSION: {
        // The extended type is a mangled name, often in another module, so
        // the declaring module is known but the qualified path is not.
        const parent = parentOf(context, walk);
        return child(parent, {
          path: null,
          reason:
            parent.reason ??
            "Swift type is declared in an extension whose extended type is not demangled",
        });
      }
      default:
        return unresolved(`Unsupported Swift context descriptor kind ${kind}`);
    }
  };

  const contextOf = (context: bigint, walk: number): SwiftContextFacts => {
    const known = contexts.get(context);
    if (known !== undefined) return known;
    // Bound recursion on cyclic or over-deep chains; this stop depends on
    // where the walk began, so neither it nor its descendants are cached.
    if (walk > MAXIMUM_CONTEXT_DEPTH)
      return { ...tooDeep(), walkLimited: true };
    let facts: SwiftContextFacts;
    try {
      facts = readContext(context, walk);
    } catch (cause) {
      const reason = expectedSwiftMetadataReadFailure(cause);
      if (reason === null) throw cause;
      facts = unresolved(reason);
    }
    if (!facts.walkLimited) contexts.set(context, facts);
    return facts;
  };

  return {
    typeName: (descriptor: bigint) => namedContext(descriptor, "typeName"),
    protocolName: (descriptor: bigint) =>
      namedContext(descriptor, "protocolName"),
    contextOf: (descriptor: bigint) => contextOf(descriptor, 0),
  };
};
export type SwiftContextReader = ReturnType<typeof createSwiftContextReader>;

/**
 * Decode `__swift5_types` nominal type descriptors into `swift_decls`.
 * Each context is read once, so shared parents add one relative-pointer
 * record regardless of how many types they contain.
 */
export const decodeSwiftNominalTypes = (input: {
  readers: SwiftNominalReaders;
  entries: readonly bigint[];
  result: ObjcSwiftMetadata;
  visitor: SwiftNominalVisitor;
  contextReader: SwiftContextReader;
}): FacetDecodeFacts => {
  const { readers: read, result, visitor } = input;
  const issues = [] as ReturnType<typeof issue>[];
  const { typeName, contextOf } = input.contextReader;
  let examined = 0;
  let decoded = 0;

  const accessorOf = (
    descriptor: bigint,
  ): { address: string | null; reason: string | null } => {
    try {
      const value = read.relative(descriptor + 12n, "typeAccessFunction");
      if (value.kind === "null") return { address: null, reason: null };
      if (value.kind !== "target")
        return {
          address: null,
          reason: unresolvedSwiftRelativeReason(value, "typeAccessFunction"),
        };
      return read.executable(value.target)
        ? { address: hex(value.target), reason: null }
        : {
            address: null,
            reason: `Swift metadata accessor ${hex(value.target)} is not in executable mapped code`,
          };
    } catch (cause) {
      const reason = expectedSwiftMetadataReadFailure(cause);
      if (reason === null) throw cause;
      return { address: null, reason };
    }
  };

  for (const record of input.entries) {
    if (!read.admit()) {
      issues.push(
        issue(
          FACET,
          "record_budget_exhausted",
          "max_records_reached",
          hex(record),
        ),
      );
      break;
    }
    examined++;
    let descriptor: bigint;
    // Unknown until read; an unread kind may be a class.
    let kind: number | null = null;
    let flags: number;
    let name: string;
    try {
      const value = read.relative(record, "typeMetadataRecord");
      if (value.kind !== "target")
        throw new RangeError(
          unresolvedSwiftRelativeReason(value, "typeMetadataRecord"),
        );
      descriptor = value.target;
      flags = read.u32(descriptor);
      kind = flags & 31;
      if (kind !== CLASS && kind !== STRUCT && kind !== ENUM) {
        issues.push(
          issue(
            FACET,
            "unsupported_type_descriptor_kind",
            `Unsupported Swift type descriptor kind ${kind}`,
            hex(record),
          ),
        );
        continue;
      }
      name = typeName(descriptor);
    } catch (cause) {
      const message = expectedSwiftMetadataReadFailure(cause);
      if (message === null) throw cause;
      if (kind === null || kind === CLASS) visitor.failure({ record, message });
      issues.push(issue(FACET, "type_decode_failed", message, hex(record)));
      continue;
    }
    const context = contextOf(descriptor);
    visitor.descriptor({ record, descriptor, flags, name, context });
    const accessor = accessorOf(descriptor);
    const reason = context.reason ?? accessor.reason;
    result.swift_decls.push({
      kind:
        kind === STRUCT
          ? "struct"
          : kind === ENUM
            ? "enum"
            : ((flags >>> 16) & CLASS_IS_ACTOR) !== 0
              ? "actor"
              : "class",
      name,
      qualified_name:
        context.path === null || context.path === "" ? null : context.path,
      module: context.module,
      generic: (flags & GENERIC) !== 0,
      anonymous_context: context.anonymous,
      accessor_address: accessor.address,
      location: read.location(descriptor),
      decode:
        reason === null
          ? { status: "decoded", reason: null }
          : { status: "partial", reason },
      evidence: read.evidence(
        record,
        "Swift __swift5_types record of the nominal type descriptor at location",
      ),
    });
    if (reason === null) decoded++;
    else
      issues.push(
        issue(FACET, "type_context_unresolved", reason, hex(descriptor)),
      );
  }
  return {
    facet: FACET,
    examined,
    decoded,
    exhaustive: issues.length === 0,
    issues,
  };
};
