# v1 → v2 message projection: mapping decisions

Derived by reading CyberStrike's `session/message-v2.ts` (v1 `MessageV2`) against upstream's
`@opencode/schema@2.1.4` `session-message.js` (v2 `SessionMessage`). The throwaway runner in the plan was not
executed; this table is the source for `src/projection/message.ts`.

## Message level

| v1 | v2 `type` | Notes |
| --- | --- | --- |
| `User` info | `user` | `text` = concatenated text parts; `files`, `agents` from file/agent parts; `skills: []` |
| `Assistant` info | `assistant` | `content` built from parts (below); `error` mapped through the error table |
| assistant with a `compaction` part | `compaction` | `reason` from the part's `auto` flag; `status: completed` |

## Part level (inside an assistant message)

| v1 part | v2 content | What happens to the fields upstream drops |
| --- | --- | --- |
| `text` | `text` | `metadata`, `time` dropped |
| `reasoning` | `reasoning` | `metadata`, `time` dropped |
| `tool` | `tool` (`id` = `callID`, `name` = `tool`, `executed: true`) | `metadata` on the part dropped; state mapped below |
| `file` | none in assistant content (sent as `files` on user messages) | `source` dropped |
| `step-start`, `step-finish` | none | upstream has no step parts; token/cost folded into the message |
| `snapshot`, `patch` | none | upstream keeps snapshots at message level only |
| `subtask`, `agent`, `retry` | none | `retry` becomes `retry` on the message in a later phase |
| `json_schema`, `symbol`, `resource` (CyberStrike-only) | none | no v2 equivalent; dropped, documented as a known gap |

## Tool state

| v1 `state.status` | v2 `state.status` | Mapping |
| --- | --- | --- |
| `pending` | `streaming` | `input` serialized to a JSON string |
| `running` | `running` | `input`, `metadata` kept |
| `completed` | `completed` | `output` becomes `content: [{type: "text", text}]` |
| `error` | `error` | `error` becomes `{type, message}` |

## Error types

Upstream's vocabulary: `provider.auth`, `provider.content-filter`, `provider.invalid-request`,
`provider.invalid-output`, `aborted`, `provider.error`, `unknown`. Unknown v1 names map to `unknown`.

## Robustness

Each part is projected independently; an unknown part type is skipped and the rest of the message survives.
Each projected message is decoded through the upstream schema one at a time in the list handler, so one bad
message is logged and skipped rather than failing the whole page.
