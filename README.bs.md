<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">Prvi AI agent otvorenog koda napravljen za ofanzivnu sigurnost.</h3>

<p align="center">
  Autonomno testiranje proboja iz vašeg terminala — izviđanje, otkrivanje ranjivosti, eksploatacija i izvještavanje.<br>
  Jedna komanda. 13+ specijalizovanih agenata. 120+ OWASP test slučajeva. Vaš AI crveni tim.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
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

### Zašto CyberStrike?

Sigurnosno testiranje je i dalje pretežno ručno. Pentesteri žongliraju s desetinama alata, kopiraju i lijepe rezultate između terminala i provode sate na repetitivnom izviđanju prije nego što uopšte dotaknu stvarnu površinu napada. Lovci na bugove troše vrijeme na isti recon tok rada za svaki program.

**CyberStrike to mijenja.** To je autonomni AI agent koji razumije metodologiju ofanzivne sigurnosti — ne samo pokretanje alata, već razmišljanje o tome šta testirati, povezivanje nalaza i prilagođavanje pristupa na osnovu onoga što otkrije. Zamislite ga kao neumornog člana crvenog tima u vašem terminalu koji slijedi OWASP WSTG, zna kada promijeniti pravac i napiše izvještaj kad završi.

```bash
npm i -g cyberstrike@latest && cyberstrike
# "Pokreni potpunu OWASP WSTG procjenu na https://cilj.com"
```

Otvorenog je koda, radi s bilo kojim LLM provajderom i vi posjedujete sve što proizvede.

---

### Po čemu se razlikuje

<table>
<tr>
<td width="50%">

**Specijalizovani sigurnosni agenti, ne generički chat**

CyberStrike dolazi s 13+ agenata posebno napravljenih za sigurnosne domene. Svaki agent nosi specifičnu metodologiju, poznavanje alata i obrasce testiranja. Agent za web aplikacije slijedi WSTG. Agent za sigurnost oblaka poznaje CIS standarde. Mobilni agent koristi Frida i slijedi MASTG/MASVS. Ne pogađaju — slijede provjerene okvire.

</td>
<td width="50%">

**Autonoman, ne samo pomoćni**

Drugi AI alati čekaju da im kažete šta dalje da rade. CyberStrike agenti planiraju višestepene lance napada, pokreću alate, analiziraju rezultate, mijenjaju pravac kada pronađu nešto zanimljivo i generišu izvještaje potkrijepljene dokazima. Vi postavite cilj — oni se pobrinu za metodologiju.

</td>
</tr>
<tr>
<td width="50%">

**Bilo koji LLM, bez zaključavanja**

15+ provajdera odmah po instalaciji: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — čak i lokalni modeli putem OpenAI-kompatibilnih krajnjih tačaka. Pokrenite ga s Claude, GPT, Gemini ili vlastitim self-hosted LLM-om. Kako modeli postaju bolji i jeftiniji, CyberStrike postaje bolji s njima.

</td>
<td width="50%">

**Udaljeno izvršavanje alata pomoću Bolt-a**

Vaši sigurnosni alati ne moraju raditi na vašem laptopu. Bolt je CyberStrike-ov server za udaljene alate — postavite ga na VPS s vašim pentest alatima, uparite ga pomoću Ed25519 ključeva i kontrolišite sve iz lokalnog terminala putem MCP protokola. Jedan TUI, više napadačkih servera.

</td>
</tr>
</table>

---

### Agenti

Prebacujte se između agenata pomoću `Tab`. Svaki je specijalista.

| Agent | Fokus | Šta radi |
|-------|-------|----------|
| **cyberstrike** | Opšte | Primarni agent s punim pristupom — izviđanje, eksploatacija, izvještavanje |
| **web-application** | Web | OWASP Top 10, WSTG metodologija, sigurnost API-ja, testiranje sesija |
| **mobile-application** | Mobilno | Android/iOS, Frida/Objection, MASTG/MASVS usklađenost |
| **cloud-security** | Oblak | AWS, Azure, GCP — IAM pogrešne konfiguracije, CIS standardi, izloženi resursi |
| **internal-network** | Mreža | Active Directory, Kerberos napadi, lateralno kretanje, pivotiranje |

