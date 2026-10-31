"use strict";

const applyFunction = Reflect.apply;
const applyArguments = Function.prototype.apply;
const bindFunction = Function.prototype.bind;
const callFunction = Function.prototype.call;
const arrayFrom = Array.from;
const arrayIsArray = Array.isArray;
const defineProperty = Object.defineProperty;
const ownPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const nativeFunctionPrototype = getPrototypeOf(callFunction);
const getProperty = Reflect.get;
const setProperty = Reflect.set;
const SetConstructor = Set;
const ProxyConstructor = Proxy;
const bindBuiltinMethod = (method) =>
  applyFunction(bindFunction, callFunction, [method]);
const forEachMapEntry = bindBuiltinMethod(Map.prototype.forEach);
const sliceArguments = bindBuiltinMethod(Array.prototype.slice);
const weakMapHas = bindBuiltinMethod(WeakMap.prototype.has);
const weakMapGet = bindBuiltinMethod(WeakMap.prototype.get);
const weakMapSet = bindBuiltinMethod(WeakMap.prototype.set);
const weakSetAdd = bindBuiltinMethod(WeakSet.prototype.add);
const weakSetHas = bindBuiltinMethod(WeakSet.prototype.has);
const setHas = bindBuiltinMethod(Set.prototype.has);
const setAdd = bindBuiltinMethod(Set.prototype.add);
const hasOwnProperty = bindBuiltinMethod(Object.prototype.hasOwnProperty);

const { isProxy } = require("node:util").types;
const { EventEmitter: NodeEventEmitter } = require("node:events");
const nodeEventEmitterMethods = Object.create(null);
for (const method of [
  "on",
  "once",
  "off",
  "removeListener",
  "removeAllListeners",
]) {
  const descriptor = ownPropertyDescriptor(NodeEventEmitter.prototype, method);
  nodeEventEmitterMethods[method] =
    descriptor !== undefined && hasOwnProperty(descriptor, "value")
      ? descriptor.value
      : undefined;
}
const {
  createElectronActiveBoundaryPatches,
} = require("./electron-active-hook-boundaries.cjs");

const ipcEventKinds = new SetConstructor([
  "main-handler-invocation",
  "main-event-invocation",
  "utility-process-fork",
  "utility-process-message",
  "ipc-main-to-renderer",
  "ipc-utility-to-main",
  "ipc-renderer-send",
  "ipc-renderer-invoke",
  "ipc-renderer-post-message",
]);
const events = [];
// Budget serialized data and estimated retained object/array storage together.
const retentionBudgetBytes = 16 * 1024 * 1024;
const snapshotEnvelopeReserveBytes = 1024;
let estimatedRetainedBytes = 0;
let serializedBytes = 0;
let observed = 0;
let observedIpc = 0;
let observedRuntime = 0;
let dropped = 0;
let droppedIpc = 0;
let droppedRuntime = 0;
const droppedFamilies = new Map();
const droppedRoles = new Map();
let sequence = 0;
let correlationSequence = 0;

const shape = (value, depth = 0) => {
  if (depth > 2 || value === null) return value === null ? "null" : "nested";
  if (arrayIsArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "undefined":
      return "undefined";
    case "function":
      return "function";
    case "object":
      return "object";
    default:
      return "unknown";
  }
};

// Measure JSON strings without allocating an encoded copy of a caller value.
const jsonStringBytes = (value) => {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) bytes += 2;
    else if (
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    )
      bytes += 2;
    else if (code <= 0x1f) bytes += 6;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6;
    else if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else bytes += 3;
    if (bytes > retentionBudgetBytes) return bytes;
  }
  return bytes;
};

const jsonScalarBytes = (value) => {
  if (value === null) return 4;
  if (typeof value === "string") return jsonStringBytes(value);
  if (typeof value === "boolean") return value ? 4 : 5;
  return String(value).length;
};

const eventFamily = (kind, processTypeValue) => {
  if (
    kind === "preload" &&
    (processTypeValue === "main" || processTypeValue === "browser")
  )
    return "preload-configuration";
  if (kind.startsWith("ipc-renderer"))
    return processTypeValue === "renderer" ? "renderer-ipc" : "ipc";
  return setHas(ipcEventKinds, kind) ? "ipc" : kind;
};

const noteDropped = (kind, processTypeValue, isIpc) => {
  dropped += 1;
  if (isIpc) droppedIpc += 1;
  else droppedRuntime += 1;
  const family = eventFamily(kind, processTypeValue);
  droppedFamilies.set(family, (droppedFamilies.get(family) ?? 0) + 1);
  if (typeof processTypeValue === "string")
    droppedRoles.set(
      processTypeValue,
      (droppedRoles.get(processTypeValue) ?? 0) + 1,
    );
  if (kind === "window-lifecycle")
    droppedRoles.set("window", (droppedRoles.get("window") ?? 0) + 1);
  if (kind === "web-contents-lifecycle" || kind === "navigation")
    droppedRoles.set(
      "web_contents",
      (droppedRoles.get("web_contents") ?? 0) + 1,
    );
  if (kind === "preload" && processTypeValue === "preload")
    droppedRoles.set("preload", (droppedRoles.get("preload") ?? 0) + 1);
};

