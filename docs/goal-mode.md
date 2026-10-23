# Persistent goal mode

Goal mode retains an objective and continues the existing session execution loop until verification succeeds or execution stops. The objective persists in SQLite independently of the conversation context.

## Commands

| Command | Result |
|:---|:---|
| `/goal` | Open the goal dialog or enter an objective. |
| `/goal <objective>` | Create and start a goal. Multiline objectives are supported. |
| `/goal status` | Show the full objective, state, token usage, budget, elapsed execution time and audit report. |
| `/goal pause` | Pause after the current execution step settles. |
| `/goal resume` | Explicitly resume the same objective and retained usage. |
| `/goal budget 50000` | Set the total token limit without resetting usage. |
| `/goal budget off` | Remove the token limit without resetting usage. |
| `/goal drop` | Stop future goal steps without claiming completion. |

Use `/goal` from the home screen or an open session.

The words `status`, `pause`, `resume`, `budget` and `drop` are reserved at the start of command arguments. Invalid control arguments produce an error. Other arguments form the objective.

Use the dialog to create an objective that starts with a reserved word. The session header shows the goal state and objective summary. The footer shows cumulative goal tokens separately from context usage.

## Lifecycle and persistence

Only one unfinished goal can belong to a primary session. Its original objective is immutable. Finish or drop that goal before creating another.

After a natural agent stop, the same execution loop checks cancellation, lifecycle state, configuration and budget. If work remains, it appends a typed internal continuation message. These synthetic messages remain hidden in the transcript and do not request model-generated titles.

After a clean turn ends with unfinished work, CyberStrike sends: `Keep going until the goal is complete; believe in yourself.`
Errors, pause, budget limits, startup and explicit resume do not receive this reminder.

The objective is included in the system prompt on each execution step, including steps after compaction. Completed and dropped records remain in the database. Session deletion removes its goals and usage ledger through foreign keys. Forking a session does not create a goal in the fork.

After the execution process exits, restored active goals become paused. Reading a session or goal does not start execution. Use `/goal resume` explicitly.

| State | Meaning |
|:---|:---|
| Active | The controller permits further execution. |
| Paused | Further goal steps require explicit resumption. |
| Budget limited | Accounted usage reached the token limit. Work can remain unfinished. |
| Blocked | An error, missing evidence or loop guard stopped execution. Review the transcript before resuming. |
| Completed | The completion audit accepted evidence for the full objective. |
| Dropped | The user stopped the goal without verified completion. |

A regular chat prompt pauses an active goal before that prompt runs. Escape uses the existing cancellation signal and pauses the goal. Pause and drop do not undo tool effects or cancel an approval request already in progress. Escape can abort the current operation where the tool supports cancellation.

## Completion verification

The primary agent receives `goal({"op":"get"})` and `goal({"op":"complete"})` only while its session has an active goal. The agent cannot use this tool to create, resume, pause, drop or change budgets.

A final text response does not complete a goal. The completion operation makes a read-only audit call with the original objective and recorded execution evidence. The audit must cover all deliverables and cite persisted evidence identifiers. Unknown identifiers, incomplete verdicts, pending tools and lifecycle changes reject completion.

Turn timestamps and message boundaries support sequencing requirements. The audit also identifies the completion request currently in progress.

The audit has no tools. CyberStrike validates its JSON verdict and evidence citations before any completion transition. Existing execution permissions remain unchanged.

Verification uses model judgment. It is not a formal proof or an independent rerun of commands. Missing, compacted or oversized evidence can prevent completion. Review the evidence report for high-impact work.

## Usage and safety limits

The usage ledger accounts each provider step once, in the same transaction as its persisted step result. It includes reported input, output, cache-read and cache-write tokens. Reasoning tokens are already part of output and are not added again.

Goal-tagged delegated steps and compaction calls contribute to the owning goal. Audit calls also contribute. Ordinary chat while a goal is paused does not consume its budget. Time measures settled primary execution steps, including their tools and audit calls. Delegated time is not added again.

Budget checks occur between calls. A call already in progress can exceed the remaining limit. Providers can omit usage for failed or aborted requests. Such unreported usage cannot be measured reliably.

Three consecutive steps without new execution evidence block continuation. Repeated identical tool results also count as no progress. A run stops after 100 processing steps or at an earlier configured agent limit. Failed tools, nonzero command exits, permission denials, provider errors and unsupported completion audits suspend continuation. These stops do not count as success.

Goal mode uses the existing per-session execution slot and a persistent process-ownership guard. Cancellation retains ownership until the loop settles. Another process cannot claim that goal while its owner remains alive.

## Configuration

The `goal` object is optional. Actual defaults are:

| Setting | Default |
|:---|:---|
| `enabled` | `true` |
| `defaultTokenBudget` | No token limit |
| `autoContinue` | `true` |

The following example applies a default token limit:

```json
{
  "goal": {
    "enabled": true,
    "defaultTokenBudget": 50000,
    "autoContinue": true
  }
}
```

Set `autoContinue` to `false` to pause at a natural turn boundary. Explicit resume permits another turn. Set `enabled` to `false` to reject new goals and resumption. Loop guards and cancellation remain active with or without a token limit.

## API

All controls use the same `SessionGoal` controller:

| Method | Path | Body or result |
|:---|:---|:---|
| `GET` | `/session/:sessionID/goal` | Current or latest goal, or `null`. |
| `POST` | `/session/:sessionID/goal` | `objective`, optional `agent`, `model`, `variant` and `tokenBudget`. Creates and starts a goal. |
| `PATCH` | `/session/:sessionID/goal` | `{"op":"pause"}`, `{"op":"resume"}`, `{"op":"drop"}` or `{"op":"budget","tokenBudget":50000}`. |

Use `null` for `tokenBudget` to remove the limit or bypass the configured default when creating a goal. The typed `session.goal.updated` event publishes lifecycle and usage changes. The TUI retrieves persisted state at bootstrap and when opening a session.

## Example

```text
/goal Inspect the local parser, fix invalid escape handling, and verify the affected cases.
/goal status
/goal pause
/goal budget 75000
/goal resume
```

Goal mode does not override security permissions. Penetration-testing tools retain their existing target-scope checks and approval requirements. An unfinished objective can remain paused, blocked or budget limited indefinitely.
