<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>AI-संचालित आक्रामक सुरक्षा एजेंट प्लेटफ़ॉर्म।</b></p>

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

### CyberStrike क्या है?

CyberStrike एक ओपन-सोर्स, स्वायत्त आक्रामक सुरक्षा एजेंट है जो आपके टर्मिनल में चलता है। इसमें 13+ विशेषज्ञ सुरक्षा एजेंट, 120+ OWASP परीक्षण केस, और 15+ LLM प्रदाताओं का समर्थन शामिल है। बस इसे एक लक्ष्य की ओर इंगित करें, और यह टोही, भेद्यता खोज, और रिपोर्ट निर्माण को स्वचालित रूप से संभालता है — सब कुछ एक ही TUI से।

### विशेषताएँ

- **13+ सुरक्षा एजेंट** — वेब अनुप्रयोग (OWASP WSTG), मोबाइल (MASTG/MASVS), क्लाउड (AWS/Azure/GCP), Active Directory/Kerberos, नेटवर्क, और 8 विशेषज्ञ प्रॉक्सी परीक्षक एजेंट (IDOR, injection, SSRF, प्रमाणीकरण बायपास, और बहुत कुछ)
- **30+ अंतर्निहित उपकरण** — शेल निष्पादन, HTTP अनुरोध, फ़ाइल संचालन, कोड खोज, वेब स्क्रैपिंग, भेद्यता रिपोर्टिंग
- **Bolt** — MCP प्रोटोकॉल और Ed25519 पेयरिंग के साथ रिमोट टूल सर्वर। दूरस्थ सर्वरों पर सुरक्षा उपकरण चलाएँ, उन्हें अपने टर्मिनल से नियंत्रित करें
- **MCP पारिस्थितिकी तंत्र** — प्रथम-पक्ष एकीकरण: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **15+ LLM प्रदाता** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, OpenAI-संगत एंडपॉइंट के माध्यम से स्थानीय मॉडल, और बहुत कुछ
- **बहु-इंटरफ़ेस** — TUI (टर्मिनल), Web (SolidJS), Desktop (Tauri) — हर जगह एक ही एजेंट इंजन
- **LSP समर्थन** — IDE-आधारित कार्यप्रवाह के लिए भाषा सर्वर प्रोटोकॉल एकीकरण
- **प्लगइन सिस्टम** — प्लगइन SDK के साथ कस्टम एजेंट और उपकरण बनाएँ

### स्थापना

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

### त्वरित शुरुआत

```bash
# CyberStrike शुरू करें
cyberstrike

# पहली बार चलाने पर अपना LLM प्रदाता चुनें, फिर:
# "https://target.com पर पूर्ण OWASP WSTG मूल्यांकन चलाएँ"
```

### एजेंट

TUI में `Tab` कुंजी से एजेंटों के बीच स्विच करें।

| एजेंट | क्षेत्र | विवरण |
|--------|---------|-------|
| **cyberstrike** | सामान्य | पूर्ण पहुँच वाला डिफ़ॉल्ट आक्रामक सुरक्षा एजेंट |
| **web-application** | वेब | OWASP Top 10, WSTG पद्धति, API सुरक्षा |
| **mobile-application** | मोबाइल | Android/iOS परीक्षण, Frida, MASTG/MASVS |
| **cloud-security** | क्लाउड | AWS, Azure, GCP, IAM, CIS बेंचमार्क |
| **internal-network** | नेटवर्क | Active Directory, Kerberos, पार्श्व गति |

इसके अतिरिक्त लक्षित भेद्यता वर्गों के लिए 8 विशेषज्ञ **प्रॉक्सी परीक्षक** एजेंट: IDOR, प्राधिकरण, सामूहिक असाइनमेंट, injection, प्रमाणीकरण, व्यापार तर्क, SSRF, और फ़ाइल हमले।

### डेस्कटॉप ऐप

macOS, Windows, और Linux के लिए उपलब्ध। [रिलीज़ पृष्ठ](https://github.com/CyberStrikeus/CyberStrike/releases) से डाउनलोड करें।

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### प्रलेखन

- [प्रलेखन](https://cyberstrike.io/docs)
- [योगदान](./CONTRIBUTING.md)
- [आचार संहिता](./CODE_OF_CONDUCT.md)

### लाइसेंस

[AGPL-3.0-only](./LICENSE) — वाणिज्यिक लाइसेंस [contact@cyberstrike.io](mailto:contact@cyberstrike.io) के माध्यम से उपलब्ध है।

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
