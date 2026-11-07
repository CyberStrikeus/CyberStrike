import * as t from "@babel/types";
import { runtimeFunctionParameters } from "./javascriptAstValues.js";
import { javascriptBootstrapAt } from "./javascriptBootstrap.js";
import {
  resolveSemanticBindingState,
  type JavaScriptSemanticAnalysisState,
  type JavaScriptBindingIndex,
} from "./javascriptSemanticState.js";
import { semanticFactoryLoaderMemberAt } from "./javascriptSemanticRequireOrigin.js";

import { traverseJavaScriptAst } from "./javascriptSemanticTraversal.js";

import { javascriptBundlerFactoryRoles } from "./javascriptBundlerFactoryRoles.js";
import {
  collectJavaScriptExports,
  fingerprintJavaScriptAst,
} from "./javascriptAstFingerprint.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { addFindingOnce } from "./javascriptStaticAnalysisFindings.js";
import {
  argumentValue,
  calleeName,
  chunkRuntime,
  moduleFactory,
  modulePropertyName,
  range,
  registrationKey,
  sha256Text,
  sourceSlice,
  staticArrayValues,
} from "./javascriptStaticAnalysisHelpers.js";
import type { JavaScriptAnalysisAccumulator as AnalysisAccumulator } from "./javascriptStaticAnalysisState.js";
import type {
  JavaScriptBundlerModule,
  JavaScriptBundlerRegistration,
} from "./javascriptStaticAnalysisTypes.js";
import { JAVASCRIPT_AST_FINGERPRINT_ALGORITHM } from "./javascriptStaticAnalysisTypes.js";

/** Inspect a bundler registration call and recover its module table. */
export const inspectBundlerRegistration = (
  source: string,
  call: t.CallExpression,
  accumulator: AnalysisAccumulator,
  bindings: JavaScriptSemanticAnalysisState,
): void => {
  const runtime = chunkRuntime(call);
  const entry = call.arguments[0];
  if (runtime === undefined || !t.isArrayExpression(entry)) return;
  const chunkIds = entry.elements[0];
  const table = entry.elements[1];
  const runtimeValue = runtimeMetadata(
    entry.elements[2],
    bindings,
    accumulator,
  );
  if (!t.isArrayExpression(chunkIds) || !t.isObjectExpression(table)) return;
  const recovered = recoverBundlerModules(source, table, accumulator, {
    runtime,
    bindings,
  });
  const chunkKeys = staticArrayValues(chunkIds);
  accumulator.unknownFindings += chunkKeys.unknown;
  accumulator.unknownFindings +=
    runtimeValue.unknownEntryModuleKeys +
    runtimeValue.unknownAsyncChunkKeys +
    recovered.unknownAsyncChunkKeys;
  const asyncChunkKeys = uniqueValues([
    ...runtimeValue.asyncChunkKeys,
    ...recovered.asyncChunkKeys,
  ]);
  const registration: JavaScriptBundlerRegistration = {
    bundler: runtime.toLowerCase().includes("rspack")
      ? ("rspack" as const)
      : ("webpack" as const),
    runtime,
    chunk_keys: chunkKeys.values,
    unknown_chunk_keys: chunkKeys.unknown,
    runtime_require_name: runtimeValue.requireName,
    // A name appearing in the source does not establish cache behavior or
    // associate it with this registration. Until the analyzed runtime body
    // proves cache reads and writes, preserve the honest unknown state.
    runtime_module_cache_status: "not-observed",
    entry_module_keys: runtimeValue.entryModuleKeys,
    unknown_entry_module_keys: runtimeValue.unknownEntryModuleKeys,
    async_chunk_keys: asyncChunkKeys.values,
    unknown_async_chunk_keys:
      runtimeValue.unknownAsyncChunkKeys + recovered.unknownAsyncChunkKeys,
    modules: recovered.modules.sort((left, right) =>
      compareUnicodeCodePoints(left.module_key, right.module_key),
    ),
    location: range(call),
  };
  addFindingOnce(
    accumulator,
    `registration\0${registrationKey(registration)}`,
    () => accumulator.registrations.push(registration),
  );
};

