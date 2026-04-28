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

<h3 align="center">Первый open-source AI-агент, созданный для наступательной безопасности.</h3>

<p align="center">
  Автономное пентестирование из вашего терминала — разведка, обнаружение уязвимостей, эксплуатация и отчётность.<br>
  Одна команда. 13+ специализированных агентов. 120+ тестовых сценариев OWASP. Ваш AI red team.
</p>

<p align="center">
  <a href="#почему-cyberstrike">Почему CyberStrike?</a> &bull;
  <a href="#чем-он-отличается">Чем Он Отличается</a> &bull;
  <a href="#агенты">Агенты</a> &bull;
  <a href="#экосистема-mcp">Экосистема MCP</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#установка">Установка</a> &bull;
  <a href="#встроенные-инструменты">Встроенные Инструменты</a> &bull;
  <a href="#для-кого-это">Для Кого Это?</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyberstrike-io/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/@cyberstrike-io/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Лицензия" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

---

### Почему CyberStrike?

Тестирование безопасности по-прежнему в подавляющем большинстве выполняется вручную. Пентестеры жонглируют десятками инструментов, копируют и вставляют результаты между терминалами и тратят часы на повторяющуюся разведку, прежде чем добраться до реальной поверхности атаки. Охотники за bug bounty теряют время на один и тот же workflow разведки для каждой программы.

**CyberStrike меняет это.** Это автономный AI-агент, который понимает методологию наступательной безопасности — он не просто запускает инструменты, а рассуждает о том, что тестировать, связывает находки между собой и адаптирует свой подход на основе того, что обнаруживает. Представьте неутомимого члена red team в вашем терминале, который следует OWASP WSTG, знает, когда сменить направление, и пишет отчёт по завершении.

```bash
npm i -g @cyberstrike-io/cyberstrike@latest && cyberstrike
# "Провести полную оценку OWASP WSTG на https://target.com"
```

Он open source, работает с любым провайдером LLM, и всё, что он производит, принадлежит вам.

---

### Чем Он Отличается

<table>
<tr>
<td width="50%">

**Специализированные Агенты Безопасности, Не Обычный Чат**

CyberStrike включает 13+ агентов, целенаправленно созданных для доменов безопасности. Каждый агент обладает специфической для домена методологией, знанием инструментов и паттернами тестирования. Агент web-application следует WSTG. Агент cloud-security знает бенчмарки CIS. Мобильный агент использует Frida и следует MASTG/MASVS. Они не гадают — они следуют проверенным фреймворкам.

</td>
<td width="50%">

**Автономный, Не Просто Вспомогательный**

Другие AI-инструменты ждут, пока вы скажете им, что делать дальше. Агенты CyberStrike планируют многоэтапные цепочки атак, выполняют инструменты, анализируют результаты, меняют направление, когда находят что-то интересное, и генерируют отчёты, подкреплённые доказательствами. Вы задаёте цель — они берут на себя методологию.

</td>
</tr>
<tr>
<td width="50%">

**Любой LLM, Без Привязки к Вендору**

15+ провайдеров из коробки: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — даже локальные модели через OpenAI-совместимые эндпоинты. Запускайте с Claude, GPT, Gemini или собственным self-hosted LLM. По мере того как модели становятся лучше и дешевле, CyberStrike становится лучше вместе с ними.

</td>
<td width="50%">

**Удалённое Выполнение Инструментов с Bolt**

Вашим инструментам безопасности не обязательно работать на вашем ноутбуке. Bolt — это удалённый сервер инструментов CyberStrike — разверните его на VPS с вашим набором для пентеста, свяжите ключами Ed25519 и управляйте всем из локального терминала по протоколу MCP. Один TUI, несколько серверов атаки.

</td>
</tr>
</table>

---

### Агенты

Переключайтесь между агентами клавишей `Tab`. Каждый из них — специалист.

| Агент                  | Область   | Что Он Делает                                                              |
| ---------------------- | --------- | -------------------------------------------------------------------------- |
| **cyberstrike**        | Общий     | Основной агент с полным доступом — разведка, эксплуатация, отчётность      |
| **web-application**    | Веб       | OWASP Top 10, методология WSTG, безопасность API, тестирование сессий      |
| **mobile-application** | Мобильные | Android/iOS, Frida/Objection, соответствие MASTG/MASVS                     |
| **cloud-security**     | Облако    | AWS, Azure, GCP — ошибки конфигурации IAM, бенчмарки CIS, открытые ресурсы |
| **internal-network**   | Сеть      | Active Directory, атаки Kerberos, горизонтальное перемещение, pivoting     |

