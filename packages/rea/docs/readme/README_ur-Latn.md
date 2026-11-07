<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · **Roman Urdu** · [Română](README_ro.md)

# REA: Reverse Engineer Anything

### Binaries, applications aur runtime behavior ki reverse engineering ke liye ek MCP.

**Koi feature pasand aaya? Samjhein ke woh kaise kaam karta hai, binary level tak.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#kya-kuch-analyze-kar-sakte-hain)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Website](https://rea.tools/) · [Guides](https://rea.tools/guides/) · [Showcases](https://rea.tools/showcase/)**

[Jaldi shuru karein](#jaldi-shuru-karein) · [REA kaise kaam karta hai](#rea-kaise-kaam-karta-hai) · [Kya kuch analyze kar sakte hain](#kya-kuch-analyze-kar-sakte-hain) · [Amli misaalein](#amli-misaalein) · [RL environments banayein](#build-rl-environments) · [FAQ](#faq) · [Documentation](#documentation)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> REA [morluto/rea](https://github.com/morluto/rea),
> [rea.tools](https://rea.tools/) ya [rea-agents npm package](https://www.npmjs.com/package/rea-agents) se hasil karein.
> Installation aur release ke links inhi official sources se kholein. Sirf milta-julta
> repository naam ya copy kiya hua README kisi download ko official sabit nahi karta.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA ek native binary inspect karte hue Hopper ke andar apna analysis bridge shuru kar raha hai" width="1200" />

<br /><br />

<table aria-label="REA community">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Reverse Engineering Community mein shamil hon</strong>
  </a><br />
  <sub>Discord · Sawal jawab · Apna kaam dikhayein</sub>
</td>
</tr>
</table>

<br />

</div>

---

Kisi app mein aisa feature dekha jo aap apne product mein chahte hain? Apne agent se kahein ke REA ke zariye uski jaanch kare. Woh app ka source code mile baghair bhi use inspect kar sakta hai, feature kaam kaise karta hai samjha sakta hai, saboot dikha sakta hai aur aapke project ke liye uska ek version bana sakta hai.

REA aapke agent ko native binaries, JavaScript aur Electron apps, .NET assemblies aur websites inspect karne wale tools se jorta hai. Yehi tools terminal se bhi use kar sakte hain. Analysis local machine par hota hai, aur har natije ke saath uske saboot aur limitations bhi milti hain.

Setup REA ko aapke agent ke saath register karta hai aur uske mutabiq workflow instructions install karta hai. Native analysis ke liye pehle se installed Hopper, Ghidra, IDA ya Kuna use ho sakta hai; aapki approval par setup Hopper bhi install kar sakta hai. Static JavaScript analysis ke liye native analysis engine ki zaroorat nahi.

> Setup instructions, tasveeron ke saath guides aur asli case studies ke liye **[REA ki website dekhein](https://rea.tools/)**.

## Jaldi shuru karein

Linux par Ghidra, JADX, firmware tools shuru karne aur static JavaScript/Electron
analysis ke liye REA ke `PATH` par procps-compatible `ps` hona chahiye, taake
process ownership check ho sake. Masla hal karne ke steps `docs/installation.md`
ke "Linux owned-process prerequisite" section mein hain.

### Apna agent setup karein

Node.js aur npm installed hon to yeh command chalayein:

```bash
npx rea-agents setup
```

Apne agents select karein, proposed changes dekhein aur approve karein. Setup
REA ka MCP server aur matching workflow instructions add karta hai, aur existing
configuration ke backups banata hai. Iske baad apna agent restart karein.

Setup Claude Code, Codex, Cursor, Gemini CLI, Grok Build aur
[doosre agents](../installation.md#supported-agents) support karta hai. Provider
configuration aur manual MCP registration ke liye
[installation aur setup](../installation.md) dekhein.

Context overhead kam rakhne ke liye MCP default mein compact input schemas use
karta hai. Agar tamam advertised fields ki guidance aur nested validation details
chahiye hon to apni MCP registration mein `REA_MCP_INPUT_SCHEMA_PROFILE=full`
set karein. Dono profiles mein tamam tools aur canonical server validation
maujood rehte hain. MCP contracts guide ka "Compact input schema profile"
section dekhein.

### Apne agent se kahein

```text
Samjho ke Notes app mein search kaise kaam karti hai, mujhe saboot dikhao aur
mere project ke liye aisa hi feature banao.
```

Notes ki jagah apni target app aur jis feature ko samajhna hai uska naam likhein.

### Terminal se use karein

Extract ki hui JavaScript/Electron app directory ya ASAR inspect karein:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Natije mein modules, imports, Electron boundaries aur unke saboot milte hain.
Path ko apne target se badlein, jaise Windows par `"D:/apps/example"`.

Rozmarra use ke liye `rea` command install karne ke liye:

```bash
npm install --global rea-agents
rea --help
```

Native analysis se pehle provider configure karein. Native commands, provider
selection, snapshots aur scripting ke liye
[CLI aur Evidence guide](../cli.md) dekhein.

### REA update karein

REA mein tezi se changes aate hain aur naye releases mein aksar bug fixes hoti
hain. Apni installation updated rakhein.

Agar CLI `npm install --global` ya `bun add --global` se install ki hai:

```bash
rea update
```

`rea --update` isi verified workflow ka alias hai aur wohi global output flags
accept karta hai. Doosre command controls ke saath use karte waqt `rea update`
likhein.

Updater commands stdout aur stderr mila kar zyada se zyada 4 MiB retain karti
hain. Command khatam hone ke baad is had se bade metadata replies reject ho
jate hain; verbose installs bounded diagnostics ke saath jari rehti hain.
Insaan ke liye progress output terminal ki backpressure ka khayal rakhta hai
aur bheji hui writes mukammal hone ka intezar karta hai.

Bun global updates ke liye Bun 1.2.17 ya naya version chahiye. Purana Bun ho
to `rea update` chalane se pehle Bun manually upgrade karein.

Agent registrations aur skill refresh karne ke liye update ke output mein
di hui setup command chalayein.

Agar aap `npx` use karte hain to agent setup is tarah update karein:

```bash
npx rea-agents@latest setup
```

Setup changes review karein aur agent restart karein. Ek dafa chalane wali CLI
commands ke liye `npx rea-agents@latest` ke baad command likhein. Bun ke saath
`npx rea-agents@latest` ki jagah `bunx rea-agents@latest` use karein.

## REA kaise kaam karta hai

Aapka agent MCP ke zariye REA ko call karta hai, taake target inspect kare aur
relevant code trace kare. REA apni findings saboot ke saath wapas deta hai.
Agent unki bunyaad par agle sawal poochta hai, behavior samjhata hai ya
implementation likh kar test karta hai. CLI commands bhi yehi workflows use
karti hain.

![REA ki jaanch ka flow: agent local target ke bare mein sawal karta hai, REA analysis tools se use inspect aur trace karta hai, phir agent wapas milne wale code, references aur unknowns se samjhata, implement aur test karta hai.](../../website/public/assets/figures/rea-investigation-flow.svg)

[Puri size mein figure kholein](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## Kya kuch analyze kar sakte hain

REA ke liye Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) ya 26.12.1+, aur npm chahiye.
Mazeed tools aur host support target par depend karte hain:

| Target                  | REA kya wapas deta hai                                                                            | Zarooriyat aur guide                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Desktop installations   | Runtime candidates, supporting files, component markers aur agle probes                           | Built-in bounded directory/header inspection; [desktop applications](../desktop-applications.md)                                  |
| Native binaries         | Pseudocode, assembly, strings, symbols, calls aur references                                      | Hopper, Ghidra, IDA ya Kuna; [native analysis](../native-investigation.md)                                                        |
| Offline ELF layout      | Sections, segments, original symbols/relocations aur static mitigation candidates                 | Linux x64 par aapka diya hua pwntools; [binary diagnostics](../binary-diagnostics.md)                                             |
| Go binaries             | Embedded compiler version, modules, replacements aur build settings                               | Built-in static ELF/PE/thin Mach-O inspection; Go install karna zaroori nahi                                                      |
| GPU code objects        | CUDA/HIP targets, selected kernel parameters aur resources, retained PTX text                     | Built-in static ELF/PE/fatbin/CUBIN/PTX inspection; [GPU code objects](../gpu-code-objects.md)                                    |
| Model artifacts         | GGUF / safetensors metadata, tensor declarations aur unse nikale hue totals                       | Built-in header inspection; optional full-file hash; [model files](../model-artifacts.md)                                         |
| IL2CPP metadata         | Unity global-metadata.dat assembly images, type aur method names aur index ranges                 | Versions 24, 27, 29, 31 aur 39 ki built-in static decoding; Unity zaroori nahi                                                    |
| Godot PCK               | Archive inventory aur extraction, original header/directory facts aur selected content identities | Built-in static formats 2, 3 aur 4; Godot zaroori nahi                                                                            |
| Rust binaries           | Embedded cargo-auditable crate names, versions, sources aur dependency edges                      | Built-in static ELF/PE/thin Mach-O inspection; [Rust binaries](../rust-binaries.md)                                               |
| PE certificates         | Authenticode WIN_CERTIFICATE entries aur PKCS#7 signer/X.509 identity fields                      | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                           |
| PE imports              | Import aur delay-load DLL names, ordinals, IAT RVAs aur pefile import hash                        | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                     |
| ELF notes               | PT_NOTE/SHT_NOTE owners, types, GNU build-id aur ABI-tag fields                                   | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                      |
| Linux kernel modules    | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                       | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                            |
| Erlang BEAM             | IFF chunks, atoms, exports, imports, lambdas aur Code header                                      | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                 |
| WASM artifact           | Validation, sections, exact import/export WAT forms aur decoded WAT                               | Aapka diya hua WABT 1.0.42; `inspect_wasm_artifact`                                                                               |
| EVM bytecode            | Dispatch selectors, byte offsets, inferred arguments aur mutability                               | Linux x64 par local raw/hex carrier; [offline EVM guide](../evm-bytecode.md)                                                      |
| SQLite databases        | Tables, columns, indexes, views, triggers aur selected ordinary-table rows                        | Local database/WAL snapshot; native SQLite limits ke saath Node.js 24.x >=24.15 ya 26+                                            |
| Apple IPS crash reports | Apple .ips metadata, threads, images aur crash classification                                     | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                     |
| Recorded Linux crashes  | Raw notes, har recorded thread ke registers/signals aur optional mapping candidates               | Linux x64 par aapka diya hua pwntools; optional GDB/pwndbg; [recorded crashes](../recorded-crashes.md)                            |
| JavaScript / Electron   | Modules, imports, source maps, routes, IPC aur native add-on relationships                        | Node.js aur npm; Linux: procps-compatible `ps`; [application analysis](../javascript-application-workflows.md)                    |
| Websites                | Page structure, scripts, network observations aur requested screenshots                           | Chrome-family browser; [browser analysis](../browser-observation.md)                                                              |
| Saved network captures  | Requests, responses, exposed payloads aur source locations                                        | HAR ya Fiddler Everywhere SAZ; native mitmproxy ke liye Linux par mitmdump; [capture guide](../web-network-captures.md)           |
| .NET assemblies         | Metadata, CIL instructions, declared native dependencies aur build comparisons                    | Koi additional tool nahi (sirf static analysis); [managed-code guide](../managed-code-analysis.md)                                |
| Android APKs            | Manifest declarations, classes, decompiled methods aur references                                 | Linux/macOS/Windows x64 par headless JADX aur full JDK; [Android guide](../android-analysis.md)                                   |
| APK signatures          | v1/v2/v3/v3.1 signers, certificate fingerprints, key rotation aur digest self-consistency         | Koi additional tool nahi (sirf static analysis); `inspect_apk_signature`                                                          |
| Android devices         | Devices, packages, processes, logs, dumps, screen captures aur APK/file transfers                 | Aapka diya hua adb (emulator ya hardware); [ADB guide](../adb-device-analysis.md)                                                 |
| JEB projects            | Engine-backed project units, artifact digests aur type/method pseudo-code                         | Aapka shuru kiya hua JEB client jo MCP serve kar raha ho, REA_JEB_MCP_URL se select karein; [JEB guide](../jeb-analysis.md)       |
| Android resources       | Decoded manifest, string tables, locales aur version facts                                        | Aapka diya hua Apktool launcher; [resource guide](../apktool-resource-analysis.md)                                                |
| Flutter apps            | Dart snapshot hash, per-ABI library digests aur engine build provenance                           | Koi additional tool nahi (static APK parsing); [Flutter guide](../flutter-analysis.md)                                            |
| Firmware                | Regions, extraction results aur native-analysis handoffs                                          | Linux par Binwalk / Unblob; [firmware guide](../firmware-analysis.md)                                                             |
| Recorded packets        | Selected fields, repeated values, filters aur decode-as rules                                     | Linux: TShark 4.x + prlimit; [capture guide](../packet-captures.md)                                                               |
| Packet summaries        | Endpoints, DNS, TLS SNI, protocol distribution aur HTTP requests                                  | Aapke diye hue tshark aur capinfos (Linux par verified); [pcap guide](../pcap-analysis.md)                                        |
| Recorded logic signals  | Decoder annotations, sample ranges aur diagnostics                                                | Linux: sigrok-cli 0.7.2 + prlimit; [signal recordings](../signal-recordings.md)                                                   |
| Packages aur resources  | File inventories, digests, plists, Apple bundle structure aur extracted resources                 | [Artifact aur JavaScript guide](../javascript-artifact-reconstruction.md), [Apple applications](../apple-application-analysis.md) |
| Process behavior        | Terminal output, interactions, exit aur filesystem observations aur runs ka comparison            | Native PTY ke saath Linux/macOS; [process capture](../process-capture.md)                                                         |
| PyInstaller executables | CArchive members, Python version, entry scripts aur extracted bytecode                            | Koi additional tool nahi (sirf static analysis); [Python packaged applications](../python-packaged-applications.md)               |

Static JavaScript aur .NET inspection di hui files ko application chalaye baghair
parhti hai. Runtime capture aapki user permissions se selected target ko chalata
hai ya uske saath interact karta hai; har runtime guide apne effects batati hai.

Offline native-binary inspection ke liye REA aapke diye hue GNU objdump aur
Rizin bhi support karta hai. Provider setup, CLI commands aur Evidence ki
limitations ke liye [reverse-engineering tools guide](../reverse-engineering-tools.md)
dekhein. REA in dono providers ko install ya update nahi karta.

<a id="choosing-a-deep-analysis-provider"></a>

Native formats aur host support har provider ke liye alag ho sakte hain.
[Hopper aur Ghidra setup](../installation.md#hopper),
[IDA guide](../ida-provider.md) (optional native MCP bridge samet),
[Kuna decompiler guide](../kuna-provider.md) aur
[experimental Windows Ghidra support](../windows-ghidra-p0.md) dekhein.
Ghidra [16-bit DOS analysis](../ghidra-dos.md) bhi support karta hai.
Badi binaries ke liye `REA_GHIDRA_STARTUP_TIMEOUT_MS` ya
`REA_HOPPER_STARTUP_TIMEOUT_MS` se provider ki startup deadline barhayein.
Provider select karne ke liye [CLI guide](../cli.md#choose-a-provider) dekhein.
Latest npm release ke baad add hone wale features ki
[release availability](../installation.md#released-package-and-main) check karein.

## Amli misaalein

<a href="https://rea.tools/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="DX-Ball sound-pan, Notion clipboard-bridge aur TH04 bullet-ring case studies ki tasveerein" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: sound-pan calculation dobara banayein

Sound call se uske position-to-pan helper tak jayein, instructions inspect
karein aur adhoore pseudocode ko C mein badlein. Dobara banaya gaya code 3,205
original-x86 cases pass karta hai aur compiled function ke tamam 63 bytes
dobara hasil karta hai.

[Case study parhein](https://rea.tools/showcase/dx-ball/) ·
[Reconstruction repository](https://github.com/N0zoM1z0/dx-ball)

### Notion: Electron clipboard bridge trace karein

Renderer ki clipboard API dhoondein, preload aur IPC ke raste main process tak
uska flow follow karein aur rich clipboard format inspect karein.

[Case study parhein](https://rea.tools/showcase/notion/)

### TH04: DOS bullet-ring calculation recover karein

Original PC-98 game ki 16-bit instructions inspect karein, fixed aur aimed angle
calculations recover karein aur dobara banaye gaye C++ ko purane compiler ke
output se compare karein.

[Case study parhein](https://rea.tools/showcase/th04/) ·
[Reconstruction repository](https://github.com/N0zoM1z0/th04)

### REA se RL environments banayein

Web app session record karein, us ki API ko tools mein badlein aur AI agent ke liye environment export karein. AgentEnv ke saath chalayein, phir RL training ya evaluation ke liye tasks aur reward checks shamil karein.

[Environment banane ki rehnumai](https://rea.tools/guides/rl-environments/) ·
[X par demo dekhein](https://x.com/reatools/status/2112574822584918075?s=20)

Agar aapne REA se koi dilchasp kaam kiya hai to hum dekhna chahenge. Apna case
[issue](https://github.com/morluto/rea/issues) ya
[pull request](https://github.com/morluto/rea/pulls) mein share karein. Target,
apna sawal, REA ne kaise madad ki aur kya mila, yeh sab batayein.

<a id="build-rl-environments"></a>

## RL environments banayein

AI agent ke liye local environment banayein jahan woh asal app chalaye baghair issue dhoondhne ya folder banane jaise kaam ki mashq kar sake. Ise reinforcement learning (RL) ya agent ke kaam poore karne ki salahiyat jaanchne ke liye istemal karein.

REA record kiye hue API requests aur responses ko aise tools mein badalta hai jinhein agent call kar sakta hai. Environment recorded data istemal karta hai aur sirf woh tabdeeliyan support karta hai jin ke asraat recording tasdeeq karti hai.

Agent mein REA setup karne ke baad neeche example URL aur folder tasks ko apne app ke mutabiq badlein:

```text
Meri test web app se REA ke zariye RL environment banao:
http://127.0.0.1:3000
Folders ki list, creation, rename aur deletion cover karo. Test folders bana
aur hata sakte ho, lekin mojooda data tabdeel na karo.
my-env naam ke folder mein save karo, kaam karne wale operations check karo aur chalane ka tareeqa batao.
```

<details>
<summary>Command line istemal karein</summary>

Yeh commands tab istemal karein jab app ke browser requests aur responses ki recording pehle se file mein ho. Result chalane ke liye AgentEnv aur Docker bhi chahiye.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA chalne ke liye tayyar environment aur aik bunyadi test export karta hai jo us ka shuru hona aur jawab dena check karta hai. Apne RL framework ke saath task goals aur reward checks tay karein aur training chalayein.

[Environment banane ki rehnumai](https://rea.tools/guides/rl-environments/) ·
[Environment reference](../agent-environments.md) ·
[X par demo dekhein](https://x.com/reatools/status/2112574822584918075?s=20)

## FAQ

<details>
<summary><strong>Kaun se agents REA use kar sakte hain?</strong></summary>

Har woh agent jo local MCP servers support karta ho. Setup
[supported agents](../installation.md#supported-agents) configure karta hai;
doosre clients [manual MCP registration](../installation.md#mcp-registry)
use kar sakte hain.

</details>

<details>
<summary><strong>Kya mujhe Hopper, Ghidra, IDA ya Kuna chahiye?</strong></summary>

Deep native analysis in mein se ek use karta hai. Static JavaScript aur .NET
inspection native analysis engine ke baghair kaam karti hai. Approval ke baad
setup Hopper install kar sakta hai; Ghidra, IDA aur Kuna ke liye aapki existing
installations use hoti hain. [Provider setup](../installation.md#hopper) dekhein.

</details>

<details>
<summary><strong>Kya pehle Hopper shuru karna hoga?</strong></summary>

Jab kisi operation ko Hopper chahiye hota hai to REA use shuru karta hai.
macOS par pehli dafa khulne wala dialog demo mode select karne ya license
activate karne ko keh sakta hai. Pehle CLI/MCP operation ya unattended job se
pehle usi user session mein yeh prompt complete karein. Zaroorat ho to Hopper
manually kholein.
[Hopper startup aur troubleshooting](../installation.md#launcher-paths-and-troubleshooting)
dekhein.

</details>

<details>
<summary><strong>skills.sh se skill install karne se kya hota hai?</strong></summary>

Skill aapke agent ko jaanch karne ki instructions deti hai. REA ka MCP server
register karne aur matching instructions install karne ke liye
`npx rea-agents setup` use karein, phir agent restart karein.
[Sirf skill ki installation](../installation.md#skill-only-installation) dekhein.

</details>

<details>
<summary><strong>REA kis tarah ka code wapas deta hai?</strong></summary>

Native analysis pseudocode aur assembly wapas deta hai. JavaScript/Electron
analysis modules aur unke relationships recover karta hai. Aapka agent in
findings se implementation likhta aur test karta hai;
[amli misaalein](#amli-misaalein) iska tareeqa dikhati hain.

</details>

<details>
<summary><strong>Kya REA meri app upload karta hai?</strong></summary>

REA targets ko local machine par analyze karta hai. Aapke agent ko tool results
milte hain, aur uske model provider ki apni data policy hoti hai.

</details>

<details>
<summary><strong>Bug mile to kya karun?</strong></summary>

Pehle update karein; ho sakta hai recent release mein masla hal ho chuka ho.

Agar CLI `npm install --global` ya `bun add --global` se install ki hai:

```bash
rea update
```

`npx` se agent setup ke liye:

```bash
npx rea-agents@latest setup
```

Agar agent use kar rahe hain to [setup refresh](#rea-update-karein) complete
karke agent restart karein. Wohi task dobara try karein. Masla phir bhi ho to
REA version, target type, reproduce karne ke steps aur error output ke saath
[issue kholein](https://github.com/morluto/rea/issues).

</details>

## Documentation

Website ki [amli guides](https://rea.tools/guides/) se shuru karein.
Exact options, prerequisites aur result contracts ke liye:

- [Installation aur setup](../installation.md): agent registration, provider configuration, updates aur uninstall.
- [Readiness aur troubleshooting](../installation.md#check-readiness-for-your-task): ek agent ya analysis engine ka masla diagnose karein.
- [CLI aur Evidence](../cli.md): commands, provider selection, snapshots, import/export aur exit statuses.
- [MCP contracts](../mcp-contracts.md) aur [agent prompts](../mcp-prompts.md): tool results, sessions aur guided investigations.
- [Tool catalog](../mcp-contracts.md#generated-catalog): tools, providers aur CLI commands ki generated inventory.
- [Roadmap](../roadmap.md): planned work aur capability trackers.

Security vulnerabilities [SECURITY.md](../../SECURITY.md) ke zariye report karein.

## Stars ki history

🎉 **400,000 GitHub stars — shukriya!**

REA use karne, bugs report karne, features suggest karne, builds test karne aur
fixes contribute karne wale sab logon ka shukriya.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="REA ke GitHub stars ki history" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Zimmedarana istemal

Responsible-use guidance ke liye [DISCLAIMER.md](../../DISCLAIMER.md) dekhein.

Ghair qanooni ya ghair ijazati istemal ke bare mein project ki position REA ke
tamam versions, distribution channels aur platforms par lagu hoti hai; har copy
par uske applicable licenses barqarar rehte hain.

REA qanooni research, taleem, interoperability, software preservation aur aise
software ke analysis ke liye hai jo aapka apna ho ya jise examine karne ki aapko
ijazat ho.

## Hissa dalein

REA mein aapki madad ka khairmaqdam hai! Bug report karne ya feature suggest
karne ke liye [issue kholein](https://github.com/morluto/rea/issues), ya code aur
docs behtar karne ke liye [pull request bhejein](https://github.com/morluto/rea/pulls).

Development setup aur checks ke liye [CONTRIBUTING.md](../../CONTRIBUTING.md),
verification lanes ke liye [testing](../testing.md) aur project structure ke
liye [architecture map](../architecture.mermaid) dekhein.

## License

[MIT](../../LICENSE)

REA ka apna likha hua code MIT ke tehat licensed hai. Third-party material
ke apne licenses aur copyright notices barqarar rehte hain. Dependency
inventory, preserved license texts aur external tools ki terms ke liye
[Third-party notices](../../THIRD_PARTY_NOTICES.md) dekhein.

IDA Pro / Hex-Rays decompilers, Hopper aur JEB samet **commercial tools qanooni
tareeqe se hasil karna aur unke applicable licenses ke mutabiq use karne ki
ijazat rakhna zaroori hai**. REA koi tool license, key ya activation ka haq
nahi deta. Trials aur demos vendor ki terms ke tehat rehte hain, jin mein user,
feature, automation aur output sharing ki pabandiyan bhi shamil hain. Cracked
copies, chori ki hui keys, ghair ijazati key sharing aur license restrictions
bypass karne ki ijazat nahi. Yeh guidance MIT ya third-party licenses ko
tabdeel nahi karti.
