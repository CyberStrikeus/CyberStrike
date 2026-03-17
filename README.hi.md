<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">आक्रामक सुरक्षा के लिए बनाया गया पहला ओपन-सोर्स AI एजेंट।</h3>

<p align="center">
  आपके टर्मिनल से स्वायत्त पेनटेस्टिंग — टोही, कमज़ोरी खोज, शोषण और रिपोर्टिंग।<br>
  एक कमांड। 13+ विशेषज्ञ एजेंट। 120+ OWASP परीक्षण केस। आपकी AI रेड टीम।
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="लाइसेंस" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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
  <a href="#cyberstrike-क्यों">CyberStrike क्यों?</a> &bull;
  <a href="#यह-अलग-क्या-बनाता-है">यह अलग क्या बनाता है</a> &bull;
  <a href="#एजेंट">एजेंट</a> &bull;
  <a href="#mcp-इकोसिस्टम">MCP इकोसिस्टम</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#इंस्टॉलेशन">इंस्टॉलेशन</a> &bull;
  <a href="#बिल्ट-इन-टूल्स">बिल्ट-इन टूल्स</a> &bull;
  <a href="#यह-किसके-लिए-है">यह किसके लिए है?</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

### CyberStrike क्यों?

सुरक्षा परीक्षण अभी भी अत्यधिक मैनुअल है। पेनटेस्टर दर्जनों टूल्स को एक साथ संभालते हैं, टर्मिनलों के बीच आउटपुट कॉपी-पेस्ट करते हैं, और वास्तविक अटैक सरफेस को छूने से पहले दोहराव वाली टोही पर घंटों बिताते हैं। बग बाउंटी हंटर हर प्रोग्राम के लिए उसी टोही वर्कफ़्लो पर समय बर्बाद करते हैं।

**CyberStrike यह बदलता है।** यह एक स्वायत्त AI एजेंट है जो आक्रामक सुरक्षा कार्यप्रणाली को समझता है — सिर्फ़ टूल चलाना नहीं, बल्कि यह तर्क करना कि क्या परीक्षण करना है, निष्कर्षों को एक-दूसरे से जोड़ना, और जो खोजता है उसके आधार पर अपना दृष्टिकोण बदलना। इसे अपने टर्मिनल में एक अथक रेड टीम सदस्य समझिए जो OWASP WSTG का पालन करता है, जानता है कब दिशा बदलनी है, और काम पूरा होने पर रिपोर्ट लिखता है।

```bash
npm i -g cyberstrike@latest && cyberstrike
# "https://target.com पर पूर्ण OWASP WSTG मूल्यांकन चलाएँ"
```

यह ओपन सोर्स है, किसी भी LLM प्रदाता के साथ काम करता है, और यह जो भी बनाता है उसका मालिक आप हैं।

---

### यह अलग क्या बनाता है

<table>
<tr>
<td width="50%">

**विशेषज्ञ सुरक्षा एजेंट, सामान्य चैट नहीं**

CyberStrike 13+ एजेंट के साथ आता है जो सुरक्षा डोमेन के लिए विशेष रूप से बनाए गए हैं। प्रत्येक एजेंट डोमेन-विशिष्ट कार्यप्रणाली, टूल ज्ञान और परीक्षण पैटर्न रखता है। web-application एजेंट WSTG का पालन करता है। cloud-security एजेंट CIS बेंचमार्क जानता है। mobile एजेंट Frida का उपयोग करता है और MASTG/MASVS का पालन करता है। वे अनुमान नहीं लगाते — वे सिद्ध फ्रेमवर्क का पालन करते हैं।

</td>
<td width="50%">

**स्वायत्त, सिर्फ़ सहायक नहीं**

अन्य AI टूल आपसे अगला कदम बताने की प्रतीक्षा करते हैं। CyberStrike एजेंट बहु-चरणीय अटैक चेन की योजना बनाते हैं, टूल चलाते हैं, परिणामों का विश्लेषण करते हैं, कुछ दिलचस्प मिलने पर दिशा बदलते हैं, और साक्ष्य-समर्थित रिपोर्ट तैयार करते हैं। आप लक्ष्य तय करें — वे कार्यप्रणाली संभालें।

</td>
</tr>
<tr>
<td width="50%">

**कोई भी LLM, कोई लॉक-इन नहीं**

