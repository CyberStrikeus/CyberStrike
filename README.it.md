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

<h3 align="center">Il primo agente IA open-source progettato per la sicurezza offensiva.</h3>

<p align="center">
  Pentesting autonomo dal tuo terminale — ricognizione, scoperta di vulnerabilit&agrave;, sfruttamento e reportistica.<br>
  Un comando. 13+ agenti specializzati. 120+ casi di test OWASP. Il tuo red team IA.
</p>

<p align="center">
  <a href="#perché-cyberstrike">Perch&eacute; CyberStrike?</a> &bull;
  <a href="#cosa-lo-rende-diverso">Cosa Lo Rende Diverso</a> &bull;
  <a href="#agenti">Agenti</a> &bull;
  <a href="#ecosistema-mcp">Ecosistema MCP</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#installazione">Installazione</a> &bull;
  <a href="#strumenti-integrati">Strumenti Integrati</a> &bull;
  <a href="#a-chi-è-rivolto">A Chi &Egrave; Rivolto?</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Licenza" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

---

### Perch&eacute; CyberStrike?

I test di sicurezza sono ancora in gran parte manuali. I pentester si destreggiano tra decine di strumenti, copiano e incollano output tra terminali e passano ore in ricognizioni ripetitive prima di toccare la superficie d'attacco reale. I bug bounty hunter perdono tempo con lo stesso flusso di ricognizione per ogni programma.

**CyberStrike cambia tutto questo.** &Egrave; un agente IA autonomo che comprende la metodologia della sicurezza offensiva — non si limita a eseguire strumenti, ma ragiona su cosa testare, concatena le scoperte e adatta il proprio approccio in base a ci&ograve; che trova. Immaginalo come un membro instancabile del red team nel tuo terminale che segue OWASP WSTG, sa quando cambiare rotta e scrive il report quando ha finito.

```bash
npm i -g cyberstrike@latest && cyberstrike
# "Esegui una valutazione completa OWASP WSTG su https://target.com"
```

&Egrave; open source, funziona con qualsiasi provider LLM e tutto ci&ograve; che produce &egrave; tuo.

---

### Cosa Lo Rende Diverso

<table>
<tr>
<td width="50%">

**Agenti di Sicurezza Specializzati, Non Chat Generiche**

CyberStrike include 13+ agenti progettati specificamente per domini di sicurezza. Ogni agente possiede metodologie specifiche del dominio, conoscenza degli strumenti e modelli di test. L'agente web-application segue WSTG. L'agente cloud-security conosce i benchmark CIS. L'agente mobile utilizza Frida e segue MASTG/MASVS. Non improvvisano — seguono framework collaudati.

</td>
<td width="50%">

**Autonomo, Non Solo Assistivo**

Altri strumenti IA aspettano che tu dica loro cosa fare dopo. Gli agenti CyberStrike pianificano catene d'attacco multi-fase, eseguono strumenti, analizzano i risultati, cambiano rotta quando trovano qualcosa di interessante e generano report supportati da prove. Tu definisci l'obiettivo — loro gestiscono la metodologia.

</td>
</tr>
<tr>
<td width="50%">

**Qualsiasi LLM, Nessun Vendor Lock-in**

15+ provider pronti all'uso: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — anche modelli locali tramite endpoint compatibili con OpenAI. Usalo con Claude, GPT, Gemini o il tuo LLM self-hosted. Man mano che i modelli migliorano e diventano pi&ugrave; economici, CyberStrike migliora con loro.

</td>
<td width="50%">

**Esecuzione Remota degli Strumenti con Bolt**

I tuoi strumenti di sicurezza non devono necessariamente girare sul tuo portatile. Bolt &egrave; il server remoto di CyberStrike — installalo su un VPS con il tuo toolkit di pentesting, associalo con chiavi Ed25519 e controlla tutto dal tuo terminale locale tramite protocollo MCP. Una TUI, pi&ugrave; server d'attacco.

</td>
</tr>
</table>

---

### Agenti

Passa da un agente all'altro con `Tab`. Ognuno &egrave; uno specialista.

| Agente | Ambito | Cosa Fa |
|--------|--------|---------|
| **cyberstrike** | Generale | Agente principale con accesso completo — ricognizione, sfruttamento, reportistica |
| **web-application** | Web | OWASP Top 10, metodologia WSTG, sicurezza API, test delle sessioni |
| **mobile-application** | Mobile | Android/iOS, Frida/Objection, conformit&agrave; MASTG/MASVS |
| **cloud-security** | Cloud | AWS, Azure, GCP — errori di configurazione IAM, benchmark CIS, risorse esposte |
| **internal-network** | Rete | Active Directory, attacchi Kerberos, movimento laterale, pivoting |

Inoltre **8 proxy tester specializzati** che intercettano e manipolano il traffico per classi di vulnerabilit&agrave; mirate:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### Ecosistema MCP

