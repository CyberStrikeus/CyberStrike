<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>AI-চালিত আক্রমণাত্মক নিরাপত্তা এজেন্ট প্ল্যাটফর্ম।</b></p>

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

### CyberStrike কী?

CyberStrike একটি ওপেনসোর্স, স্বায়ত্তশাসিত আক্রমণাত্মক নিরাপত্তা এজেন্ট যা আপনার টার্মিনালে চলে। এতে ১৩টির বেশি বিশেষায়িত নিরাপত্তা এজেন্ট, ১২০টির বেশি OWASP পরীক্ষার কেস এবং ১৫টির বেশি LLM প্রদানকারীর সমর্থন রয়েছে। একটি লক্ষ্যবস্তুতে নির্দেশ করুন, এটি রিকনেসান্স, দুর্বলতা আবিষ্কার এবং প্রতিবেদন তৈরি সবকিছু পরিচালনা করবে — একটি মাত্র TUI থেকে।

### বৈশিষ্ট্যসমূহ

- **১৩টির বেশি নিরাপত্তা এজেন্ট** — ওয়েব অ্যাপ্লিকেশন (OWASP WSTG), মোবাইল (MASTG/MASVS), ক্লাউড (AWS/Azure/GCP), Active Directory/Kerberos, নেটওয়ার্ক এবং ৮টি বিশেষায়িত প্রক্সি পরীক্ষক (IDOR, ইনজেকশন, SSRF, প্রমাণীকরণ বাইপাস এবং আরও অনেক কিছু)
- **৩০টির বেশি অন্তর্নির্মিত টুল** — শেল এক্সিকিউশন, HTTP অনুরোধ, ফাইল অপারেশন, কোড সার্চ, ওয়েব স্ক্র্যাপিং, দুর্বলতা রিপোর্টিং
- **Bolt** — MCP প্রোটোকল এবং Ed25519 পেয়ারিং সহ রিমোট টুল সার্ভার। দূরবর্তী সার্ভারে নিরাপত্তা টুল চালান, আপনার টার্মিনাল থেকে নিয়ন্ত্রণ করুন
- **MCP ইকোসিস্টেম** — প্রথম-পক্ষের ইন্টিগ্রেশন: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **১৫টির বেশি LLM প্রদানকারী** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, OpenAI-সামঞ্জস্যপূর্ণ এন্ডপয়েন্টের মাধ্যমে স্থানীয় মডেল এবং আরও অনেক কিছু
- **মাল্টি-ইন্টারফেস** — TUI (টার্মিনাল), ওয়েব (SolidJS), ডেস্কটপ (Tauri) — সর্বত্র একই এজেন্ট ইঞ্জিন
- **LSP সমর্থন** — IDE-ভিত্তিক কর্মপ্রবাহের জন্য Language Server প্রোটোকল ইন্টিগ্রেশন
- **প্লাগইন সিস্টেম** — প্লাগইন SDK দিয়ে কাস্টম এজেন্ট এবং টুল তৈরি করুন

### ইনস্টলেশন

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

### দ্রুত শুরু

```bash
# CyberStrike চালু করুন
cyberstrike

# প্রথম রানে আপনার LLM প্রদানকারী নির্বাচন করুন, তারপর:
# "Run a full OWASP WSTG assessment on https://target.com"
```

### এজেন্টসমূহ

TUI-তে `Tab` দিয়ে এজেন্টদের মধ্যে স্যুইচ করুন।

| এজেন্ট | ডোমেইন | বিবরণ |
|---------|--------|--------|
| **cyberstrike** | সাধারণ | সম্পূর্ণ অ্যাক্সেসসহ ডিফল্ট আক্রমণাত্মক নিরাপত্তা এজেন্ট |
| **web-application** | ওয়েব | OWASP Top 10, WSTG পদ্ধতি, API নিরাপত্তা |
| **mobile-application** | মোবাইল | Android/iOS পরীক্ষা, Frida, MASTG/MASVS |
| **cloud-security** | ক্লাউড | AWS, Azure, GCP, IAM, CIS বেঞ্চমার্ক |
| **internal-network** | নেটওয়ার্ক | Active Directory, Kerberos, পার্শ্বিক চলাচল |

এছাড়াও লক্ষ্যবস্তু দুর্বলতা শ্রেণীর জন্য ৮টি বিশেষায়িত **প্রক্সি পরীক্ষক** এজেন্ট রয়েছে: IDOR, অনুমোদন, গণ অ্যাসাইনমেন্ট, ইনজেকশন, প্রমাণীকরণ, ব্যবসায়িক যুক্তি, SSRF এবং ফাইল আক্রমণ।

### ডেস্কটপ অ্যাপ

macOS, Windows এবং Linux-এর জন্য উপলব্ধ। [রিলিজ পৃষ্ঠা](https://github.com/CyberStrikeus/CyberStrike/releases) থেকে ডাউনলোড করুন।

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### ডকুমেন্টেশন

- [ডকুমেন্টেশন](https://cyberstrike.io/docs)
- [অবদান](./CONTRIBUTING.md)
- [আচরণবিধি](./CODE_OF_CONDUCT.md)

### লাইসেন্স

[AGPL-3.0-only](./LICENSE) — বাণিজ্যিক লাইসেন্সিং [contact@cyberstrike.io](mailto:contact@cyberstrike.io)-এর মাধ্যমে উপলব্ধ।

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