const isAllowedNavigation = (value) => {
  if (typeof value !== "string") return true;
  try {
    const parsed = new URL(value);
    if (["file:", "data:", "about:"].includes(parsed.protocol)) return true;
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
};

const processType = () =>
  typeof process.type === "string" && process.type.length > 0
    ? process.type
    : "main";

const identity = (value, prefix) => {
  if (value === null || value === undefined) return null;
  const id = value.id;
  const processId = value.pid;
  return typeof id === "string" || typeof id === "number"
    ? `${prefix}:${String(id)}`
    : typeof processId === "number"
      ? `${prefix}:pid:${String(processId)}`
      : null;
};

const frameIdentity = (event) => {
  const frame = event?.senderFrame ?? event?.frame;
  const id = frame?.frameTreeNodeId ?? frame?.routingId ?? frame?.id;
  return typeof id === "string" || typeof id === "number"
    ? `frame:${String(id)}`
    : null;
};

const record = (event) => {
  observed += 1;
  const isIpc = setHas(ipcEventKinds, event.kind);
  if (isIpc) observedIpc += 1;
  else observedRuntime += 1;
  const raw = {
    sequence: ++sequence,
    correlation_id:
      typeof event.correlation_id === "string"
        ? event.correlation_id
        : `capture:${process.pid}:${++correlationSequence}`,
    event: null,
    phase: "observed",
    channel: null,
    direction: null,
    sender: null,
    receiver: null,
    frame: null,
    target: null,
    argument_shapes: [],
    result_shape: null,
    process_type: processType(),
    source: "electron-active-hook",
    capture_method: "api-wrapper",
    artifact_path: null,
    artifact_sha256: null,
    error: false,
    ...event,
  };
  const shapeGroups = arrayIsArray(raw.argument_shape_value_groups)
    ? raw.argument_shape_value_groups
    : arrayIsArray(raw.argument_shape_values)
      ? [raw.argument_shape_values]
      : [];
  const existingShapes = arrayIsArray(raw.argument_shapes)
    ? raw.argument_shapes
    : [];
  const retainedEvent = {
    ...raw,
    correlation_id: raw.correlation_id,
    event: typeof raw.event === "string" ? raw.event : null,
    channel: typeof raw.channel === "string" ? raw.channel : null,
    sender: typeof raw.sender === "string" ? raw.sender : null,
    receiver: typeof raw.receiver === "string" ? raw.receiver : null,
    frame: typeof raw.frame === "string" ? raw.frame : null,
    target: typeof raw.target === "string" ? raw.target : null,
    argument_shapes: [],
    result_shape:
      typeof raw.result_shape === "string" ? raw.result_shape : null,
    process_type:
      typeof raw.process_type === "string" ? raw.process_type : null,
    artifact_path:
      typeof raw.artifact_path === "string" ? raw.artifact_path : null,
    artifact_sha256:
      typeof raw.artifact_sha256 === "string" ? raw.artifact_sha256 : null,
  };
  delete retainedEvent.argument_shape_values;
  delete retainedEvent.argument_shape_value_groups;

  // All event values are JSON scalars except argument_shapes. Measure them
  // incrementally so large channels, paths, or shape lists never require a
  // full JSON.stringify temporary allocation before the budget decision.
  let eventBytes = 2;
  let argumentShapeCount = 0;
  const eventKeys = Object.keys(retainedEvent);
  for (let index = 0; index < eventKeys.length; index += 1) {
    const key = eventKeys[index];
    const value = retainedEvent[key];
    if (index > 0) eventBytes += 1;
    eventBytes += jsonStringBytes(key) + 1;
    if (key === "argument_shapes") {
      eventBytes += 2;
      let shapeOverflow = false;
      const countShape = (argument) => {
        const encodedShapeBytes = jsonStringBytes(shape(argument));
        eventBytes += encodedShapeBytes + (argumentShapeCount === 0 ? 0 : 1);
        argumentShapeCount += 1;
        shapeOverflow =
          eventBytes + estimatedRetainedBytes + snapshotEnvelopeReserveBytes >
          retentionBudgetBytes;
      };
      for (const group of shapeGroups) {
        if (!arrayIsArray(group)) continue;
        for (const argument of group) {
          countShape(argument);
          if (shapeOverflow) break;
        }
      }
      if (shapeOverflow) {
        noteDropped(raw.kind, retainedEvent.process_type, isIpc);
        return null;
      }
      for (const valueShape of existingShapes)
        if (!shapeOverflow) {
          eventBytes +=
            jsonStringBytes(
              typeof valueShape === "string" ? valueShape : "unknown",
            ) + (argumentShapeCount++ === 0 ? 0 : 1);
          shapeOverflow =
            eventBytes + estimatedRetainedBytes + snapshotEnvelopeReserveBytes >
            retentionBudgetBytes;
        }
      if (shapeOverflow) {
        noteDropped(raw.kind, retainedEvent.process_type, isIpc);
        return null;
      }
    } else eventBytes += jsonScalarBytes(value);
    if (
      eventBytes + estimatedRetainedBytes + snapshotEnvelopeReserveBytes >
      retentionBudgetBytes
    ) {
      noteDropped(raw.kind, retainedEvent.process_type, isIpc);
      return null;
    }
  }
  // Reserve room for the only fields mutated after recording: result_shape and
  // error. The shape vocabulary's longest value is "undefined".
  const reservedMutationBytes = retainedEvent.result_shape === null ? 7 : 0;
  // Include one byte for the event-array separator and reserve space for the
  // snapshot's counters and JSON delimiters.
  // One retained event, one defensive snapshot copy, and up to two serialized
  // result views (timeline plus IPC), with per-object and per-array-slot costs.
  const eventEstimateBytes = eventBytes * 3 + 512 + argumentShapeCount * 16;
  const retainedEventBytes = eventEstimateBytes + reservedMutationBytes + 1;
  if (
    estimatedRetainedBytes + retainedEventBytes + snapshotEnvelopeReserveBytes >
    retentionBudgetBytes
  ) {
    noteDropped(raw.kind, retainedEvent.process_type, isIpc);
    return null;
  }
  for (const group of shapeGroups) {
    if (!arrayIsArray(group)) continue;
    for (const argument of group)
      retainedEvent.argument_shapes.push(shape(argument));
  }
  for (const valueShape of existingShapes)
    retainedEvent.argument_shapes.push(
      typeof valueShape === "string" ? valueShape : "unknown",
    );
  events.push(retainedEvent);
  estimatedRetainedBytes += retainedEventBytes;
  serializedBytes += eventBytes + reservedMutationBytes + 1;
  return retainedEvent;
};

const recordRuntime = (kind, event, phase, details = {}) =>
  record({ kind, event, phase, ...details });

const recordIpc = (kind, channel, args, details = {}) =>
  (() => {
    const values = arrayIsArray(args) ? args : [];
    return record({
      kind,
      channel: typeof channel === "string" ? channel : null,
      argument_shape_values: values,
      ...details,
    });
  })();

const recordIpcObservationGap = (
  channel,
  event,
  error = false,
  target = "ipcMain.on",
) =>
  recordRuntime("ipc-observation-gap", event, error ? "failed" : "observed", {
    channel,
    target,
    process_type: "main",
    error,
  });

const forwardUnobservedRegistration = (
  method,
  receiver,
  args,
  recordGap,
  target,
) => {
  const gap =
    recordGap && typeof args[1] === "function"
      ? recordIpcObservationGap(args[0], "listener-registration", false, target)
      : null;
  try {
    return applyFunction(method, receiver, args);
  } catch (cause) {
    if (gap !== null) {
      gap.error = true;
      gap.phase = "failed";
    }
    throw cause;
  }
};

const patchEmitter = (emitter, observeEvent) => {
  if (emitter === null || emitter === undefined) return;
  const original = emitter.emit;
  if (typeof original !== "function") return;
  if (emitter.__reaElectronActiveEmitPatched === true) return;
  try {
    emitter.__reaElectronActiveEmitPatched = true;
    emitter.emit = function patchedEmit(event, ...args) {
      if (typeof event === "string") observeEvent.call(this, event, args);
      return original.call(this, event, ...args);
    };
  } catch {
    globalThis.__reaElectronActiveHookError = true;
  }
};

const recordInvocation = (kind, channel, event, args) =>
  recordIpc(kind, channel, args, {
    direction: "renderer-to-main",
    sender: identity(event?.sender, "webContents"),
    receiver: "main",
    frame: frameIdentity(event),
    process_type: "main",
    error: false,
  });

const invokeObservedEventListener = (thisArg, channel, listener, args) => {
  // Recording slices an actual invocation frame, avoiding Array species;
  // callback dispatch keeps its native Array/Arguments representation.
  const recorded = recordInvocation(
    "main-event-invocation",
    channel,
    args[0],
    sliceArguments(args, 1),
  );
  try {
    return applyFunction(listener, thisArg, args);
  } catch (cause) {
    if (recorded !== null) recorded.error = true;
    throw cause;
  }
};

// Recording wrappers follow EventEmitter's own wrapper convention: `.listener`
// names the caller's function so native removal can match it. Node retains
// ownership of listener traversal and meta-events; hook-created "on" entries
// are translated before calling the application's removal method/decorators.
// Only hook-created wrappers are tracked, by the registration they stand in
// for: they already record, so patched on() registers them as is. An "on"
// wrapper stands in for the caller's raw function and a "once" wrapper for
// EventEmitter's once wrapper, which removeAllListeners reports accordingly.
// The value is the native removal argument: the app function for an "on"
// wrapper, or the wrapper itself for "once". Public .listener is mutable;
// it is not the authority for the original function's identity.
const hookListenerRemovalTargets = new WeakMap();
const knownCanonicalListeners = new WeakSet();
const MAX_LISTENER_CHAIN_HOPS = 16;

// Parse native property lookup without invoking application getters or Proxy
// traps. Undefined means absent; null means the lookup is unknown.
const lookupPropertyDescriptor = (listener, key) => {
  let candidate = listener;
  for (
    let hops = 0;
    hops <= MAX_LISTENER_CHAIN_HOPS && candidate !== null;
    hops += 1
  ) {
    if (isProxy(candidate)) return null;
    const descriptor = ownPropertyDescriptor(candidate, key);
    if (descriptor !== undefined) return descriptor;
    candidate = getPrototypeOf(candidate);
  }
  return candidate === null ? undefined : null;
};

const listenerDataDescriptor = (listener) => {
  const descriptor = lookupPropertyDescriptor(listener, "listener");
  if (descriptor === null || descriptor === undefined) return descriptor;
  if (hasOwnProperty(descriptor, "value")) return descriptor;
  // A setter-only property shadows ancestors with a known undefined read.
  return descriptor.get === undefined ? undefined : null;
};

// A decorator that wraps once's hook wrapper and names it through `.listener`
// already records through that wrapper. Registering the decorator as is keeps
// native self-removal working: the once wrapper removes itself by identity, and
// removeListener matches the decorator through its `.listener`.
const classifyHookListenerWrapper = (listener) => {
  const visited = new SetConstructor();
  let candidate = listener;
  for (
    let hops = 0;
    hops <= MAX_LISTENER_CHAIN_HOPS && typeof candidate === "function";
    hops += 1
  ) {
    if (weakMapHas(hookListenerRemovalTargets, candidate)) return "owned";
    if (setHas(visited, candidate)) return "unowned";
    setAdd(visited, candidate);
    const descriptor = listenerDataDescriptor(candidate);
    if (descriptor === null) return "unknown";
    candidate = descriptor?.value;
  }
  return typeof candidate === "function" ? "unknown" : "unowned";
};

const createObservedEventListener = (channel, listener) => {
  const wrapper = function observedEventListener() {
    return invokeObservedEventListener(this, channel, listener, arguments);
  };
  defineProperty(wrapper, "apply", {
    configurable: true,
    writable: true,
    value: function nativeApply(...methodArgs) {
      let applicationApply;
      try {
        applicationApply = listener.apply;
      } catch (cause) {
        recordIpcObservationGap(channel, "custom-apply", true);
        throw cause;
      }
      if (applicationApply !== applyArguments) {
        const gap = recordIpcObservationGap(channel, "custom-apply");
        try {
          return applyFunction(
            applicationApply,
            this === wrapper ? listener : this,
            methodArgs,
          );
        } catch (cause) {
          if (gap !== null) {
            gap.error = true;
            gap.phase = "failed";
          }
          throw cause;
        }
      }
      return applyFunction(applyArguments, this, methodArgs);
    },
  });
  defineProperty(wrapper, "listener", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: listener,
  });
  weakMapSet(hookListenerRemovalTargets, wrapper, listener);
  return wrapper;
};

