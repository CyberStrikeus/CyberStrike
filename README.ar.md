<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">أول وكيل ذكاء اصطناعي مفتوح المصدر مصمم للأمن الهجومي.</h3>

<p align="center">
  اختبار اختراق مستقل من طرفيتك — استطلاع، اكتشاف الثغرات، استغلال، وإعداد التقارير.<br>
  أمر واحد. أكثر من 13 وكيلاً متخصصاً. أكثر من 120 حالة اختبار OWASP. فريقك الأحمر بالذكاء الاصطناعي.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
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

### لماذا CyberStrike؟

لا يزال اختبار الأمان يدوياً إلى حد كبير. يتنقل مختبرو الاختراق بين عشرات الأدوات، وينسخون ويلصقون المخرجات بين الطرفيات، ويقضون ساعات في الاستطلاع المتكرر قبل أن يلمسوا سطح الهجوم الفعلي. يهدر صائدو المكافآت الوقت على نفس سير عمل الاستطلاع لكل برنامج.

**CyberStrike يغيّر ذلك.** إنه وكيل ذكاء اصطناعي مستقل يفهم منهجية الأمن الهجومي — ليس مجرد تشغيل أدوات، بل التفكير فيما يجب اختباره، وربط الاكتشافات ببعضها، وتكييف نهجه بناءً على ما يكتشفه. فكّر فيه كعضو لا يكلّ في الفريق الأحمر داخل طرفيتك، يتبع OWASP WSTG، ويعرف متى يغيّر الاتجاه، ويكتب التقرير عند الانتهاء.

```bash
npm i -g cyberstrike@latest && cyberstrike
# "نفّذ تقييم OWASP WSTG كامل على https://target.com"
```

مفتوح المصدر، يعمل مع أي مزوّد LLM، وأنت تملك كل ما ينتجه.

---

### ما الذي يجعله مختلفاً

<table>
<tr>
<td width="50%">

**وكلاء أمنيون متخصصون، وليس دردشة عامة**

يأتي CyberStrike مع أكثر من 13 وكيلاً مصمماً خصيصاً للمجالات الأمنية. كل وكيل يحمل منهجية خاصة بالمجال، ومعرفة بالأدوات، وأنماط اختبار. وكيل تطبيقات الويب يتبع WSTG. وكيل أمان السحابة يعرف معايير CIS. وكيل الهاتف المحمول يستخدم Frida ويتبع MASTG/MASVS. لا يخمّنون — بل يتبعون أُطُراً مُثبتة.

</td>
<td width="50%">

**مستقل، وليس مجرد مساعد**

أدوات الذكاء الاصطناعي الأخرى تنتظرك لتخبرها بما تفعله بعد ذلك. وكلاء CyberStrike يخططون سلاسل هجوم متعددة الخطوات، وينفّذون الأدوات، ويحلّلون النتائج، ويغيّرون الاتجاه عندما يجدون شيئاً مثيراً للاهتمام، وينشئون تقارير مدعومة بالأدلة. أنت تحدد الهدف — وهم يتولّون المنهجية.

</td>
</tr>
<tr>
<td width="50%">

**أي LLM، بدون تقييد**

أكثر من 15 مزوّداً جاهزاً للاستخدام: Anthropic، OpenAI، Google، Amazon Bedrock، Azure، Groq، Mistral، OpenRouter — وحتى النماذج المحلية عبر نقاط نهاية متوافقة مع OpenAI. شغّله مع Claude أو GPT أو Gemini أو نموذج LLM المستضاف ذاتياً. كلما أصبحت النماذج أفضل وأرخص، يصبح CyberStrike أفضل معها.

</td>
<td width="50%">

**تنفيذ الأدوات عن بُعد مع Bolt**

لا يجب أن تعمل أدواتك الأمنية على حاسوبك المحمول. Bolt هو خادم الأدوات عن بُعد الخاص بـ CyberStrike — انشره على VPS مع مجموعة أدوات الاختراق الخاصة بك، واقرنه بمفاتيح Ed25519، وتحكّم في كل شيء من طرفيتك المحلية عبر بروتوكول MCP. واجهة طرفية واحدة، خوادم هجوم متعددة.

</td>
</tr>
</table>

---

### الوكلاء

بدّل بين الوكلاء بالضغط على `Tab`. كل واحد متخصص.

| الوكيل | التركيز | ماذا يفعل |
|--------|---------|-----------|
| **cyberstrike** | عام | الوكيل الرئيسي بصلاحيات كاملة — استطلاع، استغلال، إعداد تقارير |
| **web-application** | ويب | OWASP Top 10، منهجية WSTG، أمان واجهات البرمجة، اختبار الجلسات |
| **mobile-application** | هاتف محمول | Android/iOS، Frida/Objection، توافق MASTG/MASVS |
| **cloud-security** | سحابة | AWS، Azure، GCP — أخطاء تهيئة IAM، معايير CIS، موارد مكشوفة |
| **internal-network** | شبكة | Active Directory، هجمات Kerberos، الحركة الجانبية، التمحور |