CyberStrike si connette a server MCP specializzati che ne estendono le capacit&agrave;:

| Server | Strumenti | Cosa Aggiunge |
|--------|-----------|---------------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | Test di sicurezza basati su browser — XSS, CSRF, manipolazione DOM, furto di cookie |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | Audit di sicurezza cloud — 60+ controlli su AWS, Azure, GCP |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | Postura di sicurezza GitHub — repository, organizzazione, actions, secrets, supply chain |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | Intelligence CVE — NVD, EPSS, CISA KEV, GitHub Advisory, OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | Ricognizione OSINT — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS |

Tutti open source. Tutti installabili con `npx`. Collegali a CyberStrike o usali autonomamente con qualsiasi client MCP.

---

### Bolt

Bolt &egrave; il server di esecuzione remota degli strumenti di CyberStrike. Invece di eseguire strumenti di sicurezza sul tuo portatile, distribuiscili su un VPS (o pi&ugrave;) e controlla tutto dal tuo terminale locale.

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**Come funziona:**
- Distribuisci Bolt su qualsiasi server con il tuo toolkit di pentesting installato
- Associa con chiavi Ed25519 — nessuna password, nessun segreto condiviso
- Gli agenti CyberStrike chiamano gli strumenti da remoto tramite protocollo MCP
- I risultati vengono trasmessi in tempo reale alla tua TUI locale
- Gestisci le connessioni dalla TUI: aggiungi, rimuovi, monitora lo stato

**Perch&eacute; &egrave; importante:** La tua superficie d'attacco rimane su infrastruttura dedicata. Esegui scansioni pesanti da un VPS con maggiore larghezza di banda, mantieni i tuoi strumenti aggiornati in un unico punto e passa da un server d'attacco all'altro da un singolo terminale.

---

### Installazione

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

**App desktop** (macOS, Windows, Linux) — scaricala dalla [pagina delle release](https://github.com/CyberStrikeus/CyberStrike/releases) oppure:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Strumenti Integrati

Gli agenti CyberStrike hanno accesso diretto a 30+ strumenti:

| Categoria | Strumenti |
|-----------|-----------|
| **Esecuzione** | Shell (bash), lettura/scrittura/modifica file, elenco directory |
| **Scoperta** | Web fetch, ricerca web, ricerca codice, glob, grep |
| **Sicurezza** | Segnalazione vulnerabilit&agrave; (formato HackerOne), raccolta prove |
| **Proxy** | Intercettazione HTTP/HTTPS, replay richieste, analisi del traffico |
| **Integrazione** | Server MCP, strumenti remoti Bolt, plugin personalizzati |

Inoltre un **SDK per plugin** — crea i tuoi agenti e strumenti, registrali a runtime.

---

### A Chi &Egrave; Rivolto?

- **Pentester** — Automatizza le parti ripetitive. Lascia che gli agenti gestiscano la ricognizione e i test iniziali mentre tu ti concentri sulle catene d'attacco creative che richiedono intuizione umana.
- **Bug Bounty Hunter** — Ricognizione pi&ugrave; veloce, copertura pi&ugrave; ampia, metodologia coerente tra i programmi. CyberStrike non si stanca alle 3 di notte.
- **Team di Sicurezza** — Esegui valutazioni OWASP strutturate con metodologia riproducibile. Ottieni report mappati sugli standard che il tuo team di conformit&agrave; comprende.
- **Ricercatori di Sicurezza** — Estendi CyberStrike con agenti personalizzati e server MCP. Il sistema di plugin e il protocollo MCP lo rendono una piattaforma, non solo uno strumento.

---

### Contribuire

CyberStrike &egrave; costruito dalla comunit&agrave; della sicurezza, per la comunit&agrave; della sicurezza. Accogliamo contributi in:

- **Agenti e competenze di sicurezza** — Nuove metodologie d'attacco, modelli di test, rilevamento vulnerabilit&agrave;
- **Server MCP** — Connessione a nuovi strumenti di sicurezza e fonti di dati
- **Base di conoscenza** — Guide metodologiche WSTG, MASTG, PTES, CIS
- **Miglioramenti al core** — Prestazioni, UX, integrazioni provider, correzione bug

Leggi la [Guida ai Contributi](./CONTRIBUTING.md) prima di inviare una PR. Tutti i contributi devono rispettare la [politica di uso etico](./CODE_OF_CONDUCT.md) del progetto — CyberStrike &egrave; destinato esclusivamente a test di sicurezza autorizzati.

---

### Licenza

[AGPL-3.0-only](./LICENSE) — Gratuito per uso personale e open source. Licenza commerciale disponibile tramite [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

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
  <sub>Creato da hacker stanchi di copiare e incollare tra terminali.</sub>
</p>
