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

<h3 align="center">Der erste Open-Source-KI-Agent fuer offensive Sicherheit.</h3>

<p align="center">
  Autonomes Pentesting direkt aus Ihrem Terminal — Aufklaerung, Schwachstellenerkennung, Exploitation und Berichterstellung.<br>
  Ein Befehl. 13+ spezialisierte Agenten. 120+ OWASP-Testfaelle. Ihr KI-Red-Team.
</p>

<p align="center">
  <a href="#warum-cyberstrike">Warum CyberStrike?</a> &bull;
  <a href="#was-macht-es-anders">Was macht es anders?</a> &bull;
  <a href="#agenten">Agenten</a> &bull;
  <a href="#mcp-oekosystem">MCP-Oekosystem</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#integrierte-werkzeuge">Integrierte Werkzeuge</a> &bull;
  <a href="#fuer-wen-ist-das">Fuer wen ist das?</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyberstrike-io/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/@cyberstrike-io/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Lizenz" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

---

### Warum CyberStrike?

Sicherheitstests sind immer noch ueberwiegend manuell. Pentester jonglieren mit Dutzenden von Werkzeugen, kopieren Ausgaben zwischen Terminals hin und her und verbringen Stunden mit sich wiederholender Aufklaerung, bevor sie die eigentliche Angriffsflaeche ueberhaupt beruehren. Bug-Bounty-Jaeger verschwenden Zeit mit dem immer gleichen Aufklaerungsworkflow fuer jedes Programm.

**CyberStrike aendert das.** Es ist ein autonomer KI-Agent, der offensive Sicherheitsmethodik versteht — er fuehrt nicht nur Werkzeuge aus, sondern denkt darueber nach, was getestet werden muss, verkettet Ergebnisse miteinander und passt seinen Ansatz basierend auf seinen Entdeckungen an. Stellen Sie sich ein unermüdliches Red-Team-Mitglied in Ihrem Terminal vor — es folgt OWASP WSTG, weiss, wann es umschwenken muss, und schreibt den Bericht, wenn es fertig ist.

```bash
npm i -g @cyberstrike-io/cyberstrike@latest && cyberstrike
# "Fuehre eine vollstaendige OWASP-WSTG-Bewertung auf https://ziel.com durch"
```

Es ist quelloffen, funktioniert mit jedem LLM-Anbieter, und alles, was es produziert, gehoert Ihnen.

---

### Was macht es anders?

<table>
<tr>
<td width="50%">

**Spezialisierte Sicherheitsagenten, kein allgemeiner Chat**

CyberStrike wird mit 13+ Agenten ausgeliefert, die speziell fuer Sicherheitsdomaenen entwickelt wurden. Jeder Agent traegt domaenenspezifische Methodik, Werkzeugwissen und Testmuster in sich. Der Webanwendungsagent folgt WSTG. Der Cloud-Sicherheitsagent kennt CIS-Benchmarks. Der Mobile-Agent nutzt Frida und folgt MASTG/MASVS. Sie raten nicht — sie wenden bewaehrte Frameworks an.

</td>
<td width="50%">

**Autonom, nicht nur unterstuetzend**

Andere KI-Werkzeuge warten darauf, dass Sie ihnen sagen, was als Naechstes zu tun ist. CyberStrike-Agenten planen mehrstufige Angriffsketten, fuehren Werkzeuge aus, analysieren Ergebnisse, schwenken um, wenn sie etwas Interessantes finden, und erstellen beweisgestuetzte Berichte. Sie legen das Ziel fest — die Agenten uebernehmen die Methodik.

</td>
</tr>
<tr>
<td width="50%">

**Jedes LLM, keine Abhaengigkeit**

15+ Anbieter sofort einsatzbereit: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — sogar lokale Modelle ueber OpenAI-kompatible Endpunkte. Betreiben Sie es mit Claude, GPT, Gemini oder Ihrem eigenen selbst gehosteten LLM. Wenn Modelle besser und guenstiger werden, wird CyberStrike mit ihnen besser.

</td>
<td width="50%">

**Remote-Werkzeugausfuehrung mit Bolt**

