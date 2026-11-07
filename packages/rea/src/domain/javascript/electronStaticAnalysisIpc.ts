import * as t from "@babel/types";

import type {
  ElectronIpcDescriptor,
  ElectronIpcFinding,
  ElectronIpcReceiver,
  ElectronSenderValidationFinding,
} from "./electronStaticAnalysisTypes.js";
import {
  boundedExpression,
  electronCalleePath,
  electronStaticValue,
  handlerKind,
} from "./electronStaticAnalysisValues.js";
import { addLocatedFinding } from "./javascriptStaticAnalysisFindings.js";
import {
  argumentNode,
  calleeName,
  range,
} from "./javascriptStaticAnalysisHelpers.js";
import { semanticStaticPropertyName } from "./javascriptAstValues.js";
import { compositeKey } from "../unicodeCodePointOrder.js";
import type { JavaScriptFindingContext } from "./javascriptStaticAnalysisState.js";

/** Inspect Electron IPC operations and validation candidates. */
export const inspectElectronIpcNode = (
  node: t.Node,
  context: JavaScriptFindingContext,
): void => {
  if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
    inspectIpcCall(node, context);
    inspectValidationCall(node, context);
  }
  if (t.isBinaryExpression(node)) inspectValidationComparison(node, context);
};

const inspectIpcCall = (
  node: t.CallExpression | t.OptionalCallExpression,
  context: JavaScriptFindingContext,
): void => {
  const scoped = scopedIpcDescriptor(node, context);
  const descriptor =
    scoped?.descriptor ??
    ipcDescriptor(electronCalleePath(node.callee, context));
  if (descriptor === undefined) return;
  const channelNode = argumentNode(node.arguments[0]);
  const channelValue = electronStaticValue(context.source, channelNode);
  const channel =
    channelValue.status === "literal" && typeof channelValue.value === "string"
      ? channelValue.value
      : null;
  const channelReference =
    channel === null
      ? {
          channel: null,
          channel_expression:
            channelValue.status === "dynamic"
              ? channelValue.expression
              : boundedExpression(context.source, channelNode),
        }
      : { channel, channel_expression: null };
  const handlerNode =
    descriptor.mode === "listen" || descriptor.mode === "handle"
      ? argumentNode(node.arguments[1])
      : undefined;
  const findingState =
    descriptor.mode === "send"
      ? {
          ...descriptor,
          handler_kind: null,
          handler_location: null,
        }
      : descriptor.mode === "invoke"
        ? {
            ...descriptor,
            handler_kind: null,
            handler_location: null,
          }
        : handlerNode === undefined
          ? {
              ...descriptor,
              handler_kind: "missing" as const,
              handler_location: null,
            }
          : {
              ...descriptor,
              handler_kind: handlerKind(handlerNode),
              handler_location: range(handlerNode),
            };
  if (channel === null) context.accumulator.unknownFindings += 1;
  if (findingState.handler_kind === "missing")
    context.accumulator.unknownFindings += 1;
  const finding: ElectronIpcFinding = {
    ...findingState,
    ...(scoped === undefined ? {} : { receiver: scoped.receiver }),
    ...channelReference,
    module_key: null,
    location: range(node),
  };
  addLocatedFinding(context, {
    collection: context.accumulator.ipc,
    key: `electron-ipc\0${descriptor.side}\0${descriptor.operation}\0${channelReference.channel ?? channelReference.channel_expression}`,
    node,
    value: finding,
  });
};

const scopedIpcDescriptor = (
  node: t.CallExpression | t.OptionalCallExpression,
  context: JavaScriptFindingContext,
):
  | {
      readonly descriptor: ElectronIpcDescriptor;
      readonly receiver: ElectronIpcReceiver;
    }
  | undefined => {
  if (
    !t.isMemberExpression(node.callee) &&
    !t.isOptionalMemberExpression(node.callee)
  )
    return undefined;
  const operation = semanticStaticPropertyName(
    node.callee.property,
    node.callee.computed,
  );
  const descriptor = ipcDescriptor(["ipcMain", operation]);
  if (descriptor === undefined) return undefined;
  const receiver = context.browserWindowReceiver?.(node.callee.object, node, [
    operation,
  ]);
  if (receiver === undefined) return undefined;
  const path = receiver.path;
  const kind =
    path.length === 3 && path[0] === "webContents" && path[1] === "ipc"
      ? "web-contents"
      : path.length === 4 &&
          path[0] === "webContents" &&
          path[1] === "mainFrame" &&
          path[2] === "ipc"
        ? "main-frame"
        : undefined;
  return kind === undefined
    ? undefined
    : {
        descriptor,
        receiver: { kind, owner_location: range(receiver.owner) },
      };
};