const createObservedOnceCallback = (target, channel, listener, receiver) => {
  // A private callable target avoids Proxy get invariants on an app's
  // non-configurable, read-only call/apply properties. It never escapes
  // through the native once wrapper's public listener link.
  const callback = new ProxyConstructor(
    function observedOnceListener() {
      return invokeObservedEventListener(
        this === receiver ? target : this,
        channel,
        listener,
        arguments,
      );
    },
    {
      get: (_callable, key) => {
        let value;
        try {
          value = getProperty(listener, key, listener);
        } catch (cause) {
          if (key === "call" || key === "apply")
            recordIpcObservationGap(channel, `custom-${key}`, true);
          throw cause;
        }
        if (key !== "call" && key !== "apply") return value;
        if (typeof value !== "function") {
          recordIpcObservationGap(channel, `custom-${key}`, true);
          return value;
        }
        if (value === callFunction || value === applyArguments) return value;
        // A runtime that selects an application method must preserve that
        // method's receiver and original argument-list object. Its body may
        // bypass the callable Proxy, so retain a gap rather than an invocation.
        return new ProxyConstructor(value, {
          apply: (method, thisArg, args) => {
            const gap = recordIpcObservationGap(channel, `custom-${key}`);
            if (args[0] === receiver) args[0] = target;
            try {
              return applyFunction(
                method,
                thisArg === callback ? listener : thisArg,
                args,
              );
            } catch (cause) {
              if (gap !== null) {
                gap.error = true;
                gap.phase = "failed";
              }
              throw cause;
            }
          },
        });
      },
    },
  );
  return callback;
};

