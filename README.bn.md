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

<h3 align="center">আক্রমণাত্মক নিরাপত্তার জন্য নির্মিত প্রথম ওপেন-সোর্স AI এজেন্ট।</h3>

<p align="center">
  আপনার টার্মিনাল থেকে স্বয়ংক্রিয় পেনটেস্টিং — রিকনেসান্স, দুর্বলতা আবিষ্কার, এক্সপ্লয়টেশন এবং রিপোর্টিং।<br>
  একটি কমান্ড। ১৩+ বিশেষায়িত এজেন্ট। ১২০+ OWASP টেস্ট কেস। আপনার AI রেড টিম।
</p>

<p align="center">
  <a href="#কেন-cyberstrike">কেন CyberStrike?</a> &bull;
  <a href="#কী-এটিকে-আলাদা-করে">কী এটিকে আলাদা করে</a> &bull;
  <a href="#এজেন্ট">এজেন্ট</a> &bull;
  <a href="#mcp-ইকোসিস্টেম">MCP ইকোসিস্টেম</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#ইনস্টলেশন">ইনস্টলেশন</a> &bull;
  <a href="#বিল্ট-ইন-টুল">বিল্ট-ইন টুল</a> &bull;
  <a href="#এটি-কাদের-জন্য">এটি কাদের জন্য?</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyberstrike-io/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/@cyberstrike-io/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

---

### কেন CyberStrike?

নিরাপত্তা পরীক্ষা এখনও অত্যধিক পরিমাণে ম্যানুয়াল। পেনটেস্টাররা ডজনখানেক টুল সামলান, টার্মিনালের মধ্যে আউটপুট কপি-পেস্ট করেন, এবং প্রকৃত আক্রমণ পৃষ্ঠ স্পর্শ করার আগে পুনরাবৃত্তিমূলক রিকনেসান্সে ঘণ্টার পর ঘণ্টা ব্যয় করেন। বাগ বাউন্টি হান্টাররা প্রতিটি প্রোগ্রামের জন্য একই রিকন ওয়ার্কফ্লোতে সময় নষ্ট করেন।

**CyberStrike এটি বদলে দেয়।** এটি একটি স্বয়ংক্রিয় AI এজেন্ট যা আক্রমণাত্মক নিরাপত্তা পদ্ধতি বোঝে — শুধু টুল চালানো নয়, বরং কী পরীক্ষা করতে হবে তা নিয়ে চিন্তা করা, আবিষ্কারগুলিকে একসাথে সংযুক্ত করা এবং যা আবিষ্কার করে তার ভিত্তিতে নিজের পদ্ধতি মানিয়ে নেওয়া। এটিকে আপনার টার্মিনালে একজন অক্লান্ত রেড টিম সদস্য মনে করুন যে OWASP WSTG অনুসরণ করে, জানে কখন দিক পরিবর্তন করতে হবে এবং শেষ হলে রিপোর্ট লেখে।

```bash
npm i -g @cyberstrike-io/cyberstrike@latest && cyberstrike
# "Run a full OWASP WSTG assessment on https://target.com"
```

এটি ওপেন সোর্স, যেকোনো LLM প্রদানকারীর সাথে কাজ করে এবং এটি যা তৈরি করে তার সবকিছু আপনার।

---

### কী এটিকে আলাদা করে

<table>
<tr>
<td width="50%">

**বিশেষায়িত নিরাপত্তা এজেন্ট, সাধারণ চ্যাট নয়**

CyberStrike নিরাপত্তা ডোমেনের জন্য বিশেষভাবে নির্মিত ১৩+ এজেন্ট নিয়ে আসে। প্রতিটি এজেন্ট ডোমেন-নির্দিষ্ট পদ্ধতি, টুল জ্ঞান এবং পরীক্ষার প্যাটার্ন বহন করে। ওয়েব-অ্যাপ্লিকেশন এজেন্ট WSTG অনুসরণ করে। ক্লাউড-সিকিউরিটি এজেন্ট CIS বেঞ্চমার্ক জানে। মোবাইল এজেন্ট Frida ব্যবহার করে এবং MASTG/MASVS অনুসরণ করে। তারা অনুমান করে না — তারা প্রমাণিত ফ্রেমওয়ার্ক অনুসরণ করে।

