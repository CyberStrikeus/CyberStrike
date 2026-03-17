<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>Plataforma de agentes de seguridad ofensiva impulsada por IA.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Licencia" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### Que es CyberStrike?

CyberStrike es un agente de seguridad ofensiva autonomo y de codigo abierto que se ejecuta en tu terminal. Incluye mas de 13 agentes de seguridad especializados, mas de 120 casos de prueba OWASP y funciona con mas de 15 proveedores de LLM. Apuntalo a un objetivo y se encarga del reconocimiento, descubrimiento de vulnerabilidades y generacion de informes — todo desde una unica TUI.

### Caracteristicas

- **13+ Agentes de Seguridad** — Aplicacion web (OWASP WSTG), movil (MASTG/MASVS), nube (AWS/Azure/GCP), Active Directory/Kerberos, red, y 8 testers proxy especializados (IDOR, inyeccion, SSRF, evasion de autenticacion y mas)
- **30+ Herramientas Integradas** — Ejecucion de shell, solicitudes HTTP, operaciones de archivos, busqueda de codigo, scraping web, reportes de vulnerabilidades
- **Bolt** — Servidor de herramientas remoto con protocolo MCP y emparejamiento Ed25519. Ejecuta herramientas de seguridad en servidores remotos, controlalas desde tu terminal
- **Ecosistema MCP** — Integraciones de primera parte: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **15+ Proveedores de LLM** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, modelos locales a traves de endpoints compatibles con OpenAI y mas
- **Multi-Interfaz** — TUI (terminal), Web (SolidJS), Escritorio (Tauri) — el mismo motor de agentes en todas partes
- **Soporte LSP** — Integracion del protocolo de servidor de lenguaje para flujos de trabajo basados en IDE
- **Sistema de Plugins** — Crea agentes y herramientas personalizados con el SDK de plugins

### Instalacion

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

### Inicio Rapido

```bash
# Iniciar CyberStrike
cyberstrike

# Selecciona tu proveedor de LLM en la primera ejecucion, luego:
# "Ejecutar una evaluacion OWASP WSTG completa en https://objetivo.com"
```

### Agentes

Cambia entre agentes con `Tab` en la TUI.

| Agente | Dominio | Descripcion |
|--------|---------|-------------|
| **cyberstrike** | General | Agente de seguridad ofensiva por defecto con acceso completo |
| **web-application** | Web | OWASP Top 10, metodologia WSTG, seguridad de API |
| **mobile-application** | Movil | Pruebas Android/iOS, Frida, MASTG/MASVS |
| **cloud-security** | Nube | AWS, Azure, GCP, IAM, benchmarks CIS |
| **internal-network** | Red | Active Directory, Kerberos, movimiento lateral |

Ademas, 8 agentes **testers proxy** especializados para clases de vulnerabilidades especificas: IDOR, autorizacion, asignacion masiva, inyeccion, autenticacion, logica de negocio, SSRF y ataques de archivos.

### Aplicacion de Escritorio

Disponible para macOS, Windows y Linux. Descarga desde la [pagina de versiones](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Documentacion

- [Documentacion](https://cyberstrike.io/docs)
- [Contribuir](./CONTRIBUTING.md)
- [Codigo de Conducta](./CODE_OF_CONDUCT.md)

### Licencia

[AGPL-3.0-only](./LICENSE) — Licencia comercial disponible a traves de [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
