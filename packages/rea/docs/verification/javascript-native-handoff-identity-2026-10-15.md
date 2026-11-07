# Native handoff byte-identity verification

Tracks #3926 under #4027. Baseline: `9f8659e0536e4e50a438f5b9d5661f3c9624f6ac`.
Final integration base: `62bf09809ef7bb224028916424f8f07652a20f4f`.

The analyst already knows an ASAR-relative native path and supplies prior native
Evidence. The question is which Evidence can be linked to that component's exact
bytes. Discovery and native-provider execution are outside this task.

## Observed behavior and correction

The native-node producer distinguishes a content digest from a canonical path
whose bytes are unavailable. Its unavailable observation legitimately cites the
containing archive. The handoff consumer previously treated that supporting
artifact digest as the native component's digest.

Public CLI/stdio MCP regression: the missing-companion case failed and the
available-byte control passed. Real Joplin reproduced the same result: missing
keytar bytes produced an `evidence-linked` handoff with the ASAR digest and the
simulated container observation. CLI/MCP agreed on that incorrect answer.

The consumer now uses only the node owner's content-digest identity. The fallback
observation scan is removed. Unavailable native nodes retain their canonical
path, availability, container-backed provenance and partial coverage in the
inline graph; they yield no false actionable handoff or native Evidence link.
An empty handoff list describes eligibility, not absence of native components.
The per-query node index is allocated only after an eligible target exists; no
persistent cache, schema, tool or target authority is added.

Final real checks passed both cases with exact CLI/MCP trace parity. The available
control preserved the complete parent/trace Evidence IDs, native facts, links,
coverage and all token projections. The missing control preserved its parent,
native node, source provenance and coverage, while removing the wrong handoff
and container Evidence link.

## Real input and scope

