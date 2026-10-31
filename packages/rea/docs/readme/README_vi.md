<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · **Tiếng Việt** · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: Kỹ thuật dịch ngược cho mọi thứ

### Một MCP để dịch ngược tệp nhị phân, ứng dụng và hành vi khi chạy.

**Thấy một tính năng bạn thích? Hiểu cách nó hoạt động, đến tận mức mã nhị phân.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Trang web](https://rea.tools/vi/) · [Hướng dẫn](https://rea.tools/vi/guides/) · [Các nghiên cứu điển hình](https://rea.tools/vi/showcase/)**

[Bắt đầu nhanh](#bắt-đầu-nhanh) · [Cách REA hoạt động](#cách-rea-hoạt-động) · [Những gì bạn có thể phân tích](#những-gì-bạn-có-thể-phân-tích) · [Các nghiên cứu điển hình](#các-nghiên-cứu-điển-hình) · [Xây dựng môi trường RL](#build-rl-environments) · [Câu hỏi thường gặp](#câu-hỏi-thường-gặp) · [Tài liệu](#tài-liệu)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> Các nguồn chính thức của REA: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> Hãy dùng các liên kết cài đặt và bản phát hành từ những nguồn chính thức này. Tên kho mã tương tự hoặc README được sao chép không chứng minh rằng tệp tải xuống là bản chính thức.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA khởi chạy cầu nối phân tích bên trong Hopper khi kiểm tra tệp nhị phân mã máy" width="1200" />

<br /><br />

<table aria-label="Cộng đồng REA">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Tham gia cộng đồng kỹ thuật dịch ngược</strong>
  </a><br />
  <sub>Discord · Hỏi đáp · Chia sẻ kết quả</sub>
</td>
</tr>
</table>

<br />

</div>

---

Bạn thấy một tính năng trong ứng dụng và muốn đưa nó vào sản phẩm của mình? Hãy nhờ tác nhân của bạn điều tra bằng REA. Tác nhân có thể kiểm tra ứng dụng mà không cần mã nguồn, giải thích cách tính năng hoạt động, đưa ra bằng chứng và xây dựng một phiên bản cho dự án của bạn.

REA kết nối tác nhân của bạn với các công cụ kiểm tra tệp nhị phân mã máy, ứng dụng JavaScript và Electron, assembly .NET và trang web. Bạn cũng có thể dùng các công cụ đó từ terminal. Việc phân tích chạy cục bộ; kết quả bao gồm bằng chứng và giới hạn làm cơ sở cho từng kết luận.

Thiết lập đăng ký REA với tác nhân và cài hướng dẫn công việc tương ứng. Phân tích native dùng Hopper, Ghidra, IDA hoặc Kuna có sẵn; có thể cài Hopper sau khi bạn chấp thuận. Phân tích tĩnh JavaScript không cần công cụ phân tích native.

> **[Truy cập trang web REA](https://rea.tools/vi/)** để xem cách thiết lập, hướng dẫn có hình minh họa và các nghiên cứu điển hình thực tế.

## Bắt đầu nhanh

Trên Linux, khởi chạy Ghidra, JADX và công cụ firmware cùng phân tích tĩnh JavaScript/Electron cần `ps` tương thích procps trong `PATH` của REA để kiểm tra quyền sở hữu tiến trình. Xem điều kiện Linux.

### Thiết lập tác nhân

Sau khi cài Node.js và npm, chạy:

```bash
npx rea-agents setup
```

Chọn các tác nhân, xem lại những thay đổi được đề xuất và chấp thuận. Quá trình thiết lập thêm máy chủ MCP của REA cùng hướng dẫn quy trình tương ứng, đồng thời sao lưu cấu hình hiện có. Sau đó khởi động lại tác nhân.

Quá trình thiết lập hỗ trợ Claude Code, Codex, Cursor, Gemini CLI, Grok Build và [các tác nhân khác](../installation.md#supported-agents). Xem [cài đặt và thiết lập](../installation.md) để cấu hình trình phân tích và đăng ký MCP thủ công.

MCP mặc định dùng schema đầu vào gọn. Để có hướng dẫn đầy đủ về trường và xác thực lồng nhau, đặt `REA_MCP_INPUT_SCHEMA_PROFILE=full` trong đăng ký MCP. Cả hai cấu hình giữ toàn bộ công cụ và cùng xác thực chuẩn ở máy chủ; xem hướng dẫn hợp đồng MCP.

### Hỏi tác nhân

```text
Tìm hiểu cách tính năng tìm kiếm trong ứng dụng Notes hoạt động, cho tôi xem bằng chứng và xây dựng tính năng tương tự cho dự án của tôi.
```

Thay Notes bằng ứng dụng mục tiêu và chỉ rõ tính năng bạn muốn hiểu.

### Sử dụng terminal

Kiểm tra thư mục ứng dụng JavaScript/Electron đã giải nén hoặc tệp ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Kết quả bao gồm mô-đun, các khai báo import, ranh giới Electron và bằng chứng tương ứng. Thay đường dẫn bằng mục tiêu của bạn, chẳng hạn `"D:/apps/example"` trên Windows.

Để cài lệnh `rea` cho việc sử dụng thường xuyên:

```bash
npm install --global rea-agents
rea --help
```

Để phân tích mã máy, trước tiên hãy cấu hình trình phân tích. Xem [hướng dẫn CLI và Evidence](../cli.md) về các lệnh phân tích mã máy, lựa chọn trình phân tích, ảnh chụp trạng thái và sử dụng trong script.

### Cập nhật REA

REA thay đổi nhanh và các bản phát hành mới thường xuyên có bản sửa lỗi. Hãy giữ bản cài đặt của bạn được cập nhật.

Với CLI được cài bằng `npm install --global` / `bun add --global`:

```bash
rea update
```

`rea --update` là bí danh của `rea update`, nhận cùng tùy chọn đầu ra toàn cục. Lệnh cập nhật giữ tối đa tổng cộng 4 MiB stdout/stderr. Siêu dữ liệu quá lớn bị từ chối sau khi lệnh kết thúc; cài đặt chi tiết giữ chẩn đoán có giới hạn. Tiến độ tuân theo backpressure của terminal và chờ các lần ghi đã gửi hoàn tất.

Cập nhật Bun toàn cục cần Bun 1.2.17 trở lên. Nâng cấp Bun cũ theo cách thủ công trước khi chạy `rea update`.

Để cập nhật đăng ký tác nhân và skill, chạy lệnh thiết lập được in ra sau khi cập nhật.

Nếu dùng `npx`, cập nhật thiết lập tác nhân bằng:

```bash
npx rea-agents@latest setup
```

Xem lại thay đổi cấu hình và khởi động lại tác nhân. Với lệnh CLI dùng một lần, dùng `npx rea-agents@latest` rồi thêm lệnh cần chạy.

Với Bun, dùng `bunx rea-agents@latest` thay cho `npx rea-agents@latest`.

## Cách REA hoạt động

Tác nhân gọi REA qua MCP để kiểm tra mục tiêu và lần theo mã liên quan. REA trả về các phát hiện kèm bằng chứng. Tác nhân dùng chúng để đặt câu hỏi tiếp theo, giải thích hành vi hoặc viết và kiểm thử một cách triển khai. Các lệnh CLI sử dụng cùng quy trình.

![Quy trình điều tra của REA: tác nhân hỏi về mục tiêu cục bộ, REA kiểm tra và lần theo mục tiêu bằng công cụ phân tích, rồi tác nhân dùng mã, tham chiếu và những điểm chưa biết được trả về để giải thích, triển khai và kiểm thử.](../../website/public/assets/figures/rea-investigation-flow.svg)

[Mở hình ở kích thước đầy đủ](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## Những gì bạn có thể phân tích

REA yêu cầu Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) hoặc 26+ (>=26.12.1), cùng với npm. Công cụ bổ sung và nền tảng chạy REA được hỗ trợ tùy thuộc vào mục tiêu:

| Mục tiêu                          | REA trả về gì                                                                                                   | Yêu cầu và hướng dẫn                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Tệp nhị phân mã máy               | Mã giả, hợp ngữ, chuỗi, ký hiệu, lời gọi và tham chiếu                                                          | Hopper, Ghidra, IDA hoặc Kuna; [phân tích mã máy](../native-investigation.md)                                                                   |
| Bố cục ELF ngoại tuyến            | Các section, segment, ký hiệu/thông tin tái định vị gốc và các biện pháp giảm thiểu có thể có từ phân tích tĩnh | pwntools do bên gọi cung cấp trên Linux x64; [chẩn đoán tệp nhị phân](../binary-diagnostics.md)                                                 |
| Bytecode EVM                      | Bộ chọn điều phối, độ lệch byte, tham số suy luận và khả năng thay đổi trạng thái                               | Đầu vào cục bộ chứa byte thô hoặc dạng thập lục phân trên Linux x64; [hướng dẫn EVM ngoại tuyến](../evm-bytecode.md)                            |
| Rust binaries                     | Embedded cargo-auditable dependency list                                                                        | [Rust binaries](../rust-binaries.md)                                                                                                            |
| PE certificates                   | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                                    | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                                         |
| PE imports                        | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                                      | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                                   |
| ELF notes                         | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                                                 | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                                    |
| Linux kernel modules              | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                                     | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                                          |
| Erlang BEAM                       | IFF chunks, atoms, exports, and tables                                                                          | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                               |
| Apple IPS crashes                 | .ips metadata, threads, images, registers and crash classes                                                     | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                                   |
| Sự cố Linux đã ghi lại            | Bản ghi note thô, thanh ghi/tín hiệu của mọi luồng được ghi lại và các ứng viên ánh xạ tùy chọn                 | pwntools do bên gọi cung cấp trên Linux x64; GDB/pwndbg tùy chọn; [sự cố đã ghi lại](../recorded-crashes.md)                                    |
| Thư mục cài đặt ứng dụng máy tính | Các runtime có khả năng được dùng, tệp bằng chứng, dấu hiệu thành phần và bước tiếp theo                        | Kiểm tra thư mục và phần đầu tệp có giới hạn；[Ứng dụng máy tính](../desktop-applications.md)                                                   |
| JavaScript / Electron             | Mô-đun, các khai báo import, source map, tuyến, IPC và quan hệ với tiện ích mở rộng mã máy                      | Node.js và npm; [phân tích ứng dụng](../javascript-application-workflows.md); Linux: procps `ps`                                                |
| Trang web                         | Cấu trúc trang, script, quan sát mạng và ảnh chụp màn hình được yêu cầu                                         | Trình duyệt thuộc họ Chrome; [phân tích trình duyệt](../browser-observation.md)                                                                 |
| Bản ghi lưu lượng mạng đã lưu     | Yêu cầu, phản hồi, payload có thể truy cập và vị trí nguồn                                                      | HAR / Fiddler Everywhere SAZ; mitmdump trên Linux cho bản ghi định dạng gốc của mitmproxy; [hướng dẫn bản ghi mạng](../web-network-captures.md) |
| Bắt gói tin                       | Điểm cuối, DNS, TLS SNI, phân bố giao thức và yêu cầu HTTP                                                      | tshark và capinfos do nơi gọi cung cấp; [hướng dẫn pcap](../pcap-analysis.md)                                                                   |
| Assembly .NET                     | Siêu dữ liệu, lệnh CIL, các phụ thuộc mã máy được khai báo và so sánh bản dựng                                  | Kiểm tra tĩnh; [hướng dẫn mã được quản lý](../managed-code-analysis.md)                                                                         |
| APK Android                       | Khai báo manifest, lớp, phương thức được dịch ngược và tham chiếu                                               | JADX không giao diện đồ họa và JDK đầy đủ trên Linux/macOS/Windows x64; [hướng dẫn Android](../android-analysis.md)                             |
| Thiết bị Android                  | Thiết bị, gói, tiến trình, nhật ký, dump, ảnh chụp màn hình và truyền APK/tệp                                   | adb do nơi gọi cung cấp (trình giả lập hoặc thiết bị); [hướng dẫn ADB](../adb-device-analysis.md)                                               |
| Dự án JEB                         | Đơn vị dự án từ engine, hash của artifact và mã giả của kiểu/phương thức                                        | Một ứng dụng JEB do nơi gọi khởi động, phục vụ MCP, chọn bằng REA_JEB_MCP_URL; [hướng dẫn JEB](../jeb-analysis.md)                              |
| Tài nguyên Android                | Manifest đã giải mã, bảng chuỗi, ngôn ngữ và thông tin phiên bản                                                | Trình khởi chạy Apktool do nơi gọi cung cấp; [hướng dẫn tài nguyên](../apktool-resource-analysis.md)                                            |
| Ứng dụng Flutter                  | Băm snapshot Dart, hash thư viện theo ABI và nguồn gốc build engine                                             | Không cần (phân tích APK tĩnh); [hướng dẫn Flutter](../flutter-analysis.md)                                                                     |
| Phần sụn                          | Các vùng, kết quả trích xuất và dữ liệu chuyển sang phân tích mã máy                                            | Binwalk / Unblob trên Linux; [hướng dẫn phần sụn](../firmware-analysis.md)                                                                      |
| Gói tin đã ghi                    | Trường được chọn, giá trị lặp, bộ lọc và quy tắc giải mã                                                        | Linux: TShark 4.x + prlimit; [hướng dẫn bản ghi gói tin](../packet-captures.md)                                                                 |
| Tín hiệu logic đã ghi             | Chú thích bộ giải mã, phạm vi mẫu và chẩn đoán                                                                  | Linux: sigrok-cli 0.7.2 + prlimit; [hướng dẫn tín hiệu](../signal-recordings.md)                                                                |
| Gói và tài nguyên                 | Danh sách tệp, giá trị băm, plist, cấu trúc bundle Apple và tài nguyên được trích xuất                          | [Hướng dẫn hiện vật phần mềm và JavaScript](../javascript-artifact-reconstruction.md), [ứng dụng Apple](../apple-application-analysis.md)       |
| Hành vi tiến trình                | Đầu ra terminal, tương tác, quan sát khi thoát và hệ thống tệp, cùng so sánh các lần chạy                       | Linux/macOS có PTY gốc; [ghi lại tiến trình](../process-capture.md)                                                                             |
| PyInstaller                       | CArchive, PYZ, Python bytecode                                                                                  | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                                           |
| Tệp nhị phân Go                   | Phiên bản trình biên dịch nhúng, mô-đun, thay thế và thiết lập build                                            | Kiểm tra tĩnh tích hợp ELF/PE/thin Mach-O; Không cần cài Go                                                                                     |
| Cơ sở dữ liệu SQLite              | Bảng, cột, chỉ mục, view, trigger và hàng được chọn từ bảng thông thường                                        | Ảnh chụp cơ sở dữ liệu/WAL cục bộ; Node.js 24.x >=24.15 hoặc 26+ có giới hạn SQLite native                                                      |
| Đối tượng mã GPU                  | Đích CUDA/HIP, tham số và tài nguyên kernel được chọn, văn bản PTX được giữ lại                                 | Kiểm tra tĩnh tích hợp ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                                   |
| Tệp mô hình                       | Siêu dữ liệu GGUF / safetensors, khai báo tensor và tổng suy ra                                                 | Kiểm tra header; tùy chọn băm toàn bộ tệp; [GGUF / safetensors](../model-artifacts.md)                                                          |
| Siêu dữ liệu IL2CPP               | Ảnh assembly Unity global-metadata.dat, tên kiểu/phương thức và phạm vi chỉ mục                                 | Giải mã tĩnh phiên bản 24, 27, 29, 31, 39; không cần Unity                                                                                      |
| Godot PCK                         | Danh mục và trích xuất, header/thư mục gốc và định danh nội dung được chọn                                      | Định dạng tĩnh 2, 3, 4; không cần Godot                                                                                                         |
| Hiện vật WASM                     | Xác thực, section, dạng WAT import/export chính xác và WAT đã giải mã                                           | Do người gọi cung cấp WABT 1.0.42; `inspect_wasm_artifact`                                                                                      |
| Chữ ký APK                        | Bên ký v1/v2/v3/v3.1, dấu vân tay chứng chỉ, xoay vòng khóa và tính nhất quán nội bộ của digest                 | Kiểm tra tĩnh tích hợp; `inspect_apk_signature`                                                                                                 |

Kiểm tra tĩnh JavaScript và .NET đọc các tệp được cung cấp mà không chạy ứng dụng. Ghi lại khi chạy sẽ khởi chạy hoặc tương tác với mục tiêu đã chọn bằng quyền người dùng của bạn; từng hướng dẫn mô tả tác động của nó.

Để kiểm tra tệp nhị phân native ngoại tuyến, REA cũng hỗ trợ GNU objdump và Rizin do bạn tự cung cấp. [Hướng dẫn công cụ dịch ngược](../reverse-engineering-tools.md) trình bày cách thiết lập nhà cung cấp, các lệnh CLI và giới hạn của Evidence. REA không cài đặt hoặc cập nhật hai nhà cung cấp này.

<a id="choosing-a-deep-analysis-provider"></a>

Với tệp nhị phân lớn, tăng hạn khởi động bằng `REA_GHIDRA_STARTUP_TIMEOUT_MS` hoặc `REA_HOPPER_STARTUP_TIMEOUT_MS`.

Định dạng mã máy và nền tảng chạy REA được hỗ trợ khác nhau tùy trình phân tích. Xem [thiết lập Hopper và Ghidra](../installation.md#hopper), [hướng dẫn IDA](../ida-provider.md), [Kuna](../kuna-provider.md) và [hỗ trợ Ghidra thử nghiệm trên Windows](../windows-ghidra-p0.md). Ghidra cũng hỗ trợ [phân tích DOS 16 bit](../ghidra-dos.md). Để chọn trình phân tích, xem [hướng dẫn CLI](../cli.md#choose-a-provider). Kiểm tra [khả năng sử dụng theo bản phát hành](../installation.md#released-package-and-main) đối với tính năng được bổ sung sau phiên bản npm mới nhất.

## Các nghiên cứu điển hình

<a href="https://rea.tools/vi/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="Minh họa các ví dụ về cân bằng âm thanh DX-Ball, cầu nối bảng nhớ tạm Notion và vòng đạn TH04" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: tái tạo phép tính phân bố âm thanh trái phải

Lần theo lời gọi âm thanh đến hàm hỗ trợ chuyển vị trí thành giá trị phân bố âm thanh, kiểm tra các lệnh và chuyển mã giả chưa đầy đủ sang C. Bản tái tạo vượt qua 3.205 trường hợp kiểm thử với x86 gốc và tái tạo đủ 63 byte của hàm đã biên dịch.

[Đọc nghiên cứu điển hình](https://rea.tools/vi/showcase/dx-ball/) · [Kho mã tái tạo](https://github.com/N0zoM1z0/dx-ball)

### Notion: lần theo cầu nối clipboard của Electron

Tìm API clipboard trong tiến trình kết xuất, lần theo qua preload và IPC đến tiến trình chính, rồi kiểm tra định dạng clipboard có dữ liệu định dạng phong phú.

[Đọc nghiên cứu điển hình](https://rea.tools/vi/showcase/notion/)

### TH04: khôi phục phép tính vòng đạn trong DOS

Kiểm tra các lệnh 16 bit của trò chơi PC-98 gốc, khôi phục phép tính góc cố định và góc nhắm mục tiêu, rồi so sánh C++ được tái tạo với đầu ra của trình biên dịch thời đó.

[Đọc nghiên cứu điển hình](https://rea.tools/vi/showcase/th04/) · [Kho mã tái tạo](https://github.com/N0zoM1z0/th04)

### Xây dựng môi trường RL bằng REA

Ghi phiên ứng dụng web, chuyển API thành công cụ và xuất môi trường mà tác tử AI có thể dùng. Chạy bằng AgentEnv, rồi thêm tác vụ và kiểm tra phần thưởng để huấn luyện RL hoặc đánh giá.

[Hướng dẫn xây dựng môi trường](https://rea.tools/guides/rl-environments/) ·
[Xem bản demo trên X](https://x.com/reatools/status/2112574822584918075?s=20)

Nếu bạn dùng REA cho một mục tiêu thú vị, chúng tôi muốn biết. Chia sẻ trường hợp của bạn qua [issue](https://github.com/morluto/rea/issues) hoặc [pull request](https://github.com/morluto/rea/pulls), nêu mục tiêu, câu hỏi, cách REA giúp bạn và những gì tìm được.

<a id="build-rl-environments"></a>

## Xây dựng môi trường RL

Tạo môi trường cục bộ để tác tử AI luyện các tác vụ như tìm issue hoặc tạo thư mục mà không cần chạy ứng dụng gốc. Dùng môi trường này cho học tăng cường (RL) hoặc để kiểm tra khả năng hoàn thành tác vụ của tác tử.

REA biến các yêu cầu và phản hồi API đã ghi thành công cụ mà tác tử có thể gọi. Môi trường dùng dữ liệu đã ghi và chỉ hỗ trợ thay đổi khi bản ghi xác nhận tác động của thay đổi đó.

Sau khi thiết lập REA trong tác tử, thay URL và các tác vụ thư mục bên dưới bằng thông tin của bạn:

```text
Dùng REA xây dựng môi trường RL từ ứng dụng web thử nghiệm của tôi tại
http://127.0.0.1:3000.
Bao gồm liệt kê, tạo, đổi tên và xóa thư mục. Có thể tạo và xóa
thư mục thử nghiệm nhưng không thay đổi dữ liệu có sẵn.
Lưu vào thư mục my-env, kiểm tra thao tác nào hoạt động và cho tôi biết cách chạy.
```

<details>
<summary>Dùng dòng lệnh</summary>

Dùng các lệnh này nếu đã có tệp ghi lại yêu cầu và phản hồi của ứng dụng trong trình duyệt. Để chạy môi trường tạo ra, bạn cũng cần AgentEnv và Docker.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA xuất môi trường chạy được cùng bài kiểm tra cơ bản để xác nhận môi trường khởi động và phản hồi. Kết nối với framework RL để đặt mục tiêu tác vụ, thêm kiểm tra phần thưởng và chạy huấn luyện.

[Hướng dẫn xây dựng môi trường](https://rea.tools/guides/rl-environments/) ·
[Tài liệu tham chiếu môi trường](../agent-environments.md) ·
[Xem bản demo trên X](https://x.com/reatools/status/2112574822584918075?s=20)

## Câu hỏi thường gặp

<details>
<summary><strong>Tác nhân nào có thể dùng REA?</strong></summary>

Bất kỳ tác nhân nào hỗ trợ máy chủ MCP cục bộ. Quá trình thiết lập cấu hình các [tác nhân được hỗ trợ](../installation.md#supported-agents); ứng dụng khách khác có thể dùng [đăng ký MCP thủ công](../installation.md#mcp-registry).

</details>

<details>
<summary><strong>Tôi có cần Hopper, Ghidra, IDA hoặc Kuna không?</strong></summary>

Phân tích mã máy chuyên sâu sử dụng một trong những công cụ đó. Kiểm tra tĩnh JavaScript và .NET hoạt động mà không cần bộ máy phân tích mã máy. Quá trình thiết lập có thể cài Hopper sau khi được chấp thuận; Ghidra, IDA và Kuna dùng bản cài đặt sẵn có. Xem [thiết lập trình phân tích](../installation.md#hopper).

</details>

<details>
<summary><strong>Tôi có cần khởi chạy Hopper trước không?</strong></summary>

REA khởi chạy Hopper khi một thao tác cần đến nó. Trên macOS, hộp thoại lần chạy đầu có thể yêu cầu chọn chế độ dùng thử hoặc kích hoạt giấy phép. Xem [khởi động Hopper và khắc phục sự cố](../installation.md#launcher-paths-and-troubleshooting).

</details>

<details>
<summary><strong>Cài skill từ skills.sh có tác dụng gì?</strong></summary>

Skill cung cấp hướng dẫn điều tra cho tác nhân. Dùng `npx rea-agents setup` để đăng ký máy chủ MCP của REA và cài hướng dẫn tương ứng, sau đó khởi động lại tác nhân. Xem [chỉ cài skill](../installation.md#skill-only-installation).

</details>

<details>
<summary><strong>REA trả về mã gì?</strong></summary>

Phân tích mã máy trả về mã giả và hợp ngữ. Phân tích JavaScript/Electron khôi phục mô-đun cùng quan hệ giữa chúng. Tác nhân dùng các phát hiện này để viết và kiểm thử cách triển khai; các [nghiên cứu điển hình](#các-nghiên-cứu-điển-hình) cung cấp ví dụ thực hành.

</details>

<details>
<summary><strong>REA có tải ứng dụng của tôi lên không?</strong></summary>

REA phân tích mục tiêu cục bộ. Tác nhân nhận kết quả công cụ, và nhà cung cấp mô hình của tác nhân có chính sách dữ liệu riêng.

</details>

<details>
<summary><strong>Tôi nên làm gì khi gặp lỗi?</strong></summary>

Hãy cập nhật trước; một bản phát hành gần đây có thể đã sửa lỗi.

Với CLI được cài bằng npm:

```bash
rea update
```

Với thiết lập tác nhân qua `npx`:

```bash
npx rea-agents@latest setup
```

Nếu dùng tác nhân, hãy hoàn tất [làm mới thiết lập](#cập-nhật-rea) và khởi động lại nó. Thử lại cùng tác vụ. Nếu vấn đề vẫn còn, [mở issue](https://github.com/morluto/rea/issues) với phiên bản REA, loại mục tiêu, các bước tái hiện và đầu ra lỗi.

</details>

## Tài liệu

Bắt đầu với [hướng dẫn thực hành](https://rea.tools/vi/guides/) trên trang web. Để biết tùy chọn cụ thể, điều kiện tiên quyết và hợp đồng kết quả:

- [Cài đặt và thiết lập](../installation.md): đăng ký tác nhân, cấu hình trình phân tích, cập nhật và gỡ cài đặt.
- [Kiểm tra mức sẵn sàng và khắc phục sự cố](../installation.md#check-readiness-for-your-task): chẩn đoán một tác nhân hoặc bộ máy phân tích cụ thể.
- [CLI và Evidence](../cli.md): lệnh, lựa chọn trình phân tích, ảnh chụp trạng thái, nhập/xuất và trạng thái thoát.
- [Hợp đồng MCP](../mcp-contracts.md) và [prompt cho tác nhân](../mcp-prompts.md): kết quả công cụ, phiên làm việc và điều tra có hướng dẫn.
- [Danh mục công cụ](../mcp-contracts.md#generated-catalog): danh sách công cụ, trình phân tích và lệnh CLI được tạo khi dựng dự án.
- [Lộ trình](../roadmap.md): công việc dự kiến và theo dõi các khả năng.

Báo cáo lỗ hổng theo [SECURITY.md](../../SECURITY.md).

## Lịch sử sao

🎉 **400.000 sao trên GitHub — xin cảm ơn!**

Cảm ơn mọi người đã sử dụng REA, báo lỗi, đề xuất tính năng, kiểm thử bản dựng và đóng góp bản sửa lỗi.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="Lịch sử sao GitHub của REA" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Miễn trừ trách nhiệm

Xem [DISCLAIMER.md](../../DISCLAIMER.md) để biết hướng dẫn sử dụng có trách nhiệm.

REA dành cho nghiên cứu, giáo dục, khả năng tương tác, bảo tồn phần mềm và phân tích phần mềm bạn sở hữu hoặc được phép kiểm tra, trong khuôn khổ pháp luật.

The project's position on illegal or unauthorized use covers all REA
versions, distribution channels, and platforms; each copy retains its
applicable licenses.

## Đóng góp

Chúng tôi hoan nghênh bạn giúp phát triển REA! [Mở issue](https://github.com/morluto/rea/issues) để báo lỗi hoặc đề xuất tính năng, hoặc [gửi pull request](https://github.com/morluto/rea/pulls) để cải thiện mã hay tài liệu.

Xem [CONTRIBUTING.md](../../CONTRIBUTING.md) về thiết lập môi trường phát triển và các bước kiểm tra, [hướng dẫn kiểm thử](../testing.md) về các luồng xác minh và [sơ đồ kiến trúc](../architecture.mermaid) về cấu trúc dự án.

## Giấy phép

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
