<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>Platforma agentow ofensywnego bezpieczenstwa oparta na sztucznej inteligencji.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Licencja" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### Czym jest CyberStrike?

CyberStrike to otwartoźródłowa, autonomiczna platforma agentów ofensywnego bezpieczeństwa działająca w terminalu. Zawiera ponad 13 wyspecjalizowanych agentów bezpieczeństwa, ponad 120 przypadków testowych OWASP i współpracuje z ponad 15 dostawcami LLM. Wystarczy wskazać cel, a CyberStrike zajmie się rekonesansem, odkrywaniem podatności i generowaniem raportów — wszystko z poziomu jednego interfejsu TUI.

### Funkcje

- **Ponad 13 agentów bezpieczeństwa** — Aplikacje webowe (OWASP WSTG), mobilne (MASTG/MASVS), chmurowe (AWS/Azure/GCP), Active Directory/Kerberos, sieciowe oraz 8 wyspecjalizowanych testerów proxy (IDOR, wstrzykiwanie, SSRF, omijanie uwierzytelniania i więcej)
- **Ponad 30 wbudowanych narzędzi** — Wykonywanie poleceń shell, żądania HTTP, operacje na plikach, przeszukiwanie kodu, web scraping, raportowanie podatności
- **Bolt** — Zdalny serwer narzędzi z protokołem MCP i parowaniem Ed25519. Uruchamiaj narzędzia bezpieczeństwa na zdalnych serwerach i kontroluj je ze swojego terminala
- **Ekosystem MCP** — Autorskie integracje: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **Ponad 15 dostawców LLM** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, modele lokalne przez endpointy kompatybilne z OpenAI i więcej
- **Wiele interfejsów** — TUI (terminal), Web (SolidJS), Desktop (Tauri) — ten sam silnik agentów wszędzie
- **Obsługa LSP** — Integracja z protokołem Language Server dla przepływów pracy opartych na IDE
- **System wtyczek** — Twórz własnych agentów i narzędzia za pomocą SDK wtyczek

### Instalacja

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

### Szybki start

```bash
# Uruchom CyberStrike
cyberstrike

# Wybierz swojego dostawcę LLM przy pierwszym uruchomieniu, a następnie:
# "Przeprowadź pełną ocenę OWASP WSTG na https://target.com"
```

### Agenci

Przełączaj się między agentami klawiszem `Tab` w TUI.

| Agent | Dziedzina | Opis |
|-------|-----------|------|
| **cyberstrike** | Ogólny | Domyślny agent ofensywnego bezpieczeństwa z pełnym dostępem |
| **web-application** | Web | OWASP Top 10, metodologia WSTG, bezpieczeństwo API |
| **mobile-application** | Mobilne | Testowanie Android/iOS, Frida, MASTG/MASVS |
| **cloud-security** | Chmura | AWS, Azure, GCP, IAM, benchmarki CIS |
| **internal-network** | Sieć | Active Directory, Kerberos, ruch boczny |

Dodatkowo 8 wyspecjalizowanych agentów **proxy tester** dla konkretnych klas podatności: IDOR, autoryzacja, masowe przypisywanie, wstrzykiwanie, uwierzytelnianie, logika biznesowa, SSRF i ataki na pliki.

### Aplikacja desktopowa

Dostępna na macOS, Windows i Linux. Pobierz ze [strony wydań](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Dokumentacja

- [Dokumentacja](https://cyberstrike.io/docs)
- [Współtworzenie](./CONTRIBUTING.md)
- [Kodeks postępowania](./CODE_OF_CONDUCT.md)

### Licencja

[AGPL-3.0-only](./LICENSE) — Licencja komercyjna dostępna przez [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
