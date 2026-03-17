<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>แพลตฟอร์มเอเจนต์ด้านความปลอดภัยเชิงรุกที่ขับเคลื่อนด้วย AI</b></p>

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

### CyberStrike คืออะไร?

CyberStrike เป็นเอเจนต์ด้านความปลอดภัยเชิงรุกแบบอัตโนมัติและโอเพนซอร์สที่ทำงานในเทอร์มินัลของคุณ มาพร้อมกับเอเจนต์ด้านความปลอดภัยเฉพาะทางกว่า 13 ตัว กรณีทดสอบ OWASP กว่า 120 รายการ และรองรับผู้ให้บริการ LLM กว่า 15 ราย เพียงชี้ไปที่เป้าหมาย แล้วมันจะจัดการการสำรวจ การค้นหาช่องโหว่ และการสร้างรายงานให้ทั้งหมด — จาก TUI เดียว

### คุณสมบัติ

- **เอเจนต์ด้านความปลอดภัยกว่า 13 ตัว** — เว็บแอปพลิเคชัน (OWASP WSTG), มือถือ (MASTG/MASVS), คลาวด์ (AWS/Azure/GCP), Active Directory/Kerberos, เครือข่าย และผู้ทดสอบพร็อกซีเฉพาะทาง 8 ตัว (IDOR, การฉีดโค้ด, SSRF, การหลีกเลี่ยงการยืนยันตัวตน และอื่น ๆ)
- **เครื่องมือในตัวกว่า 30 รายการ** — การรันเชลล์, คำขอ HTTP, การจัดการไฟล์, การค้นหาโค้ด, การขูดเว็บ, การรายงานช่องโหว่
- **Bolt** — เซิร์ฟเวอร์เครื่องมือระยะไกลที่ใช้โปรโตคอล MCP และการจับคู่ Ed25519 รันเครื่องมือความปลอดภัยบนเซิร์ฟเวอร์ระยะไกล ควบคุมจากเทอร์มินัลของคุณ
- **ระบบนิเวศ MCP** — การผสานรวมโดยตรง: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **ผู้ให้บริการ LLM กว่า 15 ราย** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, โมเดลในเครื่องผ่าน endpoint ที่เข้ากันได้กับ OpenAI และอื่น ๆ
- **หลายอินเทอร์เฟซ** — TUI (เทอร์มินัล), เว็บ (SolidJS), เดสก์ท็อป (Tauri) — เอนจินเอเจนต์เดียวกันทุกที่
- **รองรับ LSP** — การผสานรวมโปรโตคอล Language Server สำหรับเวิร์กโฟลว์บน IDE
- **ระบบปลั๊กอิน** — สร้างเอเจนต์และเครื่องมือที่กำหนดเองด้วย SDK ปลั๊กอิน

### การติดตั้ง

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

### เริ่มต้นอย่างรวดเร็ว

```bash
# เริ่มใช้งาน CyberStrike
cyberstrike

# เลือกผู้ให้บริการ LLM ของคุณในการรันครั้งแรก จากนั้น:
# "Run a full OWASP WSTG assessment on https://target.com"
```

### เอเจนต์

สลับระหว่างเอเจนต์ด้วยปุ่ม `Tab` ใน TUI

| เอเจนต์ | โดเมน | คำอธิบาย |
|---------|--------|----------|
| **cyberstrike** | ทั่วไป | เอเจนต์ด้านความปลอดภัยเชิงรุกเริ่มต้นที่มีสิทธิ์เข้าถึงเต็มรูปแบบ |
| **web-application** | เว็บ | OWASP Top 10, ระเบียบวิธี WSTG, ความปลอดภัย API |
| **mobile-application** | มือถือ | การทดสอบ Android/iOS, Frida, MASTG/MASVS |
| **cloud-security** | คลาวด์ | AWS, Azure, GCP, IAM, เกณฑ์มาตรฐาน CIS |
| **internal-network** | เครือข่าย | Active Directory, Kerberos, การเคลื่อนที่ภายในเครือข่าย |

รวมถึงเอเจนต์ **ผู้ทดสอบพร็อกซี** เฉพาะทาง 8 ตัว สำหรับประเภทช่องโหว่เฉพาะ: IDOR, การอนุญาต, การกำหนดค่าจำนวนมาก, การฉีดโค้ด, การยืนยันตัวตน, ตรรกะทางธุรกิจ, SSRF และการโจมตีไฟล์

### แอปเดสก์ท็อป

พร้อมใช้งานสำหรับ macOS, Windows และ Linux ดาวน์โหลดจาก[หน้ารีลีส](https://github.com/CyberStrikeus/CyberStrike/releases)

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### เอกสาร

- [เอกสารประกอบ](https://cyberstrike.io/docs)
- [การมีส่วนร่วม](./CONTRIBUTING.md)
- [จรรยาบรรณ](./CODE_OF_CONDUCT.md)

### สัญญาอนุญาต

[AGPL-3.0-only](./LICENSE) — สัญญาอนุญาตเชิงพาณิชย์พร้อมให้บริการผ่าน [contact@cyberstrike.io](mailto:contact@cyberstrike.io)

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
