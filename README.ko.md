<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<p align="center"><b>AI 기반 공격적 보안 에이전트 플랫폼.</b></p>

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

### CyberStrike란?

CyberStrike는 터미널에서 실행되는 오픈 소스 자율 공격적 보안 에이전트입니다. 13개 이상의 전문 보안 에이전트, 120개 이상의 OWASP 테스트 케이스를 내장하고 있으며, 15개 이상의 LLM 제공자를 지원합니다. 대상을 지정하면 정찰, 취약점 발견, 보고서 생성까지 모두 하나의 TUI에서 처리합니다.

### 기능

- **13개 이상의 보안 에이전트** — 웹 애플리케이션(OWASP WSTG), 모바일(MASTG/MASVS), 클라우드(AWS/Azure/GCP), Active Directory/Kerberos, 네트워크, 그리고 8개의 전문 프록시 테스터(IDOR, 인젝션, SSRF, 인증 우회 등)
- **30개 이상의 내장 도구** — Shell 실행, HTTP 요청, 파일 작업, 코드 검색, 웹 스크래핑, 취약점 보고
- **Bolt** — MCP 프로토콜과 Ed25519 페어링을 사용하는 원격 도구 서버. 원격 서버에서 보안 도구를 실행하고 터미널에서 제어
- **MCP 생태계** — 퍼스트 파티 통합: [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp), [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp), [github-security-mcp](https://github.com/badchars/github-security-mcp), [cve-mcp](https://github.com/badchars/cve-mcp), [osint-mcp](https://github.com/badchars/osint-mcp)
- **15개 이상의 LLM 제공자** — Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, DeepInfra, Mistral, OpenRouter, OpenAI 호환 엔드포인트를 통한 로컬 모델 등
- **멀티 인터페이스** — TUI(터미널), Web(SolidJS), 데스크톱(Tauri) — 어디서나 동일한 에이전트 엔진
- **LSP 지원** — IDE 기반 워크플로를 위한 언어 서버 프로토콜 통합
- **플러그인 시스템** — 플러그인 SDK로 커스텀 에이전트와 도구 구축

### 설치

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

### 빠른 시작

```bash
# CyberStrike 시작
cyberstrike

# 첫 실행 시 LLM 제공자를 선택한 다음:
# "https://target.com에 대해 전체 OWASP WSTG 평가를 실행해줘"
```

### 에이전트

TUI에서 `Tab` 키로 에이전트를 전환합니다.

| 에이전트 | 영역 | 설명 |
|----------|------|------|
| **cyberstrike** | 범용 | 기본 전체 권한 공격적 보안 에이전트 |
| **web-application** | 웹 | OWASP Top 10, WSTG 방법론, API 보안 |
| **mobile-application** | 모바일 | Android/iOS 테스트, Frida, MASTG/MASVS |
| **cloud-security** | 클라우드 | AWS, Azure, GCP, IAM, CIS 벤치마크 |
| **internal-network** | 네트워크 | Active Directory, Kerberos, 횡적 이동 |

추가로 특정 취약점 유형을 위한 8개의 전문 **프록시 테스터** 에이전트가 있습니다: IDOR, 인가, 대량 할당, 인젝션, 인증, 비즈니스 로직, SSRF, 파일 공격.

### 데스크톱 앱

macOS, Windows, Linux에서 사용 가능합니다. [릴리스 페이지](https://github.com/CyberStrikeus/CyberStrike/releases)에서 다운로드하세요.

```bash
# macOS
brew install --cask cyberstrike-desktop
# Windows
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

### 문서

- [문서](https://cyberstrike.io/docs)
- [기여 가이드](./CONTRIBUTING.md)
- [행동 강령](./CODE_OF_CONDUCT.md)

### 라이선스

[AGPL-3.0-only](./LICENSE) — 상용 라이선스는 [contact@cyberstrike.io](mailto:contact@cyberstrike.io)로 문의하세요.

---

<p align="center">
  <a href="https://discord.gg/cyberstrike">Discord</a> · <a href="https://x.com/cyberstrike">X.com</a> · <a href="https://cyberstrike.io">cyberstrike.io</a>
</p>
