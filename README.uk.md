<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>Платформа агентів наступальної безпеки на базі ШІ.</b></p>

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

### Що таке CyberStrike?

CyberStrike — це автономний агент наступальної безпеки з відкритим кодом, який працює у вашому терміналі. Він включає понад 13 спеціалізованих агентів безпеки, понад 120 тестових сценаріїв OWASP та підтримує понад 15 провайдерів LLM. Вкажіть на ціль, і він виконає розвідку, виявлення вразливостей та генерацію звітів — усе з єдиного TUI.

### Можливості

- **Понад 13 агентів безпеки** — Вебзастосунки (OWASP WSTG), мобільні (MASTG/MASVS), хмарні (AWS/Azure/GCP), Active Directory/Kerberos, мережеві та 8 спеціалізованих проксі-тестерів (IDOR, ін'єкції, SSRF, обхід автентифікації тощо)
- **Понад 30 вбудованих інструментів** — Виконання команд оболонки, HTTP-запити, файлові операції, пошук по коду, вебскрапінг, звітування про вразливості
- **Bolt** — Віддалений сервер інструментів з протоколом MCP та з'єднанням Ed25519. Запускайте інструменти безпеки на віддалених серверах, керуйте ними зі свого терміналу
- **Екосистема MCP** — Інтеграції першої сторони: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **Понад 15 провайдерів LLM** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, локальні моделі через OpenAI-сумісні ендпоінти тощо
- **Кілька інтерфейсів** — TUI (термінал), веб (SolidJS), десктоп (Tauri) — один і той самий рушій агента скрізь
- **Підтримка LSP** — Інтеграція протоколу Language Server для робочих процесів у IDE
- **Система плагінів** — Створюйте власних агентів та інструменти за допомогою SDK плагінів

### Встановлення

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

### Швидкий старт

```bash
# Запустити CyberStrike
cyberstrike

# Оберіть провайдера LLM при першому запуску, потім:
# "Run a full OWASP WSTG assessment on https://target.com"
```

### Агенти

Перемикайтесь між агентами за допомогою `Tab` у TUI.

| Агент | Домен | Опис |
|-------|-------|------|
| **cyberstrike** | Загальний | Стандартний агент наступальної безпеки з повним доступом |
| **web-application** | Веб | OWASP Top 10, методологія WSTG, безпека API |
| **mobile-application** | Мобільний | Тестування Android/iOS, Frida, MASTG/MASVS |
| **cloud-security** | Хмарний | AWS, Azure, GCP, IAM, еталонні показники CIS |
| **internal-network** | Мережевий | Active Directory, Kerberos, латеральне переміщення |

Плюс 8 спеціалізованих агентів **проксі-тестерів** для цільових класів вразливостей: IDOR, авторизація, масове призначення, ін'єкції, автентифікація, бізнес-логіка, SSRF та атаки на файли.

### Десктопний застосунок

Доступний для macOS, Windows та Linux. Завантажте зі [сторінки релізів](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Документація

- [Документація](https://cyberstrike.io/docs)
- [Внесок у проєкт](./CONTRIBUTING.md)
- [Кодекс поведінки](./CODE_OF_CONDUCT.md)

### Ліцензія

[AGPL-3.0-only](./LICENSE) — Комерційне ліцензування доступне через [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