Ihre Sicherheitswerkzeuge muessen nicht auf Ihrem Laptop laufen. Bolt ist CyberStrikes Remote-Werkzeugserver — stellen Sie ihn auf einem VPS mit Ihrem Pentest-Toolkit bereit, koppeln Sie ihn mit Ed25519-Schluesseln und steuern Sie alles von Ihrem lokalen Terminal ueber das MCP-Protokoll. Eine Oberflaeche, mehrere Angriffsserver.

</td>
</tr>
</table>

---

### Agenten

Wechseln Sie mit `Tab` zwischen Agenten. Jeder ist ein Spezialist.

| Agent                  | Fokus     | Was er tut                                                                       |
| ---------------------- | --------- | -------------------------------------------------------------------------------- |
| **cyberstrike**        | Allgemein | Primaerer Agent mit Vollzugriff — Aufklaerung, Exploitation, Berichterstellung   |
| **web-application**    | Web       | OWASP Top 10, WSTG-Methodik, API-Sicherheit, Sitzungstests                       |
| **mobile-application** | Mobil     | Android/iOS, Frida/Objection, MASTG/MASVS-Konformitaet                           |
| **cloud-security**     | Cloud     | AWS, Azure, GCP — IAM-Fehlkonfigurationen, CIS-Benchmarks, exponierte Ressourcen |
| **internal-network**   | Netzwerk  | Active Directory, Kerberos-Angriffe, laterale Bewegung, Pivoting                 |

Plus **8 spezialisierte Proxy-Tester**, die Datenverkehr abfangen und manipulieren fuer gezielte Schwachstellenklassen:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### MCP-Oekosystem

CyberStrike verbindet sich mit spezialisierten MCP-Servern, die seine Faehigkeiten erweitern:

| Server                                                                 | Werkzeuge | Was er hinzufuegt                                                                |
| ---------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------- |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | 38        | Cloud-Sicherheitsaudits — 60+ Pruefungen ueber AWS, Azure, GCP                   |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39        | GitHub-Sicherheitsstatus — Repo, Org, Actions, Secrets, Lieferkette              |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | 23        | CVE-Informationen — NVD, EPSS, CISA KEV, GitHub Advisory, OSV                    |
| [osint-mcp](https://github.com/badchars/osint-mcp)                     | 37        | OSINT-Aufklaerung — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS       |

Alle quelloffen. Alle installierbar mit `npx`. Verbinden Sie sie mit CyberStrike oder nutzen Sie sie eigenstaendig mit jedem MCP-Client.

---

### Bolt

Bolt ist CyberStrikes Server fuer die Remote-Werkzeugausfuehrung. Anstatt Sicherheitswerkzeuge auf Ihrem Laptop auszufuehren, stellen Sie sie auf einem VPS (oder mehreren) bereit und steuern alles von Ihrem lokalen Terminal aus.

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**So funktioniert es:**

- Stellen Sie Bolt auf jedem Server mit Ihrem installierten Pentest-Toolkit bereit
- Koppeln Sie mit Ed25519-Schluesseln — keine Passwoerter, keine geteilten Geheimnisse
- CyberStrike-Agenten rufen Werkzeuge remote ueber das MCP-Protokoll auf
- Ergebnisse werden in Echtzeit an Ihr lokales TUI gestreamt
- Verwalten Sie Verbindungen ueber das TUI: hinzufuegen, entfernen, Status ueberwachen

**Warum das wichtig ist:** Ihre Angriffsflaeche bleibt auf dedizierter Infrastruktur. Fuehren Sie umfangreiche Scans von einem VPS mit besserer Bandbreite aus, halten Sie Ihre Werkzeuge an einem Ort aktuell und wechseln Sie von einem einzigen Terminal zwischen mehreren Angriffsservern.

---

### Installation

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

**Desktop-Anwendung** (macOS, Windows, Linux) — laden Sie sie von der [Releases-Seite](https://github.com/CyberStrikeus/CyberStrike/releases) herunter oder:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Integrierte Werkzeuge

CyberStrike-Agenten haben direkten Zugriff auf 30+ Werkzeuge:

| Kategorie       | Werkzeuge                                                               |
| --------------- | ----------------------------------------------------------------------- |
| **Ausfuehrung** | Shell (bash), Dateien lesen/schreiben/bearbeiten, Verzeichnisauflistung |
| **Entdeckung**  | Web-Abruf, Websuche, Codesuche, Glob, Grep                              |
| **Sicherheit**  | Schwachstellenberichte (HackerOne-Format), Beweissicherung              |
| **Proxy**       | HTTP/HTTPS-Abfangen, Anfragenwiederholung, Verkehrsanalyse              |
| **Integration** | MCP-Server, Bolt-Remote-Werkzeuge, benutzerdefinierte Plugins           |

Plus ein **Plugin-SDK** — erstellen Sie eigene Agenten und Werkzeuge und registrieren Sie sie zur Laufzeit.

---

### Fuer wen ist das?

- **Pentester** — Automatisieren Sie die sich wiederholenden Aufgaben. Lassen Sie Agenten Aufklaerung und erste Tests uebernehmen, waehrend Sie sich auf die kreativen Angriffsketten konzentrieren, die menschliche Intuition erfordern.
- **Bug-Bounty-Jaeger** — Schnellere Aufklaerung, breitere Abdeckung, konsistente Methodik ueber alle Programme. CyberStrike wird um 3 Uhr morgens nicht muede.
- **Sicherheitsteams** — Fuehren Sie strukturierte OWASP-Bewertungen mit reproduzierbarer Methodik durch. Erhalten Sie Berichte, die Standards entsprechen, die Ihr Compliance-Team versteht.
- **Sicherheitsforscher** — Erweitern Sie CyberStrike mit benutzerdefinierten Agenten und MCP-Servern. Das Plugin-System und das MCP-Protokoll machen es zu einer Plattform, nicht nur zu einem Werkzeug.

---

### Mitwirken

CyberStrike wird von der Sicherheits-Community fuer die Sicherheits-Community gebaut. Wir freuen uns ueber Beitraege in folgenden Bereichen:

- **Sicherheitsagenten und Faehigkeiten** — Neue Angriffsmethoden, Testmuster, Schwachstellenerkennung
- **MCP-Server** — Neue Sicherheitswerkzeuge und Datenquellen anbinden
- **Wissensdatenbank** — WSTG-, MASTG-, PTES-, CIS-Methodikleitfaeden
- **Kernverbesserungen** — Leistung, Benutzererfahrung, Anbieterintegrationen, Fehlerbehebungen

Lesen Sie den [Beitragsleitfaden](./CONTRIBUTING.md), bevor Sie einen PR einreichen. Alle Beitraege muessen der [Richtlinie zur ethischen Nutzung](./CODE_OF_CONDUCT.md) des Projekts entsprechen — CyberStrike ist ausschliesslich fuer autorisierte Sicherheitstests bestimmt.

---

### Lizenz

[AGPL-3.0-only](./LICENSE) — Kostenlos fuer persoenliche und Open-Source-Nutzung. Kommerzielle Lizenzierung verfuegbar ueber [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

### MCP Security Suite

CyberStrike is the core platform. These MCP servers extend its capabilities:

| Project                                                                | Domain                                  | Tools                                 |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------- |
| **CyberStrike**                                                        | **Autonomous offensive security agent** | **13+ agents, 120+ OWASP test cases** |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | Cloud security (AWS/Azure/GCP)          | 38 tools, 60+ checks                  |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | GitHub security posture                 | 39 tools, 45 checks                   |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | Vulnerability intelligence              | 23 tools, 5 sources                   |
| [osint-mcp](https://github.com/badchars/osint-mcp-server)              | OSINT & reconnaissance                  | 37 tools, 12 sources                  |

---

<p align="center">
  <a href="https://discord.gg/snunAaHf6U"><b>Discord</b></a> · <a href="https://x.com/cyberstrike"><b>X.com</b></a> · <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a>
</p>
<p align="center">
  <sub>Gebaut von Hackern, die es satt hatten, zwischen Terminals hin und her zu kopieren.</sub>
</p>
