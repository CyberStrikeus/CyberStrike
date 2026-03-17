<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">Den f&oslash;rste open source AI-agent bygget til offensiv sikkerhed.</h3>

<p align="center">
  Autonom pentesting fra din terminal — rekognoscering, s&aring;rbarhedsopdagelse, udnyttelse og rapportering.<br>
  &Eacute;n kommando. 13+ specialiserede agenter. 120+ OWASP-testcases. Dit AI red team.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
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

<p align="center">
  <a href="#hvorfor-cyberstrike">Hvorfor CyberStrike?</a> &bull;
  <a href="#hvad-gør-det-anderledes">Hvad G&oslash;r Det Anderledes</a> &bull;
  <a href="#agenter">Agenter</a> &bull;
  <a href="#mcp-økosystem">MCP-&Oslash;kosystem</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#indbyggede-værktøjer">Indbyggede V&aelig;rkt&oslash;jer</a> &bull;
  <a href="#hvem-er-det-til">Hvem Er Det Til?</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

### Hvorfor CyberStrike?

Sikkerhedstest er stadig overvejende manuelt. Pentestere jonglerer med snesevis af v&aelig;rkt&oslash;jer, kopierer og inds&aelig;tter output mellem terminaler og bruger timer p&aring; gentagen rekognoscering, f&oslash;r de overhovedet r&oslash;rer den egentlige angrebsflade. Bug bounty-j&aelig;gere spilder tid p&aring; det samme rekon-workflow for hvert program.

**CyberStrike &aelig;ndrer det.** Det er en autonom AI-agent, der forst&aring;r offensiv sikkerhedsmetodologi — den k&oslash;rer ikke bare v&aelig;rkt&oslash;jer, men r&aelig;sonnerer om hvad der skal testes, k&aelig;der fund sammen og tilpasser sin tilgang baseret p&aring; hvad den opdager. T&aelig;nk p&aring; det som et utr&aelig;tteligt red team-medlem i din terminal, der f&oslash;lger OWASP WSTG, ved hvorn&aring;r man skal skifte retning, og skriver rapporten n&aring;r det er f&aelig;rdigt.

```bash
npm i -g cyberstrike@latest && cyberstrike
# "K&oslash;r en komplet OWASP WSTG-vurdering p&aring; https://target.com"
```

Det er open source, virker med enhver LLM-udbyder, og du ejer alt det producerer.

---

### Hvad G&oslash;r Det Anderledes

<table>
<tr>
<td width="50%">

**Specialiserede Sikkerhedsagenter, Ikke Generisk Chat**

CyberStrike leveres med 13+ agenter, der er m&aring;lrettet bygget til sikkerhedsdom&aelig;ner. Hver agent har dom&aelig;nespecifik metodologi, v&aelig;rkt&oslash;jskendskab og testm&oslash;nstre. Web-application-agenten f&oslash;lger WSTG. Cloud-security-agenten kender CIS-benchmarks. Mobilagenten bruger Frida og f&oslash;lger MASTG/MASVS. De g&aelig;tter ikke — de f&oslash;lger gennempr&oslash;vede frameworks.

</td>
<td width="50%">

**Autonom, Ikke Bare Assisterende**

Andre AI-v&aelig;rkt&oslash;jer venter p&aring;, at du fort&aelig;ller dem hvad de skal g&oslash;re n&aelig;ste gang. CyberStrike-agenter planl&aelig;gger flertrins-angrebsk&aelig;der, udf&oslash;rer v&aelig;rkt&oslash;jer, analyserer resultater, skifter retning n&aring;r de finder noget interessant, og genererer bevisdokumenterede rapporter. Du s&aelig;tter m&aring;let — de h&aring;ndterer metodologien.

</td>
</tr>
<tr>
<td width="50%">

**Enhver LLM, Ingen L&aring;sning**

15+ udbydere direkte fra kassen: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — selv lokale modeller via OpenAI-kompatible endpoints. K&oslash;r det med Claude, GPT, Gemini eller din egen self-hostede LLM. Efterh&aring;nden som modeller bliver bedre og billigere, bliver CyberStrike bedre med dem.

</td>
<td width="50%">