بالإضافة إلى **8 مختبرين وكلاء متخصصين** يعترضون ويتلاعبون بحركة المرور لفئات ثغرات مستهدفة:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### منظومة MCP

يتصل CyberStrike بخوادم MCP متخصصة توسّع قدراته:

| الخادم | الأدوات | ماذا يضيف |
|--------|---------|-----------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | اختبار أمني عبر المتصفح — XSS، CSRF، التلاعب بـ DOM، سرقة الكوكيز |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | تدقيق أمان السحابة — أكثر من 60 فحصاً عبر AWS، Azure، GCP |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | الوضع الأمني لـ GitHub — المستودع، المنظمة، الإجراءات، الأسرار، سلسلة التوريد |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | استخبارات CVE — NVD، EPSS، CISA KEV، GitHub Advisory، OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | استطلاع OSINT — Shodan، VirusTotal، SecurityTrails، Censys، DNS، WHOIS |

الكل مفتوح المصدر. الكل قابل للتثبيت باستخدام `npx`. صِلها بـ CyberStrike أو استخدمها بشكل مستقل مع أي عميل MCP.

---

### التثبيت

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

**تطبيق سطح المكتب** (macOS، Windows، Linux) — حمّله من [صفحة الإصدارات](https://github.com/CyberStrikeus/CyberStrike/releases) أو:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### الأدوات المدمجة

وكلاء CyberStrike لديهم وصول مباشر إلى أكثر من 30 أداة:

| الفئة | الأدوات |
|-------|---------|
| **التنفيذ** | Shell (bash)، قراءة/كتابة/تحرير الملفات، استعراض المجلدات |
| **الاكتشاف** | جلب الويب، البحث على الويب، البحث في الكود، glob، grep |
| **الأمان** | الإبلاغ عن الثغرات (تنسيق HackerOne)، جمع الأدلة |
| **الوكيل** | اعتراض HTTP/HTTPS، إعادة تشغيل الطلبات، تحليل حركة المرور |
| **التكامل** | خوادم MCP، أدوات Bolt عن بُعد، إضافات مخصصة |

بالإضافة إلى **حزمة تطوير الإضافات** — ابنِ وكلاءك وأدواتك الخاصة، وسجّلها أثناء التشغيل.

---

### لمن هذا؟

- **مختبرو الاختراق** — أتمت الأجزاء المتكررة. دع الوكلاء يتولّون الاستطلاع والاختبار الأولي بينما تركّز أنت على سلاسل الهجوم الإبداعية التي تحتاج إلى حدس بشري.
- **صائدو المكافآت** — استطلاع أسرع، تغطية أوسع، منهجية متّسقة عبر البرامج. CyberStrike لا يتعب في الثالثة صباحاً.
- **فرق الأمان** — نفّذ تقييمات OWASP منظّمة بمنهجية قابلة للتكرار. احصل على تقارير تتوافق مع المعايير التي يفهمها فريق الامتثال لديك.
- **الباحثون الأمنيون** — وسّع CyberStrike بوكلاء مخصصين وخوادم MCP. نظام الإضافات وبروتوكول MCP يجعلانه منصة، وليس مجرد أداة.

---

### المساهمة

CyberStrike مبني من قبل مجتمع الأمان، من أجل مجتمع الأمان. نرحّب بالمساهمات في:

- **الوكلاء والمهارات الأمنية** — منهجيات هجوم جديدة، أنماط اختبار، اكتشاف الثغرات
- **خوادم MCP** — ربط أدوات أمنية ومصادر بيانات جديدة
- **قاعدة المعرفة** — أدلة منهجيات WSTG، MASTG، PTES، CIS
- **تحسينات النواة** — الأداء، تجربة المستخدم، تكاملات المزوّدين، إصلاح الأخطاء

اقرأ [دليل المساهمة](./CONTRIBUTING.md) قبل إرسال طلب سحب. يجب أن تلتزم جميع المساهمات بـ [سياسة الاستخدام الأخلاقي](./CODE_OF_CONDUCT.md) للمشروع — CyberStrike مخصص للاختبار الأمني المصرّح به فقط.

---

### الرخصة

[AGPL-3.0-only](./LICENSE) — مجاني للاستخدام الشخصي والمشاريع مفتوحة المصدر. الترخيص التجاري متاح عبر [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/snunAaHf6U"><b>Discord</b></a> · <a href="https://x.com/cyberstrike"><b>X.com</b></a> · <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a>
</p>
<p align="center">
  <sub>بناه قراصنة سئموا من النسخ واللصق بين الطرفيات.</sub>
</p>
