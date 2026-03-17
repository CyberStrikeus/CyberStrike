<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">首個專為攻擊性安全打造的開源 AI 智能體。</h3>

<p align="center">
  在終端機中實現自主滲透測試 — 偵察、漏洞發現、漏洞利用和報告生成。<br>
  一條指令。13+ 專業智能體。120+ OWASP 測試案例。您的 AI 紅隊。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
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

### 為什麼選擇 CyberStrike？

安全測試至今仍以手動操作為主。滲透測試人員需要同時使用數十種工具，在終端機之間複製貼上輸出結果，並在接觸實際攻擊面之前花費數小時進行重複性偵察。漏洞賞金獵人在每個專案上都要重複相同的偵察流程。

**CyberStrike 改變了這一切。** 它是一個理解攻擊性安全方法論的自主 AI 智能體 — 不僅僅是執行工具，而是推理應該測試什麼，將發現串聯起來，並根據發現的內容調整策略。您可以把它想像成終端機中一個不知疲倦的紅隊成員，遵循 OWASP WSTG 方法論，知道何時轉換策略，並在完成後自動撰寫報告。

```bash
npm i -g cyberstrike@latest && cyberstrike
# "對 https://target.com 執行完整的 OWASP WSTG 評估"
```

它是開源的，支援任何 LLM 提供商，所有產出均歸您所有。

---

### 獨特之處

<table>
<tr>
<td width="50%">

**專業安全智能體，而非通用聊天**

CyberStrike 配備了 13+ 個為安全領域專門建構的智能體。每個智能體都攜帶特定領域的方法論、工具知識和測試模式。Web 應用智能體遵循 WSTG。雲端安全智能體了解 CIS 基準。行動端智能體使用 Frida 並遵循 MASTG/MASVS。它們不靠猜測 — 而是遵循經過驗證的框架。

</td>
<td width="50%">

**自主行動，而非僅提供輔助**

其他 AI 工具需要等您告訴它下一步做什麼。CyberStrike 智能體能夠規劃多步攻擊鏈、執行工具、分析結果、在發現有趣內容時靈活轉向，並生成有證據支撐的報告。您設定目標 — 它們負責執行方法論。

</td>
</tr>
<tr>
<td width="50%">

**任意 LLM，無廠商鎖定**

開箱即用支援 15+ 個提供商：Anthropic、OpenAI、Google、Amazon Bedrock、Azure、Groq、Mistral、OpenRouter — 甚至透過 OpenAI 相容端點支援本地模型。使用 Claude、GPT、Gemini 或您自己託管的 LLM 執行。隨著模型變得更強大、更便宜，CyberStrike 也會隨之提升。

</td>
<td width="50%">

**透過 Bolt 遠端執行工具**

您的安全工具不必在筆記型電腦上執行。Bolt 是 CyberStrike 的遠端工具伺服器 — 將它部署在裝有滲透測試工具包的 VPS 上，使用 Ed25519 金鑰配對，然後透過 MCP 協定從本地終端機控制一切。一個 TUI，多台攻擊伺服器。

</td>
</tr>
</table>

---

### 智能體

使用 `Tab` 切換智能體。每個都是某一領域的專家。

| 智能體 | 專注領域 | 功能描述 |
|--------|---------|---------|
| **cyberstrike** | 綜合 | 全權限主智能體 — 偵察、漏洞利用、報告生成 |
| **web-application** | Web | OWASP Top 10、WSTG 方法論、API 安全、工作階段測試 |
| **mobile-application** | 行動端 | Android/iOS、Frida/Objection、MASTG/MASVS 合規 |
| **cloud-security** | 雲端安全 | AWS、Azure、GCP — IAM 設定錯誤、CIS 基準、暴露資源 |
| **internal-network** | 網路 | Active Directory、Kerberos 攻擊、橫向移動、跳板穿透 |

另有 **8 個專業代理測試器**，可攔截和操縱流量以測試特定漏洞類別：

