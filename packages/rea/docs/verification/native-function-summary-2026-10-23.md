# Native function summary verification — 2026-10-23

## Behavior and source

MCP `analyze_function` defaults to a compact derived summary. The complete
function Evidence stays in the session and can be selected by the returned
`parent_evidence_id` through `inspect_analysis_view`. `detail: "complete"`
keeps the historical full reply. Delivery detail stays outside provider inputs
and parent Evidence identity. This MCP default is a breaking change.

CLI `rea function` still defaults to complete output. Opting into summary
requires an exclusive `--evidence_output` bundle destination. The authenticated
bundle can be paged by an absolute `evidence-file` source and explicit record
ID after the provider closes. Plain records also honor an explicit ID.

The implementation reuses the existing JSON authentication/headroom owner and
one bundle-authentication function for import and file views. It reads one file
once per request. Ambiguous-bundle guidance retains complete IDs and bounds
JSON-encoded reference previews to 2 KiB, omitting oversized operation labels.
Native summaries inherit function locations and relationship coverage; omitted
or unavailable facts stay unknown rather than becoming zero.

Measured source:

- Before: `fb6c88d518ab9b84ed396cf82dcb1c28a608c501`.
- After: `4e3d930ada93014efa43610265b58307de49a687`.
- Harness SHA-256: `d67b23db21024361b34f796add1ff91bf3fbcda1991ea9e369ef8bcf64c71ec4`.
- Linux x86-64; pinned Node 24.22.1 / npm 11.16.0; bring-your-own Ghidra 12.1.4
  and JDK 21.0.12.1+1. No target execution.
- Target SHA-256:
  `9c49d2eef9c2083f6f66f38de4ed0ee1bac17ca5b73dc8f3a90d9ba62a8d1d5d`.
  Its 3,000-branch C source is the timeout verifier fixture, SHA-256
  `f99074876faae8e18e45265dab007b6fcc396fe909d57efab72adc8925a960c7`.
  Known entries `0x1010f9` and `0x128ed6` apply only to this exact artifact.

## Completed public MCP comparison

One fresh production stdio MCP client discovers all 221 tools, opens the target,
then obtains two answers: the small function's identity, availability/counts and
complete pseudocode; and the large function's identity, availability, assembly/
block counts and first 20 assembly rows. It repeats both reads in the same
session, performs one matched complete-small compatibility read and closes.

Before, each default function reply carries the full dossier. After, each
answer uses the default summary and one retained-Evidence page. Both lanes use
a one-second native decompile limit, an explicit 600-second SDK tool deadline
and matching 128 MiB server/client receive budgets. Selected facts match
between implementations and rounds. The large function has 45,007 assembly
rows and 9,001 blocks with pseudocode unavailable; the small pseudocode is
64 bytes, SHA-256
`c947ff22cab1ffef9b962b12d82e12d0e5f5e2a6c5634a2ed5ea3c353e1d5807`.
Each run retained the same observed JVM start identity through its tasks and
completed cleanup with an unchanged target digest.

| Whole benchmark                   |     Before |     After |
| --------------------------------- | ---------: | --------: |
| Estimated exchange tokens         | 44,217,047 | 1,033,322 |
| Elapsed seconds                   |    237.715 |   128.600 |
| Waited process-family CPU seconds |    211.656 |   123.083 |
| Sampled family RSS MiB            |     3951.7 |    2827.8 |
| Catalog/tool exchanges            |          8 |        12 |

Estimated context falls 97.66% for this completed task, including the larger catalog and
four extra page calls. The catalog alone grows from 982,457 to 985,662 estimated
tokens. The complete-small compatibility read remains included in both totals.

| MCP phase elapsed seconds                            |  Before |   After |
| ---------------------------------------------------- | ------: | ------: |
| First small function, including deferred JVM startup | 80.3747 | 69.0745 |
| First large function, with the JVM already warm      | 57.2394 | 19.8205 |
| Repeated small function                              |  0.0534 |  0.0601 |
| Repeated large function                              | 56.4148 | 19.7744 |

