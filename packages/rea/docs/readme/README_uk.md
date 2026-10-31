<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · **Українська** · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: Реверс-інжиніринг будь-чого

### Один MCP для реверс-інжинірингу бінарних файлів, застосунків і поведінки під час виконання.

**Побачили цікаву функцію? Зрозумійте, як вона працює, аж до рівня двійкового коду.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Сайт](https://rea.tools/uk/) · [Посібники](https://rea.tools/uk/guides/) · [Приклади](https://rea.tools/uk/showcase/)**

[Швидкий старт](#швидкий-старт) · [Як працює REA](#як-працює-rea) · [Що можна аналізувати](#що-можна-аналізувати) · [Приклади](#приклади) · [Створення RL-середовищ](#build-rl-environments) · [Поширені запитання](#поширені-запитання) · [Документація](#документація)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> Офіційні джерела REA: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> Користуйтеся посиланнями на встановлення та випуски з цих офіційних джерел. Схожа назва репозиторію або скопійований README не підтверджують, що завантажуваний файл є офіційним.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA запускає міст аналізу всередині Hopper під час дослідження нативного бінарного файла" width="1200" />

<br /><br />

<table aria-label="Спільнота REA">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Приєднуйтеся до спільноти реверс-інжинірингу</strong>
  </a><br />
  <sub>Discord · Запитання й відповіді · Обмін результатами</sub>
</td>
</tr>
</table>

<br />

</div>

---

Побачили в застосунку функцію, яку хочете додати до свого продукту? Попросіть агента дослідити її за допомогою REA. Він може перевірити застосунок без вихідного коду, пояснити роботу функції, показати підтвердження та створити реалізацію для вашого проєкту.

REA підключає вашого агента до інструментів дослідження нативних бінарних файлів, застосунків JavaScript і Electron, збірок .NET та сайтів. Ті самі інструменти можна використовувати з термінала. Аналіз виконується локально, а результати містять підтвердження й обмеження, на яких ґрунтується кожен висновок.

Налаштування реєструє REA в агенті та встановлює відповідні інструкції. Нативний аналіз використовує наявний Hopper, Ghidra, IDA або Kuna; Hopper можна встановити після схвалення. Статичний аналіз JavaScript не потребує нативного рушія.

> **[Відвідайте сайт REA](https://rea.tools/uk/)**, щоб знайти інструкції налаштування, ілюстровані посібники та реальні дослідження.

## Швидкий старт

У Linux для запуску Ghidra, JADX та інструментів прошивок, а також статичного аналізу JavaScript/Electron потрібен сумісний із procps `ps` у `PATH` REA для перевірки володіння процесами. Див. передумову для Linux.

### Налаштуйте агента

Якщо Node.js і npm встановлено, виконайте:

```bash
npx rea-agents setup
```

Виберіть агентів, перевірте запропоновані зміни та схваліть їх. Налаштування додає MCP-сервер REA та відповідні інструкції робочих процесів, створюючи резервні копії наявної конфігурації. Після цього перезапустіть агента.

Налаштування підтримує Claude Code, Codex, Cursor, Gemini CLI, Grok Build та [інших агентів](../installation.md#supported-agents). Конфігурацію провайдерів і ручну реєстрацію MCP описано в розділі [встановлення й налаштування](../installation.md).

MCP типово використовує компактні вхідні схеми. Для повного опису полів і вкладеної перевірки задайте `REA_MCP_INPUT_SCHEMA_PROFILE=full` у реєстрації MCP. Обидва профілі зберігають усі інструменти й однакову канонічну перевірку сервера; див. посібник контрактів MCP.

### Запитайте агента

```text
Досліди, як працює пошук у застосунку Notes, покажи підтвердження й створи подібну функцію для мого проєкту.
```

Замініть Notes цільовим застосунком і вкажіть функцію, яку хочете зрозуміти.

### Використовуйте термінал

Перевірте розпакований каталог застосунку JavaScript/Electron або файл ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Результат містить модулі, імпорти, межі Electron і підтвердження для них. Замініть шлях своїм, наприклад `"D:/apps/example"` у Windows.

Для регулярного використання встановіть команду `rea`:

```bash
npm install --global rea-agents
rea --help
```

Для нативного аналізу спочатку налаштуйте провайдера. Нативні команди, вибір провайдера, знімки та використання у скриптах описує [посібник CLI та Evidence](../cli.md).

### Оновіть REA

REA швидко розвивається, а нові випуски часто містять виправлення помилок. Підтримуйте встановлену версію актуальною.

Для CLI, встановленого через `npm install --global` / `bun add --global`:

```bash
rea update
```

`rea --update` — псевдонім `rea update` із тими самими глобальними параметрами виводу. Оновлення зберігає сумарно до 4 MiB stdout/stderr. Завеликі метадані відхиляються після завершення; докладне встановлення зберігає обмежену діагностику. Прогрес враховує зворотний тиск термінала й чекає завершення переданих записів.

Глобальні оновлення Bun потребують Bun 1.2.17 або новішого. Перед `rea update` вручну оновіть старішу версію Bun.

Щоб оновити реєстрації агентів і skill, виконайте команду налаштування, яку виведе оновлення.

Якщо використовуєте `npx`, оновіть налаштування агента командою:

```bash
npx rea-agents@latest setup
```

Перевірте зміни налаштувань і перезапустіть агента. Для разових команд CLI використовуйте `npx rea-agents@latest`, а потім потрібну команду.

З Bun використовуйте `bunx rea-agents@latest` замість `npx rea-agents@latest`.

## Як працює REA

Агент викликає REA через MCP, щоб перевірити ціль і простежити пов'язаний код. REA повертає знахідки разом із підтвердженнями. Агент використовує їх для уточнювальних запитань, пояснення поведінки або написання й тестування реалізації. Команди CLI використовують ті самі робочі процеси.

![Процес дослідження з REA: агент запитує про локальну ціль, REA перевіряє й простежує її інструментами аналізу, а агент використовує повернений код, посилання та невідомі дані для пояснення, реалізації й тестування.](../../website/public/assets/figures/rea-investigation-flow.svg)

[Відкрити зображення в повному розмірі](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## Що можна аналізувати

REA потребує Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) або 26+ (>=26.12.1), а також npm. Додаткові інструменти й підтримувані системи залежать від цілі:

| Ціль                                 | Що повертає REA                                                                                                   | Вимоги й посібник                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Нативні бінарні файли                | Псевдокод, асемблерний код, рядки, символи, виклики й посилання                                                   | Hopper, Ghidra, IDA або Kuna; [нативний аналіз](../native-investigation.md)                                                                           |
| Структура ELF без запуску            | Секції, сегменти, початкові символи/релокації та можливі захисні механізми за даними статичного аналізу           | pwntools, наданий стороною, що викликає інструмент, у Linux x64; [діагностика бінарних файлів](../binary-diagnostics.md)                              |
| PE certificates                      | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                                      | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                                               |
| PE imports                           | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                                        | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                                         |
| Байт-код EVM                         | Селектори диспетчеризації, зміщення байтів, виведені припущення про аргументи та змінюваність стану               | Локальні необроблені байти або шістнадцяткове представлення у Linux x64; [посібник EVM без запуску](../evm-bytecode.md)                               |
| Rust binaries                        | Embedded cargo-auditable dependency list                                                                          | [Rust binaries](../rust-binaries.md)                                                                                                                  |
| ELF notes                            | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                                                   | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                                          |
| Linux kernel modules                 | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                                       | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                                                |
| Erlang BEAM                          | IFF chunks, atoms, exports, and tables                                                                            | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                                     |
| Apple IPS crashes                    | .ips metadata, threads, images, registers and crash classes                                                       | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                                         |
| Записані аварійні завершення в Linux | Необроблені записи note, регістри/сигнали кожного записаного потоку й необов'язкові кандидати зіставлення пам'яті | pwntools, наданий стороною, що викликає інструмент, у Linux x64; необов'язкові GDB/pwndbg; [записані аварійні завершення](../recorded-crashes.md)     |
| Встановлені настільні програми       | Можливі середовища виконання, файли доказів, компоненти та наступні кроки                                         | Обмежена перевірка каталогів і заголовків；[Настільні програми](../desktop-applications.md)                                                           |
| JavaScript / Electron                | Модулі, імпорти, карти вихідного коду, маршрути, IPC і зв'язки з нативними доповненнями                           | Node.js і npm; [аналіз застосунків](../javascript-application-workflows.md); Linux: procps `ps`                                                       |
| Сайти                                | Структура сторінки, скрипти, мережеві спостереження й запитані знімки екрана                                      | Браузер сімейства Chrome; [аналіз браузера](../browser-observation.md)                                                                                |
| Збережені мережеві захоплення        | Запити, відповіді, доступні корисні дані та місця в джерелі                                                       | HAR / Fiddler Everywhere SAZ; mitmdump у Linux для захоплень у власному форматі mitmproxy; [посібник мережевих захоплень](../web-network-captures.md) |
| Захоплення пакетів                   | Кінцеві точки, DNS, TLS SNI, розподіл протоколів та HTTP-запити                                                   | Надані викликаючою стороною tshark та capinfos; [підручник pcap](../pcap-analysis.md)                                                                 |
| Збірки .NET                          | Метадані, інструкції CIL, оголошені нативні залежності й порівняння збірок                                        | Статична перевірка; [посібник керованого коду](../managed-code-analysis.md)                                                                           |
| PyInstaller                          | CArchive, PYZ, Python bytecode                                                                                    | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                                                 |
| Android APK                          | Оголошення маніфесту, класи, декомпільовані методи й посилання                                                    | JADX без графічного інтерфейсу й повний JDK у Linux/macOS/Windows x64; [посібник Android](../android-analysis.md)                                     |
| Пристрої Android                     | Пристрої, пакети, процеси, журнали, дампи, знімки екрана та передавання APK/файлів                                | adb, наданий викликаючою стороною (емулятор або пристрій); [підручник ADB](../adb-device-analysis.md)                                                 |
| Проєкти JEB                          | Єдиниці проєкту від рушія, дайджести артефактів і псевдокод типів/методів                                         | Запущений викликаною стороною клієнт JEB з MCP, обирається через REA_JEB_MCP_URL; [посібник JEB](../jeb-analysis.md)                                  |
| Ресурси Android                      | Декодований маніфест, таблиці рядків, мови та відомості про версію                                                | Засіб запуску Apktool, наданий викликаючою стороною; [підручник ресурсів](../apktool-resource-analysis.md)                                            |
| Додатки Flutter                      | Хеш знімка Dart, дайджести бібліотек за ABI та походження збірки рушія                                            | Не потрібні (статичний розбір APK); [підручник Flutter](../flutter-analysis.md)                                                                       |
| Прошивки                             | Області, результати видобування й передавання до нативного аналізу                                                | Binwalk / Unblob у Linux; [посібник прошивок](../firmware-analysis.md)                                                                                |
| Записані пакети                      | Вибрані поля, повторювані значення, фільтри та правила декодування                                                | Linux: TShark 4.x + prlimit; [посібник із записів пакетів](../packet-captures.md)                                                                     |
| Записані логічні сигнали             | Анотації декодера, діапазони відліків і діагностика                                                               | Linux: sigrok-cli 0.7.2 + prlimit; [посібник із сигналів](../signal-recordings.md)                                                                    |
| Пакети й ресурси                     | Переліки файлів, хеші, plist, структура пакетів Apple та видобуті ресурси                                         | [Посібник артефактів і JavaScript](../javascript-artifact-reconstruction.md), [застосунки Apple](../apple-application-analysis.md)                    |
| Поведінка процесів                   | Вивід термінала, взаємодії, спостереження за завершенням і файловою системою та порівняння запусків               | Linux/macOS із нативним PTY; [захоплення процесів](../process-capture.md)                                                                             |
| Бінарні файли Go                     | Вбудована версія компілятора, модулі, заміни та налаштування збірки                                               | Вбудований статичний аналіз ELF/PE/thin Mach-O; Встановлювати Go не потрібно                                                                          |
| Бази SQLite                          | Таблиці, стовпці, індекси, подання, тригери та вибрані рядки звичайних таблиць                                    | Локальний знімок БД/WAL; Node.js 24.x >=24.15 або 26+ із нативними обмеженнями SQLite                                                                 |
| Об’єкти коду GPU                     | Цілі CUDA/HIP, параметри й ресурси вибраних ядер, збережений текст PTX                                            | Вбудований статичний аналіз ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                                    |
| Файли моделей                        | Метадані GGUF / safetensors, оголошення тензорів і обчислені підсумки                                             | Перевірка заголовків; повний хеш файлу за вибором; [GGUF / safetensors](../model-artifacts.md)                                                        |
| Метадані IL2CPP                      | Образи збірок Unity global-metadata.dat, імена типів/методів та діапазони індексів                                | Статичне декодування версій 24, 27, 29, 31, 39; Unity не потрібен                                                                                     |
| Godot PCK                            | Інвентар і видобування, оригінальні заголовки/каталоги та ідентичність вибраного вмісту                           | Статичні формати 2, 3, 4; Godot не потрібен                                                                                                           |
| Артефакти WASM                       | Валідація, секції, точні WAT-форми імпорту/експорту та декодований WAT                                            | Надає користувач WABT 1.0.42; `inspect_wasm_artifact`                                                                                                 |
| Підписи APK                          | Підписувачі v1/v2/v3/v3.1, відбитки сертифікатів, ротація ключів і внутрішня узгодженість хешів                   | Вбудований статичний аналіз; `inspect_apk_signature`                                                                                                  |

Статична перевірка JavaScript і .NET читає надані файли, не запускаючи застосунок. Захоплення під час виконання запускає вибрану ціль або взаємодіє з нею з правами вашого користувача; відповідні посібники описують його вплив.

Для автономного аналізу нативних бінарних файлів REA також підтримує GNU objdump і Rizin, які користувач надає самостійно. [Посібник з інструментів зворотної розробки](../reverse-engineering-tools.md) описує налаштування провайдерів, команди CLI та обмеження Evidence. REA не встановлює й не оновлює жодного з цих провайдерів.

<a id="choosing-a-deep-analysis-provider"></a>

Для великих файлів збільште час запуску через `REA_GHIDRA_STARTUP_TIMEOUT_MS` або `REA_HOPPER_STARTUP_TIMEOUT_MS`.

Нативні формати й підтримка систем відрізняються залежно від провайдера. Дивіться [налаштування Hopper і Ghidra](../installation.md#hopper), [посібник IDA](../ida-provider.md), [Kuna](../kuna-provider.md) та [експериментальну підтримку Ghidra у Windows](../windows-ghidra-p0.md). Ghidra також підтримує [аналіз 16-бітного DOS](../ghidra-dos.md). Для вибору провайдера дивіться [посібник CLI](../cli.md#choose-a-provider). Для функцій, доданих після найновішої версії в npm, перевірте [доступність у випусках](../installation.md#released-package-and-main).

## Приклади

<a href="https://rea.tools/uk/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="Ілюстрації прикладів панорамування звуку в DX-Ball, мосту буфера обміну Notion та кільця куль у TH04" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: відновлення розрахунку звукової панорами

Простежте звуковий виклик до допоміжної функції, що перетворює координату на панорамування, перевірте інструкції та перетворіть неповний псевдокод на C. Відновлена реалізація проходить 3 205 тестів з оригінальним x86-кодом і відтворює всі 63 байти скомпільованої функції.

[Прочитати дослідження](https://rea.tools/uk/showcase/dx-ball/) · [Репозиторій реконструкції](https://github.com/N0zoM1z0/dx-ball)

### Notion: відстеження мосту буфера обміну Electron

Знайдіть API буфера обміну в процесі рендерингу, простежте його через preload та IPC до головного процесу й перевірте формат буфера обміну з даними форматування.

[Прочитати дослідження](https://rea.tools/uk/showcase/notion/)

### TH04: відновлення розрахунку кільця куль у DOS

Перевірте 16-бітні інструкції оригінальної гри для PC-98, відновіть розрахунки фіксованих і прицільних кутів та порівняйте відновлений C++ із виводом тогочасного компілятора.

[Прочитати дослідження](https://rea.tools/uk/showcase/th04/) · [Репозиторій реконструкції](https://github.com/N0zoM1z0/th04)

### Створюйте RL-середовища з REA

Запишіть сеанс вебзастосунку, перетворіть його API на інструменти й експортуйте середовище для ШІ-агента. Запустіть його з AgentEnv, а потім додайте завдання та перевірки винагород для RL-навчання або оцінювання.

[Посібник зі створення середовища](https://rea.tools/guides/rl-environments/) ·
[Дивитися демо в X](https://x.com/reatools/status/2112574822584918075?s=20)

Якщо ви дослідили з REA щось цікаве, поділіться результатом. Створіть [issue](https://github.com/morluto/rea/issues) або [pull request](https://github.com/morluto/rea/pulls) і вкажіть ціль, ваше запитання, як допоміг REA та що ви з'ясували.

<a id="build-rl-environments"></a>

## Створення RL-середовищ

Створіть локальне середовище, де ШІ-агент може тренуватися виконувати завдання, як-от пошук issue або створення папки, без запуску початкового застосунку. Використовуйте його для навчання з підкріпленням (RL) або перевірки того, як агент виконує завдання.

REA перетворює записані API-запити й відповіді на інструменти, які може викликати агент. Середовище використовує записані дані й підтримує зміни лише тоді, коли запис підтверджує їхні ефекти.

Налаштуйте REA у своєму агенті та замініть URL і завдання з папками на власні:

```text
За допомогою REA створи RL-середовище з мого тестового вебзастосунку:
http://127.0.0.1:3000
Охопи перегляд списку папок, створення, перейменування й видалення.
Можна створювати й видаляти тестові папки. Наявні дані не змінюй.
Збережи в папку my-env, перевір доступні операції та поясни, як запустити середовище.
```

<details>
<summary>Використати командний рядок</summary>

Ці команди підходять, якщо у вас уже є файл із записаними запитами й відповідями застосунку в браузері. Для запуску результату також потрібні AgentEnv і Docker.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA експортує готове до запуску середовище з базовим тестом запуску й відповідей. Підключіть його до свого RL-фреймворку, щоб задати цілі, додати перевірки винагород і запустити навчання.

[Посібник зі створення середовища](https://rea.tools/guides/rl-environments/) ·
[Довідник середовищ](../agent-environments.md) ·
[Дивитися демо в X](https://x.com/reatools/status/2112574822584918075?s=20)

## Поширені запитання

<details>
<summary><strong>Які агенти можуть використовувати REA?</strong></summary>

Будь-який агент, що підтримує локальні MCP-сервери. Налаштування конфігурує [підтримуваних агентів](../installation.md#supported-agents); інші клієнти можуть використати [ручну реєстрацію MCP](../installation.md#mcp-registry).

</details>

<details>
<summary><strong>Чи потрібні мені Hopper, Ghidra, IDA або Kuna?</strong></summary>

Поглиблений нативний аналіз використовує один із цих інструментів. Статична перевірка JavaScript і .NET працює без рушія нативного аналізу. Налаштування може встановити Hopper після схвалення; Ghidra, IDA й Kuna використовують наявні встановлення. Дивіться [налаштування провайдерів](../installation.md#hopper).

</details>

<details>
<summary><strong>Чи потрібно спочатку запускати Hopper?</strong></summary>

REA запускає Hopper, коли він потрібен для операції. У macOS під час першого запуску може з'явитися діалог вибору деморежиму або активації ліцензії. Дивіться [запуск Hopper та усунення неполадок](../installation.md#launcher-paths-and-troubleshooting).

</details>

<details>
<summary><strong>Що дає встановлення skill із skills.sh?</strong></summary>

Skill надає агенту інструкції дослідження. Використовуйте `npx rea-agents setup`, щоб зареєструвати MCP-сервер REA та встановити відповідні інструкції, а потім перезапустіть агента. Дивіться [встановлення лише skill](../installation.md#skill-only-installation).

</details>

<details>
<summary><strong>Який код повертає REA?</strong></summary>

Нативний аналіз повертає псевдокод і асемблерний код. Аналіз JavaScript/Electron відновлює модулі та їхні зв'язки. Агент використовує ці результати, щоб написати й протестувати реалізацію; [приклади](#приклади) містять практичні дослідження.

</details>

<details>
<summary><strong>Чи завантажує REA мій застосунок на сервер?</strong></summary>

REA аналізує цілі локально. Ваш агент отримує результати інструментів, а постачальник його моделі має власну політику даних.

</details>

<details>
<summary><strong>Що робити, якщо я зіткнувся з помилкою?</strong></summary>

Спочатку оновіться: нещодавній випуск уже міг виправити помилку.

Для CLI, встановленого через npm:

```bash
rea update
```

Для налаштування агента через `npx`:

```bash
npx rea-agents@latest setup
```

Якщо використовуєте агента, завершіть [оновлення налаштувань](#оновіть-rea) і перезапустіть його. Повторіть те саме завдання. Якщо проблема залишається, [відкрийте issue](https://github.com/morluto/rea/issues) із версією REA, типом цілі, кроками відтворення та виводом помилки.

</details>

## Документація

Почніть із [практичних посібників](https://rea.tools/uk/guides/) на сайті. Точні параметри, передумови й контракти результатів описано тут:

- [Встановлення й налаштування](../installation.md): реєстрація агентів, конфігурація провайдерів, оновлення та видалення.
- [Готовність та усунення неполадок](../installation.md#check-readiness-for-your-task): діагностика конкретного агента або рушія аналізу.
- [CLI та Evidence](../cli.md): команди, вибір провайдера, знімки, імпорт/експорт і статуси завершення.
- [Контракти MCP](../mcp-contracts.md) і [промпти агентів](../mcp-prompts.md): результати інструментів, сеанси й керовані дослідження.
- [Каталог інструментів](../mcp-contracts.md#generated-catalog): створюваний під час збірки перелік інструментів, провайдерів і команд CLI.
- [План розвитку](../roadmap.md): заплановані роботи й відстеження можливостей.

Повідомляйте про вразливості згідно з [SECURITY.md](../../SECURITY.md).

## Історія зірок

🎉 **400 000 зірок на GitHub — дякуємо!**

Дякуємо всім, хто використовує REA, повідомляє про помилки, пропонує нові функції, тестує збірки й допомагає з виправленнями.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="Історія зірок REA на GitHub" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Відмова від відповідальності

Рекомендації щодо відповідального використання наведено в [DISCLAIMER.md](../../DISCLAIMER.md).

REA призначений для законних досліджень, навчання, забезпечення сумісності, збереження програмного забезпечення й аналізу програм, якими ви володієте або які маєте дозвіл досліджувати.

The project's position on illegal or unauthorized use covers all REA
versions, distribution channels, and platforms; each copy retains its
applicable licenses.

## Участь у проєкті

Будемо раді вашій допомозі з REA! [Відкрийте issue](https://github.com/morluto/rea/issues), щоб повідомити про помилку чи запропонувати функцію, або [надішліть pull request](https://github.com/morluto/rea/pulls) з поліпшеннями коду чи документації.

Налаштування середовища розробки й перевірки описано в [CONTRIBUTING.md](../../CONTRIBUTING.md), шляхи верифікації — у [посібнику тестування](../testing.md), а структуру проєкту — на [схемі архітектури](../architecture.mermaid).

## Ліцензія

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
