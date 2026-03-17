<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">Pierwszy open-source'owy agent AI stworzony do ofensywnego bezpieczeństwa.</h3>

<p align="center">
  Autonomiczne pentesty z Twojego terminala — rekonesans, odkrywanie podatności, eksploatacja i raportowanie.<br>
  Jedna komenda. 13+ wyspecjalizowanych agentów. 120+ przypadków testowych OWASP. Twój red team AI.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
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

### Dlaczego CyberStrike?

Testy bezpieczeństwa wciąż są w przeważającej mierze ręczne. Pentesterzy żonglują dziesiątkami narzędzi, kopiują i wklejają wyniki między terminalami i spędzają godziny na powtarzalnym rekonesansie, zanim dotkną właściwej powierzchni ataku. Łowcy bug bounty tracą czas na ten sam workflow rekonesansowy dla każdego programu.

**CyberStrike to zmienia.** To autonomiczny agent AI, który rozumie metodologię ofensywnego bezpieczeństwa — nie tylko uruchamia narzędzia, ale rozumuje o tym, co testować, łączy odkrycia ze sobą i dostosowuje swoje podejście na podstawie tego, co znajdzie. Wyobraź sobie niezmordowanego członka red teamu w Twoim terminalu, który stosuje OWASP WSTG, wie kiedy zmienić kierunek i pisze raport, gdy skończy.

```bash
npm i -g cyberstrike@latest && cyberstrike
# "Przeprowadź pełną ocenę OWASP WSTG na https://target.com"
```

Jest open source, działa z dowolnym dostawcą LLM, a wszystko co wyprodukuje, należy do Ciebie.

---

### Co Go Wyróżnia

<table>
<tr>
<td width="50%">

**Wyspecjalizowani Agenci Bezpieczeństwa, Nie Generyczny Czat**

CyberStrike zawiera 13+ agentów celowo zbudowanych dla domen bezpieczeństwa. Każdy agent posiada specyficzną dla domeny metodologię, znajomość narzędzi i wzorce testowania. Agent web-application stosuje WSTG. Agent cloud-security zna benchmarki CIS. Agent mobilny używa Frida i stosuje MASTG/MASVS. Nie zgadują — stosują sprawdzone frameworki.

</td>
<td width="50%">

**Autonomiczny, Nie Tylko Wspomagający**

Inne narzędzia AI czekają, aż powiesz im, co robić dalej. Agenci CyberStrike planują wieloetapowe łańcuchy ataków, uruchamiają narzędzia, analizują wyniki, zmieniają kierunek gdy znajdą coś interesującego i generują raporty poparte dowodami. Ty wyznaczasz cel — oni zajmują się metodologią.

</td>
</tr>
<tr>
<td width="50%">

**Dowolny LLM, Bez Uzależnienia od Dostawcy**

15+ dostawców od razu po instalacji: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — nawet lokalne modele przez endpointy kompatybilne z OpenAI. Uruchom go z Claude, GPT, Gemini lub własnym self-hostowanym LLM. W miarę jak modele stają się lepsze i tańsze, CyberStrike staje się lepszy razem z nimi.

</td>
<td width="50%">

**Zdalne Uruchamianie Narzędzi z Bolt**

Twoje narzędzia bezpieczeństwa nie muszą działać na Twoim laptopie. Bolt to zdalny serwer narzędzi CyberStrike — wdróż go na VPS ze swoim zestawem pentestowym, sparuj kluczami Ed25519 i kontroluj wszystko z lokalnego terminala przez protokół MCP. Jeden TUI, wiele serwerów ataku.

</td>
</tr>
</table>

---

### Agenci

Przełączaj się między agentami klawiszem `Tab`. Każdy z nich jest specjalistą.

| Agent | Dziedzina | Co Robi |
|-------|-----------|---------|
| **cyberstrike** | Ogólny | Główny agent z pełnym dostępem — rekonesans, eksploatacja, raportowanie |
| **web-application** | Web | OWASP Top 10, metodologia WSTG, bezpieczeństwo API, testowanie sesji |
| **mobile-application** | Mobilne | Android/iOS, Frida/Objection, zgodność z MASTG/MASVS |
| **cloud-security** | Chmura | AWS, Azure, GCP — błędy konfiguracji IAM, benchmarki CIS, wyeksponowane zasoby |
| **internal-network** | Sieć | Active Directory, ataki Kerberos, ruch boczny, pivoting |

