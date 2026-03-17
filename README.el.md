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

<h3 align="center">Ο πρώτος AI agent ανοιχτού κώδικα σχεδιασμένος για επιθετική ασφάλεια.</h3>

<p align="center">
  Αυτόνομο penetration testing από το τερματικό σας — αναγνώριση, ανακάλυψη ευπαθειών, εκμετάλλευση και αναφορά.<br>
  Μία εντολή. 13+ εξειδικευμένοι agents. 120+ σενάρια δοκιμών OWASP. Η AI red team σας.
</p>

<p align="center">
  <a href="#γιατί-cyberstrike">Γιατί CyberStrike;</a> &bull;
  <a href="#τι-το-κάνει-διαφορετικό">Τι το κάνει διαφορετικό</a> &bull;
  <a href="#agents">Agents</a> &bull;
  <a href="#οικοσύστημα-mcp">Οικοσύστημα MCP</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#εγκατάσταση">Εγκατάσταση</a> &bull;
  <a href="#ενσωματωμένα-εργαλεία">Ενσωματωμένα εργαλεία</a> &bull;
  <a href="#για-ποιον-είναι">Για ποιον είναι;</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

---

### Γιατί CyberStrike;

Ο έλεγχος ασφάλειας παραμένει συντριπτικά χειροκίνητος. Οι pentesters ταχυδακτυλουργούν δεκάδες εργαλεία, κάνουν αντιγραφή-επικόλληση αποτελεσμάτων μεταξύ τερματικών και ξοδεύουν ώρες σε επαναλαμβανόμενη αναγνώριση πριν αγγίξουν την πραγματική επιφάνεια επίθεσης. Οι κυνηγοί bug bounty χάνουν χρόνο στην ίδια ροή εργασίας αναγνώρισης για κάθε πρόγραμμα.

**Το CyberStrike αλλάζει αυτό.** Είναι ένας αυτόνομος AI agent που κατανοεί τη μεθοδολογία επιθετικής ασφάλειας — δεν εκτελεί απλά εργαλεία, αλλά σκέφτεται τι να δοκιμάσει, συνδέει ευρήματα μεταξύ τους και προσαρμόζει την προσέγγισή του με βάση αυτά που ανακαλύπτει. Σκεφτείτε το σαν ένα ακούραστο μέλος red team στο τερματικό σας που ακολουθεί το OWASP WSTG, ξέρει πότε να αλλάξει κατεύθυνση και γράφει την αναφορά όταν τελειώσει.

```bash
npm i -g cyberstrike@latest && cyberstrike
# "Run a full OWASP WSTG assessment on https://target.com"
```

Είναι ανοιχτού κώδικα, λειτουργεί με οποιονδήποτε πάροχο LLM και ό,τι παράγει ανήκει σε εσάς.

---

### Τι το κάνει διαφορετικό

<table>
<tr>
<td width="50%">

**Εξειδικευμένοι agents ασφάλειας, όχι γενικό chat**

Το CyberStrike συνοδεύεται από 13+ agents ειδικά σχεδιασμένους για τομείς ασφάλειας. Κάθε agent φέρει μεθοδολογία ειδική για τον τομέα του, γνώση εργαλείων και πρότυπα δοκιμών. Ο agent web-application ακολουθεί το WSTG. Ο agent cloud-security γνωρίζει τα σημεία αναφοράς CIS. Ο agent mobile χρησιμοποιεί Frida και ακολουθεί MASTG/MASVS. Δεν μαντεύουν — ακολουθούν δοκιμασμένα πλαίσια.

</td>
<td width="50%">

**Αυτόνομος, όχι απλά βοηθητικός**

Άλλα AI εργαλεία περιμένουν να τους πείτε τι να κάνουν μετά. Οι agents του CyberStrike σχεδιάζουν αλυσίδες επιθέσεων πολλαπλών βημάτων, εκτελούν εργαλεία, αναλύουν αποτελέσματα, αλλάζουν κατεύθυνση όταν βρίσκουν κάτι ενδιαφέρον και δημιουργούν αναφορές τεκμηριωμένες με αποδεικτικά στοιχεία. Εσείς ορίζετε τον στόχο — αυτοί αναλαμβάνουν τη μεθοδολογία.

</td>
</tr>
<tr>
<td width="50%">

**Οποιοδήποτε LLM, χωρίς δέσμευση**

