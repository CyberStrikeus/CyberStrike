# Browser scenario offline validation

Executed on Linux x64 with Node 24.22.1/npm 11.16.0, based on main
`3fcbabe593611435ebc26e1eac86706fe60abb6e`. Integrates Ace's #7149
(`463c8bd73`), with one shared CLI input/admission helper and stronger boundary
coverage. The domain scenario contract remains the semantic owner.

The input is the preserved scenario from the successful real PocketBase 0.40.6
CLI workflow described in [saved-values verification](browser-saved-values-2026-10-26.md).
Its SHA-256 is `cfbb3428292250519a5a6f7f9c4b5fea494eb9e3ceccf7b777fd44ffe0f12223`.
The backend was stopped and its loopback endpoint confirmed unreachable before
these checks. Both declared secret environment variables were removed from each
child environment. The original scenario file was verified unchanged.

Each invocation used the public `validate-browser-scenario FILE --json` command.
All returned `{"valid":true,"actions":7,"secrets":2}` and exit 0. The seven
caller actions exclude the implicit initial capture step.

| Input / fresh CLI process                       | Elapsed s | CPU s | Sampled family peak bytes |
| ----------------------------------------------- | --------: | ----: | ------------------------: |
| Recorded scenario                               |     1.712 | 2.013 |               217,907,200 |
| Same input repeated                             |     1.722 | 1.989 |               217,239,552 |
| Browser replaced with a nonexistent executable  |     1.667 | 1.933 |               219,025,408 |
| Browser replaced with disconnected loopback CDP |     1.557 | 1.880 |               218,779,648 |

Two CPUs, a 3 GiB Node heap and an 8 GiB family guard bounded execution. Family
RSS is the sum sampled every 100 ms; shared pages can be counted twice and short
peaks can be missed. No resource guard stopped a task. These are fresh processes
with warm filesystem caches, not cold-OS measurements or an analysis-cache claim.
There was no equivalent earlier public offline workflow, so no comparative
speedup is claimed. Profiling/tokenizer driver overhead is outside these tasks.

Each JSON reply is 38 bytes / **14 estimated o200k tokens**. The complete Node executable/script/CLI argument array plus parsed reply,
encoded as compact JSON `{argv, result}`, uses 75–77 estimated tokens, including
the local paths. Shell/profiler framing is unmeasured. The documents themselves are 1,926–1,942 bytes / 500–508 tokens if
read into context; this file-based task does not require returning them. There
is no model invocation/billing or MCP schema/discovery in these CLI tasks.

Boundary checks cover unavailable launch/connect resources, throwing provider
factory and enumerable secret getter spies, duplicate/reserved IDs, undeclared
secrets, duplicate secret IDs/environment names, ordered saved references,
unknown fields, unreadable/malformed files, caller-relative executable paths,
stdin and public CLI exit codes. Existing capture diagnostics and summary
publication remain covered. Initial test-helper type errors were corrected
before the final static gate; no passing result is claimed for that failed run.

Validation establishes schema and cross-reference validity. It does not establish
browser availability, secret availability, selector correctness or successful
execution, and it emits no analysis Evidence. Real-browser capture was verified
in the preceding feature; these offline checks construct no browser provider.

To reproduce with an existing scenario:

```bash
rea validate-browser-scenario ./browser-scenario.json --json
cat ./browser-scenario.json | rea validate-browser-scenario - --json
```