const patchIpcMain = (ipcMain) => {
  if (ipcMain === null || ipcMain === undefined) return;
  if (isProxy(ipcMain)) {
    recordIpcObservationGap(null, "listener-registration");
    return;
  }
  const methodDescriptors = Object.create(null);
  let methodsKnown = true;
  for (const method of [
    "on",
    "once",
    "off",
    "removeListener",
    "removeAllListeners",
  ]) {
    const descriptor = lookupPropertyDescriptor(ipcMain, method);
    if (
      descriptor === null ||
      descriptor === undefined ||
      !hasOwnProperty(descriptor, "value")
    ) {
      methodsKnown = false;
      methodDescriptors[method] = undefined;
    } else {
      methodDescriptors[method] = descriptor.value;
      if (descriptor.value !== nodeEventEmitterMethods[method])
        methodsKnown = false;
    }
  }
  const on = methodDescriptors.on;
  const once = methodDescriptors.once;
  if (!methodsKnown && (typeof on !== "function" || typeof once !== "function"))
    recordIpcObservationGap(null, "listener-registration");
  const handle = ipcMain.handle;
  const removeAllListeners = methodsKnown
    ? methodDescriptors.removeAllListeners
    : undefined;
  const nativeRemoveListener = methodsKnown
    ? methodDescriptors.removeListener
    : undefined;
  const nativeOff = methodsKnown ? methodDescriptors.off : undefined;
  let unobservedOnceScope = null;
  if (typeof handle === "function")
    ipcMain.handle = function patchedIpcMainHandle(channel, listener) {
      if (typeof listener !== "function")
        return handle.call(this, channel, listener);
      return handle.call(
        this,
        channel,
        async function wrappedHandler(event, ...args) {
          const recorded = recordInvocation(
            "main-handler-invocation",
            channel,
            event,
            args,
          );
          try {
            const result = await applyFunction(listener, this, arguments);
            if (recorded !== null) recorded.result_shape = shape(result);
            return result;
          } catch (cause) {
            if (recorded !== null) recorded.error = true;
            throw cause;
          }
        },
      );
    };
  if (typeof on !== "function") return;
  ipcMain.on = function patchedIpcMainOn(channel, listener) {
    if (this !== ipcMain)
      return forwardUnobservedRegistration(
        on,
        this,
        arguments,
        true,
        "ipcMain.on",
      );
    if (!methodsKnown) {
      return forwardUnobservedRegistration(
        on,
        this,
        arguments,
        unobservedOnceScope === null,
        "ipcMain.on",
      );
    }
    if (typeof listener !== "function") return on.call(this, channel, listener);
    if (unobservedOnceScope !== null) {
      const scope = unobservedOnceScope;
      const result = on.call(this, channel, listener);
      recordIpcObservationGap(channel, "once-metadata", false, "ipcMain.once");
      if (scope.channel === channel) scope.gapRecorded = true;
      return result;
    }
    const wrapperStatus = classifyHookListenerWrapper(listener);
    if (wrapperStatus !== "unowned") {
      const result = on.call(this, channel, listener);
      if (wrapperStatus === "unknown")
        recordIpcObservationGap(channel, "listener-chain");
      return result;
    }
    const wrapped = createObservedEventListener(channel, listener);
    const result = on.call(this, channel, wrapped);
    weakSetAdd(knownCanonicalListeners, listener);
    return result;
  };
  // Native once owns firing, removal and callback dispatch. Node versions
  // differ in whether they read callback.call/apply. Observe actual invocation
  // through a private callable Proxy instead of copying either implementation.
  if (typeof once === "function")
    ipcMain.once = function patchedIpcMainOnce(channel, listener) {
      if (this !== ipcMain)
        return forwardUnobservedRegistration(
          once,
          this,
          arguments,
          true,
          "ipcMain.once",
        );
      if (!methodsKnown) {
        if (typeof listener !== "function")
          return forwardUnobservedRegistration(
            once,
            this,
            arguments,
            false,
            "ipcMain.once",
          );
        const previousScope = unobservedOnceScope;
        unobservedOnceScope = { channel };
        try {
          return forwardUnobservedRegistration(
            once,
            this,
            arguments,
            true,
            "ipcMain.once",
          );
        } finally {
          unobservedOnceScope = previousScope;
        }
      }
      if (typeof listener !== "function")
        return once.call(this, channel, listener);
      const target = this;
      const metadata = lookupPropertyDescriptor(
        nativeFunctionPrototype,
        "listener",
      );
      const onMetadata = lookupPropertyDescriptor(target, "on");
      if (
        metadata === null ||
        (metadata !== undefined && !hasOwnProperty(metadata, "value")) ||
        onMetadata === null ||
        (onMetadata !== undefined && !hasOwnProperty(onMetadata, "value"))
      ) {
        // Native wrapper creation can expose its callback through an inherited
        // setter/Proxy, including one installed by an on getter. Pass the exact
        // app callback; registrations in this synchronous scope stay unwrapped.
        const previousScope = unobservedOnceScope;
        const scope = { channel, gapRecorded: false };
        let failed = true;
        unobservedOnceScope = scope;
        try {
          const result = applyFunction(once, target, [channel, listener]);
          failed = false;
          return result;
        } finally {
          unobservedOnceScope = previousScope;
          // An app decorator can register through an unhooked alias and then
          // throw. Preserve a gap for either outcome, not proof of registration.
          if (!scope.gapRecorded)
            recordIpcObservationGap(
              channel,
              "once-metadata",
              failed,
              "ipcMain.once",
            );
        }
      }
      const receiver = new ProxyConstructor(
        { __proto__: null },
        {
          get: (_target, key) => {
            const value = getProperty(target, key, target);
            if (
              (key !== "on" && key !== "removeListener") ||
              typeof value !== "function"
            )
              return value;
            return function forwardOnceOperation(...args) {
              if (key === "on") {
                const wrapped = args[1];
                defineProperty(wrapped, "listener", {
                  ...ownPropertyDescriptor(wrapped, "listener"),
                  value: listener,
                });
                weakMapSet(hookListenerRemovalTargets, wrapped, wrapped);
              }
              return applyFunction(value, target, args);
            };
          },
          set: (_target, key, value) => setProperty(target, key, value, target),
        },
      );
      const callback = createObservedOnceCallback(
        target,
        channel,
        listener,
        receiver,
      );
      const result = applyFunction(once, receiver, [channel, callback]);
      weakSetAdd(knownCanonicalListeners, listener);
      return result === receiver ? target : result;
    };
  const selectCanonicalRemovalArgument = (receiver, channel, removalTarget) => {
    if (isProxy(receiver)) return { kind: "unknown" };
    const eventMapDescriptor = ownPropertyDescriptor(receiver, "_events");
    if (
      eventMapDescriptor === undefined ||
      !hasOwnProperty(eventMapDescriptor, "value")
    )
      return { kind: "unknown" };
    const eventMap = eventMapDescriptor.value;
    if (eventMap === undefined) return { kind: "absent" };
    if (
      eventMap === null ||
      typeof eventMap !== "object" ||
      isProxy(eventMap) ||
      getPrototypeOf(eventMap) !== null
    )
      return { kind: "unknown" };
    const eventDescriptor = ownPropertyDescriptor(eventMap, channel);
    if (eventDescriptor === undefined) return { kind: "absent" };
    if (!hasOwnProperty(eventDescriptor, "value")) return { kind: "unknown" };
    const list = eventDescriptor.value;
    if (list === undefined) return { kind: "absent" };
    const examineEntry = (entry) => {
      if (entry === removalTarget)
        return { kind: "matched", nativeArgument: removalTarget };
      const ownedTarget = weakMapGet(hookListenerRemovalTargets, entry);
      if (ownedTarget === removalTarget) {
        const descriptor = listenerDataDescriptor(entry);
        return {
          kind: "matched",
          nativeArgument:
            descriptor !== null &&
            descriptor !== undefined &&
            hasOwnProperty(descriptor, "value") &&
            descriptor.value === removalTarget
              ? removalTarget
              : entry,
        };
      }
      const descriptor = listenerDataDescriptor(entry);
      // An application getter, Proxy or opaque descriptor may match or throw
      // during native removal. Do not pre-read it or choose an earlier entry;
      // let Node execute the original removal path exactly once.
      if (descriptor === null) return { kind: "unknown" };
      const linkedTarget = descriptor?.value;
      if (linkedTarget === removalTarget)
        return { kind: "matched", nativeArgument: removalTarget };
      if (
        weakMapGet(hookListenerRemovalTargets, linkedTarget) === removalTarget
      )
        return { kind: "matched", nativeArgument: linkedTarget };
      return null;
    };
    if (typeof list === "function")
      return examineEntry(list) ?? { kind: "absent" };
    if (isProxy(list)) return { kind: "unknown" };
    if (!arrayIsArray(list)) return { kind: "unknown" };
    const lengthDescriptor = ownPropertyDescriptor(list, "length");
    if (
      lengthDescriptor === undefined ||
      !hasOwnProperty(lengthDescriptor, "value") ||
      typeof lengthDescriptor.value !== "number" ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > 0xffffffff ||
      lengthDescriptor.value % 1 !== 0
    )
      return { kind: "unknown" };
    for (let index = lengthDescriptor.value - 1; index >= 0; index -= 1) {
      const entryDescriptor = ownPropertyDescriptor(list, index);
      if (
        entryDescriptor === undefined ||
        !hasOwnProperty(entryDescriptor, "value") ||
        typeof entryDescriptor.value !== "function"
      )
        return { kind: "unknown" };
      const selected = examineEntry(entryDescriptor.value);
      if (selected !== null) return selected;
    }
    return { kind: "absent" };
  };
  const removeWithCanonicalOwnership = (
    nativeMethod,
    receiver,
    args,
    boundary,
  ) => {
    const channel = args[0];
    const removalTarget = args[1];
    if (
      receiver !== ipcMain ||
      (typeof channel !== "string" && typeof channel !== "symbol") ||
      !weakSetHas(knownCanonicalListeners, removalTarget)
    )
      return applyFunction(nativeMethod, receiver, args);
    const selected = selectCanonicalRemovalArgument(
      receiver,
      channel,
      removalTarget,
    );
    if (selected.kind === "unknown")
      recordIpcObservationGap(
        typeof channel === "string" ? channel : null,
        "listener-removal",
        false,
        boundary,
      );
    if (
      selected.kind !== "matched" ||
      selected.nativeArgument === removalTarget
    )
      return applyFunction(nativeMethod, receiver, args);
    // Native removal must receive the argument identity that proves its newest
    // match. Preserve native ownership of traversal, mutation and meta-events.
    const nativeReceiver = new ProxyConstructor(
      { __proto__: null },
      {
        get(_target, key) {
          const value = getProperty(receiver, key, receiver);
          if (key !== "emit" || typeof value !== "function") return value;
          return function emitWithCanonicalRemovalMeta(event, ...eventArgs) {
            if (event === "removeListener") {
              if (eventArgs[1] === selected.nativeArgument) {
                eventArgs[1] = removalTarget;
              } else {
                const canonical = weakMapGet(
                  hookListenerRemovalTargets,
                  eventArgs[1],
                );
                if (canonical !== undefined && canonical !== eventArgs[1])
                  eventArgs[1] = canonical;
              }
            }
            return applyFunction(value, receiver, [event, ...eventArgs]);
          };
        },
        set(_target, key, value) {
          return setProperty(receiver, key, value, receiver);
        },
      },
    );
    const nativeArgs = [channel, selected.nativeArgument];
    for (let index = 2; index < args.length; index += 1)
      nativeArgs[index] = args[index];
    const result = applyFunction(nativeMethod, nativeReceiver, nativeArgs);
    return result === nativeReceiver ? receiver : result;
  };
  if (methodsKnown && typeof nativeRemoveListener === "function")
    ipcMain.removeListener = function patchedIpcMainRemoveListener(...args) {
      return removeWithCanonicalOwnership(
        nativeRemoveListener,
        this,
        args,
        "ipcMain.removeListener",
      );
    };
  if (methodsKnown && typeof nativeOff === "function")
    ipcMain.off = function patchedIpcMainOff(...args) {
      return removeWithCanonicalOwnership(nativeOff, this, args, "ipcMain.off");
    };
  if (!methodsKnown || typeof removeAllListeners !== "function") return;
  // Node owns its live-array traversal. A forwarding receiver translates only
  // our "on" entries before calling the current application removal method,
  // including decorators installed/replaced during traversal. Application
  // getters and methods always receive the real emitter; its public methods
  // are never temporarily replaced. Native once entries remain unchanged.
  ipcMain.removeAllListeners = function patchedIpcMainRemoveAllListeners(
    ...args
  ) {
    const emitter = this;
    if (emitter !== ipcMain)
      return applyFunction(removeAllListeners, emitter, args);
    // A separate empty target also permits forwarding a non-writable app
    // method; a Proxy of the emitter itself would violate get invariants.
    const receiver = new ProxyConstructor(
      { __proto__: null },
      {
        get(_target, key) {
          const value = getProperty(emitter, key, emitter);
          if (
            (key !== "removeListener" && key !== "removeAllListeners") ||
            typeof value !== "function"
          )
            return value;
          return (...methodArgs) => {
            if (key === "removeListener") {
              const entry = methodArgs[1];
              const removalTarget = weakMapGet(
                hookListenerRemovalTargets,
                entry,
              );
              // The registration registry owns the original callback even
              // when its public data link was deleted or changed. The native
              // boundary below still owns any accessor read and its outcome.
              if (removalTarget !== undefined && removalTarget !== entry)
                methodArgs[1] = removalTarget;
            }
            return applyFunction(value, emitter, methodArgs);
          };
        },
        set: (_target, key, value) => setProperty(emitter, key, value, emitter),
      },
    );
    const result = applyFunction(removeAllListeners, receiver, args);
    return result === receiver ? emitter : result;
  };
};

