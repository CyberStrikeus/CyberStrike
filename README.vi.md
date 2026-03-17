<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>Nền tảng tác nhân an ninh tấn công được hỗ trợ bởi AI.</b></p>

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

### CyberStrike là gì?

CyberStrike là một tác nhân an ninh tấn công tự động, mã nguồn mở, chạy trực tiếp trong terminal của bạn. Nó đi kèm với hơn 13 tác nhân bảo mật chuyên biệt, hơn 120 ca kiểm thử OWASP, và hỗ trợ hơn 15 nhà cung cấp LLM. Chỉ cần trỏ vào mục tiêu, nó sẽ tự động thực hiện trinh sát, phát hiện lỗ hổng và tạo báo cáo — tất cả từ một giao diện TUI duy nhất.

### Tính năng

- **Hơn 13 tác nhân bảo mật** — Ứng dụng web (OWASP WSTG), di động (MASTG/MASVS), đám mây (AWS/Azure/GCP), Active Directory/Kerberos, mạng, và 8 tác nhân kiểm thử proxy chuyên biệt (IDOR, injection, SSRF, vượt qua xác thực, và nhiều hơn nữa)
- **Hơn 30 công cụ tích hợp sẵn** — Thực thi shell, yêu cầu HTTP, thao tác tệp, tìm kiếm mã nguồn, thu thập dữ liệu web, báo cáo lỗ hổng
- **Bolt** — Máy chủ công cụ từ xa với giao thức MCP và ghép nối Ed25519. Chạy các công cụ bảo mật trên máy chủ từ xa, điều khiển chúng từ terminal của bạn
- **Hệ sinh thái MCP** — Tích hợp chính thức: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **Hơn 15 nhà cung cấp LLM** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, mô hình cục bộ qua các endpoint tương thích OpenAI, và nhiều hơn nữa
- **Đa giao diện** — TUI (terminal), Web (SolidJS), Desktop (Tauri) — cùng một engine tác nhân ở mọi nơi
- **Hỗ trợ LSP** — Tích hợp giao thức máy chủ ngôn ngữ cho quy trình làm việc trên IDE
- **Hệ thống plugin** — Xây dựng các tác nhân và công cụ tùy chỉnh với SDK plugin

### Cài đặt

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

### Bắt đầu nhanh

```bash
# Khởi chạy CyberStrike
cyberstrike

# Chọn nhà cung cấp LLM khi chạy lần đầu, sau đó:
# "Chạy đánh giá OWASP WSTG đầy đủ trên https://target.com"
```

### Các tác nhân

Chuyển đổi giữa các tác nhân bằng phím `Tab` trong TUI.

| Tác nhân | Lĩnh vực | Mô tả |
|----------|----------|-------|
| **cyberstrike** | Tổng hợp | Tác nhân an ninh tấn công mặc định với toàn quyền truy cập |
| **web-application** | Web | OWASP Top 10, phương pháp WSTG, bảo mật API |
| **mobile-application** | Di động | Kiểm thử Android/iOS, Frida, MASTG/MASVS |
| **cloud-security** | Đám mây | AWS, Azure, GCP, IAM, tiêu chuẩn CIS |
| **internal-network** | Mạng | Active Directory, Kerberos, di chuyển ngang |

Cộng thêm 8 tác nhân **kiểm thử proxy** chuyên biệt cho các lớp lỗ hổng cụ thể: IDOR, ủy quyền, gán hàng loạt, injection, xác thực, logic nghiệp vụ, SSRF, và tấn công tệp.

### Ứng dụng desktop

Có sẵn cho macOS, Windows và Linux. Tải xuống từ [trang phát hành](https://github.com/CyberStrikeus/CyberStrike/releases).

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Tài liệu

- [Tài liệu](https://cyberstrike.io/docs)
- [Đóng góp](./CONTRIBUTING.md)
- [Quy tắc ứng xử](./CODE_OF_CONDUCT.md)

### Giấy phép

[AGPL-3.0-only](./LICENSE) — Giấy phép thương mại có sẵn qua [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