/** Recover standalone Webpack tables whose factories are called by a local loader. */
export const inspectBundlerBootstrap = (
  source: string,
  call: t.CallExpression,
  accumulator: AnalysisAccumulator,
  bindings: JavaScriptSemanticAnalysisState,
): void => {
  const bootstrap = javascriptBootstrapAt(call, bindings);
  if (bootstrap === undefined) return;
  const runtime = `webpack-bootstrap@${String(call.start ?? 0)}`;
  const recovered = recoverBundlerModules(
    source,
    bootstrap.table,
    accumulator,
    { runtime, bindings },
  );
  const entries: string[] = [];
  let unknownEntries = 0;
  traverseJavaScriptAst(bootstrap.body, {
    enter: (node, _parent, ancestors) => {
      if (
        !t.isCallExpression(node) ||
        ancestors().some((node) => t.isFunction(node)) ||
        !t.isIdentifier(node.callee) ||
        resolveSemanticBindingState(bindings, node.callee, node.callee.name)
          ?.bindingId !== bootstrap.loaderBindingId
      )
        return;
      const value = argumentValue(node.arguments[0]);
      if (value === undefined) unknownEntries++;
      else entries.push(value);
    },
  });
  const registration: JavaScriptBundlerRegistration = {
    bundler: "webpack",
    runtime,
    chunk_keys: [`bootstrap@${String(call.start ?? 0)}`],
    unknown_chunk_keys: 0,
    runtime_require_name: bootstrap.loaderName,
    runtime_module_cache_status: "not-observed",
    entry_module_keys: uniqueValues(entries).values,
    unknown_entry_module_keys: unknownEntries,
    async_chunk_keys: recovered.asyncChunkKeys,
    unknown_async_chunk_keys: recovered.unknownAsyncChunkKeys,
    modules: recovered.modules.sort((left, right) =>
      compareUnicodeCodePoints(left.module_key, right.module_key),
    ),
    location: range(call),
  };
  accumulator.unknownFindings +=
    unknownEntries + recovered.unknownAsyncChunkKeys;
  addFindingOnce(
    accumulator,
    `registration\0${registrationKey(registration)}`,
    () => accumulator.registrations.push(registration),
  );
};

/** Inspect esbuild helper wrappers and recover their literal module tables. */
export const inspectEsbuildWrapper = (
  source: string,
  call: t.CallExpression,
  accumulator: AnalysisAccumulator,
  bindings: JavaScriptSemanticAnalysisState,
): void => {
  const name = calleeName(call.callee);
  const wrapperKind =
    name === "__commonJS" || name.endsWith(".__commonJS")
      ? "commonjs"
      : name === "__esm" || name.endsWith(".__esm")
        ? "esm"
        : null;
  const table = call.arguments[0];
  if (wrapperKind === null || !t.isObjectExpression(table)) return;
  const runtime = `esbuild-${wrapperKind}`;
  const recovered = recoverBundlerModules(source, table, accumulator, {
    runtime,
    bindings,
  });
  if (recovered.modules.length === 0) return;
  accumulator.unknownFindings += recovered.unknownAsyncChunkKeys;
  const registration: JavaScriptBundlerRegistration = {
    bundler: "esbuild",
    runtime,
    chunk_keys: [`${wrapperKind}@${String(call.start ?? 0)}`],
    unknown_chunk_keys: 0,
    runtime_require_name: null,
    runtime_module_cache_status: "not-observed",
    entry_module_keys: [],
    unknown_entry_module_keys: 0,
    async_chunk_keys: recovered.asyncChunkKeys,
    unknown_async_chunk_keys: recovered.unknownAsyncChunkKeys,
    modules: recovered.modules.sort((left, right) =>
      compareUnicodeCodePoints(left.module_key, right.module_key),
    ),
    location: range(call),
  };
  addFindingOnce(
    accumulator,
    `registration\0${registrationKey(registration)}`,
    () => accumulator.registrations.push(registration),
  );
};

interface RecoveredBundlerModules {
  readonly modules: JavaScriptBundlerModule[];
  readonly asyncChunkKeys: readonly string[];
  readonly unknownAsyncChunkKeys: number;
}

