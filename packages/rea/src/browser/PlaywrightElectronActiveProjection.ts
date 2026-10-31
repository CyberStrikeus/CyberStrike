import {
  electronActiveObservationResultSchema,
  type ElectronActiveObservationResult,
} from "../domain/javascript/electronActiveObservation.js";
import type {
  ElectronHookEvent,
  ElectronHookSnapshot,
  ElectronMetrics,
} from "./PlaywrightElectronActiveActions.js";

type ElectronCapturePaths = {
  readonly executable: string;
  readonly application: string;
};

type ElectronCaptureState = {
  readonly windows: ReadonlyArray<
    ElectronActiveObservationResult["windows"][number]
  >;
  readonly metrics: ElectronMetrics;
  readonly electronVersion: string;
  readonly hookSnapshot: ElectronHookSnapshot;
};

const observableEventFamilies = [
  "app-lifecycle",
  "window-lifecycle",
  "web-contents-lifecycle",
  "navigation",
  "shell-attempt",
  "process-lifecycle",
  "permission",
  "popup-attempt",
  "download",
  "protocol",
  "preload",
  "preload-configuration",
  "renderer-ipc",
  "native-addon",
  "updater",
  "error",
  "ipc",
] as const;

const ipcEventKinds = new Set<ElectronHookEvent["kind"]>([
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

const eventFamily = (
  kind: ElectronHookEvent["kind"],
  processType: string | null,
): string => {
  if (
    kind === "preload" &&
    (processType === "main" || processType === "browser")
  )
    return "preload-configuration";
  if (kind.startsWith("ipc-renderer"))
    return processType === "renderer" ? "renderer-ipc" : "ipc";
  return ipcEventKinds.has(kind) ? "ipc" : kind;
};

const normalizeObservations = (hookSnapshot: ElectronHookSnapshot) => {
  const observedEventFamilies = [
    ...new Set([
      ...hookSnapshot.events.map(({ kind, process_type }) =>
        eventFamily(kind, process_type),
      ),
      ...hookSnapshot.dropped_event_families.map(({ family }) => family),
    ]),
  ].sort();
  const observedRoles = [
    ...new Set([
      ...hookSnapshot.events.flatMap(({ process_type, kind }) => [
        ...(process_type === null ? [] : [process_type]),
        ...(kind === "window-lifecycle" ? ["window"] : []),
        ...(kind === "web-contents-lifecycle" || kind === "navigation"
          ? ["web_contents"]
          : []),
        ...(kind === "preload" && process_type === "preload"
          ? ["preload"]
          : []),
        ...(kind.startsWith("ipc-renderer") && process_type === "renderer"
          ? ["renderer"]
          : []),
      ]),
      ...hookSnapshot.dropped_event_roles.map(({ role }) => role),
    ]),
  ].sort();
  return { observedEventFamilies, observedRoles };
};

const createCoverage = (
  hookSnapshot: ElectronHookSnapshot,
  observations: ReturnType<typeof normalizeObservations>,
) => {
  const { observedEventFamilies, observedRoles } = observations;
  const unavailableEventFamilies = new Set<string>(
    observableEventFamilies.filter(
      (family) => !observedEventFamilies.includes(family),
    ),
  );
  if (!observedRoles.includes("preload"))
    unavailableEventFamilies.add("preload");
  if (!observedRoles.includes("renderer"))
    unavailableEventFamilies.add("renderer-ipc");
  return {
    status: hookSnapshot.hook_error ? "hook_conflict" : "partial_attach",
    observed_event_families: observedEventFamilies,
    unavailable_event_families: [...unavailableEventFamilies].sort(),
    observed_roles: observedRoles,
    pre_capture_activity: "unavailable",
  } as const;
};

const hasUnattributedDroppedPreloadFamily = (
  hookSnapshot: ElectronHookSnapshot,
): boolean =>
  hookSnapshot.dropped_event_families.some(
    ({ family, count }) => family === "preload" && count > 0,
  );

const hasObservedPreloadConfiguration = (
  observations: ReturnType<typeof normalizeObservations>,
): boolean =>
  observations.observedEventFamilies.includes("preload-configuration");

/** Project one provider hook snapshot into the canonical public result. */
export const projectElectronActiveCapture = (
  paths: ElectronCapturePaths,
  actions: ElectronActiveObservationResult["actions"],
  state: ElectronCaptureState,
): ElectronActiveObservationResult => {
  const { hookSnapshot } = state;
  const observations = normalizeObservations(hookSnapshot);
  const ipcEvents = hookSnapshot.events.filter(({ kind }) =>
    ipcEventKinds.has(kind),
  );
  return electronActiveObservationResultSchema.parse({
    application: {
      executable_path: paths.executable,
      application_path: paths.application,
      electron_version: state.electronVersion,
      process_ownership: "provider-owned",
      cleanup: "terminated-owned-process",
    },
    actions,
    windows: state.windows,
    processes: {
      items: state.metrics,
    },
    ipc: {
      events: ipcEvents,
      observed: hookSnapshot.observed_ipc,
      dropped: hookSnapshot.dropped_ipc,
    },
    timeline: {
      events: hookSnapshot.events,
      observed: hookSnapshot.observed,
      dropped: hookSnapshot.dropped,
    },
    retention: {
      budget_bytes: hookSnapshot.retention_budget_bytes,
      estimated_retained_bytes: hookSnapshot.estimated_retained_bytes,
      event_serialized_byte_upper_bound:
        hookSnapshot.event_serialized_byte_upper_bound,
      retained: hookSnapshot.retained,
      dropped: hookSnapshot.dropped,
      dropped_event_families: hookSnapshot.dropped_event_families,
      dropped_event_roles: hookSnapshot.dropped_event_roles,
      observed_ipc: hookSnapshot.observed_ipc,
      dropped_ipc: hookSnapshot.dropped_ipc,
      observed_runtime: hookSnapshot.observed_runtime,
      dropped_runtime: hookSnapshot.dropped_runtime,
    },
    coverage: createCoverage(hookSnapshot, observations),
    limitations: [
      "IPC payloads are represented by value shapes; payload values are never retained.",
      ...(observations.observedEventFamilies.includes("ipc-observation-gap")
        ? [
            "IPC observation gaps have unobserved callback arguments and execution. Available ipc-observation-gap timeline records identify the callable, registration or removal boundary and channel where known; dropped gap records are counted by retention. Registration gaps do not prove IPC delivery, and removal gaps do not confirm which registration was removed.",
          ]
        : []),
      "IPC direction and sender/receiver identifiers are observed only where Electron exposes them at the hooked boundary.",
      "The runtime timeline records lifecycle, navigation, shell, permission, popup, download, protocol, preload, native-addon, process, and IPC events; activity before hook installation is unavailable.",
      "The preload and renderer process contexts are not instrumented by the main-process -r hook; preload configuration and contextBridge API-shape events are main-boundary observations, not proof of renderer-side execution.",
      ...(!hasObservedPreloadConfiguration(observations)
        ? [
            "Preload configuration was not exposed by the observed Electron window metadata. Preload paths and execution remain unavailable.",
          ]
        : []),
      ...(hasUnattributedDroppedPreloadFamily(hookSnapshot)
        ? [
            "Dropped preload-family events were not attributed to preload configuration; independently aggregated event families and roles cannot establish that relationship.",
          ]
        : []),
      "Process metrics are an Electron API snapshot and do not prove hostile-local-user isolation.",
      ...(hookSnapshot.dropped > 0
        ? [
            `The active hook retained ${hookSnapshot.retained} of ${hookSnapshot.observed} observed events within a ${hookSnapshot.retention_budget_bytes}-byte (${String(hookSnapshot.retention_budget_bytes / (1024 * 1024))} MiB) retained-data budget; ${hookSnapshot.dropped} events were dropped (${hookSnapshot.dropped_ipc} IPC, ${hookSnapshot.dropped_runtime} runtime). This release has no runtime override.`,
          ]
        : []),
      "External shell opens, external navigation, permission grants, downloads, popup windows, updater relaunches, and OS integration are blocked and recorded by the active hook; other application filesystem and network behavior is not sandboxed by this provider.",
      ...(hookSnapshot.hook_error
        ? ["The active IPC hook could not be installed."]
        : []),
    ],
  });
};
