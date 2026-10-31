<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · **العربية** · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: هندسة عكسية لأي شيء

### خادم MCP واحد للهندسة العكسية للملفات الثنائية والتطبيقات والسلوك أثناء التشغيل.

**وجدت ميزة تعجبك؟ افهم طريقة عملها حتى مستوى الشيفرة الثنائية.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[الموقع](https://rea.tools/ar/) · [الأدلة](https://rea.tools/ar/guides/) · [دراسات الحالة](https://rea.tools/ar/showcase/)**

[البدء السريع](#البدء-السريع) · [كيف يعمل REA](#كيف-يعمل-rea) · [ما الذي يمكنك تحليله](#ما-الذي-يمكنك-تحليله) · [دراسات الحالة](#دراسات-الحالة) · [إنشاء بيئات التعلم المعزز](#build-rl-environments) · [الأسئلة الشائعة](#الأسئلة-الشائعة) · [أدوات GNU objdump وRizin](../reverse-engineering-tools.md) · [التوثيق](#التوثيق)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> المصادر الرسمية لـ REA: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> استخدم روابط التثبيت والإصدارات المنشورة في هذه المصادر الرسمية. تشابه اسم المستودع أو نسخ ملف README لا يثبت أن التنزيل رسمي.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA يشغّل جسر التحليل داخل Hopper لفحص ملف ثنائي للشيفرة الأصلية" width="1200" />

<br /><br />

<table aria-label="مجتمع REA">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>انضم إلى مجتمع الهندسة العكسية</strong>
  </a><br />
  <sub>Discord · أسئلة وأجوبة · مشاركة النتائج</sub>
</td>
</tr>
</table>

<br />

</div>

---

هل وجدت في تطبيق ميزة تريد إضافتها إلى منتجك؟ اطلب من وكيلك استقصاءها باستخدام REA. يستطيع فحص التطبيق من دون شيفرته المصدرية، وشرح طريقة عمل الميزة وعرض الأدلة، ثم بناء نسخة تناسب مشروعك.

يربط REA وكيلك بأدوات لفحص الملفات الثنائية للشيفرة الأصلية، وتطبيقات JavaScript وElectron، وتجميعات .NET، والمواقع. يمكنك أيضًا استخدام الأدوات نفسها من الطرفية. يجري التحليل محليًا، وتتضمن النتائج الأدلة والقيود التي تستند إليها كل خلاصة.

يسجّل الإعداد REA لدى وكيلك ويثبّت تعليمات العمل المطابقة. يمكن للتحليل الأصلي استخدام Hopper أو Ghidra أو IDA أو Kuna المثبّت مسبقًا؛ ويمكن تثبيت Hopper بعد موافقتك. لا يحتاج التحليل الثابت لـ JavaScript إلى محرك تحليل أصلي.

> **[زر موقع REA](https://rea.tools/ar/)** للاطلاع على تعليمات الإعداد والأدلة المصوّرة ودراسات الحالة الفعلية.

## البدء السريع

على Linux، يتطلب تشغيل Ghidra وJADX وأدوات البرامج الثابتة والتحليل الثابت لـ JavaScript/Electron وجود `ps` متوافق مع procps في `PATH` الخاص بـ REA للتحقق من ملكية العمليات. راجع متطلب Linux لخطوات المعالجة.

### إعداد وكيلك

بعد تثبيت Node.js وnpm، نفّذ:

```bash
npx rea-agents setup
```

اختر الوكلاء، وراجع التغييرات المقترحة، ثم وافق عليها. يضيف الإعداد خادم MCP الخاص بـ REA وتعليمات سير العمل المطابقة، مع الاحتفاظ بنسخ احتياطية من الإعدادات الموجودة. أعد تشغيل وكيلك بعد ذلك.

يدعم الإعداد Claude Code وCodex وCursor وGemini CLI وGrok Build و[وكلاء آخرين](../installation.md#supported-agents). راجع [التثبيت والإعداد](../installation.md) لتهيئة موفّري التحليل وتسجيل MCP يدويًا.

يستخدم MCP مخططات إدخال مختصرة افتراضيًا. للحصول على إرشادات الحقول الكاملة وتفاصيل التحقق المتداخل، اضبط `REA_MCP_INPUT_SCHEMA_PROFILE=full` في تسجيل MCP. يحتفظ الخياران بجميع الأدوات والتحقق القياسي نفسه على الخادم؛ راجع دليل عقود MCP.

### اطلب من وكيلك

```text
استقصِ طريقة عمل البحث في تطبيق Notes، واعرض الأدلة، ثم ابنِ ميزة مشابهة لمشروعي.
```

استبدل Notes بالتطبيق المستهدف وحدّد الميزة التي تريد فهمها.

### استخدام الطرفية

افحص مجلد تطبيق JavaScript/Electron بعد فك حزمه، أو ملف ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

تتضمن النتيجة الوحدات وعمليات الاستيراد وحدود Electron والأدلة المتعلقة بها. استبدل المسار بمسار هدفك، مثل `"D:/apps/example"` على Windows.

لتثبيت أمر `rea` للاستخدام المعتاد:

```bash
npm install --global rea-agents
rea --help
```

لتحليل الشيفرة الأصلية، هيّئ موفّرًا أولًا. راجع [دليل CLI وEvidence](../cli.md) لأوامر تحليل الشيفرة الأصلية، واختيار الموفّر، واللقطات، والاستخدام في السكربتات.

### تحديث REA

يتطور REA بسرعة، وتتضمن الإصدارات الجديدة إصلاحات متكررة للأخطاء. حافظ على تحديث نسختك.

لواجهة CLI المثبّتة عبر `npm install --global` / `bun add --global`:

```bash
rea update
```

`rea --update` اسم بديل لـ `rea update` يقبل خيارات الإخراج العامة نفسها. تحتفظ أوامر التحديث بإجمالي 4 MiB كحد أقصى من stdout/stderr. تُرفض بيانات التعريف الأكبر بعد انتهاء الأمر؛ وتحتفظ عمليات التثبيت المطوّلة بتشخيص محدود. يحترم عرض التقدم الضغط العكسي للطرفية وينتظر اكتمال الكتابات المرسلة.

تتطلب التحديثات العامة عبر Bun الإصدار Bun 1.2.17 أو أحدث. حدّث الإصدارات الأقدم يدويًا قبل تشغيل `rea update`.

لتحديث تسجيلات الوكلاء والمهارة، نفّذ أمر الإعداد الذي يعرضه التحديث.

إذا كنت تستخدم `npx`، فحدّث إعداد وكيلك بالأمر التالي:

```bash
npx rea-agents@latest setup
```

راجع تغييرات الإعداد وأعد تشغيل وكيلك. لأوامر CLI التي تنفّذها مرة واحدة، استخدم `npx rea-agents@latest` متبوعًا بالأمر المطلوب.

مع Bun، استخدم `bunx rea-agents@latest` بدلًا من `npx rea-agents@latest`.

## كيف يعمل REA

يستدعي وكيلك REA عبر MCP لفحص الهدف وتتبع الشيفرة ذات الصلة. يعيد REA النتائج مع أدلتها. يستخدمها الوكيل لطرح أسئلة متابعة، أو شرح السلوك، أو كتابة تنفيذ واختباره. تستخدم أوامر CLI سير العمل نفسه.

![مسار الاستقصاء في REA: يسأل وكيلك عن هدف محلي، ويفحصه REA ويتتبعه بأدوات التحليل، ثم يستخدم الوكيل الشيفرة والمراجع والجوانب غير المحسومة التي أعادتها الأدوات لشرح السلوك وتنفيذه واختباره.](../../website/public/assets/figures/rea-investigation-flow.svg)

[افتح الشكل بحجمه الكامل](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## ما الذي يمكنك تحليله

يتطلب REA إصدار Node.js 22.x (>=22.23.4) أو 24.x (>=24.22.1) أو 26+ (>=26.12.1)، إضافة إلى npm. تعتمد الأدوات الإضافية والأنظمة المضيفة المدعومة على الهدف:

| الهدف                           | ما يعيده REA                                                                                               | المتطلبات والدليل                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| الملفات الثنائية للشيفرة الأصلية | شيفرة شبه برمجية، وتعليمات تجميع، وسلاسل نصية، ورموز، واستدعاءات، ومراجع                                    | Hopper أو Ghidra أو IDA أو Kuna؛ [تحليل الشيفرة الأصلية](../native-investigation.md)                                                  |
| بنية ELF دون تشغيل              | الأقسام والمقاطع والرموز ومعلومات إعادة التموضع الأصلية، وآليات الحماية المحتملة المستدلّ عليها بالفحص الثابت | pwntools يوفّره المستدعي على Linux x64؛ [تشخيص الملفات الثنائية](../binary-diagnostics.md)                                            |
| PE certificates                 | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                               | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                              |
| PE imports                      | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                                 | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                        |
| شيفرة EVM البايتية              | محددات التوجيه، وإزاحات البايتات، والمعاملات المستنتجة، وقابلية تغيير الحالة                                | مدخل محلي يحمل بايتات خامًا أو تمثيلًا سداسيًا عشريًا على Linux x64؛ [دليل EVM دون تشغيل](../evm-bytecode.md)                             |
| Rust binaries                   | Embedded cargo-auditable dependency list                                                                   | [Rust binaries](../rust-binaries.md)                                                                                                 |
| ELF notes                       | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                                            | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                         |
| Linux kernel modules            | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                                | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                               |
| Erlang BEAM                     | IFF chunks, atoms, exports, and tables                                                                     | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                    |
| Apple IPS crashes               | .ips metadata, threads, images, registers and crash classes                                                | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                        |
| أعطال Linux المسجّلة             | سجلات note الخام، ومسجّلات المعالج/الإشارات لكل خيط مسجّل، وترشيحات اختيارية لخرائط الذاكرة                     | pwntools يوفّره المستدعي على Linux x64؛ GDB/pwndbg اختياريان؛ [الأعطال المسجّلة](../recorded-crashes.md)                                |
| تثبيتات سطح المكتب              | عائلات وقت التشغيل، والملفات الداعمة، وعلامات المكونات، والخطوات التالية                                     | فحص محدود للملفات والترويسات；[تطبيقات سطح المكتب](../desktop-applications.md)                                                       |
| JavaScript / Electron           | الوحدات، وعمليات الاستيراد، وخرائط المصدر، والمسارات، وIPC، وعلاقات إضافات الشيفرة الأصلية                    | Node.js وnpm؛ [تحليل التطبيقات](../javascript-application-workflows.md); Linux: procps `ps`                                          |
| المواقع                         | بنية الصفحة، والسكربتات، وملاحظات الشبكة، ولقطات الشاشة المطلوبة                                            | متصفح من عائلة Chrome؛ [تحليل المتصفح](../browser-observation.md)                                                                    |
| تسجيلات الشبكة المحفوظة          | الطلبات، والاستجابات، ومحتويات الحمولة المتاحة، ومواضعها في المصدر                                          | HAR / Fiddler Everywhere SAZ؛ وmitmdump على Linux لتسجيلات mitmproxy بصيغتها الأصلية؛ [دليل تسجيلات الشبكة](../web-network-captures.md) |
| التقاط الحزم                    | نقاط النهاية وDNS وTLS SNI وتوزيع البروتوكولات وطلبات HTTP                                                  | tshark وcapinfos يوفّرهما المُستدعي؛ [دليل pcap](../pcap-analysis.md)                                                                  |
| تجميعات .NET                    | البيانات الوصفية، وتعليمات CIL، واعتماديات الشيفرة الأصلية المعلنة، ومقارنات البناء                         | فحص ثابت؛ [دليل الشيفرة المُدارة](../managed-code-analysis.md)                                                                        |
| PyInstaller                     | CArchive, PYZ, Python bytecode                                                                             | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                                |
| حزم Android APK                 | تصريحات ملف manifest، والأصناف، والدوال الناتجة عن فك الترجمة، والمراجع                                     | JADX دون واجهة رسومية وJDK كامل على Linux/macOS/Windows x64؛ [دليل Android](../android-analysis.md)                                  |
| أجهزة Android                   | الأجهزة والحزم والعمليات والسجلات والدامبات ولقطات الشاشة ونقل APK/الملفات                                   | adb يوفّره المُستدعي (محاكي أو جهاز)؛ [دليل ADB](../adb-device-analysis.md)                                                            |
| مشاريع JEB                      | وحدات المشروع من المحرك وبصمات المصنّفات والكود الزائف للأنواع/الدوال                                        | عميل JEB يبدأه المُستدعي ويقدّم MCP، ويُختار عبر REA_JEB_MCP_URL؛ [دليل JEB](../jeb-analysis.md)                                        |
| موارد Android                   | البيان المفكوك الترميز وجداول السلاسل واللغات وحقائق الإصدار                                                 | مُشغّل Apktool يوفّره المُستدعي؛ [دليل الموارد](../apktool-resource-analysis.md)                                                         |
| تطبيقات Flutter                 | بصمة لقطة Dart وهشوش المكتبات لكل ABI وأصل بناء المحرك                                                     | لا شيء (تحليل APK ساكن)؛ [دليل Flutter](../flutter-analysis.md)                                                                       |
| البرامج الثابتة                 | المناطق، ونتائج الاستخراج، وما يُمرّر إلى تحليل الشيفرة الأصلية                                                | Binwalk / Unblob على Linux؛ [دليل البرامج الثابتة](../firmware-analysis.md)                                                          |
| الحزم المسجلة                   | حقول مختارة وقيم متكررة ومرشحات وقواعد فك الترميز                                                          | Linux: TShark 4.x + prlimit; [دليل التقاط الحزم](../packet-captures.md)                                                              |
| الإشارات المنطقية المسجلة        | تعليقات مفكك الترميز ونطاقات العينات ومعلومات التشخيص                                                      | Linux: sigrok-cli 0.7.2 + prlimit; [دليل الإشارات](../signal-recordings.md)                                                           |
| الحزم والموارد                  | قوائم الملفات، والبصمات، وملفات plist، وبنية حزم Apple، والموارد المستخرجة                                 | [دليل تحليل الملفات وJavaScript](../javascript-artifact-reconstruction.md)، [تطبيقات Apple](../apple-application-analysis.md)        |
| سلوك العمليات                   | مخرجات الطرفية، والتفاعلات، وملاحظات الخروج ونظام الملفات، ومقارنات التشغيل                                  | Linux/macOS مع PTY أصلي؛ [تسجيل سلوك العمليات](../process-capture.md)                                                                |
| ملفات Go الثنائية               | إصدار المترجم المضمّن والوحدات والاستبدالات وإعدادات البناء                                                   | فحص ثابت مدمج ELF/PE/thin Mach-O; لا يتطلب تثبيت Go                                                                                   |
| قواعد بيانات SQLite             | الجداول والأعمدة والفهارس والعروض والمشغلات وصفوف مختارة من الجداول العادية                                  | لقطة محلية لقاعدة البيانات/WAL؛ Node.js 24.x >=24.15 أو 26+ مع حدود SQLite الأصلية                                                    |
| كائنات شيفرة GPU                | أهداف CUDA/HIP ومعاملات وموارد النوى المختارة ونص PTX المحفوظ                                               | فحص ثابت مدمج ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                                 |
| ملفات النماذج                   | بيانات GGUF / safetensors الوصفية وتصريحات الموترات والمجاميع المشتقة                                      | فحص الترويسات؛ بصمة الملف الكامل اختيارية; [GGUF / safetensors](../model-artifacts.md)                                               |
| بيانات IL2CPP الوصفية           | صور التجميعات وأسماء الأنواع والدوال ونطاقات الفهارس في Unity global-metadata.dat                           | فك ثابت للإصدارات 24 و27 و29 و31 و39؛ لا يتطلب Unity                                                                                   |
| Godot PCK                       | جرد الأرشيف واستخراجه وحقائق الترويسات والأدلة الأصلية وهوية المحتوى المختار                                  | الصيغ الثابتة 2 و3 و4؛ لا يتطلب Godot                                                                                                 |
| ملفات WASM                      | التحقق والأقسام وأشكال WAT الدقيقة للاستيراد والتصدير وWAT المفكوك                                           | يوفّره المستخدم WABT 1.0.42; `inspect_wasm_artifact`                                                                                  |
| توقيعات APK                     | الموقّعون v1/v2/v3/v3.1 وبصمات الشهادات وتدوير المفاتيح واتساق الملخصات داخليًا                              | فحص ثابت مدمج; `inspect_apk_signature`                                                                                               |

يقرأ الفحص الثابت لـ JavaScript و.NET الملفات المقدّمة دون تشغيل التطبيق. يشغّل التسجيل أثناء التنفيذ الهدف المحدد أو يتفاعل معه بصلاحيات مستخدمك؛ ويشرح كل دليل للتسجيل أثناء التنفيذ آثاره.

<a id="choosing-a-deep-analysis-provider"></a>

للملفات الثنائية الكبيرة، ارفع مهلة بدء الموفّر باستخدام `REA_GHIDRA_STARTUP_TIMEOUT_MS` أو `REA_HOPPER_STARTUP_TIMEOUT_MS`.

تختلف صيغ ملفات الشيفرة الأصلية والأنظمة المضيفة المدعومة باختلاف الموفّر. راجع [إعداد Hopper وGhidra](../installation.md#hopper)، و[دليل IDA](../ida-provider.md)، [Kuna](../kuna-provider.md)، و[دعم Ghidra التجريبي على Windows](../windows-ghidra-p0.md). يدعم Ghidra أيضًا [تحليل DOS ذي 16 بت](../ghidra-dos.md). لاختيار الموفّر، راجع [دليل CLI](../cli.md#choose-a-provider). تحقّق من [توفر الميزات في الإصدارات](../installation.md#released-package-and-main) للميزات المضافة بعد أحدث إصدار على npm.

## دراسات الحالة

<a href="https://rea.tools/ar/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="رسوم توضيحية لأمثلة توزيع الصوت في DX-Ball وجسر الحافظة في Notion وحلقة الطلقات في TH04" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: إعادة بناء حساب توزيع الصوت بين القناتين

تتبّع استدعاء صوت إلى الدالة المساعدة التي تحوّل الموضع إلى توزيع بين القناتين، وافحص التعليمات، وحوّل الشيفرة شبه البرمجية غير المكتملة إلى C. تجتاز إعادة البناء 3,205 حالات اختبار على x86 الأصلي، وتعيد إنتاج جميع بايتات الدالة المترجمة البالغ عددها 63 بايتًا.

[اقرأ دراسة الحالة](https://rea.tools/ar/showcase/dx-ball/) ·
[مستودع إعادة البناء](https://github.com/N0zoM1z0/dx-ball)

### Notion: تتبّع جسر الحافظة في Electron

اعثر على API الحافظة في عملية العرض، وتتبّعه عبر preload وIPC إلى العملية الرئيسية، وافحص صيغة الحافظة ذات التنسيق الغني.

[اقرأ دراسة الحالة](https://rea.tools/ar/showcase/notion/)

### TH04: استعادة حساب حلقة المقذوفات في DOS

افحص تعليمات اللعبة الأصلية على PC-98 ذات 16 بت، واستعد حساب الزوايا الثابتة والموجّهة نحو الهدف، وقارن شيفرة C++ المعاد بناؤها بمخرجات المترجم المستخدم آنذاك.

[اقرأ دراسة الحالة](https://rea.tools/ar/showcase/th04/) ·
[مستودع إعادة البناء](https://github.com/N0zoM1z0/th04)

### إنشاء بيئات التعلم المعزز باستخدام REA

سجّل جلسة لتطبيق ويب، وحوّل API إلى أدوات، وصدّر بيئة يستطيع وكيل الذكاء الاصطناعي استخدامها. شغّلها باستخدام AgentEnv، ثم أضف المهام وفحوص المكافآت للتدريب بالتعلم المعزز أو التقييم.

[دليل إنشاء بيئة](https://rea.tools/guides/rl-environments/) ·
[شاهد العرض على X](https://x.com/reatools/status/2112574822584918075?s=20)

إذا استخدمت REA لفحص هدف مثير للاهتمام، فنود الاطلاع عليه. شارك حالتك في [issue](https://github.com/morluto/rea/issues) أو [pull request](https://github.com/morluto/rea/pulls)، مع ذكر الهدف، وسؤالك، وكيف ساعدك REA، وما توصلت إليه.

<a id="build-rl-environments"></a>

## إنشاء بيئات التعلم المعزز

أنشئ بيئة محلية يتدرب فيها وكيل الذكاء الاصطناعي على مهام مثل البحث عن مشكلة أو إنشاء مجلد، دون تشغيل التطبيق الأصلي. استخدمها للتعلم المعزز (RL) أو لاختبار قدرة الوكيل على إنجاز المهام.

يحوّل REA طلبات API والردود المسجلة إلى أدوات يمكن للوكيل استدعاؤها. تستخدم البيئة البيانات المسجلة ولا تدعم التغييرات إلا عندما يؤكد التسجيل آثارها.

بعد إعداد REA في وكيلك، استبدل رابط المثال ومهام المجلدات بما يناسب تطبيقك:

```text
استخدم REA لإنشاء بيئة تعلم معزز من تطبيق الويب الاختباري لدي على
http://127.0.0.1:3000
غطّ عرض المجلدات وإنشاءها وإعادة تسميتها وحذفها. يمكنك إنشاء مجلدات اختبار
وحذفها، لكن لا تغيّر البيانات الموجودة.
احفظ البيئة في مجلد باسم my-env، وتحقق من العمليات المتاحة وأخبرني كيف أشغّلها.
```

<details>
<summary>استخدام سطر الأوامر</summary>

استخدم هذه الأوامر إذا كان لديك ملف يسجل طلبات التطبيق وردوده في المتصفح. يتطلب تشغيل النتيجة أيضًا AgentEnv وDocker.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

يصدّر REA بيئة قابلة للتشغيل مع اختبار أساسي يتحقق من بدء تشغيلها واستجابتها. استخدمها مع إطار التعلم المعزز لتحديد أهداف المهام وإضافة فحوص المكافآت وتشغيل التدريب.

[دليل إنشاء بيئة](https://rea.tools/guides/rl-environments/) ·
[مرجع البيئات](../agent-environments.md) ·
[شاهد العرض على X](https://x.com/reatools/status/2112574822584918075?s=20)

## الأسئلة الشائعة

<details>
<summary><strong>أي وكلاء يمكنهم استخدام REA؟</strong></summary>

أي وكيل يدعم خوادم MCP المحلية. يهيّئ الإعداد [الوكلاء المدعومين](../installation.md#supported-agents)؛ ويمكن للعملاء الآخرين استخدام [تسجيل MCP يدويًا](../installation.md#mcp-registry).

</details>

<details>
<summary><strong>هل أحتاج إلى Hopper أو Ghidra أو IDA أو Kuna؟</strong></summary>

يستخدم تحليل الشيفرة الأصلية المتعمق أحدها. يعمل الفحص الثابت لـ JavaScript و.NET دون محرك لتحليل الشيفرة الأصلية. يستطيع الإعداد تثبيت Hopper بعد الموافقة؛ أما Ghidra وIDA وKuna فتستخدم تثبيتاتك الموجودة. راجع [إعداد الموفّرين](../installation.md#hopper).

</details>

<details>
<summary><strong>هل أحتاج إلى تشغيل Hopper أولًا؟</strong></summary>

يشغّل REA برنامج Hopper عندما تحتاج العملية إليه. على macOS، قد تظهر عند التشغيل الأول نافذة تطلب اختيار وضع العرض التجريبي أو تفعيل الترخيص. راجع [تشغيل Hopper واستكشاف الأخطاء](../installation.md#launcher-paths-and-troubleshooting).

</details>

<details>
<summary><strong>ماذا يفعل تثبيت المهارة من skills.sh؟</strong></summary>

توفّر المهارة تعليمات الاستقصاء لوكيلك. استخدم `npx rea-agents setup` لتسجيل خادم MCP الخاص بـ REA وتثبيت التعليمات المطابقة، ثم أعد تشغيل وكيلك. راجع [تثبيت المهارة وحدها](../installation.md#skill-only-installation).

</details>

<details>
<summary><strong>ما الشيفرة التي يعيدها REA؟</strong></summary>

يعيد تحليل الشيفرة الأصلية شيفرة شبه برمجية وتعليمات تجميع. يستعيد تحليل JavaScript/Electron الوحدات والعلاقات بينها. يستخدم وكيلك هذه النتائج لكتابة تنفيذ واختباره؛ وتقدّم [دراسات الحالة](#دراسات-الحالة) أمثلة عملية.

</details>

<details>
<summary><strong>هل يرفع REA تطبيقي؟</strong></summary>

يحلّل REA الأهداف محليًا. يتلقى وكيلك نتائج الأدوات، ولموفّر النموذج الذي يستخدمه سياسة بيانات خاصة به.

</details>

<details>
<summary><strong>ماذا أفعل إذا واجهت خطأ؟</strong></summary>

حدّث أولًا؛ فقد يكون إصدار حديث قد أصلح المشكلة بالفعل.

لواجهة CLI المثبّتة عبر npm:

```bash
rea update
```

لإعداد الوكيل عبر `npx`:

```bash
npx rea-agents@latest setup
```

إذا كنت تستخدم وكيلًا، فأكمل [تحديث الإعداد](#تحديث-rea) وأعد تشغيله. أعد محاولة المهمة نفسها. إذا استمرت المشكلة، [افتح issue](https://github.com/morluto/rea/issues) يتضمن إصدار REA، ونوع الهدف، وخطوات إعادة الإنتاج، ومخرجات الخطأ.

</details>

## التوثيق

ابدأ بـ [الأدلة العملية](https://rea.tools/ar/guides/) على الموقع. للخيارات الدقيقة والمتطلبات وعقود النتائج:

- [التثبيت والإعداد](../installation.md): تسجيل الوكلاء، وتهيئة الموفّرين، والتحديثات، وإلغاء التثبيت.
- [الجاهزية واستكشاف الأخطاء](../installation.md#check-readiness-for-your-task): تشخيص وكيل أو محرك تحليل محدد.
- [CLI وEvidence](../cli.md): الأوامر، واختيار الموفّر، واللقطات، والاستيراد/التصدير، وحالات الخروج.
- [عقود MCP](../mcp-contracts.md) و[تعليمات الوكلاء](../mcp-prompts.md): نتائج الأدوات، والجلسات، والاستقصاءات الموجّهة.
- [كتالوج الأدوات](../mcp-contracts.md#generated-catalog): قائمة الأدوات والموفّرين وأوامر CLI المولّدة أثناء البناء.
- [خطة العمل](../roadmap.md): الأعمال المخطط لها ومتابعة القدرات.

أبلغ عن الثغرات وفق [SECURITY.md](../../SECURITY.md).

## سجل النجوم

🎉 **400,000 نجمة على GitHub — شكرًا لكم!**

شكرًا لكل من يستخدم REA، ويبلّغ عن الأخطاء، ويقترح ميزات، ويختبر إصدارات البناء، ويساهم بالإصلاحات.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="سجل نجوم REA على GitHub" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## إخلاء المسؤولية

راجع [DISCLAIMER.md](../../DISCLAIMER.md) للحصول على إرشادات الاستخدام المسؤول.

REA مخصص للبحث والتعليم والتشغيل البيني وحفظ البرمجيات بشكل قانوني، ولتحليل البرمجيات التي تملكها أو لديك تفويض لفحصها.

The project's position on illegal or unauthorized use covers all REA
versions, distribution channels, and platforms; each copy retains its
applicable licenses.

## المساهمة

نرحّب بمساعدتك في تطوير REA! [افتح issue](https://github.com/morluto/rea/issues) للإبلاغ عن خطأ أو اقتراح ميزة، أو [أرسل pull request](https://github.com/morluto/rea/pulls) لتحسين الشيفرة أو التوثيق.

راجع [CONTRIBUTING.md](../../CONTRIBUTING.md) لإعداد بيئة التطوير والفحوص، و[دليل الاختبار](../testing.md) لمسارات التحقق، و[خريطة البنية](../architecture.mermaid) لهيكل المشروع.

## الترخيص

[MIT](../../LICENSE)

REA-authored code is licensed under MIT. Third-party material retains its own
licenses and copyright notices; see [Third-party notices](../../THIRD_PARTY_NOTICES.md)
for the dependency inventory, preserved license texts, and external-tool terms.

**You must legally obtain and be authorized to use commercial tools**, including
IDA Pro / Hex-Rays decompilers, Hopper, and JEB, under their applicable licenses.
REA grants no tool license, key, or activation entitlement. Trials and demos
remain subject to vendor terms, including user, feature, automation, and output
sharing restrictions. Cracked copies, stolen keys, unauthorized key sharing,
and bypassing license restrictions are not authorized. This guidance does not
amend MIT or third-party licenses.