The repeated small task adds a page call and takes about 6.7 ms longer in this
pair. Large partial dossiers remain live and retry native analysis; healthy
small-function snapshot reuse remains available. This change reduces agent
output and its serialization/transport work while still producing and retaining
the complete parent dossier.

Tokens are `tokenx` 1.3.0 estimates over the actual catalog, arguments and whole
SDK results, including both text and structured projections. Protocol framing,
handshake, prompts, client rendering/replay and actual model usage are
unmeasured. The whole benchmark includes token estimation, hashing, resource
sampling and exchange-file writes. Summed measured MCP phases exclude the
subsequent counting/writing overhead: 217.327 → 127.538 seconds.
The whole-benchmark timings must not be presented as pure provider analysis time.

Node heaps were 2 GiB, Ghidra's heap 1 GiB, affinity CPUs 0/1 and Java active
processor count two. The observed-family early-stop guard allowed 6 GiB RSS,
600 seconds CPU and 900 seconds elapsed; neither completed run hit a guard.
RSS was sampled every 50 ms through recursive `/proc` observations. Shared
pages can be double-counted and brief/unobserved child transitions can be
missed; this is not a kernel cgroup peak or hard family memory limit. Waited
CPU includes reaped descendants. Baseline ran first, OS caches were not flushed
and the host was shared with other work. This is one paired investigation,
with cold/result-cache distinctions above, rather than a universal speed claim.

An earlier baseline attempt used a 240-second SDK deadline and began with the
large function. It timed out, then closed successfully; the whole attempt took
280.628 seconds and 219.562 seconds waited CPU, with no resource-guard stop.
Its failed receipt/exchanges remain separate. It is excluded from completed-task
comparisons. The final pair uses the same longer deadline and task order on
both implementations.

## Public CLI and retained files

The real default CLI command returned a complete small-function dossier with
the expected pseudocode (70.627 s elapsed, 70.034 s CPU). The first verification
harness assumed bare Evidence and failed to unwrap the successful public
`ok`/`data`/`meta` envelope. After correcting the harness, its completed receipt
and output were verified and reused without another provider analysis.

The summary CLI command analyzed the large function and wrote a 29,141,012-byte
bundle. It returned an 8,499-byte summary envelope in 78.163 seconds, with
94.196 seconds CPU and 2,381.2 MiB sampled family RSS. Two fresh CLI processes,
with the Ghidra installation path unavailable, authenticated that bundle and
returned its first and final 20 assembly rows. Coverage reports 45,007 total
rows, correct continuation and exhaustion. The target digest remained unchanged.

Those independent file-page commands took 17.218 / 18.175 seconds, 15.150 /
17.015 seconds CPU and about 666 / 669 MiB RSS. Each fresh command reads and
authenticates the complete bundle; this is not sublinear disk access or a
cross-process cache. Complete evidence remains available at the caller's file.

## Validation and limits

- Full `npm run check` passed after integration with main
  `a062529bb2aa064be37e82df39c59c4fa798fe50` at source `b7c3f0cd79c4a02b135da56fff06de08dd456ff7`.
  `docs:check` also passed.
- The latest focused contract/progress/snapshot/local-path run passed 139 tests;
  the measured integration's selected run passed 136 and an earlier broader
  CLI-selector/contract run passed 169. Overlaps are not summed. The earlier domain/Evidence run had 87 passes and one legacy
  progress-fixture failure. The explicit-complete fixture and new summary's
  increasing notifications subsequently passed in a separate eight-case MCP
  run.
- Actual SDK/schema checks passed all 15 cases after regenerating ignored test
  catalog metadata. The initial run had 14 passes and one stale-catalog
  equality failure; its receipt is retained.
- The production CLI/MCP observations above use real Linux Ghidra. Hopper,
  IDA, Kuna, macOS and Windows behavior is covered only to the extent of the
  selected source/boundary tests, not new real-provider verification.
- Earlier source integration fixes and later main changes were not included in
  every historical test/performance pin. The measured pair remains tied to the
  explicit source commits above.

Raw exchanges, protocol observations, control failures, scripts and resource
receipts are retained under `/tmp/rea-maintenance-20261023/5660/`. Provider
projects, generated binaries, build outputs and local planning files are not
committed.
