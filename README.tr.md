<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>Yapay zeka destekli ofansif guvenlik ajan platformu.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Lisans" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
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

### CyberStrike Nedir?

CyberStrike, terminalinizde calisan acik kaynakli, otonom bir ofansif guvenlik ajandir. 13'ten fazla uzmanlasmis guvenlik ajani, 120'den fazla OWASP test senaryosu ile birlikte gelir ve 15'ten fazla LLM saglayicisini destekler. Hedefe yonlendirin; kesif, zafiyet tespiti ve rapor olusturma islemlerini tek bir TUI uzerinden gerceklestirir.

### Ozellikler

- **13+ Guvenlik Ajani** — Web uygulamasi (OWASP WSTG), mobil (MASTG/MASVS), bulut (AWS/Azure/GCP), Active Directory/Kerberos, ag ve 8 uzmanlasmis proxy test ajani (IDOR, enjeksiyon, SSRF, yetkilendirme atlama ve daha fazlasi)
- **30+ Yerlesik Arac** — Kabuk calistirma, HTTP istekleri, dosya islemleri, kod arama, web kazima, zafiyet raporlama
- **Bolt** — MCP protokolu ve Ed25519 eslestirme ile uzak arac sunucusu. Guvenlik araclarini uzak sunucularda calistirin, terminalinizden kontrol edin
- **MCP Ekosistemi** — Birinci taraf entegrasyonlar: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **15+ LLM Saglayicisi** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, OpenAI uyumlu uc noktalar uzerinden yerel modeller ve daha fazlasi
- **Coklu Arayuz** — TUI (terminal), Web (SolidJS), Masaustu (Tauri) — her yerde ayni ajan motoru
- **LSP Destegi** — IDE tabanli is akislari icin dil sunucu protokolu entegrasyonu
- **Eklenti Sistemi** — Eklenti SDK'si ile ozel ajanlar ve araclar olusturun

### Kurulum

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

### Hizli Baslangic

```bash
# CyberStrike'i baslatin
cyberstrike

# Ilk calistirmada LLM saglayicinizi secin, ardindan:
# "https://hedef.com uzerinde tam bir OWASP WSTG degerlendirmesi calistir"
```

### Ajanlar

TUI'de `Tab` tusu ile ajanlar arasinda gecis yapin.

| Ajan | Alan | Aciklama |
|------|------|----------|
| **cyberstrike** | Genel | Varsayilan tam erisimli ofansif guvenlik ajani |
| **web-application** | Web | OWASP Top 10, WSTG metodolojisi, API guvenligi |
| **mobile-application** | Mobil | Android/iOS testi, Frida, MASTG/MASVS |
| **cloud-security** | Bulut | AWS, Azure, GCP, IAM, CIS kiyaslama standartlari |
| **internal-network** | Ag | Active Directory, Kerberos, yanal hareket |

Ayrica hedefli zafiyet siniflari icin 8 uzmanlasmis **proxy test** ajani: IDOR, yetkilendirme, toplu atama, enjeksiyon, kimlik dogrulama, is mantigi, SSRF ve dosya saldirilari.

### Masaustu Uygulamasi

macOS, Windows ve Linux icin mevcuttur. [Surumler sayfasindan](https://github.com/CyberStrikeus/CyberStrike/releases) indirin.

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### Dokumantasyon

- [Dokumantasyon](https://cyberstrike.io/docs)
- [Katkida Bulunma](./CONTRIBUTING.md)
- [Davranis Kurallari](./CODE_OF_CONDUCT.md)

### Lisans

[AGPL-3.0-only](./LICENSE) — Ticari lisanslama icin [contact@cyberstrike.io](mailto:contact@cyberstrike.io) adresiyle iletisime gecin.

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
