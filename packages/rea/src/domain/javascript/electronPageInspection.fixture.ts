import { classifyBrowserCompleteness } from "../browserCompleteness.js";

/** Empty coverage tail shared by Electron page fixtures. */
export const emptyElectronPageCoverage = (observationMs = 0) => ({
  capture_window: {
    started_at: "2026-01-01T00:00:00.000Z",
    ended_at: new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + observationMs,
    ).toISOString(),
    observation_ms: observationMs,
  },
  completeness: classifyBrowserCompleteness({
    policyFilteredSections: new Set(),
    attachLimitedSections: new Set(),
    truncatedSections: new Set(),
    unavailableSections: new Set(),
    excluded: [],
    droppedEvents: {
      scripts: 0,
      network_requests: 0,
      console_events: 0,
      websocket_connections: 0,
      websocket_frames: 0,
      webmcp_tools: 0,
      timeline_events: 0,
    },
  }),
  frames: [],
  dom: { total_nodes: 0, nodes: [] },
  scripts: { total: 0, items: [] },
  resources: [],
  workers: [],
  limitations: [],
});
