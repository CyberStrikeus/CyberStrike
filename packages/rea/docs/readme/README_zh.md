<div align="center">

[English](../../README.md) · **简体中文** · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA：逆向一切

### 通过一个 MCP 服务，逆向分析二进制文件、应用程序和运行时行为。

**看到喜欢的功能，弄清它的工作原理，深入到二进制层面。**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[网站](https://rea.tools/zh-CN/) · [指南](https://rea.tools/zh-CN/guides/) · [案例](https://rea.tools/zh-CN/showcase/)**

[快速开始](#快速开始) · [REA 的工作原理](#rea-的工作原理) · [可以分析什么](#可以分析什么) · [案例](#案例) · [构建 RL 环境](#build-rl-environments) · [常见问题](#常见问题) · [GNU objdump 和 Rizin 工具](../reverse-engineering-tools.md) · [文档](#文档)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> REA 官方来源： [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> 请通过这些官方来源提供的安装和发布链接获取 REA。相似的仓库名称或复制的 README 不能证明下载内容来自官方。

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA 在 Hopper 中启动分析桥，检查原生二进制文件" width="1200" />

<br /><br />

<table aria-label="REA 社区">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>加入逆向工程社区</strong>
  </a><br />
  <sub>Discord · 问答 · 成果分享</sub>
</td>
</tr>
</table>

<br />

</div>

---

在应用中看到一个想加入自己产品的功能？让智能体用 REA 调查它。即使没有源代码，智能体也可以检查应用、解释功能的工作方式、展示证据，并为你的项目实现类似功能。

REA 将智能体连接到分析工具，用于检查原生二进制文件、JavaScript 和 Electron 应用、.NET 程序集以及网站。你也可以在终端中使用同样的工具。分析在本机运行，结果包含支撑各项结论的证据和相关限制。

设置流程会向智能体注册 REA，并安装匹配的工作流指引。原生分析可以使用已有的 Hopper、Ghidra、IDA 或 Kuna；设置流程也可以在你批准后安装 Hopper。静态 JavaScript 分析不需要原生分析引擎。

> **[访问 REA 网站](https://rea.tools/zh-CN/)**，查看设置说明、图解指南和真实案例。

## 快速开始

Linux 上的 Ghidra、JADX、固件工具启动和静态 JavaScript/Electron 分析需要在 REA 的 `PATH` 中提供兼容 procps 的 `ps`，用于检查进程所有权。恢复步骤见安装指南的 Linux 进程所有权前提。

### 设置智能体

安装 Node.js 和 npm 后，运行：

```bash
npx rea-agents setup
```

选择智能体，检查计划中的变更并批准。设置流程会添加 REA 的 MCP 服务和匹配的工作流指引，并备份已有配置。完成后重启智能体。

设置流程支持 Claude Code、Codex、Cursor、Gemini CLI、Grok Build 和[其他智能体](../installation.md#supported-agents)。提供方配置和手动注册 MCP 的方法见[安装与设置](../installation.md)。

MCP 默认使用紧凑输入 Schema 来减少上下文开销。需要完整字段说明和嵌套验证细节时，在 MCP 注册中设置 `REA_MCP_INPUT_SCHEMA_PROFILE=full`。两种配置都保留完整工具集和规范的服务端验证；见 MCP 合约指南。

### 询问智能体

```text
弄清 Notes 应用的搜索功能如何工作，展示证据，并为我的项目实现类似功能。
```

把 Notes 替换为目标应用，并描述你想了解的功能。

### 使用终端

检查已解包的 JavaScript/Electron 应用目录或 ASAR 文件：

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

结果包含模块、导入、Electron 边界及相关证据。将路径替换为你的目标路径，例如 Windows 上的 `"D:/apps/example"`。

如果需要经常使用，可以安装 `rea` 命令：

```bash
npm install --global rea-agents
rea --help
```

原生分析需要先配置分析提供方。原生命令、提供方选择、快照和脚本用法见 [CLI 与 Evidence 指南](../cli.md)。

### 更新 REA

REA 更新较快，新版本经常包含错误修复。请保持安装的版本为最新。

通过 `npm install --global` 或 `bun add --global` 安装的 CLI 使用：

```bash
rea update
```

`rea --update` 是 `rea update` 的别名，接受相同的全局输出选项。更新命令合计最多保留 4 MiB 的 stdout/stderr；命令退出后会拒绝过大的元数据响应，详细安装日志采用有界诊断。进度输出遵守终端背压并等待已提交的写入完成。

Bun 全局更新需要 Bun 1.2.17 或更高版本。如果使用较旧的 Bun 版本，请先手动升级 Bun，再运行 `rea update`。

要更新智能体注册和 skill，请运行更新命令输出的设置命令。

如果使用 `npx`，通过以下命令更新智能体设置：

```bash
npx rea-agents@latest setup
```

检查设置变更并重启智能体。单次 CLI 操作可使用 `npx rea-agents@latest`，后接所需命令。使用 Bun 时，用 `bunx rea-agents@latest` 代替 `npx rea-agents@latest`。

## REA 的工作原理

智能体通过 MCP 调用 REA，检查目标并追踪相关代码。REA 返回发现及对应证据。智能体据此提出后续问题、解释行为，或编写并测试实现。CLI 命令使用同样的工作流。

![REA 调查流程：智能体询问本地目标的行为，REA 使用分析工具检查和追踪目标，智能体再利用返回的代码、引用和未知项进行解释、实现与测试。](../../website/public/assets/figures/rea-investigation-flow.svg)

[打开完整尺寸的图示](../../website/public/assets/figures/rea-investigation-flow.svg)。

<a id="current-status"></a>

## 可以分析什么

REA 需要 Node.js 22.x（>=22.23.4）、24.x（>=24.22.1）或 26+ (>=26.12.1)，以及 npm。额外工具和主机支持取决于分析目标：

| 目标                  | REA 返回的内容                                                               | 要求与指南                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 原生二进制文件        | 伪代码、汇编、字符串、符号、调用和引用                                       | Hopper、Ghidra、IDA 或 Kuna；[原生分析](../native-investigation.md)                                                |
| 离线 ELF 布局         | 节、段、原始符号/重定位信息及静态防护机制候选项                              | Linux x64 上由调用方提供的 pwntools；[二进制诊断](../binary-diagnostics.md)                                        |
| Go 二进制文件         | 内嵌编译器版本、模块、替换项和构建设置                                       | 内置静态 ELF/PE/thin Mach-O 检查；无需安装 Go                                                                      |
| WASM 工件             | 验证、节、精确的导入/导出 WAT 形式及解码后的 WAT                             | 调用方提供的 WABT 1.0.42；`inspect_wasm_artifact`                                                                  |
| EVM 字节码            | 分派选择器、字节偏移、推断的参数和状态可变性                                 | Linux x64 上的本地原始字节/十六进制输入载体；[离线 EVM 指南](../evm-bytecode.md)                                   |
| Rust binaries         | Embedded cargo-auditable dependency list                                     | [Rust binaries](../rust-binaries.md)                                                                               |
| Erlang BEAM           | IFF chunks, atoms, exports, and tables                                       | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                  |
| PE certificates       | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                            |
| PE imports            | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash   | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                      |
| ELF notes             | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields              | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                       |
| Apple IPS crashes     | .ips metadata, threads, images, registers and crash classes                  | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                      |
| Linux kernel modules  | .modinfo keys, __versions CRCs, this_module presence, and signature trailer  | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                             |
| 已记录的 Linux 崩溃   | 原始 note 记录、每个已记录线程的寄存器/信号及可选的映射候选项                | Linux x64 上由调用方提供的 pwntools；可选的 GDB/pwndbg；[已记录崩溃](../recorded-crashes.md)                       |
| 桌面安装目录          | 运行时候选、支持文件、组件标记和后续操作                                     | 有界的目录与文件头检查；[桌面应用](../desktop-applications.md)                                                     |
| JavaScript / Electron | 模块、导入、source map、路由、IPC 和原生扩展关系                             | Node.js 和 npm；[应用分析](../javascript-application-workflows.md); Linux: procps `ps`                             |
| 网站                  | 页面结构、脚本、网络观察结果和按请求获取的截图                               | Chrome 系浏览器；[浏览器分析](../browser-observation.md)                                                           |
| 已保存的网络捕获      | 请求、响应、可访问的载荷和来源位置                                           | HAR / Fiddler Everywhere SAZ；原生 mitmproxy 捕获需要 Linux 上的 mitmdump；[捕获指南](../web-network-captures.md)  |
| 数据包捕获            | 端点、DNS、TLS SNI、协议分布和 HTTP 请求                                     | 调用方提供的 tshark 和 capinfos；[pcap 指南](../pcap-analysis.md)                                                  |
| .NET 程序集           | 元数据、CIL 指令、声明的原生依赖和构建对比                                   | 静态检查；[托管代码指南](../managed-code-analysis.md)                                                              |
| PyInstaller           | CArchive, PYZ, Python bytecode                                               | Static inspection; [Python packaged applications](../python-packaged-applications.md)                              |
| Android APK           | 清单声明、类、反编译的方法和引用                                             | Linux/macOS/Windows x64 上的无界面 JADX 和完整 JDK；[Android 指南](../android-analysis.md)                         |
| Android 设备          | 设备、软件包、进程、日志、转储、屏幕截图以及 APK/文件传输                    | 调用方提供的 adb（模拟器或实体设备）；[ADB 指南](../adb-device-analysis.md)                                        |
| JEB 项目              | 引擎支持的项目单元、工件摘要和类型/方法的伪代码                              | 由调用方启动、提供 MCP 的 JEB 客户端，通过 REA_JEB_MCP_URL 选择；[JEB 指南](../jeb-analysis.md)                    |
| Android 资源          | 解码后的清单、字符串表、语言区域和版本信息                                   | 调用方提供的 Apktool 启动器；[资源指南](../apktool-resource-analysis.md)                                           |
| Flutter 应用          | Dart 快照哈希、按 ABI 的库摘要及引擎构建溯源                                 | 无（静态 APK 解析）；[Flutter 指南](../flutter-analysis.md)                                                        |
| 固件                  | 区域、提取结果和转交原生分析的内容                                           | Linux 上的 Binwalk / Unblob；[固件指南](../firmware-analysis.md)                                                   |
| 抓包文件              | 指定字段、重复值、过滤条件与解码规则                                         | Linux: TShark 4.x + prlimit; [抓包分析指南](../packet-captures.md)                                                 |
| 录制的逻辑信号        | 解码注释、样本范围和诊断信息                                                 | Linux: sigrok-cli 0.7.2 + prlimit; [信号记录指南](../signal-recordings.md)                                         |
| 软件包与资源          | 文件清单、摘要、plist、Apple bundle 结构和提取的资源                         | [制品与 JavaScript 指南](../javascript-artifact-reconstruction.md)、[Apple 应用](../apple-application-analysis.md) |
| 进程行为              | 终端输出、交互、退出和文件系统观察结果，以及运行对比                         | 支持原生 PTY 的 Linux/macOS；[进程捕获](../process-capture.md)                                                     |
| SQLite 数据库         | 表、列、索引、视图、触发器和选定普通表的行                                   | 本地数据库/WAL 快照；Node.js 24.x >=24.15 或 26+，具有原生 SQLite 限制 API                                         |
| GPU 代码对象          | CUDA/HIP 目标、选定内核参数和资源、保留的 PTX 文本                           | 内置静态检查 ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                |
| 模型文件              | GGUF / safetensors 元数据、张量声明和派生总量                                | 头部检查；可选完整文件哈希; [GGUF / safetensors](../model-artifacts.md)                                            |
| IL2CPP 元数据         | Unity global-metadata.dat 程序集映像、类型和方法名、索引范围                 | 静态解码版本 24、27、29、31 和 39；无需 Unity                                                                      |
| Godot PCK             | 归档目录与提取、原始头部和目录信息、选定内容身份                             | 静态格式 2、3 和 4；无需 Godot                                                                                     |
| APK 签名              | v1/v2/v3/v3.1 签名者、证书指纹、密钥轮换和摘要自洽性                         | 内置静态检查; `inspect_apk_signature`                                                                              |

静态 JavaScript 和 .NET 检查读取提供的文件，不运行应用。运行时捕获会以你的用户权限运行目标或与之交互；各运行时指南说明了具体影响。

<a id="choosing-a-deep-analysis-provider"></a>

大型二进制文件可通过 `REA_GHIDRA_STARTUP_TIMEOUT_MS` 或 `REA_HOPPER_STARTUP_TIMEOUT_MS` 延长提供方启动期限。

不同提供方支持的原生格式和主机系统有所不同。请参阅 [Hopper 与 Ghidra 设置](../installation.md#hopper)、[IDA 指南](../ida-provider.md)、[Kuna](../kuna-provider.md)和[实验性 Windows Ghidra 支持](../windows-ghidra-p0.md)。Ghidra 也支持 [16 位 DOS 分析](../ghidra-dos.md)。提供方选择见 [CLI 指南](../cli.md#choose-a-provider)。对于最新 npm 版本发布后新增的功能，请查看[发布可用性](../installation.md#released-package-and-main)。

## 案例

<a href="https://rea.tools/zh-CN/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="DX-Ball 声音平移、Notion 剪贴板桥接与 TH04 弹幕环案例的插图" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball：重建声像计算

沿声音调用追踪到根据位置计算声像的辅助函数，检查指令，将不完整的伪代码转为 C。重建结果通过了 3,205 个原始 x86 测试用例，并复现了编译后函数的全部 63 个字节。

[阅读案例](https://rea.tools/zh-CN/showcase/dx-ball/) ·
[重建项目仓库](https://github.com/N0zoM1z0/dx-ball)

### Notion：追踪 Electron 剪贴板桥

找到渲染进程的剪贴板 API，沿 preload 和 IPC 追踪到主进程，并检查富格式剪贴板数据。

[阅读案例](https://rea.tools/zh-CN/showcase/notion/)

### TH04：恢复 DOS 环形子弹的计算

检查原始 PC-98 游戏的 16 位指令，恢复固定角度和瞄准角度的计算，并将重建的 C++ 与当年的编译器输出进行对比。

[阅读案例](https://rea.tools/zh-CN/showcase/th04/) ·
[重建项目仓库](https://github.com/N0zoM1z0/th04)

### 用 REA 构建 RL 环境

录制 Web 应用会话，将 API 转为工具，并导出 AI 智能体可使用的环境。用 AgentEnv 运行，再添加任务和奖励检查，用于 RL 训练或评测。

[构建环境指南](https://rea.tools/guides/rl-environments/) ·
[在 X 上观看演示](https://x.com/reatools/status/2112574822584918075?s=20)

如果你用 REA 分析了有趣的目标，我们很想了解。欢迎通过 [issue](https://github.com/morluto/rea/issues) 或 [pull request](https://github.com/morluto/rea/pulls) 分享案例，说明目标、你的问题、REA 如何提供帮助，以及你的发现。

<a id="build-rl-environments"></a>

## 构建 RL 环境

为 AI 智能体构建本地练习环境，让它练习查找 issue、创建文件夹等任务，无需运行原应用。这个环境可用于强化学习（RL），也可用于测试智能体完成任务的能力。

REA 将录制的 API 请求和响应转为智能体可调用的工具。环境使用录制的数据，只有录制证据确认了某项修改的效果，才会支持该修改。

在智能体中设置好 REA 后，将下面示例中的网址和文件夹任务替换为你自己的：

```text
使用 REA 为我的测试 Web 应用构建 RL 环境，网址是
http://127.0.0.1:3000。
覆盖列出、创建、重命名和删除文件夹。可以创建和删除测试文件夹，
但不要修改已有数据。
将环境保存到名为 my-env 的文件夹。检查哪些操作可用，并告诉我如何运行。
```

<details>
<summary>改用命令行</summary>

如果你已经将应用在浏览器中的请求和响应录制成文件，可以使用这些命令。运行生成的环境还需要 AgentEnv 和 Docker。

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA 导出可直接运行的环境，并附带基本测试，检查环境能否启动和响应。将它接入 RL 框架，即可设置任务目标、添加奖励检查并运行训练。

[构建环境指南](https://rea.tools/guides/rl-environments/) ·
[环境参考文档](../agent-environments.md) ·
[在 X 上观看演示](https://x.com/reatools/status/2112574822584918075?s=20)

## 常见问题

<details>
<summary><strong>哪些智能体可以使用 REA？</strong></summary>

任何支持本地 MCP 服务的智能体都可以使用。设置流程会配置[受支持的智能体](../installation.md#supported-agents)；其他客户端可通过[手动注册 MCP](../installation.md#mcp-registry) 使用。

</details>

<details>
<summary><strong>需要 Hopper、Ghidra、IDA 或 Kuna 吗？</strong></summary>

深入的原生分析需要其中一个引擎。静态 JavaScript 和 .NET 检查不需要原生分析引擎。设置流程可以在你批准后安装 Hopper；Ghidra、IDA 和 Kuna 则使用已有安装。见[提供方设置](../installation.md#hopper)。

</details>

<details>
<summary><strong>需要先启动 Hopper 吗？</strong></summary>

REA 会在操作需要时启动 Hopper。在 macOS 上，首次运行时可能会出现对话框，让你选择演示模式或激活许可证。见 [Hopper 启动与故障排查](../installation.md#launcher-paths-and-troubleshooting)。

</details>

<details>
<summary><strong>从 skills.sh 安装 skill 有什么作用？</strong></summary>

skill 为智能体提供调查指引。使用 `npx rea-agents setup` 注册 REA 的 MCP 服务并安装匹配的指引，然后重启智能体。见[仅安装 skill](../installation.md#skill-only-installation)。

</details>

<details>
<summary><strong>REA 返回什么代码？</strong></summary>

原生分析返回伪代码和汇编。JavaScript/Electron 分析恢复模块及其关系。智能体利用这些发现编写并测试实现；[案例](#案例)提供了完整示例。

</details>

<details>
<summary><strong>REA 会上传我的应用吗？</strong></summary>

REA 在本机分析目标。智能体会接收工具结果，其模型提供商有自己的数据政策。

</details>

<details>
<summary><strong>遇到错误时该怎么办？</strong></summary>

先更新；最近的版本可能已经修复了问题。

通过 npm 安装的 CLI 使用：

```bash
rea update
```

通过 `npx` 设置智能体时使用：

```bash
npx rea-agents@latest setup
```

如果正在使用智能体，请完成[设置更新](#更新-rea)并重启智能体。重试同一任务。如果问题仍然存在，请[提交 issue](https://github.com/morluto/rea/issues)，附上 REA 版本、目标类型、复现步骤和错误输出。

</details>

## 文档

可以先阅读网站上的[实操指南](https://rea.tools/zh-CN/guides/)。具体选项、前提条件和结果契约见：

- [安装与设置](../installation.md)：智能体注册、提供方配置、更新和卸载。
- [就绪检查与故障排查](../installation.md#check-readiness-for-your-task)：诊断特定智能体或分析引擎。
- [CLI 与 Evidence](../cli.md)：命令、提供方选择、快照、导入/导出和退出状态。
- [MCP 契约](../mcp-contracts.md)和[智能体提示词](../mcp-prompts.md)：工具结果、会话和引导式调查。
- [工具目录](../mcp-contracts.md#generated-catalog)：构建时生成的工具、提供方和 CLI 命令清单。
- [路线图](../roadmap.md)：计划中的工作和能力跟踪。

请按照 [SECURITY.md](../../SECURITY.md) 报告漏洞。

## Star 历史

🎉 **GitHub Star 达到 400,000 个，感谢大家！**

感谢每一位使用 REA、报告错误、提出功能需求、测试构建和贡献修复的朋友。

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="REA 的 GitHub Star 历史" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## 免责声明

负责任使用的相关指引请见 [DISCLAIMER.md](../../DISCLAIMER.md)。

REA 用于合法的研究、教育、互操作性、软件保存，以及分析你拥有或获准检查的软件。

本项目对非法或未经授权使用的立场涵盖所有 REA 版本、分发渠道和运行平台；
每份副本仍适用其随附的许可。

## 参与贡献

欢迎帮助改进 REA！你可以[提交 issue](https://github.com/morluto/rea/issues) 报告错误或建议功能，也可以[提交 pull request](https://github.com/morluto/rea/pulls) 改进代码或文档。

开发设置和检查见 [CONTRIBUTING.md](../../CONTRIBUTING.md)，验证流程见[测试指南](../testing.md)，项目结构见[架构图](../architecture.mermaid)。

## 许可证

[MIT](../../LICENSE)

REA 自行编写的代码采用 MIT 许可；第三方内容保留各自的许可和著作权声明。
依赖清单、许可原文及外部工具条款见[第三方声明](../../THIRD_PARTY_NOTICES.md)。

**用户须自行合法取得商用工具及所需使用权**，包括 IDA Pro / Hex-Rays 反编译器、
Hopper 和 JEB，并遵守各自许可。REA 不提供工具许可、密钥或激活权利；试用版和
演示版也须遵守厂商对用户、功能、自动化及输出分享的限制。不得使用破解副本、
窃取或违规共用密钥，也不得绕过许可限制。本指引不变更 MIT 或第三方许可。