15+ πάροχοι εκ του κουτιού: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — ακόμα και τοπικά μοντέλα μέσω OpenAI-συμβατών endpoints. Εκτελέστε το με Claude, GPT, Gemini ή το δικό σας self-hosted LLM. Καθώς τα μοντέλα γίνονται καλύτερα και φθηνότερα, το CyberStrike γίνεται καλύτερο μαζί τους.

</td>
<td width="50%">

**Απομακρυσμένη εκτέλεση εργαλείων με Bolt**

Τα εργαλεία ασφάλειας δεν χρειάζεται να τρέχουν στο laptop σας. Το Bolt είναι ο server απομακρυσμένων εργαλείων του CyberStrike — αναπτύξτε τον σε VPS με το pentest toolkit σας, συνδέστε τον με κλειδιά Ed25519 και ελέγξτε τα πάντα από το τοπικό σας τερματικό μέσω πρωτοκόλλου MCP. Ένα TUI, πολλαπλοί servers επίθεσης.

</td>
</tr>
</table>

---

### Agents

Εναλλαγή μεταξύ agents με `Tab`. Ο καθένας είναι ειδικός.

| Agent | Εστίαση | Τι κάνει |
|-------|---------|----------|
| **cyberstrike** | Γενικός | Κύριος agent πλήρους πρόσβασης — αναγνώριση, εκμετάλλευση, αναφορά |
| **web-application** | Web | OWASP Top 10, μεθοδολογία WSTG, ασφάλεια API, έλεγχος sessions |
| **mobile-application** | Mobile | Android/iOS, Frida/Objection, συμμόρφωση MASTG/MASVS |
| **cloud-security** | Cloud | AWS, Azure, GCP — λανθασμένες ρυθμίσεις IAM, σημεία αναφοράς CIS, εκτεθειμένοι πόροι |
| **internal-network** | Δίκτυο | Active Directory, επιθέσεις Kerberos, πλευρική μετακίνηση, pivoting |

Επιπλέον **8 εξειδικευμένοι proxy testers** που υποκλέπτουν και χειρίζονται κίνηση για στοχευμένες κατηγορίες ευπαθειών:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### Οικοσύστημα MCP

Το CyberStrike συνδέεται με εξειδικευμένους MCP servers που επεκτείνουν τις δυνατότητές του:

| Server | Εργαλεία | Τι προσθέτει |
|--------|---------|-------------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | Έλεγχος ασφάλειας μέσω browser — XSS, CSRF, χειρισμός DOM, κλοπή cookies |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | Έλεγχοι ασφάλειας cloud — 60+ έλεγχοι σε AWS, Azure, GCP |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | Κατάσταση ασφάλειας GitHub — repo, org, actions, secrets, supply chain |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | Πληροφορίες CVE — NVD, EPSS, CISA KEV, GitHub Advisory, OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | Αναγνώριση OSINT — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS |

Όλα ανοιχτού κώδικα. Όλα εγκαθίστανται με `npx`. Συνδέστε τα στο CyberStrike ή χρησιμοποιήστε τα αυτόνομα με οποιονδήποτε MCP client.

---

### Bolt

Το Bolt είναι ο server απομακρυσμένης εκτέλεσης εργαλείων του CyberStrike. Αντί να τρέχετε εργαλεία ασφάλειας στο laptop σας, αναπτύξτε τα σε VPS (ή περισσότερα) και ελέγξτε τα πάντα από το τοπικό σας τερματικό.

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**Πώς λειτουργεί:**
- Αναπτύξτε το Bolt σε οποιονδήποτε server με εγκατεστημένο το pentest toolkit σας
- Συνδέστε με κλειδιά Ed25519 — χωρίς κωδικούς, χωρίς κοινά μυστικά
- Οι agents του CyberStrike καλούν εργαλεία απομακρυσμένα μέσω πρωτοκόλλου MCP
- Τα αποτελέσματα μεταδίδονται σε πραγματικό χρόνο στο τοπικό σας TUI
- Διαχειριστείτε τις συνδέσεις από το TUI: προσθήκη, αφαίρεση, παρακολούθηση κατάστασης

