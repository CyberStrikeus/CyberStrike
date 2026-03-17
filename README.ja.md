<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>AI 駆動の攻撃的セキュリティエージェントプラットフォーム。</b></p>

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

### CyberStrike とは？

CyberStrike は、ターミナルで動作するオープンソースの自律型攻撃的セキュリティエージェントです。13 以上の専門セキュリティエージェント、120 以上の OWASP テストケースを内蔵し、15 以上の LLM プロバイダーに対応しています。ターゲットを指定するだけで、偵察、脆弱性発見、レポート生成まですべてを単一の TUI で処理します。

### 機能

- **13 以上のセキュリティエージェント** — Web アプリケーション（OWASP WSTG）、モバイル（MASTG/MASVS）、クラウド（AWS/Azure/GCP）、Active Directory/Kerberos、ネットワーク、そして 8 つの専門プロキシテスター（IDOR、インジェクション、SSRF、認証バイパスなど）
- **30 以上の組み込みツール** — Shell 実行、HTTP リクエスト、ファイル操作、コード検索、Web スクレイピング、脆弱性レポート
- **Bolt** — MCP プロトコルと Ed25519 ペアリングによるリモートツールサーバー。リモートサーバーでセキュリティツールを実行し、ターミナルから制御
- **MCP エコシステム** — ファーストパーティ統合：[hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp)、[cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp)、[github-security-mcp](https://github.com/badchars/github-security-mcp)、[cve-mcp](https://github.com/badchars/cve-mcp)、[osint-mcp](https://github.com/badchars/osint-mcp)
- **15 以上の LLM プロバイダー** — Anthropic、OpenAI、Google、Amazon Bedrock、Azure、Groq、DeepInfra、Mistral、OpenRouter、OpenAI 互換エンドポイント経由のローカルモデルなど
- **マルチインターフェース** — TUI（ターミナル）、Web（SolidJS）、デスクトップ（Tauri）——どこでも同じエージェントエンジン
- **LSP サポート** — IDE ベースのワークフロー向け言語サーバープロトコル統合
- **プラグインシステム** — プラグイン SDK でカスタムエージェントやツールを構築

### インストール

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

### クイックスタート

```bash
# CyberStrike を起動
cyberstrike

# 初回起動時に LLM プロバイダーを選択し、その後：
# "https://target.com に対して完全な OWASP WSTG 評価を実行してください"
```

### エージェント

TUI で `Tab` キーを押してエージェントを切り替えます。

| エージェント | 領域 | 説明 |
|-------------|------|------|
| **cyberstrike** | 汎用 | デフォルトのフルアクセス攻撃的セキュリティエージェント |
| **web-application** | Web | OWASP Top 10、WSTG 方法論、API セキュリティ |
| **mobile-application** | モバイル | Android/iOS テスト、Frida、MASTG/MASVS |
| **cloud-security** | クラウド | AWS、Azure、GCP、IAM、CIS ベンチマーク |
| **internal-network** | ネットワーク | Active Directory、Kerberos、ラテラルムーブメント |

さらに、特定の脆弱性クラスに対応する 8 つの専門**プロキシテスター**エージェントがあります：IDOR、認可、マスアサインメント、インジェクション、認証、ビジネスロジック、SSRF、ファイル攻撃。

### デスクトップアプリ

macOS、Windows、Linux で利用可能です。[リリースページ](https://github.com/CyberStrikeus/CyberStrike/releases)からダウンロードしてください。

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### ドキュメント

- [ドキュメント](https://cyberstrike.io/docs)
- [コントリビューションガイド](./CONTRIBUTING.md)
- [行動規範](./CODE_OF_CONDUCT.md)

### ライセンス

[AGPL-3.0-only](./LICENSE) — 商用ライセンスについては [contact@cyberstrike.io](mailto:contact@cyberstrike.io) までお問い合わせください。

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
