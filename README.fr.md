<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>Plateforme d'agents de securite offensive propulsee par l'IA.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Licence" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### Qu'est-ce que CyberStrike ?

CyberStrike est un agent de securite offensive autonome et open source qui s'execute dans votre terminal. Il est fourni avec plus de 13 agents de securite specialises, plus de 120 cas de test OWASP, et fonctionne avec plus de 15 fournisseurs LLM. Pointez-le vers une cible, et il s'occupe de la reconnaissance, de la decouverte de vulnerabilites et de la generation de rapports — le tout depuis une seule TUI.

### Fonctionnalites

- **13+ Agents de Securite** — Application web (OWASP WSTG), mobile (MASTG/MASVS), cloud (AWS/Azure/GCP), Active Directory/Kerberos, reseau, et 8 testeurs proxy specialises (IDOR, injection, SSRF, contournement d'authentification, et plus)
- **30+ Outils Integres** — Execution shell, requetes HTTP, operations sur fichiers, recherche de code, scraping web, rapports de vulnerabilites
- **Bolt** — Serveur d'outils distant avec protocole MCP et appairage Ed25519. Executez des outils de securite sur des serveurs distants, controlez-les depuis votre terminal
- **Ecosysteme MCP** — Integrations de premiere partie : [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **15+ Fournisseurs LLM** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, modeles locaux via des points de terminaison compatibles OpenAI, et plus
- **Multi-Interface** — TUI (terminal), Web (SolidJS), Bureau (Tauri) — le meme moteur d'agent partout
- **Support LSP** — Integration du protocole de serveur de langage pour les flux de travail bases sur un IDE
- **Systeme de Plugins** — Creez des agents et des outils personnalises avec le SDK de plugins

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

### Demarrage Rapide

```bash
# Lancer CyberStrike
cyberstrike

# Selectionnez votre fournisseur LLM au premier lancement, puis :
# "Effectuer une evaluation OWASP WSTG complete sur https://cible.com"
```

### Agents

Basculez entre les agents avec `Tab` dans la TUI.

| Agent | Domaine | Description |
|-------|---------|-------------|
| **cyberstrike** | General | Agent de securite offensive par defaut avec acces complet |
| **web-application** | Web | OWASP Top 10, methodologie WSTG, securite des API |
| **mobile-application** | Mobile | Tests Android/iOS, Frida, MASTG/MASVS |
| **cloud-security** | Cloud | AWS, Azure, GCP, IAM, benchmarks CIS |
| **internal-network** | Reseau | Active Directory, Kerberos, mouvement lateral |

Plus 8 agents **testeurs proxy** specialises pour des classes de vulnerabilites ciblees : IDOR, autorisation, affectation de masse, injection, authentification, logique metier, SSRF et attaques par fichier.

### Application de Bureau

Disponible pour macOS, Windows et Linux. Telechargement depuis la [page des versions](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Documentation

- [Documentation](https://cyberstrike.io/docs)
- [Contribuer](./CONTRIBUTING.md)
- [Code de Conduite](./CODE_OF_CONDUCT.md)

### Licence

[AGPL-3.0-only](./LICENSE) — Licence commerciale disponible via [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
