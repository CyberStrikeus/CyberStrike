# Vortex rule engine — scaling to tens of thousands of requests × rules

Tracking issue: **#40**.

## The failure we hit

`vortexSignals` (`session/web/vortex-bridge.ts`) ran `registry.analyzeCorpus(store.all())` on **every call**, and the sidebar polls it **every 2 s**. On a tiny target (~507 transactions, ~1000 simple rules) each call took **~5 s of synchronous SQLite/CPU**. Because `bun:sqlite` is synchronous, a slow handler on a fast poll stacks up and **saturates the main thread → the event loop starves → the HTTP server stops responding** ("cyberstrike unreachable").

Confirmed by a CPU `sample` (main thread pinned in `sqlite3_step` / overflow-page reads / `BtreeDelete`) and the server log (`GET /vortex/signals duration≈5200ms`, back-to-back).

This is the naive **O(reads × all_txs × all_corpus_rules)** full re-scan on a hot polled read. It fails at tiny scale; at tens of thousands of requests **and** rules it is unusable.

## The principle (repo rule)

> Hot / polled read endpoints must be **O(result), never O(corpus)**. Heavy work is **ingest-triggered, incremental, inverted-index-filtered, and single-flight cached**. A rule reaches a fact through an index; the corpus is never re-scanned.

## What the field does (why the plan is shaped this way)

- **Nuclei — request clustering**: fetch/compute once, evaluate many templates over that one result. → *compute once, project many.*
- **Rete — incremental matching**: save match state across cycles; recompute only for the changed fact; never re-scan the whole corpus. → *incremental corpus.*
- **Semgrep — required-pattern pre-filter**: skip a rule when its required literal/pattern is absent; evaluate at the ingestion edge and cache. → *content pre-scan + compute on write.*
- **Inverted index — O(k) rule selection**: index rules by preconditions; for a fact pull only applicable rules instead of an O(N) scan. → *per-fact rule index.*

Sources: ProjectDiscovery Nuclei clustering; Rete incremental pattern matching; Semgrep rule/file performance principles; Alertmanager inverted-index rule lookup (#5021); "unique-pattern based pre-filtering" (IEEE).

## Target complexity

| | Now | Target |
|---|---|---|
| Read (poll) | O(txs × corpus_rules) every 2 s | **O(result)** from a materialized cache |
| Ingest | per-tx rules only | **O(new_tx × applicable_rules)**, incremental + indexed |

## Already in place (built on)

- `Rule.evaluate(tx)` per-transaction rules run incrementally at ingest.
- `selectRules` (rule-meta) metadata pre-filter for rule subsets.
- `endpoint_template` endpoint dedup; `Signal.dedupKey` finding dedup.

## Phased plan

### P0 — stop the bleed ✅ (done, this change)
Corpus analysis is off the hot read path:
- **Data-change gate**: `vortexSignals` recomputes corpus rules **only when new traffic has arrived since the last run** (`lastIngestAt > lastCorpusRunAt`) or on the first read this process. Idle polling — which is what wedged it — never re-scans; it projects the persisted signals.
- **Ingest debounce**: new traffic schedules a background corpus recompute (`scheduleCorpusAnalysis`, coalesced with a max-wait cap), so active crawling keeps signals fresh off the read path. `flushCorpusAnalysis` forces it synchronously when needed.
- **Short-TTL view cache**: back-to-back polls reuse the built projection; invalidated on new traffic.

Env: `CYBERSTRIKE_VORTEX_CORPUS_DEBOUNCE_MS` (1500), `…_CORPUS_MAX_WAIT_MS` (5000), `…_SIGNALS_CACHE_TTL_MS` (1000).

Limitation carried into P1: a single corpus recompute is still `O(txs × corpus_rules)` — P0 only removes the *repeated* re-scan on the poll, not the per-run cost.

### P1 — incremental corpus + endpoint clustering (the real scale fix)
- Change `CorpusRule` from `evaluate(allTxs)` to incremental **`observe(tx)` + `flush()`** (Rete alpha/beta): each new tx updates only its partial state and emits newly-completed signals; the whole corpus is never re-scanned.
- Feed corpus rules a **distinct endpoint/identity projection** (`endpoint_template`), not raw requests: 10k requests → ~N endpoints → `O(endpoints × rules)`.

### P2 — tens of thousands of RULES
- **Rule inverted index**: index rules by preconditions (method, content-type, tech fingerprint, param presence, required trigram/literal); for a tx/endpoint pull only applicable rules — the other ~10k are never touched. Extends `selectRules` from a subset filter to a per-fact index lookup.
- **Content pre-scan**: before a body-scanning DSL/regex rule runs, a cheap substring/trigram check on a rule-declared required literal; skip if absent.

### P3 — safety / long-term
- **Bounded output**: paginate/cap the signals & captures lists so payload/work is independent of corpus size.
- **Off-thread**: move very-large-corpus synchronous SQLite analysis to a worker thread (last resort, after P0–P2).
- **Ingest backpressure**: batch + debounce new transactions.

Also apply the same treatment to sibling O(corpus) paths (`vortexReport`) as they move onto hot paths.
