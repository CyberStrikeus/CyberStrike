import { Il2cppBinaryFormatFailure } from "./Il2cppBinaryFormat.js";
import {
  readSlot,
  readUInt32,
  hasPointerArrayCoverage,
  type NativeImage,
} from "./Il2cppBinaryImage.js";
import type {
  Il2cppMetadataDecoded,
  Il2cppMetadataLinkFacts,
} from "./Il2cppMetadataFile.js";

/** Il2CppType's type enum: bits 16-23 of the word after its 8-byte data. */
export const il2cppTypeKind = (attributes: number): number =>
  (attributes >>> 16) & 0xff;
/** Largest Il2CppTypeEnum value read as a type kind (IL2CPP_TYPE_MVAR). */
export const IL2CPP_TYPE_KIND_MAX = 0x1e;
/** Class and value-type kinds, whose data is a TypeDefinitionIndex. */
export const isDefinitionTypeKind = (kind: number): boolean =>
  kind === 0x11 || kind === 0x12;

const PRIMITIVES = new Map([
  [0x01, "void"],
  [0x02, "bool"],
  [0x03, "char"],
  [0x04, "sbyte"],
  [0x05, "byte"],
  [0x06, "short"],
  [0x07, "ushort"],
  [0x08, "int"],
  [0x09, "uint"],
  [0x0a, "long"],
  [0x0b, "ulong"],
  [0x0c, "float"],
  [0x0d, "double"],
  [0x0e, "string"],
  [0x16, "System.TypedReference"],
  [0x18, "nint"],
  [0x19, "nuint"],
  [0x1c, "object"],
]);

// Il2CppDumper's GetTypeName primitive names differ from the C#-like ones.
const DUMPER_PRIMITIVES = new Map([
  ...PRIMITIVES,
  [0x16, "TypedReference"],
  [0x18, "IntPtr"],
  [0x19, "UIntPtr"],
]);

// Cached rendered text has its own workspace bound; the report owner separately
// charges each returned occurrence and JSON expansion. No live-state cache.
const TYPE_TEXT_BYTES = 64 * 1024 * 1024;
const TYPE_DEPTH = 64;

type Text = Generator<void, string>;

/** How one naming convention renders definitions; the graph walk is shared. */
interface TypeStyle {
  readonly primitives: ReadonlyMap<number, string>;
  /** Byref mark bit, or null when the convention never marks byref. */
  readonly byrefBit: number | null;
  /** A class or value type definition by TypeDefinitionIndex. */
  readonly definition: (index: number) => Text;
  /** An Il2CppGenericClass with its instance arguments. */
  readonly genericClass: (data: bigint, depth: number) => Text;
}

/**
 * One snapshot's type-graph walk: cooperative yields, cycle and depth guards,
 * and a UTF-8 workspace reserved before every expansion or join.
 */
