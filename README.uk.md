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

<h3 align="center">Перший AI-агент з відкритим кодом, створений для наступальної безпеки.</h3>

<p align="center">
  Автономне тестування на проникнення з вашого терміналу — розвідка, виявлення вразливостей, експлуатація та звітність.<br>
  Одна команда. 13+ спеціалізованих агентів. 120+ тестових сценаріїв OWASP. Ваша AI червона команда.
</p>

<p align="center">
  <a href="#чому-cyberstrike">Чому CyberStrike?</a> &bull;
  <a href="#що-робить-його-особливим">Що робить його особливим</a> &bull;
  <a href="#агенти">Агенти</a> &bull;
  <a href="#екосистема-mcp">Екосистема MCP</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#встановлення">Встановлення</a> &bull;
  <a href="#вбудовані-інструменти">Вбудовані інструменти</a> &bull;
  <a href="#для-кого-це">Для кого це?</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyberstrike-io/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/@cyberstrike-io/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

---

### Чому CyberStrike?

Тестування безпеки досі переважно виконується вручну. Пентестери жонглюють десятками інструментів, копіюють-вставляють результати між терміналами і витрачають години на повторювану розвідку, перш ніж торкнутися фактичної поверхні атаки. Мисливці за багами витрачають час на один і той самий робочий процес розвідки для кожної програми.

**CyberStrike це змінює.** Це автономний AI-агент, який розуміє методологію наступальної безпеки — не просто запускає інструменти, а міркує про те, що тестувати, пов'язує знахідки між собою та адаптує свій підхід на основі виявленого. Уявіть невтомного члена червоної команди у вашому терміналі, який дотримується OWASP WSTG, знає, коли змінити напрямок, і пише звіт, коли закінчить.

```bash
npm i -g @cyberstrike-io/cyberstrike@latest && cyberstrike
# "Run a full OWASP WSTG assessment on https://target.com"
```

Це відкритий код, працює з будь-яким провайдером LLM, і все, що він створює, належить вам.

---

### Що робить його особливим

<table>
<tr>
<td width="50%">

**Спеціалізовані агенти безпеки, а не загальний чат**

CyberStrike постачається з 13+ агентами, спеціально створеними для доменів безпеки. Кожен агент несе специфічну для домену методологію, знання інструментів та шаблони тестування. Агент веб-застосунків дотримується WSTG. Агент хмарної безпеки знає еталони CIS. Мобільний агент використовує Frida та дотримується MASTG/MASVS. Вони не вгадують — вони слідують перевіреним фреймворкам.

</td>
<td width="50%">

**Автономний, а не просто допоміжний**

Інші AI-інструменти чекають, поки ви скажете, що робити далі. Агенти CyberStrike планують багатоетапні ланцюги атак, виконують інструменти, аналізують результати, змінюють напрямок, коли знаходять щось цікаве, і генерують звіти з доказовою базою. Ви встановлюєте ціль — вони забезпечують методологію.

</td>
</tr>
<tr>
<td width="50%">

**Будь-яка LLM, без прив'язки**

15+ провайдерів одразу з коробки: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — навіть локальні моделі через endpoint, сумісні з OpenAI. Запускайте з Claude, GPT, Gemini або власною самостійно розгорнутою LLM. Коли моделі стають кращими й дешевшими, CyberStrike стає кращим разом з ними.

</td>
<td width="50%">

**Віддалене виконання інструментів через Bolt**

Ваші інструменти безпеки не обов'язково мають працювати на вашому ноутбуці. Bolt — це сервер віддалених інструментів CyberStrike — розгорніть його на VPS з вашим набором інструментів для пентесту, з'єднайте за допомогою ключів Ed25519 і контролюйте все з локального терміналу через протокол MCP. Один TUI, кілька серверів атаки.

</td>
</tr>
</table>

---

### Агенти

Перемикайтеся між агентами за допомогою `Tab`. Кожен з них — спеціаліст.

| Агент | Фокус | Що робить |
|-------|-------|-----------|
| **cyberstrike** | Загальний | Основний агент з повним доступом — розвідка, експлуатація, звітність |
| **web-application** | Веб | OWASP Top 10, методологія WSTG, безпека API, тестування сесій |
| **mobile-application** | Мобільний | Android/iOS, Frida/Objection, відповідність MASTG/MASVS |
| **cloud-security** | Хмара | AWS, Azure, GCP — помилки конфігурації IAM, еталони CIS, відкриті ресурси |
| **internal-network** | Мережа | Active Directory, атаки Kerberos, латеральне переміщення, півотинг |

