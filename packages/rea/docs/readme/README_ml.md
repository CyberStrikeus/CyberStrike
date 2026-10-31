<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · **മലയാളം** · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: എന്തും Reverse Engineer ചെയ്യുക

### Binaries, applications, runtime behavior എന്നിവയുടെ Reverse Engineering-നായി ഒരൊറ്റ MCP.

**നിങ്ങൾക്ക് ഇഷ്ടപ്പെട്ട ഒരു feature കണ്ടോ? അത് എങ്ങനെ പ്രവർത്തിക്കുന്നു എന്ന് binary തലത്തിലേക്ക് വരെ മനസ്സിലാക്കൂ.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#എന്തൊക്കെ-വിശകലനം-ചെയ്യാം)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[വെബ്സൈറ്റ്](https://rea.tools/) · [ഗൈഡുകൾ](https://rea.tools/guides/) · [ഉദാഹരണങ്ങൾ](https://rea.tools/showcase/)**

[ദ്രുതാരംഭം](#ദ്രുതാരംഭം) · [REA എങ്ങനെ പ്രവർത്തിക്കുന്നു](#rea-എങ്ങനെ-പ്രവർത്തിക്കുന്നു) · [എന്തൊക്കെ വിശകലനം ചെയ്യാം](#എന്തൊക്കെ-വിശകലനം-ചെയ്യാം) · [ഉദാഹരണങ്ങൾ](#ഉദാഹരണങ്ങൾ) · [RL പരിതസ്ഥിതികൾ നിർമ്മിക്കുക](#build-rl-environments) · [പതിവുചോദ്യങ്ങൾ](#പതിവുചോദ്യങ്ങൾ) · [ഡോക്യുമെന്റേഷൻ](#ഡോക്യുമെന്റേഷൻ)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> REA ലഭ്യമാക്കേണ്ടത് [morluto/rea](https://github.com/morluto/rea),
> [rea.tools](https://rea.tools/), അല്ലെങ്കിൽ [rea-agents npm package](https://www.npmjs.com/package/rea-agents) എന്നിവയിൽ നിന്നാണ്.
> ഈ ഔദ്യോഗിക ഉറവിടങ്ങളിലെ ഇൻസ്റ്റലേഷൻ, റിലീസ് ലിങ്കുകൾ പിന്തുടരുക. സമാനമായ
> repository പേരോ പകർത്തിയ README-യോ മാത്രം ഒരു download ഔദ്യോഗികമാണെന്ന് ഉറപ്പാക്കുന്നില്ല.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="ഒരു native binary പരിശോധിക്കുന്നതിനിടെ Hopper-ൽ REA അതിന്റെ analysis bridge ആരംഭിക്കുന്നു" width="1200" />

<br /><br />

<table aria-label="REA community">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Reverse Engineering കമ്മ്യൂണിറ്റിയിൽ ചേരുക</strong>
  </a><br />
  <sub>Discord · ചോദ്യോത്തരങ്ങൾ · അനുഭവങ്ങളും കണ്ടെത്തലുകളും പങ്കിടുക</sub>
</td>
</tr>
</table>

<br />

</div>

---

നിങ്ങളുടെ സ്വന്തം product-ൽ ഉൾപ്പെടുത്താൻ ആഗ്രഹിക്കുന്ന ഒരു feature ഏതെങ്കിലും app-ൽ കണ്ടോ? REA ഉപയോഗിച്ച് അത് പരിശോധിക്കാൻ നിങ്ങളുടെ agent-നോട് ആവശ്യപ്പെടുക. source code ഇല്ലാതെയും അതിന് app പരിശോധിക്കാനും feature എങ്ങനെ പ്രവർത്തിക്കുന്നുവെന്ന് വിശദീകരിക്കാനും അതിനുള്ള തെളിവുകൾ കാണിക്കാനും നിങ്ങളുടെ project-നായി അതിന് സമാനമായൊരു പതിപ്പ് നിർമ്മിക്കാനും കഴിയും.

Native binaries, JavaScript, Electron apps, .NET assemblies, websites എന്നിവ പരിശോധിക്കുന്നതിനുള്ള tools-ലേക്ക് REA നിങ്ങളുടെ agent-നെ ബന്ധിപ്പിക്കുന്നു. ഇതേ tools നിങ്ങളുടെ terminal-ൽ നിന്നും ഉപയോഗിക്കാം. വിശകലനം local ആയി നടക്കുന്നു; ഓരോ നിഗമനത്തിനും പിന്നിലെ തെളിവുകളും പരിമിതികളും ഫലങ്ങളിൽ ഉൾപ്പെടുന്നു.

Setup നിങ്ങളുടെ agent-ിൽ REA രജിസ്റ്റർ ചെയ്യുകയും അനുയോജ്യമായ workflow നിർദ്ദേശങ്ങൾ ഇൻസ്റ്റാൾ ചെയ്യുകയും ചെയ്യുന്നു. Native analysis-നായി നിലവിലുള്ള Hopper, Ghidra, IDA, അല്ലെങ്കിൽ Kuna installation ഉപയോഗിക്കാം; അനുമതി നൽകിയാൽ setup-ന് Hopper ഇൻസ്റ്റാൾ ചെയ്യാനും കഴിയും. Static JavaScript analysis-ന് native analysis engine ആവശ്യമില്ല.

> **[REA വെബ്സൈറ്റ് സന്ദർശിക്കുക](https://rea.tools/)** — setup നിർദ്ദേശങ്ങൾക്കും ചിത്രങ്ങളോടുകൂടിയ ഗൈഡുകൾക്കും യഥാർത്ഥ case study-കൾക്കും.

## ദ്രുതാരംഭം

Linux-ൽ Ghidra, JADX, firmware tool launches, static JavaScript/Electron analysis എന്നിവയ്ക്ക് process ownership പരിശോധിക്കാൻ REA-യുടെ `PATH`-ൽ procps-compatible `ps` ആവശ്യമാണ്. പരിഹാര നടപടികൾ `docs/installation.md`-യിലെ "Linux owned-process prerequisite" എന്ന വിഭാഗത്തിൽ ലഭ്യമാണ്.

### നിങ്ങളുടെ agent സജ്ജമാക്കുക

Node.js-ഉം npm-ഉം ഇൻസ്റ്റാൾ ചെയ്തശേഷം ഈ command പ്രവർത്തിപ്പിക്കുക:

```bash
npx rea-agents setup
```

നിങ്ങൾ ഉപയോഗിക്കുന്ന agents തിരഞ്ഞെടുക്കുക, നിർദ്ദേശിച്ച മാറ്റങ്ങൾ പരിശോധിക്കുക, തുടർന്ന് അവയ്ക്ക് അനുമതി നൽകുക. നിലവിലുള്ള configuration-ന്റെ backup-ുകൾ സൂക്ഷിച്ചുകൊണ്ട് setup, REA-യുടെ MCP server-ഉം അനുയോജ്യമായ workflow നിർദ്ദേശങ്ങളും ചേർക്കും. അതിനുശേഷം നിങ്ങളുടെ agent വീണ്ടും ആരംഭിക്കുക.

Claude Code, Codex, Cursor, Gemini CLI, Grok Build, കൂടാതെ [മറ്റ് agents](../installation.md#supported-agents) എന്നിവയെ setup പിന്തുണയ്ക്കുന്നു. provider configuration-നും manual MCP registration-നും [installation and setup](../installation.md) കാണുക.

MCP സാധാരണയായി compact input schemas ഉപയോഗിക്കുന്നു. പൂർണ്ണ field guidance-ഉം nested validation details-ഉം വേണമെങ്കിൽ MCP registration-ൽ `REA_MCP_INPUT_SCHEMA_PROFILE=full` സജ്ജമാക്കുക. രണ്ടു profiles-ലും എല്ലാ tools-ഉം ഒരേ canonical server validation-ഉം നിലനിൽക്കും; MCP contracts guide കാണുക.

### നിങ്ങളുടെ agent-നോട് ആവശ്യപ്പെടുക

```text
Notes app-ൽ search എങ്ങനെ പ്രവർത്തിക്കുന്നു എന്ന് മനസ്സിലാക്കി, അതിനുള്ള തെളിവുകൾ കാണിച്ചുതരികയും എന്റെ project-നായി സമാനമായൊരു feature നിർമ്മിക്കുകയും ചെയ്യുക.
```

`Notes` എന്നതിന് പകരം നിങ്ങൾ പരിശോധിക്കാൻ ആഗ്രഹിക്കുന്ന app-ിന്റെയും മനസ്സിലാക്കേണ്ട feature-ിന്റെയും പേരുകൾ നൽകുക.

### Terminal ഉപയോഗിക്കുക

Extract ചെയ്ത JavaScript/Electron app directory അല്ലെങ്കിൽ ASAR പരിശോധിക്കുക:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

ഫലത്തിൽ modules, imports, Electron boundaries, അവയ്ക്കുള്ള തെളിവുകൾ എന്നിവ ഉൾപ്പെടും. `/absolute/path/to/app` എന്നതിന് പകരം നിങ്ങളുടെ target-ന്റെ path നൽകുക; Windows-ൽ ഉദാഹരണത്തിന് `"D:/apps/example"` ഉപയോഗിക്കാം.

സാധാരണ ഉപയോഗത്തിനായി `rea` command ഇൻസ്റ്റാൾ ചെയ്യാൻ:

```bash
npm install --global rea-agents
rea --help
```

Native analysis നടത്തുന്നതിന് മുമ്പ് ഒരു provider ക്രമീകരിക്കുക. Native commands, provider തിരഞ്ഞെടുക്കൽ, snapshots, scripting എന്നിവയ്ക്കായി [CLI and Evidence guide](../cli.md) കാണുക.

### REA അപ്‌ഡേറ്റ് ചെയ്യുക

REA-യിൽ പതിവായി മാറ്റങ്ങൾ വരുന്നു; പുതിയ releases-ൽ പല bug fixes-ഉം ഉൾപ്പെടുന്നു. നിങ്ങളുടെ installation ഏറ്റവും പുതിയ പതിപ്പിലേക്ക് അപ്‌ഡേറ്റ് ചെയ്യുക.

`npm install --global` അല്ലെങ്കിൽ `bun add --global` ഉപയോഗിച്ച് ഇൻസ്റ്റാൾ ചെയ്ത CLI-ക്കായി:

```bash
rea update
```

`rea --update`, `rea update`-ന്റെ alias ആണ്; ഒരേ global output flags സ്വീകരിക്കുന്നു. Update commands stdout/stderr ചേർത്ത് പരമാവധി 4 MiB സൂക്ഷിക്കുന്നു. വലിയ metadata replies command അവസാനിച്ചശേഷം നിരസിക്കും; verbose installs bounded diagnostics സൂക്ഷിക്കുന്നു. Progress output terminal backpressure പാലിക്കുകയും സമർപ്പിച്ച writes തീരാൻ കാത്തിരിക്കുകയും ചെയ്യുന്നു.

Bun-ന്റെ global updates-ന് Bun 1.2.17 അല്ലെങ്കിൽ അതിനുശേഷമുള്ള പതിപ്പ് ആവശ്യമാണ്. പഴയ Bun പതിപ്പാണെങ്കിൽ `rea update` പ്രവർത്തിപ്പിക്കുന്നതിന് മുമ്പ് Bun സ്വമേധയാ അപ്‌ഗ്രേഡ് ചെയ്യുക.

Agent registrations-ഉം skill-ഉം പുതുക്കാൻ, update കാണിക്കുന്ന setup command പ്രവർത്തിപ്പിക്കുക.

`npx` ഉപയോഗിക്കുന്നുവെങ്കിൽ, agent setup പുതുക്കാൻ:

```bash
npx rea-agents@latest setup
```

Setup-ൽ വരുത്തുന്ന മാറ്റങ്ങൾ പരിശോധിച്ച് നിങ്ങളുടെ agent വീണ്ടും ആരംഭിക്കുക. ഒറ്റത്തവണ മാത്രം ഉപയോഗിക്കുന്ന CLI commands-നായി command-ന് മുമ്പ് `npx rea-agents@latest` ഉപയോഗിക്കുക. Bun ഉപയോഗിക്കുമ്പോൾ `npx rea-agents@latest`-ന് പകരം `bunx rea-agents@latest` ഉപയോഗിക്കുക.

## REA എങ്ങനെ പ്രവർത്തിക്കുന്നു

Target പരിശോധിക്കാനും പ്രസക്തമായ code-ന്റെ പാത പിന്തുടരാനും നിങ്ങളുടെ agent MCP വഴി REA-യെ വിളിക്കുന്നു. REA കണ്ടെത്തലുകളും അവയ്ക്കുള്ള തെളിവുകളും തിരികെ നൽകുന്നു. തുടർന്ന് agent കൂടുതൽ ചോദ്യങ്ങൾ ചോദിക്കാനും പെരുമാറ്റം വിശദീകരിക്കാനും implementation എഴുതുകയും പരിശോധിക്കുകയും ചെയ്യാനും അവ ഉപയോഗിക്കുന്നു. CLI commands-ഉം ഇതേ workflows ഉപയോഗിക്കുന്നു.

![REA അന്വേഷണ പ്രവാഹം: നിങ്ങളുടെ agent ഒരു local target-നെക്കുറിച്ച് ചോദിക്കുന്നു; REA analysis tools ഉപയോഗിച്ച് അത് പരിശോധിക്കുകയും code-ന്റെ പാത പിന്തുടരുകയും ചെയ്യുന്നു; തിരികെ ലഭിക്കുന്ന code, references, അറിയാത്ത കാര്യങ്ങൾ എന്നിവ ഉപയോഗിച്ച് agent വിശദീകരിക്കുകയും implementation നടത്തുകയും പരിശോധിക്കുകയും ചെയ്യുന്നു.](../../website/public/assets/figures/rea-investigation-flow.svg)

[പൂർണ്ണ വലുപ്പത്തിലുള്ള ചിത്രം തുറക്കുക](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## എന്തൊക്കെ വിശകലനം ചെയ്യാം

REA-യ്ക്ക് Node.js 22.x (>=22.23.4), 24.x (>=24.22.1), അല്ലെങ്കിൽ 26+ (>=26.12.1) പതിപ്പും npm-ഉം ആവശ്യമാണ്. Target അനുസരിച്ച് അധിക tools-ഉം host support-ഉം വ്യത്യാസപ്പെടും:

| Target                 | REA നൽകുന്ന ഫലങ്ങൾ                                                                             | ആവശ്യകതകളും ഗൈഡും                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Native binaries        | Pseudocode, assembly, strings, symbols, calls, references                                   | Hopper, Ghidra, IDA അല്ലെങ്കിൽ Kuna; [native analysis](../native-investigation.md)                                                  |
| Offline ELF layout     | Sections, segments, യഥാർത്ഥ symbols/relocations, static mitigation candidates                 | Linux x64-ൽ caller നൽകുന്ന pwntools; [binary diagnostics](../binary-diagnostics.md)                                                 |
| Go binaries            | ഉൾച്ചേർത്ത compiler version, modules, replacements, build settings                            | Built-in static ELF/PE/thin Mach-O പരിശോധന; Go installation ആവശ്യമില്ല                                                              |
| Rust binaries          | ഉൾച്ചേർത്ത cargo-auditable crate പേരുകൾ, versions, sources, dependency edges                   | Built-in static ELF/PE/thin Mach-O പരിശോധന; [Rust binaries](../rust-binaries.md)                                                  |
| PE certificates        | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                           |
| PE imports             | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                  | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                     |
| ELF notes              | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                             | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                      |
| Linux kernel modules   | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                 | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                            |
| Erlang BEAM            | IFF chunks, atoms, exports, and tables                                                      | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                 |
| WASM artifact          | Validation, sections, കൃത്യമായ import/export WAT രൂപങ്ങൾ, decoded WAT                            | Caller നൽകുന്ന WABT 1.0.42; `inspect_wasm_artifact`                                                                                 |
| EVM bytecode           | Dispatch selectors, byte offsets, അനുമാനിച്ച arguments, mutability                             | Linux x64-ൽ local raw/hex carrier; [offline EVM guide](../evm-bytecode.md)                                                        |
| SQLite databases       | Tables, columns, indexes, views, triggers, തിരഞ്ഞെടുത്ത സാധാരണ table rows                        | Local database/WAL snapshot; native SQLite പരിമിതികളോടെ Node.js 24.x >=24.15 അല്ലെങ്കിൽ 26+                                         |
| Apple IPS crashes      | .ips metadata, threads, images, registers and crash classes                                 | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                     |
| Recorded Linux crashes | Raw notes, രേഖപ്പെടുത്തിയ ഓരോ thread-ന്റെയും registers/signals, ഐച്ഛിക mapping candidates         | Linux x64-ൽ caller നൽകുന്ന pwntools; ഐച്ഛിക GDB/pwndbg; [recorded crashes](../recorded-crashes.md)                                   |
| ഡെസ്ക്ടോപ്പ് ഇൻസ്റ്റലേഷനുകൾ   | റൺടൈം സാധ്യതകൾ, തെളിവ് ഫയലുകൾ, ഘടക സൂചനകൾ, തുടർ നടപടികൾ                                           | പരിധിയുള്ള ഡയറക്ടറി, ഹെഡർ പരിശോധന；[ഡെസ്ക്ടോപ്പ് ആപ്ലിക്കേഷനുകൾ](../desktop-applications.md)                                                |
| JavaScript / Electron  | Modules, imports, source maps, routes, IPC, native add-on ബന്ധങ്ങൾ                            | Node.js, npm; Linux: procps-compatible `ps`; [application analysis](../javascript-application-workflows.md)                       |
| Websites               | Page structure, scripts, network observations, ആവശ്യപ്പെട്ട screenshots                        | Chrome-family browser; [browser analysis](../browser-observation.md)                                                              |
| Saved network captures | Requests, responses, പുറത്തുകാണുന്ന payload-ുകൾ, source locations                                  | HAR അല്ലെങ്കിൽ Fiddler Everywhere SAZ; native mitmproxy-നായി Linux-ൽ mitmdump; [capture guide](../web-network-captures.md)           |
| .NET assemblies        | Metadata, CIL instructions, പ്രഖ്യാപിച്ച native dependencies, build comparisons                 | ഒന്നും ആവശ്യമില്ല (static മാത്രം); [managed-code guide](../managed-code-analysis.md)                                                    |
| Python packaged apps   | CArchive/PYZ entries, Python version, bytecode, resources and runtime options               | Static PyInstaller parsing; [Python guide](../python-packaged-applications.md)                                                    |
| Android APKs           | Manifest declarations, classes, decompiled methods, references                              | Linux/macOS/Windows x64-ൽ Headless JADX-ഉം full JDK-ഉം; [Android guide](../android-analysis.md)                                   |
| Android devices        | Devices, packages, processes, logs, dumps, screen captures, APK/file transfers              | Caller നൽകുന്ന adb (emulator അല്ലെങ്കിൽ hardware); [ADB guide](../adb-device-analysis.md)                                             |
| JEB projects           | Engine-backed project units, artifact digests, type/method pseudo-code                      | MCP സേവനം നൽകുന്ന caller ആരംഭിച്ച JEB client; REA_JEB_MCP_URL ഉപയോഗിച്ച് തിരഞ്ഞെടുക്കുക; [JEB guide](../jeb-analysis.md)                   |
| Android resources      | Decoded manifest, string tables, locales, version വിവരങ്ങൾ                                   | Caller നൽകുന്ന Apktool launcher; [resource guide](../apktool-resource-analysis.md)                                                  |
| Flutter apps           | Dart snapshot hash, ഓരോ ABI-യിലെയും library digests, engine build provenance                 | ഒന്നും ആവശ്യമില്ല (static APK parsing); [Flutter guide](../flutter-analysis.md)                                                       |
| Firmware               | Regions, extraction results, native-analysis handoffs                                       | Linux-ൽ Binwalk / Unblob; [firmware guide](../firmware-analysis.md)                                                               |
| Recorded packets       | തിരഞ്ഞെടുത്ത fields, ആവർത്തിക്കുന്ന values, filters, decode-as rules                               | Linux: TShark 4.x + prlimit; [capture guide](../packet-captures.md)                                                               |
| Packet summaries       | Endpoints, DNS, TLS SNI, protocol distribution, HTTP requests                               | Caller നൽകുന്ന tshark, capinfos (Linux-ൽ പരിശോധിച്ചത്); [pcap guide](../pcap-analysis.md)                                             |
| Recorded logic signals | Decoder annotations, sample ranges, diagnostics                                             | Linux: sigrok-cli 0.7.2 + prlimit; [signal recordings](../signal-recordings.md)                                                   |
| Packages and resources | File inventories, digests, plists, Apple bundle ഘടന, extracted resources                    | [Artifact and JavaScript guide](../javascript-artifact-reconstruction.md), [Apple applications](../apple-application-analysis.md) |
| Process behavior       | Terminal output, interactions, exit, filesystem observations, run comparisons               | Native PTY ഉള്ള Linux/macOS; [process capture](../process-capture.md)                                                              |
| GPU code objects       | CUDA/HIP targets, തിരഞ്ഞെടുത്ത kernel parameters/resources, സൂക്ഷിച്ച PTX text                    | ഉൾനിർമിത static പരിശോധന ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                    |
| Model files            | GGUF / safetensors metadata, tensor declarations, കണക്കാക്കിയ totals                           | Header പരിശോധന; full-file hash ഐച്ഛികം; [GGUF / safetensors](../model-artifacts.md)                                                |
| IL2CPP metadata        | Unity global-metadata.dat assembly images, type/method names, index ranges                  | 24, 27, 29, 31, 39 versions-ന്റെ static decoding; Unity വേണ്ട                                                                       |
| Godot PCK              | Archive inventory/extraction, original header/directory facts, തിരഞ്ഞെടുത്ത content identities | Static formats 2, 3, 4; Godot വേണ്ട                                                                                                |
| APK signatures         | v1/v2/v3/v3.1 signers, certificate fingerprints, key rotation, digest self-consistency      | ഉൾനിർമിത static പരിശോധന; `inspect_apk_signature`                                                                                  |

Static JavaScript, .NET പരിശോധനകൾ application പ്രവർത്തിപ്പിക്കാതെ നൽകിയ files വായിച്ചാണ് നടത്തുന്നത്. Runtime capture, നിങ്ങളുടെ user permissions ഉപയോഗിച്ച് തിരഞ്ഞെടുത്ത target പ്രവർത്തിപ്പിക്കുകയോ അതുമായി ഇടപെടുകയോ ചെയ്യുന്നു; ഓരോ runtime guide-ലും അതിന്റെ പ്രത്യാഘാതങ്ങൾ വിശദീകരിച്ചിട്ടുണ്ട്.

Offline native-binary പരിശോധനയ്ക്കായി REA, caller നൽകുന്ന GNU objdump, Rizin എന്നിവയും പിന്തുണയ്ക്കുന്നു. Provider setup, CLI commands, Evidence-ന്റെ പരിമിതികൾ എന്നിവയ്ക്കായി [reverse-engineering tools guide](../reverse-engineering-tools.md) കാണുക. ഈ providers ഒന്നും REA ഇൻസ്റ്റാൾ ചെയ്യുകയോ അപ്‌ഡേറ്റ് ചെയ്യുകയോ ചെയ്യുന്നില്ല.

<a id="choosing-a-deep-analysis-provider"></a>

Native formats-ഉം host support-ഉം provider അനുസരിച്ച് വ്യത്യാസപ്പെടും. [Hopper and Ghidra setup](../installation.md#hopper), [IDA guide](../ida-provider.md) (ഐച്ഛിക native MCP bridge ഉൾപ്പെടെ), [Kuna decompiler guide](../kuna-provider.md), [പരീക്ഷണഘട്ടത്തിലുള്ള Windows Ghidra support](../windows-ghidra-p0.md) എന്നിവ കാണുക.
Ghidra, [16-bit DOS analysis](../ghidra-dos.md)-ഉം പിന്തുണയ്ക്കുന്നു.
വലിയ binaries-നായി `REA_GHIDRA_STARTUP_TIMEOUT_MS` അല്ലെങ്കിൽ `REA_HOPPER_STARTUP_TIMEOUT_MS` ഉപയോഗിച്ച് provider-ന്റെ startup deadline വർധിപ്പിക്കുക.
Provider തിരഞ്ഞെടുക്കാൻ [CLI guide](../cli.md#choose-a-provider) കാണുക.
ഏറ്റവും പുതിയ npm release-നുശേഷം ചേർത്ത features അറിയാൻ [release availability](../installation.md#released-package-and-main) പരിശോധിക്കുക.

## ഉദാഹരണങ്ങൾ

<a href="https://rea.tools/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="DX-Ball sound-pan, Notion clipboard-bridge, TH04 bullet-ring എന്നിവയുടെ ചിത്രീകരണങ്ങൾ" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: sound-pan കണക്കുകൂട്ടൽ പുനർനിർമ്മിക്കുക

ഒരു sound call-നെ അതിന്റെ position-to-pan helper വരെ പിന്തുടരുക, instructions പരിശോധിക്കുക, അപൂർണ്ണമായ pseudocode-നെ C-യാക്കി മാറ്റുക. ഈ പുനർനിർമ്മാണം യഥാർത്ഥ x86-ലെ 3,205 test cases വിജയിക്കുകയും compile ചെയ്ത function-ന്റെ 63 bytes-ഉം അതേപടി പുനരുത്പാദിപ്പിക്കുകയും ചെയ്യുന്നു.

[Case study വായിക്കുക](https://rea.tools/showcase/dx-ball/) ·
[പുനർനിർമ്മാണ repository](https://github.com/N0zoM1z0/dx-ball)

### Notion: Electron clipboard bridge പിന്തുടരുക

Renderer-ന്റെ clipboard API കണ്ടെത്തി, അതിനെ preload-ഉം IPC-ഉം വഴി main process വരെ പിന്തുടർന്ന് rich clipboard format പരിശോധിക്കുക.

[Case study വായിക്കുക](https://rea.tools/showcase/notion/)

### TH04: DOS bullet-ring കണക്കുകൂട്ടൽ വീണ്ടെടുക്കുക

യഥാർത്ഥ PC-98 game-ന്റെ 16-bit instructions പരിശോധിക്കുക, fixed, aimed angle കണക്കുകൂട്ടലുകൾ വീണ്ടെടുക്കുക, പുനർനിർമ്മിച്ച C++-നെ ചരിത്രപരമായ compiler output-ുമായി താരതമ്യം ചെയ്യുക.

[Case study വായിക്കുക](https://rea.tools/showcase/th04/) ·
[പുനർനിർമ്മാണ repository](https://github.com/N0zoM1z0/th04)

### REA ഉപയോഗിച്ച് RL പരിതസ്ഥിതികൾ നിർമ്മിക്കുക

വെബ് ആപ്പ് സെഷൻ റെക്കോർഡ് ചെയ്ത് API ടൂളുകളാക്കി AI ഏജന്റിന് ഉപയോഗിക്കാവുന്ന പരിതസ്ഥിതി എക്‌സ്‌പോർട്ട് ചെയ്യുക. AgentEnv ഉപയോഗിച്ച് പ്രവർത്തിപ്പിച്ച ശേഷം RL പരിശീലനത്തിനോ മൂല്യനിർണയത്തിനോ ടാസ്‌ക്കുകളും റിവാർഡ് പരിശോധനകളും ചേർക്കുക.

[പരിതസ്ഥിതി നിർമ്മാണ മാർഗ്ഗദർശി](https://rea.tools/guides/rl-environments/) ·
[X-ൽ ഡെമോ കാണുക](https://x.com/reatools/status/2112574822584918075?s=20)

REA ഉപയോഗിച്ച് നിങ്ങൾ രസകരമായ എന്തെങ്കിലും പരിശോധിച്ചിട്ടുണ്ടെങ്കിൽ അത് കാണാൻ ഞങ്ങൾ ആഗ്രഹിക്കുന്നു. പരിശോധിച്ച target, നിങ്ങളുടെ ചോദ്യം, REA എങ്ങനെ സഹായിച്ചു, നിങ്ങൾ കണ്ടെത്തിയത് എന്നിവ ഉൾപ്പെടുത്തി [issue](https://github.com/morluto/rea/issues) അല്ലെങ്കിൽ [pull request](https://github.com/morluto/rea/pulls) വഴി നിങ്ങളുടെ case പങ്കിടുക.

<a id="build-rl-environments"></a>

## RL പരിതസ്ഥിതികൾ നിർമ്മിക്കുക

യഥാർഥ ആപ്പ് പ്രവർത്തിപ്പിക്കാതെ issue കണ്ടെത്തൽ, ഫോൾഡർ സൃഷ്ടിക്കൽ തുടങ്ങിയ ജോലികൾ AI ഏജന്റിന് പരിശീലിക്കാൻ ഒരു പ്രാദേശിക പരിതസ്ഥിതി നിർമ്മിക്കുക. റീഇൻഫോഴ്‌സ്‌മെന്റ് ലേണിംഗിനോ (RL) ഏജന്റ് ജോലികൾ എത്ര നന്നായി പൂർത്തിയാക്കുന്നു എന്ന് പരിശോധിക്കാനോ ഇത് ഉപയോഗിക്കാം.

REA റെക്കോർഡ് ചെയ്ത API അഭ്യർത്ഥനകളും പ്രതികരണങ്ങളും ഏജന്റിന് വിളിക്കാവുന്ന ടൂളുകളാക്കുന്നു. പരിതസ്ഥിതി റെക്കോർഡ് ചെയ്ത ഡാറ്റ ഉപയോഗിക്കുന്നു. റെക്കോർഡ് ഫലം സ്ഥിരീകരിക്കുന്ന മാറ്റങ്ങൾ മാത്രമാണ് പിന്തുണയ്ക്കുന്നത്.

ഏജന്റിൽ REA സജ്ജീകരിച്ച ശേഷം ഉദാഹരണത്തിലെ URL-ഉം ഫോൾഡർ ജോലികളും നിങ്ങളുടെ ആപ്പിന് അനുസരിച്ച് മാറ്റുക:

```text
എന്റെ പരീക്ഷണ വെബ് ആപ്പിൽ നിന്ന് REA ഉപയോഗിച്ച് RL പരിതസ്ഥിതി നിർമ്മിക്കുക:
http://127.0.0.1:3000
ഫോൾഡറുകൾ പട്ടികപ്പെടുത്തൽ, സൃഷ്ടിക്കൽ, പേരുമാറ്റൽ, ഇല്ലാതാക്കൽ എന്നിവ ഉൾപ്പെടുത്തുക.
പരീക്ഷണ ഫോൾഡറുകൾ സൃഷ്ടിക്കാനും നീക്കാനും അനുമതിയുണ്ട്. നിലവിലുള്ള ഡാറ്റ മാറ്റരുത്.
my-env എന്ന ഫോൾഡറിൽ സംരക്ഷിച്ച് ഏതെല്ലാം പ്രവർത്തനങ്ങൾ ലഭ്യമാണെന്നും എങ്ങനെ പ്രവർത്തിപ്പിക്കണമെന്നും പറയുക.
```

<details>
<summary>കമാൻഡ് ലൈൻ ഉപയോഗിക്കുക</summary>

ബ്രൗസറിലെ ആപ്പിന്റെ അഭ്യർത്ഥനകളും പ്രതികരണങ്ങളും റെക്കോർഡ് ചെയ്ത ഫയൽ ഉണ്ടെങ്കിൽ ഈ കമാൻഡുകൾ ഉപയോഗിക്കാം. ഫലം പ്രവർത്തിപ്പിക്കാൻ AgentEnv-ഉം Docker-ഉം വേണം.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

പ്രവർത്തനം തുടങ്ങുന്നതും പ്രതികരിക്കുന്നതും പരിശോധിക്കുന്ന അടിസ്ഥാന ടെസ്റ്റിനൊപ്പം പ്രവർത്തിപ്പിക്കാവുന്ന പരിതസ്ഥിതി REA എക്‌സ്‌പോർട്ട് ചെയ്യുന്നു. ടാസ്‌ക് ലക്ഷ്യങ്ങളും റിവാർഡ് പരിശോധനകളും നിർവചിക്കാനും പരിശീലനം നടത്താനും RL ഫ്രെയിംവർക്കുമായി ബന്ധിപ്പിക്കുക.

[പരിതസ്ഥിതി നിർമ്മാണ മാർഗ്ഗദർശി](https://rea.tools/guides/rl-environments/) ·
[പരിതസ്ഥിതി റഫറൻസ്](../agent-environments.md) ·
[X-ൽ ഡെമോ കാണുക](https://x.com/reatools/status/2112574822584918075?s=20)

## പതിവുചോദ്യങ്ങൾ

<details>
<summary><strong>ഏതൊക്കെ agents-ന് REA ഉപയോഗിക്കാം?</strong></summary>

Local MCP servers പിന്തുണയ്ക്കുന്ന ഏത് agent-നും REA ഉപയോഗിക്കാം. Setup, [പിന്തുണയ്ക്കുന്ന agents](../installation.md#supported-agents) ക്രമീകരിക്കുന്നു; മറ്റ് clients-ന് [manual MCP registration](../installation.md#mcp-registry) ഉപയോഗിക്കാം.

</details>

<details>
<summary><strong>Hopper, Ghidra, IDA അല്ലെങ്കിൽ Kuna ആവശ്യമാണോ?</strong></summary>

ആഴത്തിലുള്ള native analysis-ന് ഇവയിൽ ഒന്ന് ആവശ്യമാണ്. Static JavaScript, .NET പരിശോധനകൾ native analysis engine ഇല്ലാതെയും പ്രവർത്തിക്കും. അനുമതി ലഭിച്ചാൽ setup-ന് Hopper ഇൻസ്റ്റാൾ ചെയ്യാം; Ghidra, IDA, Kuna എന്നിവയ്ക്കായി നിങ്ങളുടെ നിലവിലുള്ള installations ഉപയോഗിക്കുന്നു. [Provider setup](../installation.md#hopper) കാണുക.

</details>

<details>
<summary><strong>Hopper ആദ്യം ആരംഭിക്കേണ്ടതുണ്ടോ?</strong></summary>

ഒരു operation-ന് ആവശ്യമാകുമ്പോൾ REA Hopper ആരംഭിക്കും. macOS-ൽ ആദ്യമായി പ്രവർത്തിപ്പിക്കുമ്പോൾ demo mode തിരഞ്ഞെടുക്കാനോ license activate ചെയ്യാനോ ആവശ്യപ്പെടുന്ന dialog പ്രത്യക്ഷപ്പെടാം. ആദ്യ CLI/MCP operation അല്ലെങ്കിൽ unattended job നടത്തുന്നതിന് മുമ്പ് അതേ user session-ൽ ആ prompt പൂർത്തിയാക്കുക. ആവശ്യമെങ്കിൽ Hopper സ്വമേധയാ തുറക്കുക. [Hopper startup and troubleshooting](../installation.md#launcher-paths-and-troubleshooting) കാണുക.

</details>

<details>
<summary><strong>skills.sh-ൽ നിന്ന് skill ഇൻസ്റ്റാൾ ചെയ്യുന്നത് എന്താണ് ചെയ്യുന്നത്?</strong></summary>

ഈ skill നിങ്ങളുടെ agent-ന് അന്വേഷണ നിർദ്ദേശങ്ങൾ നൽകുന്നു. REA-യുടെ MCP server രജിസ്റ്റർ ചെയ്യാനും അനുയോജ്യമായ നിർദ്ദേശങ്ങൾ ഇൻസ്റ്റാൾ ചെയ്യാനും `npx rea-agents setup` ഉപയോഗിക്കുക; തുടർന്ന് നിങ്ങളുടെ agent വീണ്ടും ആരംഭിക്കുക. [Skill-only installation](../installation.md#skill-only-installation) കാണുക.

</details>

<details>
<summary><strong>REA ഏത് തരത്തിലുള്ള code ആണ് നൽകുന്നത്?</strong></summary>

Native analysis pseudocode-ഉം assembly-ഉം നൽകുന്നു. JavaScript/Electron analysis modules-ഉം അവയുടെ ബന്ധങ്ങളും വീണ്ടെടുക്കുന്നു. ഈ കണ്ടെത്തലുകൾ ഉപയോഗിച്ച് നിങ്ങളുടെ agent implementation എഴുതുകയും പരിശോധിക്കുകയും ചെയ്യും; പ്രായോഗിക ഉദാഹരണങ്ങൾക്കായി [ഉദാഹരണങ്ങൾ](#ഉദാഹരണങ്ങൾ) കാണുക.

</details>

<details>
<summary><strong>REA എന്റെ app upload ചെയ്യുമോ?</strong></summary>

REA targets local ആയി വിശകലനം ചെയ്യുന്നു. Tool-ൽ നിന്നുള്ള ഫലങ്ങൾ നിങ്ങളുടെ agent-ന് ലഭിക്കും; അതിന്റെ model provider-ന് സ്വന്തമായ data policy ഉണ്ടായിരിക്കും.

</details>

<details>
<summary><strong>ഒരു bug നേരിട്ടാൽ എന്തുചെയ്യണം?</strong></summary>

ആദ്യം അപ്‌ഡേറ്റ് ചെയ്യുക; പുതിയ release-ൽ ആ പ്രശ്നത്തിനുള്ള പരിഹാരം ഇതിനകം ഉണ്ടായേക്കാം.

`npm install --global` അല്ലെങ്കിൽ `bun add --global` ഉപയോഗിച്ച് ഇൻസ്റ്റാൾ ചെയ്ത CLI-ക്കായി:

```bash
rea update
```

`npx` വഴി agent setup നടത്തുന്നതിനായി:

```bash
npx rea-agents@latest setup
```

നിങ്ങൾ agent ഉപയോഗിക്കുന്നുണ്ടെങ്കിൽ, [setup പുതുക്കൽ](#rea-അപ്‌ഡേറ്റ്-ചെയ്യുക) പൂർത്തിയാക്കി അത് വീണ്ടും ആരംഭിക്കുക. അതേ task വീണ്ടും ശ്രമിക്കുക. പ്രശ്നം തുടരുകയാണെങ്കിൽ, നിങ്ങളുടെ REA version, target type, പ്രശ്നം ആവർത്തിക്കാൻ ആവശ്യമായ ഘട്ടങ്ങൾ, error output എന്നിവ ഉൾപ്പെടുത്തി [issue തുറക്കുക](https://github.com/morluto/rea/issues).

</details>

## ഡോക്യുമെന്റേഷൻ

വെബ്സൈറ്റിലെ [പ്രായോഗിക ഗൈഡുകൾ](https://rea.tools/guides/) ഉപയോഗിച്ച് തുടങ്ങുക.
കൃത്യമായ options, prerequisites, result contracts എന്നിവയ്ക്കായി:

- [Installation and setup](../installation.md): agent registration, provider configuration, updates, uninstall.
- [Readiness and troubleshooting](../installation.md#check-readiness-for-your-task): ഒരു agent-ന്റെയോ analysis engine-ന്റെയോ പ്രശ്നങ്ങൾ കണ്ടെത്തുക.
- [CLI and Evidence](../cli.md): commands, provider തിരഞ്ഞെടുക്കൽ, snapshots, import/export, exit statuses.
- [MCP contracts](../mcp-contracts.md), [agent prompts](../mcp-prompts.md): tool results, sessions, guided investigations.
- [Tool catalog](../mcp-contracts.md#generated-catalog): tools, providers, CLI commands എന്നിവയുടെ സ്വയമേവ സൃഷ്ടിച്ച പട്ടിക.
- [Roadmap](../roadmap.md): ആസൂത്രണം ചെയ്ത പ്രവർത്തനങ്ങളും capability trackers-ഉം.

സുരക്ഷാ ദുർബലതകൾ [SECURITY.md](../../SECURITY.md) വഴി റിപ്പോർട്ട് ചെയ്യുക.

## Star ചരിത്രം

🎉 **400,000 GitHub stars — നന്ദി!**

REA ഉപയോഗിക്കുന്നവർക്കും, bugs റിപ്പോർട്ട് ചെയ്യുന്നവർക്കും, features ആവശ്യപ്പെടുന്നവർക്കും, builds പരിശോധിക്കുന്നവർക്കും, fixes സംഭാവന ചെയ്യുന്നവർക്കും നന്ദി.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="REA GitHub star ചരിത്രം" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## നിരാകരണം

ഉത്തരവാദിത്തത്തോടെ ഉപയോഗിക്കുന്നതിനുള്ള മാർഗനിർദ്ദേശങ്ങൾക്ക് [DISCLAIMER.md](../../DISCLAIMER.md) കാണുക.

നിയമവിരുദ്ധമോ അനുമതിയില്ലാത്തതോ ആയ ഉപയോഗത്തെക്കുറിച്ചുള്ള project-ന്റെ നിലപാട് എല്ലാ REA versions-നും distribution channels-നും platforms-നും ബാധകമാണ്; ഓരോ copy-യും അതിന് ബാധകമായ licenses നിലനിർത്തുന്നു.

നിയമാനുസൃതമായ research, education, interoperability, software preservation, കൂടാതെ നിങ്ങൾക്ക് സ്വന്തമായതോ പരിശോധിക്കാൻ അനുമതിയുള്ളതോ ആയ software-ന്റെ analysis എന്നിവയ്ക്കാണ് REA ഉദ്ദേശിച്ചിരിക്കുന്നത്.

## സംഭാവനകൾ

REA-യ്ക്കായി നിങ്ങളുടെ സഹായം ഞങ്ങൾ സ്വാഗതം ചെയ്യുന്നു! bug റിപ്പോർട്ട് ചെയ്യാനോ feature നിർദ്ദേശിക്കാനോ [issue തുറക്കുക](https://github.com/morluto/rea/issues), code അല്ലെങ്കിൽ docs മെച്ചപ്പെടുത്താൻ [pull request അയയ്ക്കുക](https://github.com/morluto/rea/pulls).

Development setup-നും checks-നും [CONTRIBUTING.md](../../CONTRIBUTING.md), verification lanes-നായി [testing](../testing.md), project ഘടനയ്ക്കായി [architecture map](../architecture.mermaid) എന്നിവ കാണുക.

## ലൈസൻസ്

[MIT](../../LICENSE)

REA-യുടെ രചയിതാക്കൾ സൃഷ്ടിച്ച code MIT license പ്രകാരമാണ് ലൈസൻസ് ചെയ്തിരിക്കുന്നത്. Third-party material അതിന്റെ സ്വന്തം licenses-ഉം copyright notices-ഉം നിലനിർത്തുന്നു; dependencies-ന്റെ പട്ടിക, നിലനിർത്തിയ license text-ുകൾ, external tool നിബന്ധനകൾ എന്നിവയ്ക്കായി [Third-party notices](../../THIRD_PARTY_NOTICES.md) കാണുക.

**IDA Pro / Hex-Rays decompilers, Hopper, JEB എന്നിവ ഉൾപ്പെടെയുള്ള commercial tools നിയമാനുസൃതമായി സ്വന്തമാക്കുകയും അവയുടെ ബാധകമായ licenses പ്രകാരം ഉപയോഗിക്കാൻ അനുമതിയുണ്ടെന്ന് ഉറപ്പാക്കുകയും വേണം.** REA ഒരു tool license-ഓ key-യോ activation entitlement-ഓ നൽകുന്നില്ല. Trials-ഉം demos-ഉം ഉൾപ്പെടെ vendor നിബന്ധനകൾക്ക് വിധേയമാണ്; ഇതിൽ user, feature, automation, output sharing നിയന്ത്രണങ്ങളും ഉൾപ്പെടാം. Cracked copies, മോഷ്ടിച്ച keys, അനുമതിയില്ലാത്ത key sharing, license നിയന്ത്രണങ്ങൾ മറികടക്കൽ എന്നിവയ്ക്ക് അനുമതിയില്ല. ഈ മാർഗനിർദ്ദേശം MIT അല്ലെങ്കിൽ third-party licenses-ൽ മാറ്റം വരുത്തുന്നില്ല.