const createTypeRenderer = (
  image: NativeImage,
  facts: Il2cppMetadataLinkFacts,
  beforeText: ((bytes: number) => void) | undefined,
  style: (tools: RenderTools) => TypeStyle,
) => {
  const fail = (message: string): never => {
    throw new Il2cppBinaryFormatFailure("invalid-type", message);
  };
  const unresolved = (address: bigint, label: string): never => {
    throw new Il2cppBinaryFormatFailure(
      "unsupported-pointer-encoding",
      `${label} at 0x${address.toString(16)} is loader-unresolved; its stored bytes are not a resolved type value`,
    );
  };
  const pointer = (address: bigint, label: string): bigint => {
    const value = readSlot(image, address);
    if (value === "unknown") return unresolved(address, label);
    return (
      value ?? fail(`${label} at 0x${address.toString(16)} is not file mapped`)
    );
  };
  const u32 = (address: bigint, label: string): number => {
    const value = readUInt32(image, address);
    if (value === "unknown") return unresolved(address, label);
    return (
      value ?? fail(`${label} at 0x${address.toString(16)} is not file mapped`)
    );
  };
  let cachedBytes = 0;
  let work = 0;
  const guard = (bytes: number) => {
    if (bytes > TYPE_TEXT_BYTES - cachedBytes)
      throw new Il2cppBinaryFormatFailure(
        "native-type-text-capacity",
        `rendered type text workspace exceeds ${TYPE_TEXT_BYTES} UTF-8 bytes`,
      );
    beforeText?.(bytes);
  };
  const join = (parts: readonly string[], separator = "") => {
    let bytes = Math.max(parts.length - 1, 0) * Buffer.byteLength(separator);
    for (const part of parts) {
      bytes += Buffer.byteLength(part);
      guard(bytes);
    }
    return parts.join(separator);
  };
  const tick = () => ++work % 256 === 0;
  const tools = { fail, pointer, u32, guard, join, tick };
  const rules = style(tools);
  const byAddress = new Map<bigint, string>();
  const active = new Set<bigint>();
  function* name(address: bigint, depth: number): Text {
    const cached = byAddress.get(address);
    if (cached !== undefined) return cached;
    if (active.has(address))
      fail(`cyclic Il2CppType at 0x${address.toString(16)}`);
    if (depth > TYPE_DEPTH)
      throw new Il2cppBinaryFormatFailure(
        "type-nesting-capacity",
        `type rendering exceeds ${TYPE_DEPTH} nested frames`,
      );
    active.add(address);
    try {
      if (tick()) yield;
      const data = pointer(address, "Il2CppType data");
      const bits = u32(address + 8n, "Il2CppType attributes");
      const kind = il2cppTypeKind(bits);
      const index = Number(BigInt.asIntN(32, data & 0xffffffffn));
      let result: string;
      const primitive = rules.primitives.get(kind);
      if (primitive !== undefined) result = primitive;
      else if (isDefinitionTypeKind(kind))
        result = yield* rules.definition(index);
      else if (kind === 0x0f || kind === 0x1d)
        result = join([
          yield* name(data, depth + 1),
          kind === 0x0f ? "*" : "[]",
        ]);
      else if (kind === 0x14) {
        const rank = u32(data + 8n, "Il2CppArrayType rank") & 0xff;
        if (rank === 0) fail("array rank is zero");
        result = join([
          yield* name(pointer(data, "array element"), depth + 1),
          rank === 1 ? "[*]" : `[${",".repeat(rank - 1)}]`,
        ]);
      } else if (kind === 0x13 || kind === 0x1e)
        result =
          facts.genericParameterName(index) ??
          fail(`generic parameter ${index} is out of range`);
      else if (kind === 0x15) result = yield* rules.genericClass(data, depth);
      else
        throw new Il2cppBinaryFormatFailure(
          "unsupported-type-kind",
          `type kind 0x${kind.toString(16)} is not rendered`,
        );
      if (rules.byrefBit !== null && ((bits >>> rules.byrefBit) & 1) === 1)
        result = join([result, "&"]);
      const bytes = Buffer.byteLength(result);
      guard(bytes);
      cachedBytes += bytes;
      byAddress.set(address, result);
      return result;
    } finally {
      active.delete(address);
    }
  }
  /** Il2CppGenericInst argument names, reserved before each one is kept. */
  function* instanceArgumentList(
    instance: bigint,
    depth: number,
  ): Generator<void, string[]> {
    const count = u32(instance, "generic argument count");
    const argv = pointer(instance + 8n, "generic arguments");
    guard(Math.max(count - 1, 0) * 2);
    // The array may span adjacent loader ranges; each slot is read on its own.
    if (!hasPointerArrayCoverage(image, argv, count))
      fail("generic argument array is not file mapped");
    const args: string[] = [];
    let bytes = Math.max(count - 1, 0) * 2;
    for (let slot = 0; slot < count; slot++) {
      if (tick()) yield;
      const argument = yield* name(
        pointer(argv + BigInt(slot * 8), "generic argument"),
        depth + 1,
      );
      bytes += Buffer.byteLength(argument);
      guard(bytes);
      args.push(argument);
    }
    return args;
  }
  /** `<A, B>` for one Il2CppGenericInst, reserved before each argument joins. */
  function* instanceArguments(instance: bigint, depth: number): Text {
    const args = yield* instanceArgumentList(instance, depth);
    return join(["<", join(args, ", "), ">"]);
  }
  return { name, instanceArgumentList, instanceArguments, tools };
};

type RenderTools = {
  readonly fail: (message: string) => never;
  readonly pointer: (address: bigint, label: string) => bigint;
  readonly u32: (address: bigint, label: string) => number;
  readonly guard: (bytes: number) => void;
  readonly join: (parts: readonly string[], separator?: string) => string;
  /** True on every 256th unit of work, when the caller yields. */
  readonly tick: () => boolean;
};