Plus **8 specijalizovanih proxy testera** koji presreću i manipulišu saobraćajem za ciljane klase ranjivosti:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### MCP ekosistem

CyberStrike se povezuje sa specijalizovanim MCP serverima koji proširuju njegove mogućnosti:

| Server | Alati | Šta dodaje |
|--------|-------|------------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | Sigurnosno testiranje putem preglednika — XSS, CSRF, DOM manipulacija, krađa kolačića |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | Sigurnosni auditi oblaka — 60+ provjera za AWS, Azure, GCP |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | GitHub sigurnosni položaj — repozitorij, organizacija, akcije, tajne, lanac snabdijevanja |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | CVE obavještajna služba — NVD, EPSS, CISA KEV, GitHub Advisory, OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | OSINT izviđanje — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS |

Sve je otvorenog koda. Sve se može instalirati pomoću `npx`. Povežite ih s CyberStrike-om ili koristite samostalno s bilo kojim MCP klijentom.

---

### Instalacija

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

**Desktop aplikacija** (macOS, Windows, Linux) — preuzmite sa [stranice izdanja](https://github.com/CyberStrikeus/CyberStrike/releases) ili:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Ugrađeni alati

CyberStrike agenti imaju direktan pristup za 30+ alata:

| Kategorija | Alati |
|------------|-------|
| **Izvršavanje** | Shell (bash), čitanje/pisanje/uređivanje datoteka, pregled direktorija |
| **Otkrivanje** | Web preuzimanje, web pretraga, pretraga koda, glob, grep |
| **Sigurnost** | Izvještavanje o ranjivostima (HackerOne format), prikupljanje dokaza |
| **Proxy** | HTTP/HTTPS presretanje, ponavljanje zahtjeva, analiza saobraćaja |
| **Integracija** | MCP serveri, Bolt udaljeni alati, prilagođeni dodaci |

Plus **SDK za dodatke** — napravite vlastite agente i alate, registrujte ih tokom izvršavanja.

---

### Kome je ovo namijenjeno?

- **Pentesteri** — Automatizujte repetitivne dijelove. Pustite agente da obave izviđanje i početno testiranje dok se vi fokusirate na kreativne lance napada koji zahtijevaju ljudsku intuiciju.
- **Lovci na bugove** — Brže izviđanje, šira pokrivenost, dosljedna metodologija kroz programe. CyberStrike se ne umara u 3 ujutro.
- **Sigurnosni timovi** — Pokrenite strukturirane OWASP procjene s ponovljivom metodologijom. Dobijte izvještaje koji se mapiraju na standarde koje vaš tim za usklađenost razumije.
- **Sigurnosni istraživači** — Proširite CyberStrike prilagođenim agentima i MCP serverima. Sistem dodataka i MCP protokol ga čine platformom, ne samo alatom.

---

### Doprinos

CyberStrike je napravljen od strane sigurnosne zajednice, za sigurnosnu zajednicu. Pozdravljamo doprinose u sljedećim oblastima:

- **Sigurnosni agenti i vještine** — Nove metodologije napada, obrasci testiranja, detekcija ranjivosti
- **MCP serveri** — Povezivanje novih sigurnosnih alata i izvora podataka
- **Baza znanja** — WSTG, MASTG, PTES, CIS metodološki vodiči
- **Poboljšanja jezgre** — Performanse, korisničko iskustvo, integracije provajdera, ispravke grešaka

Pročitajte [Vodič za doprinos](./CONTRIBUTING.md) prije slanja PR-a. Svi doprinosi moraju slijediti [politiku etičke upotrebe](./CODE_OF_CONDUCT.md) projekta — CyberStrike je isključivo za autorizovano sigurnosno testiranje.

---

### Licenca

[AGPL-3.0-only](./LICENSE) — Besplatno za ličnu upotrebu i projekte otvorenog koda. Komercijalno licenciranje dostupno putem [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/snunAaHf6U"><b>Discord</b></a> · <a href="https://x.com/cyberstrike"><b>X.com</b></a> · <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a>
</p>
<p align="center">
  <sub>Napravili hakeri koji su se umorili od kopiranja i lijepljenja između terminala.</sub>
</p>
