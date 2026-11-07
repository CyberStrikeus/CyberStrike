import type {
  JavaScriptSourceRange,
  JavaScriptStaticPathContext,
} from "./javascriptStaticAnalysisTypes.js";

/** One inert literal or unresolved expression observed in Electron syntax. */
export type ElectronStaticValue =
  | {
      readonly status: "literal";
      readonly value: string | number | boolean | null;
      readonly expression: null;
    }
  | {
      readonly status: "dynamic";
      readonly value: null;
      readonly expression: string;
    };

/** One explicitly present BrowserWindow webPreference. */
export interface ElectronWebPreference {
  readonly name: string;
  readonly value: ElectronStaticValue;
}

/** A statically resolved BrowserWindow preload declaration, or its absence. */
export type ElectronBrowserWindowPreload =
  | {
      readonly preload_path: string;
      readonly preload_resolution_context: JavaScriptStaticPathContext;
    }
  | {
      readonly preload_path: null;
      readonly preload_resolution_context: null;
    };

/** Statically visible BrowserWindow construction and preference surface. */
export type ElectronBrowserWindowFinding = ElectronBrowserWindowPreload & {
  readonly options_status: "object-literal" | "dynamic" | "missing";
  readonly web_preferences_status: "object-literal" | "dynamic" | "missing";
  readonly web_preferences: readonly ElectronWebPreference[];
  /** Object syntax supporting constant substitution, separate from construction. */
  readonly resolution_sources?: readonly JavaScriptSourceRange[];
  readonly module_key: string | null;
  /** Recovered factory runtime; absent in older or unbundled findings. */
  readonly module_runtime?: string;
  readonly location: JavaScriptSourceRange;
};

/** Literal, dynamic, or unsupported contextBridge API key syntax. */
export type ElectronContextBridgeApiKey =
  | { readonly api_key: string; readonly api_key_expression: null }
  | { readonly api_key: null; readonly api_key_expression: string }
  | { readonly api_key: null; readonly api_key_expression: null };

/** One contextBridge API declaration without executing its API object. */
export type ElectronContextBridgeFinding = ElectronContextBridgeApiKey & {
  readonly resolution_basis?: "wrapper-substitution";
  readonly world: "main" | "isolated";
  readonly world_id: ElectronStaticValue | null;
  readonly api_status: "object-literal" | "dynamic" | "missing";
  readonly members: readonly string[];
  readonly unknown_members: number;
  readonly module_key: string | null;
  /** Recovered factory runtime; absent in older or unbundled findings. */
  readonly module_runtime?: string;
  readonly location: JavaScriptSourceRange;
};

/** Electron IPC operation identity and its semantic communication mode. */
export type ElectronIpcDescriptor =
  | {
      readonly side: "renderer";
      readonly operation:
        | "send"
        | "send-sync"
        | "post-message"
        | "send-to-host";
      readonly mode: "send";
    }
  | {
      readonly side: "renderer";
      readonly operation: "invoke";
      readonly mode: "invoke";
    }
  | {
      readonly side: "renderer" | "main";
      readonly operation: "on" | "once";
      readonly mode: "listen";
    }
  | {
      readonly side: "main";
      readonly operation: "handle" | "handle-once";
      readonly mode: "handle";
    };

type ElectronIpcHandler =
  | {
      readonly mode: "send" | "invoke";
      readonly handler_kind: null;
      readonly handler_location: null;
    }
  | {
      readonly mode: "listen" | "handle";
      readonly handler_kind: "missing";
      readonly handler_location: null;
    }
  | {
      readonly mode: "listen" | "handle";
      readonly handler_kind:
        | "inline-function"
        | "identifier"
        | "member-expression"
        | "dynamic-expression";
      readonly handler_location: JavaScriptSourceRange;
    };

export interface ElectronIpcReceiver {
  readonly kind: "web-contents" | "main-frame";
  /** Constructor syntax allocation, never a runtime frame identifier. */
  readonly owner_location: JavaScriptSourceRange;
}

interface ElectronIpcFindingContext {
  readonly receiver?: ElectronIpcReceiver;
  /** Absent on direct syntax observations; wrappers require inferred evidence. */
  readonly resolution_basis?: "wrapper-substitution";
  readonly module_key: string | null;
  /** Recovered factory runtime; absent in older or unbundled findings. */
  readonly module_runtime?: string;
  readonly location: JavaScriptSourceRange;
  /** Outer syntax invocation when a wrapper produced this underlying IPC call. */
  readonly invocation_location?: JavaScriptSourceRange;
}

/** One statically visible Electron IPC send, invocation, listener, or handler. */
export type ElectronIpcFinding = ElectronIpcDescriptor &
  ElectronIpcHandler &
  ElectronIpcFindingContext &
  (
    | { readonly channel: string; readonly channel_expression: null }
    | {
        readonly channel: null;
        readonly channel_expression: string;
        /**
         * Every invocation of this site is a traced direct call that supplied a
         * literal channel, recorded as its own wrapper-substitution finding or
         * guarded call path. Absent when any invocation may supply another value.
         */
        readonly invocation_channels?: "literal";
        /**
         * Channels from guarded invocations, which keep their predicate on a
         * call path instead of becoming findings. Each still competes for its
         * channel in pairing.
         */
        readonly guarded_invocation_channels?: readonly string[];
      }
  );