Dodatkowo **8 wyspecjalizowanych proxy testerów** przechwytujących i manipulujących ruchem dla wybranych klas podatności:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### Ekosystem MCP

CyberStrike łączy się ze specjalizowanymi serwerami MCP, które rozszerzają jego możliwości:

| Serwer | Narzędzia | Co Dodaje |
|--------|-----------|-----------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | Testy bezpieczeństwa oparte na przeglądarce — XSS, CSRF, manipulacja DOM, kradzież ciasteczek |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | Audyty bezpieczeństwa chmury — 60+ kontroli w AWS, Azure, GCP |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | Postura bezpieczeństwa GitHub — repozytoria, organizacja, actions, secrets, supply chain |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | Wywiad CVE — NVD, EPSS, CISA KEV, GitHub Advisory, OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | Rekonesans OSINT — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS |

Wszystkie open source. Wszystkie instalowalne przez `npx`. Podłącz je do CyberStrike lub używaj samodzielnie z dowolnym klientem MCP.

---

### Instalacja

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

**Aplikacja desktopowa** (macOS, Windows, Linux) — pobierz ze [strony wydań](https://github.com/CyberStrikeus/CyberStrike/releases) lub:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Wbudowane Narzędzia

Agenci CyberStrike mają bezpośredni dostęp do 30+ narzędzi:

| Kategoria | Narzędzia |
|-----------|-----------|
| **Wykonywanie** | Shell (bash), odczyt/zapis/edycja plików, listowanie katalogów |
| **Odkrywanie** | Web fetch, wyszukiwanie internetowe, wyszukiwanie kodu, glob, grep |
| **Bezpieczeństwo** | Raportowanie podatności (format HackerOne), zbieranie dowodów |
| **Proxy** | Przechwytywanie HTTP/HTTPS, powtarzanie żądań, analiza ruchu |
| **Integracja** | Serwery MCP, zdalne narzędzia Bolt, własne pluginy |

Dodatkowo **SDK do pluginów** — buduj własnych agentów i narzędzia, rejestruj je w czasie wykonywania.

---

### Dla Kogo To Jest?

- **Pentesterzy** — Zautomatyzuj powtarzalne części. Pozwól agentom zająć się rekonesansem i wstępnymi testami, a Ty skup się na kreatywnych łańcuchach ataków wymagających ludzkiej intuicji.
- **Łowcy Bug Bounty** — Szybszy rekonesans, szersze pokrycie, spójna metodologia między programami. CyberStrike nie męczy się o 3 w nocy.
- **Zespoły Bezpieczeństwa** — Przeprowadzaj strukturalne oceny OWASP z powtarzalną metodologią. Otrzymuj raporty zmapowane do standardów zrozumiałych dla Twojego zespołu compliance.
- **Badacze Bezpieczeństwa** — Rozszerzaj CyberStrike o własnych agentów i serwery MCP. System pluginów i protokół MCP czynią go platformą, nie tylko narzędziem.

---

### Współtworzenie

CyberStrike jest tworzony przez społeczność bezpieczeństwa, dla społeczności bezpieczeństwa. Zapraszamy do współtworzenia w zakresie:

- **Agenci i umiejętności bezpieczeństwa** — Nowe metodologie ataków, wzorce testowania, wykrywanie podatności
- **Serwery MCP** — Podłączanie nowych narzędzi bezpieczeństwa i źródeł danych
- **Baza wiedzy** — Przewodniki metodologiczne WSTG, MASTG, PTES, CIS
- **Ulepszenia rdzenia** — Wydajność, UX, integracje dostawców, poprawki błędów

Przeczytaj [Przewodnik Współtworzenia](./CONTRIBUTING.md) przed zgłoszeniem PR. Wszystkie kontrybucje muszą być zgodne z [polityką etycznego użytkowania](./CODE_OF_CONDUCT.md) projektu — CyberStrike jest przeznaczony wyłącznie do autoryzowanych testów bezpieczeństwa.

---

### Licencja

[AGPL-3.0-only](./LICENSE) — Darmowy do użytku osobistego i open source. Licencja komercyjna dostępna przez [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

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
  <sub>Zbudowane przez hakerów, którzy mieli dość kopiowania i wklejania między terminalami.</sub>
</p>
