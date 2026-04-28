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

<h3 align="center">AI เอเจนต์โอเพนซอร์สตัวแรกที่สร้างมาเพื่อการรักษาความปลอดภัยเชิงรุก</h3>

<p align="center">
  การทดสอบเจาะระบบแบบอัตโนมัติจากเทอร์มินัลของคุณ — การสำรวจ การค้นหาช่องโหว่ การเจาะระบบ และการสร้างรายงาน<br>
  คำสั่งเดียว เอเจนต์เฉพาะทาง 13+ ตัว กรณีทดสอบ OWASP 120+ รายการ ทีมเรดทีม AI ของคุณ
</p>

<p align="center">
  <a href="#ทำไมต้อง-cyberstrike">ทำไมต้อง CyberStrike?</a> &bull;
  <a href="#อะไรทำให้มันแตกต่าง">อะไรทำให้มันแตกต่าง</a> &bull;
  <a href="#เอเจนต์">เอเจนต์</a> &bull;
  <a href="#ระบบนิเวศ-mcp">ระบบนิเวศ MCP</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#การติดตั้ง">การติดตั้ง</a> &bull;
  <a href="#เครื่องมือในตัว">เครื่องมือในตัว</a> &bull;
  <a href="#เหมาะสำหรับใคร">เหมาะสำหรับใคร?</a> &bull;
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

### ทำไมต้อง CyberStrike?

การทดสอบความปลอดภัยยังคงเป็นงานที่ต้องทำด้วยมือเป็นส่วนใหญ่อย่างท่วมท้น นักทดสอบเจาะระบบต้องสลับใช้เครื่องมือหลายสิบตัว คัดลอกวางผลลัพธ์ระหว่างเทอร์มินัลต่าง ๆ และใช้เวลาหลายชั่วโมงกับการสำรวจซ้ำ ๆ ก่อนที่จะเริ่มแตะพื้นผิวการโจมตีจริง นักล่าบั๊กเบาน์ตี้เสียเวลาไปกับขั้นตอนการสำรวจเดิม ๆ สำหรับทุกโปรแกรม

**CyberStrike เปลี่ยนสิ่งนั้น** มันเป็น AI เอเจนต์อัตโนมัติที่เข้าใจระเบียบวิธีด้านความปลอดภัยเชิงรุก — ไม่ใช่แค่รันเครื่องมือ แต่คิดวิเคราะห์ว่าควรทดสอบอะไร เชื่อมโยงผลการค้นพบเข้าด้วยกัน และปรับแนวทางตามสิ่งที่ค้นพบ ลองนึกภาพว่ามีสมาชิกเรดทีมที่ไม่รู้จักเหนื่อยอยู่ในเทอร์มินัลของคุณ ที่ปฏิบัติตาม OWASP WSTG รู้ว่าเมื่อไหร่ควรเปลี่ยนทิศทาง และเขียนรายงานเมื่อทำเสร็จ

```bash
npm i -g @cyberstrike-io/cyberstrike@latest && cyberstrike
# "Run a full OWASP WSTG assessment on https://target.com"
```

มันเป็นโอเพนซอร์ส ใช้งานได้กับผู้ให้บริการ LLM ใดก็ได้ และทุกสิ่งที่มันสร้างขึ้นเป็นของคุณ

---

### อะไรทำให้มันแตกต่าง

<table>
<tr>
<td width="50%">

**เอเจนต์ความปลอดภัยเฉพาะทาง ไม่ใช่แชททั่วไป**

CyberStrike มาพร้อมเอเจนต์ 13+ ตัวที่สร้างขึ้นเฉพาะสำหรับโดเมนความปลอดภัย เอเจนต์แต่ละตัวมีระเบียบวิธีเฉพาะทาง ความรู้เกี่ยวกับเครื่องมือ และรูปแบบการทดสอบ เอเจนต์เว็บแอปพลิเคชันปฏิบัติตาม WSTG เอเจนต์ความปลอดภัยคลาวด์รู้จักเกณฑ์มาตรฐาน CIS เอเจนต์มือถือใช้ Frida และปฏิบัติตาม MASTG/MASVS พวกมันไม่คาดเดา — พวกมันปฏิบัติตามกรอบการทำงานที่ได้รับการพิสูจน์แล้ว

