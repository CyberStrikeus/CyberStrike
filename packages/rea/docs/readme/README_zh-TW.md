<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · **繁體中文** · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA：逆向一切

### 通過一個 MCP 服務，逆向分析二進位檔案、應用程式和執行階段行為。

**看到喜歡的功能，弄清它的工作原理，深入到二進位層面。**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[網站](https://rea.tools/zh-TW/) · [指南](https://rea.tools/zh-TW/guides/) · [案例](https://rea.tools/zh-TW/showcase/)**

[快速開始](#快速開始) · [REA 的工作原理](#rea-的工作原理) · [可以分析什麼](#可以分析什麼) · [案例](#案例) · [建立 RL 環境](#build-rl-environments) · [常見問題](#常見問題) · [文件](#文件)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> REA 官方來源： [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> 請透過這些官方來源提供的安裝與發布連結取得 REA。相似的儲存庫名稱或複製的 README 不能證明下載內容來自官方。

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA 在 Hopper 中啟動分析橋，檢查原生二進位檔案" width="1200" />

<br /><br />

<table aria-label="REA 社群">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>加入逆向工程社群</strong>
  </a><br />
  <sub>Discord · 問答 · 成果分享</sub>
</td>
</tr>
</table>

<br />

</div>

---

在應用中看到一個想加入自己產品的功能？讓 AI 代理用 REA 調查它。即使沒有原始碼，AI 代理也可以檢查應用、解釋功能的工作方式、展示證據，並為你的專案實現類似功能。

REA 將 AI 代理連接到分析工具，用於檢查原生二進位檔案、JavaScript 和 Electron 應用、.NET 程式集以及網站。你也可以在終端中使用同樣的工具。分析在本機執行，結果包含支撐各項結論的證據和相關限制。

設定流程會向 AI 代理註冊 REA，並安裝對應的工作流程指引。原生分析可以使用已有的 Hopper、Ghidra、IDA 或 Kuna；設定流程也可以在你核准後安裝 Hopper。靜態 JavaScript 分析不需要原生分析引擎。

> **[訪問 REA 網站](https://rea.tools/zh-TW/)**，查看設定說明、圖解指南和真實案例。

## 快速開始

Linux 上的 Ghidra、JADX、韌體工具啟動和靜態 JavaScript/Electron 分析需要在 REA 的 `PATH` 中提供相容 procps 的 `ps`，用於檢查程序所有權。復原步驟見安裝指南的 Linux 程序所有權前提。

### 設定 AI 代理

安裝 Node.js 和 npm 後，執行：

```bash
npx rea-agents setup
```

選擇 AI 代理，檢查計劃中的變更並核准。設定流程會添加 REA 的 MCP 服務和對應的工作流程指引，並備份已有組態。完成後重新啟動 AI 代理。

設定流程支援 Claude Code、Codex、Cursor、Gemini CLI、Grok Build 和[其他 AI 代理](../installation.md#supported-agents)。提供者組態和手動註冊 MCP 的方法見[安裝與設定](../installation.md)。

MCP 預設使用精簡輸入 Schema，以減少上下文開銷。需要完整欄位說明和巢狀驗證細節時，請在 MCP 註冊中設定 `REA_MCP_INPUT_SCHEMA_PROFILE=full`。兩種設定都保留完整工具集和標準的伺服器驗證；見 MCP 合約指南。

### 詢問 AI 代理

```text
弄清 Notes 應用的搜尋功能如何工作，展示證據，並為我的專案實現類似功能。
```

把 Notes 替換為目標應用，並描述你想瞭解的功能。

### 使用終端

檢查已解包的 JavaScript/Electron 應用目錄或 ASAR 檔案：

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

結果包含模組、匯入、Electron 邊界及相關證據。將路徑替換為你的目標路徑，例如 Windows 上的 `"D:/apps/example"`。

如果需要經常使用，可以安裝 `rea` 命令：

```bash
npm install --global rea-agents
rea --help
```

原生分析需要先設定分析提供者。原生命令、提供者選擇、快照和腳本用法見 [CLI 與 Evidence 指南](../cli.md)。

### 更新 REA

REA 更新較快，新版本經常包含錯誤修復。請將安裝的版本保持最新。

通過 `npm install --global` 或 `bun add --global` 安裝的 CLI 使用：

```bash
rea update
```

`rea --update` 是 `rea update` 的別名，接受相同的全域輸出選項。更新命令合計最多保留 4 MiB 的 stdout/stderr；命令結束後會拒絕過大的中繼資料回應，詳細安裝記錄採用有界診斷。進度輸出遵守終端背壓並等待已提交的寫入完成。

Bun 全域更新需要 Bun 1.2.17 或更新版本。如果使用較舊的 Bun 版本，請先手動升級 Bun，再執行 `rea update`。

要更新 AI 代理註冊和 skill，請執行更新命令輸出的設定命令。

如果使用 `npx`，通過以下命令更新 AI 代理設定：

```bash
npx rea-agents@latest setup
```

檢查設定變更並重新啟動 AI 代理。單次 CLI 操作可使用 `npx rea-agents@latest`，後接所需命令。使用 Bun 時，用 `bunx rea-agents@latest` 代替 `npx rea-agents@latest`。

## REA 的工作原理

AI 代理通過 MCP 呼叫 REA，檢查目標並追蹤相關程式碼。REA 返回發現及對應證據。AI 代理據此提出後續問題、解釋行為，或編寫並測試實現。CLI 命令使用同樣的工作流程。

![REA 調查流程：AI 代理詢問本地目標的行為，REA 使用分析工具檢查和追蹤目標，AI 代理再利用返回的程式碼、引用和未知項進行解釋、實現與測試。](../../website/public/assets/figures/rea-investigation-flow.svg)

[打開完整尺寸的圖示](../../website/public/assets/figures/rea-investigation-flow.svg)。

<a id="current-status"></a>

## 可以分析什麼

REA 需要 Node.js 22.x（>=22.23.4）、24.x（>=24.22.1）或 26+ (>=26.12.1)，以及 npm。額外工具和主機支援取決於分析目標：

| 目標                  | REA 返回的內容                                                               | 要求與指南                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 原生二進位檔案        | 偽程式碼、組合語言、字串、符號、呼叫和引用                                   | Hopper、Ghidra、IDA 或 Kuna；[原生分析](../native-investigation.md)                                                |
| 離線 ELF 佈局         | 節、段、原始符號/重定位資訊及靜態防護機制候選項                              | Linux x64 上由呼叫方提供的 pwntools；[二進位診斷](../binary-diagnostics.md)                                        |
| Go 二進位檔案         | 內嵌編譯器版本、模組、替換項和建置設定                                       | 內建靜態 ELF/PE/thin Mach-O 檢查；無需安裝 Go                                                                      |
| WASM 工件             | 驗證、節、精確的匯入/匯出 WAT 形式及解碼後的 WAT                             | 呼叫方提供的 WABT 1.0.42；`inspect_wasm_artifact`                                                                  |
| EVM 位元組碼          | 分派選擇器、位元組偏移、推斷的參數和狀態可變性                               | Linux x64 上的本地原始位元組/十六進位輸入載體；[離線 EVM 指南](../evm-bytecode.md)                                 |
| Rust binaries         | Embedded cargo-auditable dependency list                                     | [Rust binaries](../rust-binaries.md)                                                                               |
| Erlang BEAM           | IFF chunks, atoms, exports, and tables                                       | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                  |
| PE certificates       | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                            |
| PE imports            | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash   | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                      |
| ELF notes             | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields              | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                       |
| Apple IPS crashes     | .ips metadata, threads, images, registers and crash classes                  | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                      |
| Linux kernel modules  | .modinfo keys, __versions CRCs, this_module presence, and signature trailer  | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                             |
| 已記錄的 Linux 崩潰   | 原始 note 記錄、每個已記錄執行緒的暫存器/訊號及可選的對映候選項              | Linux x64 上由呼叫方提供的 pwntools；可選的 GDB/pwndbg；[已記錄崩潰](../recorded-crashes.md)                       |
| 桌面安裝目錄          | 執行階段候選、支持檔案、元件標記與後續操作                                   | 有界的目錄與檔頭檢查；[桌面應用](../desktop-applications.md)                                                       |
| JavaScript / Electron | 模組、匯入、source map、路由、IPC 和原生附加元件關係                         | Node.js 和 npm；[應用分析](../javascript-application-workflows.md); Linux: procps `ps`                             |
| 網站                  | 頁面結構、腳本、網路觀察結果和按請求獲取的螢幕擷取畫面                       | Chrome 系瀏覽器；[瀏覽器分析](../browser-observation.md)                                                           |
| 已保存的網路擷取      | 請求、回應、可訪問的酬載和來源位置                                           | HAR / Fiddler Everywhere SAZ；原生 mitmproxy 擷取需要 Linux 上的 mitmdump；[擷取指南](../web-network-captures.md)  |
| 封包擷取              | 端點、DNS、TLS SNI、通訊協定分佈和 HTTP 請求                                 | 呼叫端提供的 tshark 和 capinfos；[pcap 指南](../pcap-analysis.md)                                                  |
| .NET 程式集           | 中繼資料、CIL 指令、聲明的原生依賴和建置對比                                 | 靜態檢查；[托管程式碼指南](../managed-code-analysis.md)                                                            |
| PyInstaller           | CArchive, PYZ, Python bytecode                                               | Static inspection; [Python packaged applications](../python-packaged-applications.md)                              |
| Android APK           | 清單聲明、類別、反編譯的方法和引用                                           | Linux/macOS/Windows x64 上的無界面 JADX 和完整 JDK；[Android 指南](../android-analysis.md)                         |
| Android 裝置          | 裝置、套件、程序、日誌、傾印、螢幕擷取以及 APK/檔案傳輸                      | 呼叫端提供的 adb（模擬器或實體裝置）；[ADB 指南](../adb-device-analysis.md)                                        |
| JEB 專案              | 引擎支援的專案單元、成品摘要和型別/方法的虛擬碼                              | 由呼叫端啟動、提供 MCP 的 JEB 用戶端，透過 REA_JEB_MCP_URL 選擇；[JEB 指南](../jeb-analysis.md)                    |
| Android 資源          | 解碼後的清單、字串表、語系和版本資訊                                         | 呼叫端提供的 Apktool 啟動器；[資源指南](../apktool-resource-analysis.md)                                           |
| Flutter 應用          | Dart 快照雜湊、依 ABI 的程式庫雜湊及引擎建置來源                             | 無（靜態 APK 解析）；[Flutter 指南](../flutter-analysis.md)                                                        |
| 韌體                  | 區域、提取結果和轉交原生分析的內容                                           | Linux 上的 Binwalk / Unblob；[韌體指南](../firmware-analysis.md)                                                   |
| 封包記錄              | 指定欄位、重複值、篩選條件與解碼規則                                         | Linux: TShark 4.x + prlimit; [封包分析指南](../packet-captures.md)                                                 |
| 錄製的邏輯訊號        | 解碼註解、樣本範圍與診斷資訊                                                 | Linux: sigrok-cli 0.7.2 + prlimit; [訊號記錄指南](../signal-recordings.md)                                         |
| 軟體包與資源          | 檔案清單、摘要、plist、Apple bundle 結構和提取的資源                         | [製品與 JavaScript 指南](../javascript-artifact-reconstruction.md)、[Apple 應用](../apple-application-analysis.md) |
| 處理程序行為          | 終端輸出、互動、退出和檔案系統觀察結果，以及執行對比                         | 支援原生 PTY 的 Linux/macOS；[處理程序擷取](../process-capture.md)                                                 |
| SQLite 資料庫         | 資料表、欄位、索引、檢視、觸發器和選定普通資料表的列                         | 本機資料庫/WAL 快照；Node.js 24.x >=24.15 或 26+，具備原生 SQLite 限制 API                                         |
| GPU 程式碼物件        | CUDA/HIP 目標、選定核心參數和資源、保留的 PTX 文字                           | 內建靜態檢查 ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                |
| 模型檔案              | GGUF / safetensors 中繼資料、張量宣告和衍生總量                              | 標頭檢查；可選完整檔案雜湊; [GGUF / safetensors](../model-artifacts.md)                                            |
| IL2CPP 中繼資料       | Unity global-metadata.dat 組件映像、型別與方法名稱、索引範圍                 | 靜態解碼版本 24、27、29、31 和 39；無需 Unity                                                                      |
| Godot PCK             | 封存清單與擷取、原始標頭和目錄資訊、選定內容身分                             | 靜態格式 2、3 和 4；無需 Godot                                                                                     |
| APK 簽章              | v1/v2/v3/v3.1 簽署者、憑證指紋、金鑰輪換和摘要自洽性                         | 內建靜態檢查; `inspect_apk_signature`                                                                              |

靜態 JavaScript 和 .NET 檢查讀取提供的檔案，不執行應用。執行階段擷取會以你的使用者權限執行目標或與之互動；各執行階段指南說明瞭具體影響。

若要離線檢查原生二進位檔，REA 也支援由呼叫端自行提供的 GNU objdump 和 Rizin。[逆向工程工具指南](../reverse-engineering-tools.md)說明了分析提供者的設定、CLI 指令及 Evidence 的限制。REA 不會安裝或更新這兩個分析提供者。

<a id="choosing-a-deep-analysis-provider"></a>

大型二進位檔可透過 `REA_GHIDRA_STARTUP_TIMEOUT_MS` 或 `REA_HOPPER_STARTUP_TIMEOUT_MS` 延長提供者啟動期限。

不同提供者支援的原生格式和主機系統有所不同。請參閱 [Hopper 與 Ghidra 設定](../installation.md#hopper)、[IDA 指南](../ida-provider.md)、[Kuna](../kuna-provider.md)和[實驗性 Windows Ghidra 支援](../windows-ghidra-p0.md)。Ghidra 也支援 [16 位 DOS 分析](../ghidra-dos.md)。提供者選擇見 [CLI 指南](../cli.md#choose-a-provider)。對於最新 npm 版本發佈後新增的功能，請查看[發佈可用性](../installation.md#released-package-and-main)。

## 案例

<a href="https://rea.tools/zh-TW/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="DX-Ball 聲音平移、Notion 剪貼簿橋接與 TH04 彈幕環案例的插圖" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball：重建聲像計算

沿聲音呼叫追蹤到根據位置計算聲像的輔助函數，檢查指令，將不完整的偽程式碼轉為 C。重建結果通過了 3,205 個原始 x86 測試用例，並復現了編譯後函數的全部 63 個位元組。

[閱讀案例](https://rea.tools/zh-TW/showcase/dx-ball/) ·
[重建專案儲存庫](https://github.com/N0zoM1z0/dx-ball)

### Notion：追蹤 Electron 剪貼簿橋

找到渲染處理程序的剪貼簿 API，沿 preload 和 IPC 追蹤到主處理程序，並檢查富格式剪貼簿資料。

[閱讀案例](https://rea.tools/zh-TW/showcase/notion/)

### TH04：恢復 DOS 環形子彈的計算

檢查原始 PC-98 遊戲的 16 位指令，恢復固定角度和瞄準角度的計算，並將重建的 C++ 與當年的編譯器輸出進行對比。

[閱讀案例](https://rea.tools/zh-TW/showcase/th04/) ·
[重建專案儲存庫](https://github.com/N0zoM1z0/th04)

### 用 REA 建立 RL 環境

錄製 Web 應用程式工作階段，將 API 轉為工具，並匯出 AI 代理可使用的環境。用 AgentEnv 執行，再加入任務與獎勵檢查，用於 RL 訓練或評測。

[建立環境指南](https://rea.tools/guides/rl-environments/) ·
[在 X 上觀看示範](https://x.com/reatools/status/2112574822584918075?s=20)

如果你用 REA 分析了有趣的目標，我們很想瞭解。歡迎通過 [issue](https://github.com/morluto/rea/issues) 或 [pull request](https://github.com/morluto/rea/pulls) 分享案例，說明目標、你的問題、REA 如何提供幫助，以及你的發現。

<a id="build-rl-environments"></a>

## 建立 RL 環境

為 AI 代理建立本機練習環境，讓它練習尋找 issue、建立資料夾等任務，無需執行原應用程式。這個環境可用於強化學習（RL），也可用於測試代理完成任務的能力。

REA 將錄製的 API 請求與回應轉為代理可呼叫的工具。環境使用錄製的資料，只有錄製證據確認了某項修改的效果，才會支援該修改。

在代理中設定好 REA 後，將下方範例的網址與資料夾任務替換為你自己的：

```text
使用 REA 為我的測試 Web 應用程式建立 RL 環境，網址是
http://127.0.0.1:3000。
涵蓋列出、建立、重新命名與刪除資料夾。可以建立和刪除測試資料夾，
但不要修改既有資料。
將環境儲存到名為 my-env 的資料夾。檢查哪些操作可用，並告訴我如何執行。
```

<details>
<summary>改用命令列</summary>

如果你已經將應用程式在瀏覽器中的請求與回應錄製成檔案，可以使用這些命令。執行產生的環境還需要 AgentEnv 與 Docker。

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA 匯出可直接執行的環境，並附帶基本測試，檢查環境能否啟動與回應。將它接入 RL 框架，即可設定任務目標、加入獎勵檢查並執行訓練。

[建立環境指南](https://rea.tools/guides/rl-environments/) ·
[環境參考文件](../agent-environments.md) ·
[在 X 上觀看示範](https://x.com/reatools/status/2112574822584918075?s=20)

## 常見問題

<details>
<summary><strong>哪些 AI 代理可以使用 REA？</strong></summary>

任何支援本地 MCP 服務的 AI 代理都可以使用。設定流程會設定[受支援的 AI 代理](../installation.md#supported-agents)；其他客戶端可通過[手動註冊 MCP](../installation.md#mcp-registry) 使用。

</details>

<details>
<summary><strong>需要 Hopper、Ghidra、IDA 或 Kuna 嗎？</strong></summary>

深入的原生分析需要其中一個引擎。靜態 JavaScript 和 .NET 檢查不需要原生分析引擎。設定流程可以在你核准後安裝 Hopper；Ghidra、IDA 和 Kuna 則使用已有安裝。見[提供者設定](../installation.md#hopper)。

</details>

<details>
<summary><strong>需要先啟動 Hopper 嗎？</strong></summary>

REA 會在操作需要時啟動 Hopper。在 macOS 上，首次執行時可能會出現對話框，讓你選擇演示模式或啟用授權。見 [Hopper 啟動與故障排查](../installation.md#launcher-paths-and-troubleshooting)。

</details>

<details>
<summary><strong>從 skills.sh 安裝 skill 有什麼作用？</strong></summary>

skill 為 AI 代理提供調查指引。使用 `npx rea-agents setup` 註冊 REA 的 MCP 服務並安裝對應的指引，然後重新啟動 AI 代理。見[僅安裝 skill](../installation.md#skill-only-installation)。

</details>

<details>
<summary><strong>REA 返回什麼程式碼？</strong></summary>

原生分析返回偽程式碼和組合語言。JavaScript/Electron 分析恢復模組及其關係。AI 代理利用這些發現編寫並測試實現；[案例](#案例)提供了完整示例。

</details>

<details>
<summary><strong>REA 會上傳我的應用嗎？</strong></summary>

REA 在本機分析目標。AI 代理會接收工具結果，其模型提供商有自己的資料政策。

</details>

<details>
<summary><strong>遇到錯誤時該怎麼辦？</strong></summary>

先更新；最近的版本可能已經修復了問題。

通過 npm 安裝的 CLI 使用：

```bash
rea update
```

通過 `npx` 設定 AI 代理時使用：

```bash
npx rea-agents@latest setup
```

如果正在使用 AI 代理，請完成[設定更新](#更新-rea)並重新啟動 AI 代理。重試同一任務。如果問題仍然存在，請[提交 issue](https://github.com/morluto/rea/issues)，附上 REA 版本、目標類型、復現步驟和錯誤輸出。

</details>

## 文件

可以先閱讀網站上的[實操指南](https://rea.tools/zh-TW/guides/)。具體選項、前提條件和結果契約見：

- [安裝與設定](../installation.md)：AI 代理註冊、提供者組態、更新和卸載。
- [就緒檢查與故障排查](../installation.md#check-readiness-for-your-task)：診斷特定 AI 代理或分析引擎。
- [CLI 與 Evidence](../cli.md)：命令、提供者選擇、快照、匯入/匯出和退出狀態。
- [MCP 契約](../mcp-contracts.md)和[AI 代理提示詞](../mcp-prompts.md)：工具結果、會話和引導式調查。
- [工具目錄](../mcp-contracts.md#generated-catalog)：建置時生成的工具、提供者和 CLI 命令清單。
- [路線圖](../roadmap.md)：計劃中的工作和能力跟蹤。

請按照 [SECURITY.md](../../SECURITY.md) 報告漏洞。

## Star 歷史

🎉 **GitHub Star 達到 400,000 個，感謝大家！**

感謝每一位使用 REA、報告錯誤、提出功能需求、測試建置和貢獻修復的朋友。

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="REA 的 GitHub Star 歷史" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## 免責聲明

負責任使用的相關指引請見 [DISCLAIMER.md](../../DISCLAIMER.md)。

REA 用於合法的研究、教育、互通性、軟體保存，以及分析你擁有或獲准檢查的軟體。

本專案對非法或未經授權使用的立場涵蓋所有 REA 版本、分發管道和執行平台；
每份副本仍適用其隨附的授權。

## 參與貢獻

歡迎幫助改進 REA！你可以[提交 issue](https://github.com/morluto/rea/issues) 報告錯誤或建議功能，也可以[提交 pull request](https://github.com/morluto/rea/pulls) 改進程式碼或文件。

開發設定和檢查見 [CONTRIBUTING.md](../../CONTRIBUTING.md)，驗證流程見[測試指南](../testing.md)，專案結構見[架構圖](../architecture.mermaid)。

## 授權條款

[MIT](../../LICENSE)

REA 自行編寫的程式碼採用 MIT 授權；第三方內容保留各自的授權和著作權聲明。
依賴清單、授權原文及外部工具條款見[第三方聲明](../../THIRD_PARTY_NOTICES.md)。

**使用者須自行合法取得商用工具及所需使用權**，包括 IDA Pro / Hex-Rays 反編譯器、
Hopper 和 JEB，並遵守各自授權。REA 不提供工具授權、金鑰或啟用權利；試用版和
展示版也須遵守廠商對使用者、功能、自動化及輸出分享的限制。不得使用破解副本、
竊取或違規共用金鑰，也不得繞過授權限制。本指引不變更 MIT 或第三方授權。
