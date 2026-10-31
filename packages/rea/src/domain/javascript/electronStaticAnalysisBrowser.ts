import * as t from "@babel/types";

import type {
  ElectronBrowserWindowFinding,
  ElectronBrowserWindowPreload,
  ElectronContextBridgeApiKey,
  ElectronContextBridgeFinding,
  ElectronStaticValue,
  ElectronUtilityProcessFinding,
  ElectronWebPreference,
} from "./electronStaticAnalysisTypes.js";
import { contextBridgeExposureArguments } from "./javascriptContextBridgeExposure.js";
import {
  boundedExpression,
  collectContextBridgeMembers,
  electronCalleePath,
  electronStaticValue,
} from "./electronStaticAnalysisValues.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { addLocatedFinding } from "./javascriptStaticAnalysisFindings.js";
import {
  argumentNode,
  range,
  staticPath,
  staticPathResolutionContext,
  type JavaScriptStaticPathIntrinsicQuery,
} from "./javascriptStaticAnalysisHelpers.js";
import {
  semanticStaticPropertyKey,
  staticObjectProperty,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import type { JavaScriptFindingContext } from "./javascriptStaticAnalysisState.js";
import type { JavaScriptBindingIndex } from "./javascriptSemanticState.js";
import { optionsAfterOptionalArgv } from "./javascriptSemanticExpressionShapes.js";
import {
  hasElectronOptionObjectCandidate,
  resolveElectronOptionObject,
} from "./electronStaticOptionObjects.js";

/** Inspect BrowserWindow, contextBridge, and utility-process syntax. */
export const inspectElectronBrowserNode = (
  node: t.Node,
  context: JavaScriptFindingContext,
): void => {
  if (t.isNewExpression(node)) {
    const path = electronCalleePath(node.callee, context);
    if (path?.length === 1 && path[0] === "BrowserWindow") {
      if (needsConstantOptions(node))
        context.accumulator.pendingBrowserWindows.push(node);
      else inspectBrowserWindow(node, context);
    }
  }
  if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node)) return;
  inspectContextBridge(node, context);
  inspectUtilityProcess(node, context);
};

const needsConstantOptions = (node: t.NewExpression): boolean => {
  const argument = argumentNode(node.arguments[0]);
  const options = argument && unwrapJavaScriptExpression(argument).node;
  if (t.isIdentifier(options)) return true;
  const lookup = staticObjectProperty(options, "webPreferences");
  return (
    lookup.status === "explicit" &&
    t.isIdentifier(unwrapJavaScriptExpression(lookup.value).node)
  );
};

/** Batch deferred options after the shared mutation index can yield safely. */
export function* finishElectronBrowserWindowsSteps(
  context: JavaScriptFindingContext,
  index: JavaScriptBindingIndex,
): Generator<void, void> {
  const pending = context.accumulator.pendingBrowserWindows;
  if (pending.length === 0) return;
  if (
    pending.some((node) => {
      const argument = argumentNode(node.arguments[0]);
      const options = argument && unwrapJavaScriptExpression(argument).node;
      if (t.isIdentifier(options))
        return hasElectronOptionObjectCandidate(options, index);
      const lookup = staticObjectProperty(options, "webPreferences");
      return (
        lookup.status === "explicit" &&
        hasElectronOptionObjectCandidate(lookup.value, index)
      );
    })
  )
    yield* index.indexMemberMutationFactsSteps();
  for (const node of pending) {
    inspectBrowserWindow(node, context, index);
    yield;
  }
  // Inline findings arrive during traversal; deferred findings join that same
  // source-ordered collection before module attribution and public projection.
  context.accumulator.browserWindows.sort(
    (left, right) => left.offset - right.offset,
  );
  pending.length = 0;
}

