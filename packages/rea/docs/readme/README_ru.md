<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · **Русский** · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: Реверс-инжиниринг чего угодно

### Один MCP для реверс-инжиниринга бинарных файлов, приложений и поведения во время выполнения.

**Нашли интересную функцию? Разберитесь, как она работает, вплоть до двоичного кода.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Сайт](https://rea.tools/ru/) · [Руководства](https://rea.tools/ru/guides/) · [Примеры](https://rea.tools/ru/showcase/)**

[Быстрый старт](#быстрый-старт) · [Как работает REA](#как-работает-rea) · [Что можно анализировать](#что-можно-анализировать) · [Примеры](#примеры) · [Создание RL-окружений](#build-rl-environments) · [Частые вопросы](#частые-вопросы) · [Документация](#документация)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> Официальные источники REA: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> Используйте ссылки на установку и выпуски из этих официальных источников. Похожее название репозитория или скопированный README не подтверждают, что скачиваемый файл является официальным.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA запускает мост анализа внутри Hopper при исследовании нативного бинарного файла" width="1200" />

<br /><br />

<table aria-label="Сообщество REA">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Присоединяйтесь к сообществу реверс-инжиниринга</strong>
  </a><br />
  <sub>Discord · Вопросы и ответы · Обмен результатами</sub>
</td>
</tr>
</table>

<br />

</div>

---

Увидели в приложении функцию, которую хотите добавить в свой продукт? Попросите агента исследовать её с помощью REA. Он может изучить приложение без исходного кода, объяснить работу функции, показать подтверждающие данные и создать подходящую реализацию для вашего проекта.

REA подключает вашего агента к инструментам для исследования нативных бинарных файлов, приложений JavaScript и Electron, сборок .NET и сайтов. Те же инструменты доступны в терминале. Анализ выполняется локально, а результаты содержат данные и ограничения, на которых основан каждый вывод.

Настройка регистрирует REA у агента и устанавливает соответствующие инструкции. Нативный анализ использует установленный Hopper, Ghidra, IDA или Kuna; Hopper можно установить после одобрения. Статическому анализу JavaScript нативный движок не нужен.

> **[Посетите сайт REA](https://rea.tools/ru/)**: там есть инструкции по настройке, иллюстрированные руководства и реальные исследования.

## Быстрый старт

В Linux для запуска Ghidra, JADX и инструментов прошивок, а также статического анализа JavaScript/Electron нужен совместимый с procps `ps` в `PATH` REA для проверки владения процессами. См. требование для Linux.

### Настройте агента

Если Node.js и npm установлены, выполните:

```bash
npx rea-agents setup
```

Выберите агентов, проверьте предлагаемые изменения и подтвердите их. Настройка добавляет MCP-сервер REA и соответствующие рабочие инструкции, сохраняя резервные копии существующих настроек. После этого перезапустите агента.

Настройка поддерживает Claude Code, Codex, Cursor, Gemini CLI, Grok Build и [других агентов](../installation.md#supported-agents). Настройка провайдеров и ручная регистрация MCP описаны в разделе [установка и настройка](../installation.md).

MCP по умолчанию использует компактные входные схемы. Для полного описания полей и вложенной валидации задайте `REA_MCP_INPUT_SCHEMA_PROFILE=full` в регистрации MCP. Оба профиля сохраняют все инструменты и одинаковую каноническую проверку на сервере; см. руководство по контрактам MCP.

### Задайте вопрос агенту

```text
Исследуй, как работает поиск в приложении Notes, покажи подтверждающие данные и создай похожую функцию для моего проекта.
```

Замените Notes нужным приложением и укажите функцию, которую хотите понять.

### Используйте терминал

Исследуйте распакованный каталог приложения JavaScript/Electron или файл ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Результат включает модули, импорты, границы Electron и подтверждающие данные. Замените путь своим, например `"D:/apps/example"` в Windows.

Для регулярного использования установите команду `rea`:

```bash
npm install --global rea-agents
rea --help
```

Для нативного анализа сначала настройте провайдер. Нативные команды, выбор провайдера, снимки и работу со скриптами описывает [руководство по CLI и Evidence](../cli.md).

### Обновите REA

REA быстро развивается, и новые версии часто содержат исправления ошибок. Регулярно обновляйте установленную версию.

Для CLI, установленного через `npm install --global` / `bun add --global`:

```bash
rea update
```

`rea --update` — псевдоним `rea update` с теми же глобальными параметрами вывода. Команды обновления сохраняют суммарно до 4 MiB stdout/stderr. Слишком большие метаданные отклоняются после завершения; подробные установки сохраняют ограниченную диагностику. Прогресс учитывает обратное давление терминала и ждёт завершения переданных записей.

Глобальные обновления через Bun требуют Bun 1.2.17 или новее. Перед `rea update` вручную обновите более старый Bun.

Чтобы обновить регистрации агентов и skill, выполните команду настройки, которую выведет обновление.

Если используете `npx`, обновите настройку агента командой:

```bash
npx rea-agents@latest setup
```

Проверьте изменения настроек и перезапустите агента. Для разовых команд CLI используйте `npx rea-agents@latest`, а затем нужную команду.

С Bun используйте `bunx rea-agents@latest` вместо `npx rea-agents@latest`.

## Как работает REA

Агент вызывает REA через MCP, чтобы исследовать цель и проследить связанный код. REA возвращает результаты вместе с подтверждающими данными. Агент использует их для уточняющих вопросов, объяснения поведения или написания и тестирования реализации. Команды CLI используют те же рабочие процессы.

![Процесс исследования с REA: агент задаёт вопрос о локальной цели, REA исследует её инструментами анализа, а агент использует возвращённый код, ссылки и неизвестные сведения для объяснения, реализации и тестирования.](../../website/public/assets/figures/rea-investigation-flow.svg)

[Открыть рисунок в полном размере](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## Что можно анализировать

REA требует Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) или 26+ (>=26.12.1), а также npm. Дополнительные инструменты и поддерживаемые системы зависят от цели:

| Цель                                | Что возвращает REA                                                                                                         | Требования и руководство                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Нативные бинарные файлы             | Псевдокод, ассемблер, строки, символы, вызовы и ссылки                                                                     | Hopper, Ghidra, IDA или Kuna; [нативный анализ](../native-investigation.md)                                                                                |
| Структура ELF без запуска           | Секции, сегменты, исходные символы/релокации и возможные механизмы защиты по данным статического анализа                   | pwntools, предоставленный вызывающей стороной, в Linux x64; [диагностика бинарных файлов](../binary-diagnostics.md)                                        |
| Байт-код EVM                        | Селекторы диспетчеризации, смещения байтов, предполагаемые аргументы и изменяемость состояния                              | Локальные необработанные байты или шестнадцатеричное представление в Linux x64; [руководство по EVM без запуска](../evm-bytecode.md)                       |
| Rust binaries                       | Embedded cargo-auditable dependency list                                                                                   | [Rust binaries](../rust-binaries.md)                                                                                                                       |
| PE certificates                     | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                                               | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                                                    |
| PE imports                          | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                                                 | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                                              |
| ELF notes                           | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                                                            | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                                               |
| Linux kernel modules                | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                                                | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                                                     |
| Erlang BEAM                         | IFF chunks, atoms, exports, and tables                                                                                     | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                                          |
| Apple IPS crashes                   | .ips metadata, threads, images, registers and crash classes                                                                | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                                              |
| Записанные сбои Linux               | Необработанные записи note, регистры/сигналы каждого записанного потока и необязательные кандидаты сопоставления с памятью | pwntools, предоставленный вызывающей стороной, в Linux x64; необязательные GDB/pwndbg; [записанные сбои](../recorded-crashes.md)                           |
| Установленные настольные приложения | Возможные среды выполнения, файлы с доказательствами, компоненты и дальнейшие шаги                                         | Ограниченная проверка каталогов и заголовков；[Настольные приложения](../desktop-applications.md)                                                          |
| JavaScript / Electron               | Модули, импорты, карты исходного кода, маршруты, IPC и связи с нативными дополнениями                                      | Node.js и npm; [анализ приложений](../javascript-application-workflows.md); Linux: procps `ps`                                                             |
| Сайты                               | Структура страницы, скрипты, наблюдения за сетью и запрошенные снимки экрана                                               | Браузер семейства Chrome; [анализ браузера](../browser-observation.md)                                                                                     |
| Сохранённые сетевые захваты         | Запросы, ответы, доступные полезные данные и позиции в источнике                                                           | HAR / Fiddler Everywhere SAZ; mitmdump в Linux для захватов в собственном формате mitmproxy; [руководство по сетевым захватам](../web-network-captures.md) |
| Сборки .NET                         | Метаданные, инструкции CIL, объявленные нативные зависимости и сравнения сборок                                            | Статическое исследование; [руководство по управляемому коду](../managed-code-analysis.md)                                                                  |
| Android APK                         | Объявления манифеста, классы, декомпилированные методы и ссылки                                                            | JADX без графического интерфейса и полный JDK в Linux/macOS/Windows x64; [руководство по Android](../android-analysis.md)                                  |
| Устройства Android                  | Устройства, пакеты, процессы, журналы, дампы, снимки экрана и передача APK/файлов                                          | adb, предоставленный вызывающей стороной (эмулятор или устройство); [руководство по ADB](../adb-device-analysis.md)                                        |
| Проекты JEB                         | Единицы проекта от движка, дайджесты артефактов и псевдокод типов/методов                                                  | Запущенный вызывающей стороной клиент JEB с интерфейсом MCP, выбирается через REA_JEB_MCP_URL; [руководство по JEB](../jeb-analysis.md)                    |
| Ресурсы Android                     | Декодированный манифест, таблицы строк, языки и сведения о версии                                                          | Запуск Apktool, предоставленный вызывающей стороной; [руководство по ресурсам](../apktool-resource-analysis.md)                                            |
| Приложения Flutter                  | Хеш снапшота Dart, дайджесты библиотек по ABI и происхождение сборки движка                                                | Не требуется (статический разбор APK); [руководство по Flutter](../flutter-analysis.md)                                                                    |
| Прошивки                            | Области, результаты извлечения и передача в нативный анализ                                                                | Binwalk / Unblob в Linux; [руководство по прошивкам](../firmware-analysis.md)                                                                              |
| Записанные пакеты                   | Выбранные поля, повторяющиеся значения, фильтры и правила декодирования                                                    | Linux: TShark 4.x + prlimit; [руководство по захватам](../packet-captures.md)                                                                              |
| Захват пакетов                      | Конечные точки, DNS, TLS SNI, распределение протоколов и HTTP-запросы                                                      | Предоставленные вызывающей стороной tshark и capinfos; [руководство по pcap](../pcap-analysis.md)                                                          |
| Записанные логические сигналы       | Аннотации декодера, диапазоны отсчётов и диагностика                                                                       | Linux: sigrok-cli 0.7.2 + prlimit; [руководство по сигналам](../signal-recordings.md)                                                                      |
| Пакеты и ресурсы                    | Списки файлов, хеши, plist, структура пакетов Apple и извлечённые ресурсы                                                  | [Руководство по артефактам и JavaScript](../javascript-artifact-reconstruction.md), [приложения Apple](../apple-application-analysis.md)                   |
| Поведение процессов                 | Вывод терминала, взаимодействия, наблюдения за завершением и файловой системой, сравнения запусков                         | Linux/macOS с нативным PTY; [захват процессов](../process-capture.md)                                                                                      |
| PyInstaller                         | CArchive, PYZ, Python bytecode                                                                                             | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                                                      |
| Бинарные файлы Go                   | Встроенная версия компилятора, модули, замены и параметры сборки                                                           | Встроенный статический анализ ELF/PE/thin Mach-O; Установка Go не нужна                                                                                    |
| Базы SQLite                         | Таблицы, столбцы, индексы, представления, триггеры и выбранные строки обычных таблиц                                       | Локальный снимок БД/WAL; Node.js 24.x >=24.15 или 26+ с нативными ограничениями SQLite                                                                     |
| Объекты кода GPU                    | Цели CUDA/HIP, параметры и ресурсы выбранных ядер, сохранённый текст PTX                                                   | Встроенный статический анализ ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                                       |
| Файлы моделей                       | Метаданные GGUF / safetensors, объявления тензоров и вычисленные итоги                                                     | Анализ заголовков; полный хеш файла по выбору; [GGUF / safetensors](../model-artifacts.md)                                                                 |
| Метаданные IL2CPP                   | Образы сборок Unity global-metadata.dat, имена типов/методов и диапазоны индексов                                          | Статическое декодирование версий 24, 27, 29, 31, 39; Unity не нужен                                                                                        |
| Godot PCK                           | Список и извлечение файлов, исходные заголовки/каталоги и идентификаторы выбранного содержимого                            | Статические форматы 2, 3, 4; Godot не нужен                                                                                                                |
| Артефакты WASM                      | Валидация, секции, точные WAT-формы импорта/экспорта и декодированный WAT                                                  | Предоставляется пользователем WABT 1.0.42; `inspect_wasm_artifact`                                                                                         |
| Подписи APK                         | Подписанты v1/v2/v3/v3.1, отпечатки сертификатов, ротация ключей и внутренняя согласованность хешей                        | Встроенный статический анализ; `inspect_apk_signature`                                                                                                     |

Статическое исследование JavaScript и .NET читает предоставленные файлы, не запуская приложение. Захват во время выполнения запускает выбранную цель или взаимодействует с ней с правами вашего пользователя; соответствующие руководства описывают последствия.

Для автономного анализа нативных бинарных файлов REA также поддерживает GNU objdump и Rizin, которые пользователь предоставляет самостоятельно. В [руководстве по инструментам обратной разработки](../reverse-engineering-tools.md) описаны настройка провайдеров, команды CLI и ограничения Evidence. REA не устанавливает и не обновляет ни один из этих провайдеров.

<a id="choosing-a-deep-analysis-provider"></a>

Для больших файлов увеличьте срок запуска через `REA_GHIDRA_STARTUP_TIMEOUT_MS` или `REA_HOPPER_STARTUP_TIMEOUT_MS`.

Нативные форматы и поддерживаемые системы различаются у разных провайдеров. См. [настройку Hopper и Ghidra](../installation.md#hopper), [руководство по IDA](../ida-provider.md), [Kuna](../kuna-provider.md) и [экспериментальную поддержку Ghidra в Windows](../windows-ghidra-p0.md). Ghidra также поддерживает [анализ 16-битного DOS](../ghidra-dos.md). Выбор провайдера описан в [руководстве по CLI](../cli.md#choose-a-provider). Для функций, добавленных после последней версии в npm, проверьте [доступность в релизах](../installation.md#released-package-and-main).

## Примеры

<a href="https://rea.tools/ru/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="Иллюстрации примеров панорамирования звука в DX-Ball, моста буфера обмена Notion и кольца пуль в TH04" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: восстановление расчёта звуковой панорамы

Проследите звуковой вызов до функции, преобразующей координату в значение панорамы, изучите инструкции и превратите неполный псевдокод в C. Восстановленная реализация проходит 3 205 тестов с исходным x86-кодом и воспроизводит все 63 байта скомпилированной функции.

[Прочитать исследование](https://rea.tools/ru/showcase/dx-ball/) · [Репозиторий реконструкции](https://github.com/N0zoM1z0/dx-ball)

### Notion: исследование моста буфера обмена Electron

Найдите API буфера обмена в процессе рендеринга, проследите его через preload и IPC до основного процесса и изучите формат буфера обмена с форматированием.

[Прочитать исследование](https://rea.tools/ru/showcase/notion/)

### TH04: восстановление расчёта кольца пуль в DOS

Изучите 16-битные инструкции оригинальной игры для PC-98, восстановите расчёты фиксированных и прицельных углов и сравните восстановленный C++ с выводом компилятора того времени.

[Прочитать исследование](https://rea.tools/ru/showcase/th04/) · [Репозиторий реконструкции](https://github.com/N0zoM1z0/th04)

### Создавайте RL-окружения с REA

Запишите сеанс веб-приложения, превратите его API в инструменты и экспортируйте окружение для ИИ-агента. Запустите его с AgentEnv, затем добавьте задания и проверки наград для RL-обучения или оценки.

[Руководство по созданию окружения](https://rea.tools/guides/rl-environments/) ·
[Смотреть демо в X](https://x.com/reatools/status/2112574822584918075?s=20)

Если вы исследовали с REA что-то интересное, поделитесь результатом. Создайте [issue](https://github.com/morluto/rea/issues) или [pull request](https://github.com/morluto/rea/pulls) и укажите цель, ваш вопрос, как помог REA и что удалось узнать.

<a id="build-rl-environments"></a>

## Создание RL-окружений

Создайте локальное окружение, где ИИ-агент сможет выполнять пробные задания, например искать задачу в трекере или создавать папку, без запуска исходного приложения. Используйте его для обучения с подкреплением (RL) или проверки того, как агент справляется с заданиями.

REA превращает записанные API-запросы и ответы в инструменты, которые может вызывать агент. Окружение использует записанные данные и поддерживает изменения только тогда, когда запись подтверждает их эффект.

Настройте REA в своём агенте, затем замените пример URL и операции с папками на свои:

```text
С помощью REA создай RL-окружение из моего тестового веб-приложения:
http://127.0.0.1:3000
Включи просмотр списка папок, создание, переименование и удаление.
Можно создавать и удалять тестовые папки. Существующие данные не меняй.
Сохрани в папку my-env, проверь доступные операции и расскажи, как запустить окружение.
```

<details>
<summary>Использовать командную строку</summary>

Эти команды подходят, если у вас уже есть файл с записанными запросами и ответами приложения в браузере. Для запуска результата также нужны AgentEnv и Docker.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA экспортирует готовое к запуску окружение с базовым тестом запуска и ответов. Подключите его к своему RL-фреймворку, чтобы задать цели, добавить проверки наград и запустить обучение.

[Руководство по созданию окружения](https://rea.tools/guides/rl-environments/) ·
[Справочник окружений](../agent-environments.md) ·
[Смотреть демо в X](https://x.com/reatools/status/2112574822584918075?s=20)

## Частые вопросы

<details>
<summary><strong>Какие агенты могут использовать REA?</strong></summary>

Любой агент с поддержкой локальных MCP-серверов. Настройка конфигурирует [поддерживаемых агентов](../installation.md#supported-agents); другие клиенты могут использовать [ручную регистрацию MCP](../installation.md#mcp-registry).

</details>

<details>
<summary><strong>Нужны ли мне Hopper, Ghidra, IDA или Kuna?</strong></summary>

Углублённый нативный анализ использует один из этих инструментов. Статическое исследование JavaScript и .NET работает без движка нативного анализа. Настройка может установить Hopper после подтверждения; Ghidra, IDA и Kuna используют существующие установки. См. [настройку провайдеров](../installation.md#hopper).

</details>

<details>
<summary><strong>Нужно ли сначала запускать Hopper?</strong></summary>

REA запускает Hopper, когда он нужен для операции. В macOS при первом запуске может появиться диалог выбора деморежима или активации лицензии. См. [запуск Hopper и устранение неполадок](../installation.md#launcher-paths-and-troubleshooting).

</details>

<details>
<summary><strong>Что даёт установка skill с skills.sh?</strong></summary>

Skill предоставляет агенту инструкции по исследованию. Используйте `npx rea-agents setup`, чтобы зарегистрировать MCP-сервер REA и установить соответствующие инструкции, затем перезапустите агента. См. [установку только skill](../installation.md#skill-only-installation).

</details>

<details>
<summary><strong>Какой код возвращает REA?</strong></summary>

Нативный анализ возвращает псевдокод и ассемблер. Анализ JavaScript/Electron восстанавливает модули и их связи. Агент использует эти результаты, чтобы написать и протестировать реализацию; в [примерах](#примеры) показаны практические исследования.

</details>

<details>
<summary><strong>REA загружает моё приложение на сервер?</strong></summary>

REA анализирует цели локально. Ваш агент получает результаты инструментов, а у его поставщика моделей есть собственная политика обработки данных.

</details>

<details>
<summary><strong>Что делать, если я столкнулся с ошибкой?</strong></summary>

Сначала обновитесь: недавний релиз мог уже исправить ошибку.

Для CLI, установленного через npm:

```bash
rea update
```

Для настройки агента через `npx`:

```bash
npx rea-agents@latest setup
```

Если используете агента, завершите [обновление настройки](#обновите-rea) и перезапустите его. Повторите ту же задачу. Если проблема сохраняется, [откройте issue](https://github.com/morluto/rea/issues), указав версию REA, тип цели, шаги воспроизведения и вывод ошибки.

</details>

## Документация

Начните с [практических руководств](https://rea.tools/ru/guides/) на сайте. Точные параметры, требования и контракты результатов описаны здесь:

- [Установка и настройка](../installation.md): регистрация агентов, настройка провайдеров, обновление и удаление.
- [Готовность и устранение неполадок](../installation.md#check-readiness-for-your-task): диагностика конкретного агента или движка анализа.
- [CLI и Evidence](../cli.md): команды, выбор провайдера, снимки, импорт/экспорт и коды завершения.
- [Контракты MCP](../mcp-contracts.md) и [промпты агентов](../mcp-prompts.md): результаты инструментов, сеансы и исследования с подсказками.
- [Каталог инструментов](../mcp-contracts.md#generated-catalog): создаваемый при сборке перечень инструментов, провайдеров и команд CLI.
- [План развития](../roadmap.md): запланированные работы и отслеживание возможностей.

Сообщайте об уязвимостях согласно [SECURITY.md](../../SECURITY.md).

## История звёзд

🎉 **400 000 звёзд на GitHub — спасибо!**

Спасибо всем, кто использует REA, сообщает об ошибках, предлагает новые функции, тестирует сборки и помогает с исправлениями.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="История звёзд REA на GitHub" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Отказ от ответственности

Рекомендации по ответственному использованию приведены в [DISCLAIMER.md](../../DISCLAIMER.md).

REA предназначен для законных исследований, обучения, обеспечения совместимости, сохранения программного обеспечения и анализа программ, которыми вы владеете или которые вам разрешено изучать.

The project's position on illegal or unauthorized use covers all REA
versions, distribution channels, and platforms; each copy retains its
applicable licenses.

## Участие в проекте

Будем рады вашей помощи с REA! [Откройте issue](https://github.com/morluto/rea/issues), чтобы сообщить об ошибке или предложить функцию, либо [отправьте pull request](https://github.com/morluto/rea/pulls) с улучшениями кода или документации.

Настройка среды разработки и проверки описаны в [CONTRIBUTING.md](../../CONTRIBUTING.md), направления проверки — в [руководстве по тестированию](../testing.md), а структура проекта — на [схеме архитектуры](../architecture.mermaid).

## Лицензия

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
