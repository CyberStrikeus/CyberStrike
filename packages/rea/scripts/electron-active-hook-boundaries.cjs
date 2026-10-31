"use strict";

// oxlint-disable-next-line max-lines-per-function -- all adapters must close over one bounded capture context.
const createElectronActiveBoundaryPatches = ({
  identity,
  patchEmitter,
  processType,
  recordIpc,
  recordRuntime,
  shape,
}) => {
  const patchedSessions = new WeakSet();
  const patchIpcRenderer = (ipcRenderer) => {
    if (ipcRenderer === null || ipcRenderer === undefined) return;
    for (const [method, kind] of [
      ["send", "ipc-renderer-send"],
      ["sendSync", "ipc-renderer-send"],
      ["invoke", "ipc-renderer-invoke"],
      ["postMessage", "ipc-renderer-post-message"],
    ]) {
      const original = ipcRenderer[method];
      if (typeof original !== "function") continue;
      ipcRenderer[method] = function patchedRendererIpc(channel, ...args) {
        const recorded = recordIpc(kind, channel, args, {
          direction: "renderer-to-main",
          sender: processType(),
          receiver: "main",
          frame: null,
          process_type: processType(),
          error: false,
        });
        try {
          const result = original.call(this, channel, ...args);
          if (result !== null && typeof result?.then === "function")
            return result.then(
              (value) => {
                if (recorded !== null) recorded.result_shape = shape(value);
                return value;
              },
              (cause) => {
                if (recorded !== null) recorded.error = true;
                throw cause;
              },
            );
          if (recorded !== null) recorded.result_shape = shape(result);
          return result;
        } catch (cause) {
          if (recorded !== null) recorded.error = true;
          throw cause;
        }
      };
    }
  };

  const patchContextBridge = (contextBridge) => {
    if (contextBridge === null || contextBridge === undefined) return;
    for (const method of ["exposeInMainWorld", "exposeInIsolatedWorld"]) {
      const original = contextBridge[method];
      if (typeof original !== "function") continue;
      contextBridge[method] = function patchedContextBridge(...args) {
        const target = typeof args[0] === "string" ? args[0] : null;
        recordRuntime("preload", "context-bridge-exposure", "attempted", {
          target,
          argument_shape_values: args,
          process_type: processType(),
        });
        try {
          const result = original.apply(this, args);
          recordRuntime("preload", "context-bridge-exposure", "completed", {
            target,
            process_type: processType(),
          });
          return result;
        } catch (cause) {
          recordRuntime("preload", "context-bridge-exposure", "failed", {
            target,
            error: true,
            process_type: processType(),
          });
          throw cause;
        }
      };
    }
  };

  const patchSession = (session) => {
    if (session === null || session === undefined) return;
    if (
      (typeof session !== "object" && typeof session !== "function") ||
      patchedSessions.has(session)
    )
      return;
    patchedSessions.add(session);
    patchEmitter(session, (event, args) => {
      const kind =
        event === "will-download"
          ? "download"
          : event.includes("certificate") || event.includes("permission")
            ? "permission"
            : event.includes("window") || event.includes("popup")
              ? "popup-attempt"
              : "web-contents-lifecycle";
      if (event === "will-download") {
        const cancel = args[1]?.cancel;
        if (typeof cancel === "function") cancel.call(args[1]);
      }
      recordRuntime(
        kind,
        event,
        event === "will-download" ? "blocked" : "observed",
        {
          target: identity(args[0], "webContents"),
          argument_shape_values: args,
          error: event === "will-download",
        },
      );
    });
    const originalPermissionRequest = session.setPermissionRequestHandler;
    if (typeof originalPermissionRequest === "function")
      session.setPermissionRequestHandler =
        function blockedPermissionRequest() {
          return originalPermissionRequest.call(
            this,
            (webContents, permission, callback) => {
              recordRuntime("permission", "permission-request", "blocked", {
                target: identity(webContents, "webContents"),
                argument_shape_values: [permission],
                error: true,
              });
              if (typeof callback === "function") callback(false);
            },
          );
        };
    const originalPermissionCheck = session.setPermissionCheckHandler;
    if (typeof originalPermissionCheck === "function")
      session.setPermissionCheckHandler = function blockedPermissionCheck() {
        return originalPermissionCheck.call(this, (webContents, permission) => {
          recordRuntime("permission", "permission-check", "blocked", {
            target: identity(webContents, "webContents"),
            argument_shape_values: [permission],
            error: true,
          });
          return false;
        });
      };
    const originalCertificate = session.setCertificateVerifyProc;
    if (typeof originalCertificate === "function")
      session.setCertificateVerifyProc = function blockedCertificate() {
        return originalCertificate.call(this, (request, callback) => {
          recordRuntime("permission", "certificate-error", "blocked", {
            argument_shape_values: [request],
            error: true,
          });
          if (typeof callback === "function") callback(-2);
        });
      };
  };

  const patchWindowOpenHandler = (webContents, contentsId) => {
    if (webContents === null || webContents === undefined) return;
    const original = webContents.setWindowOpenHandler;
    if (typeof original !== "function") return;
    const createGuardedHandler =
      (handler) =>
      (...args) => {
        try {
          if (typeof handler === "function") handler(...args);
        } catch {
          recordRuntime("popup-attempt", "window-open-handler", "failed", {
            target: contentsId,
            argument_shape_values: args,
            error: true,
          });
          return { action: "deny" };
        }
        recordRuntime("popup-attempt", "window-open-handler", "blocked", {
          target: contentsId,
          argument_shape_values: args,
          error: true,
        });
        return { action: "deny" };
      };
    try {
      original.call(webContents, createGuardedHandler(undefined));
    } catch {
      recordRuntime("popup-attempt", "window-open-handler-install", "failed", {
        target: contentsId,
        error: true,
      });
    }
    webContents.setWindowOpenHandler = function blockedWindowOpenHandler(
      handler,
    ) {
      return original.call(this, createGuardedHandler(handler));
    };
  };

  const patchSessionManager = (sessionModule, app) => {
    if (sessionModule === null || sessionModule === undefined) return;
    if (app === undefined || app.isReady())
      patchSession(sessionModule.defaultSession);
    else app.once("ready", () => patchSession(sessionModule.defaultSession));
    for (const method of ["fromPartition", "fromPath"]) {
      const original = sessionModule[method];
      if (typeof original !== "function") continue;
      sessionModule[method] = function patchedSessionFactory(...args) {
        const session = original.apply(this, args);
        patchSession(session);
        return session;
      };
    }
  };

  const patchApplicationEffects = (app) => {
    if (app === null || app === undefined) return;
    for (const method of [
      "moveToApplicationsFolder",
      "relaunch",
      "setAsDefaultProtocolClient",
      "setLoginItemSettings",
    ]) {
      const original = app[method];
      if (typeof original !== "function") continue;
      app[method] = function blockedApplicationEffect(...args) {
        recordRuntime(
          method === "relaunch"
            ? "updater"
            : method === "moveToApplicationsFolder"
              ? "app-lifecycle"
              : "protocol",
          method,
          "blocked",
          { argument_shape_values: args, error: true },
        );
        return method === "setAsDefaultProtocolClient" ||
          method === "moveToApplicationsFolder"
          ? false
          : undefined;
      };
    }
  };

  const patchNativeAddonLoading = () => {
    const original = process.dlopen;
    if (typeof original !== "function") return;
    process.dlopen = function patchedDlopen(module, filename, ...args) {
      let digest = null;
      try {
        const fs = require("node:fs");
        const crypto = require("node:crypto");
        const stat = fs.statSync(filename);
        if (stat.isFile() && stat.size <= 16 * 1024 * 1024)
          digest = crypto
            .createHash("sha256")
            .update(fs.readFileSync(filename))
            .digest("hex");
      } catch {
        digest = null;
      }
      recordRuntime("native-addon", "dlopen", "attempted", {
        artifact_path: typeof filename === "string" ? filename : null,
        artifact_sha256: digest,
        argument_shape_value_groups: [[module, filename], args],
      });
      try {
        const result = original.call(this, module, filename, ...args);
        recordRuntime("native-addon", "dlopen", "completed", {
          artifact_path: typeof filename === "string" ? filename : null,
          artifact_sha256: digest,
        });
        return result;
      } catch (cause) {
        recordRuntime("native-addon", "dlopen", "failed", {
          artifact_path: typeof filename === "string" ? filename : null,
          artifact_sha256: digest,
          error: true,
        });
        throw cause;
      }
    };
  };

  const patchUtilityProcess = (utilityProcess) => {
    if (utilityProcess === null || utilityProcess === undefined) return;
    const original = utilityProcess.fork;
    if (typeof original !== "function") return;
    utilityProcess.fork = function patchedFork(...args) {
      recordRuntime("process-lifecycle", "utility-process-fork", "attempted", {
        argument_shape_values: args,
        process_type: "main",
      });
      const child = original.apply(this, args);
      const childId = identity(child, "utility");
      recordRuntime("process-lifecycle", "utility-process-fork", "completed", {
        target: childId,
        process_type: "main",
      });
      patchEmitter(child, (event, eventArgs) => {
        if (event === "message") {
          recordIpc("ipc-utility-to-main", null, eventArgs, {
            direction: "utility-to-main",
            sender: childId,
            receiver: "main",
            target: childId,
            process_type: "main",
            error: false,
          });
          return;
        }
        recordRuntime("process-lifecycle", `utility.${event}`, "observed", {
          target: childId,
          process_type: "utility",
          argument_shape_values: eventArgs,
        });
      });
      if (child && typeof child.postMessage === "function") {
        const postMessage = child.postMessage.bind(child);
        child.postMessage = (...messageArgs) => {
          const recorded = recordIpc(
            "utility-process-message",
            null,
            messageArgs,
            {
              direction: "main-to-utility",
              sender: "main",
              receiver: childId,
              target: childId,
              process_type: "main",
              error: false,
            },
          );
          try {
            const result = postMessage(...messageArgs);
            if (recorded !== null) recorded.result_shape = shape(result);
            return result;
          } catch (cause) {
            if (recorded !== null) recorded.error = true;
            throw cause;
          }
        };
      }
      return child;
    };
  };

  // Each blocked method keeps the return contract of the Electron API it
  // replaces, so a target that checks the result sees an ordinary refusal.
  const blockedShellResults = {
    openExternal: () =>
      Promise.reject(new Error("External shell effects are blocked")),
    openPath: () =>
      Promise.reject(new Error("External shell effects are blocked")),
    trashItem: () =>
      Promise.reject(new Error("External shell effects are blocked")),
    // Synchronous `void`: reveals a path in the host file manager.
    showItemInFolder: () => undefined,
    // Synchronous `boolean`: creates or replaces a Windows shortcut file.
    writeShortcutLink: () => false,
  };

  const patchShell = (shell) => {
    if (shell === null || shell === undefined) return;
    for (const [method, blockedResult] of Object.entries(blockedShellResults)) {
      const original = shell[method];
      if (typeof original !== "function") continue;
      shell[method] = function blockedShellCall(...args) {
        recordRuntime("shell-attempt", method, "blocked", {
          argument_shape_values: args,
          error: true,
        });
        return blockedResult();
      };
    }
  };

  const patchChildProcess = () => {
    const childProcess = require("node:child_process");
    for (const method of ["spawn", "fork", "exec", "execFile"]) {
      const original = childProcess[method];
      if (typeof original !== "function") continue;
      childProcess[method] = function patchedChildProcess(...args) {
        recordRuntime("process-lifecycle", `child.${method}`, "attempted", {
          argument_shape_values: args,
        });
        const child = original.apply(this, args);
        const childId = identity(child, "child");
        recordRuntime("process-lifecycle", `child.${method}`, "completed", {
          target: childId,
        });
        patchEmitter(child, (event, eventArgs) =>
          recordRuntime("process-lifecycle", `child.${event}`, "observed", {
            target: childId,
            argument_shape_values: eventArgs,
          }),
        );
        return child;
      };
    }
  };

  return {
    patchApplicationEffects,
    patchChildProcess,
    patchContextBridge,
    patchIpcRenderer,
    patchNativeAddonLoading,
    patchSession,
    patchSessionManager,
    patchShell,
    patchWindowOpenHandler,
    patchUtilityProcess,
  };
};

module.exports = { createElectronActiveBoundaryPatches };
