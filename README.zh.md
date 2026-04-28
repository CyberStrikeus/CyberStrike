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

<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">首个专为攻击性安全打造的开源 AI 智能体。</h3>

<p align="center">
  在终端中实现自主渗透测试 — 侦察、漏洞发现、漏洞利用和报告生成。<br>
  一条命令。13+ 专业智能体。120+ OWASP 测试用例。你的 AI 红队。
</p>

<p align="center">
  <a href="#为什么选择-cyberstrike？">为什么选择 CyberStrike？</a> &bull;
  <a href="#独特之处">独特之处</a> &bull;
  <a href="#智能体">智能体</a> &bull;
  <a href="#mcp-生态系统">MCP 生态系统</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#安装">安装</a> &bull;
  <a href="#内置工具">内置工具</a> &bull;
  <a href="#适用人群">适用人群</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyberstrike-io/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/@cyberstrike-io/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

---

### 为什么选择 CyberStrike？

安全测试至今仍以手动操作为主。渗透测试人员需要同时使用数十种工具，在终端之间复制粘贴输出结果，并在接触实际攻击面之前花费数小时进行重复性侦察。漏洞赏金猎人在每个项目上都要重复相同的侦察流程。

**CyberStrike 改变了这一切。** 它是一个理解攻击性安全方法论的自主 AI 智能体 — 不仅仅是运行工具，而是推理应该测试什么，将发现串联起来，并根据发现的内容调整策略。你可以把它想象成终端中一个不知疲倦的红队成员，遵循 OWASP WSTG 方法论，知道何时转换策略，并在完成后自动撰写报告。

```bash
npm i -g @cyberstrike-io/cyberstrike@latest && cyberstrike
# "对 https://target.com 执行完整的 OWASP WSTG 评估"
```

它是开源的，支持任何 LLM 提供商，所有产出均归你所有。

---

### 独特之处

<table>
<tr>
<td width="50%">

**专业安全智能体，而非通用聊天**

CyberStrike 配备了 13+ 个为安全领域专门构建的智能体。每个智能体都携带特定领域的方法论、工具知识和测试模式。Web 应用智能体遵循 WSTG。云安全智能体了解 CIS 基准。移动端智能体使用 Frida 并遵循 MASTG/MASVS。它们不靠猜测 — 而是遵循经过验证的框架。

</td>
<td width="50%">

**自主行动，而非仅提供辅助**

其他 AI 工具需要等你告诉它下一步做什么。CyberStrike 智能体能够规划多步攻击链、执行工具、分析结果、在发现有趣内容时灵活转向，并生成有证据支撑的报告。你设定目标 — 它们负责执行方法论。

</td>
</tr>
<tr>
<td width="50%">

**任意 LLM，无厂商锁定**

开箱即用支持 15+ 个提供商：Anthropic、OpenAI、Google、Amazon Bedrock、Azure、Groq、Mistral、OpenRouter — 甚至通过 OpenAI 兼容端点支持本地模型。使用 Claude、GPT、Gemini 或你自己托管的 LLM 运行。随着模型变得更强大、更便宜，CyberStrike 也会随之提升。

</td>
<td width="50%">

**通过 Bolt 远程执行工具**

你的安全工具不必在笔记本电脑上运行。Bolt 是 CyberStrike 的远程工具服务器 — 将它部署在装有渗透测试工具包的 VPS 上，使用 Ed25519 密钥配对，然后通过 MCP 协议从本地终端控制一切。一个 TUI，多台攻击服务器。

</td>
</tr>
</table>

---

### 智能体

使用 `Tab` 切换智能体。每个都是某一领域的专家。

| 智能体                 | 专注领域 | 功能描述                                            |
| ---------------------- | -------- | --------------------------------------------------- |
| **cyberstrike**        | 综合     | 全权限主智能体 — 侦察、漏洞利用、报告生成           |
| **web-application**    | Web      | OWASP Top 10、WSTG 方法论、API 安全、会话测试       |
| **mobile-application** | 移动端   | Android/iOS、Frida/Objection、MASTG/MASVS 合规      |
| **cloud-security**     | 云安全   | AWS、Azure、GCP — IAM 配置错误、CIS 基准、暴露资源  |
| **internal-network**   | 网络     | Active Directory、Kerberos 攻击、横向移动、跳板穿透 |

另有 **8 个专业代理测试器**，可拦截和操纵流量以测试特定漏洞类别：

`IDOR` · `授权绕过` · `批量赋值` · `注入` · `认证` · `业务逻辑` · `SSRF` · `文件攻击`

---

### MCP 生态系统

CyberStrike 连接专业 MCP 服务器以扩展其能力：