[Official Joplin v3.7.21 Linux AppImage](https://github.com/laurent22/joplin/releases/download/v3.7.21/Joplin-3.7.21.AppImage),
published 2026-09-25, 201,462,481 bytes, SHA-256
`5d202dcaca31e14206826aa3f04125e7c218dbc3dc3d98479d811efbd6b856c1`.

Read-only 7z 26.02 inspection found 6,324 ASAR files, 46 unpacked entries and
three `.node` components. Extract only the ASAR and those three binaries:

```sh
input_root="$(mktemp -d -t rea-native-handoff-XXXXXX)"
curl --fail --location --output "$input_root/Joplin-3.7.21.AppImage" \
  https://github.com/laurent22/joplin/releases/download/v3.7.21/Joplin-3.7.21.AppImage
sha256sum "$input_root/Joplin-3.7.21.AppImage"
7z x -mmt=1 "-o$input_root/extracted" "$input_root/Joplin-3.7.21.AppImage" \
  resources/app.asar \
  resources/app.asar.unpacked/node_modules/keytar/build/Release/keytar.node \
  resources/app.asar.unpacked/node_modules/sqlite3/lib/binding/napi-v6-linux-glibc-x64/node_sqlite3.node \
  resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node
python3 - "$input_root" <<'PY'
import os, sys
from pathlib import Path
root = Path(sys.argv[1])
source = root / 'extracted/resources'
for mode in ('available', 'missing'):
    case = root / 'cases' / mode
    case.mkdir(parents=True)
    os.link(source / 'app.asar', case / 'app.asar')
    if mode == 'available':
        for native in (source / 'app.asar.unpacked').rglob('*.node'):
            target = case / native.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.link(native, target)
PY
```

Verify the asset digest above before extraction. The ASAR is 233,575,014 bytes,
SHA-256 `767df409b18effe60421fbefcca873de237c7e813eac744ecdeebbc5e825a33a`.
Keytar is 76,960 bytes, SHA-256
`0700016bcd761cbe02d275f2046c7cc42f39f730a50d66e3d3307aa9d413373a`.
All extracted component hashes are in the JSON record. 7z reported one
trailing-data warning for the AppImage's embedded SquashFS and exited 0.

Both cases select only `package.json` for static source analysis while retaining
the inventory. The available case stages all three native companions; the other
43 unpacked entries are not staged. The missing case stages none. Whole-application
coverage is therefore partial in both cases, independently of the selected
native component's known or unknown byte identity. Neither the application nor
a native analysis provider is executed. Native Evidence is explicitly simulated
to test exact subject linkage. Live Electron, real Ghidra/Hopper/IDA behavior and
Windows/macOS verification are **NOT_ENOUGH_INFO**.

## Reproduce the public workflow

Use pinned Node 24.18.0/npm 11.16.0, `npm ci`, then `npm run build:cached`.
The verifier returns compact records and deletes its private exported parent and
CLI input after owned cleanup. No downloadable application or large Evidence is
archived.

```sh
for mode in available missing; do
  node scripts/verify/javascript/native-handoffs.mjs \
    --artifact "$input_root/cases/$mode/app.asar" \
    --addon-path node_modules/keytar/build/Release/keytar.node \
    --native-sha256 0700016bcd761cbe02d275f2046c7cc42f39f730a50d66e3d3307aa9d413373a \
    --source-path package.json --rounds 3 --cli-parity --require-safe
done
```

Add `--tokenizer-python /absolute/path/to/python-with-tiktoken-0.12.0` for the
reported BPE projections. The npm alias `verify:javascript:native-handoffs`
builds first; recorded costs use the direct Node invocation above after building.
For a pre-fix observation, run the saved verifier on the baseline build without
`--require-safe`; `safe_identity: false` is an incorrect answer, not a passing
analyst task. Paths affect serialized requests and some Evidence identities.

The exact resource runs additionally used the preserved
[8 GiB observer](https://github.com/morluto/rea/blob/b3bdabab694af1f9801eff7caf75001b92314a58/experiments/analysis-efficiency/resource-run.py)
and adjacent `resource_payload.py`; both hashes are pinned in the JSON.

## Completed workflow costs and limits

| Case                   | Revision |  Wall s |      CPU s | Peak cgroup bytes | Identity oracle            |
| ---------------------- | -------- | ------: | ---------: | ----------------: | -------------------------- |
| Native bytes available | Before   |  60.369 |  59.806670 |     2,662,629,376 | pass                       |
| Native bytes available | After    | 258.885 | 106.221003 |     2,678,456,320 | pass, exact baseline facts |
| Native bytes missing   | Before   |  57.930 |  57.479109 |     2,719,457,280 | wrong identity/linkage     |
| Native bytes missing   | After    |  59.738 |  59.254776 |     2,571,235,328 | pass, unknown retained     |

Whole-verifier resources include input hashing, analysis, three retained trace
queries, export, CLI parity and tokenization. One CPU, 8 GiB hard cap, 6 GiB early
stop, no swap; cleanup verified and no OOM. Memory includes charged file cache,
not summed RSS. Counters are at payload exit while the observer remains alive.
The available control's final wall and CPU times are substantially higher than
baseline. Earlier post-fix controls on the original base took 61.657/74.956 s wall
and 61.135962/60.352428 s CPU for available/missing cases; their complete receipts
remain separately recorded. The final missing case took 59.738 s wall. This
variability is unresolved and cannot be attributed to the native consumer change.
These runs establish neither speedup nor performance equivalence. Input hashing warms the ASAR
cache, build/OS caches and shared-host scheduling are uncontrolled. Fresh MCP
sessions do not establish OS-cold conditions. First post-analysis and repeated
warm-query samples are preserved separately; query CPU/memory are unmeasured.

One defined task is one analysis summary plus one retained trace, with the path
and prior Evidence already supplied. Static `cl100k_base`/tiktoken 0.12.0 counts
include both requests, replies and name/description/inputSchema contracts:

| Available-byte task, unchanged before/after     | BPE tokens |
| ----------------------------------------------- | ---------: |
| Selected catalog + structured replies           |     12,340 |
| Selected catalog + complete tool replies        |     18,906 |
| Full catalog projection + structured replies    |    202,292 |
| Full catalog projection + complete tool replies |    208,858 |

These are alternative reply/catalog projections. The selected catalog alone is
5,570 BPE; the full projection is 195,522. Output schemas, annotations, host
rendering/replay, reasoning, final answers and model billing are unmeasured.
Repeated queries/export/CLI/tokenization are validation overhead outside this
one-task token count, but inside resource receipts. Missing-case structured-task
counts change 11,372 → 11,103 by removing unsupported claims; the incorrect
baseline earns no efficiency credit.

## Regression and verification record

The initial four-file focused selection passed 24 tests. The two public cases
were rerun after adding named summary-result parsing and correcting an optional
architecture factory input. Omitting that field instead of passing null produced
byte-identical normalized simulated Evidence in all four real-case inputs.
The initial CLI-selector harness error and first typecheck failure are retained
as harness/validation attempts, not product reproductions.

After syncing the reviewed upstream changes, the updated application workflow
CLI acceptance file passed 34 tests, bringing the focused selection to 58 distinct
cases across five files. Both Joplin controls were then repeated on the final
integration base. Canonical byte identity is also used by the related version
matching/content comparison consumers; no equivalent observation-digest fallback
was found there.

Final `npm run check && npm run docs:check` passed on the integration base,
including five documentation consistency tests: 128.732 s wall, 115.518920 s CPU,
4,301,684,736 B peak cgroup memory, clean owned exit and no OOM.

Final public and static/docs outcomes are recorded in the
[compact measurements and source pins](javascript-native-handoff-identity-2026-10-15.json).