/** TypeDefinitionIndex of an Il2CppGenericClass's class or value type definition. */
const genericClassDefinition = (
  { fail, pointer, u32 }: RenderTools,
  data: bigint,
  version: number,
): number => {
  if (version < 27) return u32(data, "generic class definition");
  const definitionType = pointer(data, "generic class type");
  const definitionData = pointer(definitionType, "generic class definition");
  const definitionKind =
    (u32(definitionType + 8n, "generic class type attributes") >>> 16) & 0xff;
  if (definitionKind !== 0x11 && definitionKind !== 0x12)
    fail("generic class type is not a class or value type definition");
  return Number(BigInt.asIntN(32, definitionData & 0xffff_ffffn));
};

/** Enclosing types outermost first, with the namespace of the outermost. */
function* declaringChain(
  metadata: Il2cppMetadataDecoded,
  { fail, tick }: RenderTools,
  index: number,
): Generator<void, { parts: string[]; namespace: string }> {
  const seen = new Set<number>();
  const parts: string[] = [];
  let namespace = "";
  for (let at = index; at !== -1;) {
    if (seen.has(at)) fail(`cyclic declaring type at ${at}`);
    if (tick()) yield;
    seen.add(at);
    const type =
      metadata.types[at] ?? fail(`type definition ${at} is out of range`);
    parts.push(type.name);
    namespace = type.namespace;
    at = type.declaring_type;
  }
  return { parts: parts.reverse(), namespace };
}

