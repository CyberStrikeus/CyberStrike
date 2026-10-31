// Controlled producer oracle, not real-application/provider evidence. Stage
// this file beside a minimal Electron module and the actual unmodified hook.
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

if (process.argv[2]) await import(pathToFileURL(process.argv[2]));
// Match the hook's CommonJS module identity. Electron's ESM bare-module
// resolver can select its builtin even when run as Node with a staged fixture.
const { ipcMain } = createRequire(import.meta.url)("electron");
if (globalThis.__reaElectronActiveSnapshot?.().hook_error !== false)
  throw new Error("The canonical hook must be installed without errors");

const modes = [
  "plain",
  "call-opaque",
  "apply-opaque",
  "call-readonly",
  "apply-readonly",
  "call-getter",
  "apply-getter",
  "call-throwing-getter",
  "apply-throwing-getter",
  "call-non-callable",
  "apply-non-callable",
];

const execute = (emitter, channel, mode, argumentCount) => {
  let bodyCalls = 0;
  let correctReceiver = true;
  const trace = [];
  const listener = function listener() {
    bodyCalls += 1;
    correctReceiver &&= this === emitter;
    trace.push(`body:${arguments.length}`);
  };
  if (mode !== "plain") {
    const method = mode.startsWith("call") ? "call" : "apply";
    const opaque = () => trace.push(`opaque:${method}`);
    if (mode.includes("getter"))
      Object.defineProperty(listener, method, {
        get() {
          trace.push(`get:${method}`);
          if (mode.includes("throwing")) throw new Error(`getter:${method}`);
          return opaque;
        },
      });
    else if (mode.includes("readonly"))
      Object.defineProperty(listener, method, { value: opaque });
    else listener[method] = mode.includes("non-callable") ? null : opaque;
  }
  emitter.once(channel, listener);
  let error = null;
  try {
    emitter.emit(
      channel,
      ...Array.from({ length: argumentCount }, (_, i) => i),
    );
    emitter.emit(channel, "must-not-run-twice");
  } catch (cause) {
    error = String(cause);
  }
  return {
    body_calls: bodyCalls,
    correct_receiver: correctReceiver,
    trace,
    error,
    listeners_after: emitter.listenerCount(channel),
  };
};

const rows = [];
for (const mode of modes)
  for (const argumentCount of [0, 1, 3]) {
    const channel = `${mode}:${argumentCount}`;
    const native = execute(new EventEmitter(), channel, mode, argumentCount);
    const hooked = execute(ipcMain, channel, mode, argumentCount);
    const events = globalThis
      .__reaElectronActiveSnapshot()
      .events.filter((event) => event.channel === channel);
    rows.push({
      mode,
      argument_count: argumentCount,
      native,
      hooked,
      semantic_match: JSON.stringify(native) === JSON.stringify(hooked),
      observation: events.map(({ kind, event, error }) => ({
        kind,
        event,
        error,
      })),
    });
  }

const additional = (mode, scenario) => {
  const channel = `metadata:${mode}`;
  const native = scenario(new EventEmitter(), channel);
  const hooked = scenario(ipcMain, channel);
  rows.push({
    mode,
    argument_count: 0,
    native,
    hooked,
    semantic_match: JSON.stringify(native) === JSON.stringify(hooked),
    observation: globalThis
      .__reaElectronActiveSnapshot()
      .events.filter((event) => event.channel === channel)
      .map(({ kind, event, error }) => ({ kind, event, error })),
  });
};

additional("inherited-listener-setter", (emitter, channel) => {
  const original = Object.getOwnPropertyDescriptor(
    Function.prototype,
    "listener",
  );
  const writes = [];
  let bodyCalls = 0;
  const listener = () => {
    bodyCalls += 1;
  };
  Object.defineProperty(Function.prototype, "listener", {
    configurable: true,
    set(value) {
      writes.push(value === listener);
    },
  });
  let error = null;
  try {
    emitter.once(channel, listener);
  } catch (cause) {
    error = String(cause);
  } finally {
    if (original)
      Object.defineProperty(Function.prototype, "listener", original);
    else delete Function.prototype.listener;
  }
  const publicIdentity =
    emitter.rawListeners(channel)[0]?.listener === listener;
  emitter.emit(channel);
  return {
    body_calls: bodyCalls,
    writes,
    public_identity: publicIdentity,
    error,
  };
});

