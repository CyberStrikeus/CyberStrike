<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>AI 驱动的攻击性安全智能体平台。</b></p>

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

### 什么是 CyberStrike？

CyberStrike 是一个开源的自主攻击性安全智能体，运行在你的终端中。它内置 13+ 个专业安全智能体、120+ 个 OWASP 测试用例，并支持 15+ 个 LLM 提供商。只需指定目标，它就能自动完成侦察、漏洞发现和报告生成——一切都在一个终端界面中完成。

### 功能特性

- **13+ 个安全智能体** — Web 应用（OWASP WSTG）、移动端（MASTG/MASVS）、云安全（AWS/Azure/GCP）、Active Directory/Kerberos、网络，以及 8 个专业代理测试器（IDOR、注入、SSRF、认证绕过等）
- **30+ 个内置工具** — Shell 执行、HTTP 请求、文件操作、代码搜索、网页抓取、漏洞报告
- **Bolt** — 基于 MCP 协议和 Ed25519 配对的远程工具服务器。在远程服务器上运行安全工具，从终端进行控制
- **MCP 生态系统** — 第一方集成：[hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)、[cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)、[github-security-mcp](https://github.com/badchars/github-security-mcp)、[cve-mcp](https://github.com/badchars/cve-mcp)、[osint-mcp](https://github.com/badchars/osint-mcp)
- **15+ 个 LLM 提供商** — Anthropic、OpenAI、Google、Amazon Bedrock、Azure、Groq、DeepInfra、Mistral、OpenRouter、通过 OpenAI 兼容端点接入的本地模型等
- **多界面** — TUI（终端）、Web（SolidJS）、桌面端（Tauri）——随处使用同一个智能体引擎
- **LSP 支持** — 语言服务器协议集成，适用于 IDE 工作流
- **插件系统** — 使用插件 SDK 构建自定义智能体和工具

### 安装

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

### 快速开始

```bash
# 启动 CyberStrike
cyberstrike

# 首次运行时选择你的 LLM 提供商，然后：
# "对 https://target.com 执行完整的 OWASP WSTG 评估"
```

### 智能体

在 TUI 中使用 `Tab` 键切换智能体。

| 智能体 | 领域 | 描述 |
|--------|------|------|
| **cyberstrike** | 通用 | 默认全权限攻击性安全智能体 |
| **web-application** | Web | OWASP Top 10、WSTG 方法论、API 安全 |
| **mobile-application** | 移动端 | Android/iOS 测试、Frida、MASTG/MASVS |
| **cloud-security** | 云 | AWS、Azure、GCP、IAM、CIS 基准 |
| **internal-network** | 网络 | Active Directory、Kerberos、横向移动 |

另外还有 8 个专业**代理测试器**智能体，针对特定漏洞类型：IDOR、授权、批量赋值、注入、认证、业务逻辑、SSRF 和文件攻击。

### 桌面应用

支持 macOS、Windows 和 Linux。从[发布页面](https://github.com/CyberStrikeus/CyberStrike/releases)下载。

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### 文档

- [文档](https://cyberstrike.io/docs)
- [贡献指南](./CONTRIBUTING.md)
- [行为准则](./CODE_OF_CONDUCT.md)

### 许可证

[AGPL-3.0-only](./LICENSE) — 商业许可请联系 [contact@cyberstrike.io](mailto:contact@cyberstrike.io)。

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