Плюс **8 спеціалізованих проксі-тестерів**, які перехоплюють і маніпулюють трафіком для цільових класів вразливостей:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### Екосистема MCP

CyberStrike підключається до спеціалізованих MCP-серверів, що розширюють його можливості:

| Сервер | Інструменти | Що додає |
|--------|------------|----------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | Тестування безпеки через браузер — XSS, CSRF, маніпуляція DOM, крадіжка cookies |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | Аудит хмарної безпеки — 60+ перевірок для AWS, Azure, GCP |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | Стан безпеки GitHub — repo, org, actions, secrets, supply chain |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | Розвідка CVE — NVD, EPSS, CISA KEV, GitHub Advisory, OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | Розвідка OSINT — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS |

Усе з відкритим кодом. Усе встановлюється через `npx`. Підключайте до CyberStrike або використовуйте автономно з будь-яким MCP-клієнтом.

---

### Bolt

Bolt — це сервер віддаленого виконання інструментів CyberStrike. Замість запуску інструментів безпеки на вашому ноутбуці, розгорніть їх на VPS (або кількох) і контролюйте все з локального терміналу.

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**Як це працює:**
- Розгорніть Bolt на будь-якому сервері з встановленим набором інструментів для пентесту
- З'єднайте за допомогою ключів Ed25519 — без паролів, без спільних секретів
- Агенти CyberStrike викликають інструменти віддалено через протокол MCP
- Результати передаються у ваш локальний TUI у реальному часі
- Керуйте з'єднаннями з TUI: додавайте, видаляйте, відстежуйте статус

**Чому це важливо:** Ваша атакуюча інфраструктура залишається на виділених серверах. Запускайте важкі сканування з VPS з кращою пропускною здатністю, тримайте інструменти оновленими в одному місці та перемикайтеся між кількома серверами атаки з одного терміналу.

---

### Встановлення

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

**Настільний застосунок** (macOS, Windows, Linux) — завантажте зі [сторінки релізів](https://github.com/CyberStrikeus/CyberStrike/releases) або:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Вбудовані інструменти

Агенти CyberStrike мають прямий доступ до 30+ інструментів:

| Категорія | Інструменти |
|-----------|------------|
| **Виконання** | Шелл (bash), читання/запис/редагування файлів, перелік директорій |
| **Виявлення** | Завантаження веб-сторінок, веб-пошук, пошук коду, glob, grep |
| **Безпека** | Звітування про вразливості (формат HackerOne), збір доказів |
| **Проксі** | Перехоплення HTTP/HTTPS, повтор запитів, аналіз трафіку |
| **Інтеграція** | MCP-сервери, віддалені інструменти Bolt, користувацькі плагіни |

Плюс **SDK для плагінів** — створюйте власних агентів та інструменти, реєструйте їх під час виконання.

---

### Для кого це?

- **Пентестери** — Автоматизуйте повторювані частини. Нехай агенти займаються розвідкою та початковим тестуванням, поки ви зосереджуєтесь на креативних ланцюгах атак, які потребують людської інтуїції.
- **Мисливці за багами** — Швидша розвідка, ширше покриття, послідовна методологія між програмами. CyberStrike не втомлюється о третій ночі.
- **Команди безпеки** — Проводьте структуровані оцінки OWASP з відтворюваною методологією. Отримуйте звіти, що відповідають стандартам, зрозумілим вашій команді комплаєнсу.
- **Дослідники безпеки** — Розширюйте CyberStrike за допомогою власних агентів та MCP-серверів. Система плагінів і протокол MCP роблять його платформою, а не просто інструментом.

---

### Участь у проєкті

CyberStrike створений спільнотою безпеки для спільноти безпеки. Ми вітаємо внески в:

- **Агенти та навички безпеки** — Нові методології атак, шаблони тестування, виявлення вразливостей
- **MCP-сервери** — Підключення нових інструментів безпеки та джерел даних
- **База знань** — Посібники з методологій WSTG, MASTG, PTES, CIS
- **Основні покращення** — Продуктивність, UX, інтеграції провайдерів, виправлення помилок

Прочитайте [Посібник з участі](./CONTRIBUTING.md) перед подачею PR. Усі внески повинні відповідати [політиці етичного використання](./CODE_OF_CONDUCT.md) проєкту — CyberStrike призначений лише для авторизованого тестування безпеки.

---

### Ліцензія

[AGPL-3.0-only](./LICENSE) — Безкоштовно для особистого та відкритого використання. Комерційне ліцензування доступне через [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

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
  <sub>Створено хакерами, яким набридло копіювати-вставляти між терміналами.</sub>
</p>