**Γιατί έχει σημασία:** Η επιφάνεια επίθεσής σας παραμένει σε αποκλειστική υποδομή. Εκτελέστε βαριά scans από VPS με καλύτερο bandwidth, διατηρείτε τα εργαλεία σας ενημερωμένα σε ένα σημείο, και εναλλάσσεστε μεταξύ πολλαπλών servers επίθεσης από ένα μόνο τερματικό.

---

### Εγκατάσταση

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

**Εφαρμογή desktop** (macOS, Windows, Linux) — κατεβάστε από τη [σελίδα εκδόσεων](https://github.com/CyberStrikeus/CyberStrike/releases) ή:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Ενσωματωμένα εργαλεία

Οι agents του CyberStrike έχουν άμεση πρόσβαση σε 30+ εργαλεία:

| Κατηγορία | Εργαλεία |
|-----------|---------|
| **Εκτέλεση** | Shell (bash), ανάγνωση/εγγραφή/επεξεργασία αρχείων, λίστα καταλόγων |
| **Ανακάλυψη** | Web fetch, web search, αναζήτηση κώδικα, glob, grep |
| **Ασφάλεια** | Αναφορά ευπαθειών (μορφή HackerOne), συλλογή αποδεικτικών στοιχείων |
| **Proxy** | Υποκλοπή HTTP/HTTPS, επανάληψη αιτημάτων, ανάλυση κίνησης |
| **Ενσωμάτωση** | MCP servers, απομακρυσμένα εργαλεία Bolt, προσαρμοσμένα plugins |

Επιπλέον ένα **SDK για plugins** — δημιουργήστε τους δικούς σας agents και εργαλεία, καταχωρίστε τα κατά τη διάρκεια εκτέλεσης.

---

### Για ποιον είναι;

- **Pentesters** — Αυτοματοποιήστε τα επαναλαμβανόμενα μέρη. Αφήστε τους agents να χειριστούν την αναγνώριση και τον αρχικό έλεγχο ενώ εσείς εστιάζετε στις δημιουργικές αλυσίδες επίθεσης που χρειάζονται ανθρώπινη διαίσθηση.
- **Κυνηγοί Bug Bounty** — Ταχύτερη αναγνώριση, ευρύτερη κάλυψη, συνεπής μεθοδολογία σε όλα τα προγράμματα. Το CyberStrike δεν κουράζεται στις 3 το πρωί.
- **Ομάδες ασφάλειας** — Εκτελέστε δομημένες αξιολογήσεις OWASP με αναπαραγώγιμη μεθοδολογία. Λάβετε αναφορές που αντιστοιχίζονται σε πρότυπα που η ομάδα συμμόρφωσής σας κατανοεί.
- **Ερευνητές ασφάλειας** — Επεκτείνετε το CyberStrike με προσαρμοσμένους agents και MCP servers. Το σύστημα plugins και το πρωτόκολλο MCP το κάνουν πλατφόρμα, όχι απλά εργαλείο.

---

### Συνεισφορά

Το CyberStrike χτίζεται από την κοινότητα ασφάλειας, για την κοινότητα ασφάλειας. Καλωσορίζουμε συνεισφορές σε:

- **Agents και δεξιότητες ασφάλειας** — Νέες μεθοδολογίες επίθεσης, πρότυπα δοκιμών, ανίχνευση ευπαθειών
- **MCP servers** — Σύνδεση νέων εργαλείων ασφάλειας και πηγών δεδομένων
- **Βάση γνώσεων** — Οδηγοί μεθοδολογίας WSTG, MASTG, PTES, CIS
- **Βασικές βελτιώσεις** — Απόδοση, UX, ενσωματώσεις παρόχων, διορθώσεις σφαλμάτων

Διαβάστε τον [Οδηγό συνεισφοράς](./CONTRIBUTING.md) πριν υποβάλετε PR. Όλες οι συνεισφορές πρέπει να ακολουθούν την [πολιτική ηθικής χρήσης](./CODE_OF_CONDUCT.md) του έργου — το CyberStrike προορίζεται μόνο για εξουσιοδοτημένο έλεγχο ασφάλειας.

---

### Άδεια χρήσης

[AGPL-3.0-only](./LICENSE) — Δωρεάν για προσωπική χρήση και χρήση ανοιχτού κώδικα. Εμπορική αδειοδότηση διαθέσιμη μέσω [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

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
  <sub>Χτισμένο από hackers που βαρέθηκαν να κάνουν αντιγραφή-επικόλληση μεταξύ τερματικών.</sub>
</p>
