<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · **日本語** · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA：あらゆるものをリバースエンジニアリング

### バイナリ、アプリケーション、実行時の動作を、ひとつの MCP でリバースエンジニアリング。

**気に入った機能を見つけたら、その仕組みをバイナリのレベルまで理解する。**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[ウェブサイト](https://rea.tools/ja/) · [ガイド](https://rea.tools/ja/guides/) · [事例](https://rea.tools/ja/showcase/)**

[クイックスタート](#クイックスタート) · [REA の仕組み](#rea-の仕組み) · [分析できる対象](#分析できる対象) · [事例](#事例) · [RL 環境を構築する](#build-rl-environments) · [よくある質問](#よくある質問) · [ドキュメント](#ドキュメント)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> REA の公式配布元： [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> インストールとリリースのリンクは、これらの公式配布元からたどってください。似たリポジトリ名やコピーされた README だけでは、公式の配布物とは確認できません。

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA が Hopper 内で分析ブリッジを起動し、ネイティブバイナリを調べる様子" width="1200" />

<br /><br />

<table aria-label="REA コミュニティ">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>リバースエンジニアリングのコミュニティに参加</strong>
  </a><br />
  <sub>Discord · 質問と回答 · 成果の共有</sub>
</td>
</tr>
</table>

<br />

</div>

---

アプリに、自分の製品にも取り入れたい機能を見つけましたか？エージェントに REA で調査を依頼してください。ソースコードがなくてもアプリを調べ、機能の仕組みを説明し、根拠を示したうえで、あなたのプロジェクト向けに実装できます。

REA はエージェントを分析ツールにつなぎ、ネイティブバイナリ、JavaScript や Electron のアプリ、.NET アセンブリ、ウェブサイトを調べられるようにします。同じツールをターミナルからも使えます。分析はローカルで実行され、結果には各結論を裏付ける根拠と制限事項が含まれます。

セットアップはエージェントに REA を登録し、対応するワークフロー指示をインストールします。ネイティブ解析には既存の Hopper、Ghidra、IDA、Kuna を使用でき、承認すれば Hopper をインストールできます。静的 JavaScript 解析にネイティブ解析エンジンは不要です。

> **[REA のウェブサイト](https://rea.tools/ja/)**で、セットアップ手順、図解ガイド、実際の事例を確認できます。

## クイックスタート

Linux での Ghidra、JADX、ファームウェアツールの起動と静的 JavaScript/Electron 解析には、プロセス所有権の確認用に、REA の `PATH` 上に procps 互換の `ps` が必要です。対処方法はインストールガイドの Linux 前提条件を参照してください。

### エージェントを設定する

Node.js と npm がインストールされている環境で実行します。

```bash
npx rea-agents setup
```

使うエージェントを選び、予定されている変更を確認して承認してください。セットアップは REA の MCP サーバーと対応するワークフローの手順を追加し、既存の設定をバックアップします。完了後にエージェントを再起動してください。

セットアップは Claude Code、Codex、Cursor、Gemini CLI、Grok Build、および[その他のエージェント](../installation.md#supported-agents)に対応しています。プロバイダーの設定と MCP の手動登録については、[インストールとセットアップ](../installation.md)を参照してください。

MCP は既定でコンパクトな入力スキーマを使用します。完全なフィールド説明と入れ子の検証情報が必要な場合は、MCP 登録に `REA_MCP_INPUT_SCHEMA_PROFILE=full` を設定してください。どちらも全ツールと同じ正規サーバー検証を維持します。詳細は MCP 契約ガイドを参照してください。

### エージェントに依頼する

```text
Notes アプリの検索機能の仕組みを調べ、根拠を示して、私のプロジェクトにも同様の機能を実装してください。
```

Notes を対象のアプリに置き換え、理解したい機能を指定してください。

### ターミナルを使う

展開済みの JavaScript/Electron アプリのディレクトリ、または ASAR を調べます。

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

結果にはモジュール、インポート、Electron の境界と、それらの根拠が含まれます。パスは対象に合わせて変更してください。Windows では、たとえば `"D:/apps/example"` を指定します。

日常的に使う場合は、`rea` コマンドをインストールできます。

```bash
npm install --global rea-agents
rea --help
```

ネイティブ分析には、先にプロバイダーの設定が必要です。ネイティブ分析のコマンド、プロバイダーの選択、スナップショット、スクリプトでの利用は、[CLI と Evidence のガイド](../cli.md)を参照してください。

### REA を更新する

REA は更新が速く、新しいリリースには頻繁にバグ修正が含まれます。インストールしたバージョンを最新に保ってください。

`npm install --global` / `bun add --global` でインストールした CLI の場合：

```bash
rea update
```

`rea --update` は `rea update` の別名で、同じグローバル出力オプションを受け付けます。更新コマンドが保持する stdout/stderr は合計 4 MiB までです。大きすぎるメタデータは終了後に拒否され、詳細なインストール出力は制限付きで保持されます。進捗出力は端末のバックプレッシャーに従い、送信済みの書き込み完了を待ちます。

Bun のグローバル更新には Bun 1.2.17 以降が必要です。古い場合は、`rea update` の前に Bun を手動で更新してください。

エージェントの登録とスキルを更新するには、更新処理が表示するセットアップコマンドを実行してください。

`npx` を使っている場合は、次のコマンドでエージェントの設定を更新します。

```bash
npx rea-agents@latest setup
```

設定の変更を確認し、エージェントを再起動してください。単発の CLI 操作では、`npx rea-agents@latest` に続けてコマンドを指定します。

Bun では `npx rea-agents@latest` の代わりに `bunx rea-agents@latest` を使ってください。

## REA の仕組み

エージェントは MCP 経由で REA を呼び出し、対象を調べて関連するコードを追跡します。REA は調査結果と根拠を返します。エージェントはそれを使って追加の質問をしたり、動作を説明したり、実装を書いてテストしたりします。CLI コマンドも同じワークフローを使います。

![REA の調査フロー：エージェントがローカルの対象について質問し、REA が分析ツールで調査・追跡します。エージェントは返されたコード、参照、未解明の点を使い、説明、実装、テストを行います。](../../website/public/assets/figures/rea-investigation-flow.svg)

[原寸大の図を開く](../../website/public/assets/figures/rea-investigation-flow.svg)。

<a id="current-status"></a>

## 分析できる対象

REA には Node.js 22.x（>=22.23.4）、24.x（>=24.22.1）、または 26+ (>=26.12.1) と npm が必要です。追加のツールや対応ホストは、対象によって異なります。

| 対象                             | REA が返すもの                                                                              | 要件とガイド                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ネイティブバイナリ               | 疑似コード、アセンブリ、文字列、シンボル、呼び出し、参照                                    | Hopper、Ghidra、IDA、または Kuna；[ネイティブ分析](../native-investigation.md)                                                                 |
| オフライン ELF レイアウト        | セクション、セグメント、元のシンボル／再配置情報、静的解析によるセキュリティ対策の候補      | Linux x64 で利用者が用意する pwntools；[バイナリ診断](../binary-diagnostics.md)                                                                |
| PE certificates                  | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                                        |
| PE imports                       | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                  | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                                  |
| EVM バイトコード                 | ディスパッチセレクター、バイトオフセット、推定された引数と状態変更の可否                    | Linux x64 上のローカルの生バイト／16 進数の入力ファイル；[オフライン EVM ガイド](../evm-bytecode.md)                                           |
| Rust binaries                    | Embedded cargo-auditable dependency list                                                    | [Rust binaries](../rust-binaries.md)                                                                                                           |
| ELF notes                        | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                             | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                                   |
| Apple IPS crashes                | .ips metadata, threads, images, registers and crash classes                                 | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                                  |
| Linux kernel modules             | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                 | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                                         |
| Erlang BEAM                      | IFF chunks, atoms, exports, and tables                                                      | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                              |
| 記録済みの Linux クラッシュ      | 生の note レコード、記録された全スレッドのレジスター／シグナル、任意のマッピング候補        | Linux x64 で利用者が用意する pwntools；GDB/pwndbg は任意；[記録済みクラッシュ](../recorded-crashes.md)                                         |
| デスクトップのインストール先     | ランタイム候補、根拠ファイル、コンポーネントの目印、次の調査手順                            | 上限付きのディレクトリ・ヘッダー検査；[デスクトップアプリ](../desktop-applications.md)                                                         |
| JavaScript / Electron            | モジュール、インポート、ソースマップ、ルート、IPC、ネイティブアドオンの関係                 | Node.js と npm；[アプリケーション分析](../javascript-application-workflows.md); Linux: procps `ps`                                             |
| ウェブサイト                     | ページ構造、スクリプト、ネットワークの観測結果、依頼されたスクリーンショット                | Chrome 系ブラウザー；[ブラウザー分析](../browser-observation.md)                                                                               |
| 保存済みのネットワークキャプチャ | リクエスト、レスポンス、取得可能なペイロード、ソース内の位置                                | HAR / Fiddler Everywhere SAZ；mitmproxy ネイティブ形式のキャプチャには Linux 上の mitmdump；[キャプチャガイド](../web-network-captures.md)     |
| パケットキャプチャ               | エンドポイント、DNS、TLS SNI、プロトコル分布、HTTPリクエスト                                | 呼び出し側が用意した tshark と capinfos；[pcapガイド](../pcap-analysis.md)                                                                     |
| .NET アセンブリ                  | メタデータ、CIL 命令、宣言されたネイティブ依存関係、ビルドの比較                            | 静的な検査；[マネージドコードのガイド](../managed-code-analysis.md)                                                                            |
| PyInstaller                      | CArchive, PYZ, Python bytecode                                                              | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                                          |
| Android APK                      | マニフェストの宣言、クラス、逆コンパイルされたメソッド、参照                                | Linux/macOS/Windows x64 上のヘッドレス JADX と完全な JDK；[Android ガイド](../android-analysis.md)                                             |
| Android デバイス                 | デバイス、パッケージ、プロセス、ログ、ダンプ、スクリーンキャプチャ、APK/ファイル転送        | 呼び出し側が用意した adb（エミュレーターまたは実機）；[ADB ガイド](../adb-device-analysis.md)                                                  |
| JEBプロジェクト                  | エンジンによるプロジェクトユニット、アーティファクトのダイジェスト、型/メソッドの擬似コード | 呼び出し側が起動し MCP を提供する JEB クライアント（REA_JEB_MCP_URL で選択）；[JEB ガイド](../jeb-analysis.md)                                 |
| Android リソース                 | デコードされたマニフェスト、文字列テーブル、ロケール、バージョン情報                        | 呼び出し側が用意した Apktool ランチャー；[リソースガイド](../apktool-resource-analysis.md)                                                     |
| Flutter アプリ                   | Dart スナップショットハッシュ、ABI ごとのライブラリダイジェスト、エンジンビルドの来歴       | 不要（静的 APK 解析）；[Flutter ガイド](../flutter-analysis.md)                                                                                |
| ファームウェア                   | 領域、抽出結果、ネイティブ分析への引き継ぎ                                                  | Linux 上の Binwalk / Unblob；[ファームウェアガイド](../firmware-analysis.md)                                                                   |
| 記録済みパケット                 | 選択フィールド、繰り返し値、フィルター、デコード指定                                        | Linux: TShark 4.x + prlimit; [キャプチャガイド](../packet-captures.md)                                                                         |
| 記録済みロジック信号             | デコーダ注釈、サンプル範囲、診断情報                                                        | Linux: sigrok-cli 0.7.2 + prlimit; [信号記録ガイド](../signal-recordings.md)                                                                   |
| パッケージとリソース             | ファイル一覧、ダイジェスト、plist、Apple バンドルの構造、抽出されたリソース                 | [アーティファクトと JavaScript のガイド](../javascript-artifact-reconstruction.md)、[Apple アプリケーション](../apple-application-analysis.md) |
| プロセスの動作                   | ターミナル出力、対話、終了とファイルシステムの観測結果、実行の比較                          | ネイティブ PTY を備えた Linux/macOS；[プロセスキャプチャ](../process-capture.md)                                                               |
| Go バイナリ                      | 埋め込みコンパイラバージョン、モジュール、置換、ビルド設定                                  | 組み込みの静的解析 ELF/PE/thin Mach-O; Go のインストールは不要                                                                                 |
| SQLite データベース              | テーブル、列、インデックス、ビュー、トリガー、選択した通常テーブルの行                      | ローカル DB/WAL スナップショット。ネイティブ SQLite 制限 API を備える Node.js 24.x >=24.15 または 26+                                          |
| GPU コードオブジェクト           | CUDA/HIP ターゲット、選択したカーネルの引数とリソース、保持された PTX                       | 組み込みの静的解析 ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                                      |
| モデルファイル                   | GGUF / safetensors メタデータ、テンソル宣言、導出した合計                                   | ヘッダー解析。任意でファイル全体をハッシュ; [GGUF / safetensors](../model-artifacts.md)                                                        |
| IL2CPP メタデータ                | Unity global-metadata.dat のアセンブリ、型・メソッド名、インデックス範囲                    | バージョン 24、27、29、31、39 を静的デコード。Unity 不要                                                                                       |
| Godot PCK                        | アーカイブ一覧と展開、元のヘッダー・ディレクトリ情報、選択内容の識別情報                    | 形式 2、3、4 を静的解析。Godot 不要                                                                                                            |
| WASM アーティファクト            | 検証、セクション、正確なインポート/エクスポート WAT 形式、デコード済み WAT                  | 利用者が用意 WABT 1.0.42; `inspect_wasm_artifact`                                                                                              |
| APK 署名                         | v1/v2/v3/v3.1 署名者、証明書指紋、鍵ローテーション、ダイジェストの自己整合性                | 組み込みの静的解析; `inspect_apk_signature`                                                                                                    |

静的な JavaScript と .NET の検査は、指定されたファイルを読み取り、アプリケーションを実行しません。実行時キャプチャは、あなたのユーザー権限で対象を実行したり、対象とやり取りしたりします。それぞれの実行時ガイドに、どのような操作が行われるかを記載しています。

ネイティブバイナリのオフライン検査では、利用者が用意した GNU objdump と Rizin も使用できます。[リバースエンジニアリングツールのガイド](../reverse-engineering-tools.md)では、プロバイダーのセットアップ、CLI コマンド、Evidence の制約を説明しています。REA はどちらのプロバイダーもインストールや更新を行いません。

<a id="choosing-a-deep-analysis-provider"></a>

大きなバイナリでは `REA_GHIDRA_STARTUP_TIMEOUT_MS` または `REA_HOPPER_STARTUP_TIMEOUT_MS` でプロバイダーの起動期限を延長できます。

対応するネイティブ形式とホストは、プロバイダーによって異なります。[Hopper と Ghidra のセットアップ](../installation.md#hopper)、[IDA ガイド](../ida-provider.md)、[Kuna](../kuna-provider.md)、[Windows 向け Ghidra の実験的対応](../windows-ghidra-p0.md)を参照してください。Ghidra は [16 ビット DOS 分析](../ghidra-dos.md)にも対応しています。プロバイダーの選択は [CLI ガイド](../cli.md#choose-a-provider)を参照してください。最新の npm リリース以降に追加された機能については、[リリースでの利用可否](../installation.md#released-package-and-main)を確認してください。

## 事例

<a href="https://rea.tools/ja/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="DX-Ball の音声パン、Notion のクリップボードブリッジ、TH04 の弾幕リングの事例を表すイラスト" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball：音声のパン計算を再構築する

音声の呼び出しから位置をパンに変換する補助関数をたどり、命令を調べ、不完全な疑似コードを C に書き直します。再構築した実装は、元の x86 に対する 3,205 ケースの検証を通過し、コンパイル後の関数の全 63 バイトを再現しています。

[事例を読む](https://rea.tools/ja/showcase/dx-ball/) ·
[再構築リポジトリ](https://github.com/N0zoM1z0/dx-ball)

### Notion：Electron のクリップボードブリッジを追跡する

レンダラーのクリップボード API を見つけ、preload と IPC を経由してメインプロセスまでたどり、リッチなクリップボード形式を調べます。

[事例を読む](https://rea.tools/ja/showcase/notion/)

### TH04：DOS の弾幕リングの計算を復元する

元の PC-98 ゲームの 16 ビット命令を調べ、固定角度と自機を狙う角度の計算を復元し、再構築した C++ を当時のコンパイラーの出力と比較します。

[事例を読む](https://rea.tools/ja/showcase/th04/) ·
[再構築リポジトリ](https://github.com/N0zoM1z0/th04)

### REA で RL 環境を構築する

Web アプリのセッションを記録し、API をツールに変換して、AI エージェントが使える環境をエクスポートします。AgentEnv で実行し、タスクと報酬のチェックを追加して、RL の学習や評価に使えます。

[環境構築ガイド](https://rea.tools/guides/rl-environments/) ·
[X でデモを見る](https://x.com/reatools/status/2112574822584918075?s=20)

REA で興味深い対象を調べたら、ぜひ共有してください。[issue](https://github.com/morluto/rea/issues) または [pull request](https://github.com/morluto/rea/pulls) に、対象、調べたかったこと、REA がどう役立ったか、何が分かったかを記載してください。

<a id="build-rl-environments"></a>

## RL 環境を構築する

元のアプリを動かさずに、AI エージェントが issue の検索やフォルダーの作成などを練習できるローカル環境を構築します。強化学習（RL）や、エージェントのタスク遂行能力のテストに使えます。

REA は記録した API のリクエストと応答を、エージェントが呼び出せるツールに変換します。環境は記録したデータを使い、記録で効果が確認された変更だけをサポートします。

エージェントに REA を設定したら、次の URL とフォルダー操作を自分の環境に合わせて変更してください。

```text
REA を使い、次のテスト用 Web アプリから RL 環境を構築してください。
http://127.0.0.1:3000
フォルダーの一覧表示、作成、名前変更、削除を対象にしてください。
テスト用フォルダーの作成と削除は許可します。既存のデータは変更しないでください。
my-env というフォルダーに保存し、使える操作を確認して実行方法を教えてください。
```

<details>
<summary>コマンドラインを使う場合</summary>

アプリのブラウザーリクエストと応答を記録したファイルがあれば、このコマンドを使えます。作成した環境の実行には AgentEnv と Docker も必要です。

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA は実行可能な環境と、起動して応答することを確認する基本テストをエクスポートします。RL フレームワークに接続して、タスクの目標や報酬のチェックを定義し、学習を実行できます。

[環境構築ガイド](https://rea.tools/guides/rl-environments/) ·
[環境リファレンス](../agent-environments.md) ·
[X でデモを見る](https://x.com/reatools/status/2112574822584918075?s=20)

## よくある質問

<details>
<summary><strong>どのエージェントで REA を使えますか？</strong></summary>

ローカル MCP サーバーに対応するエージェントなら使えます。セットアップは[対応エージェント](../installation.md#supported-agents)を設定します。その他のクライアントでは、[MCP の手動登録](../installation.md#mcp-registry)を利用できます。

</details>

<details>
<summary><strong>Hopper、Ghidra、IDA、Kuna は必要ですか？</strong></summary>

深いネイティブ分析には、そのいずれかを使います。静的な JavaScript と .NET の検査には、ネイティブ分析エンジンは必要ありません。セットアップは承認後に Hopper をインストールできます。Ghidra、IDA、Kuna は既存のインストールを使います。[プロバイダーのセットアップ](../installation.md#hopper)を参照してください。

</details>

<details>
<summary><strong>先に Hopper を起動する必要はありますか？</strong></summary>

REA は必要な操作の際に Hopper を起動します。macOS では、初回起動時にデモモードを選ぶか、ライセンスを有効化するよう求められることがあります。[Hopper の起動とトラブルシューティング](../installation.md#launcher-paths-and-troubleshooting)を参照してください。

</details>

<details>
<summary><strong>skills.sh からスキルをインストールすると何ができますか？</strong></summary>

スキルはエージェントに調査の手順を提供します。`npx rea-agents setup` で REA の MCP サーバーを登録し、対応する手順をインストールしてから、エージェントを再起動してください。[スキルのみのインストール](../installation.md#skill-only-installation)を参照してください。

</details>

<details>
<summary><strong>REA はどのようなコードを返しますか？</strong></summary>

ネイティブ分析は疑似コードとアセンブリを返します。JavaScript/Electron 分析はモジュールとその関係を復元します。エージェントはその結果を使って実装を書き、テストします。[事例](#事例)に具体的な手順があります。

</details>

<details>
<summary><strong>REA はアプリをアップロードしますか？</strong></summary>

REA は対象をローカルで分析します。エージェントはツールの結果を受け取り、そのモデルプロバイダーには独自のデータポリシーがあります。

</details>

<details>
<summary><strong>バグに遭遇したらどうすればよいですか？</strong></summary>

まず更新してください。最近のリリースですでに修正されている可能性があります。

npm でインストールした CLI の場合：

```bash
rea update
```

`npx` でエージェントを設定している場合：

```bash
npx rea-agents@latest setup
```

エージェントを使っている場合は、[設定の更新](#rea-を更新する)を完了し、再起動してください。同じタスクをもう一度試し、問題が続く場合は [issue を作成](https://github.com/morluto/rea/issues)して、REA のバージョン、対象の種類、再現手順、エラー出力を記載してください。

</details>

## ドキュメント

まずはウェブサイトの[実践ガイド](https://rea.tools/ja/guides/)を参照してください。正確なオプション、前提条件、結果の契約については、以下を参照してください。

- [インストールとセットアップ](../installation.md)：エージェントの登録、プロバイダーの設定、更新、アンインストール。
- [準備状況の確認とトラブルシューティング](../installation.md#check-readiness-for-your-task)：特定のエージェントや分析エンジンを診断。
- [CLI と Evidence](../cli.md)：コマンド、プロバイダーの選択、スナップショット、インポート／エクスポート、終了ステータス。
- [MCP 契約](../mcp-contracts.md)と[エージェント向けプロンプト](../mcp-prompts.md)：ツールの結果、セッション、ガイド付き調査。
- [ツールカタログ](../mcp-contracts.md#generated-catalog)：ビルド時に生成されるツール、プロバイダー、CLI コマンドの一覧。
- [ロードマップ](../roadmap.md)：計画中の作業と機能の進捗。

脆弱性の報告は [SECURITY.md](../../SECURITY.md) に従ってください。

## スター履歴

🎉 **GitHub スター 400,000 件、ありがとうございます！**

REA の利用、バグ報告、機能の要望、ビルドのテスト、修正への貢献に感謝します。

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="REA の GitHub スター履歴" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## 免責事項

責任ある利用については [DISCLAIMER.md](../../DISCLAIMER.md) を参照してください。

REA は、法令に従った研究、教育、相互運用性の確保、ソフトウェアの保存、および所有するソフトウェアや調査を許可されたソフトウェアの解析を目的としています。

違法または無許可の利用に関するプロジェクトの立場は、REA のすべてのバージョン、配布チャネル、およびプラットフォームに適用されます。各コピーには、それぞれに適用されるライセンスが引き続き適用されます。

## 貢献する

REA への貢献を歓迎します！[issue を作成](https://github.com/morluto/rea/issues)してバグや機能の提案を報告したり、[pull request を送信](https://github.com/morluto/rea/pulls)してコードやドキュメントを改善したりできます。

開発環境とチェックは [CONTRIBUTING.md](../../CONTRIBUTING.md)、検証レーンは[テストガイド](../testing.md)、プロジェクト構造は[アーキテクチャ図](../architecture.mermaid)を参照してください。

## ライセンス

[MIT](../../LICENSE)

REA が作成したコードは MIT ライセンスの下で提供されます。サードパーティの素材には、それぞれのライセンスと著作権表示が引き続き適用されます。依存関係の一覧、保存されたライセンス本文、および外部ツールの利用条件については、[サードパーティ通知](../../THIRD_PARTY_NOTICES.md)を参照してください。

**IDA Pro / Hex-Rays デコンパイラ、Hopper、JEB を含む商用ツールは、適用されるライセンスに従って合法的に入手し、使用する権限を得ている必要があります。** REA はツールのライセンス、キー、またはアクティベーションの権利を一切付与しません。試用版やデモ版も、ユーザー、機能、自動化、および出力の共有に関する制限を含め、ベンダーの利用条件に従います。クラックされたコピー、盗まれたキー、無許可のキー共有、およびライセンス制限の回避は認められていません。このガイダンスは、MIT ライセンスやサードパーティのライセンスを変更するものではありません。
