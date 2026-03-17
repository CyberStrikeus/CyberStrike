<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>AI-drevet offensiv sikkerhedsagentplatform.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Licens" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### Hvad er CyberStrike?

CyberStrike er en open source, autonom offensiv sikkerhedsagent, der korer i din terminal. Den leveres med over 13 specialiserede sikkerhedsagenter, over 120 OWASP-testcases og understotter over 15 LLM-udbydere. Peg den mod et mal, og den klarer rekognoscering, sarbarhedsopdagelse og rapportgenerering — alt sammen fra en enkelt TUI.

### Funktioner

- **Over 13 sikkerhedsagenter** — Webapplikationer (OWASP WSTG), mobil (MASTG/MASVS), cloud (AWS/Azure/GCP), Active Directory/Kerberos, netvaerk og 8 specialiserede proxy-testere (IDOR, injektion, SSRF, autentificeringsomgaelse og mere)
- **Over 30 indbyggede vaerktojer** — Shell-eksekvering, HTTP-forespørgsler, filoperationer, kodesøgning, web scraping, sarbarhedsrapportering
- **Bolt** — Fjernvaerktoejsserver med MCP-protokol og Ed25519-parring. Kor sikkerhedsvaerktojer pa fjernservere og styr dem fra din terminal
- **MCP-okosystem** — Forsteparts-integrationer: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **Over 15 LLM-udbydere** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, lokale modeller via OpenAI-kompatible endpoints og mere
- **Flere graeseflader** — TUI (terminal), Web (SolidJS), Desktop (Tauri) — samme agentmotor overalt
- **LSP-understottelse** — Language Server Protocol-integration til IDE-baserede arbejdsgange
- **Pluginsystem** — Byg tilpassede agenter og vaerktojer med plugin-SDK'et

### Installation

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

### Hurtig start

```bash
# Start CyberStrike
cyberstrike

# Vaelg din LLM-udbyder ved forste korsel, derefter:
# "Kor en komplet OWASP WSTG-vurdering pa https://target.com"
```

### Agenter

Skift mellem agenter med `Tab` i TUI'en.

| Agent | Omrade | Beskrivelse |
|-------|--------|-------------|
| **cyberstrike** | Generel | Standardagent med fuld adgang til offensiv sikkerhed |
| **web-application** | Web | OWASP Top 10, WSTG-metodik, API-sikkerhed |
| **mobile-application** | Mobil | Android/iOS-test, Frida, MASTG/MASVS |
| **cloud-security** | Cloud | AWS, Azure, GCP, IAM, CIS-benchmarks |
| **internal-network** | Netvaerk | Active Directory, Kerberos, lateral bevaegelse |

Derudover 8 specialiserede **proxy-tester**-agenter til malsrettede sarbarhedsklasser: IDOR, autorisation, massetildeling, injektion, autentificering, forretningslogik, SSRF og filangreb.

### Desktopapp

Tilgaengelig til macOS, Windows og Linux. Download fra [udgivelsessiden](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Dokumentation

- [Dokumentation](https://cyberstrike.io/docs)
- [Bidrag](./CONTRIBUTING.md)
- [Adfaerdskodeks](./CODE_OF_CONDUCT.md)

### Licens

[AGPL-3.0-only](./LICENSE) — Kommerciel licens tilgaengelig via [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