</td>
<td width="50%">

**স্বয়ংক্রিয়, শুধু সহায়ক নয়**

অন্যান্য AI টুল আপনার পরবর্তী নির্দেশনার জন্য অপেক্ষা করে। CyberStrike এজেন্ট বহু-ধাপের আক্রমণ শৃঙ্খল পরিকল্পনা করে, টুল চালায়, ফলাফল বিশ্লেষণ করে, আকর্ষণীয় কিছু পেলে দিক পরিবর্তন করে এবং প্রমাণ-সমর্থিত রিপোর্ট তৈরি করে। আপনি লক্ষ্য নির্ধারণ করুন — তারা পদ্ধতি সামলায়।

</td>
</tr>
<tr>
<td width="50%">

**যেকোনো LLM, কোনো লক-ইন নেই**

বাক্স থেকেই ১৫+ প্রদানকারী: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — এমনকি OpenAI-সামঞ্জস্যপূর্ণ endpoint এর মাধ্যমে স্থানীয় মডেল। Claude, GPT, Gemini বা আপনার নিজের সেলফ-হোস্টেড LLM দিয়ে চালান। মডেলগুলি যত ভালো এবং সস্তা হয়, CyberStrike তাদের সাথে ভালো হয়।

</td>
<td width="50%">

**Bolt দিয়ে রিমোট টুল এক্সিকিউশন**

আপনার নিরাপত্তা টুলগুলি আপনার ল্যাপটপে চালাতে হবে না। Bolt হল CyberStrike-এর রিমোট টুল সার্ভার — আপনার পেনটেস্ট টুলকিট সহ একটি VPS-এ এটি ডিপ্লয় করুন, Ed25519 কী দিয়ে পেয়ার করুন এবং MCP প্রোটোকলের মাধ্যমে আপনার লোকাল টার্মিনাল থেকে সবকিছু নিয়ন্ত্রণ করুন। একটি TUI, একাধিক আক্রমণ সার্ভার।

</td>
</tr>
</table>

---

### এজেন্ট

`Tab` দিয়ে এজেন্টদের মধ্যে সুইচ করুন। প্রতিটি একজন বিশেষজ্ঞ।

| এজেন্ট                 | ফোকাস      | কী করে                                                                 |
| ---------------------- | ---------- | ---------------------------------------------------------------------- |
| **cyberstrike**        | সাধারণ     | পূর্ণ-অ্যাক্সেস প্রাথমিক এজেন্ট — রিকনেসান্স, এক্সপ্লয়টেশন, রিপোর্টিং |
| **web-application**    | ওয়েব      | OWASP Top 10, WSTG পদ্ধতি, API নিরাপত্তা, সেশন পরীক্ষা                 |
| **mobile-application** | মোবাইল     | Android/iOS, Frida/Objection, MASTG/MASVS সম্মতি                       |
| **cloud-security**     | ক্লাউড     | AWS, Azure, GCP — IAM ভুল কনফিগারেশন, CIS বেঞ্চমার্ক, উন্মুক্ত রিসোর্স |
| **internal-network**   | নেটওয়ার্ক | Active Directory, Kerberos আক্রমণ, ল্যাটারাল মুভমেন্ট, পিভটিং          |

এছাড়াও **৮টি বিশেষায়িত প্রক্সি টেস্টার** যা লক্ষ্যভিত্তিক দুর্বলতা শ্রেণীর জন্য ট্র্যাফিক ইন্টারসেপ্ট এবং ম্যানিপুলেট করে:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### MCP ইকোসিস্টেম

