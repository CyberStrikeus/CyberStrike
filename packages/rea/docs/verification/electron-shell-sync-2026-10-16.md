# Electron synchronous shell boundary verification — 2026-10-16

Fix #4393 reuses Nitin13-git's existing PR #4562. The boundary owns a fixed
method/return table: existing asynchronous blocks still reject, while
`showItemInFolder` returns `undefined` and `writeShortcutLink` returns `false`.
Both new blocks use the existing shape-only event recorder, shared by CLI/MCP.
No tool, schema, capture authority, analysis cache or launch behavior is added.

## Source and controlled regression

The fresh main base is `f26973a52918a938631e90fdc9116f7b85a62a52`;
implementation integration is `0386b60fb` and frozen verifier source is
`3f231735c3fbc28918590ddc61461871c8a2aa4d`.
The adjacent JSON records frozen final script/runtime/input hashes and all attempts;
unpinned exploratory helper revisions are explicitly identified.
Original contributor attribution remains in Git ancestry.

Using the candidate test with the base boundary produces **73 passes / 1 failure**:
the fake native shortcut implementation executes and returns true. With the
candidate boundary, **87 cases pass** (74 staged-hook, 5 projection, 8 MCP).
These test native dispatch suppression, synchronous results, shape-only
retention and the shared event schema. The fake Electron cases and controlled
MCP provider do not prove a real Windows shell implementation was exercised.
`npm run check:fast` passes both uncached tasks. Build-cache differences and
different case counts make the red/green timings unsuitable as a speed comparison.

## Real Joplin workflow and limits

Inputs: unchanged Joplin Desktop **3.7.21** ASAR (233,575,014 bytes), and the
explicit generic Electron **44.7.0** runtime. Acquisition/checksum references
are in `javascript-native-handoff-identity-2026-10-15.json` and
`electron-cancellation-2026-10-16.json`; this is not vendor-executable compatibility.
No executable fuse is changed. Large downloadable inputs and generated profiles
are not committed or retained as an experiment bundle.

The verifier opens Joplin's shipped **1. Welcome to Joplin!** note and real PNG
attachment. It selects Joplin's actual editor layout and resource context-menu
callbacks; Joplin's existing bridge calls the real patched shell method. The
native popup presentation is captured for automation; its application callbacks
are not replaced. Before any app actions, the verifier requires the active hook.
It requires zero earlier reveal events, one new blocked shape-only reveal event,
a still-rendered attachment and an identical event in the shared retained capture.

**Standard launch remains unsuccessful.** The earlier standard probe reports
`Unknown flag: -r` in Joplin's start-flag parser; the frozen standard verifier
times out waiting for the application search input. This is relevant to #2974,
not fixed here. A discarded NODE_OPTIONS experiment was invalid: Playwright
removes that variable, so no hook was installed. Those attempts are never used
as interception or performance evidence.

The explicit `--argv-shim-transport` test adapter loads the provider's staged
canonical hook and removes only its own exact `-r`/shim pair from app argv before
Joplin starts. It does not modify the ASAR or production provider. Its successful
operation phase is not a successful standard public CLI/MCP workflow. Provider
cleanup still fails (#4282); the verifier exits nonzero, preserving the distinction.
External owned-scope teardown does not establish provider cleanup.

The first valid shim probe reaches one blocked reveal, visible 1075×666 PNG,
no page errors and retained capture evidence. The final frozen rerun additionally
checks event causality and exact capture equality. Detailed measured results and
whole-family observation status are in the JSON. The final controlled pipeline
takes16.989s wall /16.055812 family CPU s /1,376,382,976 peak cgroup bytes
with verified payload-exit observation; the overall workflow still fails cleanup. Each final trial has a new
private config mount; earlier exploratory shared-config trials are not independent
cold runs. Filesystem/runtime/build caches are warm; no cold-system or warm-repeat
speedup is claimed. Agent/billed tokens are unmeasured; there is no token benefit claim.

## Reproduction

Use the pinned Node/npm toolchain. Install dependencies and build with
`npm ci` and `npm run build:cached`. Create an owned writable packet directory
with `tmp`, `profiles`, and `config/joplin-desktop`. On Linux, bind that private
config over the actual user config directory in a disposable `bwrap` mount
namespace (do not change HOME), keep the application resources read-only and
run under Xvfb. Set TMPDIR to the owned writable packet `tmp` directory. Run:

```sh
node experiments/analysis-efficiency/joplin-shell-boundary.mjs \
  --runtime-root /absolute/rea-checkout \
  --executable /absolute/generic-electron \
  --application /absolute/Joplin/resources/app.asar \
  --profile-root /absolute/owned-packet/profiles \
  --argv-shim-transport
```

Omit the last flag for the failing standard launch. Run heavy work serially under
`resource-run.py --memory-gib 8 --observe-payload-exit`, one CPU, no swap, the
6 GiB early-stop margin and 192-task ceiling. CPU/peak memory receipts are at
payload exit with the observer alive; memory includes file cache, not just RSS.
Unverified complete-family observations are explicitly marked. No Windows host,
macOS host, vendor packaged runtime or full `check:pr` was executed here.