const inspectValidationComparison = (
  node: t.BinaryExpression,
  context: JavaScriptFindingContext,
): void => {
  if (!["==", "===", "!=", "!==", "in"].includes(node.operator)) return;
  const left = senderSubject(node.left);
  const right = senderSubject(node.right);
  if (left === undefined && right === undefined) return;
  const expected = left === undefined ? node.left : node.right;
  addValidation(context, node, {
    subject: left ?? right ?? "sender-frame",
    mechanism: `comparison:${node.operator}`,
    expected: electronStaticValue(context.source, expected),
  });
};

const inspectValidationCall = (
  node: t.CallExpression | t.OptionalCallExpression,
  context: JavaScriptFindingContext,
): void => {
  if (
    !t.isMemberExpression(node.callee) &&
    !t.isOptionalMemberExpression(node.callee)
  )
    return;
  const method = semanticStaticPropertyName(
    node.callee.property,
    node.callee.computed,
  );
  if (!["startsWith", "endsWith", "includes"].includes(method)) return;
  const subject = t.isNode(node.callee.object)
    ? senderSubject(node.callee.object)
    : undefined;
  if (subject === undefined) return;
  addValidation(context, node, {
    subject,
    mechanism: `call:${method}`,
    expected: electronStaticValue(
      context.source,
      argumentNode(node.arguments[0]),
    ),
  });
};

const addValidation = (
  context: JavaScriptFindingContext,
  node: t.Node,
  input: Pick<
    ElectronSenderValidationFinding,
    "subject" | "mechanism" | "expected"
  >,
): void => {
  if (input.expected.status === "dynamic")
    context.accumulator.unknownFindings += 1;
  const finding: ElectronSenderValidationFinding = {
    ...input,
    enforcement: "unknown",
    module_key: null,
    location: range(node),
  };
  addLocatedFinding(context, {
    collection: context.accumulator.senderValidations,
    key: compositeKey([
      "electron-validation",
      input.subject,
      input.mechanism,
      input.expected.status === "literal"
        ? String(input.expected.value)
        : input.expected.expression,
    ]),
    node,
    value: finding,
  });
};

export const ipcDescriptor = (
  path: readonly string[] | undefined,
): ElectronIpcDescriptor | undefined => {
  if (path?.length !== 2) return undefined;
  const [object, operation] = path;
  if (object === "ipcRenderer" && operation !== undefined) {
    const renderer = operation;
    switch (renderer) {
      case "send":
        return { side: "renderer", operation: "send", mode: "send" };
      case "sendSync":
        return { side: "renderer", operation: "send-sync", mode: "send" };
      case "invoke":
        return { side: "renderer", operation: "invoke", mode: "invoke" };
      case "postMessage":
        return {
          side: "renderer",
          operation: "post-message",
          mode: "send",
        };
      case "sendToHost":
        return {
          side: "renderer",
          operation: "send-to-host",
          mode: "send",
        };
      case "addListener":
      case "on":
        return { side: "renderer", operation: "on", mode: "listen" };
      case "once":
        return { side: "renderer", operation: "once", mode: "listen" };
    }
  }
  const main = object === "ipcMain" ? operation : undefined;
  switch (main) {
    case "addListener":
    case "on":
      return { side: "main", operation: "on", mode: "listen" };
    case "once":
      return { side: "main", operation: "once", mode: "listen" };
    case "handle":
      return { side: "main", operation: "handle", mode: "handle" };
    case "handleOnce":
      return { side: "main", operation: "handle-once", mode: "handle" };
    default:
      return undefined;
  }
};

const senderSubject = (
  node: t.Node,
): ElectronSenderValidationFinding["subject"] | undefined => {
  const name =
    t.isCallExpression(node) || t.isOptionalCallExpression(node)
      ? calleeName(node.callee)
      : calleeName(node);
  if (/(?:^|\.)sender\.getURL$/u.test(name)) return "sender-url";
  if (/(?:^|\.)senderFrame\.origin$/u.test(name)) return "sender-origin";
  if (/(?:^|\.)senderFrame\.url$/u.test(name)) return "sender-url";
  if (/(?:^|\.)senderFrame$/u.test(name)) return "sender-frame";
  if (/(?:^|\.)sender\.id$/u.test(name)) return "sender-id";
  if (/(?:^|\.)frameId$/u.test(name)) return "frame-id";
  if (/(?:^|\.)processId$/u.test(name)) return "process-id";
  return undefined;
};
