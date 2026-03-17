<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">攻撃的セキュリティのために作られた、初のオープンソース AI エージェント。</h3>

<p align="center">
  ターミナルからの自律ペネトレーションテスト — 偵察、脆弱性発見、エクスプロイト、レポート作成。<br>
  コマンド一つ。13以上の専門エージェント。120以上の OWASP テストケース。あなたの AI レッドチーム。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/snunAaHf6U"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
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

<p align="center">
  <a href="#なぜ-cyberstrike-なのか？">なぜ CyberStrike なのか？</a> &bull;
  <a href="#何が違うのか">何が違うのか</a> &bull;
  <a href="#エージェント">エージェント</a> &bull;
  <a href="#mcp-エコシステム">MCP エコシステム</a> &bull;
  <a href="#bolt">Bolt</a> &bull;
  <a href="#インストール">インストール</a> &bull;
  <a href="#組み込みツール">組み込みツール</a> &bull;
  <a href="#誰のためのものか">誰のためのものか</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

### なぜ CyberStrike なのか？

セキュリティテストは今なお圧倒的に手作業です。ペネトレーションテスターは数十のツールを使い分け、ターミナル間で出力をコピー&ペーストし、実際の攻撃対象面に触れる前に何時間も反復的な偵察に費やします。バグバウンティハンターはプログラムごとに同じ偵察ワークフローを繰り返します。

**CyberStrike はそれを変えます。** 攻撃的セキュリティの方法論を理解する自律 AI エージェントです — 単にツールを実行するのではなく、何をテストすべきかを推論し、発見事項をチェーンし、発見した内容に基づいてアプローチを適応させます。ターミナルに疲れ知らずのレッドチームメンバーがいると考えてください。OWASP WSTG に従い、いつピボットすべきかを知り、完了したらレポートを書きます。

```bash
npm i -g cyberstrike@latest && cyberstrike
# "https://target.com に対して完全な OWASP WSTG 評価を実行してください"
```

オープンソースで、あらゆる LLM プロバイダーで動作し、生成物はすべてあなたのものです。

---

### 何が違うのか

<table>
<tr>
<td width="50%">

**汎用チャットではない、専門セキュリティエージェント**

CyberStrike にはセキュリティ領域向けに特化して構築された 13以上のエージェントが搭載されています。各エージェントはドメイン固有の方法論、ツールの知識、テストパターンを備えています。Web アプリケーションエージェントは WSTG に従います。クラウドセキュリティエージェントは CIS ベンチマークを知っています。モバイルエージェントは Frida を使用し MASTG/MASVS に従います。推測ではなく — 実証済みのフレームワークに従います。

</td>
<td width="50%">

**単なる補助ではなく、自律行動**

他の AI ツールは次に何をすべきか指示を待ちます。CyberStrike エージェントは多段階の攻撃チェーンを計画し、ツールを実行し、結果を分析し、興味深い発見があればピボットし、証拠に基づいたレポートを生成します。目的を設定すれば — エージェントが方法論を遂行します。

</td>
</tr>
<tr>
<td width="50%">

**あらゆる LLM、ベンダーロックインなし**

15以上のプロバイダーをすぐに利用可能：Anthropic、OpenAI、Google、Amazon Bedrock、Azure、Groq、Mistral、OpenRouter — OpenAI 互換エンドポイントを介したローカルモデルにも対応。Claude、GPT、Gemini、または自前でホスティングした LLM で実行できます。モデルがより強力で安価になれば、CyberStrike もそれに伴い向上します。

</td>
<td width="50%">

**Bolt によるリモートツール実行**

セキュリティツールをノートPCで実行する必要はありません。Bolt は CyberStrike のリモートツールサーバーです — ペンテストツールキットを備えた VPS にデプロイし、Ed25519 鍵でペアリングし、MCP プロトコルでローカルターミナルからすべてを制御します。一つの TUI、複数の攻撃サーバー。

</td>
</tr>
</table>

---

### エージェント

`Tab` でエージェントを切り替えます。それぞれがスペシャリストです。

| エージェント | 専門分野 | 機能説明 |
|-------------|---------|---------|
| **cyberstrike** | 汎用 | フルアクセスのプライマリエージェント — 偵察、エクスプロイト、レポート |
| **web-application** | Web | OWASP Top 10、WSTG 方法論、API セキュリティ、セッションテスト |
| **mobile-application** | モバイル | Android/iOS、Frida/Objection、MASTG/MASVS 準拠 |
| **cloud-security** | クラウド | AWS、Azure、GCP — IAM 設定ミス、CIS ベンチマーク、公開リソース |
| **internal-network** | ネットワーク | Active Directory、Kerberos 攻撃、ラテラルムーブメント、ピボット |

さらに、特定の脆弱性クラスに対してトラフィックを傍受・操作する **8つの専門プロキシテスター**があります：

`IDOR` · `認可バイパス` · `マスアサインメント` · `インジェクション` · `認証` · `ビジネスロジック` · `SSRF` · `ファイル攻撃`

---

### MCP エコシステム