15+ प्रदाता बॉक्स से बाहर उपलब्ध: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — यहाँ तक कि OpenAI-संगत एंडपॉइंट के माध्यम से स्थानीय मॉडल भी। Claude, GPT, Gemini, या अपने स्वयं के सेल्फ-होस्टेड LLM के साथ चलाएँ। जैसे-जैसे मॉडल बेहतर और सस्ते होते हैं, CyberStrike उनके साथ बेहतर होता जाता है।

</td>
<td width="50%">

**Bolt के साथ रिमोट टूल एक्ज़ीक्यूशन**

आपके सुरक्षा टूल्स को आपके लैपटॉप पर चलने की ज़रूरत नहीं है। Bolt CyberStrike का रिमोट टूल सर्वर है — इसे अपने पेनटेस्ट टूलकिट के साथ VPS पर डिप्लॉय करें, Ed25519 कुंजियों से पेयर करें, और MCP प्रोटोकॉल पर अपने लोकल टर्मिनल से सब कुछ कंट्रोल करें। एक TUI, कई अटैक सर्वर।

</td>
</tr>
</table>

---

### एजेंट

`Tab` से एजेंट बदलें। हर एक विशेषज्ञ है।

| एजेंट | फ़ोकस | क्या करता है |
|--------|-------|-------------|
| **cyberstrike** | सामान्य | पूर्ण-पहुँच प्राथमिक एजेंट — टोही, शोषण, रिपोर्टिंग |
| **web-application** | वेब | OWASP Top 10, WSTG कार्यप्रणाली, API सुरक्षा, सेशन परीक्षण |
| **mobile-application** | मोबाइल | Android/iOS, Frida/Objection, MASTG/MASVS अनुपालन |
| **cloud-security** | क्लाउड | AWS, Azure, GCP — IAM गलत कॉन्फ़िगरेशन, CIS बेंचमार्क, उजागर संसाधन |
| **internal-network** | नेटवर्क | Active Directory, Kerberos हमले, लेटरल मूवमेंट, पिवटिंग |

साथ ही **8 विशेषज्ञ प्रॉक्सी टेस्टर** जो लक्षित कमज़ोरी श्रेणियों के लिए ट्रैफ़िक इंटरसेप्ट और मैनिपुलेट करते हैं:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### MCP इकोसिस्टम

CyberStrike विशेषज्ञ MCP सर्वर से जुड़ता है जो इसकी क्षमताओं का विस्तार करते हैं:

| सर्वर | टूल | क्या जोड़ता है |
|--------|------|---------------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | ब्राउज़र-आधारित सुरक्षा परीक्षण — XSS, CSRF, DOM मैनिपुलेशन, कुकी चोरी |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | क्लाउड सुरक्षा ऑडिट — AWS, Azure, GCP पर 60+ जाँचें |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | GitHub सुरक्षा स्थिति — रेपो, संगठन, actions, secrets, सप्लाई चेन |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | CVE इंटेलिजेंस — NVD, EPSS, CISA KEV, GitHub Advisory, OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | OSINT टोही — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS |

सभी ओपन सोर्स। सभी `npx` से इंस्टॉल करने योग्य। इन्हें CyberStrike में प्लग करें या किसी भी MCP क्लाइंट के साथ स्वतंत्र रूप से उपयोग करें।

---

### Bolt

Bolt CyberStrike का रिमोट टूल एक्ज़ीक्यूशन सर्वर है। अपने लैपटॉप पर सुरक्षा टूल चलाने के बजाय, उन्हें VPS (या कई) पर डिप्लॉय करें और अपने लोकल टर्मिनल से सब कुछ कंट्रोल करें।

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**यह कैसे काम करता है:**
- अपने पेनटेस्ट टूलकिट इंस्टॉल किसी भी सर्वर पर Bolt डिप्लॉय करें
- Ed25519 कुंजियों से पेयर करें — कोई पासवर्ड नहीं, कोई साझा सीक्रेट नहीं
- CyberStrike एजेंट MCP प्रोटोकॉल पर रिमोटली टूल कॉल करते हैं
- परिणाम आपके लोकल TUI में रियल-टाइम में स्ट्रीम होते हैं
- TUI से कनेक्शन प्रबंधित करें: जोड़ें, हटाएँ, स्टेटस मॉनिटर करें

