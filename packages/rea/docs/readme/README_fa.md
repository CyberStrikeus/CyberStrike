<div align="center" dir="rtl">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · **فارسی** · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: مهندسی معکوس هر چیزی

### یک MCP برای مهندسی معکوس فایل‌های باینری، برنامه‌ها و رفتار زمان اجرا.

**قابلیتی دیده‌اید که دوستش دارید؟ سازوکارش را تا سطح باینری درک کنید.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55" /></a>

**[وب‌سایت](https://rea.tools/fa/) · [راهنماها](https://rea.tools/fa/guides/) · [نمونه‌های عملی](https://rea.tools/fa/showcase/)**

[شروع سریع](#شروع-سریع) · [REA چگونه کار می‌کند؟](#rea-چگونه-کار-می‌کند) · [چه چیزهایی را میتوان تحلیل کرد؟](#چه-چیزهایی-را-می‌توان-تحلیل-کرد) · [نمونه‌های عملی](#نمونه‌های-عملی) · [ساخت محیط‌های RL](#build-rl-environments) · [پرسش‌های متداول](#پرسش‌های-متداول) · [مستندات](#مستندات)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> منابع رسمی REA: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> از پیوندهای نصب و انتشار در این منابع رسمی استفاده کنید. نام مشابه مخزن یا README کپی‌شده ثابت نمی‌کند که فایل دانلودی رسمی است.

<div align="center" dir="rtl">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="اجرای پل تحلیل REA در Hopper هنگام بررسی یک فایل باینری بومی" width="1200" />

<br /><br />

<table aria-label="انجمن REA"><tr><td align="center" width="360"><a href="https://discord.gg/GkcryMnJDM"><img    src="../assets/discord.svg" height="42" alt="Discord" /><br /><strong>به انجمن مهندسی معکوس بپیوندید</strong></a><br /><sub>دیسکورد · پرسش و پاسخ · نمایش دستاوردها</sub></td></tr></table>

<br />

</div>

---

<div dir="rtl">

قابلیتی در یک برنامه دیده‌اید که می‌خواهید در محصول خودتان داشته باشید؟ از ایجنت خود بخواهید با REA آن را بررسی کند. ایجنت می‌تواند بدون دسترسی به کد منبع برنامه، نحوهٔ کار قابلیت را بررسی و توضیح دهد، شواهد را نشان دهد و نسخه‌ای مشابه برای پروژهٔ شما بسازد.

REA ایجنت شما را به ابزارهایی برای بررسی باینری‌های بومی، برنامه‌های JavaScript و Electron، اسمبلی‌های .NET و وب‌سایت‌ها متصل می‌کند. همین ابزارها از ترمینال نیز قابل استفاده‌اند. تحلیل به‌صورت محلی انجام می‌شود و نتایج شامل شواهد و محدودیت‌های پشت هر نتیجه‌گیری هستند.

راه‌اندازی، REA را در ایجنت ثبت و دستورالعمل‌های متناظر را نصب می‌کند. تحلیل بومی می‌تواند از Hopper، Ghidra، IDA یا Kuna موجود استفاده کند؛ نصب Hopper پس از تأیید شما ممکن است. تحلیل ایستای JavaScript به موتور تحلیل بومی نیاز ندارد.

> برای دستورالعمل‌های راه‌اندازی، راهنماهای تصویری و مطالعات موردی واقعی، **[به وب‌سایت REA مراجعه کنید](https://rea.tools/fa/)**.

## شروع سریع

در Linux، اجرای Ghidra، JADX و ابزارهای firmware و تحلیل ایستای JavaScript/Electron برای بررسی مالکیت فرایندها به `ps` سازگار با procps در `PATH` مربوط به REA نیاز دارد. راهکارها در پیش‌نیاز Linux آمده‌اند.

### ایجنت خود را راه‌اندازی کنید

پس از نصب Node.js و npm، دستور زیر را اجرا کنید:

```bash
npx rea-agents setup
```

ایجنت‌های موردنظر را انتخاب کنید، تغییرات پیشنهادی را بررسی و تأیید کنید. فرایند راه‌اندازی، سرور MCP مربوط به REA و دستورالعمل‌های گردش‌کار متناظر را اضافه می‌کند و از پیکربندی موجود نسخهٔ پشتیبان می‌گیرد. پس از آن ایجنت خود را مجدداً راه‌اندازی کنید.

راه‌اندازی از Claude Code، Codex، Cursor، Gemini CLI، Grok Build و [ایجنت‌های دیگر](../installation.md#supported-agents) پشتیبانی می‌کند. برای پیکربندی ارائه‌دهنده و ثبت دستی MCP، [نصب و راه‌اندازی](../installation.md) را ببینید.

MCP به‌طور پیش‌فرض از schema ورودی فشرده استفاده می‌کند. برای راهنمای کامل فیلدها و اعتبارسنجی تو‌در‌تو، در ثبت MCP مقدار `REA_MCP_INPUT_SCHEMA_PROFILE=full` را تنظیم کنید. هر دو حالت همهٔ ابزارها و اعتبارسنجی استاندارد یکسان سرور را نگه می‌دارند؛ راهنمای قراردادهای MCP را ببینید.

### از ایجنت خود بپرسید

```text
بررسی کن جست‌وجو در برنامهٔ Notes چگونه کار می‌کند، شواهدش را نشان بده و قابلیتی مشابه برای پروژهٔ من بساز.
```

به‌جای Notes، نام برنامهٔ هدف و قابلیتی را قرار دهید که می‌خواهید درک کنید.

### استفاده از ترمینال

برای بررسی پوشهٔ استخراج‌شدهٔ یک برنامهٔ JavaScript/Electron یا فایل ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

نتیجه شامل ماژول‌ها، importها، مرزهای Electron و شواهد مربوط به آن‌هاست. مسیر را با مسیر برنامهٔ هدف جایگزین کنید؛ مثلاً در ویندوز `"D:/apps/example"`.

برای نصب دستور `rea` جهت استفادهٔ مداوم:

```bash
npm install --global rea-agents
rea --help
```

برای تحلیل بومی ابتدا یک ارائه‌دهنده پیکربندی کنید. برای دستورات بومی، انتخاب ارائه‌دهنده، snapshotها و اسکریپت‌نویسی، [راهنمای CLI و شواهد](../cli.md) را ببینید.

### به‌روزرسانی REA

REA به‌سرعت تغییر می‌کند و نسخه‌های جدید معمولاً شامل رفع اشکال‌های متعددی هستند. نصب خود را به‌روز نگه دارید.

برای CLI نصب‌شده از طریق `npm install --global` / `bun add --global`:

```bash
rea update
```

`rea --update` نام مستعار `rea update` با همان گزینه‌های عمومی خروجی است. فرمان‌های به‌روزرسانی در مجموع حداکثر 4 MiB از stdout/stderr را نگه می‌دارند. پاسخ فرادادهٔ بزرگ‌تر پس از پایان فرمان رد می‌شود؛ نصب‌های پرخروجی تشخیص‌های محدود دارند. نمایش پیشرفت فشار برگشتی ترمینال را رعایت و تا پایان نوشتن‌های ارسال‌شده صبر می‌کند.

به‌روزرسانی سراسری با Bun به Bun 1.2.17 یا جدیدتر نیاز دارد. پیش از اجرای `rea update` نسخه‌های قدیمی‌تر Bun را دستی ارتقا دهید.

برای به‌روزرسانی ثبت ایجنت‌ها و skill، دستور setup نمایش‌داده‌شده توسط به‌روزرسانی را اجرا کنید.

اگر از `npx` استفاده می‌کنید، راه‌اندازی ایجنت را با دستور زیر به‌روز کنید:

```bash
npx rea-agents@latest setup
```

تغییرات راه‌اندازی را بررسی کنید و ایجنت را دوباره اجرا کنید. برای اجرای یک‌بارهٔ دستورات CLI، از `npx rea-agents@latest` و سپس دستور موردنظر استفاده کنید.

با Bun، به‌جای `npx rea-agents@latest` از `bunx rea-agents@latest` استفاده کنید.

## REA چگونه کار می‌کند؟

ایجنت شما از طریق MCP، REA را فراخوانی می‌کند تا هدف را بررسی و کد مرتبط را ردیابی کند. REA یافته‌ها را همراه با شواهد برمی‌گرداند. ایجنت از این نتایج برای طرح پرسش‌های تکمیلی، توضیح رفتار یا نوشتن و آزمایش یک پیاده‌سازی استفاده می‌کند. دستورات CLI نیز از همین گردش‌کارها بهره می‌برند.

![جریان بررسی REA: ایجنت دربارهٔ هدف محلی سؤال می‌پرسد، REA آن را با ابزارهای تحلیل بررسی و ردیابی می‌کند و ایجنت از کد، ارجاعات و ناشناخته‌های بازگردانده‌شده برای توضیح، پیاده‌سازی و آزمایش استفاده می‌کند.](../../website/public/assets/figures/rea-investigation-flow.svg)

[نمایش تصویر در اندازهٔ کامل](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## چه چیزهایی را می‌توان تحلیل کرد؟

REA به Node.js 22.x (>=22.23.4)، 24.x (>=24.22.1) یا 26+ (>=26.12.1)، به‌همراه npm نیاز دارد. ابزارهای اضافی و پشتیبانی سیستم میزبان به نوع هدف بستگی دارند:

| هدف                    | خروجی REA                                                                           | پیش‌نیازها و راهنما                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| باینری‌های بومی         | شبه‌کد، اسمبلی، رشته‌ها، نمادها، فراخوانی‌ها و ارجاعات                                 | Hopper، Ghidra، IDA یا Kuna؛ [تحلیل بومی](../native-investigation.md)                                                             |
| ساختار ELF آفلاین       | بخش‌ها، سگمنت‌ها، نمادها و relocationهای اصلی و گزینه‌های احتمالی کاهش آسیب‌پذیری ایستا | pwntools تأمین‌شده توسط فراخواننده روی Linux x64؛ [تشخیص باینری](../binary-diagnostics.md)                                         |
| PE certificates        | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields        | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                           |
| PE imports             | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash          | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                     |
| بایت‌کد EVM             | selectorهای dispatch، offsetهای بایتی، آرگومان‌های استنباط‌شده و قابلیت تغییر وضعیت   | دادهٔ خام/hex محلی روی Linux x64؛ [راهنمای EVM آفلاین](../evm-bytecode.md)                                                          |
| Rust binaries          | Embedded cargo-auditable dependency list                                            | [Rust binaries](../rust-binaries.md)                                                                                              |
| ELF notes              | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                     | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                      |
| Apple IPS crashes      | .ips metadata, threads, images, registers and crash classes                         | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                     |
| Linux kernel modules   | .modinfo keys, __versions CRCs, this_module presence, and signature trailer         | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                            |
| Erlang BEAM            | IFF chunks, atoms, exports, and tables                                              | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                 |
| کرش‌های ثبت‌شدهٔ لینوکس   | یادداشت‌های خام، رجیسترها/سیگنال‌های تمام threadهای ثبت‌شده و گزینه‌های احتمالی نگاشت   | pwntools تأمین‌شده توسط فراخواننده روی Linux x64؛ GDB/pwndbg اختیاری؛ [کرش‌های ثبت‌شده](../recorded-crashes.md)                      |
| نصب‌های دسکتاپ          | نامزدهای زمان اجرا، فایل‌های شاهد، نشانه‌های مؤلفه‌ها و مراحل بعدی                     | بررسی محدود پوشه‌ها و سرآیندها；[برنامه‌های دسکتاپ](../desktop-applications.md)                                                     |
| JavaScript / Electron  | ماژول‌ها، importها، source mapها، مسیرها، IPC و ارتباط افزونه‌های بومی                | Node.js و npm؛ [تحلیل برنامه](../javascript-application-workflows.md); Linux: procps `ps`                                         |
| وب‌سایت‌ها               | ساختار صفحه، اسکریپت‌ها، مشاهدات شبکه و اسکرین‌شات‌های درخواستی                        | مرورگر مبتنی بر Chrome؛ [تحلیل مرورگر](../browser-observation.md)                                                                 |
| داده‌های ضبط‌شدهٔ شبکه    | درخواست‌ها، پاسخ‌ها، payloadهای آشکارشده و مکان آن‌ها در منبع                          | HAR / Fiddler Everywhere SAZ؛ ابزار mitmdump در لینوکس برای ضبط‌های بومی mitmproxy؛ [راهنمای ضبط شبکه](../web-network-captures.md) |
| اسمبلی‌های .NET         | فراداده، دستورالعمل‌های CIL، وابستگی‌های بومی اعلام‌شده و مقایسهٔ buildها                | بررسی ایستا؛ [راهنمای کد مدیریت‌شده](../managed-code-analysis.md)                                                                  |
| PyInstaller            | CArchive, PYZ, Python bytecode                                                      | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                             |
| فایل‌های APK اندروید    | تعاریف Manifest، کلاس‌ها، متدهای دیکامپایل‌شده و ارجاعات                               | JADX بدون رابط گرافیکی و JDK کامل در Linux/macOS/Windows x64؛ [راهنمای اندروید](../android-analysis.md)                           |
| دستگاه‌های اندروید      | دستگاه‌ها، بسته‌ها، فرایندها، لاگ‌ها، دامپ‌ها، اسکرین‌شات‌ها و انتقال APK/فایل             | adb تأمین‌شده توسط فراخوان‌کننده (شبیه‌ساز یا دستگاه)؛ [راهنمای ADB](../adb-device-analysis.md)                                      |
| پروژه‌های JEB           | واحدهای پروژه از موتور، هش‌های مصنوع و شبه‌کدِ نوع/متد                                 | یک کلاینت JEB که توسط فراخوان‌کننده اجرا شده و MCP ارائه می‌دهد و با REA_JEB_MCP_URL انتخاب می‌شود؛ [راهنمای JEB](../jeb-analysis.md) |
| منابع اندروید          | مانیفست رمزگشایی‌شده، جداول رشته‌ها، زبان‌ها و اطلاعات نسخه                             | راه‌انداز Apktool تأمین‌شده توسط فراخوان‌کننده؛ [راهنمای منابع](../apktool-resource-analysis.md)                                     |
| برنامه‌های فلاتر         | هش اسنپ‌شات دارت، هش کتابخانه‌ها به تفکیک ABI و اصالت بیلد موتور                      | هیچ (تحلیل ایستا APK)؛ [راهنمای فلاتر](../flutter-analysis.md)                                                                     |
| Firmware               | ناحیه‌ها، نتایج استخراج و تحویل به ابزارهای تحلیل بومی                               | Binwalk / Unblob در لینوکس؛ [راهنمای Firmware](../firmware-analysis.md)                                                           |
| بسته‌های ضبط‌شده         | فیلدهای منتخب، مقادیر تکراری، فیلترها و قواعد رمزگشایی                              | Linux: TShark 4.x + prlimit; [راهنمای ضبط بسته](../packet-captures.md)                                                            |
| ضبط بسته‌ها             | نقاط پایانی، DNS، TLS SNI، توزیع پروتکل و درخواست‌های HTTP                           | tshark و capinfos تأمین‌شده توسط فراخوان‌کننده؛ [راهنمای pcap](../pcap-analysis.md)                                                 |
| سیگنال‌های منطقی ضبط‌شده | توضیحات رمزگشا، بازه‌های نمونه و اطلاعات عیب‌یابی                                      | Linux: sigrok-cli 0.7.2 + prlimit; [راهنمای سیگنال‌ها](../signal-recordings.md)                                                    |
| بسته‌ها و منابع         | فهرست فایل‌ها، digestها، فایل‌های plist، ساختار bundle اپل و منابع استخراج‌شده         | [راهنمای آرتیفکت و JavaScript](../javascript-artifact-reconstruction.md)، [برنامه‌های اپل](../apple-application-analysis.md)       |
| رفتار فرایند           | خروجی ترمینال، تعاملات، وضعیت خروج، مشاهدات سیستم فایل و مقایسهٔ اجراها               | Linux/macOS با PTY بومی؛ [ضبط فرایند](../process-capture.md)                                                                      |
| باینری‌های Go           | نسخهٔ کامپایلر تعبیه‌شده، ماژول‌ها، جایگزینی‌ها و تنظیمات ساخت                          | بررسی ایستای داخلی ELF/PE/thin Mach-O; نصب Go لازم نیست                                                                            |
| پایگاه‌های SQLite       | جدول‌ها، ستون‌ها، ایندکس‌ها، نماها، تریگرها و سطرهای انتخاب‌شدهٔ جدول‌های عادی            | snapshot محلی پایگاه/WAL؛ Node.js 24.x >=24.15 یا 26+ با محدودیت‌های بومی SQLite                                                   |
| اشیای کد GPU           | هدف‌های CUDA/HIP، پارامترها و منابع کرنل‌های انتخاب‌شده و متن PTX نگه‌داری‌شده           | بررسی ایستای داخلی ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                         |
| فایل‌های مدل            | فرادادهٔ GGUF / safetensors، اعلان تانسورها و مجموع‌های مشتق‌شده                        | بررسی هدر؛ هش کل فایل اختیاری است; [GGUF / safetensors](../model-artifacts.md)                                                    |
| فرادادهٔ IL2CPP         | تصاویر اسمبلی، نام نوع‌ها/متدها و بازهٔ ایندکس‌ها در Unity global-metadata.dat         | رمزگشایی ایستای نسخه‌های 24، 27، 29، 31 و 39؛ بدون نیاز به Unity                                                                   |
| Godot PCK              | فهرست و استخراج آرشیو، اطلاعات اصلی هدر/دایرکتوری و هویت محتوای انتخاب‌شده            | قالب‌های ایستای 2، 3 و 4؛ بدون نیاز به Godot                                                                                       |
| مصنوعات WASM           | اعتبارسنجی، بخش‌ها، فرم دقیق WAT ورودی/خروجی و WAT رمزگشایی‌شده                       | تهیه‌شده توسط کاربر WABT 1.0.42; `inspect_wasm_artifact`                                                                           |
| امضاهای APK            | امضاکنندگان v1/v2/v3/v3.1، اثر انگشت گواهی، چرخش کلید و سازگاری داخلی digest        | بررسی ایستای داخلی; `inspect_apk_signature`                                                                                       |

بررسی ایستای JavaScript و .NET فایل‌های ارائه‌شده را بدون اجرای برنامه می‌خواند. ضبط زمان اجرا، هدف انتخاب‌شده را با مجوزهای کاربری شما اجرا می‌کند یا با آن تعامل دارد؛ آثار این عملیات در راهنمای مربوط به هر نوع ضبط توضیح داده شده‌اند.

برای بررسی آفلاین فایل‌های باینری بومی، REA از GNU objdump و Rizin نیز پشتیبانی می‌کند؛ این ابزارها را باید خودتان فراهم کنید. [راهنمای ابزارهای مهندسی معکوس](../reverse-engineering-tools.md) تنظیم ارائه‌دهندگان، فرمان‌های CLI و محدودیت‌های Evidence را توضیح می‌دهد. REA هیچ‌یک از این دو ارائه‌دهنده را نصب یا به‌روزرسانی نمی‌کند.

<a id="choosing-a-deep-analysis-provider"></a>

برای باینری‌های بزرگ، مهلت شروع را با `REA_GHIDRA_STARTUP_TIMEOUT_MS` یا `REA_HOPPER_STARTUP_TIMEOUT_MS` افزایش دهید.

فرمت‌های بومی و پشتیبانی سیستم میزبان بر اساس ارائه‌دهنده متفاوت‌اند. [راه‌اندازی Hopper و Ghidra](../installation.md#hopper)، [راهنمای IDA](../ida-provider.md)، [Kuna](../kuna-provider.md) و [پشتیبانی آزمایشی Ghidra در ویندوز](../windows-ghidra-p0.md) را ببینید. Ghidra همچنین از [تحلیل DOS شانزده‌بیتی](../ghidra-dos.md) پشتیبانی می‌کند. برای انتخاب ارائه‌دهنده، به [راهنمای CLI](../cli.md#choose-a-provider) مراجعه کنید. برای قابلیت‌هایی که پس از آخرین انتشار npm اضافه شده‌اند، [وضعیت انتشار](../installation.md#released-package-and-main) را بررسی کنید.

## نمونه‌های عملی

<a href="https://rea.tools/fa/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="تصویرهایی از نمونه‌های پنینگ صدای DX-Ball، پل کلیپ‌بورد Notion و حلقهٔ گلوله‌های TH04" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: بازسازی محاسبهٔ موقعیت استریوی صدا

یک فراخوانی صوتی را تا تابع کمکی تبدیل موقعیت به pan دنبال کنید، دستورالعمل‌ها را بررسی کنید و شبه‌کد ناقص را به C تبدیل کنید. بازسازی حاصل، هر ۳٬۲۰۵ مورد آزمایش x86 اصلی را با موفقیت پشت سر می‌گذارد و هر ۶۳ بایت تابع کامپایل‌شده را دقیقاً بازتولید می‌کند.

[مطالعهٔ موردی](https://rea.tools/fa/showcase/dx-ball/) · [مخزن بازسازی](https://github.com/N0zoM1z0/dx-ball)

### Notion: ردیابی پل کلیپ‌بورد Electron

API کلیپ‌بورد در renderer را پیدا کنید، مسیر آن را از preload و IPC تا فرایند اصلی دنبال کنید و قالب غنی کلیپ‌بورد را بررسی کنید.

[مطالعهٔ موردی](https://rea.tools/fa/showcase/notion/)

### TH04: بازیابی محاسبهٔ حلقهٔ گلوله در DOS

دستورالعمل‌های ۱۶بیتی بازی اصلی PC-98 را بررسی کنید، محاسبات زاویهٔ ثابت و هدف‌گیری‌شده را بازیابی کنید و کد C++ بازسازی‌شده را با خروجی کامپایلر تاریخی مقایسه کنید.

[مطالعهٔ موردی](https://rea.tools/fa/showcase/th04/) · [مخزن بازسازی](https://github.com/N0zoM1z0/th04)

### ساخت محیط‌های RL با REA

یک نشست برنامهٔ وب را ضبط کنید، API آن را به ابزار تبدیل کنید و محیطی برای عامل هوش مصنوعی صادر کنید. آن را با AgentEnv اجرا کنید و کارها و بررسی پاداش را برای آموزش RL یا ارزیابی اضافه کنید.

[راهنمای ساخت محیط](https://rea.tools/guides/rl-environments/) ·
[نمایش را در X ببینید](https://x.com/reatools/status/2112574822584918075?s=20)

اگر از REA برای بررسی موضوع جالبی استفاده کرده‌اید، خوشحال می‌شویم آن را به اشتراک بگذارید. یک [issue](https://github.com/morluto/rea/issues) یا [pull request](https://github.com/morluto/rea/pulls) ثبت کنید و هدف، پرسش خود، نقش REA و یافته‌هایتان را توضیح دهید.

<a id="build-rl-environments"></a>

## ساخت محیط‌های RL

محیطی محلی بسازید تا عامل هوش مصنوعی بدون اجرای برنامهٔ اصلی، کارهایی مثل پیدا کردن یک مسئله یا ساخت پوشه را تمرین کند. از آن برای یادگیری تقویتی (RL) یا سنجش توانایی عامل در انجام کارها استفاده کنید.

REA درخواست‌ها و پاسخ‌های ضبط‌شدهٔ API را به ابزارهایی تبدیل می‌کند که عامل می‌تواند فراخوانی کند. محیط از داده‌های ضبط‌شده استفاده می‌کند و فقط تغییراتی را پشتیبانی می‌کند که اثرشان در ضبط تأیید شده باشد.

پس از راه‌اندازی REA در عامل، نشانی نمونه و کارهای مربوط به پوشه را با موارد خودتان جایگزین کنید:

```text
با REA از برنامهٔ وب آزمایشی من در این نشانی یک محیط RL بساز:
http://127.0.0.1:3000
فهرست کردن، ساختن، تغییر نام و حذف پوشه‌ها را پوشش بده. می‌توانی پوشه‌های
آزمایشی بسازی و حذف کنی، اما داده‌های موجود را تغییر نده.
در پوشه‌ای به نام my-env ذخیره کن، عملیات قابل استفاده را بررسی کن و روش اجرا را بگو.
```

<details>
<summary>استفاده از خط فرمان</summary>

اگر فایل ضبط درخواست‌ها و پاسخ‌های برنامه در مرورگر را دارید، از این فرمان‌ها استفاده کنید. اجرای نتیجه به AgentEnv و Docker هم نیاز دارد.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA محیطی آمادهٔ اجرا همراه با یک آزمون ساده برای بررسی شروع به کار و پاسخ‌گویی آن صادر می‌کند. آن را به چارچوب RL متصل کنید تا اهداف کارها و بررسی پاداش را تعریف و آموزش را اجرا کنید.

[راهنمای ساخت محیط](https://rea.tools/guides/rl-environments/) ·
[مرجع محیط‌ها](../agent-environments.md) ·
[نمایش را در X ببینید](https://x.com/reatools/status/2112574822584918075?s=20)

## پرسش‌های متداول

<details><summary><strong>کدام ایجنت‌ها می‌توانند از REA استفاده کنند؟</strong></summary>

هر ایجنتی که از سرورهای MCP محلی پشتیبانی کند. فرایند setup، [ایجنت‌های پشتیبانی‌شده](../installation.md#supported-agents) را پیکربندی می‌کند؛ سایر کلاینت‌ها می‌توانند از [ثبت دستی MCP](../installation.md#mcp-registry) استفاده کنند.

</details>

<details><summary><strong>آیا به Hopper، Ghidra، IDA یا Kuna نیاز دارم؟</strong></summary>

تحلیل عمیق بومی به یکی از آن‌ها نیاز دارد. بررسی ایستای JavaScript و .NET بدون موتور تحلیل بومی کار می‌کند. setup می‌تواند با تأیید شما Hopper را نصب کند؛ Ghidra، IDA و Kuna از نصب‌های موجود شما استفاده می‌کنند. [راه‌اندازی ارائه‌دهنده](../installation.md#hopper) را ببینید.

</details>

<details><summary><strong>آیا باید ابتدا Hopper را اجرا کنم؟</strong></summary>

REA زمانی که عملیاتی به Hopper نیاز داشته باشد آن را اجرا می‌کند. در macOS، ممکن است هنگام نخستین اجرا پنجره‌ای برای انتخاب حالت آزمایشی یا فعال‌سازی مجوز نمایش داده شود. [راه‌اندازی Hopper و رفع اشکال](../installation.md#launcher-paths-and-troubleshooting) را ببینید.

</details>

<details><summary><strong>نصب skill از skills.sh چه کاری انجام می‌دهد؟</strong></summary>

این skill دستورالعمل‌های بررسی را برای ایجنت فراهم می‌کند. برای ثبت سرور MCP مربوط به REA و نصب دستورالعمل‌های متناظر، `npx rea-agents setup` را اجرا کنید و سپس ایجنت را مجدداً راه‌اندازی کنید. [نصب مستقل skill](../installation.md#skill-only-installation) را ببینید.

</details>

<details><summary><strong>REA چه نوع کدی برمی‌گرداند؟</strong></summary>

تحلیل بومی، شبه‌کد و اسمبلی برمی‌گرداند. تحلیل JavaScript/Electron ماژول‌ها و روابط میان آن‌ها را بازیابی می‌کند. ایجنت شما از این یافته‌ها برای نوشتن و آزمایش یک پیاده‌سازی استفاده می‌کند؛ [نمونه‌های عملی](#نمونه‌های-عملی) مثال‌های گام‌به‌گام ارائه می‌دهند.

</details>

<details><summary><strong>آیا REA برنامهٔ من را آپلود می‌کند؟</strong></summary>

REA اهداف را به‌صورت محلی تحلیل می‌کند. ایجنت شما نتایج ابزارها را دریافت می‌کند و ارائه‌دهندهٔ مدل آن سیاست مستقل خود را دربارهٔ داده‌ها دارد.

</details>

<details><summary><strong>اگر با خطا مواجه شدم چه کنم؟</strong></summary>

ابتدا به‌روزرسانی کنید؛ ممکن است مشکل در نسخه‌ای جدید رفع شده باشد.

برای CLI نصب‌شده با npm:

```bash
rea update
```

برای راه‌اندازی ایجنت با `npx`:

```bash
npx rea-agents@latest setup
```

اگر از ایجنت استفاده می‌کنید، [به‌روزرسانی راه‌اندازی](#به‌روزرسانی-rea) را تکمیل و ایجنت را مجدداً اجرا کنید. همان کار را دوباره امتحان کنید. اگر مشکل ادامه داشت، یک [issue ثبت کنید](https://github.com/morluto/rea/issues) و نسخهٔ REA، نوع هدف، مراحل بازتولید و خروجی خطا را ذکر کنید.

</details>

## مستندات

از [راهنماهای عملی وب‌سایت](https://rea.tools/fa/guides/) شروع کنید. برای گزینه‌های دقیق، پیش‌نیازها و قراردادهای خروجی:

- [نصب و راه‌اندازی](../installation.md): ثبت ایجنت، پیکربندی ارائه‌دهنده، به‌روزرسانی و حذف نصب.
- [آمادگی و رفع اشکال](../installation.md#check-readiness-for-your-task): عیب‌یابی یک ایجنت یا موتور تحلیل.
- [CLI و شواهد](../cli.md): دستورات، انتخاب ارائه‌دهنده، snapshotها، ورود/خروج داده و وضعیت‌های خروج.
- [قراردادهای MCP](../mcp-contracts.md) و [پرامپت‌های ایجنت](../mcp-prompts.md): نتایج ابزارها، نشست‌ها و بررسی‌های هدایت‌شده.
- [فهرست ابزارها](../mcp-contracts.md#generated-catalog): فهرست تولیدشده هنگام build از ابزارها، ارائه‌دهندگان و دستورات CLI.
- [نقشهٔ راه](../roadmap.md): برنامه‌های آینده و پیگیری قابلیت‌ها.

آسیب‌پذیری‌ها را از طریق [SECURITY.md](../../SECURITY.md) گزارش کنید.

## تاریخچهٔ ستاره‌ها

🎉 **۴۰۰٬۰۰۰ ستارهٔ GitHub — سپاسگزاریم!**

از همهٔ کسانی که از REA استفاده می‌کنند، خطاها را گزارش می‌دهند، قابلیت‌های جدید پیشنهاد می‌کنند، buildها را آزمایش می‌کنند و در بهبود پروژه مشارکت دارند سپاسگزاریم.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date"><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" /><source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" /><img alt="تاریخچهٔ ستاره‌های GitHub پروژهٔ REA" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" /></picture></a>

## سلب مسئولیت

برای راهنمای استفادهٔ مسئولانه، [DISCLAIMER.md](../../DISCLAIMER.md) را ببینید.

REA برای پژوهش، آموزش، تعامل‌پذیری، حفظ نرم‌افزار و تحلیل نرم‌افزارهایی است که مالک آن‌ها هستید یا اجازهٔ بررسی آن‌ها را دارید، در چارچوب قانون.

The project's position on illegal or unauthorized use covers all REA
versions, distribution channels, and platforms; each copy retains its
applicable licenses.

## مشارکت

از کمک شما به REA استقبال می‌کنیم! برای گزارش خطا یا پیشنهاد قابلیت، یک [issue باز کنید](https://github.com/morluto/rea/issues) یا برای بهبود کد و مستندات [pull request بفرستید](https://github.com/morluto/rea/pulls).

برای راه‌اندازی محیط توسعه و بررسی‌ها، [CONTRIBUTING.md](../../CONTRIBUTING.md)، برای مراحل اعتبارسنجی [آزمایش‌ها](../testing.md) و برای ساختار پروژه [نقشهٔ معماری](../architecture.mermaid) را ببینید.

## مجوز

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

</div>
