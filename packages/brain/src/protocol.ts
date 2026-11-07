// Brain ↔ Client wire protocol (issue #47).
//
// All messages are JSON-serialized over WebSocket. The brain sends tool calls
// to the client for local execution; the client returns results. The LLM loop
// runs server-side — the client never sees system prompts or playbooks.
import z from "zod"

// ── Client → Brain ────────────────────────────────────────────────────────────

export const ConnectMessage = z.object({
  type: z.literal("connect"),
  license: z.string(),
  version: z.string(),
  capabilities: z.array(z.string()),
  modelKey: z.string().optional(),
})

export const RequestMessage = z.object({
  type: z.literal("request"),
  id: z.string(),
  domain: z.string(),
  message: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
})

export const ToolResultMessage = z.object({
  type: z.literal("tool_result"),
  callId: z.string(),
  result: z.unknown(),
  error: z.string().optional(),
})

export const CancelMessage = z.object({
  type: z.literal("cancel"),
  requestId: z.string(),
})

export const ClientMessage = z.discriminatedUnion("type", [
  ConnectMessage,
  RequestMessage,
  ToolResultMessage,
  CancelMessage,
])

export type ClientMessage = z.infer<typeof ClientMessage>

// ── Brain → Client ────────────────────────────────────────────────────────────

export const ConnectedMessage = z.object({
  type: z.literal("connected"),
  sessionId: z.string(),
  tier: z.enum(["pro", "enterprise"]),
})

export const ToolCallMessage = z.object({
  type: z.literal("tool_call"),
  callId: z.string(),
  requestId: z.string(),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
})

export const StreamDeltaMessage = z.object({
  type: z.literal("stream_delta"),
  requestId: z.string(),
  delta: z.string(),
})

export const ResponseMessage = z.object({
  type: z.literal("response"),
  requestId: z.string(),
  content: z.string(),
  findings: z.array(z.unknown()).optional(),
})

export const ErrorMessage = z.object({
  type: z.literal("error"),
  requestId: z.string().optional(),
  code: z.string(),
  message: z.string(),
})

export const BrainMessage = z.discriminatedUnion("type", [
  ConnectedMessage,
  ToolCallMessage,
  StreamDeltaMessage,
  ResponseMessage,
  ErrorMessage,
])

export type BrainMessage = z.infer<typeof BrainMessage>
