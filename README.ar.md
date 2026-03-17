<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>منصة وكلاء أمن هجومي مدعومة بالذكاء الاصطناعي.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="الرخصة" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### ما هو CyberStrike؟

CyberStrike هو وكيل أمن هجومي مستقل ومفتوح المصدر يعمل في الطرفية الخاصة بك. يأتي مع أكثر من 13 وكيلاً أمنياً متخصصاً، وأكثر من 120 حالة اختبار OWASP، ويعمل مع أكثر من 15 مزوداً لنماذج LLM. وجّهه نحو هدف، وسيتولى الاستطلاع واكتشاف الثغرات وإنشاء التقارير — كل ذلك من واجهة TUI واحدة.

### الميزات

- **أكثر من 13 وكيلاً أمنياً** — تطبيقات الويب (OWASP WSTG)، تطبيقات الهاتف المحمول (MASTG/MASVS)، السحابة (AWS/Azure/GCP)، Active Directory/Kerberos، الشبكات، بالإضافة إلى 8 أدوات اختبار بروكسي متخصصة (IDOR، الحقن، SSRF، تجاوز المصادقة، والمزيد)
- **أكثر من 30 أداة مدمجة** — تنفيذ الأوامر، طلبات HTTP، عمليات الملفات، البحث في الكود، تجريف الويب، الإبلاغ عن الثغرات
- **Bolt** — خادم أدوات عن بُعد مع بروتوكول MCP وإقران Ed25519. شغّل أدوات الأمان على خوادم بعيدة، وتحكم بها من طرفيتك
- **نظام MCP البيئي** — تكاملات رسمية: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)، [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)، [github-security-mcp](https://github.com/badchars/github-security-mcp)، [cve-mcp](https://github.com/badchars/cve-mcp)، [osint-mcp](https://github.com/badchars/osint-mcp)
- **أكثر من 15 مزود LLM** — Anthropic، OpenAI، Google، Amazon Bedrock، Azure، Groq، DeepInfra، Mistral، OpenRouter، نماذج محلية عبر نقاط نهاية متوافقة مع OpenAI، والمزيد
- **واجهات متعددة** — TUI (الطرفية)، Web (SolidJS)، Desktop (Tauri) — نفس محرك الوكلاء في كل مكان
- **دعم LSP** — تكامل بروتوكول خادم اللغة لسير العمل داخل بيئة التطوير
- **نظام الإضافات** — أنشئ وكلاء وأدوات مخصصة باستخدام SDK الإضافات

### التثبيت

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

### البدء السريع

```bash
# شغّل CyberStrike
cyberstrike

# اختر مزود LLM عند التشغيل الأول، ثم:
# "قم بتقييم OWASP WSTG كامل على https://target.com"
```

### الوكلاء

بدّل بين الوكلاء بالضغط على `Tab` في واجهة TUI.

| الوكيل | المجال | الوصف |
|--------|--------|-------|
| **cyberstrike** | عام | وكيل الأمن الهجومي الافتراضي بصلاحيات كاملة |
| **web-application** | الويب | OWASP Top 10، منهجية WSTG، أمان واجهات البرمجة |
| **mobile-application** | الهاتف المحمول | اختبار Android/iOS، Frida، MASTG/MASVS |
| **cloud-security** | السحابة | AWS، Azure، GCP، IAM، معايير CIS |
| **internal-network** | الشبكة | Active Directory، Kerberos، الحركة الجانبية |

بالإضافة إلى 8 وكلاء **اختبار بروكسي** متخصصين لفئات ثغرات محددة: IDOR، التفويض، التعيين الجماعي، الحقن، المصادقة، المنطق التجاري، SSRF، وهجمات الملفات.

### تطبيق سطح المكتب

متوفر لأنظمة macOS وWindows وLinux. حمّله من [صفحة الإصدارات](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### التوثيق

- [التوثيق](https://cyberstrike.io/docs)
- [المساهمة](./CONTRIBUTING.md)
- [مدونة السلوك](./CODE_OF_CONDUCT.md)

### الرخصة

[AGPL-3.0-only](./LICENSE) — الترخيص التجاري متاح عبر [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