/** Nested generic definitions take their own slice of the arguments. */
function* genericDefinitionName(
  metadata: Il2cppMetadataDecoded,
  facts: Il2cppMetadataLinkFacts,
  { fail, join, tick }: RenderTools,
  index: number,
  args: readonly string[],
): Text {
  if (!Number.isInteger(index) || index < 0 || index >= metadata.types.length)
    fail(`type definition ${index} is out of range`);
  const chain: number[] = [];
  const seen = new Set<number>();
  for (let at = index; at !== -1;) {
    if (seen.has(at)) fail(`cyclic declaring type at ${at}`);
    if (tick()) yield;
    const type = metadata.types[at];
    if (type === undefined)
      return fail(`type definition ${at} is out of range`);
    seen.add(at);
    chain.push(at);
    at = type.declaring_type;
  }

  let previousArgumentCount = 0;
  const parts: string[] = [];
  for (const typeIndex of chain.reverse()) {
    if (tick()) yield;
    const type = metadata.types[typeIndex]!;
    const argumentCount = facts.genericTypeArgumentCounts[typeIndex];
    if (
      argumentCount === undefined ||
      argumentCount < previousArgumentCount ||
      argumentCount > args.length
    )
      return fail(
        `generic argument count does not match nested type definition ${typeIndex}`,
      );
    const componentArguments = args.slice(previousArgumentCount, argumentCount);
    previousArgumentCount = argumentCount;
    const name = type.name.replace(/`\d+$/u, "");
    parts.push(
      componentArguments.length === 0
        ? name
        : join([name, "<", join(componentArguments, ", "), ">"]),
    );
  }
  if (previousArgumentCount !== args.length)
    fail(
      `generic argument count ${args.length} does not match nested type definition ${index}`,
    );
  const name = join(parts, "+");
  const namespace = metadata.types[chain[0]!]!.namespace;
  return namespace === "" ? name : join([namespace, name], ".");
}

/** Render one snapshot's type graph cooperatively without allocating unchecked expansions. */
export const createTypeNamer = (
  image: NativeImage,
  metadata: Il2cppMetadataDecoded,
  facts: Il2cppMetadataLinkFacts,
  version: number,
  beforeText?: (bytes: number) => void,
) => {
  const renderer = createTypeRenderer(image, facts, beforeText, (tools) => {
    function* definitionName(index: number): Text {
      const { parts, namespace } = yield* declaringChain(
        metadata,
        tools,
        index,
      );
      const name = tools.join(parts, "+");
      return namespace === "" ? name : tools.join([namespace, name], ".");
    }
    return {
      primitives: PRIMITIVES,
      byrefBit: version >= 29 ? 29 : 30,
      definition: definitionName,
      *genericClass(data, depth) {
        const definition = genericClassDefinition(tools, data, version);
        const args = yield* renderer.instanceArgumentList(
          tools.pointer(data + 8n, "generic class instance"),
          depth,
        );
        return yield* genericDefinitionName(
          metadata,
          facts,
          tools,
          definition,
          args,
        );
      },
    };
  });
  return renderer.name;
};

/**
 * Render generic method instance names the way Il2CppDumper's
 * GetMethodSpecName does: namespaces only on the declaring type, nested types
 * joined with '.', the backtick arity cut at the first '`', no byref mark and
 * IntPtr/UIntPtr/TypedReference for those primitives. The byref bit is never
 * read, so the 27.0 to 27.2 byref placement does not matter here.
 */
export const createMethodSpecNamer = (
  image: NativeImage,
  metadata: Il2cppMetadataDecoded,
  facts: Il2cppMetadataLinkFacts,
  version: number,
  beforeText?: (bytes: number) => void,
) => {
  const cut = (text: string) => {
    const at = text.indexOf("`");
    return at === -1 ? text : text.slice(0, at);
  };
  /** Enclosing types joined with '.', with the namespace only when asked. */
  function* nestedName(
    tools: RenderTools,
    index: number,
    namespaces: boolean,
    keepOwnArity = false,
  ): Text {
    const { parts, namespace } = yield* declaringChain(metadata, tools, index);
    const name = tools.join(
      parts.map((part, at) =>
        keepOwnArity && at === parts.length - 1 ? part : cut(part),
      ),
      ".",
    );
    return namespaces && namespace !== ""
      ? tools.join([namespace, name], ".")
      : name;
  }
  const containerIndex = (tools: RenderTools, index: number) =>
    facts.typeGenericContainer(index) ??
    tools.fail(
      `type definition ${index} has no decoded generic container index`,
    );
  function* containerParameters(tools: RenderTools, index: number): Text {
    const container = containerIndex(tools, index);
    if (container === -1) return "";
    const entry =
      facts.genericContainer(container) ??
      tools.fail(`generic container ${container} is out of range`);
    if (entry.count <= 0)
      tools.fail(
        `generic container ${container} has ${entry.count} parameters`,
      );
    const names: string[] = [];
    let bytes = (entry.count - 1) * 2;
    for (let slot = 0; slot < entry.count; slot++) {
      if (tools.tick()) yield;
      const parameter =
        facts.genericParameterName(entry.parameterStart + slot) ??
        tools.fail(
          `generic parameter ${entry.parameterStart + slot} is out of range`,
        );
      bytes += Buffer.byteLength(parameter);
      tools.guard(bytes);
      names.push(parameter);
    }
    return tools.join(["<", tools.join(names, ", "), ">"]);
  }
  const renderer = createTypeRenderer(image, facts, beforeText, (tools) => ({
    primitives: DUMPER_PRIMITIVES,
    byrefBit: null,
    *definition(index) {
      return tools.join([
        yield* nestedName(tools, index, false),
        yield* containerParameters(tools, index),
      ]);
    },
    *genericClass(data, depth) {
      const owner = genericClassDefinition(tools, data, version);
      return tools.join([
        yield* nestedName(tools, owner, false),
        yield* renderer.instanceArguments(
          tools.pointer(data + 8n, "generic class instance"),
          depth,
        ),
      ]);
    },
  }));
  const { tools } = renderer;
  /**
   * `Namespace.Type<ClassArgs>$$Method<MethodArgs>`: the declaring type keeps
   * its arity suffix unless it is a generic definition.
   */
  return function* methodSpecName(
    method: number,
    classInstance: bigint | null,
    methodInstance: bigint | null,
  ): Text {
    const definition =
      metadata.methods[method] ??
      tools.fail(`method ${method} is out of range`);
    const owner = definition.declaring_type;
    const generic = containerIndex(tools, owner) !== -1;
    return tools.join([
      yield* nestedName(tools, owner, true, !generic),
      classInstance === null
        ? ""
        : yield* renderer.instanceArguments(classInstance, 0),
      "$$",
      definition.name,
      methodInstance === null
        ? ""
        : yield* renderer.instanceArguments(methodInstance, 0),
    ]);
  };
};