const patchNavigationMethods = (webContents, contentsId) => {
  for (const method of ["loadURL", "loadFile", "loadDataURL"]) {
    const original = webContents[method];
    if (typeof original !== "function") continue;
    webContents[method] = function patchedNavigation(...args) {
      recordRuntime("navigation", method, "attempted", {
        target: contentsId,
        argument_shape_values: args,
      });
      if (method === "loadURL" && !isAllowedNavigation(args[0])) {
        recordRuntime("navigation", method, "blocked", {
          target: contentsId,
          error: true,
        });
        return Promise.reject(new Error("External navigation is blocked"));
      }
      try {
        const result = original.apply(this, args);
        if (result !== null && typeof result?.then === "function")
          return result.then(
            (value) => {
              recordRuntime("navigation", method, "completed", {
                target: contentsId,
              });
              return value;
            },
            (cause) => {
              recordRuntime("navigation", method, "failed", {
                target: contentsId,
                error: true,
              });
              throw cause;
            },
          );
        recordRuntime("navigation", method, "completed", {
          target: contentsId,
        });
        return result;
      } catch (cause) {
        recordRuntime("navigation", method, "failed", {
          target: contentsId,
          error: true,
        });
        throw cause;
      }
    };
  }
};

const patchWebContentsIpc = (webContents, contentsId) => {
  const originalSend = webContents.send;
  if (typeof originalSend === "function")
    webContents.send = function patchedSend(channel, ...args) {
      const recorded = recordIpc("ipc-main-to-renderer", channel, args, {
        direction: "main-to-renderer",
        sender: "main",
        receiver: contentsId,
        target: contentsId,
        process_type: "main",
        error: false,
      });
      try {
        const result = originalSend.call(this, channel, ...args);
        if (recorded !== null) recorded.result_shape = shape(result);
        return result;
      } catch (cause) {
        if (recorded !== null) recorded.error = true;
        throw cause;
      }
    };
  const originalPostMessage = webContents.postMessage;
  if (typeof originalPostMessage === "function")
    webContents.postMessage = function patchedPostMessage(
      channel,
      message,
      transfer,
    ) {
      const recorded = recordIpc(
        "ipc-main-to-renderer",
        channel,
        [message, transfer],
        {
          direction: "main-to-renderer",
          sender: "main",
          receiver: contentsId,
          target: contentsId,
          process_type: "main",
          error: false,
        },
      );
      try {
        const result = originalPostMessage.call(
          this,
          channel,
          message,
          transfer,
        );
        if (recorded !== null) recorded.result_shape = shape(result);
        return result;
      } catch (cause) {
        if (recorded !== null) recorded.error = true;
        throw cause;
      }
    };
};