interface BundlerRecoveryContext {
  readonly runtime: string;
  readonly bindings: JavaScriptSemanticAnalysisState;
}

const recoverBundlerModules = (
  source: string,
  table: t.ObjectExpression,
  accumulator: AnalysisAccumulator,
  context: BundlerRecoveryContext,
): RecoveredBundlerModules => {
  const modules: JavaScriptBundlerModule[] = [];
  const asyncChunkKeys: string[] = [];
  let unknownAsyncChunkKeys = 0;
  for (const property of table.properties) {
    const recovered = recoverBundlerModule(
      source,
      property,
      accumulator,
      context,
    );
    if (recovered === null) continue;
    modules.push(recovered.module);
    asyncChunkKeys.push(...recovered.asyncChunkKeys);
    unknownAsyncChunkKeys += recovered.unknownAsyncChunkKeys;
  }
  return {
    modules,
    asyncChunkKeys,
    unknownAsyncChunkKeys,
  };
};

const recoverBundlerModule = (
  source: string,
  property: t.ObjectMethod | t.ObjectProperty | t.SpreadElement,
  accumulator: AnalysisAccumulator,
  context: BundlerRecoveryContext,
): {
  readonly module: JavaScriptBundlerModule;
  readonly asyncChunkKeys: readonly string[];
  readonly unknownAsyncChunkKeys: number;
} | null => {
  const { runtime, bindings } = context;
  const factory = moduleFactory(property);
  if (factory === undefined) return null;
  const key = modulePropertyName(property);
  if (key.startsWith("[computed@") || key.startsWith("[unknown@"))
    accumulator.unknownFindings += 1;
  const fingerprint = fingerprintJavaScriptAst(factory);
  const roles = javascriptBundlerFactoryRoles(factory, runtime);
  // An inexact role pattern leaves this module's export list incomplete.
  if (!roles.exact) accumulator.unknownFindings += 1;
  // Registration is inspected before its factories, so the source traversal
  // skips these never-run defaults when it reaches them.
  for (const unused of roles.unusedDefaults)
    accumulator.unusedFactoryDefaults.add(unused);
  const exports: string[] = [];
  accumulator.pendingBundlerExports.push({ factory, roles, exports });
  const loader = roles.loader;
  const requireName = loader?.name ?? null;
  const requireBindingId =
    loader === undefined
      ? null
      : (resolveSemanticBindingState(bindings, loader, loader.name)
          ?.bindingId ?? null);
  if (requireBindingId !== null)
    accumulator.factoryRequireBindingIds.add(requireBindingId);
  const asyncChunks = collectBundlerAsyncChunkKeys(
    factory,
    requireBindingId,
    bindings,
    roles.unusedDefaults,
  );
  if (typeof factory.start === "number" && typeof factory.end === "number") {
    const moduleRange = {
      start: factory.start,
      end: factory.end,
      key,
      runtime,
      requireName,
    };
    accumulator.moduleRangeIndex.add(moduleRange);
  }
  return {
    module: {
      module_key: key,
      factory_require_name: requireName,
      source_sha256: sha256Text(sourceSlice(source, factory)),
      structural_fingerprint_sha256: fingerprint,
      structural_fingerprint_algorithm: JAVASCRIPT_AST_FINGERPRINT_ALGORITHM,
      exports,
      location: range(factory),
    },
    asyncChunkKeys: asyncChunks.values,
    unknownAsyncChunkKeys: asyncChunks.unknown,
  };
};

interface RuntimeMetadata {
  readonly requireName: string | null;
  readonly entryModuleKeys: readonly string[];
  readonly unknownEntryModuleKeys: number;
  readonly asyncChunkKeys: readonly string[];
  readonly unknownAsyncChunkKeys: number;
}

interface StaticValues {
  readonly values: readonly string[];
  readonly unknown: number;
}

type BundlerFunction =
  | t.FunctionExpression
  | t.ArrowFunctionExpression
  | t.ObjectMethod;

