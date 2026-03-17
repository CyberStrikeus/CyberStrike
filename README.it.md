<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>Piattaforma di agenti per la sicurezza offensiva basata sull'intelligenza artificiale.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Licenza" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### Cos'e CyberStrike?

CyberStrike e una piattaforma open-source di agenti autonomi per la sicurezza offensiva che funziona direttamente nel terminale. Include oltre 13 agenti di sicurezza specializzati, oltre 120 casi di test OWASP e supporta oltre 15 provider LLM. Basta indicare un obiettivo e CyberStrike gestisce ricognizione, scoperta delle vulnerabilita e generazione dei report, il tutto da un'unica interfaccia TUI.

### Funzionalita

- **Oltre 13 agenti di sicurezza** — Applicazioni web (OWASP WSTG), mobile (MASTG/MASVS), cloud (AWS/Azure/GCP), Active Directory/Kerberos, rete e 8 tester proxy specializzati (IDOR, iniezione, SSRF, bypass dell'autenticazione e altro)
- **Oltre 30 strumenti integrati** — Esecuzione shell, richieste HTTP, operazioni sui file, ricerca nel codice, web scraping, segnalazione delle vulnerabilita
- **Bolt** — Server remoto per strumenti con protocollo MCP e associazione Ed25519. Esegui strumenti di sicurezza su server remoti e controllali dal tuo terminale
- **Ecosistema MCP** — Integrazioni proprietarie: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **Oltre 15 provider LLM** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, modelli locali tramite endpoint compatibili con OpenAI e altro
- **Interfacce multiple** — TUI (terminale), Web (SolidJS), Desktop (Tauri) — lo stesso motore di agenti ovunque
- **Supporto LSP** — Integrazione con il protocollo Language Server per flussi di lavoro basati su IDE
- **Sistema di plugin** — Crea agenti e strumenti personalizzati con l'SDK per plugin

### Installazione

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

### Avvio rapido

```bash
# Avvia CyberStrike
cyberstrike

# Seleziona il tuo provider LLM al primo avvio, poi:
# "Esegui una valutazione completa OWASP WSTG su https://target.com"
```

### Agenti

Passa da un agente all'altro con `Tab` nella TUI.

| Agente | Ambito | Descrizione |
|--------|--------|-------------|
| **cyberstrike** | Generale | Agente predefinito per la sicurezza offensiva con accesso completo |
| **web-application** | Web | OWASP Top 10, metodologia WSTG, sicurezza delle API |
| **mobile-application** | Mobile | Test Android/iOS, Frida, MASTG/MASVS |
| **cloud-security** | Cloud | AWS, Azure, GCP, IAM, benchmark CIS |
| **internal-network** | Rete | Active Directory, Kerberos, movimento laterale |

Inoltre 8 agenti **proxy tester** specializzati per classi di vulnerabilita mirate: IDOR, autorizzazione, assegnazione di massa, iniezione, autenticazione, logica di business, SSRF e attacchi ai file.

### Applicazione desktop

Disponibile per macOS, Windows e Linux. Scaricala dalla [pagina delle release](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Documentazione

- [Documentazione](https://cyberstrike.io/docs)
- [Contribuire](./CONTRIBUTING.md)
- [Codice di condotta](./CODE_OF_CONDUCT.md)

### Licenza

[AGPL-3.0-only](./LICENSE) — Licenza commerciale disponibile tramite [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
