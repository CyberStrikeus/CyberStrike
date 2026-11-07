import { getHeapStatistics } from "node:v8";
import { MAX_JSON_DEPTH } from "../domain/jsonValue.js";
import type { ToolResultDelivery } from "./ToolResultDelivery.js";

/** Transport and host facts stay distinct from the agent-editable policy registry. */
export const analysisSettingsConstraints = (delivery: ToolResultDelivery) => [
  {
    control: "REA_MCP_MAX_RESPONSE_BYTES",
    authority: "operator" as const,
    value: delivery.maximumResponseBytes,
    unit: "bytes",
    observation: "known" as const,
    recovery:
      "Change the launch environment and restart REA with a matching client receive buffer. Prefer retained Evidence, paging or export for completed results.",
  },
  {
    control: "mcp.client_deadline",
    authority: "external" as const,
    value: null,
    unit: "ms",
    observation: "unknown" as const,
    recovery:
      "The MCP host owns its tool-call deadline. REA cannot observe or raise it. Allow execution, cleanup and delivery headroom.",
  },
  {
    control: "mcp.client_receive_buffer",
    authority: "external" as const,
    value: null,
    unit: "bytes",
    observation: "unknown" as const,
    recovery:
      "The MCP host owns its receive buffer; raising a REA output budget alone does not raise it.",
  },
  {
    control: "node.parent_heap",
    authority: "operator" as const,
    value: getHeapStatistics().heap_size_limit,
    unit: "bytes",
    observation: "known" as const,
    recovery:
      "This is the current process heap ceiling, not available memory. On Node, change --max-old-space-size at launch and restart REA. Worker heap settings do not raise it.",
  },
  {
    control: "json.maximum_depth",
    authority: "fixed" as const,
    value: MAX_JSON_DEPTH,
    unit: "levels",
    observation: "known" as const,
    recovery:
      "REA's JSON representation has this fixed nesting policy. This release has no runtime override; increasing byte or worker budgets does not change it.",
  },
];
