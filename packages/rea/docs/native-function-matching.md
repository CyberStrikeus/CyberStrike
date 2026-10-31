# Match native functions across builds

`match_native_functions` pairs two existing `list_procedures` Evidence inventories. Select `list_procedures` `detail: "summary"` to retain
complete source rows without transferring the entire inventory. Its
`parent_evidence_id` is the reference matching consumes.
Targets may be opened sequentially; matching never opens a target, rereads its
file, executes it or starts a provider. Preserve each inventory before closing its
target, or import its Evidence bundle later. `close_binary` clears session
records. Export each bundle before closing; after collecting both sides and
closing the last target, import both bundles, then use their references. Keeping
only an Evidence ID across close is insufficient. Complete inline Evidence and
CLI `source_bundle` inputs are portable alternatives. Pass Evidence or exact
session references as `left` and `right`:

```json
{
  "left": { "kind": "retained-evidence", "evidence_id": "ev_<left digest>" },
  "right": { "kind": "retained-evidence", "evidence_id": "ev_<right digest>" }
}
```

Unique exact names with observed symbol origin are paired first. Inventory rows
or optional `list_names` Evidence identify dynamic/default names to exclude.
Unknown or conflicting origin does not establish name correspondence; complete
independent body bytes remain eligible. Exact names establish name correspondence,
not unchanged code or original-source identity. Ghidra publishes its symbol facts;
Hopper, IDA and older imported dossiers retain unknown origin when no such facts
were observed. Display spelling alone, including `EntryPoint` or `FUN_` prefixes,
does not establish whether a name was generated.

Authentic Evidence selected for the wrong side, role, target, provider, profile
or document returns an input error naming the selected field or observation
index. Re-select compatible observations; authentication or contradictory producer
facts retain their separate integrity failures.

For unmatched candidates, optionally supply `left_observations` and
`right_observations`. `procedure_info` or existing `analyze_function` dossiers
give exact inclusive body ranges; `read_bytes` supplies memory bytes. An MCP
`analyze_function` summary reply is not a dossier: pass its
`parent_evidence_id` as a `retained-evidence` reference instead. Observations
must belong to the side's exact target/provider/profile and document context.
Adjacent, consistent overlapping and partially returned reads compose by their
observed extent; conflicting intervals remain gaps. A byte match requires every
body byte, equal total size, equal ordered range lengths, a unique SHA-256
fingerprint and the same known architecture. Extents are never guessed from the
next entry, and relocations are not normalized. A larger mapped read can serve
several observed bodies; only needed ranges need to be captured.

This first slice reuses existing range observations. Stripped builds can require
many lightweight range queries when those facts are not retained yet. Matching
does not hide that acquisition cost or silently start those queries. Full
decompilation is unnecessary.

Repeated candidates stay `unresolved` groups without a Cartesian pair expansion.
`only_left`/`only_right` mean no exact counterpart in the supplied observations;
renaming, inlining, stripping, changed bytes or incomplete discovery can explain
them. They do not prove source addition/removal. `source_coverage` explicitly keeps
inventory completeness unknown and separately counts known byte fingerprints and
resolved correspondence. Provider limitations remain accessible.