const inspectBrowserWindow = (
  node: t.NewExpression,
  context: JavaScriptFindingContext,
  index?: JavaScriptBindingIndex,
): void => {
  const argument = argumentNode(node.arguments[0]);
  const options =
    argument === undefined
      ? undefined
      : unwrapJavaScriptExpression(argument).node;
  const resolvedOptions =
    (index &&
      resolveElectronOptionObject(options, node, index, ["webPreferences"])) ??
    options;
  const lookup = staticObjectProperty(resolvedOptions, "webPreferences");
  const declaredPreferences =
    lookup.status === "explicit"
      ? unwrapJavaScriptExpression(lookup.value).node
      : undefined;
  const resolvedPreferences =
    (index && resolveElectronOptionObject(declaredPreferences, node, index)) ??
    declaredPreferences;
  const resolutionSources = [
    ...(resolvedOptions !== options && resolvedOptions !== undefined
      ? [range(resolvedOptions)]
      : []),
    ...(resolvedPreferences !== declaredPreferences &&
    resolvedPreferences !== undefined
      ? [range(resolvedPreferences)]
      : []),
  ];
  const collected = collectWindowOptions(
    context.source,
    lookup.status,
    resolvedPreferences,
    context.pathIntrinsics,
  );
  context.accumulator.unknownFindings += collected.unknown;
  const finding: ElectronBrowserWindowFinding = {
    options_status:
      resolvedOptions === undefined
        ? "missing"
        : t.isObjectExpression(resolvedOptions)
          ? "object-literal"
          : "dynamic",
    web_preferences_status: collected.status,
    web_preferences: collected.preferences,
    ...(resolutionSources.length > 0
      ? { resolution_sources: resolutionSources }
      : {}),
    ...collected.preload,
    module_key: null,
    location: range(node),
  };
  if (
    finding.preload_path !== null &&
    finding.preload_resolution_context !== null
  )
    addLocatedFinding(context, {
      collection: context.accumulator.roles,
      key: `role\0preload\0${finding.preload_path}`,
      node,
      value: {
        role: "preload",
        path: finding.preload_path,
        resolution_context: finding.preload_resolution_context,
        mechanism: "BrowserWindow:webPreferences.preload",
        module_key: null,
        location: range(node),
      },
    });
  addLocatedFinding(context, {
    collection: context.accumulator.browserWindows,
    key: "electron-window\0BrowserWindow",
    node,
    value: finding,
  });
};

const collectWindowOptions = (
  source: string,
  lookupStatus: "explicit" | "missing" | "dynamic",
  preferences: t.Node | undefined,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
): {
  readonly status: ElectronBrowserWindowFinding["web_preferences_status"];
  readonly preferences: readonly ElectronWebPreference[];
  readonly preload: ElectronBrowserWindowPreload;
  readonly unknown: number;
} => {
  if (lookupStatus !== "explicit" || !t.isObjectExpression(preferences))
    return {
      status: lookupStatus === "missing" ? "missing" : "dynamic",
      preferences: [],
      preload: { preload_path: null, preload_resolution_context: null },
      unknown: lookupStatus === "missing" ? 0 : 1,
    };
  return collectWebPreferences(source, preferences, pathIntrinsics);
};

const collectWebPreferences = (
  source: string,
  object: t.ObjectExpression,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
): {
  readonly status: "object-literal";
  readonly preferences: readonly ElectronWebPreference[];
  readonly preload: ElectronBrowserWindowPreload;
  readonly unknown: number;
} => {
  const preferences: ElectronWebPreference[] = [];
  let unknown = 0;
  const effectivePreload = staticObjectProperty(object, "preload");
  const preloadPath =
    effectivePreload.status === "explicit"
      ? staticPath(effectivePreload.value, pathIntrinsics)
      : undefined;
  const preload: ElectronBrowserWindowPreload =
    effectivePreload.status === "explicit" && preloadPath !== undefined
      ? {
          preload_path: preloadPath,
          preload_resolution_context: staticPathResolutionContext(
            effectivePreload.value,
            pathIntrinsics,
          ),
        }
      : { preload_path: null, preload_resolution_context: null };
  for (const property of object.properties) {
    if (t.isSpreadElement(property)) {
      unknown += 1;
      preferences.push({
        name: `[spread@${String(property.start ?? -1)}]`,
        value: electronStaticValue(source, property.argument),
      });
      continue;
    }
    const name = semanticStaticPropertyKey(property.key, property.computed);
    if (name === null) {
      unknown += 1;
      preferences.push({
        name: `[dynamic@${String(property.start ?? -1)}]`,
        value: electronStaticValue(source, property),
      });
      continue;
    }
    if (t.isObjectMethod(property)) {
      unknown += 1;
      preferences.push({
        name,
        value: electronStaticValue(source, property),
      });
      continue;
    }
    const path =
      name === "preload"
        ? staticPath(property.value, pathIntrinsics)
        : undefined;
    const value: ElectronStaticValue =
      path === undefined
        ? electronStaticValue(source, property.value)
        : { status: "literal", value: path, expression: null };
    if (value.status === "dynamic") unknown += 1;
    preferences.push({ name, value });
  }
  preferences.sort((left, right) =>
    compareUnicodeCodePoints(left.name, right.name),
  );
  return {
    status: "object-literal",
    preferences,
    preload,
    unknown,
  };
};