**Fjernek&oslash;rsel af V&aelig;rkt&oslash;jer med Bolt**

Dine sikkerhedsv&aelig;rkt&oslash;jer beh&oslash;ver ikke k&oslash;re p&aring; din b&aelig;rbare. Bolt er CyberStrikes fjernv&aelig;rkt&oslash;jsserver — deploy den p&aring; en VPS med dit pentest-toolkit, par den med Ed25519-n&oslash;gler, og styr alt fra din lokale terminal via MCP-protokol. &Eacute;n TUI, flere angrebsservere.

</td>
</tr>
</table>

---

### Agenter

Skift mellem agenter med `Tab`. Hver enkelt er en specialist.

| Agent | Fokus | Hvad Den G&oslash;r |
|-------|-------|---------------------|
| **cyberstrike** | Generel | Prim&aelig;r agent med fuld adgang — rekognoscering, udnyttelse, rapportering |
| **web-application** | Web | OWASP Top 10, WSTG-metodik, API-sikkerhed, sessionstest |
| **mobile-application** | Mobil | Android/iOS, Frida/Objection, MASTG/MASVS-overensstemmelse |
| **cloud-security** | Cloud | AWS, Azure, GCP — IAM-fejlkonfigurationer, CIS-benchmarks, eksponerede ressourcer |
| **internal-network** | Netv&aelig;rk | Active Directory, Kerberos-angreb, lateral bev&aelig;gelse, pivoting |

Plus **8 specialiserede proxy-testere** der opfanger og manipulerer trafik til m&aring;lrettede s&aring;rbarhedsklasser:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### MCP-&Oslash;kosystem

CyberStrike forbinder til specialiserede MCP-servere, der udvider dets funktionalitet:

| Server | V&aelig;rkt&oslash;jer | Hvad Den Tilf&oslash;jer |
|--------|----------------------|--------------------------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | Browserbaseret sikkerhedstest — XSS, CSRF, DOM-manipulation, cookie-tyveri |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | Cloud-sikkerhedsaudits — 60+ kontroller p&aring; tv&aelig;rs af AWS, Azure, GCP |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | GitHub-sikkerhedsposition — repo, organisation, actions, secrets, supply chain |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | CVE-efterretning — NVD, EPSS, CISA KEV, GitHub Advisory, OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | OSINT-rekognoscering — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS |

Alle open source. Alle installerbare med `npx`. Tilslut dem til CyberStrike eller brug dem selvst&aelig;ndigt med enhver MCP-klient.

---

### Bolt

Bolt er CyberStrikes server til fjerneksekvering af v&aelig;rkt&oslash;jer. I stedet for at k&oslash;re sikkerhedsv&aelig;rkt&oslash;jer p&aring; din b&aelig;rbare, deploy dem p&aring; en VPS (eller flere) og styr alt fra din lokale terminal.

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**S&aring;dan fungerer det:**
- Deploy Bolt p&aring; enhver server med dit pentest-toolkit installeret
- Par med Ed25519-n&oslash;gler — ingen adgangskoder, ingen delte hemmeligheder
- CyberStrike-agenter kalder v&aelig;rkt&oslash;jer eksternt via MCP-protokollen
- Resultater streames tilbage til din lokale TUI i realtid
- Administr&eacute;r forbindelser fra TUI'en: tilf&oslash;j, fjern, overv&aring;g status

**Hvorfor det betyder noget:** Din angrebsflade forbliver p&aring; dedikeret infrastruktur. K&oslash;r tunge scanninger fra en VPS med bedre b&aring;ndbredde, hold dine v&aelig;rkt&oslash;jer opdaterede &eacute;t sted, og skift mellem flere angrebsservere fra &eacute;n terminal.

---

### Installation

```bash
# npm / bun / pnpm / yarn
npm i -g cyberstrike@latest

# macOS
brew install CyberStrikeus/tap/cyberstrike

# Windows
scoop install cyberstrike

# curl (Linux/macOS)
curl -fsSL https://cyberstrike.io/install | bash
```