const runtimeMetadata = (
  node: t.Node | null | undefined,
  bindings: JavaScriptSemanticAnalysisState,
  accumulator: AnalysisAccumulator,
): RuntimeMetadata => {
  if (!isBundlerFunction(node))
    return {
      requireName: null,
      entryModuleKeys: [],
      unknownEntryModuleKeys: node === null || node === undefined ? 0 : 1,
      asyncChunkKeys: [],
      unknownAsyncChunkKeys: 0,
    };
  const parameter = runtimeFunctionParameters(node)[0];
  const requireName = t.isIdentifier(parameter) ? parameter.name : null;
  const requireBindingId = t.isIdentifier(parameter)
    ? (resolveSemanticBindingState(bindings, parameter, parameter.name)
        ?.bindingId ?? null)
    : null;
  if (requireBindingId !== null)
    accumulator.factoryRequireBindingIds.add(requireBindingId);
  if (requireName === null)
    return {
      requireName,
      entryModuleKeys: [],
      unknownEntryModuleKeys: 1,
      asyncChunkKeys: [],
      unknownAsyncChunkKeys: 0,
    };
  const entries = collectBundlerCallArgumentValues(
    node,
    requireBindingId,
    bindings,
    null,
  );
  const asyncChunks = collectBundlerCallArgumentValues(
    node,
    requireBindingId,
    bindings,
    "e",
  );
  return {
    requireName,
    entryModuleKeys: entries.values,
    unknownEntryModuleKeys: entries.unknown,
    asyncChunkKeys: asyncChunks.values,
    unknownAsyncChunkKeys: asyncChunks.unknown,
  };
};

const collectBundlerAsyncChunkKeys = (
  factory: BundlerFunction,
  requireBindingId: string | null,
  bindings: JavaScriptSemanticAnalysisState,
  unusedDefaults: ReadonlySet<t.Node>,
): StaticValues =>
  requireBindingId === null
    ? { values: [], unknown: 0 }
    : collectBundlerCallArgumentValues(
        factory,
        requireBindingId,
        bindings,
        "e",
        unusedDefaults,
      );

const collectBundlerCallArgumentValues = (
  factory: BundlerFunction,
  bindingId: string | null,
  bindings: JavaScriptSemanticAnalysisState,
  member: string | null,
  unusedDefaults: ReadonlySet<t.Node> = new Set(),
): StaticValues => {
  if (bindingId === null) return { values: [], unknown: 0 };
  const values: string[] = [];
  let unknown = 0;
  const bindingIds = new Set([bindingId]);
  traverseJavaScriptAst(factory, {
    skip: (node) => unusedDefaults.has(node),
    enter: (node) => {
      if (!t.isCallExpression(node) && !t.isNewExpression(node))
        return undefined;
      const loader = semanticFactoryLoaderMemberAt(
        node,
        bindings,
        bindingIds,
        member,
      );
      if (loader === undefined) return undefined;
      if (loader === "unknown") {
        unknown += 1;
        return undefined;
      }
      const value = argumentValue(node.arguments[0]);
      if (value === undefined) unknown += 1;
      else values.push(value);
      return undefined;
    },
  });
  return uniqueValues(values, unknown);
};

const isBundlerFunction = (
  node: t.Node | null | undefined,
): node is BundlerFunction =>
  t.isFunctionExpression(node) ||
  t.isArrowFunctionExpression(node) ||
  t.isObjectMethod(node);

const uniqueValues = (values: readonly string[], unknown = 0): StaticValues => {
  const unique = [...new Set(values)].sort(compareUnicodeCodePoints);
  return {
    values: unique,
    unknown,
  };
};

/** Complete factory exports once the shared alias-aware write index is ready. */
export const finishBundlerExports = (
  accumulator: AnalysisAccumulator,
  index: JavaScriptBindingIndex,
): void => {
  for (const pending of accumulator.pendingBundlerExports) {
    const collected = collectJavaScriptExports(pending.factory, {
      roles: pending.roles,
      index,
    });
    for (const value of collected.values) pending.exports.push(value);
    // An unordered receiver read leaves the export list incomplete.
    accumulator.unknownFindings += collected.unknown;
  }
};