Плюс **8 специализированных прокси-тестеров**, перехватывающих и модифицирующих трафик для целевых классов уязвимостей:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### Экосистема MCP

CyberStrike подключается к специализированным серверам MCP, расширяющим его возможности:

| Сервер                                                                 | Инструменты | Что Добавляет                                                                  |
| ---------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | 38          | Аудит облачной безопасности — 60+ проверок в AWS, Azure, GCP                   |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39          | Безопасность GitHub — репозитории, организация, actions, secrets, supply chain |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | 23          | Разведка CVE — NVD, EPSS, CISA KEV, GitHub Advisory, OSV                       |
| [osint-mcp](https://github.com/badchars/osint-mcp)                     | 37          | Разведка OSINT — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS        |

Все open source. Все устанавливаются через `npx`. Подключайте их к CyberStrike или используйте автономно с любым MCP-клиентом.

---

### Bolt

Bolt — это сервер удалённого выполнения инструментов CyberStrike. Вместо запуска инструментов безопасности на вашем ноутбуке разверните их на VPS (или нескольких) и управляйте всем из локального терминала.

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**Как это работает:**

- Разверните Bolt на любом сервере с установленным набором инструментов для пентеста
- Свяжите ключами Ed25519 — без паролей, без общих секретов
- Агенты CyberStrike вызывают инструменты удалённо по протоколу MCP
- Результаты передаются в реальном времени в ваш локальный TUI
- Управляйте подключениями из TUI: добавление, удаление, мониторинг статуса

**Почему это важно:** Ваша поверхность атаки остаётся на выделенной инфраструктуре. Запускайте тяжёлые сканирования с VPS с лучшей пропускной способностью, держите инструменты обновлёнными в одном месте и переключайтесь между несколькими серверами атаки из одного терминала.

---

### Установка

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

**Десктопное приложение** (macOS, Windows, Linux) — скачайте со [страницы релизов](https://github.com/CyberStrikeus/CyberStrike/releases) или:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Встроенные Инструменты

Агенты CyberStrike имеют прямой доступ к 30+ инструментам:

| Категория        | Инструменты                                                           |
| ---------------- | --------------------------------------------------------------------- |
| **Выполнение**   | Shell (bash), чтение/запись/редактирование файлов, просмотр каталогов |
| **Обнаружение**  | Web fetch, веб-поиск, поиск по коду, glob, grep                       |
| **Безопасность** | Отчётность по уязвимостям (формат HackerOne), сбор доказательств      |
| **Прокси**       | Перехват HTTP/HTTPS, повтор запросов, анализ трафика                  |
| **Интеграция**   | Серверы MCP, удалённые инструменты Bolt, пользовательские плагины     |

Плюс **SDK для плагинов** — создавайте собственных агентов и инструменты, регистрируйте их во время выполнения.

---

### Для Кого Это?

- **Пентестеры** — Автоматизируйте рутинные части. Пусть агенты занимаются разведкой и начальным тестированием, пока вы сосредоточитесь на креативных цепочках атак, требующих человеческой интуиции.
- **Охотники за Bug Bounty** — Более быстрая разведка, более широкое покрытие, последовательная методология между программами. CyberStrike не устаёт в 3 часа ночи.
- **Команды Безопасности** — Проводите структурированные оценки OWASP с воспроизводимой методологией. Получайте отчёты, соответствующие стандартам, которые понимает ваша команда комплаенса.
- **Исследователи Безопасности** — Расширяйте CyberStrike пользовательскими агентами и серверами MCP. Система плагинов и протокол MCP делают его платформой, а не просто инструментом.

---

### Участие в Разработке

CyberStrike создаётся сообществом безопасности для сообщества безопасности. Мы приветствуем вклад в следующих направлениях:

- **Агенты безопасности и навыки** — Новые методологии атак, паттерны тестирования, обнаружение уязвимостей
- **Серверы MCP** — Подключение новых инструментов безопасности и источников данных
- **База знаний** — Методологические руководства WSTG, MASTG, PTES, CIS
- **Улучшения ядра** — Производительность, UX, интеграции провайдеров, исправление ошибок

Прочитайте [Руководство по участию](./CONTRIBUTING.md) перед отправкой PR. Все вклады должны соответствовать [политике этичного использования](./CODE_OF_CONDUCT.md) проекта — CyberStrike предназначен исключительно для авторизованного тестирования безопасности.

---

### Лицензия

[AGPL-3.0-only](./LICENSE) — Бесплатно для личного и open-source использования. Коммерческая лицензия доступна через [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

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
  <sub>Создано хакерами, которым надоело копировать и вставлять между терминалами.</sub>
</p>