</td>
<td width="50%">

**อัตโนมัติ ไม่ใช่แค่ช่วยเหลือ**

เครื่องมือ AI อื่น ๆ รอให้คุณบอกว่าต้องทำอะไรต่อไป เอเจนต์ CyberStrike วางแผนห่วงโซ่การโจมตีหลายขั้นตอน รันเครื่องมือ วิเคราะห์ผลลัพธ์ เปลี่ยนทิศทางเมื่อพบสิ่งที่น่าสนใจ และสร้างรายงานที่มีหลักฐานรองรับ คุณกำหนดเป้าหมาย — พวกมันจัดการระเบียบวิธี

</td>
</tr>
<tr>
<td width="50%">

**LLM ใดก็ได้ ไม่ผูกติดกับรายใด**

รองรับผู้ให้บริการ 15+ รายตั้งแต่แกะกล่อง: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — รวมถึงโมเดลในเครื่องผ่าน endpoint ที่เข้ากันได้กับ OpenAI ใช้งานกับ Claude, GPT, Gemini หรือ LLM ที่โฮสต์เองได้ เมื่อโมเดลดีขึ้นและถูกลง CyberStrike ก็ดีขึ้นไปด้วย

</td>
<td width="50%">

**การรันเครื่องมือระยะไกลด้วย Bolt**

เครื่องมือความปลอดภัยของคุณไม่จำเป็นต้องรันบนแล็ปท็อป Bolt คือเซิร์ฟเวอร์เครื่องมือระยะไกลของ CyberStrike — ติดตั้งบน VPS พร้อมชุดเครื่องมือเพนเทสต์ จับคู่ด้วยคีย์ Ed25519 และควบคุมทุกอย่างจากเทอร์มินัลในเครื่องผ่านโปรโตคอล MCP TUI เดียว เซิร์ฟเวอร์โจมตีหลายตัว

</td>
</tr>
</table>

---

### เอเจนต์

สลับระหว่างเอเจนต์ด้วยปุ่ม `Tab` แต่ละตัวคือผู้เชี่ยวชาญเฉพาะทาง

| เอเจนต์                | จุดเน้น   | หน้าที่                                                                         |
| ---------------------- | --------- | ------------------------------------------------------------------------------- |
| **cyberstrike**        | ทั่วไป    | เอเจนต์หลักที่เข้าถึงได้ทุกส่วน — การสำรวจ การเจาะระบบ การสร้างรายงาน           |
| **web-application**    | เว็บ      | OWASP Top 10, ระเบียบวิธี WSTG, ความปลอดภัย API, การทดสอบเซสชัน                 |
| **mobile-application** | มือถือ    | Android/iOS, Frida/Objection, การปฏิบัติตาม MASTG/MASVS                         |
| **cloud-security**     | คลาวด์    | AWS, Azure, GCP — การกำหนดค่า IAM ผิดพลาด, เกณฑ์มาตรฐาน CIS, ทรัพยากรที่เปิดเผย |
| **internal-network**   | เครือข่าย | Active Directory, การโจมตี Kerberos, การเคลื่อนที่ภายในเครือข่าย, การพิวอท      |

รวมถึง **ผู้ทดสอบพร็อกซีเฉพาะทาง 8 ตัว** ที่ดักจับและจัดการทราฟฟิกสำหรับประเภทช่องโหว่เฉพาะ:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### ระบบนิเวศ MCP

CyberStrike เชื่อมต่อกับเซิร์ฟเวอร์ MCP เฉพาะทางที่ขยายความสามารถ:

| เซิร์ฟเวอร์                                                            | เครื่องมือ | สิ่งที่เพิ่มเติม                                                             |
| ---------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)         | 39         | การทดสอบความปลอดภัยผ่านเบราว์เซอร์ — XSS, CSRF, การจัดการ DOM, การขโมยคุกกี้ |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | 38         | การตรวจสอบความปลอดภัยคลาวด์ — 60+ การตรวจสอบครอบคลุม AWS, Azure, GCP         |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39         | สถานะความปลอดภัย GitHub — repo, org, actions, secrets, supply chain          |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | 23         | ข่าวกรอง CVE — NVD, EPSS, CISA KEV, GitHub Advisory, OSV                     |
| [osint-mcp](https://github.com/badchars/osint-mcp)                     | 37         | การสำรวจ OSINT — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS      |

ทั้งหมดเป็นโอเพนซอร์ส ติดตั้งได้ด้วย `npx` ต่อเข้ากับ CyberStrike หรือใช้แบบสแตนด์อโลนกับ MCP client ใดก็ได้

---

### Bolt

Bolt คือเซิร์ฟเวอร์รันเครื่องมือระยะไกลของ CyberStrike แทนที่จะรันเครื่องมือความปลอดภัยบนแล็ปท็อปของคุณ ให้ติดตั้งบน VPS (หรือหลายตัว) และควบคุมทุกอย่างจากเทอร์มินัลในเครื่อง

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**วิธีการทำงาน:**

- ติดตั้ง Bolt บนเซิร์ฟเวอร์ใดก็ได้ที่มีชุดเครื่องมือเพนเทสต์ของคุณ
- จับคู่ด้วยคีย์ Ed25519 — ไม่มีรหัสผ่าน ไม่มีความลับที่ใช้ร่วมกัน
- เอเจนต์ CyberStrike เรียกใช้เครื่องมือระยะไกลผ่านโปรโตคอล MCP
- ผลลัพธ์สตรีมกลับมายัง TUI ในเครื่องของคุณแบบเรียลไทม์
- จัดการการเชื่อมต่อจาก TUI: เพิ่ม ลบ ตรวจสอบสถานะ

**ทำไมจึงสำคัญ:** พื้นผิวการโจมตีของคุณอยู่บนโครงสร้างพื้นฐานเฉพาะ รันการสแกนหนักจาก VPS ที่มีแบนด์วิดท์ดีกว่า รักษาเครื่องมือให้อัปเดตในที่เดียว และสลับระหว่างเซิร์ฟเวอร์โจมตีหลายตัวจากเทอร์มินัลเดียว

---

### การติดตั้ง

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

**แอปเดสก์ท็อป** (macOS, Windows, Linux) — ดาวน์โหลดจาก[หน้ารีลีส](https://github.com/CyberStrikeus/CyberStrike/releases) หรือ:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### เครื่องมือในตัว

เอเจนต์ CyberStrike เข้าถึงเครื่องมือ 30+ รายการได้โดยตรง:

| หมวดหมู่        | เครื่องมือ                                                   |
| --------------- | ------------------------------------------------------------ |
| **การรัน**      | เชลล์ (bash), อ่าน/เขียน/แก้ไขไฟล์, แสดงรายการไดเรกทอรี      |
| **การค้นหา**    | ดึงข้อมูลเว็บ, ค้นหาเว็บ, ค้นหาโค้ด, glob, grep              |
| **ความปลอดภัย** | การรายงานช่องโหว่ (รูปแบบ HackerOne), การรวบรวมหลักฐาน       |
| **พร็อกซี**     | การดักจับ HTTP/HTTPS, การเล่นซ้ำคำขอ, การวิเคราะห์ทราฟฟิก    |
| **การผสานรวม**  | เซิร์ฟเวอร์ MCP, เครื่องมือระยะไกล Bolt, ปลั๊กอินแบบกำหนดเอง |

รวมถึง **SDK สำหรับปลั๊กอิน** — สร้างเอเจนต์และเครื่องมือของคุณเอง ลงทะเบียนได้ขณะรันไทม์

---

### เหมาะสำหรับใคร?

- **นักทดสอบเจาะระบบ** — ทำให้งานซ้ำ ๆ เป็นอัตโนมัติ ให้เอเจนต์จัดการการสำรวจและการทดสอบเบื้องต้น ขณะที่คุณมุ่งเน้นไปที่ห่วงโซ่การโจมตีที่ต้องใช้สัญชาตญาณของมนุษย์
- **นักล่าบั๊กเบาน์ตี้** — การสำรวจที่รวดเร็วขึ้น ครอบคลุมกว้างขึ้น ระเบียบวิธีที่สม่ำเสมอในทุกโปรแกรม CyberStrike ไม่เหนื่อยตอนตี 3
- **ทีมความปลอดภัย** — รันการประเมินตามมาตรฐาน OWASP ด้วยระเบียบวิธีที่ทำซ้ำได้ รับรายงานที่จับคู่กับมาตรฐานที่ทีมปฏิบัติตามข้อกำหนดของคุณเข้าใจ
- **นักวิจัยด้านความปลอดภัย** — ขยาย CyberStrike ด้วยเอเจนต์แบบกำหนดเองและเซิร์ฟเวอร์ MCP ระบบปลั๊กอินและโปรโตคอล MCP ทำให้มันเป็นแพลตฟอร์ม ไม่ใช่แค่เครื่องมือ

---

### การมีส่วนร่วม

CyberStrike สร้างโดยชุมชนความปลอดภัย เพื่อชุมชนความปลอดภัย เรายินดีต้อนรับการมีส่วนร่วมใน:

- **เอเจนต์และทักษะด้านความปลอดภัย** — ระเบียบวิธีโจมตีใหม่ รูปแบบการทดสอบ การตรวจจับช่องโหว่
- **เซิร์ฟเวอร์ MCP** — เชื่อมต่อเครื่องมือและแหล่งข้อมูลความปลอดภัยใหม่
- **ฐานความรู้** — คู่มือระเบียบวิธี WSTG, MASTG, PTES, CIS
- **การปรับปรุงหลัก** — ประสิทธิภาพ, UX, การผสานรวมผู้ให้บริการ, การแก้ไขบั๊ก

อ่าน[คู่มือการมีส่วนร่วม](./CONTRIBUTING.md)ก่อนส่ง PR ทุกการมีส่วนร่วมต้องปฏิบัติตาม[นโยบายการใช้งานอย่างมีจริยธรรม](./CODE_OF_CONDUCT.md)ของโครงการ — CyberStrike ใช้สำหรับการทดสอบความปลอดภัยที่ได้รับอนุญาตเท่านั้น

---

### สัญญาอนุญาต

[AGPL-3.0-only](./LICENSE) — ใช้ฟรีสำหรับการใช้งานส่วนตัวและโอเพนซอร์ส สัญญาอนุญาตเชิงพาณิชย์พร้อมให้บริการผ่าน [contact@cyberstrike.io](mailto:contact@cyberstrike.io)

---

### MCP Security Suite

CyberStrike is the core platform. These MCP servers extend its capabilities:

| Project                                                                | Domain                                  | Tools                                 |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------- |
| **CyberStrike**                                                        | **Autonomous offensive security agent** | **13+ agents, 120+ OWASP test cases** |
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)         | Browser-based security testing          | 39 tools, Firefox, injection testing  |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)         | Cloud security (AWS/Azure/GCP)          | 38 tools, 60+ checks                  |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | GitHub security posture                 | 39 tools, 45 checks                   |
| [cve-mcp](https://github.com/badchars/cve-mcp)                         | Vulnerability intelligence              | 23 tools, 5 sources                   |
| [osint-mcp](https://github.com/badchars/osint-mcp-server)              | OSINT & reconnaissance                  | 37 tools, 12 sources                  |

---

<p align="center">
  <a href="https://discord.gg/snunAaHf6U"><b>Discord</b></a> · <a href="https://x.com/cyberstrike"><b>X.com</b></a> · <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a>
</p>
<p align="center">
  <sub>สร้างโดยแฮกเกอร์ที่เบื่อกับการคัดลอกวางระหว่างเทอร์มินัล</sub>
</p>