const patchWebContents = (webContents, windowId) => {
  if (webContents === null || webContents === undefined) return;
  const contentsId = identity(webContents, "webContents");
  patchEmitter(webContents, (event, args) => {
    const navigation = [
      "did-start-loading",
      "did-stop-loading",
      "did-finish-load",
      "did-fail-load",
      "did-frame-finish-load",
      "will-navigate",
      "will-redirect",
    ].includes(event);
    const kind = navigation
      ? "navigation"
      : [
            "console-message",
            "render-process-gone",
            "crashed",
            "unresponsive",
            "responsive",
          ].includes(event)
        ? "error"
        : event === "did-create-window"
          ? "popup-attempt"
          : "web-contents-lifecycle";
    if (event === "will-navigate" || event === "will-redirect") {
      if (!isAllowedNavigation(args[1])) {
        const preventDefault = args[0]?.preventDefault;
        if (typeof preventDefault === "function") preventDefault.call(args[0]);
        recordRuntime("navigation", event, "blocked", {
          target: contentsId,
          sender: windowId,
          argument_shape_values: args,
          error: true,
        });
        return;
      }
    }
    recordRuntime(kind, event, "observed", {
      target: contentsId,
      sender: windowId,
      argument_shape_values: args,
      error: kind === "error",
    });
    if (event === "did-create-window") {
      const childWindow = args[0];
      patchWebContents(
        childWindow?.webContents,
        identity(childWindow, "window"),
      );
    }
  });
  patchNavigationMethods(webContents, contentsId);
  patchWebContentsIpc(webContents, contentsId);
  boundaries.patchWindowOpenHandler(webContents, contentsId);
};

