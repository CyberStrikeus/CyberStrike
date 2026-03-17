<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>AI-drevet plattform for offensive sikkerhetsagenter.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Lisens" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### Hva er CyberStrike?

CyberStrike er en open source, autonom offensiv sikkerhetsagent som kjorer i terminalen din. Den leveres med 13+ spesialiserte sikkerhetsagenter, 120+ OWASP-testtilfeller, og stotter 15+ LLM-leverandorer. Pek den mot et mal, sa tar den seg av rekognosering, sarbarhetsfunn og rapportgenerering — alt fra ett enkelt TUI-grensesnitt.

### Funksjoner

- **13+ sikkerhetsagenter** — Webapplikasjoner (OWASP WSTG), mobilapplikasjoner (MASTG/MASVS), sky (AWS/Azure/GCP), Active Directory/Kerberos, nettverk, samt 8 spesialiserte proxy-testere (IDOR, injeksjon, SSRF, autentiseringsomgaelse og mer)
- **30+ innebygde verktoy** — Kommandokjoring, HTTP-foresporsler, filoperasjoner, kodesok, web-scraping, sarbarhetsrapportering
- **Bolt** — Ekstern verktoyserver med MCP-protokoll og Ed25519-paring. Kjor sikkerhetsverktoy pa eksterne servere, kontroller dem fra terminalen din
- **MCP-okosystem** — Forsteparts integrasjoner: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **15+ LLM-leverandorer** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, lokale modeller via OpenAI-kompatible endepunkter og mer
- **Flere grensesnitt** — TUI (terminal), Web (SolidJS), Desktop (Tauri) — samme agentmotor overalt
- **LSP-stotte** — Language Server Protocol-integrasjon for IDE-baserte arbeidsflyter
- **Utvidelsessystem** — Bygg egendefinerte agenter og verktoy med SDK-et for utvidelser

### Installasjon

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

### Hurtigstart

```bash
# Start CyberStrike
cyberstrike

# Velg LLM-leverandoren din ved forste kjoring, deretter:
# "Kjor en fullstendig OWASP WSTG-vurdering pa https://target.com"
```

### Agenter

Bytt mellom agenter med `Tab` i TUI-en.

| Agent | Omrade | Beskrivelse |
|-------|--------|-------------|
| **cyberstrike** | Generell | Standard offensiv sikkerhetsagent med full tilgang |
| **web-application** | Web | OWASP Top 10, WSTG-metodikk, API-sikkerhet |
| **mobile-application** | Mobil | Android/iOS-testing, Frida, MASTG/MASVS |
| **cloud-security** | Sky | AWS, Azure, GCP, IAM, CIS-referanseverdier |
| **internal-network** | Nettverk | Active Directory, Kerberos, lateral bevegelse |

I tillegg 8 spesialiserte **proxy-tester**-agenter for malrettede sarbarhetsklasser: IDOR, autorisasjon, massetilordning, injeksjon, autentisering, forretningslogikk, SSRF og filbaserte angrep.

### Desktop-app

Tilgjengelig for macOS, Windows og Linux. Last ned fra [utgivelsessiden](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Dokumentasjon

- [Dokumentasjon](https://cyberstrike.io/docs)
- [Bidra](./CONTRIBUTING.md)
- [Atferdskodeks](./CODE_OF_CONDUCT.md)

### Lisens

[AGPL-3.0-only](./LICENSE) — Kommersiell lisensiering tilgjengelig via [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
