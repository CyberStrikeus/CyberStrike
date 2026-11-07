# Third-party notices

REA-authored code is licensed under [MIT](LICENSE). Third-party material retains
its own copyright, license, attribution, and NOTICE requirements. REA's MIT
license grants no rights to proprietary analysis tools. Project and product
names identify integrations; they do not imply affiliation or endorsement.

This inventory covers the locked npm dependency graph, code or assets derived
from upstream projects, and separately obtained engines used by REA. A listed
integration is not a statement that its executable is bundled. Upstream
components and caller-selected versions may have additional terms; retain the
notices supplied with the software you actually obtain or redistribute.

## Distributed dependencies, derived code, and assets

| Material                 | Use and licensing records                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm dependencies         | [Complete inventory](licenses/npm-dependencies.txt) of every entry in `package-lock.json`, including transitive, optional platform, development, and website dependencies. [Runtime notices](licenses/npm-runtime-notices.txt) preserve the copyright, license, and NOTICE documents from integrity-verified release archives, plus the MIT notice for Rolldown's generated runtime helpers. Development dependencies are inventoried but are not all distributed in REA's npm package.                                                                                                                                                                                                                       |
| pefile ordinal tables    | Import-hash ordinal names are derived from [pefile 2024.8.26](https://github.com/erocarrera/pefile/tree/4b3b1e2e568a88d4f1897d694d684f23d9e270c4), copyright 2004–2024 Ero Carrera. Preserve the [MIT license](licenses/pefile-2024.8.26-LICENSE.txt). The Python package is not a runtime dependency.                                                                                                                                                                                                                                                                                                                                                                                                        |
| UF2 family names         | UF2 family IDs and short names are copied from [microsoft/uf2 `utils/uf2families.json`](https://github.com/microsoft/uf2/blob/cf3bd7f9c274b949528f8cd6a19eef2502a687d2/utils/uf2families.json), copyright Microsoft Corporation. Preserve the [MIT license](licenses/microsoft-uf2-MIT.txt).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| NativeAOT parser         | REA's derived parser uses the MIT-licensed [ghidra-nativeaot](https://github.com/Washi1337/ghidra-nativeaot/tree/effeb734fc570c32650f88b159608979dc7b423e) work of Washi and the NativeAOT layout definitions in [dotnet/runtime](https://github.com/dotnet/runtime/tree/a3b2d40328be0be3f8dd43f0e5cc925b8827b044). Preserve [Washi's MIT notice](licenses/nativeaot-parser-MIT.txt) and the [.NET Foundation MIT notice](licenses/dotnet-runtime-MIT.txt).                                                                                                                                                                                                                                                   |
| EVM analysis             | `evmole@0.9.3`, MIT, copyright 2023 Maxim Andreev. The published npm archive omits its license document; REA retains the [original upstream license](third_party/evmole/LICENSE) and [provenance](third_party/evmole/README.md). It is also included in the runtime notices.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Windows native addon     | The release addon is compiled with MinGW-w64 and statically links GCC runtime libraries. Preserve the [MinGW-w64 runtime notices](licenses/MinGW-w64-runtime.txt), [GPLv3 text](licenses/GPL-3.0.txt), and [GCC Runtime Library Exception 3.1](licenses/GCC-Runtime-Library-Exception-3.1.txt). The exception governs eligible compiled combinations; it does not relicense the runtime itself under MIT. The Node-API build headers are from Node 22.19.0; its [original license and component notices](licenses/Node-22.19.0-LICENSE.txt) are retained. Node itself is supplied by the user. Snapshot provenance and release-toolchain review requirements are in [licenses/README.md](licenses/README.md). |
| Dinosaur website example | Selected excerpts from [wayou/t-rex-runner](https://github.com/wayou/t-rex-runner/tree/5455bfa408ec6b707c7300ff194b7390733a766d), derived from Chromium's dinosaur game. The website retains the [original BSD-3-Clause notices](website/public/assets/licenses/dinosaur.txt), including Chromium authors and wayou. This asset is not part of the npm runtime.                                                                                                                                                                                                                                                                                                                                               |

Two locked runtime releases, [`clean-git-ref@2.0.1`](https://github.com/TheSavior/clean-git-ref/tree/bf3c8afc8032bcdc6a53634c18b601dc6df478fb) (declared Apache-2.0) and
[`minimisted@2.0.1`](https://github.com/kt3k/minimisted/tree/95fdfb8d6efb9546c1117854fe3a58105f6332ce) (declared MIT), omit a full license/copyright document in their
published archives and inspected upstream release sources. Their runtime notice
entries preserve the declared license and author metadata and include a clearly
labeled standard license text. These are documented upstream notice gaps, not
recovered copyright notices or a claim that attribution has been fully verified.

The optional `frida@17.23.2` npm archive and tagged Node binding source also
omit a standalone license/copyright document. Its declared
`LGPL-2.0 WITH WxWindows-exception-3.1` license is recorded with unchanged
[Frida licensing text](licenses/frida-17.23.2-COPYING.txt) and the
[GNU Library GPL v2](licenses/LGPL-2.0.txt). These are licensing supplements,
not recovered Node binding or prebuild-component copyright notices.

## Open-source engine credits and licenses

We thank the maintainers and contributors of the projects below. Their
decompilers, binary-analysis engines, debuggers, parsers, and capture tools
provide capabilities used through REA's integrations. Each row identifies the
upstream project, its own license, and its role in REA. In particular, JADX
provides the Android decompiler, while jadx-headless-mcp provides the separate
headless integration used by REA; both projects deserve credit.

These acknowledgments are voluntary thanks. Required upstream copyright and
NOTICE texts remain in their original form and are not replaced by this
summary. Credits do not imply endorsement or change any license.

REA's adapters do not grant, replace, or waive these licenses. The upstream
executables and their dependency graphs are supplied separately. Git submodules
pin inspection sources; they are not included in the npm package.

| Project                        | License and source                                                                                                                                                                                                                                       | REA relationship                                                                                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ghidra                         | [Apache-2.0](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.4_build/LICENSE), with the government-work and component qualifications in its [NOTICE](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.4_build/NOTICE) | Bring your own Ghidra; see [supported versions](docs/installation.md#ghidra). Copies of the 12.1.4 [LICENSE](licenses/ghidra-12.1.4-LICENSE.txt), [NOTICE](licenses/ghidra-12.1.4-NOTICE.txt), and [DISCLAIMER](licenses/ghidra-12.1.4-DISCLAIMER.txt) are retained for reference. |
| ghidra-nativeaot               | [MIT](https://github.com/Washi1337/ghidra-nativeaot/blob/effeb734fc570c32650f88b159608979dc7b423e/LICENSE.md)                                                                                                                                            | Pinned inspection source; derived parser attribution above.                                                                                                                                                                                                                        |
| JADX                           | [Apache-2.0](https://github.com/skylot/jadx/blob/v1.5.6/LICENSE)                                                                                                                                                                                         | The audited jadx-headless-mcp source uses JADX 1.5.6 for Android decompilation; the engine JAR is separately supplied.                                                                                                                                                             |
| jadx-headless-mcp              | [Apache-2.0](https://github.com/1013503897/jadx-headless-mcp/blob/5844800a486d2248fa949b74c9896285f5b54de2/LICENSE)                                                                                                                                      | v0.7.1; pinned submodule and user-supplied JAR.                                                                                                                                                                                                                                    |
| Kuna                           | [Apache-2.0](https://github.com/Noelo-Lab/kuna/blob/v1.986/LICENSE), with its [NOTICE](https://github.com/Noelo-Lab/kuna/blob/v1.986/NOTICE)                                                                                                             | Bring your own `kuna`; REA verified 1.986 and never downloads, installs or bundles it. REA invokes it as a separate process.                                                                                                                                                       |
| Apktool                        | [Apache-2.0](https://github.com/iBotPeaches/Apktool/blob/master/LICENSE.md)                                                                                                                                                                              | User-supplied Android resource decoder.                                                                                                                                                                                                                                            |
| Binwalk                        | [MIT](https://github.com/ReFirmLabs/binwalk/blob/4fdab3d464d97b68e0af9088df3f9e2e1545b21c/LICENSE)                                                                                                                                                       | v3.1.0; pinned submodule and user-supplied firmware engine.                                                                                                                                                                                                                        |
| Unblob                         | [MIT](https://github.com/onekey-sec/unblob/blob/1fcc7a0a584a70a96c31f5a276c20944d199a089/LICENSE)                                                                                                                                                        | 26.6.4; pinned submodule and user-supplied firmware engine.                                                                                                                                                                                                                        |
| Wakaru                         | [Apache-2.0](https://github.com/pionxzh/wakaru/blob/8219bf5016a063d7fb215101a8c45d5959ec733f/LICENSE)                                                                                                                                                    | v1.14.0; pinned source and separately obtained JavaScript reconstruction tooling.                                                                                                                                                                                                  |
| WABT                           | [Apache-2.0](https://github.com/WebAssembly/wabt/blob/ff0ef7e0009402740c805a9744c09b05be063e48/LICENSE)                                                                                                                                                  | v1.0.42; external WebAssembly tools; [integration provenance](third_party/wabt/README.md).                                                                                                                                                                                         |
| pwntools                       | [MIT, with GPL/BSD component qualifications](https://github.com/Gallopsled/pwntools/blob/3ad86ec5adab1abf9781ca7552a6f5d7cff7a33c/LICENSE-pwntools.txt)                                                                                                  | 4.15.0; caller-supplied offline ELF analysis package.                                                                                                                                                                                                                              |
| pyelftools                     | [Public-domain dedication and component notices](https://github.com/eliben/pyelftools/blob/v0.33/LICENSE)                                                                                                                                                | 0.33; includes separately licensed bundled material, including Construct.                                                                                                                                                                                                          |
| Unicorn                        | [GPL-2.0 and component notices](https://github.com/unicorn-engine/unicorn/blob/2.1.2/COPYING)                                                                                                                                                            | 2.1.2; used by the caller-supplied ELF analysis profile for instruction emulation.                                                                                                                                                                                                 |
| pwndbg                         | [MIT](third_party/pwndbg/LICENSE.md)                                                                                                                                                                                                                     | 2026.09.15, commit `55596aa676a2756efb8d67034f31675170eabe48`; separately obtained debugger extension.                                                                                                                                                                             |
| GNU GDB                        | [GPL-3.0-or-later](https://sourceware.org/git/?p=binutils-gdb.git;a=blob;f=gdb/COPYING)                                                                                                                                                                  | Caller-supplied debugger for the optional pwndbg core-file workflow.                                                                                                                                                                                                               |
| LLDB / LLVM                    | [Apache-2.0 with LLVM exceptions](https://github.com/llvm/llvm-project/blob/main/LICENSE.TXT)                                                                                                                                                            | Caller-supplied debugger; the installed distribution's component and historical notices also apply.                                                                                                                                                                                |
| mitmproxy                      | [MIT](https://github.com/mitmproxy/mitmproxy/blob/6c09d56e4c29a92f5ad01b03199977584b8ea14f/LICENSE)                                                                                                                                                      | 12.2.3; separately supplied network capture proxy.                                                                                                                                                                                                                                 |
| Android Debug Bridge (adb)     | [Apache-2.0](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/NOTICE)                                                                                                                                                    | User-supplied Android device tool. A complete Android SDK download has its own [SDK license terms](https://developer.android.com/studio/terms); adb's source license does not replace them.                                                                                        |
| ILSpy / ICSharpCode.Decompiler | [MIT](https://github.com/icsharpcode/ILSpy/blob/master/ICSharpCode.Decompiler/Properties/AssemblyInfo.cs)                                                                                                                                                | Optional separately installed .NET decompiler; not a redistributed REA dependency.                                                                                                                                                                                                 |

Ghidra's original notice credits software developed at the National Security
Agency. It explains that US-government-created portions are not subject to US
copyright protection, while other portions retain their authors' rights. Its
modules include additional third-party licenses, and standalone programs under
`GPL/` have GPLv3 terms. The three retained top-level documents do not replace
the module notices and license directories in a complete Ghidra distribution.
REA is not affiliated with or endorsed by the NSA.

## Commercial tools and bridges

**You must legally obtain the tools and the rights needed for your use.** REA
does not include an IDA Pro, Hex-Rays decompiler, Hopper, or JEB license, license
key, or activation entitlement. A permitted trial/demo may be used only within
its official terms. Cracked copies, stolen keys, unauthorized sharing, and
bypassing activation or license limits are not authorized by REA.

| Project / product                | Applicable terms and distinction                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDA Pro and Hex-Rays decompilers | Proprietary Hex-Rays software governed by the [EULA](https://hex-rays.com/eula), purchase agreement, and applicable license scheme. Obtain rights for the required product, user, machine, decompiler, and automation interfaces. Availability of an API or a bridge does not grant hosting, service, or additional-user rights.                                                                                                                           |
| ida-pro-mcp                      | The bridge's [MIT license](https://github.com/mrexodia/ida-pro-mcp/blob/main/LICENSE) belongs to Duncan Ogilvie. It licenses the bridge code, not IDA or Hex-Rays products. Its [README](https://github.com/mrexodia/ida-pro-mcp#prerequisites) requires IDA Pro and explicitly states that IDA Free is unsupported. Follow the prerequisites for the version you actually install. The bridge is separately supplied, not bundled by REA.                 |
| Hopper Disassembler              | Proprietary Cryptic Apps software under its [license agreement](https://www.hopperapp.com/license_agreement.html). Personal and computer licenses have different permitted-user and installation rules; an official evaluation trial is available. REA setup may obtain the official installer after approval, but this grants no paid license or activation entitlement.                                                                                  |
| JEB                              | Proprietary PNF Software product under its [EULA](https://www.pnfsoftware.com/jeb/LICENSE.TXT) and edition-specific agreement. Check user/seat/server rights and whether your edition permits automation, backend/service integration, and disclosure of generated output. The published EULA restricts public or third-party disclosure of decompiled code, reconstructed artifacts, and analysis reports unless expressly permitted by the license type. |

The vendor's applicable agreement controls. These summaries do not interpret
your individual contract or expand the rights it grants. Verify permissions
before publishing analysis output, sharing tool access, or operating a service.
Vendor terms above were checked on 2026-10-12.

## Runtimes, development tooling, and fixtures

REA uses a caller-supplied Node.js runtime ([MIT and component notices](https://github.com/nodejs/node/blob/main/LICENSE)).
Optional workflows may also use Python ([PSF and component licenses](https://docs.python.org/3/license.html)),
OpenJDK ([GPLv2 with Classpath Exception and component notices](https://openjdk.org/legal/)),
Electron ([MIT and component notices](https://github.com/electron/electron/blob/main/LICENSE)),
or a Chromium-based browser ([BSD-3-Clause and third-party licenses](https://chromium.googlesource.com/chromium/src/+/main/LICENSE)).
These external installations are not licensed or bundled by REA's MIT license.

Development, test, and website npm packages are included in the locked inventory.
GitHub Actions, operating-system utilities, downloaded verification fixtures,
and their runtimes retain the terms supplied by their publishers. Fixture
identities and provenance are recorded under `scripts/fixtures/` and the
existing `third_party/` records; downloaded executable fixtures are not tracked
or included in the npm package. This notice does not claim to inventory every
dependency of a caller's operating system, agent, or separately installed tool.

## Maintaining and redistributing notices

Refresh the dependency inventory and runtime notice collection when the lockfile
changes. Review the actual versions and distributed contents, retain the
upstream license and copyright texts, and account for optional platform
packages. See [licenses/README.md](licenses/README.md) for source provenance,
collection scope, and known upstream notice gaps.

The npm package includes this document, the `licenses/` directory, and the
existing redistributed license records under `third_party/`. If you additionally
bundle an external engine or modify upstream code, review that actual
distribution and retain its full applicable licenses, copyright notices,
NOTICE files, modification notices, and source obligations. REA's inventory is
not a substitute for those obligations.
