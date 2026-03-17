<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>KI-gesteuerte Plattform fuer offensive Sicherheitsagenten.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Lizenz" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### Was ist CyberStrike?

CyberStrike ist ein quelloffener, autonomer offensiver Sicherheitsagent, der in Ihrem Terminal laeuft. Er wird mit ueber 13 spezialisierten Sicherheitsagenten, ueber 120 OWASP-Testfaellen geliefert und unterstuetzt ueber 15 LLM-Anbieter. Richten Sie ihn auf ein Ziel, und er uebernimmt Aufklaerung, Schwachstellenerkennung und Berichterstellung — alles ueber eine einzige TUI.

### Funktionen

- **13+ Sicherheitsagenten** — Webanwendung (OWASP WSTG), Mobil (MASTG/MASVS), Cloud (AWS/Azure/GCP), Active Directory/Kerberos, Netzwerk und 8 spezialisierte Proxy-Tester (IDOR, Injection, SSRF, Authentifizierungsumgehung und mehr)
- **30+ Integrierte Werkzeuge** — Shell-Ausfuehrung, HTTP-Anfragen, Dateioperationen, Codesuche, Web-Scraping, Schwachstellenberichte
- **Bolt** — Remote-Tool-Server mit MCP-Protokoll und Ed25519-Pairing. Fuehren Sie Sicherheitswerkzeuge auf entfernten Servern aus und steuern Sie diese von Ihrem Terminal
- **MCP-Oekosystem** — Erstanbieter-Integrationen: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **15+ LLM-Anbieter** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, lokale Modelle ueber OpenAI-kompatible Endpunkte und mehr
- **Mehrere Oberflaechen** — TUI (Terminal), Web (SolidJS), Desktop (Tauri) — ueberall dieselbe Agenten-Engine
- **LSP-Unterstuetzung** — Language-Server-Protokoll-Integration fuer IDE-basierte Workflows
- **Plugin-System** — Erstellen Sie benutzerdefinierte Agenten und Werkzeuge mit dem Plugin-SDK

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

### Schnellstart

```bash
# CyberStrike starten
cyberstrike

# Waehlen Sie beim ersten Start Ihren LLM-Anbieter, dann:
# "Fuehre eine vollstaendige OWASP WSTG-Bewertung auf https://ziel.com durch"
```

### Agenten

Wechseln Sie in der TUI mit `Tab` zwischen Agenten.

| Agent | Bereich | Beschreibung |
|-------|---------|--------------|
| **cyberstrike** | Allgemein | Standard-Agent mit vollem Zugriff fuer offensive Sicherheit |
| **web-application** | Web | OWASP Top 10, WSTG-Methodik, API-Sicherheit |
| **mobile-application** | Mobil | Android/iOS-Tests, Frida, MASTG/MASVS |
| **cloud-security** | Cloud | AWS, Azure, GCP, IAM, CIS-Benchmarks |
| **internal-network** | Netzwerk | Active Directory, Kerberos, laterale Bewegung |

Zusaetzlich 8 spezialisierte **Proxy-Tester**-Agenten fuer gezielte Schwachstellenklassen: IDOR, Autorisierung, Massenzuweisung, Injection, Authentifizierung, Geschaeftslogik, SSRF und Dateiangriffe.

### Desktop-Anwendung

Verfuegbar fuer macOS, Windows und Linux. Download von der [Releases-Seite](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Dokumentation

- [Dokumentation](https://cyberstrike.io/docs)
- [Mitwirken](./CONTRIBUTING.md)
- [Verhaltenskodex](./CODE_OF_CONDUCT.md)

### Lizenz

[AGPL-3.0-only](./LICENSE) — Kommerzielle Lizenzierung verfuegbar ueber [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