/** Static check involving an IPC sender, frame, process, URL, or origin. */
export interface ElectronSenderValidationFinding {
  readonly subject:
    | "sender-url"
    | "sender-origin"
    | "sender-frame"
    | "sender-id"
    | "frame-id"
    | "process-id";
  readonly mechanism: string;
  readonly expected: ElectronStaticValue;
  readonly enforcement: "unknown";
  readonly module_key: string | null;
  /** Recovered factory runtime; absent in older or unbundled findings. */
  readonly module_runtime?: string;
  readonly location: JavaScriptSourceRange;
}

interface ElectronUtilityProcessFindingState {
  readonly service_name: string | null;
  readonly module_key: string | null;
  /** Recovered factory runtime; absent in older or unbundled findings. */
  readonly module_runtime?: string;
  readonly location: JavaScriptSourceRange;
}

/** One utilityProcess.fork declaration and its statically visible entrypoint. */
export type ElectronUtilityProcessFinding = ElectronUtilityProcessFindingState &
  (
    | {
        readonly module_path: string;
        readonly module_resolution_context: JavaScriptStaticPathContext;
        readonly module_expression: null;
      }
    | {
        readonly module_path: null;
        readonly module_resolution_context: null;
        readonly module_expression: string;
      }
  );

/** JavaScript-side binding or re-export requested from one native .node addon. */
export interface ElectronNativeAddonBindingFinding {
  readonly specifier: string;
  readonly binding_kind: "import" | "require" | "re-export";
  readonly module_kind: "import" | "require";
  /** Exact requested addon member keys; namespace and dynamic access are separate. */
  readonly members: readonly string[];
  /** Omitted in legacy findings; omission means unknown, not false. */
  readonly namespace_access?: boolean;
  readonly dynamic_member_access?: boolean;
  readonly module_key: string | null;
  /** Recovered factory runtime; absent in older or unbundled findings. */
  readonly module_runtime?: string;
  readonly location: JavaScriptSourceRange;
}

/**
 * One custom URL scheme registration call observed at an Electron `app` or
 * `protocol` call site. Successful registration, control-flow reachability
 * and operating-system or session routing remain unproven.
 */
export interface ElectronProtocolFinding {
  /** The exact Electron member called. */
  readonly api: string;
  /**
   * `os-default-client`: `app.setAsDefaultProtocolClient`, which asks the OS to
   * open the scheme's links in this app; `privileged-scheme`: an entry passed to
   * `protocol.registerSchemesAsPrivileged`; `handler` and `interceptor`:
   * `protocol.handle`/`register*Protocol` and `intercept*Protocol`.
   */
  readonly role:
    | "os-default-client"
    | "privileged-scheme"
    | "handler"
    | "interceptor";
  readonly scheme: ElectronStaticValue;
  /** `session.defaultSession.protocol` rather than the default `protocol` module. */
  readonly session: "default-protocol" | "default-session";
  /** Privilege keys with a literal `true`; null unless `role` is `privileged-scheme` with a literal object. */
  readonly enabled_privileges: readonly string[] | null;
  readonly module_key: string | null;
  /** Recovered factory runtime; absent in older or unbundled findings. */
  readonly module_runtime?: string;
  readonly location: JavaScriptSourceRange;
}

/** All Electron-specific facts collected during one shared AST traversal. */
export interface ElectronStaticFindings {
  /** Calls that may replace the application path used by Electron loadFile. */
  readonly app_path_changes?: readonly ElectronAppPathChangeFinding[];
  readonly browser_windows: readonly ElectronBrowserWindowFinding[];
  readonly context_bridge_apis: readonly ElectronContextBridgeFinding[];
  readonly ipc: readonly ElectronIpcFinding[];
  readonly sender_validations: readonly ElectronSenderValidationFinding[];
  readonly utility_processes: readonly ElectronUtilityProcessFinding[];
  readonly native_addon_bindings: readonly ElectronNativeAddonBindingFinding[];
  readonly protocols: readonly ElectronProtocolFinding[];
  /** Source-bound candidate paths through bundled exports and IPC closures. */
  readonly call_paths?: readonly ElectronCallPath[];
}

/** An Electron application path setter invocation or bound delegate capture. */
export interface ElectronAppPathChangeFinding {
  readonly module_key: string | null;
  readonly module_runtime?: string;
  readonly location: JavaScriptSourceRange;
}

export interface ElectronCallPathStep {
  readonly kind:
    | "exposure"
    | "factory"
    | "function"
    | "call"
    | "ipc"
    | "terminal";
  readonly label: string;
  readonly location: JavaScriptSourceRange;
  readonly module_key: string | null;
  readonly module_runtime: string | null;
}

/** A statically substituted candidate, never a runtime reachability claim. */
export interface ElectronCallPath {
  readonly entry_kind: "bridge-member" | "ipc-handler";
  readonly entry: string;
  /** Exact bridge API and property segments; `entry` remains display text. */
  readonly entry_path?: readonly string[];
  readonly channel: string | null;
  readonly terminal: string;
  readonly resolution: "candidate";
  readonly steps: readonly ElectronCallPathStep[];
  readonly conditions: readonly {
    readonly expression: string;
    readonly location: JavaScriptSourceRange;
  }[];
}
