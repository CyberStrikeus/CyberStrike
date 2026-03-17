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

<h3 align="center">Le premier agent IA open source concu pour la securite offensive.</h3>

<p align="center">
  Test d'intrusion autonome depuis votre terminal — reconnaissance, decouverte de vulnerabilites, exploitation et rapports.<br>
  Une seule commande. 13+ agents specialises. 120+ cas de test OWASP. Votre red team IA.
</p>

<p align="center">
  <a href="#pourquoi-cyberstrike">Pourquoi CyberStrike ?</a> &bull;
  <a href="#ce-qui-le-differencie">Ce qui le differencie</a> &bull;
  <a href="#agents">Agents</a> &bull;
  <a href="#ecosysteme-mcp">Ecosysteme MCP</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#outils-integres">Outils integres</a> &bull;
  <a href="#a-qui-sadresse-t-il">A qui s'adresse-t-il ?</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Licence" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

---

### Pourquoi CyberStrike ?

Les tests de securite sont encore massivement manuels. Les pentesters jonglent avec des dizaines d'outils, copient-collent des sorties entre terminaux et passent des heures en reconnaissance repetitive avant meme de toucher la surface d'attaque reelle. Les chasseurs de bug bounty perdent du temps sur le meme workflow de reconnaissance pour chaque programme.

**CyberStrike change la donne.** C'est un agent IA autonome qui comprend la methodologie de securite offensive — il ne se contente pas d'executer des outils, il raisonne sur ce qu'il faut tester, enchaine les decouvertes et adapte son approche en fonction de ce qu'il trouve. Imaginez un membre infatigable de votre red team dans votre terminal — il suit OWASP WSTG, sait quand pivoter et redige le rapport quand il a termine.

```bash
npm i -g cyberstrike@latest && cyberstrike
# "Effectuer une evaluation OWASP WSTG complete sur https://cible.com"
```

C'est open source, compatible avec n'importe quel fournisseur LLM, et tout ce qu'il produit vous appartient.

---

### Ce qui le differencie

<table>
<tr>
<td width="50%">

**Des agents de securite specialises, pas un chat generique**

CyberStrike est livre avec 13+ agents concus specialement pour les domaines de securite. Chaque agent porte une methodologie specifique au domaine, une connaissance des outils et des schemas de test. L'agent d'application web suit le WSTG. L'agent de securite cloud connait les benchmarks CIS. L'agent mobile utilise Frida et suit MASTG/MASVS. Ils ne devinent pas — ils appliquent des frameworks eprouves.

</td>
<td width="50%">

**Autonome, pas seulement assistant**

Les autres outils IA attendent que vous leur disiez quoi faire ensuite. Les agents CyberStrike planifient des chaines d'attaque multi-etapes, executent les outils, analysent les resultats, pivotent quand ils trouvent quelque chose d'interessant et generent des rapports etayes par des preuves. Vous definissez l'objectif — ils gerent la methodologie.

</td>
</tr>
<tr>
<td width="50%">

**N'importe quel LLM, aucune dependance**

15+ fournisseurs prets a l'emploi : Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — meme des modeles locaux via des endpoints compatibles OpenAI. Utilisez-le avec Claude, GPT, Gemini ou votre propre LLM auto-heberge. A mesure que les modeles s'ameliorent et deviennent moins chers, CyberStrike s'ameliore avec eux.

</td>
<td width="50%">

**Execution d'outils a distance avec Bolt**

Vos outils de securite n'ont pas besoin de tourner sur votre ordinateur portable. Bolt est le serveur d'outils distant de CyberStrike — deployez-le sur un VPS avec votre boite a outils de pentest, associez-le avec des cles Ed25519 et controlez tout depuis votre terminal local via le protocole MCP. Une seule interface, plusieurs serveurs d'attaque.

</td>
</tr>
</table>

---

### Agents

Basculez entre les agents avec `Tab`. Chacun est un specialiste.

| Agent | Domaine | Ce qu'il fait |
|-------|---------|---------------|
| **cyberstrike** | General | Agent principal avec acces complet — reconnaissance, exploitation, rapports |
| **web-application** | Web | OWASP Top 10, methodologie WSTG, securite des API, tests de session |
| **mobile-application** | Mobile | Android/iOS, Frida/Objection, conformite MASTG/MASVS |
| **cloud-security** | Cloud | AWS, Azure, GCP — erreurs de configuration IAM, benchmarks CIS, ressources exposees |
| **internal-network** | Reseau | Active Directory, attaques Kerberos, mouvement lateral, pivotement |

