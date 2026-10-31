<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · **Türkçe** · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: Her şeyi tersine mühendislikle inceleyin

### İkili dosyaların, uygulamaların ve çalışma zamanı davranışının tersine mühendisliği için tek bir MCP.

**Beğendiğiniz bir özellik mi gördünüz? İkili kod düzeyine kadar nasıl çalıştığını anlayın.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Web sitesi](https://rea.tools/tr/) · [Rehberler](https://rea.tools/tr/guides/) · [Örnek çalışmalar](https://rea.tools/tr/showcase/)**

[Hızlı başlangıç](#hızlı-başlangıç) · [REA nasıl çalışır](#rea-nasıl-çalışır) · [Neleri analiz edebilirsiniz](#neleri-analiz-edebilirsiniz) · [Örnek çalışmalar](#örnek-çalışmalar) · [RL ortamları oluşturun](#build-rl-environments) · [Sık sorulan sorular](#sık-sorulan-sorular) · [GNU objdump ve Rizin araçları](../reverse-engineering-tools.md) · [Belgeler](#belgeler)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> REA’nın resmî kaynakları: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> Kurulum ve sürüm bağlantılarını bu resmî kaynaklardan takip edin. Benzer bir depo adı veya kopyalanmış bir README, indirilen dosyanın resmî olduğunu kanıtlamaz.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA, yerel bir ikili dosyayı incelerken Hopper içinde analiz köprüsünü başlatıyor" width="1200" />

<br /><br />

<table aria-label="REA topluluğu">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Tersine mühendislik topluluğuna katılın</strong>
  </a><br />
  <sub>Discord · Soru-cevap · Sonuç paylaşımı</sub>
</td>
</tr>
</table>

<br />

</div>

---

Bir uygulamada kendi ürününüze eklemek istediğiniz bir özellik mi gördünüz? Ajanınızdan REA ile araştırmasını isteyin. Kaynak kodu olmadan uygulamayı inceleyebilir, özelliğin nasıl çalıştığını açıklayabilir, kanıtları gösterebilir ve projenize uygun bir sürümünü geliştirebilir.

REA, ajanınızı yerel makine kodu içeren ikili dosyaları, JavaScript ve Electron uygulamalarını, .NET derlemelerini ve web sitelerini inceleyen araçlara bağlar. Aynı araçları terminalden de kullanabilirsiniz. Analiz yerel olarak çalışır; sonuçlar her çıkarımın dayandığı kanıtları ve sınırlamaları içerir.

Kurulum, REA'yı ajanınıza kaydeder ve uyumlu iş akışı talimatlarını yükler. Yerel makine kodu analizi mevcut bir Hopper, Ghidra, IDA veya Kuna kurulumunu kullanabilir; kurulum işlemi, onayınızla isteğe bağlı olarak Hopper da yükleyebilir. Statik JavaScript analizi bu yerel analiz motorlarından hiçbirine ihtiyaç duymaz.

> Kurulum talimatları, görselli rehberler ve gerçek örnek çalışmalar için **[REA web sitesini ziyaret edin](https://rea.tools/tr/)**.

## Hızlı başlangıç

Linux’ta Ghidra, JADX ve firmware araçlarının başlatılması ile statik JavaScript/Electron analizi, süreç sahipliğini doğrulamak için REA’nın `PATH` değişkeninde procps uyumlu `ps` gerektirir. Çözüm adımları için Linux ön koşuluna bakın.

### Ajanınızı yapılandırın

Node.js ve npm yüklüyken şu komutu çalıştırın:

```bash
npx rea-agents setup
```

Ajanlarınızı seçin, önerilen değişiklikleri inceleyin ve onaylayın. Kurulum, mevcut yapılandırmaları yedekleyerek REA'nın MCP sunucusunu ve uyumlu iş akışı talimatlarını ekler. Ardından ajanınızı yeniden başlatın.

Kurulum Claude Code, Codex, Cursor, Gemini CLI, Grok Build ve [diğer ajanları](../installation.md#supported-agents) destekler. Sağlayıcı yapılandırması ve elle MCP kaydı için [yükleme ve kurulum](../installation.md) belgesine bakın.

MCP varsayılan olarak kompakt girdi şemaları kullanır. Tam alan açıklamaları ve iç içe doğrulama ayrıntıları için MCP kaydında `REA_MCP_INPUT_SCHEMA_PROFILE=full` ayarlayın. Her iki profil tüm araçları ve aynı kanonik sunucu doğrulamasını korur; MCP sözleşme rehberine bakın.

### Ajanınıza sorun

```text
Notes uygulamasında aramanın nasıl çalıştığını araştır, kanıtları göster ve projem için benzer bir özellik geliştir.
```

Notes yerine hedef uygulamanızı ve anlamak istediğiniz özelliği belirtin.

### Terminali kullanın

Çıkarılmış bir JavaScript/Electron uygulama dizinini veya ASAR dosyasını inceleyin:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Sonuç; modülleri, içe aktarmaları, Electron sınırlarını ve bunlara ilişkin kanıtları içerir. Yolu hedefinizle değiştirin; Windows'ta örneğin `"D:/apps/example"` kullanabilirsiniz.

Düzenli kullanım için `rea` komutunu yüklemek üzere:

```bash
npm install --global rea-agents
rea --help
```

Yerel makine kodu analizi için önce bir sağlayıcı yapılandırın. Yerel analiz komutları, sağlayıcı seçimi, anlık görüntüler ve betik kullanımı için [CLI ve Evidence rehberine](../cli.md) bakın.

### REA'yı güncelleyin

REA hızla değişir ve yeni sürümler sık sık hata düzeltmeleri içerir. Kurulumunuzu güncel tutun.

`npm install --global` veya `bun add --global` ile yüklenen CLI için:

```bash
rea update
```

`rea --update`, aynı global çıktı seçeneklerini alan `rea update` takma adıdır. Güncelleme komutları toplam en fazla 4 MiB stdout/stderr tutar. Fazla büyük metaveri yanıtları komut bittikten sonra reddedilir; ayrıntılı kurulumlar sınırlı tanılama tutar. İlerleme çıktısı terminalin geri basıncına uyar ve gönderilmiş yazmaların bitmesini bekler.

Bun ile yapılan global güncellemeler için Bun 1.2.17 veya üzeri gerekir. Daha eski bir Bun sürümünü kullanıyorsanız `rea update` komutunu çalıştırmadan önce Bun'u manuel olarak yükseltin.

Ajan kayıtlarını ve skill'i güncellemek için güncellemenin çıktısında gösterilen kurulum komutunu çalıştırın.

`npx` kullanıyorsanız ajan kurulumunu şu komutla güncelleyin:

```bash
npx rea-agents@latest setup
```

Kurulum değişikliklerini inceleyin ve ajanınızı yeniden başlatın. Tek seferlik CLI işlemleri için `npx rea-agents@latest` komutunun ardından istediğiniz komutu yazın. Bun kullanıyorsanız `npx rea-agents@latest` yerine `bunx rea-agents@latest` kullanın.

## REA nasıl çalışır

Ajanınız, hedefi incelemek ve ilgili kodu izlemek için MCP üzerinden REA'yı çağırır. REA bulguları kanıtlarıyla birlikte döndürür. Ajan bunları takip soruları sormak, davranışı açıklamak veya bir uygulama yazıp test etmek için kullanır. CLI komutları aynı iş akışlarını kullanır.

![REA araştırma akışı: ajanınız yerel bir hedef hakkında soru sorar, REA analiz araçlarıyla hedefi inceler ve izler; ajan döndürülen kodu, referansları ve bilinmeyenleri açıklama, geliştirme ve test için kullanır.](../../website/public/assets/figures/rea-investigation-flow.svg)

[Şekli tam boyutuyla açın](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## Neleri analiz edebilirsiniz

REA; Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) veya 26+ (>=26.12.1) ve npm gerektirir. Ek araçlar ve desteklenen ana bilgisayar sistemleri hedefe bağlıdır:

| Hedef                                   | REA'nın döndürdükleri                                                                                       | Gereksinimler ve rehber                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Yerel makine kodu içeren ikili dosyalar | Sözde kod, assembly kodu, dizeler, semboller, çağrılar ve referanslar                                       | Hopper, Ghidra, IDA veya Kuna; [yerel kod analizi](../native-investigation.md)                                                     |
| Çevrimdışı ELF yapısı                   | Bölümler, segmentler, özgün semboller/yeniden konumlandırmalar ve statik analizden olası güvenlik önlemleri | Linux x64 üzerinde çağıranın sağladığı pwntools; [ikili dosya tanılama](../binary-diagnostics.md)                                  |
| Go ikili dosyaları                      | Gömülü compiler sürümü, modüller, replacement'lar ve build ayarları                                         | Yerleşik statik ELF/PE/thin Mach-O incelemesi; Go kurulumu gerekmez                                                                |
| Rust ikili dosyaları                    | Gömülü cargo-auditable crate adları, sürümleri, kaynakları ve bağımlılık ilişkileri                         | Yerleşik statik ELF/PE/thin Mach-O incelemesi; [Rust ikili dosyaları](../rust-binaries.md)                                         |
| PE certificates                         | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                                | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                            |
| PE imports                              | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                                  | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                      |
| ELF notes                               | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                                             | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                       |
| Apple IPS crashes                       | .ips metadata, threads, images, registers and crash classes                                                 | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                      |
| Linux kernel modules                    | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                                 | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                             |
| Erlang BEAM                             | IFF chunks, atoms, exports, and tables                                                                      | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                  |
| WASM artefaktı                          | Doğrulama, bölümler, tam import/export WAT biçimleri ve decode edilmiş WAT                                  | Çağıranın sağladığı WABT 1.0.42; `inspect_wasm_artifact`                                                                           |
| EVM bayt kodu                           | Yönlendirme seçicileri, bayt ofsetleri, çıkarımla belirlenen argümanlar ve durum değiştirilebilirliği       | Linux x64 üzerinde yerel ham bayt/onaltılık girdi; [çevrimdışı EVM rehberi](../evm-bytecode.md)                                    |
| SQLite veritabanları                    | Tablolar, sütunlar, index'ler, view'lar, trigger'lar ve seçilen sıradan tablo satırları                     | Yerel database/WAL snapshot'ı; native SQLite sınırlarıyla Node.js 24.x >=24.15 veya 26+                                            |
| Kaydedilmiş Linux çökmeleri             | Ham note kayıtları, kaydedilen her iş parçacığının yazmaçları/sinyalleri ve isteğe bağlı eşleme adayları    | Linux x64 üzerinde çağıranın sağladığı pwntools; isteğe bağlı GDB/pwndbg; [kaydedilmiş çökmeler](../recorded-crashes.md)           |
| Masaüstü kurulumları                    | Çalışma zamanı adayları, kanıt dosyaları, bileşen işaretleri ve sonraki adımlar                             | Sınırlı dizin ve başlık incelemesi；[Masaüstü uygulamaları](../desktop-applications.md)                                            |
| JavaScript / Electron                   | Modüller, içe aktarmalar, kaynak haritaları, rotalar, IPC ve yerel eklenti ilişkileri                       | Node.js ve npm; [uygulama analizi](../javascript-application-workflows.md); Linux: procps `ps`                                     |
| Web siteleri                            | Sayfa yapısı, betikler, ağ gözlemleri ve istenen ekran görüntüleri                                          | Chrome ailesinden bir tarayıcı; [tarayıcı analizi](../browser-observation.md)                                                      |
| Kaydedilmiş ağ yakalamaları             | İstekler, yanıtlar, erişilebilir yük içerikleri ve kaynak konumları                                         | HAR veya Fiddler Everywhere SAZ; Linux'ta native mitmproxy için mitmdump; [ağ yakalama rehberi](../web-network-captures.md)        |
| .NET derlemeleri                        | Meta veriler, CIL talimatları, bildirilmiş yerel bağımlılıklar ve derleme karşılaştırmaları                 | Statik inceleme; [yönetilen kod rehberi](../managed-code-analysis.md)                                                              |
| PyInstaller                             | CArchive, PYZ, Python bytecode                                                                              | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                              |
| Android APK'leri                        | Manifest bildirimleri, sınıflar, tersine derlenmiş metotlar ve referanslar                                  | Linux/macOS/Windows x64 üzerinde arayüzsüz JADX ve tam bir JDK; [Android rehberi](../android-analysis.md)                          |
| Android cihazları                       | Cihazlar, paketler, süreçler, günlükler, dökümler, ekran görüntüleri ve APK/dosya aktarımları               | Çağıranın sağladığı adb (emülatör veya cihaz); [ADB rehberi](../adb-device-analysis.md)                                            |
| JEB projeleri                           | Motor destekli proje birimleri, artefakt özetleri ve tür/metot sözdekodu                                    | Çağıranın başlattığı, MCP sunan bir JEB istemcisi, REA_JEB_MCP_URL ile seçilir; [JEB rehberi](../jeb-analysis.md)                  |
| Android kaynakları                      | Çözülmüş manifest, dize tabloları, diller ve sürüm bilgileri                                                | Çağıranın sağladığı Apktool başlatıcısı; [kaynak rehberi](../apktool-resource-analysis.md)                                         |
| Flutter uygulamaları                    | Dart anlık görüntü karması, ABI başına kitaplık özetleri ve motor derleme kökeni                            | Yok (statik APK çözümleme); [Flutter rehberi](../flutter-analysis.md)                                                              |
| Donanım yazılımı                        | Bölgeler, çıkarma sonuçları ve yerel kod analizine devirler                                                 | Linux üzerinde Binwalk / Unblob; [donanım yazılımı rehberi](../firmware-analysis.md)                                               |
| Kaydedilmiş paketler                    | Seçilen alanlar, yinelenen değerler, filtreler ve çözümleme kuralları                                       | Linux: TShark 4.x + prlimit; [yakalama kılavuzu](../packet-captures.md)                                                            |
| Paket özetleri                          | Uç noktalar, DNS, TLS SNI, protokol dağılımı ve HTTP istekleri                                              | Çağıranın sağladığı tshark ve capinfos (Linux üzerinde doğrulandı); [pcap rehberi](../pcap-analysis.md)                            |
| Kaydedilmiş mantık sinyalleri           | Kod çözücü açıklamaları, örnek aralıkları ve tanılama                                                       | Linux: sigrok-cli 0.7.2 + prlimit; [sinyal kılavuzu](../signal-recordings.md)                                                      |
| Paketler ve kaynaklar                   | Dosya envanterleri, özet değerleri, plist'ler, Apple paket yapısı ve çıkarılmış kaynaklar                   | [Artefakt ve JavaScript rehberi](../javascript-artifact-reconstruction.md), [Apple uygulamaları](../apple-application-analysis.md) |
| Süreç davranışı                         | Terminal çıktısı, etkileşimler, sonlanma ve dosya sistemi gözlemleri, çalıştırma karşılaştırmaları          | Yerel PTY ile Linux/macOS; [süreç yakalama](../process-capture.md)                                                                 |
| GPU kod nesneleri                       | CUDA/HIP hedefleri, seçili kernel parametreleri ve kaynakları, korunan PTX metni                            | Yerleşik statik inceleme ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                    |
| Model dosyaları                         | GGUF / safetensors metaverisi, tensor bildirimleri ve türetilmiş toplamlar                                  | Başlık incelemesi; tüm dosyanın hash’i isteğe bağlı; [GGUF / safetensors](../model-artifacts.md)                                   |
| IL2CPP metaverisi                       | Unity global-metadata.dat assembly görüntüleri, tür/metot adları ve dizin aralıkları                        | 24, 27, 29, 31, 39 sürümlerini statik çözümleme; Unity gerekmez                                                                    |
| Godot PCK                               | Arşiv envanteri ve çıkarma, özgün başlık/dizin bilgileri ve seçili içerik kimlikleri                        | Statik biçimler 2, 3, 4; Godot gerekmez                                                                                            |
| APK imzaları                            | v1/v2/v3/v3.1 imzalayanları, sertifika parmak izleri, anahtar rotasyonu ve digest iç tutarlılığı            | Yerleşik statik inceleme; `inspect_apk_signature`                                                                                  |

Statik JavaScript ve .NET incelemesi, uygulamayı çalıştırmadan sağlanan dosyaları okur. Çalışma zamanı yakalaması, seçilen hedefi kullanıcı izinlerinizle çalıştırır veya onunla etkileşime girer; her çalışma zamanı rehberi etkilerini açıklar.

<a id="choosing-a-deep-analysis-provider"></a>

Yerel makine kodu içeren ikili dosya biçimleri ve ana bilgisayar desteği sağlayıcıya göre değişir. [Hopper ve Ghidra kurulumu](../installation.md#hopper), isteğe bağlı native MCP bridge'i de açıklayan [IDA rehberi](../ida-provider.md), [Kuna](../kuna-provider.md) ve [Windows için deneysel Ghidra desteği](../windows-ghidra-p0.md) belgelerine bakın. Ghidra ayrıca [16 bit DOS analizini](../ghidra-dos.md) destekler. Büyük ikili dosyalar için sağlayıcının başlatma zaman aşımını `REA_GHIDRA_STARTUP_TIMEOUT_MS` veya `REA_HOPPER_STARTUP_TIMEOUT_MS` ile artırın. Sağlayıcı seçimi için [CLI rehberine](../cli.md#choose-a-provider) bakın. En son npm sürümünden sonra eklenen özellikler için [sürümlerde kullanılabilirliği](../installation.md#released-package-and-main) kontrol edin.

## Örnek çalışmalar

<a href="https://rea.tools/tr/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="DX-Ball ses kaydırma, Notion pano köprüsü ve TH04 mermi halkası örneklerinin çizimleri" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: Sesin stereo konumlandırma hesabını yeniden oluşturma

Bir ses çağrısından konumu stereo konumlandırmaya dönüştüren yardımcı fonksiyona ilerleyin, talimatları inceleyin ve eksik sözde kodu C'ye dönüştürün. Yeniden oluşturulan kod, özgün x86 üzerinde 3.205 test durumunu geçer ve derlenmiş fonksiyonun 63 baytının tamamını yeniden üretir.

[Örnek çalışmayı okuyun](https://rea.tools/tr/showcase/dx-ball/) · [Yeniden oluşturma deposu](https://github.com/N0zoM1z0/dx-ball)

### Notion: Electron pano köprüsünü izleme

İşleyici sürecin pano API'sini bulun, preload ve IPC üzerinden ana sürece kadar izleyin ve zengin pano biçimini inceleyin.

[Örnek çalışmayı okuyun](https://rea.tools/tr/showcase/notion/)

### TH04: DOS mermi halkası hesabını geri çıkarma

Özgün PC-98 oyununun 16 bit talimatlarını inceleyin, sabit ve hedefe yönelik açı hesaplarını geri çıkarın ve yeniden oluşturulan C++ kodunu dönemin derleyici çıktısıyla karşılaştırın.

[Örnek çalışmayı okuyun](https://rea.tools/tr/showcase/th04/) · [Yeniden oluşturma deposu](https://github.com/N0zoM1z0/th04)

### REA ile RL ortamları oluşturun

Bir web uygulaması oturumunu kaydedin, API’sini araçlara dönüştürün ve bir yapay zekâ ajanının kullanabileceği ortamı dışa aktarın. AgentEnv ile çalıştırın, ardından RL eğitimi veya değerlendirmesi için görevler ve ödül kontrolleri ekleyin.

[Ortam oluşturma rehberi](https://rea.tools/guides/rl-environments/) ·
[Demoyu X’te izleyin](https://x.com/reatools/status/2112574822584918075?s=20)

REA'yı ilginç bir konuda kullandıysanız görmek isteriz. Hedefi, sorunuzu, REA'nın nasıl yardımcı olduğunu ve bulgularınızı bir [issue](https://github.com/morluto/rea/issues) veya [pull request](https://github.com/morluto/rea/pulls) ile paylaşın.

<a id="build-rl-environments"></a>

## RL ortamları oluşturun

Asıl uygulamayı çalıştırmadan, yapay zekâ ajanının sorun bulma veya klasör oluşturma gibi görevleri deneyeceği yerel bir ortam oluşturun. Bunu pekiştirmeli öğrenme (RL) veya ajanın görevleri ne kadar iyi tamamladığını test etmek için kullanın.

REA, kaydedilmiş API isteklerini ve yanıtlarını ajanın çağırabileceği araçlara dönüştürür. Ortam kayıtlı verileri kullanır ve yalnızca etkisi kayıtla doğrulanan değişiklikleri destekler.

Ajanınızda REA’yı kurduktan sonra aşağıdaki örnek URL’yi ve klasör görevlerini kendinize göre değiştirin:

```text
REA ile şu test web uygulamamdan bir RL ortamı oluştur:
http://127.0.0.1:3000
Klasör listeleme, oluşturma, yeniden adlandırma ve silme işlemlerini kapsa.
Test klasörleri oluşturup silebilirsin. Mevcut verileri değiştirme.
my-env adlı klasöre kaydet, hangi işlemlerin çalıştığını kontrol et ve nasıl çalıştıracağımı anlat.
```

<details>
<summary>Komut satırını kullanın</summary>

Uygulamanın tarayıcı isteklerini ve yanıtlarını kaydettiğiniz bir dosya varsa bu komutları kullanabilirsiniz. Oluşan ortamı çalıştırmak için AgentEnv ve Docker da gerekir.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA, çalıştırılabilir bir ortamı ve başlayıp yanıt verdiğini kontrol eden temel bir testi dışa aktarır. Görev hedeflerini ve ödül kontrollerini tanımlamak, ardından eğitim çalıştırmak için RL çerçevenizle kullanın.

[Ortam oluşturma rehberi](https://rea.tools/guides/rl-environments/) ·
[Ortam referansı](../agent-environments.md) ·
[Demoyu X’te izleyin](https://x.com/reatools/status/2112574822584918075?s=20)

## Sık sorulan sorular

<details>
<summary><strong>Hangi ajanlar REA'yı kullanabilir?</strong></summary>

Yerel MCP sunucularını destekleyen her ajan REA'yı kullanabilir. Kurulum, [desteklenen ajanları](../installation.md#supported-agents) yapılandırır; diğer istemciler [elle MCP kaydını](../installation.md#mcp-registry) kullanabilir.

</details>

<details>
<summary><strong>Hopper, Ghidra, IDA veya Kuna gerekiyor mu?</strong></summary>

Derin yerel kod analizi bunlardan birini kullanır. Statik JavaScript ve .NET incelemesi yerel analiz motoru olmadan çalışır. Kurulum onaydan sonra Hopper yükleyebilir; Ghidra, IDA ve Kuna mevcut kurulumlarınızı kullanır. [Sağlayıcı kurulumuna](../installation.md#hopper) bakın.

</details>

<details>
<summary><strong>Önce Hopper'ı başlatmam gerekiyor mu?</strong></summary>

REA, bir işlem gerektirdiğinde Hopper'ı başlatır. macOS'ta ilk çalıştırmada demo modunu seçmenizi veya lisansınızı etkinleştirmenizi isteyen bir iletişim kutusu açılabilir. [Hopper başlatma ve sorun giderme](../installation.md#launcher-paths-and-troubleshooting) belgesine bakın.

</details>

<details>
<summary><strong>skills.sh üzerinden skill yüklemek ne yapar?</strong></summary>

Skill, ajanınıza araştırma talimatları sağlar. REA'nın MCP sunucusunu kaydetmek ve uyumlu talimatları yüklemek için `npx rea-agents setup` kullanın, ardından ajanınızı yeniden başlatın. [Yalnızca skill yükleme](../installation.md#skill-only-installation) belgesine bakın.

</details>

<details>
<summary><strong>REA hangi kodu döndürür?</strong></summary>

Yerel kod analizi sözde kod ve assembly kodu döndürür. JavaScript/Electron analizi modülleri ve aralarındaki ilişkileri geri çıkarır. Ajanınız bu bulgularla bir uygulama yazar ve test eder; [örnek çalışmalar](#örnek-çalışmalar) uygulamalı örnekler sunar.

</details>

<details>
<summary><strong>REA uygulamamı yükler mi?</strong></summary>

REA hedefleri yerel olarak analiz eder. Ajanınız araç sonuçlarını alır ve model sağlayıcısının kendi veri politikası vardır.

</details>

<details>
<summary><strong>Bir hatayla karşılaşırsam ne yapmalıyım?</strong></summary>

Önce güncelleyin; yakın tarihli bir sürüm hatayı düzeltmiş olabilir.

npm ile yüklenen CLI için:

```bash
rea update
```

`npx` üzerinden ajan kurulumu için:

```bash
npx rea-agents@latest setup
```

Ajan kullanıyorsanız [kurulum yenilemesini](#reayı-güncelleyin) tamamlayın ve ajanı yeniden başlatın. Aynı görevi tekrar deneyin. Sorun sürerse REA sürümünüzü, hedef türünü, yeniden üretme adımlarını ve hata çıktısını içeren bir [issue açın](https://github.com/morluto/rea/issues).

</details>

## Belgeler

Web sitesindeki [uygulamalı rehberlerden](https://rea.tools/tr/guides/) başlayın. Kesin seçenekler, ön koşullar ve sonuç sözleşmeleri için:

- [Yükleme ve kurulum](../installation.md): ajan kaydı, sağlayıcı yapılandırması, güncellemeler ve kaldırma.
- [Hazırlık ve sorun giderme](../installation.md#check-readiness-for-your-task): belirli bir ajanı veya analiz motorunu tanılama.
- [CLI ve Evidence](../cli.md): komutlar, sağlayıcı seçimi, anlık görüntüler, içe/dışa aktarma ve çıkış durumları.
- [MCP sözleşmeleri](../mcp-contracts.md) ve [ajan istemleri](../mcp-prompts.md): araç sonuçları, oturumlar ve yönlendirmeli araştırmalar.
- [Araç kataloğu](../mcp-contracts.md#generated-catalog): derleme sırasında oluşturulan araç, sağlayıcı ve CLI komutu envanteri.
- [Yol haritası](../roadmap.md): planlanan çalışmalar ve yetenek takibi.

Güvenlik açıklarını [SECURITY.md](../../SECURITY.md) üzerinden bildirin.

## Yıldız geçmişi

🎉 **GitHub'da 400.000 yıldız — teşekkürler!**

REA'yı kullanan, hata bildiren, özellik talep eden, derlemeleri test eden ve düzeltmelere katkıda bulunan herkese teşekkürler.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="REA GitHub yıldız geçmişi" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Sorumluluk reddi

Sorumlu kullanım yönergeleri için [DISCLAIMER.md](../../DISCLAIMER.md) dosyasına bakın.

REA; yasal araştırma, eğitim, birlikte çalışabilirlik, yazılımın korunması ve sahibi olduğunuz ya da inceleme yetkiniz bulunan yazılımların analizi için tasarlanmıştır.

Projenin yasa dışı veya yetkisiz kullanıma ilişkin tutumu tüm REA sürümleri,
dağıtım kanalları ve platformlar için geçerlidir; her kopya geçerli lisanslarını
korur.

## Katkıda bulunma

REA'ya katkınızı bekliyoruz! Hata bildirmek veya özellik önermek için bir [issue açın](https://github.com/morluto/rea/issues); kodu veya belgeleri geliştirmek için bir [pull request gönderin](https://github.com/morluto/rea/pulls).

Geliştirme ortamı ve kontroller için [CONTRIBUTING.md](../../CONTRIBUTING.md), doğrulama süreçleri için [test rehberi](../testing.md) ve proje yapısı için [mimari harita](../architecture.mermaid) belgelerine bakın.

## Lisans

[MIT](../../LICENSE)

REA tarafından yazılan kod MIT lisansı altında lisanslanır. Üçüncü taraf
materyaller kendi lisanslarını ve telif hakkı bildirimlerini korur; bağımlılık
envanteri, korunan lisans metinleri ve harici araç koşulları için [Üçüncü taraf
bildirimleri](../../THIRD_PARTY_NOTICES.md) dosyasına bakın.

**IDA Pro / Hex-Rays decompiler'ları, Hopper ve JEB dahil olmak üzere ticari
araçları yasal olarak edinmeli ve ilgili lisanslar kapsamında kullanma
yetkiniz olmalıdır.** REA hiçbir araç lisansı, anahtarı veya etkinleştirme hakkı
vermez. Deneme sürümleri ve demolar; kullanıcı, özellik, otomasyon ve çıktı
paylaşımı kısıtlamaları dahil olmak üzere satıcı koşullarına tabidir. Kırılmış
kopyalar, çalınmış anahtarlar, yetkisiz anahtar paylaşımı ve lisans
kısıtlamalarını aşma yetkili kullanım kapsamında değildir. Bu yönlendirme MIT
veya üçüncü taraf lisanslarını değiştirmez.