Default `detail: "summary"` retains complete matching Evidence in MCP and returns
counts, both identities and coverage. Query its `parent_evidence_id`:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "ev_<matching digest>"
  },
  "view": {
    "kind": "function-matches",
    "collection": "functions",
    "states": ["matched"],
    "sides": ["left"],
    "fields": ["name", "body_sha256"],
    "offset": 0,
    "limit": 20
  }
}
```

`collection: "matches"` returns relation identities, states, basis and member
counts. Large member lists are omitted by default; select `left`/`right` columns
explicitly or page individual `functions`. Batch `match_ids`/`function_ids`, exact function `names`, state
and side filters intersect. Mandatory identities and provenance survive column
selection. Page coverage covers selected retained facts. Function identity binds
inventory Evidence and the owning inventory’s `source_index`, preserving same-address alternatives.
One validation, lazy member index and bounded recent filter are retained per
immutable parent; no live target state is cached.

When both functions already have unambiguous `analyze_function` dossiers in the
observations, a matched relation includes `compare_functions_input` with
directly usable retained references. Otherwise analyze just the selected canonical addresses in their
respective targets, then compare those dossiers. Matching never claims behavioral
equivalence. Optional informative CFG/call/string fingerprints from supplied
dossiers connect unresolved candidate groups only. They require observed CFG,
callees and strings, complete observed call coverage, no unresolved calls, and
the same analysis-profile identity. Empty leaf-function buckets are excluded.
`structural_candidate_sha256` identifies that derived candidate signature; its
dossier link preserves the full supporting facts. Group membership does not
assert that every member pair is a candidate or equivalent.

CLI uses the same service and JSON input:

```bash
rea match-native-functions request.json \
  --source_bundle left-bundle.json --source_bundle right-bundle.json \
  --evidence_output matching-bundle.json --json
```

`source_bundle` resolves exact references from authenticated local bundles.
Default summary requires `evidence_output`, retaining full matching Evidence and
its selected source closure, including transitive Evidence links across supplied
bundles. Missing dependencies fail with an integrity error; unrelated records
are omitted. Publication never overwrites. Set `detail: "complete"`
in the JSON for all groups inline. Import the bundle into MCP for views, or
extract its matching Evidence record to a JSON file for the existing CLI
`inspect-analysis-view` `evidence-file` source. Input bundles are unchanged.

Representation admission is bounded before cloning selected observations
and expanding matching indexes and repeated per-function source links. Each
inventory row is charged before parsing for the member it becomes, including the
report and Evidence copies that member is serialized into, so an oversized side
is refused before its rows are parsed. Inline Evidence and bundle records are
charged for the copies their authentication or loading creates. An exact
session reference to retained Evidence is borrowed without a copy, so only
what matching derives from it is charged; the inventory's own Evidence ID is
charged once, not per function. Selected observations are charged in full.
Measured under the 96 MiB default with Ghidra-shaped rows, about 20-character
names and no observations, about 22,000 rows per side fit through retained
`list_procedures` references, and about 10,000 through inline Evidence or CLI
`source_bundle` inputs. Work yields to
cancellation. No worker/provider concurrency is introduced; this budget is not
a bound on total process RSS.

The allowance defaults to 96 MiB and is the runtime setting
`native.matching_representation_bytes`, from 1 byte to 1 GiB. On MCP, call
`update_analysis_settings` with that setting and retry; it applies to the next
operation without restarting REA. For CLI or future REA processes, set
`REA_NATIVE_MATCHING_REPRESENTATION_BYTES` in the launch environment; `rea
setup` copies it into client registrations. An invalid launch value is refused
by matching only, and a runtime value repairs it. A refusal carries
`details.limit` with the effective value, its source and bounds. Raising the
allowance lets matching retain more in the REA process. The 1 GiB maximum is
an REA policy, not a host-capacity claim, and peak heap during a request can
exceed the allowance.

Summary delivery happens after complete matching Evidence is constructed and
retained. It reduces the initial reply, but does not avoid that construction or
raise the allowance. Repeated provenance remains
part of the complete member contract; splitting inventories into separate matches
would change global name/body uniqueness and is not an equivalent workaround.

The self-owned source fixture is [nativeFunctionMatching.c](https://github.com/morluto/rea/blob/main/tests/fixtures/nativeFunctionMatching.c).
On Linux x86-64, compile with `cc -O2 -g0 -fno-pie -no-pie -DVERSION=1` and
`-DVERSION=2`; copy the second binary and run `strip --strip-all` on that copy.
It includes unchanged/changed code, a byte-identical rename, a removed/added
observation, an inlined function, identical-code aliases and a renamed changed
function with an observed call/string signature. Analyze without executing the
fixture. Full-provider verification still needs caller-supplied Ghidra and Java.

Malformed inline Evidence is rejected after admission with its selected input field and observation index. A structurally valid record whose authenticated contents or digest disagree remains an integrity failure; changing input diagnostics does not make that record trustworthy.