Plus **8 testeurs proxy specialises** qui interceptent et manipulent le trafic pour des classes de vulnerabilites ciblees :

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### Ecosysteme MCP

CyberStrike se connecte a des serveurs MCP specialises qui etendent ses capacites :

| Serveur | Outils | Ce qu'il ajoute |
|---------|--------|-----------------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | Tests de securite bases sur le navigateur — XSS, CSRF, manipulation DOM, vol de cookies |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | Audits de securite cloud — 60+ verifications sur AWS, Azure, GCP |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | Posture de securite GitHub — repo, org, actions, secrets, chaine d'approvisionnement |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | Renseignements CVE — NVD, EPSS, CISA KEV, GitHub Advisory, OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | Reconnaissance OSINT — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS |

Tous open source. Tous installables avec `npx`. Branchez-les sur CyberStrike ou utilisez-les de maniere autonome avec n'importe quel client MCP.

---

### Bolt

Bolt est le serveur d'execution d'outils a distance de CyberStrike. Au lieu d'executer des outils de securite sur votre ordinateur portable, deployez-les sur un VPS (ou plusieurs) et controlez tout depuis votre terminal local.

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**Comment ca marche :**
- Deployez Bolt sur n'importe quel serveur avec votre boite a outils de pentest installee
- Associez avec des cles Ed25519 — pas de mots de passe, pas de secrets partages
- Les agents CyberStrike appellent les outils a distance via le protocole MCP
- Les resultats sont transmis en temps reel a votre TUI local
- Gerez les connexions depuis le TUI : ajouter, supprimer, surveiller le statut

**Pourquoi c'est important :** Votre surface d'attaque reste sur une infrastructure dediee. Lancez des scans lourds depuis un VPS avec une meilleure bande passante, gardez vos outils a jour en un seul endroit, et basculez entre plusieurs serveurs d'attaque depuis un seul terminal.

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

**Application de bureau** (macOS, Windows, Linux) — telechargez depuis la [page des versions](https://github.com/CyberStrikeus/CyberStrike/releases) ou :

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Outils integres

Les agents CyberStrike ont un acces direct a 30+ outils :

| Categorie | Outils |
|-----------|--------|
| **Execution** | Shell (bash), lecture/ecriture/edition de fichiers, listage de repertoires |
| **Decouverte** | Recuperation web, recherche web, recherche de code, glob, grep |
| **Securite** | Rapports de vulnerabilites (format HackerOne), collecte de preuves |
| **Proxy** | Interception HTTP/HTTPS, rejeu de requetes, analyse de trafic |
| **Integration** | Serveurs MCP, outils distants Bolt, plugins personnalises |

Plus un **SDK de plugins** — creez vos propres agents et outils, enregistrez-les au moment de l'execution.

---

### A qui s'adresse-t-il ?

- **Pentesters** — Automatisez les taches repetitives. Laissez les agents gerer la reconnaissance et les tests initiaux pendant que vous vous concentrez sur les chaines d'attaque creatives qui necessitent l'intuition humaine.
- **Chasseurs de Bug Bounty** — Reconnaissance plus rapide, couverture plus large, methodologie coherente entre les programmes. CyberStrike ne fatigue pas a 3 heures du matin.
- **Equipes de securite** — Executez des evaluations OWASP structurees avec une methodologie reproductible. Obtenez des rapports alignes sur les standards que votre equipe de conformite comprend.
- **Chercheurs en securite** — Etendez CyberStrike avec des agents personnalises et des serveurs MCP. Le systeme de plugins et le protocole MCP en font une plateforme, pas simplement un outil.

---

### Contribuer

CyberStrike est construit par la communaute de securite, pour la communaute de securite. Nous accueillons les contributions dans les domaines suivants :

- **Agents et competences de securite** — Nouvelles methodologies d'attaque, schemas de test, detection de vulnerabilites
- **Serveurs MCP** — Connecter de nouveaux outils de securite et sources de donnees
- **Base de connaissances** — Guides methodologiques WSTG, MASTG, PTES, CIS
- **Ameliorations du noyau** — Performances, experience utilisateur, integrations de fournisseurs, corrections de bugs

Lisez le [guide de contribution](./CONTRIBUTING.md) avant de soumettre une PR. Toutes les contributions doivent respecter la [politique d'utilisation ethique](./CODE_OF_CONDUCT.md) du projet — CyberStrike est destine exclusivement aux tests de securite autorises.

---

### Licence

[AGPL-3.0-only](./LICENSE) — Gratuit pour un usage personnel et open source. Licence commerciale disponible via [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

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
  <sub>Construit par des hackers fatigues de copier-coller entre les terminaux.</sub>
</p>
