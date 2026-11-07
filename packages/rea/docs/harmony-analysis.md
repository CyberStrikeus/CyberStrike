# Static HarmonyOS package inventory

REA inventories HarmonyOS application packages through the shared hardened
ZIP artifact reader in `src/artifacts/`, then projects the authenticated
inventory into an execution-free application graph. This is the first
increment of the HarmonyOS roadmap (#1431): package identification and
component inventory only.

Recognized root formats:

- `.hap` — installable application module
- `.hsp` — runtime shared package
- `.app` — distribution App Pack (HAP/HSP children are listed by path). The
  App Pack classification applies to verified-ZIP-magic root inputs only; a
  nested ZIP member ending in `.app` inside another package, such as an IPA,
  keeps the generic `zip` classification.

HarmonyOS `.har` shared libraries are intentionally not classified by suffix:
`.har` also names HTTP Archive JSON, so a Harmony shared archive requires
verified ZIP bytes and is deferred with an explicit limitation.

## Usage

No external SDK, toolchain, or engine is required. Inventory the package and
project the graph; CLI and MCP use the same workflow and return
artifact-bound Evidence inline:

```sh
rea inspect-artifact /path/to/Example.hap --format json > inspection.json
node --input-type=module -e 'import { readFileSync } from "node:fs"; console.log(JSON.stringify({ inventory_evidence: [JSON.parse(readFileSync("inspection.json", "utf8"))] }));' > projection-input.json
rea project-harmony-application-graph projection-input.json --format json
```

The MCP tool `project_harmony_application_graph` takes the same
`inventory_evidence` input. The projection reports:

- exact component paths, artifact IDs, and hashes (manifests, Ark bytecode,
  resources, native libraries, JavaScript, signing)
- a packaging-model hint: Stage is claimed only from an exactly cased `module.json` entry
  outside a classified resource path, FA only from `config.json` outside a
  classified resource path, otherwise `unknown`
- FA resources under `assets/<module>/resources/` as well as Stage `resources/`
- unavailable component paths with unknown IDs and hashes, including encrypted entries; these make projection coverage partial
- App Pack child package paths without recursive inventory
- runtime-family hints (`ark`, `native`, `javascript`) from paths and formats
- path-based N-API bridge hypotheses between bytecode and `libs/<abi>` native
  libraries

An unavailable manifest can still supply a path-based model hint; its content
identity remains unknown. Manifest names follow case-sensitive ZIP member names.

File and slice occurrences supply component and child-package paths; directory
trees and symlinks retain their identities in the source inventory without
being classified as code files. Ark and JavaScript runtime hints summarize the
classified bytecode and JavaScript lists; supported source extensions share the
same classification rule as their component rows.

Every claim is path-presence only. Manifest semantics (module identity,
abilities, entry points, permissions, dependencies), Ark bytecode contents and
versions, resource resolution, signing verification, and observed native
boundaries are out of scope for this increment and stay in the projection's
`limitations` array until a dedicated HarmonyOS provider exists. REA fails
closed on packages whose inventory cannot be authenticated.

## Verification lane

`npm run fixtures:harmony` downloads the SHA-256-pinned 1.0.1 HAP release
from the MIT-licensed [harmony-next-pipeline source repository](https://github.com/ohosvscode/harmony-next-pipeline)
into ignored `_reference/harmony-integration/`. The pin records the source
revision, release asset ID, size, and digest. The downloaded artifact is not
redistributed; bundled component licenses have not been independently audited.

```sh
npm run fixtures:harmony
REA_HARMONY_TEST_HAP=_reference/harmony-integration/entry-default-unsigned.hap \
  npm run verify:harmony
```

The lane exercises the compiled CLI and actual SDK-connected stdio MCP:
`inspect_artifact` authenticity, projection determinism, Stage-model path hints,
exact manifest/bytecode/resource component sets, empty native and bridge sets,
complete-inventory coverage, and CLI/MCP parity. It checks that this fixture has
no META-INF signing entries; that does not establish whether the package is signed.

The release artifact's compiler/SDK versions and reproducible source build have
not been independently established. This lane does not complete the pinned
toolchain acceptance in #1431 and does not verify Ark decoding or signatures.
Set `REA_HARMONY_ENTRYPOINT` to an installed package's `scripts/rea.mjs` to run
the same checks against that package; the default lane uses the repository build.

Packaging-model and App Pack child presence use inventoried file/slice paths even
when encrypted content cannot be authenticated. Unavailable App Pack children
retain their path, format, encryption and limitations with null artifact ID and
digest; they do not establish decoded package semantics. Missing source nodes
outside supplied pages retain the inventory limitation and partial coverage.
The signing list includes inventoried META-INF RSA, DSA and EC certificate-block
paths alongside the existing suffixes; opaque content does not establish a valid
signature or certificate.