**यह क्यों मायने रखता है:** आपका अटैक सरफेस समर्पित इंफ्रास्ट्रक्चर पर रहता है। बेहतर बैंडविड्थ वाले VPS से भारी स्कैन चलाएँ, अपने टूल्स को एक जगह अपडेट रखें, और एक ही टर्मिनल से कई अटैक सर्वर के बीच स्विच करें।

---

### इंस्टॉलेशन

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

**डेस्कटॉप ऐप** (macOS, Windows, Linux) — [रिलीज़ पेज](https://github.com/CyberStrikeus/CyberStrike/releases) से डाउनलोड करें या:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### बिल्ट-इन टूल्स

CyberStrike एजेंट के पास 30+ टूल्स तक सीधी पहुँच है:

| श्रेणी | टूल्स |
|--------|-------|
| **एक्ज़ीक्यूशन** | Shell (bash), फ़ाइल रीड/राइट/एडिट, डायरेक्टरी लिस्टिंग |
| **खोज** | वेब फ़ेच, वेब सर्च, कोड सर्च, glob, grep |
| **सुरक्षा** | कमज़ोरी रिपोर्टिंग (HackerOne प्रारूप), साक्ष्य संग्रह |
| **प्रॉक्सी** | HTTP/HTTPS इंटरसेप्शन, रिक्वेस्ट रीप्ले, ट्रैफ़िक विश्लेषण |
| **इंटीग्रेशन** | MCP सर्वर, Bolt रिमोट टूल्स, कस्टम प्लगइन |

साथ ही एक **प्लगइन SDK** — अपने एजेंट और टूल बनाएँ, रनटाइम पर रजिस्टर करें।

---

### यह किसके लिए है?

- **पेनटेस्टर** — दोहराव वाले कामों को स्वचालित करें। एजेंट को टोही और प्रारंभिक परीक्षण संभालने दें जबकि आप रचनात्मक अटैक चेन पर ध्यान केंद्रित करें जिन्हें मानवीय अंतर्ज्ञान की आवश्यकता है।
- **बग बाउंटी हंटर** — तेज़ टोही, व्यापक कवरेज, सभी प्रोग्रामों में एक समान कार्यप्रणाली। CyberStrike रात 3 बजे थकता नहीं है।
- **सुरक्षा टीमें** — पुनरुत्पादन योग्य कार्यप्रणाली के साथ संरचित OWASP मूल्यांकन चलाएँ। ऐसी रिपोर्ट प्राप्त करें जो उन मानकों से मैप होती हैं जिन्हें आपकी अनुपालन टीम समझती है।
- **सुरक्षा शोधकर्ता** — कस्टम एजेंट और MCP सर्वर के साथ CyberStrike का विस्तार करें। प्लगइन सिस्टम और MCP प्रोटोकॉल इसे सिर्फ़ एक टूल नहीं, बल्कि एक प्लेटफ़ॉर्म बनाते हैं।

---

### योगदान

CyberStrike सुरक्षा समुदाय द्वारा, सुरक्षा समुदाय के लिए बनाया गया है। हम इन क्षेत्रों में योगदान का स्वागत करते हैं:

- **सुरक्षा एजेंट और कौशल** — नई अटैक कार्यप्रणालियाँ, परीक्षण पैटर्न, कमज़ोरी पहचान
- **MCP सर्वर** — नए सुरक्षा टूल और डेटा स्रोतों को कनेक्ट करें
- **ज्ञान आधार** — WSTG, MASTG, PTES, CIS कार्यप्रणाली गाइड
- **कोर सुधार** — प्रदर्शन, UX, प्रदाता इंटीग्रेशन, बग फ़िक्स

PR सबमिट करने से पहले [योगदान गाइड](./CONTRIBUTING.md) पढ़ें। सभी योगदानों को प्रोजेक्ट की [नैतिक उपयोग नीति](./CODE_OF_CONDUCT.md) का पालन करना होगा — CyberStrike केवल अधिकृत सुरक्षा परीक्षण के लिए है।

---

### लाइसेंस

[AGPL-3.0-only](./LICENSE) — व्यक्तिगत और ओपन-सोर्स उपयोग के लिए मुफ़्त। व्यावसायिक लाइसेंसिंग [contact@cyberstrike.io](mailto:contact@cyberstrike.io) के माध्यम से उपलब्ध है।

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
  <sub>उन हैकर्स द्वारा बनाया गया जो टर्मिनलों के बीच कॉपी-पेस्ट करते-करते थक गए थे।</sub>
</p>
