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

<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">Den første AI-agenten med åpen kildekode bygget for offensiv sikkerhet.</h3>

<p align="center">
  Autonom penetrasjonstesting fra terminalen din — rekognosering, sårbarhetsfunn, utnyttelse og rapportering.<br>
  Én kommando. 13+ spesialiserte agenter. 120+ OWASP-testtilfeller. Ditt AI røde team.
</p>

<p align="center">
  <a href="#hvorfor-cyberstrike">Hvorfor CyberStrike?</a> &bull;
  <a href="#hva-gjør-det-annerledes">Hva gjør det annerledes</a> &bull;
  <a href="#agenter">Agenter</a> &bull;
  <a href="#mcp-økosystemet">MCP-økosystemet</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#installasjon">Installasjon</a> &bull;
  <a href="#innebygde-verktøy">Innebygde verktøy</a> &bull;
  <a href="#hvem-er-dette-for">Hvem er dette for?</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyberstrike-io/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/@cyberstrike-io/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Lisens" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

---

### Hvorfor CyberStrike?

Sikkerhetstesting er fortsatt overveldende manuelt. Penetrasjonstestere sjonglerer med dusinvis av verktøy, kopierer og limer inn resultater mellom terminaler, og bruker timer på repetitiv rekognosering før de i det hele tatt berører den faktiske angrepsflaten. Belønningsjegere kaster bort tid på den samme recon-arbeidsflyten for hvert program.

**CyberStrike endrer det.** Det er en autonom AI-agent som forstår offensiv sikkerhetsmetodikk — ikke bare å kjøre verktøy, men å resonnere om hva som bør testes, lenke funn sammen og tilpasse tilnærmingen basert på hva den oppdager. Tenk på det som et utrettelig rødt team-medlem i terminalen din som følger OWASP WSTG, vet når det skal skifte retning, og skriver rapporten når det er ferdig.

```bash
npm i -g @cyberstrike-io/cyberstrike@latest && cyberstrike
# "Kjør en full OWASP WSTG-vurdering på https://mål.com"
```

Det er åpen kildekode, fungerer med enhver LLM-leverandør, og du eier alt det produserer.

---

### Hva gjør det annerledes

<table>
<tr>
<td width="50%">

**Spesialiserte sikkerhetsagenter, ikke generisk chat**

CyberStrike leveres med 13+ agenter skreddersydd for sikkerhetsdomener. Hver agent har domenespesifikk metodikk, verktøykunnskap og testmønstre. Webapplikasjonsagenten følger WSTG. Skysikkerhetsagenten kjenner CIS-referansene. Mobilagenten bruker Frida og følger MASTG/MASVS. De gjetter ikke — de følger velprøvde rammeverk.

</td>
<td width="50%">

**Autonom, ikke bare assisterende**

Andre AI-verktøy venter på at du skal fortelle dem hva de skal gjøre videre. CyberStrike-agenter planlegger flertrinns angrepskjeder, kjører verktøy, analyserer resultater, skifter retning når de finner noe interessant, og genererer bevisbaserte rapporter. Du setter målet — de håndterer metodikken.

</td>
</tr>
<tr>
<td width="50%">

**Hvilken som helst LLM, ingen innlåsing**

15+ leverandører rett ut av boksen: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — til og med lokale modeller gjennom OpenAI-kompatible endepunkter. Kjør det med Claude, GPT, Gemini eller din egen selvhostede LLM. Ettersom modeller blir bedre og billigere, blir CyberStrike bedre med dem.

</td>
<td width="50%">

**Ekstern verktøykjøring med Bolt**

Sikkerhetsverktøyene dine trenger ikke å kjøre på laptopen din. Bolt er CyberStrikes eksterne verktøyserver — distribuer den på en VPS med pentest-verktøysettet ditt, par den med Ed25519-nøkler, og kontroller alt fra din lokale terminal over MCP-protokollen. Ett TUI, flere angrepsservere.

</td>
</tr>
</table>

---

### Agenter

Bytt mellom agenter med `Tab`. Hver enkelt er en spesialist.

| Agent                  | Fokus    | Hva den gjør                                                                    |
| ---------------------- | -------- | ------------------------------------------------------------------------------- |
| **cyberstrike**        | Generelt | Primæragent med full tilgang — rekognosering, utnyttelse, rapportering          |
| **web-application**    | Web      | OWASP Top 10, WSTG-metodikk, API-sikkerhet, sesjonstesting                      |
| **mobile-application** | Mobil    | Android/iOS, Frida/Objection, MASTG/MASVS-samsvar                               |
| **cloud-security**     | Sky      | AWS, Azure, GCP — IAM-feilkonfigurasjoner, CIS-referanser, eksponerte ressurser |
| **internal-network**   | Nettverk | Active Directory, Kerberos-angrep, lateral bevegelse, pivotering                |

Pluss **8 spesialiserte proxy-testere** som fanger opp og manipulerer trafikk for målrettede sårbarhetsklasser:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### MCP-økosystemet

CyberStrike kobler til spesialiserte MCP-servere som utvider funksjonaliteten:

| Server                                                                 | Verktøy | Hva den legger til                                                                         |
| ---------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)         | 39      | Nettleserbasert sikkerhetstesting — XSS, CSRF, DOM-manipulering, informasjonskapsel-tyveri |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | 38      | Skysikkerhetsrevisjoner — 60+ sjekker på tvers av AWS, Azure, GCP                          |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39      | GitHub sikkerhetsposisjon — repo, organisasjon, handlinger, hemmeligheter, forsyningskjede |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | 23      | CVE-etterretning — NVD, EPSS, CISA KEV, GitHub Advisory, OSV                               |
| [osint-mcp](https://github.com/badchars/osint-mcp)                     | 37      | OSINT-rekognosering — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS               |

Alt er åpen kildekode. Alt kan installeres med `npx`. Koble dem til CyberStrike eller bruk dem frittstående med en hvilken som helst MCP-klient.

---

### Bolt

Bolt er CyberStrikes server for ekstern verktøykjøring. I stedet for å kjøre sikkerhetsverktøy på laptopen din, distribuer dem på en VPS (eller flere) og kontroller alt fra din lokale terminal.

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**Slik fungerer det:**

- Distribuer Bolt på en hvilken som helst server med pentest-verktøysettet ditt installert
- Par med Ed25519-nøkler — ingen passord, ingen delte hemmeligheter
- CyberStrike-agenter kaller verktøy eksternt over MCP-protokollen
- Resultater strømmes tilbake til ditt lokale TUI i sanntid
- Administrer tilkoblinger fra TUI-et: legg til, fjern, overvåk status

**Hvorfor det er viktig:** Angrepsflaten din forblir på dedikert infrastruktur. Kjør tunge skanninger fra en VPS med bedre båndbredde, hold verktøyene oppdatert på ett sted, og bytt mellom flere angrepsservere fra én terminal.

---

### Installasjon

```bash
# npm / bun / pnpm / yarn
npm i -g @cyberstrike-io/cyberstrike@latest

# macOS
brew install CyberStrikeus/tap/cyberstrike

# Windows
scoop install cyberstrike

# curl (Linux/macOS)
curl -fsSL https://cyberstrike.io/install | bash
```

**Skrivebordsapp** (macOS, Windows, Linux) — last ned fra [utgivelsessiden](https://github.com/CyberStrikeus/CyberStrike/releases) eller:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Innebygde verktøy

CyberStrike-agenter har direkte tilgang til 30+ verktøy:

| Kategori        | Verktøy                                                       |
| --------------- | ------------------------------------------------------------- |
| **Kjøring**     | Shell (bash), fillesing/-skriving/-redigering, katalogvisning |
| **Oppdagelse**  | Webhenting, websøk, kodesøk, glob, grep                       |
| **Sikkerhet**   | Sårbarhetsrapportering (HackerOne-format), bevisinnsamling    |
| **Proxy**       | HTTP/HTTPS-avlytting, forespørselsreplay, trafikkanalyse      |
| **Integrasjon** | MCP-servere, Bolt eksterne verktøy, tilpassede utvidelser     |

Pluss en **utvidelsespakke (SDK)** — bygg dine egne agenter og verktøy, registrer dem under kjøring.

---

### Hvem er dette for?

- **Penetrasjonstestere** — Automatiser de repetitive delene. La agentene håndtere rekognosering og innledende testing mens du fokuserer på de kreative angrepskjedene som krever menneskelig intuisjon.
- **Belønningsjegere** — Raskere rekognosering, bredere dekning, konsistent metodikk på tvers av programmer. CyberStrike blir ikke sliten klokken 3 om natten.
- **Sikkerhetsteam** — Kjør strukturerte OWASP-vurderinger med reproduserbar metodikk. Få rapporter som kartlegges til standarder samsvarssteamet ditt forstår.
- **Sikkerhetsforskere** — Utvid CyberStrike med tilpassede agenter og MCP-servere. Utvidelsessystemet og MCP-protokollen gjør det til en plattform, ikke bare et verktøy.

---

### Bidrag

CyberStrike er bygget av sikkerhetsmiljøet, for sikkerhetsmiljøet. Vi ønsker bidrag velkommen på tvers av:

- **Sikkerhetsagenter og ferdigheter** — Nye angrepsmetodikker, testmønstre, sårbarhetsdeteksjon
- **MCP-servere** — Koble til nye sikkerhetsverktøy og datakilder
- **Kunnskapsbase** — WSTG-, MASTG-, PTES-, CIS-metodikkguider
- **Kjerneforbedringer** — Ytelse, brukeropplevelse, leverandørintegrasjoner, feilrettinger

Les [bidragsguiden](./CONTRIBUTING.md) før du sender en PR. Alle bidrag må følge prosjektets [retningslinjer for etisk bruk](./CODE_OF_CONDUCT.md) — CyberStrike er kun for autorisert sikkerhetstesting.

---

### Lisens

[AGPL-3.0-only](./LICENSE) — Gratis for personlig bruk og åpen kildekode. Kommersiell lisensiering tilgjengelig via [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

### MCP Security Suite

CyberStrike is the core platform. These MCP servers extend its capabilities:

| Project                                                                | Domain                                  | Tools                                 |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------- |
| **CyberStrike**                                                        | **Autonomous offensive security agent** | **13+ agents, 120+ OWASP test cases** |
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)         | Browser-based security testing          | 39 tools, Firefox, injection testing  |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | Cloud security (AWS/Azure/GCP)          | 38 tools, 60+ checks                  |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | GitHub security posture                 | 39 tools, 45 checks                   |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | Vulnerability intelligence              | 23 tools, 5 sources                   |
| [osint-mcp](https://github.com/badchars/osint-mcp-server)              | OSINT & reconnaissance                  | 37 tools, 12 sources                  |

---

<p align="center">
  <a href="https://discord.gg/snunAaHf6U"><b>Discord</b></a> · <a href="https://x.com/cyberstrike"><b>X.com</b></a> · <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a>
</p>
<p align="center">
  <sub>Bygget av hackere som ble lei av å kopiere og lime mellom terminaler.</sub>
</p>