const patchWindows = (app) => {
  if (app === null || app === undefined) return;
  app.on("browser-window-created", (_event, window) => {
    const targetId = identity(window, "window");
    recordRuntime("window-lifecycle", "created", "completed", {
      target: targetId,
      capture_method: "event-emitter",
    });
    try {
      // Electron 44 separates the preload descriptor from WebPreferences.
      // Read the engine's descriptor, never infer a path from application code.
      const preferences = window.webContents.getLastWebPreferences?.();
      const preload =
        typeof preferences?.preload === "string"
          ? preferences.preload
          : window.webContents._getPreloadScript?.()?.filePath;
      if (typeof preload === "string")
        recordRuntime("preload", "configured", "completed", {
          target: targetId,
          artifact_path: preload,
        });
    } catch (cause) {
      recordRuntime(
        "error",
        cause instanceof Error ? cause.message : String(cause),
        "failed",
        {
          target: targetId,
          error: true,
        },
      );
    }
    patchEmitter(window, (event) =>
      recordRuntime("window-lifecycle", event, "observed", {
        target: targetId,
      }),
    );
    patchWebContents(window.webContents, targetId);
  });
};

const boundaries = createElectronActiveBoundaryPatches({
  identity,
  patchEmitter,
  processType,
  recordIpc,
  recordRuntime,
  shape,
});