additional("on-getter-listener-setter", (emitter, channel) => {
  const prototypeMetadata = Object.getOwnPropertyDescriptor(
    Function.prototype,
    "listener",
  );
  const onMetadata = Object.getOwnPropertyDescriptor(emitter, "on");
  const on = emitter.on;
  let reads = 0,
    bodyCalls = 0,
    error = null;
  const writes = [];
  const listener = () => {
    bodyCalls += 1;
  };
  Object.defineProperty(emitter, "on", {
    configurable: true,
    get() {
      reads += 1;
      Object.defineProperty(Function.prototype, "listener", {
        configurable: true,
        set(value) {
          writes.push(value === listener);
        },
      });
      return on;
    },
  });
  try {
    emitter.once(channel, listener);
  } catch (cause) {
    error = String(cause);
  } finally {
    if (prototypeMetadata)
      Object.defineProperty(Function.prototype, "listener", prototypeMetadata);
    else delete Function.prototype.listener;
    if (onMetadata) Object.defineProperty(emitter, "on", onMetadata);
    else delete emitter.on;
  }
  const publicIdentity =
    emitter.rawListeners(channel)[0]?.listener === listener;
  emitter.emit(channel);
  return {
    body_calls: bodyCalls,
    reads,
    writes,
    public_identity: publicIdentity,
    error,
  };
});

additional("on-getter-native-alias", (emitter, channel) => {
  const original = Object.getOwnPropertyDescriptor(emitter, "on");
  let reads = 0,
    bodyCalls = 0;
  const listener = () => {
    bodyCalls += 1;
  };
  Object.defineProperty(emitter, "on", {
    configurable: true,
    get() {
      reads += 1;
      return EventEmitter.prototype.on;
    },
  });
  try {
    emitter.once(channel, listener);
  } finally {
    if (original) Object.defineProperty(emitter, "on", original);
    else delete emitter.on;
  }
  emitter.emit(channel);
  return {
    body_calls: bodyCalls,
    reads,
    listeners_after: emitter.listenerCount(channel),
  };
});

additional("on-getter-native-alias-throws", (emitter, channel) => {
  const original = Object.getOwnPropertyDescriptor(emitter, "on");
  const failure = new Error("registered-before-error");
  let bodyCalls = 0,
    sameError = false;
  const listener = () => {
    bodyCalls += 1;
  };
  Object.defineProperty(emitter, "on", {
    configurable: true,
    get() {
      return function registerThenThrow(name, callback) {
        EventEmitter.prototype.on.call(this, name, callback);
        throw failure;
      };
    },
  });
  try {
    emitter.once(channel, listener);
  } catch (cause) {
    sameError = cause === failure;
  } finally {
    if (original) Object.defineProperty(emitter, "on", original);
    else delete emitter.on;
  }
  const publicIdentity =
    emitter.rawListeners(channel)[0]?.listener === listener;
  emitter.emit(channel);
  return {
    body_calls: bodyCalls,
    same_error: sameError,
    public_identity: publicIdentity,
    listeners_after: emitter.listenerCount(channel),
  };
});

additional("throwing-listener-setter", (emitter, channel) => {
  const original = Object.getOwnPropertyDescriptor(
    Function.prototype,
    "listener",
  );
  const writes = [];
  let bodyCalls = 0,
    error = null;
  const listener = () => {
    bodyCalls += 1;
  };
  Object.defineProperty(Function.prototype, "listener", {
    configurable: true,
    set(value) {
      writes.push(value === listener);
      throw new Error("metadata-write");
    },
  });
  try {
    emitter.once(channel, listener);
  } catch (cause) {
    error = String(cause);
  } finally {
    if (original)
      Object.defineProperty(Function.prototype, "listener", original);
    else delete Function.prototype.listener;
  }
  // A failed registration must not leave later registrations unobservable.
  emitter.on(channel, listener);
  emitter.emit(channel);
  return {
    body_calls: bodyCalls,
    writes,
    error,
    listeners_after: emitter.listenerCount(channel),
  };
});

additional("readonly-emitter-methods", (emitter, channel) => {
  const seen = [];
  for (const key of ["on", "removeListener"]) {
    const original = emitter[key];
    Object.defineProperty(emitter, key, {
      value: function readonlyMethod(...args) {
        seen.push(`${key}:${this === emitter}`);
        return Reflect.apply(original, this, args);
      },
      configurable: false,
      writable: false,
    });
  }
  let bodyCalls = 0,
    error = null;
  const listener = () => {
    bodyCalls += 1;
  };
  try {
    emitter.once(channel, listener);
    emitter.emit(channel);
  } catch (cause) {
    error = String(cause);
  }
  return { body_calls: bodyCalls, seen, error };
});
console.log(
  JSON.stringify({
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    cases: rows.length,
    disagreements: rows.filter((row) => !row.semantic_match).length,
    rows,
  }),
);
