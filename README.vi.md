<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">Tác nhân AI mã nguồn mở đầu tiên được xây dựng cho an ninh tấn công.</h3>

<p align="center">
  Pentest tự động ngay từ terminal — trinh sát, phát hiện lỗ hổng, khai thác và báo cáo.<br>
  Một lệnh duy nhất. 13+ tác nhân chuyên biệt. 120+ kịch bản kiểm thử OWASP. Đội đỏ AI của bạn.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Giấy phép" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### Tại sao chọn CyberStrike?

Kiểm thử bảo mật vẫn chủ yếu là thủ công. Pentester phải xử lý hàng chục công cụ, sao chép kết quả qua lại giữa các terminal, và tốn hàng giờ cho việc trinh sát lặp đi lặp lại trước khi chạm đến bề mặt tấn công thực sự. Thợ săn bug bounty đốt thời gian vào cùng một quy trình trinh sát cho mọi chương trình.

**CyberStrike thay đổi điều đó.** Đây là một tác nhân AI tự động hiểu phương pháp luận an ninh tấn công — không chỉ chạy công cụ, mà còn suy luận về những gì cần kiểm thử, kết nối các phát hiện với nhau, và điều chỉnh cách tiếp cận dựa trên những gì nó khám phá. Hãy coi nó như một thành viên đội đỏ không biết mệt trong terminal của bạn — tuân theo OWASP WSTG, biết khi nào cần chuyển hướng, và viết báo cáo khi hoàn thành.

```bash
npm i -g cyberstrike@latest && cyberstrike
# "Chạy đánh giá OWASP WSTG đầy đủ trên https://target.com"
```

Nó là mã nguồn mở, hoạt động với bất kỳ nhà cung cấp LLM nào, và bạn sở hữu mọi thứ nó tạo ra.

---

### Điều gì khiến CyberStrike khác biệt

<table>
<tr>
<td width="50%">

**Tác nhân bảo mật chuyên biệt, không phải chatbot chung chung**

CyberStrike đi kèm 13+ tác nhân được xây dựng riêng cho các lĩnh vực bảo mật. Mỗi tác nhân mang theo phương pháp luận chuyên ngành, kiến thức công cụ và các mẫu kiểm thử riêng. Tác nhân web-application tuân theo WSTG. Tác nhân cloud-security nắm rõ các chuẩn CIS. Tác nhân mobile sử dụng Frida và tuân theo MASTG/MASVS. Chúng không đoán mò — chúng tuân theo các framework đã được chứng minh.

</td>
<td width="50%">

**Tự động, không chỉ hỗ trợ**

Các công cụ AI khác chờ bạn chỉ dẫn bước tiếp theo. Tác nhân CyberStrike lên kế hoạch chuỗi tấn công nhiều bước, thực thi công cụ, phân tích kết quả, chuyển hướng khi phát hiện điều thú vị, và tạo báo cáo có bằng chứng. Bạn đặt mục tiêu — chúng xử lý phương pháp luận.

</td>
</tr>
<tr>
<td width="50%">

**Bất kỳ LLM nào, không bị khóa nhà cung cấp**

Hỗ trợ sẵn 15+ nhà cung cấp: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — kể cả các mô hình cục bộ qua endpoint tương thích OpenAI. Chạy với Claude, GPT, Gemini, hoặc LLM tự host của riêng bạn. Khi các mô hình trở nên tốt hơn và rẻ hơn, CyberStrike cũng tốt hơn cùng chúng.

</td>
<td width="50%">

**Thực thi công cụ từ xa với Bolt**

Công cụ bảo mật của bạn không nhất thiết phải chạy trên laptop. Bolt là máy chủ công cụ từ xa của CyberStrike — triển khai nó trên VPS với bộ công cụ pentest của bạn, ghép nối bằng khóa Ed25519, và điều khiển mọi thứ từ terminal cục bộ qua giao thức MCP. Một giao diện TUI, nhiều máy chủ tấn công.

</td>
</tr>
</table>

---

### Tác nhân

Chuyển đổi giữa các tác nhân bằng phím `Tab`. Mỗi tác nhân là một chuyên gia.

| Tác nhân | Lĩnh vực | Chức năng |
|----------|----------|-----------|
| **cyberstrike** | Tổng hợp | Tác nhân chính có toàn quyền truy cập — trinh sát, khai thác, báo cáo |
| **web-application** | Web | OWASP Top 10, phương pháp WSTG, bảo mật API, kiểm thử phiên |
| **mobile-application** | Di động | Android/iOS, Frida/Objection, tuân thủ MASTG/MASVS |
| **cloud-security** | Đám mây | AWS, Azure, GCP — cấu hình sai IAM, chuẩn CIS, tài nguyên bị lộ |
| **internal-network** | Mạng | Active Directory, tấn công Kerberos, di chuyển ngang, pivoting |

