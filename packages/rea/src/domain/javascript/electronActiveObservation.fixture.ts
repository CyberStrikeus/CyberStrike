import {
  electronActiveObservationResultSchema,
  type ElectronActiveObservationResult,
} from "./electronActiveObservation.js";

/** Create an active-capture result for MCP contract tests. */
export const createElectronActiveObservationFixtureResult = (
  applicationPath: string,
): ElectronActiveObservationResult => {
  const event: ElectronActiveObservationResult["timeline"]["events"][number] = {
    sequence: 1,
    correlation_id: null,
    kind: "main-handler-invocation",
    event: null,
    phase: "observed",
    channel: "readiness:echo",
    direction: "renderer-to-main",
    sender: null,
    receiver: "main",
    frame: null,
    target: null,
    argument_shapes: ["string"],
    result_shape: "object",
    process_type: "main",
    source: "electron-active-hook",
    capture_method: "api-wrapper",
    artifact_path: null,
    artifact_sha256: null,
    error: false,
  };
  return electronActiveObservationResultSchema.parse({
    application: {
      executable_path: process.execPath,
      application_path: applicationPath,
      electron_version: "test-electron",
      process_ownership: "provider-owned",
      cleanup: "terminated-owned-process",
    },
    actions: [
      {
        step_id: "submit",
        kind: "click",
        window_index: 0,
        target: "window:1",
        status: "completed",
        elapsed_ms: 3,
        error: null,
      },
    ],
    windows: [
      {
        window_id: "window:1",
        web_contents_id: "webContents:1",
        url: "file:///tmp/app.html",
        title: "Fixture",
        visible: true,
        destroyed: false,
      },
    ],
    processes: {
      items: [{ pid: 1234, type: "Browser", name: null, service_name: null }],
    },
    ipc: {
      events: [event],
      observed: 1,
      dropped: 0,
    },
    timeline: {
      events: [event],
      observed: 1,
      dropped: 0,
    },
    retention: {
      budget_bytes: 16 * 1024 * 1024,
      estimated_retained_bytes: 768,
      event_serialized_byte_upper_bound: 512,
      retained: 1,
      dropped: 0,
      dropped_event_families: [],
      dropped_event_roles: [],
      observed_ipc: 1,
      dropped_ipc: 0,
      observed_runtime: 0,
      dropped_runtime: 0,
    },
    coverage: {
      status: "partial_attach",
      observed_event_families: ["ipc"],
      unavailable_event_families: ["renderer-ipc", "preload"],
      observed_roles: ["main"],
      pre_capture_activity: "unavailable",
    },
    limitations: [
      "IPC payloads are represented by value shapes; payload values are never retained.",
    ],
  });
};