**Desktop-app** (macOS, Windows, Linux) — download fra [udgivelsessiden](https://github.com/CyberStrikeus/CyberStrike/releases) eller:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Indbyggede V&aelig;rkt&oslash;jer

CyberStrike-agenter har direkte adgang til 30+ v&aelig;rkt&oslash;jer:

| Kategori | V&aelig;rkt&oslash;jer |
|----------|----------------------|
| **Eksekvering** | Shell (bash), fil l&aelig;sning/skrivning/redigering, mappeoversigt |
| **Opdagelse** | Web fetch, webs&oslash;gning, kodes&oslash;gning, glob, grep |
| **Sikkerhed** | S&aring;rbarhedsrapportering (HackerOne-format), bevisindsamling |
| **Proxy** | HTTP/HTTPS-opfangning, anmodningsreplay, trafikanalyse |
| **Integration** | MCP-servere, Bolt-fjernv&aelig;rkt&oslash;jer, tilpassede plugins |

Plus et **plugin-SDK** — byg dine egne agenter og v&aelig;rkt&oslash;jer, registr&eacute;r dem ved k&oslash;rsel.

---

### Hvem Er Det Til?

- **Pentestere** — Automatiser de gentagne dele. Lad agenter h&aring;ndtere rekognoscering og indledende test, mens du fokuserer p&aring; de kreative angrebsk&aelig;der, der kr&aelig;ver menneskelig intuition.
- **Bug Bounty-J&aelig;gere** — Hurtigere rekognoscering, bredere d&aelig;kning, konsistent metodologi p&aring; tv&aelig;rs af programmer. CyberStrike bliver ikke tr&aelig;t kl. 3 om natten.
- **Sikkerhedsteams** — K&oslash;r strukturerede OWASP-vurderinger med reproducerbar metodologi. F&aring; rapporter, der mapper til standarder, som dit compliance-team forst&aring;r.
- **Sikkerhedsforskere** — Udvid CyberStrike med tilpassede agenter og MCP-servere. Pluginsystemet og MCP-protokollen g&oslash;r det til en platform, ikke bare et v&aelig;rkt&oslash;j.

---

### Bidrag

CyberStrike er bygget af sikkerhedsf&aelig;llesskabet, til sikkerhedsf&aelig;llesskabet. Vi byder bidrag velkommen indenfor:

- **Sikkerhedsagenter og f&aelig;rdigheder** — Nye angrebsmetodologier, testm&oslash;nstre, s&aring;rbarhedsdetektion
- **MCP-servere** — Forbind nye sikkerhedsv&aelig;rkt&oslash;jer og datakilder
- **Vidensbase** — WSTG, MASTG, PTES, CIS-metodologiguider
- **Kerneforbedringer** — Ydeevne, UX, udbyderintegrationer, fejlrettelser

L&aelig;s [Bidragsguiden](./CONTRIBUTING.md) f&oslash;r du indsender en PR. Alle bidrag skal overholde projektets [politik for etisk brug](./CODE_OF_CONDUCT.md) — CyberStrike er kun til autoriseret sikkerhedstest.

---

### Licens

[AGPL-3.0-only](./LICENSE) — Gratis til personlig og open source-brug. Kommerciel licens tilg&aelig;ngelig via [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

### MCP Security Suite

CyberStrike is the core platform. These MCP servers extend its capabilities:

| Project | Domain | Tools |
|---|---|---|
| **CyberStrike** | **Autonomous offensive security agent** | **13+ agents, 120+ OWASP test cases** |
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | Browser-based security testing | 39 tools, Firefox, injection testing |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | Cloud security (AWS/Azure/GCP) | 38 tools, 60+ checks |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | GitHub security posture | 39 tools, 45 checks |
| [cve-mcp](https://github.com/badchars/cve-mcp) | Vulnerability intelligence | 23 tools, 5 sources |
| [osint-mcp](https://github.com/badchars/osint-mcp-server) | OSINT & reconnaissance | 37 tools, 12 sources |

---

<p align="center">
  <a href="https://discord.gg/snunAaHf6U"><b>Discord</b></a> · <a href="https://x.com/cyberstrike"><b>X.com</b></a> · <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a>
</p>
<p align="center">
  <sub>Bygget af hackere, der blev tr&aelig;tte af at kopiere og inds&aelig;tte mellem terminaler.</sub>
</p>
