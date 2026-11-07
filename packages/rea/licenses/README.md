# Preserved licenses and attribution

Start with [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for the distinction
between distributed material and separately obtained tools. These files retain
upstream texts; they do not change [REA's MIT license](../LICENSE).

| Files                                                  | Provenance and scope                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm-dependencies.txt`                                 | Every package path in the root lockfile, with its exact version, declared license, scope, download URL, and integrity. Includes development and optional platform entries.                                                                                                                |
| `npm-runtime-notices.txt`                              | Original license, copyright, and NOTICE texts collected from integrity-verified locked runtime npm archives across all platforms; also the license of Rolldown's generated runtime helpers. The archive manifest's name and version are checked.                                          |
| `protobuf-es-v2.16.0-LICENSE.txt`                      | Original Apache license omitted from the protobuf-es npm archive, preserved from its v2.16.0 source commit. Its embedded Google BSD notice is retained in `npm-runtime-notices.txt`.                                                                                                      |
| `microsoft-uf2-MIT.txt`                                | Unchanged `LICENSE.txt` from microsoft/uf2 revision `cf3bd7f9c274b949528f8cd6a19eef2502a687d2`, for the UF2 family names copied from its `utils/uf2families.json`.                                                                                                                        |
| `nativeaot-parser-MIT.txt`                             | Original Washi notice for derived NativeAOT parser code; source revision is recorded in the parser and the root notices.                                                                                                                                                                  |
| `dotnet-runtime-MIT.txt`                               | Original .NET Foundation MIT text from the NativeAOT reference revision `a3b2d40328be0be3f8dd43f0e5cc925b8827b044`.                                                                                                                                                                       |
| `ghidra-12.1.4-{LICENSE,NOTICE,DISCLAIMER}.txt`        | Unchanged top-level documents from `Ghidra_12.1.4_build`. Ghidra is not bundled; these reference copies do not replace its component and GPL support-program notices. The US-government-specific disclaimer applies to Ghidra, not to REA.                                                |
| `cfworker-MIT.txt`, `xterm-MIT.txt`                    | Original notices missing from their published runtime npm archives, recovered from the releases' upstream Git revisions. They are included in the corresponding runtime entries.                                                                                                          |
| `Apache-2.0.txt`, `MIT-template.txt`                   | Standard license texts for explicitly documented upstream notice gaps. The MIT placeholders are not an attribution to an inferred author or year.                                                                                                                                         |
| `frida-17.23.2-COPYING.txt`, `LGPL-2.0.txt`            | Unchanged licensing supplements for the optional Frida dependency: tagged Frida wxWindows notice and GNU Library GPL v2 text. The npm archive and tagged Node binding omit a standalone license/copyright document; these texts do not recover binding or prebuild-component attribution. |
| `MinGW-w64-runtime.txt`                                | Upstream's combined runtime copyright and license notices, snapshot from v12.0.0, for the statically linked Windows addon. This is a notice snapshot, not a pin of the compiler used in release CI.                                                                                       |
| `GPL-3.0.txt`, `GCC-Runtime-Library-Exception-3.1.txt` | Unchanged GPLv3 and GCC runtime exception texts from GCC 14.2.0. The exception permits eligible compiled combinations under its conditions; the runtime keeps its own license. This snapshot does not assert that every release uses GCC 14.2.0.                                          |
| `Node-22.19.0-LICENSE.txt`                             | The original Node 22.19.0 license and third-party notices. The Windows addon uses Node-API headers from that release; the complete Node runtime and all components listed in this reference document are not bundled.                                                                     |
| `upstream-sources.json`                                | Source URLs and SHA-256 digests for the new unchanged reference and supplemental texts. These digests identify the preserved local texts.                                                                                                                                                 |

Additional preserved originals live at
[evmole/LICENSE](../third_party/evmole/LICENSE),
[pwndbg/LICENSE.md](../third_party/pwndbg/LICENSE.md), and
[the website dinosaur notice](../website/public/assets/licenses/dinosaur.txt).

## Collection scope and maintenance

The inventory and runtime texts were prepared from the root lockfile. The
collection downloaded the locked npm archives, checked their lockfile
integrity and package identity, and read license/NOTICE/copyright documents
without installing packages or executing lifecycle scripts. It includes
optional platform packages that may not be present in one local installation.
Temporary archives were removed after collection.

For releases that omit original documents, the collection uses pinned upstream
texts, embedded source/README license sections, or the same release's parent
notice for the `@lydell/node-pty` prebuilt family. `evmole@0.9.3` uses the existing
preserved upstream license. `clean-git-ref@2.0.1` and `minimisted@2.0.1` provide
only license and author metadata: their missing original copyright documents
remain explicitly identified in the runtime texts. Do not describe those
entries as complete recovered attribution.

`frida@17.23.2` also lacks an original standalone notice in its npm archive and
tagged Node source. Its declared license and the preserved licensing supplements
are recorded explicitly without inferring a copyright holder or year.

These records do not establish the legal accuracy of upstream metadata or
prove that every upstream source-file attribution has been supplied in an
archive. Review and refresh them when dependencies change; compare reference
texts with the sources and SHA-256 digests in `upstream-sources.json`.

When updating engines, copied code, website assets, or the Windows release
toolchain, review their actual upstream notices as well. The Linux MinGW-w64
compiler in release CI is not version-pinned by REA: compare its installed
runtime/component notices with the retained snapshots and update them if they
differ. Do not assume that a compiler change leaves redistribution requirements
unchanged. Preserve applicable originals with any additionally bundled engine;
top-level reference copies alone may not cover its entire distribution.

Generate the exact locked inventory with `npm run licenses:generate`. After
refreshing verified runtime notices, update their header fingerprint to the
generator's reported `runtime_dependency_fingerprint`, then run
`npm run licenses:check`; `docs:check` also runs this check. It compares the
inventory, runtime package identities,
license declarations, archive URLs/integrity, runtime dependency fingerprint,
and preserved reference digests. It does not verify legal completeness or
replace inspection of original upstream notices.