| 服务器                                                                 | 工具数 | 扩展能力                                                            |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)         | 39     | 基于浏览器的安全测试 — XSS、CSRF、DOM 操纵、Cookie 窃取             |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | 38     | 云安全审计 — 覆盖 AWS、Azure、GCP 的 60+ 项检查                     |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39     | GitHub 安全态势 — 仓库、组织、Actions、密钥、供应链                 |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | 23     | CVE 情报 — NVD、EPSS、CISA KEV、GitHub Advisory、OSV                |
| [osint-mcp](https://github.com/badchars/osint-mcp)                     | 37     | OSINT 侦察 — Shodan、VirusTotal、SecurityTrails、Censys、DNS、WHOIS |

全部开源。均可通过 `npx` 安装。可接入 CyberStrike 使用，也可作为独立工具配合任何 MCP 客户端使用。

---

### Bolt

Bolt 是 CyberStrike 的远程工具执行服务器。无需在笔记本电脑上运行安全工具，而是将它们部署到 VPS（或多台），然后从本地终端控制一切。

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**工作原理：**

- 在任意已安装渗透测试工具包的服务器上部署 Bolt
- 使用 Ed25519 密钥配对 — 无密码，无共享密钥
- CyberStrike 智能体通过 MCP 协议远程调用工具
- 结果实时流式传输到本地 TUI
- 从 TUI 管理连接：添加、移除、监控状态

**为什么重要：** 你的攻击基础设施保留在专用服务器上。从带宽更好的 VPS 运行重型扫描，在一个地方保持工具更新，从一个终端在多台攻击服务器之间切换。

---

### 安装

```bash
# npm / bun / pnpm / yarn
npm i -g @cyberstrike-io/cyberstrike@latest

# macOS
brew install CyberStrikeus/tap/cyberstrike

# Windows
scoop install cyberstrike

# curl (Linux/macOS)
curl -fsSL https://cyberstrike.io/install | bash
```

**桌面应用**（macOS、Windows、Linux）— 从[发布页面](https://github.com/CyberStrikeus/CyberStrike/releases)下载，或：

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### 内置工具

CyberStrike 智能体可直接使用 30+ 种工具：

| 类别     | 工具                                     |
| -------- | ---------------------------------------- |
| **执行** | Shell（bash）、文件读/写/编辑、目录列表  |
| **发现** | 网页抓取、网络搜索、代码搜索、glob、grep |
| **安全** | 漏洞报告（HackerOne 格式）、证据收集     |
| **代理** | HTTP/HTTPS 拦截、请求重放、流量分析      |
| **集成** | MCP 服务器、Bolt 远程工具、自定义插件    |

另有**插件 SDK** — 构建你自己的智能体和工具，运行时注册。

---

### 适用人群

- **渗透测试人员** — 自动化重复性工作。让智能体处理侦察和初始测试，而你专注于需要人类直觉的创造性攻击链。
- **漏洞赏金猎人** — 更快的侦察、更广的覆盖、跨项目一致的方法论。CyberStrike 在凌晨三点也不会疲倦。
- **安全团队** — 使用可复现的方法论运行结构化 OWASP 评估。获得符合合规团队理解的标准的报告。
- **安全研究人员** — 使用自定义智能体和 MCP 服务器扩展 CyberStrike。插件系统和 MCP 协议使其成为一个平台，而不仅仅是一个工具。

---

### 参与贡献

CyberStrike 由安全社区构建，为安全社区服务。我们欢迎以下方面的贡献：

- **安全智能体与技能** — 新的攻击方法论、测试模式、漏洞检测
- **MCP 服务器** — 连接新的安全工具和数据源
- **知识库** — WSTG、MASTG、PTES、CIS 方法论指南
- **核心改进** — 性能、用户体验、提供商集成、Bug 修复

提交 PR 前请阅读[贡献指南](./CONTRIBUTING.md)。所有贡献必须遵循项目的[道德使用政策](./CODE_OF_CONDUCT.md) — CyberStrike 仅用于授权安全测试。

---

### 许可证

[AGPL-3.0-only](./LICENSE) — 个人和开源使用免费。商业许可请联系 [contact@cyberstrike.io](mailto:contact@cyberstrike.io)。

---

### MCP Security Suite

CyberStrike is the core platform. These MCP servers extend its capabilities:

| Project                                                                | Domain                                  | Tools                                 |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------- |
| **CyberStrike**                                                        | **Autonomous offensive security agent** | **13+ agents, 120+ OWASP test cases** |
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)         | Browser-based security testing          | 39 tools, Firefox, injection testing  |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | Cloud security (AWS/Azure/GCP)          | 38 tools, 60+ checks                  |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | GitHub security posture                 | 39 tools, 45 checks                   |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | Vulnerability intelligence              | 23 tools, 5 sources                   |
| [osint-mcp](https://github.com/badchars/osint-mcp-server)              | OSINT & reconnaissance                  | 37 tools, 12 sources                  |

---

<p align="center">
  <a href="https://discord.gg/snunAaHf6U"><b>Discord</b></a> · <a href="https://x.com/cyberstrike"><b>X.com</b></a> · <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a>
</p>
<p align="center">
  <sub>由厌倦了在终端之间复制粘贴的黑客构建。</sub>
</p>
