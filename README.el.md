<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>Πλατφόρμα πρακτόρων επιθετικής ασφάλειας με τεχνητή νοημοσύνη.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### Τι είναι το CyberStrike;

Το CyberStrike είναι ένας αυτόνομος πράκτορας επιθετικής ασφάλειας ανοιχτού κώδικα που εκτελείται στο τερματικό σας. Διαθέτει πάνω από 13 εξειδικευμένους πράκτορες ασφαλείας, πάνω από 120 σενάρια δοκιμών OWASP και υποστηρίζει πάνω από 15 παρόχους LLM. Στοχεύστε έναν στόχο και αυτό αναλαμβάνει την αναγνώριση, την ανακάλυψη ευπαθειών και τη δημιουργία αναφορών — όλα από ένα μόνο TUI.

### Χαρακτηριστικά

- **Πάνω από 13 πράκτορες ασφαλείας** — Διαδικτυακές εφαρμογές (OWASP WSTG), κινητές (MASTG/MASVS), cloud (AWS/Azure/GCP), Active Directory/Kerberos, δίκτυο και 8 εξειδικευμένοι ελεγκτές proxy (IDOR, injection, SSRF, παράκαμψη ταυτοποίησης και άλλα)
- **Πάνω από 30 ενσωματωμένα εργαλεία** — Εκτέλεση κελύφους, αιτήματα HTTP, λειτουργίες αρχείων, αναζήτηση κώδικα, web scraping, αναφορά ευπαθειών
- **Bolt** — Απομακρυσμένος διακομιστής εργαλείων με πρωτόκολλο MCP και σύζευξη Ed25519. Εκτελέστε εργαλεία ασφαλείας σε απομακρυσμένους διακομιστές, ελέγξτε τα από το τερματικό σας
- **Οικοσύστημα MCP** — Ενσωματώσεις πρώτου μέρους: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **Πάνω από 15 πάροχοι LLM** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, τοπικά μοντέλα μέσω OpenAI-συμβατών endpoints και άλλα
- **Πολλαπλές διεπαφές** — TUI (τερματικό), Web (SolidJS), Desktop (Tauri) — η ίδια μηχανή πράκτορα παντού
- **Υποστήριξη LSP** — Ενσωμάτωση πρωτοκόλλου Language Server για ροές εργασίας σε IDE
- **Σύστημα πρόσθετων** — Δημιουργήστε προσαρμοσμένους πράκτορες και εργαλεία με το SDK πρόσθετων

### Εγκατάσταση

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

### Γρήγορη εκκίνηση

```bash
# Εκκίνηση του CyberStrike
cyberstrike

# Επιλέξτε τον πάροχο LLM σας κατά την πρώτη εκτέλεση, στη συνέχεια:
# "Run a full OWASP WSTG assessment on https://target.com"
```

### Πράκτορες

Εναλλαγή μεταξύ πρακτόρων με το `Tab` στο TUI.

| Πράκτορας | Τομέας | Περιγραφή |
|-----------|--------|-----------|
| **cyberstrike** | Γενικός | Προεπιλεγμένος πράκτορας επιθετικής ασφάλειας με πλήρη πρόσβαση |
| **web-application** | Ιστός | OWASP Top 10, μεθοδολογία WSTG, ασφάλεια API |
| **mobile-application** | Κινητά | Δοκιμές Android/iOS, Frida, MASTG/MASVS |
| **cloud-security** | Cloud | AWS, Azure, GCP, IAM, πρότυπα αναφοράς CIS |
| **internal-network** | Δίκτυο | Active Directory, Kerberos, πλευρική μετακίνηση |

Επιπλέον 8 εξειδικευμένοι πράκτορες **ελεγκτών proxy** για στοχευμένες κατηγορίες ευπαθειών: IDOR, εξουσιοδότηση, μαζική εκχώρηση, injection, ταυτοποίηση, επιχειρηματική λογική, SSRF και επιθέσεις αρχείων.

### Εφαρμογή Desktop

Διαθέσιμη για macOS, Windows και Linux. Κατεβάστε από τη [σελίδα εκδόσεων](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Τεκμηρίωση

- [Τεκμηρίωση](https://cyberstrike.io/docs)
- [Συνεισφορά](./CONTRIBUTING.md)
- [Κώδικας δεοντολογίας](./CODE_OF_CONDUCT.md)

### Άδεια χρήσης

[AGPL-3.0-only](./LICENSE) — Εμπορική αδειοδότηση διαθέσιμη μέσω [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
