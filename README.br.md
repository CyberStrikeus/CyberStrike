<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>Plataforma de agentes de seguran&ccedil;a ofensiva com intelig&ecirc;ncia artificial.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Licen&ccedil;a" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### O que é o CyberStrike?

CyberStrike é um agente de segurança ofensiva autônomo e de código aberto que roda no seu terminal. Vem com mais de 13 agentes de segurança especializados, mais de 120 casos de teste OWASP e funciona com mais de 15 provedores de LLM. Aponte para um alvo e ele cuida do reconhecimento, descoberta de vulnerabilidades e geração de relatórios — tudo a partir de uma única interface TUI.

### Funcionalidades

- **Mais de 13 agentes de segurança** — Aplicações web (OWASP WSTG), aplicações móveis (MASTG/MASVS), nuvem (AWS/Azure/GCP), Active Directory/Kerberos, rede, além de 8 testadores de proxy especializados (IDOR, injeção, SSRF, bypass de autenticação e mais)
- **Mais de 30 ferramentas integradas** — Execução de comandos, requisições HTTP, operações de arquivo, busca em código, web scraping, relatórios de vulnerabilidades
- **Bolt** — Servidor remoto de ferramentas com protocolo MCP e pareamento Ed25519. Execute ferramentas de segurança em servidores remotos e controle-as pelo seu terminal
- **Ecossistema MCP** — Integrações próprias: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **Mais de 15 provedores de LLM** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, modelos locais via endpoints compatíveis com OpenAI e mais
- **Múltiplas interfaces** — TUI (terminal), Web (SolidJS), Desktop (Tauri) — o mesmo motor de agentes em todos os lugares
- **Suporte a LSP** — Integração com Language Server Protocol para fluxos de trabalho em IDEs
- **Sistema de plugins** — Crie agentes e ferramentas personalizados com o SDK de plugins

### Instalação

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

### Início rápido

```bash
# Inicie o CyberStrike
cyberstrike

# Selecione seu provedor de LLM na primeira execução, depois:
# "Execute uma avaliação OWASP WSTG completa em https://target.com"
```

### Agentes

Alterne entre agentes com `Tab` na TUI.

| Agente | Domínio | Descrição |
|--------|---------|-----------|
| **cyberstrike** | Geral | Agente padrão de segurança ofensiva com acesso total |
| **web-application** | Web | OWASP Top 10, metodologia WSTG, segurança de APIs |
| **mobile-application** | Móvel | Testes Android/iOS, Frida, MASTG/MASVS |
| **cloud-security** | Nuvem | AWS, Azure, GCP, IAM, benchmarks CIS |
| **internal-network** | Rede | Active Directory, Kerberos, movimentação lateral |

Mais 8 agentes **testadores de proxy** especializados para classes específicas de vulnerabilidades: IDOR, autorização, atribuição em massa, injeção, autenticação, lógica de negócio, SSRF e ataques a arquivos.

### Aplicativo desktop

Disponível para macOS, Windows e Linux. Baixe na [página de releases](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Documentação

- [Documentação](https://cyberstrike.io/docs)
- [Contribuição](./CONTRIBUTING.md)
- [Código de Conduta](./CODE_OF_CONDUCT.md)

### Licença

[AGPL-3.0-only](./LICENSE) — Licenciamento comercial disponível via [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
