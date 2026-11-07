<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · **ไทย** · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: Reverse Engineer Anything

### MCP เดียวสำหรับวิศวกรรมย้อนกลับ ทั้งไบนารี แอปพลิเคชัน และพฤติกรรมขณะทำงาน

**เห็นฟีเจอร์ที่ชอบแล้วอยากรู้ว่าทำงานอย่างไร? เข้าใจได้ลึกถึงระดับไบนารี**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[เว็บไซต์](https://rea.tools/th/) · [คู่มือ](https://rea.tools/th/guides/) · [ตัวอย่างการใช้งาน](https://rea.tools/th/showcase/)**

[เริ่มต้นอย่างรวดเร็ว](#เริ่มต้นอย่างรวดเร็ว) · [REA ทำงานอย่างไร](#rea-ทำงานอย่างไร) · [สิ่งที่วิเคราะห์ได้](#สิ่งที่วิเคราะห์ได้) · [ตัวอย่างการใช้งาน](#ตัวอย่างการใช้งาน) · [สร้างสภาพแวดล้อม RL](#build-rl-environments) · [คำถามที่พบบ่อย](#คำถามที่พบบ่อย) · [เอกสาร](#เอกสาร)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> แหล่งทางการของ REA: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> โปรดใช้ลิงก์ติดตั้งและรุ่นเผยแพร่จากแหล่งทางการเหล่านี้ ชื่อที่เก็บโค้ดที่คล้ายกันหรือ README ที่คัดลอกมาไม่ได้ยืนยันว่าไฟล์ดาวน์โหลดเป็นของทางการ

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA เริ่มบริดจ์การวิเคราะห์ภายใน Hopper ขณะตรวจสอบไบนารีเนทีฟ" width="1200" />

<br /><br />

<table aria-label="ชุมชน REA">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>เข้าร่วมชุมชนวิศวกรรมย้อนกลับ</strong>
  </a><br />
  <sub>Discord · ถามตอบ · แบ่งปันผลงาน</sub>
</td>
</tr>
</table>

<br />

</div>

---

เห็นฟีเจอร์ในแอปที่อยากนำมาใช้ในผลิตภัณฑ์ของคุณเองหรือไม่? ขอให้เอเจนต์ของคุณตรวจสอบด้วย REA เอเจนต์สามารถวิเคราะห์แอปโดยไม่ต้องมีซอร์สโค้ด อธิบายการทำงานของฟีเจอร์ แสดงหลักฐาน และสร้างเวอร์ชันสำหรับโปรเจกต์ของคุณได้

REA เชื่อมเอเจนต์ของคุณกับเครื่องมือสำหรับตรวจสอบไบนารีเนทีฟ แอป JavaScript และ Electron แอสเซมบลี .NET และเว็บไซต์ คุณใช้เครื่องมือเดียวกันจากเทอร์มินัลได้ การวิเคราะห์ทำงานบนเครื่องของคุณ และผลลัพธ์มีทั้งหลักฐานและข้อจำกัดที่ประกอบแต่ละข้อสรุป

การตั้งค่าลงทะเบียน REA กับเอเจนต์และติดตั้งคำแนะนำการทำงานที่ตรงกัน การวิเคราะห์เนทีฟใช้ Hopper, Ghidra, IDA หรือ Kuna ที่มีอยู่ได้ และติดตั้ง Hopper ได้เมื่อคุณอนุมัติ การวิเคราะห์ JavaScript แบบสแตติกไม่ต้องใช้เอนจินวิเคราะห์เนทีฟ

> **[เยี่ยมชมเว็บไซต์ REA](https://rea.tools/th/)** เพื่อดูคำแนะนำการตั้งค่า คู่มือพร้อมภาพประกอบ และกรณีศึกษาจริง

## เริ่มต้นอย่างรวดเร็ว

บน Linux การเปิด Ghidra, JADX และเครื่องมือเฟิร์มแวร์ รวมถึงการวิเคราะห์ JavaScript/Electron แบบสแตติก ต้องมี `ps` ที่เข้ากันได้กับ procps ใน `PATH` ของ REA เพื่อตรวจสอบความเป็นเจ้าของโปรเซส ดูข้อกำหนดของ Linuxสำหรับวิธีแก้ไข

### ตั้งค่าเอเจนต์

เมื่อติดตั้ง Node.js และ npm แล้ว ให้เรียกใช้:

```bash
npx rea-agents setup
```

เลือกเอเจนต์ ตรวจสอบการเปลี่ยนแปลงที่เสนอ แล้วอนุมัติ ขั้นตอนตั้งค่าจะเพิ่มเซิร์ฟเวอร์ MCP ของ REA และคำแนะนำการทำงานที่ตรงกัน พร้อมสำรองการตั้งค่าที่มีอยู่ จากนั้นเริ่มเอเจนต์ใหม่

ขั้นตอนตั้งค่ารองรับ Claude Code, Codex, Cursor, Gemini CLI, Grok Build และ[เอเจนต์อื่น ๆ](../installation.md#supported-agents) ดู[การติดตั้งและตั้งค่า](../installation.md) สำหรับการตั้งค่าผู้ให้บริการวิเคราะห์และการลงทะเบียน MCP ด้วยตนเอง

MCP ใช้สคีมาอินพุตแบบกระชับโดยปริยาย หากต้องการคำอธิบายฟิลด์และการตรวจสอบแบบซ้อนทั้งหมด ให้ตั้ง `REA_MCP_INPUT_SCHEMA_PROFILE=full` ในการลงทะเบียน MCP ทั้งสองแบบคงเครื่องมือครบและใช้การตรวจสอบมาตรฐานฝั่งเซิร์ฟเวอร์เดียวกัน ดูคู่มือสัญญา MCP

### ถามเอเจนต์

```text
ตรวจสอบว่าการค้นหาในแอป Notes ทำงานอย่างไร แสดงหลักฐานให้ฉันดู และสร้างฟีเจอร์ที่คล้ายกันสำหรับโปรเจกต์ของฉัน
```

แทนที่ Notes ด้วยแอปเป้าหมายและฟีเจอร์ที่คุณต้องการเข้าใจ

### ใช้เทอร์มินัล

ตรวจสอบไดเรกทอรีแอป JavaScript/Electron ที่แตกไฟล์แล้ว หรือไฟล์ ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

ผลลัพธ์ประกอบด้วยโมดูล การนำเข้า ขอบเขตของ Electron และหลักฐาน แทนที่พาธด้วยเป้าหมายของคุณ เช่น `"D:/apps/example"` บน Windows

หากต้องการติดตั้งคำสั่ง `rea` สำหรับใช้งานเป็นประจำ:

```bash
npm install --global rea-agents
rea --help
```

สำหรับการวิเคราะห์เนทีฟ ให้ตั้งค่าผู้ให้บริการวิเคราะห์ก่อน ดู[คู่มือ CLI และ Evidence](../cli.md) สำหรับคำสั่งเนทีฟ การเลือกผู้ให้บริการ สแนปช็อต และการใช้งานในสคริปต์

### อัปเดต REA

REA เปลี่ยนแปลงอย่างรวดเร็ว และรุ่นใหม่มีการแก้ไขบั๊กอยู่บ่อยครั้ง โปรดอัปเดตการติดตั้งของคุณให้เป็นปัจจุบัน

สำหรับ CLI ที่ติดตั้งผ่าน `npm install --global` / `bun add --global`:

```bash
rea update
```

`rea --update` เป็นชื่อแทนของ `rea update` และรับตัวเลือกเอาต์พุตส่วนกลางเดียวกัน คำสั่งอัปเดตเก็บ stdout/stderr รวมไม่เกิน 4 MiB เมทาดาทาที่ใหญ่เกินจะถูกปฏิเสธหลังคำสั่งจบ ส่วนการติดตั้งที่มีเอาต์พุตมากจะเก็บการวินิจฉัยแบบจำกัด ความคืบหน้าเคารพ backpressure ของเทอร์มินัลและรอการเขียนที่ส่งแล้วเสร็จ

การอัปเดต Bun แบบโกลบอลต้องใช้ Bun 1.2.17 ขึ้นไป หากเก่ากว่านี้ให้อัปเกรด Bun เองก่อนเรียก `rea update`

หากต้องการปรับปรุงการลงทะเบียนเอเจนต์และสกิลให้เป็นปัจจุบัน ให้เรียกใช้คำสั่งตั้งค่าที่แสดงหลังการอัปเดต

หากใช้ `npx` ให้อัปเดตการตั้งค่าเอเจนต์ด้วย:

```bash
npx rea-agents@latest setup
```

ตรวจสอบการเปลี่ยนแปลงการตั้งค่าและเริ่มเอเจนต์ใหม่ สำหรับคำสั่ง CLI ที่ใช้ครั้งเดียว ให้ใช้ `npx rea-agents@latest` ตามด้วยคำสั่งที่ต้องการ

เมื่อใช้ Bun ให้ใช้ `bunx rea-agents@latest` แทน `npx rea-agents@latest`

## REA ทำงานอย่างไร

เอเจนต์เรียก REA ผ่าน MCP เพื่อตรวจสอบเป้าหมายและติดตามโค้ดที่เกี่ยวข้อง REA ส่งข้อค้นพบกลับมาพร้อมหลักฐาน เอเจนต์ใช้ข้อมูลนี้เพื่อถามคำถามต่อ อธิบายพฤติกรรม หรือเขียนและทดสอบการนำไปใช้งาน คำสั่ง CLI ใช้กระบวนการเดียวกัน

![กระบวนการตรวจสอบด้วย REA: เอเจนต์ถามเกี่ยวกับเป้าหมายบนเครื่อง REA ตรวจสอบและติดตามด้วยเครื่องมือวิเคราะห์ แล้วเอเจนต์ใช้โค้ด การอ้างอิง และสิ่งที่ยังไม่ทราบที่ได้รับกลับมาเพื่ออธิบาย สร้าง และทดสอบ](../../website/public/assets/figures/rea-investigation-flow.svg)

[เปิดภาพขนาดเต็ม](../../website/public/assets/figures/rea-investigation-flow.svg)

<a id="current-status"></a>

## สิ่งที่วิเคราะห์ได้

REA ต้องใช้ Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) หรือ 26+ (>=26.12.1) และ npm เครื่องมือเพิ่มเติมและแพลตฟอร์มที่รองรับขึ้นอยู่กับเป้าหมาย:

| เป้าหมาย                      | สิ่งที่ REA ส่งกลับ                                                                   | ข้อกำหนดและคู่มือ                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ไบนารีเนทีฟ                    | โค้ดเทียม แอสเซมบลี สตริง สัญลักษณ์ การเรียก และการอ้างอิง                                | Hopper, Ghidra, IDA หรือ Kuna; [การวิเคราะห์เนทีฟ](../native-investigation.md)                                                           |
| โครงสร้าง ELF แบบออฟไลน์       | เซกชัน เซกเมนต์ สัญลักษณ์/รีโลเคชันต้นฉบับ และตัวเลือกกลไกป้องกันที่พบจากการวิเคราะห์แบบสถิต      | pwntools ที่ผู้ใช้จัดเตรียมบน Linux x64; [การวินิจฉัยไบนารี](../binary-diagnostics.md)                                                          |
| PE certificates              | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields    | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                              |
| PE imports                   | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash      | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                        |
| ไบต์โค้ด EVM                   | ตัวเลือกฟังก์ชันสำหรับการเรียก ออฟเซ็ตไบต์ อาร์กิวเมนต์และความสามารถในการเปลี่ยนสถานะที่อนุมานได้ | ไฟล์บนเครื่องที่มีไบต์ดิบหรือข้อมูลเลขฐานสิบหกบน Linux x64; [คู่มือ EVM แบบออฟไลน์](../evm-bytecode.md)                                              |
| Rust binaries                | Embedded cargo-auditable dependency list                                        | [Rust binaries](../rust-binaries.md)                                                                                                 |
| ELF notes                    | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                 | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                         |
| Linux kernel modules         | .modinfo keys, __versions CRCs, this_module presence, and signature trailer     | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                               |
| Erlang BEAM                  | IFF chunks, atoms, exports, and tables                                          | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                    |
| Apple IPS crashes            | .ips metadata, threads, images, registers and crash classes                     | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                        |
| ข้อมูลการแครชของ Linux ที่บันทึกไว้ | ระเบียน note ดิบ รีจิสเตอร์/สัญญาณของทุกเธรดที่บันทึกไว้ และตัวเลือกการแมปเพิ่มเติม              | pwntools ที่ผู้ใช้จัดเตรียมบน Linux x64; เลือกใช้ GDB/pwndbg เพิ่มเติมได้; [การแครชที่บันทึกไว้](../recorded-crashes.md)                               |
| ไดเรกทอรีติดตั้งแอปเดสก์ท็อป       | รันไทม์ที่เป็นไปได้ ไฟล์หลักฐาน ตัวบ่งชี้ส่วนประกอบ และขั้นตอนถัดไป                             | ตรวจสอบไดเรกทอรีและส่วนหัวโดยจำกัดขอบเขต；[แอปเดสก์ท็อป](../desktop-applications.md)                                                       |
| JavaScript / Electron        | โมดูล การนำเข้า ซอร์สแมป เส้นทาง IPC และความสัมพันธ์กับส่วนเสริมเนทีฟ                      | Node.js และ npm; [การวิเคราะห์แอปพลิเคชัน](../javascript-application-workflows.md); Linux: procps `ps`                                   |
| เว็บไซต์                       | โครงสร้างหน้า สคริปต์ ข้อมูลเครือข่ายที่สังเกตได้ และภาพหน้าจอที่ร้องขอ                         | เบราว์เซอร์ในตระกูล Chrome; [การวิเคราะห์ผ่านเบราว์เซอร์](../browser-observation.md)                                                         |
| ข้อมูลเครือข่ายที่บันทึกไว้           | คำขอ คำตอบ เพย์โหลดที่ปรากฏ และตำแหน่งต้นทาง                                         | HAR / Fiddler Everywhere SAZ; mitmdump บน Linux สำหรับข้อมูลที่บันทึกในรูปแบบเนทีฟของ mitmproxy; [คู่มือการบันทึกข้อมูล](../web-network-captures.md) |
| การจับแพ็กเก็ต                  | จุดเชื่อมต่อ, DNS, TLS SNI, การกระจายโปรโตคอล และคำขอ HTTP                          | tshark และ capinfos ที่ผู้เรียกจัดเตรียม; [คู่มือ pcap](../pcap-analysis.md)                                                                   |
| แอสเซมบลี .NET                | เมทาดาทา คำสั่ง CIL การพึ่งพาเนทีฟที่ประกาศไว้ และการเปรียบเทียบผลการบิลด์                  | การตรวจสอบแบบสถิต; [คู่มือโค้ดแบบจัดการ](../managed-code-analysis.md)                                                                      |
| PyInstaller                  | CArchive, PYZ, Python bytecode                                                  | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                                |
| APK ของ Android              | การประกาศใน manifest คลาส เมธอดที่ดีคอมไพล์ และการอ้างอิง                             | JADX แบบไม่มี GUI และ JDK แบบเต็มบน Linux/macOS/Windows x64; [คู่มือ Android](../android-analysis.md)                                      |
| อุปกรณ์ Android                | อุปกรณ์ แพ็กเกจ โพรเซส บันทึก ดัมพ์ ภาพหน้าจอ และการถ่ายโอน APK/ไฟล์                      | adb ที่ผู้เรียกจัดเตรียม (โปรแกรมจำลองหรืออุปกรณ์จริง); [คู่มือ ADB](../adb-device-analysis.md)                                                    |
| โปรเจกต์ JEB                  | หน่วยโปรเจกต์จากเอนจิน, แฮชของอาร์ติแฟกต์ และซูโดโค้ดของไทป์/เมท็อด                       | ไคลเอนต์ JEB ที่ผู้เรียกเริ่มและให้บริการ MCP เลือกด้วย REA_JEB_MCP_URL; [คู่มือ JEB](../jeb-analysis.md)                                           |
| ทรัพยากร Android              | ไฟล์ manifest ที่ถอดรหัสแล้ว ตารางสตริง ภาษา และข้อมูลเวอร์ชัน                            | ตัวเรียก Apktool ที่ผู้เรียกจัดเตรียม; [คู่มือทรัพยากร](../apktool-resource-analysis.md)                                                          |
| แอป Flutter                  | แฮชสแนปชอต Dart, แฮชไลบรารีราย ABI และที่มาของบิลด์เอนจิน                             | ไม่ต้อง (วิเคราะห์ APK แบบ static); [คู่มือ Flutter](../flutter-analysis.md)                                                                |
| เฟิร์มแวร์                      | พื้นที่ข้อมูล ผลการแตกไฟล์ และการส่งต่อไปวิเคราะห์เนทีฟ                                     | Binwalk / Unblob บน Linux; [คู่มือเฟิร์มแวร์](../firmware-analysis.md)                                                                     |
| แพ็กเก็ตที่บันทึกไว้                | ฟิลด์ที่เลือก ค่าซ้ำ ตัวกรอง และกฎการถอดรหัส                                             | Linux: TShark 4.x + prlimit; [คู่มือไฟล์แคปเจอร์](../packet-captures.md)                                                                  |
| สัญญาณลอจิกที่บันทึกไว้             | คำอธิบายจากตัวถอดรหัส ช่วงตัวอย่าง และข้อมูลวินิจฉัย                                       | Linux: sigrok-cli 0.7.2 + prlimit; [คู่มือสัญญาณ](../signal-recordings.md)                                                               |
| แพ็กเกจและทรัพยากร             | รายการไฟล์ ค่าแฮช plist โครงสร้างบันเดิลของ Apple และทรัพยากรที่แตกออกมา                | [คู่มืออาร์ติแฟกต์และ JavaScript](../javascript-artifact-reconstruction.md), [แอปพลิเคชัน Apple](../apple-application-analysis.md)           |
| พฤติกรรมของโปรเซส             | เอาต์พุตเทอร์มินัล การโต้ตอบ ข้อมูลการสิ้นสุดและระบบไฟล์ที่สังเกตได้ และการเปรียบเทียบการรัน       | Linux/macOS ที่มี PTY เนทีฟ; [การบันทึกโปรเซส](../process-capture.md)                                                                      |
| ไบนารี Go                     | เวอร์ชันคอมไพเลอร์ โมดูล การแทนที่ และค่าบิลด์ที่ฝังอยู่                                      | การตรวจสอบสแตติกในตัว ELF/PE/thin Mach-O; ไม่ต้องติดตั้ง Go                                                                                 |
| ฐานข้อมูล SQLite               | ตาราง คอลัมน์ ดัชนี วิว ทริกเกอร์ และแถวที่เลือกจากตารางทั่วไป                              | สแนปช็อตฐานข้อมูล/WAL ในเครื่อง; Node.js 24.x >=24.15 หรือ 26+ พร้อมขีดจำกัด SQLite แบบเนทีฟ                                                   |
| ออบเจ็กต์โค้ด GPU               | เป้าหมาย CUDA/HIP พารามิเตอร์และทรัพยากรเคอร์เนลที่เลือก และข้อความ PTX ที่เก็บไว้           | การตรวจสอบสแตติกในตัว ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                           |
| ไฟล์โมเดล                     | เมทาดาทา GGUF / safetensors การประกาศเทนเซอร์ และยอดรวมที่คำนวณได้                  | ตรวจสอบส่วนหัว; เลือกแฮชทั้งไฟล์ได้; [GGUF / safetensors](../model-artifacts.md)                                                            |
| เมทาดาทา IL2CPP              | อิมเมจแอสเซมบลี Unity global-metadata.dat ชื่อชนิด/เมธอด และช่วงดัชนี                   | ถอดรหัสสแตติกเวอร์ชัน 24, 27, 29, 31, 39; ไม่ต้องใช้ Unity                                                                                  |
| Godot PCK                    | รายการและการแตกไฟล์ ข้อมูลส่วนหัว/ไดเรกทอรีต้นฉบับ และตัวตนเนื้อหาที่เลือก                    | รูปแบบสแตติก 2, 3, 4; ไม่ต้องใช้ Godot                                                                                                    |
| อาร์ติแฟกต์ WASM                | การตรวจสอบ เซกชัน รูปแบบ WAT นำเข้า/ส่งออกที่ตรงต้นฉบับ และ WAT ที่ถอดรหัส                 | ผู้เรียกจัดเตรียม WABT 1.0.42; `inspect_wasm_artifact`                                                                                    |
| ลายเซ็น APK                   | ผู้ลงนาม v1/v2/v3/v3.1 ลายนิ้วมือใบรับรอง การหมุนเวียนคีย์ และความสอดคล้องภายในของไดเจสต์   | การตรวจสอบสแตติกในตัว; `inspect_apk_signature`                                                                                         |

การตรวจสอบ JavaScript และ .NET แบบสถิตอ่านไฟล์ที่ให้มาโดยไม่รันแอปพลิเคชัน การบันทึกขณะทำงานจะรันหรือโต้ตอบกับเป้าหมายที่เลือกโดยใช้สิทธิ์ของผู้ใช้คุณ คู่มือการทำงานแต่ละฉบับอธิบายผลที่เกิดขึ้นไว้

สำหรับการตรวจสอบไบนารีเนทีฟแบบออฟไลน์ REA ยังรองรับ GNU objdump และ Rizin ที่ผู้ใช้ต้องจัดหาเอง [คู่มือเครื่องมือวิศวกรรมย้อนกลับ](../reverse-engineering-tools.md) อธิบายการตั้งค่าผู้ให้บริการ คำสั่ง CLI และข้อจำกัดของ Evidence โดย REA จะไม่ติดตั้งหรืออัปเดตผู้ให้บริการทั้งสองนี้

<a id="choosing-a-deep-analysis-provider"></a>

สำหรับไบนารีขนาดใหญ่ เพิ่มเวลารอเริ่มต้นด้วย `REA_GHIDRA_STARTUP_TIMEOUT_MS` หรือ `REA_HOPPER_STARTUP_TIMEOUT_MS`

รูปแบบไบนารีเนทีฟและแพลตฟอร์มที่รองรับแตกต่างกันตามผู้ให้บริการวิเคราะห์ ดู[การตั้งค่า Hopper และ Ghidra](../installation.md#hopper), [คู่มือ IDA](../ida-provider.md) [Kuna](../kuna-provider.md) และ[การรองรับ Ghidra บน Windows แบบทดลอง](../windows-ghidra-p0.md) Ghidra ยังรองรับ[การวิเคราะห์ DOS แบบ 16 บิต](../ghidra-dos.md) สำหรับการเลือกผู้ให้บริการ ดู[คู่มือ CLI](../cli.md#choose-a-provider) ตรวจสอบ[ความพร้อมใช้งานในแต่ละรุ่น](../installation.md#released-package-and-main) สำหรับฟีเจอร์ที่เพิ่มหลังรุ่นล่าสุดบน npm

## ตัวอย่างการใช้งาน

<a href="https://rea.tools/th/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="ภาพประกอบกรณีศึกษาการแพนเสียงใน DX-Ball บริดจ์คลิปบอร์ดของ Notion และวงแหวนกระสุนใน TH04" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: สร้างการคำนวณแพนเสียงขึ้นใหม่

ติดตามการเรียกเสียงไปยังฟังก์ชันช่วยแปลงตำแหน่งเป็นค่าแพน ตรวจสอบคำสั่ง และแปลงโค้ดเทียมที่ยังไม่สมบูรณ์เป็น C การสร้างขึ้นใหม่นี้ผ่านการทดสอบ 3,205 กรณีเทียบกับ x86 ต้นฉบับ และสร้างไบต์ทั้ง 63 ไบต์ของฟังก์ชันที่คอมไพล์แล้วได้ตรงกัน

[อ่านกรณีศึกษา](https://rea.tools/th/showcase/dx-ball/) · [รีโพซิทอรีการสร้างขึ้นใหม่](https://github.com/N0zoM1z0/dx-ball)

### Notion: ติดตามบริดจ์คลิปบอร์ดของ Electron

ค้นหา API คลิปบอร์ดของ renderer ติดตามผ่าน preload และ IPC ไปยังโปรเซสหลัก แล้วตรวจสอบรูปแบบคลิปบอร์ดที่มีข้อมูลการจัดรูปแบบ

[อ่านกรณีศึกษา](https://rea.tools/th/showcase/notion/)

### TH04: กู้คืนการคำนวณวงแหวนกระสุนของ DOS

ตรวจสอบคำสั่ง 16 บิตของเกมต้นฉบับบน PC-98 กู้คืนการคำนวณมุมคงที่และมุมเล็งเป้าหมาย แล้วเปรียบเทียบ C++ ที่สร้างขึ้นใหม่กับผลลัพธ์จากคอมไพเลอร์ในยุคนั้น

[อ่านกรณีศึกษา](https://rea.tools/th/showcase/th04/) · [รีโพซิทอรีการสร้างขึ้นใหม่](https://github.com/N0zoM1z0/th04)

### สร้างสภาพแวดล้อม RL ด้วย REA

บันทึกเซสชันเว็บแอป เปลี่ยน API เป็นเครื่องมือ และส่งออกสภาพแวดล้อมที่เอเจนต์ AI ใช้ได้ รันด้วย AgentEnv แล้วเพิ่มงานและการตรวจสอบรางวัลสำหรับการฝึก RL หรือการประเมิน

[คู่มือสร้างสภาพแวดล้อม](https://rea.tools/guides/rl-environments/) ·
[ชมเดโมบน X](https://x.com/reatools/status/2112574822584918075?s=20)

หากคุณใช้ REA กับสิ่งที่น่าสนใจ เราอยากเห็นผลงานของคุณ แบ่งปันกรณีของคุณผ่าน [issue](https://github.com/morluto/rea/issues) หรือ [pull request](https://github.com/morluto/rea/pulls) พร้อมระบุเป้าหมาย คำถามของคุณ REA ช่วยอย่างไร และสิ่งที่คุณค้นพบ

<a id="build-rl-environments"></a>

## สร้างสภาพแวดล้อม RL

สร้างสภาพแวดล้อมในเครื่องให้เอเจนต์ AI ฝึกทำงาน เช่น ค้นหา issue หรือสร้างโฟลเดอร์ โดยไม่ต้องรันแอปต้นฉบับ ใช้สำหรับการเรียนรู้แบบเสริมกำลัง (RL) หรือทดสอบว่าเอเจนต์ทำงานได้ดีเพียงใด

REA เปลี่ยนคำขอและคำตอบ API ที่บันทึกไว้เป็นเครื่องมือที่เอเจนต์เรียกใช้ได้ สภาพแวดล้อมใช้ข้อมูลที่บันทึกไว้และรองรับการเปลี่ยนแปลงเฉพาะเมื่อข้อมูลบันทึกยืนยันผลของการเปลี่ยนแปลงนั้น

เมื่อตั้งค่า REA ในเอเจนต์แล้ว ให้เปลี่ยน URL และงานเกี่ยวกับโฟลเดอร์ในตัวอย่างให้ตรงกับแอปของคุณ:

```text
ใช้ REA สร้างสภาพแวดล้อม RL จากเว็บแอปทดสอบของฉันที่
http://127.0.0.1:3000
ครอบคลุมการแสดงรายการ สร้าง เปลี่ยนชื่อ และลบโฟลเดอร์
อนุญาตให้สร้างและลบโฟลเดอร์ทดสอบ แต่ห้ามเปลี่ยนข้อมูลที่มีอยู่
บันทึกในโฟลเดอร์ชื่อ my-env ตรวจสอบว่างานใดใช้ได้ และบอกวิธีรันให้ฉันทราบ
```

<details>
<summary>ใช้บรรทัดคำสั่งแทน</summary>

ใช้คำสั่งเหล่านี้เมื่อมีไฟล์บันทึกคำขอและคำตอบของแอปในเบราว์เซอร์แล้ว การรันสภาพแวดล้อมที่สร้างขึ้นต้องใช้ AgentEnv และ Docker ด้วย

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA ส่งออกสภาพแวดล้อมที่รันได้พร้อมการทดสอบพื้นฐานว่าเริ่มทำงานและตอบสนองได้ เชื่อมต่อกับเฟรมเวิร์ก RL เพื่อกำหนดเป้าหมายงาน เพิ่มการตรวจสอบรางวัล และฝึกเอเจนต์

[คู่มือสร้างสภาพแวดล้อม](https://rea.tools/guides/rl-environments/) ·
[เอกสารอ้างอิงสภาพแวดล้อม](../agent-environments.md) ·
[ชมเดโมบน X](https://x.com/reatools/status/2112574822584918075?s=20)

## คำถามที่พบบ่อย

<details>
<summary><strong>เอเจนต์ใดใช้ REA ได้บ้าง?</strong></summary>

เอเจนต์ใดก็ตามที่รองรับเซิร์ฟเวอร์ MCP บนเครื่อง ขั้นตอนตั้งค่าจะกำหนดค่าให้กับ[เอเจนต์ที่รองรับ](../installation.md#supported-agents) ส่วนไคลเอนต์อื่นใช้[การลงทะเบียน MCP ด้วยตนเอง](../installation.md#mcp-registry) ได้

</details>

<details>
<summary><strong>จำเป็นต้องมี Hopper, Ghidra, IDA หรือ Kuna หรือไม่?</strong></summary>

การวิเคราะห์เนทีฟเชิงลึกต้องใช้หนึ่งในเครื่องมือเหล่านี้ การตรวจสอบ JavaScript และ .NET แบบสถิตทำงานได้โดยไม่มีเอนจินวิเคราะห์เนทีฟ ขั้นตอนตั้งค่าสามารถติดตั้ง Hopper หลังได้รับอนุมัติ ส่วน Ghidra, IDA และ Kuna ใช้การติดตั้งที่คุณมีอยู่แล้ว ดู[การตั้งค่าผู้ให้บริการวิเคราะห์](../installation.md#hopper)

</details>

<details>
<summary><strong>ต้องเริ่ม Hopper ก่อนหรือไม่?</strong></summary>

REA เริ่ม Hopper เมื่อการดำเนินการต้องใช้ บน macOS อาจมีหน้าต่างเมื่อรันครั้งแรกให้เลือกโหมดทดลองหรือเปิดใช้ใบอนุญาต ดู[การเริ่ม Hopper และการแก้ไขปัญหา](../installation.md#launcher-paths-and-troubleshooting)

</details>

<details>
<summary><strong>การติดตั้งสกิลจาก skills.sh ทำอะไร?</strong></summary>

สกิลให้คำแนะนำการตรวจสอบแก่เอเจนต์ ใช้ `npx rea-agents setup` เพื่อลงทะเบียนเซิร์ฟเวอร์ MCP ของ REA และติดตั้งคำแนะนำที่ตรงกัน แล้วเริ่มเอเจนต์ใหม่ ดู[การติดตั้งเฉพาะสกิล](../installation.md#skill-only-installation)

</details>

<details>
<summary><strong>REA ส่งกลับโค้ดแบบใด?</strong></summary>

การวิเคราะห์เนทีฟส่งกลับโค้ดเทียมและแอสเซมบลี การวิเคราะห์ JavaScript/Electron กู้คืนโมดูลและความสัมพันธ์ระหว่างโมดูล เอเจนต์ใช้ข้อค้นพบเหล่านี้เพื่อเขียนและทดสอบการนำไปใช้งาน ดูตัวอย่างที่ทำจริงใน[ตัวอย่างการใช้งาน](#ตัวอย่างการใช้งาน)

</details>

<details>
<summary><strong>REA อัปโหลดแอปของฉันหรือไม่?</strong></summary>

REA วิเคราะห์เป้าหมายบนเครื่องของคุณ เอเจนต์ได้รับผลลัพธ์ของเครื่องมือ และผู้ให้บริการโมเดลของเอเจนต์มีนโยบายข้อมูลของตนเอง

</details>

<details>
<summary><strong>ควรทำอย่างไรเมื่อพบข้อผิดพลาด?</strong></summary>

อัปเดตก่อน รุ่นล่าสุดอาจแก้ไขปัญหานี้แล้ว

สำหรับ CLI ที่ติดตั้งผ่าน npm:

```bash
rea update
```

สำหรับการตั้งค่าเอเจนต์ผ่าน `npx`:

```bash
npx rea-agents@latest setup
```

หากใช้เอเจนต์ ให้ทำ[การปรับปรุงการตั้งค่า](#อัปเดต-rea) ให้เสร็จแล้วเริ่มเอเจนต์ใหม่ ลองงานเดิมอีกครั้ง หากยังพบปัญหา ให้[เปิด issue](https://github.com/morluto/rea/issues) พร้อมระบุรุ่น REA ประเภทเป้าหมาย ขั้นตอนทำให้เกิดปัญหา และข้อความข้อผิดพลาด

</details>

## เอกสาร

เริ่มจาก[คู่มือพร้อมตัวอย่าง](https://rea.tools/th/guides/) บนเว็บไซต์ สำหรับตัวเลือก ข้อกำหนดเบื้องต้น และสัญญาผลลัพธ์ที่แน่นอน:

- [การติดตั้งและตั้งค่า](../installation.md): การลงทะเบียนเอเจนต์ การตั้งค่าผู้ให้บริการ การอัปเดต และการถอนการติดตั้ง
- [ความพร้อมใช้งานและการแก้ไขปัญหา](../installation.md#check-readiness-for-your-task): ตรวจวินิจฉัยเอเจนต์หรือเอนจินวิเคราะห์หนึ่งตัว
- [CLI และ Evidence](../cli.md): คำสั่ง การเลือกผู้ให้บริการ สแนปช็อต การนำเข้า/ส่งออก และรหัสการสิ้นสุด
- [สัญญา MCP](../mcp-contracts.md) และ[พรอมป์ต์สำหรับเอเจนต์](../mcp-prompts.md): ผลลัพธ์เครื่องมือ เซสชัน และการตรวจสอบตามคำแนะนำ
- [แค็ตตาล็อกเครื่องมือ](../mcp-contracts.md#generated-catalog): รายการเครื่องมือ ผู้ให้บริการ และคำสั่ง CLI ที่สร้างระหว่างการบิลด์
- [แผนพัฒนา](../roadmap.md): งานที่วางแผนไว้และรายการติดตามความสามารถ

รายงานช่องโหว่ผ่าน [SECURITY.md](../../SECURITY.md)

## ประวัติดาว

🎉 **400,000 ดาวบน GitHub — ขอบคุณทุกคน!**

ขอบคุณทุกคนที่ใช้ REA รายงานบั๊ก เสนอฟีเจอร์ ทดสอบบิลด์ และช่วยแก้ไข

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="ประวัติดาว GitHub ของ REA" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## ข้อสงวนสิทธิ์

ดูแนวทางการใช้งานอย่างรับผิดชอบใน [DISCLAIMER.md](../../DISCLAIMER.md)

REA มีไว้สำหรับการวิจัย การศึกษา การทำงานร่วมกัน การอนุรักษ์ซอฟต์แวร์ และการวิเคราะห์ซอฟต์แวร์ที่คุณเป็นเจ้าของหรือได้รับอนุญาตให้ตรวจสอบ โดยปฏิบัติตามกฎหมาย

The project's position on illegal or unauthorized use covers all REA
versions, distribution channels, and platforms; each copy retains its
applicable licenses.

## การมีส่วนร่วม

เรายินดีรับความช่วยเหลือในการพัฒนา REA! [เปิด issue](https://github.com/morluto/rea/issues) เพื่อรายงานบั๊กหรือเสนอฟีเจอร์ หรือ[ส่ง pull request](https://github.com/morluto/rea/pulls) เพื่อปรับปรุงโค้ดหรือเอกสาร

ดู [CONTRIBUTING.md](../../CONTRIBUTING.md) สำหรับการตั้งค่าสภาพแวดล้อมพัฒนาและการตรวจสอบ ดู[การทดสอบ](../testing.md) สำหรับแนวทางการตรวจยืนยัน และ[แผนผังสถาปัตยกรรม](../architecture.mermaid) สำหรับโครงสร้างโปรเจกต์

## สัญญาอนุญาต

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
