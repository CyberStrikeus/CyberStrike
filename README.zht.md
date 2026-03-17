<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>AI 驅動的攻擊性安全智能體平台。</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.el.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a> |
  <a href="README.hi.md">हिन्दी</a>
</p>

---

### 什麼是 CyberStrike？

CyberStrike 是一個開源的自主攻擊性安全智能體，運行在您的終端機中。它內建 13+ 個專業安全智能體、120+ 個 OWASP 測試案例，並支援 15+ 個 LLM 提供商。只需指定目標，它就能自動完成偵察、漏洞發現和報告生成——一切都在一個終端介面中完成。

### 功能特色

- **13+ 個安全智能體** — Web 應用（OWASP WSTG）、行動端（MASTG/MASVS）、雲端安全（AWS/Azure/GCP）、Active Directory/Kerberos、網路，以及 8 個專業代理測試器（IDOR、注入、SSRF、認證繞過等）
- **30+ 個內建工具** — Shell 執行、HTTP 請求、檔案操作、程式碼搜尋、網頁抓取、漏洞報告
- **Bolt** — 基於 MCP 協定和 Ed25519 配對的遠端工具伺服器。在遠端伺服器上執行安全工具，從終端機進行控制
- **MCP 生態系統** — 第一方整合：[hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)、[cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)、[github-security-mcp](https://github.com/badchars/github-security-mcp)、[cve-mcp](https://github.com/badchars/cve-mcp)、[osint-mcp](https://github.com/badchars/osint-mcp)
- **15+ 個 LLM 提供商** — Anthropic、OpenAI、Google、Amazon Bedrock、Azure、Groq、DeepInfra、Mistral、OpenRouter、透過 OpenAI 相容端點接入的本地模型等
- **多介面** — TUI（終端機）、Web（SolidJS）、桌面端（Tauri）——隨處使用同一個智能體引擎
- **LSP 支援** — 語言伺服器協定整合，適用於 IDE 工作流程
- **外掛系統** — 使用外掛 SDK 建構自訂智能體和工具

### 安裝

```bash
# npm / bun / pnpm / yarn
npm i -g cyberstrike@latest

# macOS
brew install CyberStrikeus/tap/cyberstrike

# Windows
scoop install cyberstrike

# curl
curl -fsSL https://cyberstrike.io/install | bash
```

### 快速開始

```bash
# 啟動 CyberStrike
cyberstrike

# 首次執行時選擇您的 LLM 提供商，然後：
# "對 https://target.com 執行完整的 OWASP WSTG 評估"
```

### 智能體

在 TUI 中使用 `Tab` 鍵切換智能體。

| 智能體 | 領域 | 描述 |
|--------|------|------|
| **cyberstrike** | 通用 | 預設全權限攻擊性安全智能體 |
| **web-application** | Web | OWASP Top 10、WSTG 方法論、API 安全 |
| **mobile-application** | 行動端 | Android/iOS 測試、Frida、MASTG/MASVS |
| **cloud-security** | 雲端 | AWS、Azure、GCP、IAM、CIS 基準 |
| **internal-network** | 網路 | Active Directory、Kerberos、橫向移動 |

另外還有 8 個專業**代理測試器**智能體，針對特定漏洞類型：IDOR、授權、批量賦值、注入、認證、業務邏輯、SSRF 和檔案攻擊。

### 桌面應用程式

支援 macOS、Windows 和 Linux。從[發佈頁面](https://github.com/CyberStrikeus/CyberStrike/releases)下載。

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### 文件

- [文件](https://cyberstrike.io/docs)
- [貢獻指南](./CONTRIBUTING.md)
- [行為準則](./CODE_OF_CONDUCT.md)

### 授權條款

[AGPL-3.0-only](./LICENSE) — 商業授權請聯繫 [contact@cyberstrike.io](mailto:contact@cyberstrike.io)。

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