CyberStrike বিশেষায়িত MCP সার্ভারের সাথে সংযুক্ত হয় যা এর সক্ষমতা বাড়ায়:

| সার্ভার                                                                | টুল | কী যোগ করে                                                                  |
| ---------------------------------------------------------------------- | --- | --------------------------------------------------------------------------- |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | ৩৮  | ক্লাউড নিরাপত্তা অডিট — AWS, Azure, GCP জুড়ে ৬০+ চেক                       |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | ৩৯  | GitHub নিরাপত্তা অবস্থান — repo, org, actions, secrets, supply chain        |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | ২৩  | CVE গোয়েন্দা তথ্য — NVD, EPSS, CISA KEV, GitHub Advisory, OSV              |
| [osint-mcp](https://github.com/badchars/osint-mcp)                     | ৩৭  | OSINT রিকন — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS         |

সবকিছু ওপেন সোর্স। সবকিছু `npx` দিয়ে ইনস্টলযোগ্য। CyberStrike-এ প্লাগ করুন অথবা যেকোনো MCP ক্লায়েন্টের সাথে স্বতন্ত্রভাবে ব্যবহার করুন।

---

### Bolt

Bolt হল CyberStrike-এর রিমোট টুল এক্সিকিউশন সার্ভার। আপনার ল্যাপটপে সিকিউরিটি টুল চালানোর পরিবর্তে, সেগুলি একটি VPS-এ (বা একাধিক) ডিপ্লয় করুন এবং আপনার লোকাল টার্মিনাল থেকে সবকিছু নিয়ন্ত্রণ করুন।

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**কিভাবে কাজ করে:**

- আপনার পেনটেস্ট টুলকিট ইনস্টল করা যেকোনো সার্ভারে Bolt ডিপ্লয় করুন
- Ed25519 কী দিয়ে পেয়ার করুন — কোনো পাসওয়ার্ড নেই, কোনো শেয়ার্ড সিক্রেট নেই
- CyberStrike এজেন্ট MCP প্রোটোকলের মাধ্যমে রিমোটলি টুল কল করে
- ফলাফল রিয়েল-টাইমে আপনার লোকাল TUI-তে স্ট্রিম হয়
- TUI থেকে সংযোগ পরিচালনা করুন: যোগ করুন, সরান, স্ট্যাটাস মনিটর করুন

**কেন এটি গুরুত্বপূর্ণ:** আপনার অ্যাটাক সারফেস ডেডিকেটেড ইনফ্রাস্ট্রাকচারে থাকে। ভালো ব্যান্ডউইথ সহ VPS থেকে ভারী স্ক্যান চালান, আপনার টুলগুলি এক জায়গায় আপডেট রাখুন, এবং একটি টার্মিনাল থেকে একাধিক অ্যাটাক সার্ভারের মধ্যে সুইচ করুন।

---

### ইনস্টলেশন

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

**ডেস্কটপ অ্যাপ** (macOS, Windows, Linux) — [রিলিজ পেজ](https://github.com/CyberStrikeus/CyberStrike/releases) থেকে ডাউনলোড করুন অথবা:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### বিল্ট-ইন টুল

CyberStrike এজেন্টদের ৩০+ টুলে সরাসরি অ্যাক্সেস আছে:

| বিভাগ           | টুল                                                           |
| --------------- | ------------------------------------------------------------- |
| **এক্সিকিউশন**  | শেল (bash), ফাইল পড়া/লেখা/সম্পাদনা, ডিরেক্টরি তালিকা         |
| **আবিষ্কার**    | ওয়েব ফেচ, ওয়েব সার্চ, কোড সার্চ, glob, grep                 |
| **নিরাপত্তা**   | দুর্বলতা রিপোর্টিং (HackerOne ফরম্যাট), প্রমাণ সংগ্রহ         |
| **প্রক্সি**     | HTTP/HTTPS ইন্টারসেপশন, রিকোয়েস্ট রিপ্লে, ট্র্যাফিক বিশ্লেষণ |
| **ইন্টিগ্রেশন** | MCP সার্ভার, Bolt রিমোট টুল, কাস্টম প্লাগইন                   |

এছাড়াও একটি **প্লাগইন SDK** — আপনার নিজের এজেন্ট এবং টুল তৈরি করুন, রানটাইমে রেজিস্টার করুন।

---

### এটি কাদের জন্য?

- **পেনটেস্টার** — পুনরাবৃত্তিমূলক অংশগুলি স্বয়ংক্রিয় করুন। এজেন্টদের রিকন এবং প্রাথমিক পরীক্ষা সামলাতে দিন যখন আপনি সৃজনশীল আক্রমণ শৃঙ্খলে মনোযোগ দিন যেখানে মানুষের অন্তর্দৃষ্টি প্রয়োজন।
- **বাগ বাউন্টি হান্টার** — দ্রুত রিকনেসান্স, বিস্তৃত কভারেজ, প্রোগ্রাম জুড়ে সামঞ্জস্যপূর্ণ পদ্ধতি। CyberStrike রাত ৩টায় ক্লান্ত হয় না।
- **নিরাপত্তা দল** — পুনরুৎপাদনযোগ্য পদ্ধতি সহ কাঠামোবদ্ধ OWASP মূল্যায়ন চালান। আপনার কমপ্লায়েন্স টিম বোঝে এমন মানদণ্ডে ম্যাপ করা রিপোর্ট পান।
- **নিরাপত্তা গবেষক** — কাস্টম এজেন্ট এবং MCP সার্ভার দিয়ে CyberStrike প্রসারিত করুন। প্লাগইন সিস্টেম এবং MCP প্রোটোকল এটিকে একটি প্ল্যাটফর্ম করে তোলে, শুধু একটি টুল নয়।

---

### অবদান রাখা

CyberStrike নিরাপত্তা সম্প্রদায় দ্বারা নির্মিত, নিরাপত্তা সম্প্রদায়ের জন্য। আমরা নিম্নলিখিত ক্ষেত্রে অবদানকে স্বাগত জানাই:

- **নিরাপত্তা এজেন্ট এবং দক্ষতা** — নতুন আক্রমণ পদ্ধতি, পরীক্ষার প্যাটার্ন, দুর্বলতা সনাক্তকরণ
- **MCP সার্ভার** — নতুন নিরাপত্তা টুল এবং ডেটা সোর্স সংযুক্ত করুন
- **জ্ঞানভিত্তি** — WSTG, MASTG, PTES, CIS পদ্ধতি নির্দেশিকা
- **মূল উন্নতি** — পারফরম্যান্স, UX, প্রদানকারী ইন্টিগ্রেশন, বাগ ফিক্স

PR জমা দেওয়ার আগে [অবদান নির্দেশিকা](./CONTRIBUTING.md) পড়ুন। সমস্ত অবদান প্রকল্পের [নৈতিক ব্যবহার নীতি](./CODE_OF_CONDUCT.md) অনুসরণ করতে হবে — CyberStrike শুধুমাত্র অনুমোদিত নিরাপত্তা পরীক্ষার জন্য।

---

### লাইসেন্স

[AGPL-3.0-only](./LICENSE) — ব্যক্তিগত এবং ওপেন-সোর্স ব্যবহারের জন্য বিনামূল্যে। বাণিজ্যিক লাইসেন্সিং [contact@cyberstrike.io](mailto:contact@cyberstrike.io) এর মাধ্যমে উপলব্ধ।

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
  <sub>যে হ্যাকাররা টার্মিনালের মধ্যে কপি-পেস্ট করতে করতে ক্লান্ত হয়ে গিয়েছিল তাদের দ্বারা নির্মিত।</sub>
</p>