Cộng thêm **8 proxy tester chuyên biệt** chặn và thao tác lưu lượng cho các lớp lỗ hổng mục tiêu:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### Hệ sinh thái MCP

CyberStrike kết nối với các máy chủ MCP chuyên biệt để mở rộng khả năng:

| Máy chủ | Công cụ | Chức năng bổ sung |
|---------|---------|-------------------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | Kiểm thử bảo mật qua trình duyệt — XSS, CSRF, thao tác DOM, đánh cắp cookie |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | Kiểm toán bảo mật đám mây — 60+ kiểm tra trên AWS, Azure, GCP |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | Tình trạng bảo mật GitHub — repo, tổ chức, actions, secrets, chuỗi cung ứng |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | Thông tin CVE — NVD, EPSS, CISA KEV, GitHub Advisory, OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | Trinh sát OSINT — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS |

Tất cả đều mã nguồn mở. Tất cả cài đặt được bằng `npx`. Kết nối chúng vào CyberStrike hoặc sử dụng độc lập với bất kỳ MCP client nào.

---

### Cài đặt

```bash
# npm / bun / pnpm / yarn
npm i -g cyberstrike@latest

# macOS
brew install CyberStrikeus/tap/cyberstrike

# Windows
scoop install cyberstrike

# curl (Linux/macOS)
curl -fsSL https://cyberstrike.io/install | bash
```

**Ứng dụng desktop** (macOS, Windows, Linux) — tải từ [trang phát hành](https://github.com/CyberStrikeus/CyberStrike/releases) hoặc:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Công cụ tích hợp sẵn

Tác nhân CyberStrike có quyền truy cập trực tiếp vào 30+ công cụ:

| Danh mục | Công cụ |
|----------|---------|
| **Thực thi** | Shell (bash), đọc/ghi/sửa file, liệt kê thư mục |
| **Khám phá** | Tải web, tìm kiếm web, tìm kiếm mã nguồn, glob, grep |
| **Bảo mật** | Báo cáo lỗ hổng (định dạng HackerOne), thu thập bằng chứng |
| **Proxy** | Chặn HTTP/HTTPS, phát lại request, phân tích lưu lượng |
| **Tích hợp** | Máy chủ MCP, công cụ từ xa Bolt, plugin tùy chỉnh |

Cộng thêm **plugin SDK** — xây dựng tác nhân và công cụ riêng của bạn, đăng ký chúng khi chạy.

---

### Đối tượng sử dụng

- **Pentester** — Tự động hóa các phần lặp đi lặp lại. Để tác nhân xử lý trinh sát và kiểm thử ban đầu trong khi bạn tập trung vào các chuỗi tấn công sáng tạo đòi hỏi trực giác con người.
- **Thợ săn Bug Bounty** — Trinh sát nhanh hơn, phạm vi rộng hơn, phương pháp nhất quán trên mọi chương trình. CyberStrike không mệt mỏi lúc 3 giờ sáng.
- **Đội ngũ bảo mật** — Chạy đánh giá OWASP có cấu trúc với phương pháp tái tạo được. Nhận báo cáo ánh xạ theo tiêu chuẩn mà đội tuân thủ của bạn hiểu được.
- **Nhà nghiên cứu bảo mật** — Mở rộng CyberStrike bằng tác nhân tùy chỉnh và máy chủ MCP. Hệ thống plugin và giao thức MCP biến nó thành một nền tảng, không chỉ là một công cụ.

---

### Đóng góp

CyberStrike được xây dựng bởi cộng đồng bảo mật, dành cho cộng đồng bảo mật. Chúng tôi hoan nghênh đóng góp trong các lĩnh vực:

- **Tác nhân và kỹ năng bảo mật** — Phương pháp tấn công mới, mẫu kiểm thử, phát hiện lỗ hổng
- **Máy chủ MCP** — Kết nối công cụ bảo mật và nguồn dữ liệu mới
- **Cơ sở tri thức** — Hướng dẫn phương pháp WSTG, MASTG, PTES, CIS
- **Cải thiện cốt lõi** — Hiệu năng, trải nghiệm người dùng, tích hợp nhà cung cấp, sửa lỗi

Đọc [Hướng dẫn đóng góp](./CONTRIBUTING.md) trước khi gửi PR. Tất cả đóng góp phải tuân theo [chính sách sử dụng đạo đức](./CODE_OF_CONDUCT.md) của dự án — CyberStrike chỉ dành cho kiểm thử bảo mật được ủy quyền.

---

### Giấy phép

[AGPL-3.0-only](./LICENSE) — Miễn phí cho sử dụng cá nhân và mã nguồn mở. Giấy phép thương mại có sẵn qua [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

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
  <sub>Được xây dựng bởi những hacker đã chán việc sao chép-dán giữa các terminal.</sub>
</p>