const inspectContextBridge = (
  node: t.CallExpression | t.OptionalCallExpression,
  context: JavaScriptFindingContext,
): void => {
  const path = electronCalleePath(node.callee, context);
  const exposure =
    path?.length === 2 && path[0] === "contextBridge"
      ? contextBridgeExposureArguments(path[1] ?? "", node.arguments)
      : undefined;
  if (exposure === undefined) return;
  const keyNode = argumentNode(exposure.apiKey);
  const apiNode = argumentNode(exposure.api);
  const key = electronStaticValue(context.source, keyNode);
  const api = collectContextBridgeMembers(apiNode);
  const worldId =
    exposure.worldId === null
      ? null
      : electronStaticValue(context.source, argumentNode(exposure.worldId));
  const unknown =
    (key.status === "dynamic" ? 1 : 0) +
    (worldId?.status === "dynamic" ? 1 : 0) +
    api.unknown;
  context.accumulator.unknownFindings += unknown;
  const apiKey: ElectronContextBridgeApiKey =
    key.status === "dynamic"
      ? { api_key: null, api_key_expression: key.expression }
      : typeof key.value === "string"
        ? { api_key: key.value, api_key_expression: null }
        : { api_key: null, api_key_expression: null };
  const finding: ElectronContextBridgeFinding = {
    ...apiKey,
    world: exposure.world,
    world_id: worldId,
    api_status: api.status,
    members: api.members,
    unknown_members: api.unknown,
    module_key: null,
    location: range(node),
  };
  addLocatedFinding(context, {
    collection: context.accumulator.contextBridgeApis,
    key: `context-bridge\0${exposure.world}\0${finding.api_key ?? finding.api_key_expression ?? "[missing]"}`,
    node,
    value: finding,
  });
};

const inspectUtilityProcess = (
  node: t.CallExpression | t.OptionalCallExpression,
  context: JavaScriptFindingContext,
): void => {
  const path = electronCalleePath(node.callee, context);
  if (path?.length !== 2 || path[0] !== "utilityProcess" || path[1] !== "fork")
    return;
  const moduleNode = argumentNode(node.arguments[0]);
  const modulePath =
    moduleNode === undefined
      ? undefined
      : staticPath(moduleNode, context.pathIntrinsics);
  // Electron treats a non-array object in the argv slot as the options.
  const shapes = context.expressionShapes;
  const options = optionsAfterOptionalArgv(node.arguments, shapes);
  const serviceNameProperty =
    options === undefined || shapes.isNullish(options)
      ? { status: "missing" as const }
      : staticObjectProperty(options, "serviceName", shapes.isNullish);
  // A nullish serviceName selects Electron's default display name.
  const declaredName =
    serviceNameProperty.status === "explicit" &&
    !shapes.isNullish(serviceNameProperty.value)
      ? serviceNameProperty.value
      : undefined;
  const serviceName =
    declaredName === undefined
      ? undefined
      : staticPath(declaredName, context.pathIntrinsics);
  if (
    serviceNameProperty.status === "dynamic" ||
    (declaredName !== undefined && serviceName === undefined)
  )
    context.accumulator.unknownFindings += 1;
  if (modulePath === undefined) context.accumulator.unknownFindings += 1;
  const moduleReference =
    modulePath === undefined || moduleNode === undefined
      ? {
          module_path: null,
          module_resolution_context: null,
          module_expression: boundedExpression(context.source, moduleNode),
        }
      : {
          module_path: modulePath,
          module_resolution_context: staticPathResolutionContext(
            moduleNode,
            context.pathIntrinsics,
          ),
          module_expression: null,
        };
  const finding: ElectronUtilityProcessFinding = {
    ...moduleReference,
    service_name: serviceName ?? null,
    module_key: null,
    location: range(node),
  };
  addLocatedFinding(context, {
    collection: context.accumulator.utilityProcesses,
    key: `electron-utility\0${finding.module_path ?? finding.module_expression}`,
    node,
    value: finding,
  });
};