CyberStrike は専門の MCP サーバーに接続して機能を拡張します：

| サーバー | ツール数 | 追加機能 |
|---------|---------|---------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | ブラウザベースのセキュリティテスト — XSS、CSRF、DOM 操作、Cookie 窃取 |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | クラウドセキュリティ監査 — AWS、Azure、GCP 全体で 60以上のチェック |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | GitHub セキュリティ態勢 — リポジトリ、組織、Actions、シークレット、サプライチェーン |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | CVE インテリジェンス — NVD、EPSS、CISA KEV、GitHub Advisory、OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | OSINT 偵察 — Shodan、VirusTotal、SecurityTrails、Censys、DNS、WHOIS |

すべてオープンソース。すべて `npx` でインストール可能。CyberStrike に接続するか、任意の MCP クライアントでスタンドアロンとして使用できます。

---

### Bolt

Bolt は CyberStrike のリモートツール実行サーバーです。セキュリティツールをノートPCで実行する代わりに、VPS（または複数台）にデプロイし、ローカルターミナルからすべてを制御できます。

```
┌──────────────┐         MCP Protocol         ┌──────────────────┐
│  Your Laptop │  ◄──── Ed25519 Auth ────►    │  VPS / Cloud     │
│  CyberStrike │         over HTTPS           │  Bolt Server     │
│  TUI         │                               │  nmap, nuclei,   │
│              │  ◄──── Tool Results ────►     │  sqlmap, ffuf...  │
└──────────────┘                               └──────────────────┘
```

**仕組み：**
- ペンテストツールキットがインストールされた任意のサーバーに Bolt をデプロイ
- Ed25519 鍵でペアリング — パスワード不要、共有シークレット不要
- CyberStrike エージェントが MCP プロトコル経由でリモートからツールを呼び出し
- 結果はリアルタイムでローカル TUI にストリーミング
- TUI から接続を管理：追加、削除、ステータス監視

**なぜ重要か：** 攻撃面は専用インフラストラクチャ上に留まります。より高帯域の VPS から重いスキャンを実行し、ツールを一箇所で最新に保ち、単一のターミナルから複数の攻撃サーバーを切り替えられます。

---

### インストール

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

**デスクトップアプリ**（macOS、Windows、Linux）— [リリースページ](https://github.com/CyberStrikeus/CyberStrike/releases)からダウンロード、または：

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### 組み込みツール

CyberStrike エージェントは 30以上のツールに直接アクセスできます：

| カテゴリ | ツール |
|---------|-------|
| **実行** | Shell（bash）、ファイル読み書き・編集、ディレクトリ一覧 |
| **ディスカバリ** | Web フェッチ、Web 検索、コード検索、glob、grep |
| **セキュリティ** | 脆弱性レポート（HackerOne 形式）、証拠収集 |
| **プロキシ** | HTTP/HTTPS 傍受、リクエストリプレイ、トラフィック分析 |
| **統合** | MCP サーバー、Bolt リモートツール、カスタムプラグイン |

さらに**プラグイン SDK** — 独自のエージェントやツールを構築し、ランタイムで登録できます。

---

### 誰のためのものか

- **ペネトレーションテスター** — 反復作業を自動化。エージェントに偵察と初期テストを任せ、人間の直感が必要なクリエイティブな攻撃チェーンに集中しましょう。
- **バグバウンティハンター** — より速い偵察、より広いカバレッジ、プログラム間で一貫した方法論。CyberStrike は午前3時でも疲れません。
- **セキュリティチーム** — 再現可能な方法論で構造化された OWASP アセスメントを実行。コンプライアンスチームが理解する標準にマッピングされたレポートを取得できます。
- **セキュリティ研究者** — カスタムエージェントと MCP サーバーで CyberStrike を拡張。プラグインシステムと MCP プロトコルにより、単なるツールではなくプラットフォームとなります。

---

### コントリビュート

CyberStrike はセキュリティコミュニティによって構築され、セキュリティコミュニティのために存在します。以下の分野でのコントリビュートを歓迎します：

- **セキュリティエージェントとスキル** — 新しい攻撃方法論、テストパターン、脆弱性検出
- **MCP サーバー** — 新しいセキュリティツールやデータソースの接続
- **ナレッジベース** — WSTG、MASTG、PTES、CIS 方法論ガイド
- **コア改善** — パフォーマンス、UX、プロバイダー統合、バグ修正

PR を提出する前に[コントリビュートガイド](./CONTRIBUTING.md)をお読みください。すべてのコントリビュートはプロジェクトの[倫理的使用ポリシー](./CODE_OF_CONDUCT.md)に従う必要があります — CyberStrike は許可されたセキュリティテスト専用です。

---

### ライセンス

[AGPL-3.0-only](./LICENSE) — 個人およびオープンソース利用は無料。商用ライセンスについては [contact@cyberstrike.io](mailto:contact@cyberstrike.io) までお問い合わせください。

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
  <sub>ターミナル間のコピー&ペーストに疲れたハッカーたちが構築しました。</sub>
</p>
