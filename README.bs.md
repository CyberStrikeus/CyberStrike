<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>AI platforma za autonomne ofanzivne sigurnosne agente.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Licenca" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### Šta je CyberStrike?

CyberStrike je open-source, autonomni ofanzivni sigurnosni agent koji radi u vašem terminalu. Dolazi sa 13+ specijaliziranih sigurnosnih agenata, 120+ OWASP test slučajeva i podržava 15+ LLM provajdera. Usmjerite ga na cilj, a on obavlja izviđanje, otkrivanje ranjivosti i generisanje izvještaja — sve iz jednog TUI sučelja.

### Mogućnosti

- **13+ sigurnosnih agenata** — Web aplikacije (OWASP WSTG), mobilne aplikacije (MASTG/MASVS), cloud (AWS/Azure/GCP), Active Directory/Kerberos, mreže, te 8 specijaliziranih proxy testera (IDOR, injekcije, SSRF, zaobilaženje autorizacije i više)
- **30+ ugrađenih alata** — Izvršavanje komandi, HTTP zahtjevi, operacije nad datotekama, pretraga koda, web scraping, izvještavanje o ranjivostima
- **Bolt** — Udaljeni server za alate sa MCP protokolom i Ed25519 uparivanjem. Pokrenite sigurnosne alate na udaljenim serverima, kontrolišite ih iz vašeg terminala
- **MCP ekosistem** — Vlastite integracije: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **15+ LLM provajdera** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, lokalni modeli putem OpenAI-kompatibilnih endpointa i više
- **Višestruka sučelja** — TUI (terminal), Web (SolidJS), Desktop (Tauri) — isti engine agenata svugdje
- **LSP podrška** — Integracija Language Server Protocol-a za radne tokove u IDE-u
- **Sistem proširenja** — Kreirajte prilagođene agente i alate pomoću SDK-a za proširenja

### Instalacija

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

### Brzi početak

```bash
# Pokrenite CyberStrike
cyberstrike

# Odaberite vašeg LLM provajdera pri prvom pokretanju, zatim:
# "Pokreni potpunu OWASP WSTG procjenu na https://target.com"
```

### Agenti

Prebacujte se između agenata pritiskom na `Tab` u TUI-ju.

| Agent | Domena | Opis |
|-------|--------|------|
| **cyberstrike** | Opći | Zadani ofanzivni sigurnosni agent sa punim pristupom |
| **web-application** | Web | OWASP Top 10, WSTG metodologija, API sigurnost |
| **mobile-application** | Mobilne | Android/iOS testiranje, Frida, MASTG/MASVS |
| **cloud-security** | Cloud | AWS, Azure, GCP, IAM, CIS mjerila |
| **internal-network** | Mreža | Active Directory, Kerberos, lateralno kretanje |

Plus 8 specijaliziranih **proxy tester** agenata za ciljane klase ranjivosti: IDOR, autorizacija, masovno dodjeljivanje, injekcije, autentifikacija, poslovna logika, SSRF i napadi na datoteke.

### Desktop aplikacija

Dostupna za macOS, Windows i Linux. Preuzmite sa [stranice izdanja](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Dokumentacija

- [Dokumentacija](https://cyberstrike.io/docs)
- [Doprinos projektu](./CONTRIBUTING.md)
- [Kodeks ponašanja](./CODE_OF_CONDUCT.md)

### Licenca

[AGPL-3.0-only](./LICENSE) — Komercijalno licenciranje dostupno putem [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