try {
  const electron = require("electron");
  patchEmitter(electron.app, (event, args) =>
    recordRuntime(
      event === "open-url" || event === "second-instance"
        ? "protocol"
        : "app-lifecycle",
      event,
      "observed",
      {
        target: "app",
        argument_shape_values: args,
        process_type: "main",
      },
    ),
  );
  patchIpcMain(electron.ipcMain);
  boundaries.patchIpcRenderer(electron.ipcRenderer);
  boundaries.patchContextBridge(electron.contextBridge);
  patchWindows(electron.app);
  boundaries.patchUtilityProcess(electron.utilityProcess);
  boundaries.patchShell(electron.shell);
  boundaries.patchSessionManager(electron.session, electron.app);
  boundaries.patchApplicationEffects(electron.app);
  boundaries.patchNativeAddonLoading();
  boundaries.patchChildProcess();
  process.once("uncaughtException", (cause, origin) => {
    recordRuntime("process-lifecycle", "uncaught-exception", "observed", {
      argument_shape_values: [cause, origin],
      error: true,
    });
    throw cause;
  });
  process.once("unhandledRejection", (reason, promise) => {
    recordRuntime("process-lifecycle", "unhandled-rejection", "observed", {
      argument_shape_values: [reason, promise],
      error: true,
    });
    throw reason;
  });
} catch (cause) {
  globalThis.__reaElectronActiveHookError = true;
  recordRuntime(
    "error",
    cause instanceof Error ? cause.message : String(cause),
    "failed",
    {
      target: "active-hook-installation",
      error: true,
    },
  );
}

// Never expose retained buffers to application iterators or array constructors.
const snapshotArray = (values, project) =>
  arrayFrom({ __proto__: null, length: values.length }, (_unused, index) =>
    project === undefined ? values[index] : project(values[index]),
  );

const snapshotCounts = (counts, field) => {
  const values = { __proto__: null, length: 0 };
  forEachMapEntry(counts, (count, value) => {
    values[values.length++] = { [field]: value, count };
  });
  return arrayFrom(values);
};

globalThis.__reaElectronActiveSnapshot = () => ({
  events: snapshotArray(events, (event) => ({
    ...event,
    argument_shapes: snapshotArray(event.argument_shapes),
  })),
  retention_budget_bytes: retentionBudgetBytes,
  estimated_retained_bytes: estimatedRetainedBytes,
  event_serialized_byte_upper_bound: serializedBytes,
  retained: events.length,
  dropped,
  dropped_ipc: droppedIpc,
  dropped_runtime: droppedRuntime,
  dropped_event_families: snapshotCounts(droppedFamilies, "family"),
  dropped_event_roles: snapshotCounts(droppedRoles, "role"),
  observed,
  observed_ipc: observedIpc,
  observed_runtime: observedRuntime,
  hook_error: globalThis.__reaElectronActiveHookError === true,
});