`IDOR` · `授權繞過` · `批量賦值` · `注入` · `認證` · `業務邏輯` · `SSRF` · `檔案攻擊`

---

### MCP 生態系統

CyberStrike 連接專業 MCP 伺服器以擴展其能力：

| 伺服器 | 工具數 | 擴展能力 |
|--------|-------|---------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | 基於瀏覽器的安全測試 — XSS、CSRF、DOM 操縱、Cookie 竊取 |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | 雲端安全稽核 — 涵蓋 AWS、Azure、GCP 的 60+ 項檢查 |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | GitHub 安全態勢 — 儲存庫、組織、Actions、金鑰、供應鏈 |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | CVE 情報 — NVD、EPSS、CISA KEV、GitHub Advisory、OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | OSINT 偵察 — Shodan、VirusTotal、SecurityTrails、Censys、DNS、WHOIS |

全部開源。均可透過 `npx` 安裝。可接入 CyberStrike 使用，也可作為獨立工具搭配任何 MCP 用戶端使用。

---

### 安裝

```bash
# npm / bun / pnpm / yarn
npm i -g cyberstrike@latest

# macOS
brew install CyberStrikeus/tap/cyberstrike

# Windows
scoop install cyberstrike

# curl (Linux/macOS)
curl -fsSL https://cyberstrike.io/install | bash
```

**桌面應用程式**（macOS、Windows、Linux）— 從[發佈頁面](https://github.com/CyberStrikeus/CyberStrike/releases)下載，或：

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### 內建工具

CyberStrike 智能體可直接使用 30+ 種工具：

| 類別 | 工具 |
|------|------|
| **執行** | Shell（bash）、檔案讀/寫/編輯、目錄列表 |
| **發現** | 網頁擷取、網路搜尋、程式碼搜尋、glob、grep |
| **安全** | 漏洞報告（HackerOne 格式）、證據收集 |
| **代理** | HTTP/HTTPS 攔截、請求重放、流量分析 |
| **整合** | MCP 伺服器、Bolt 遠端工具、自訂外掛 |

另有**外掛 SDK** — 建構您自己的智能體和工具，執行階段註冊。

---

### 適用對象

- **滲透測試人員** — 自動化重複性工作。讓智能體處理偵察和初始測試，而您專注於需要人類直覺的創造性攻擊鏈。
- **漏洞賞金獵人** — 更快的偵察、更廣的覆蓋、跨專案一致的方法論。CyberStrike 在凌晨三點也不會疲倦。
- **安全團隊** — 使用可重現的方法論執行結構化 OWASP 評估。獲得符合合規團隊理解的標準的報告。
- **安全研究人員** — 使用自訂智能體和 MCP 伺服器擴展 CyberStrike。外掛系統和 MCP 協定使其成為一個平台，而不僅僅是一個工具。

---

### 參與貢獻

CyberStrike 由安全社群建構，為安全社群服務。我們歡迎以下方面的貢獻：

- **安全智能體與技能** — 新的攻擊方法論、測試模式、漏洞偵測
- **MCP 伺服器** — 連接新的安全工具和資料來源
- **知識庫** — WSTG、MASTG、PTES、CIS 方法論指南
- **核心改進** — 效能、使用者體驗、提供商整合、Bug 修復

提交 PR 前請閱讀[貢獻指南](./CONTRIBUTING.md)。所有貢獻必須遵循專案的[道德使用政策](./CODE_OF_CONDUCT.md) — CyberStrike 僅用於授權安全測試。

---

### 授權條款

[AGPL-3.0-only](./LICENSE) — 個人和開源使用免費。商業授權請聯繫 [contact@cyberstrike.io](mailto:contact@cyberstrike.io)。

---

<p align="center">
  <a href="https://discord.gg/snunAaHf6U"><b>Discord</b></a> · <a href="https://x.com/cyberstrike"><b>X.com</b></a> · <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a>
</p>
<p align="center">
  <sub>由厭倦了在終端機之間複製貼上的駭客建構。</sub>
</p>
