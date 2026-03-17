<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">공격적 보안을 위해 만들어진 최초의 오픈 소스 AI 에이전트.</h3>

<p align="center">
  터미널에서 자율 침투 테스트 — 정찰, 취약점 발견, 익스플로잇, 보고서 생성.<br>
  하나의 명령어. 13+ 전문 에이전트. 120+ OWASP 테스트 케이스. 당신의 AI 레드팀.
</p>

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

### 왜 CyberStrike인가?

보안 테스트는 여전히 압도적으로 수동 작업입니다. 침투 테스터는 수십 가지 도구를 동시에 다루고, 터미널 사이에서 출력을 복사 붙여넣기 하며, 실제 공격 면에 접근하기 전에 반복적인 정찰에 수시간을 소비합니다. 버그 바운티 헌터는 매 프로그램마다 같은 정찰 워크플로를 반복합니다.

**CyberStrike가 이를 바꿉니다.** 공격적 보안 방법론을 이해하는 자율 AI 에이전트입니다 — 단순히 도구를 실행하는 것이 아니라, 무엇을 테스트할지 추론하고, 발견 사항을 연결하며, 발견한 내용에 따라 접근 방식을 조정합니다. 터미널에 지치지 않는 레드팀 멤버가 있다고 생각하세요. OWASP WSTG를 따르고, 언제 전략을 바꿔야 하는지 알고, 끝나면 보고서를 작성합니다.

```bash
npm i -g cyberstrike@latest && cyberstrike
# "https://target.com에 대해 전체 OWASP WSTG 평가를 실행해줘"
```

오픈 소스이며, 모든 LLM 제공자와 호환되고, 생성된 모든 결과물은 당신의 것입니다.

---

### 무엇이 다른가

<table>
<tr>
<td width="50%">

**범용 챗봇이 아닌, 전문 보안 에이전트**

CyberStrike는 보안 영역을 위해 특별히 제작된 13+ 에이전트를 탑재하고 있습니다. 각 에이전트는 도메인별 방법론, 도구 지식, 테스트 패턴을 갖추고 있습니다. 웹 애플리케이션 에이전트는 WSTG를 따릅니다. 클라우드 보안 에이전트는 CIS 벤치마크를 알고 있습니다. 모바일 에이전트는 Frida를 사용하고 MASTG/MASVS를 따릅니다. 추측하지 않습니다 — 검증된 프레임워크를 따릅니다.

</td>
<td width="50%">

**단순 보조가 아닌, 자율 행동**

다른 AI 도구는 다음에 무엇을 할지 당신이 말해주길 기다립니다. CyberStrike 에이전트는 다단계 공격 체인을 계획하고, 도구를 실행하며, 결과를 분석하고, 흥미로운 것을 발견하면 방향을 전환하며, 증거 기반 보고서를 생성합니다. 목표를 설정하면 — 에이전트가 방법론을 처리합니다.

</td>
</tr>
<tr>
<td width="50%">

**어떤 LLM이든, 종속 없음**

기본 제공 15+ 제공자: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — OpenAI 호환 엔드포인트를 통한 로컬 모델까지. Claude, GPT, Gemini 또는 자체 호스팅 LLM으로 실행하세요. 모델이 더 좋아지고 저렴해지면, CyberStrike도 함께 좋아집니다.

</td>
<td width="50%">

**Bolt를 통한 원격 도구 실행**

보안 도구가 노트북에서 실행될 필요가 없습니다. Bolt는 CyberStrike의 원격 도구 서버입니다 — 침투 테스트 도구가 설치된 VPS에 배포하고, Ed25519 키로 페어링하며, MCP 프로토콜을 통해 로컬 터미널에서 모든 것을 제어합니다. 하나의 TUI, 여러 공격 서버.

</td>
</tr>
</table>

---

### 에이전트

`Tab`으로 에이전트를 전환합니다. 각각이 전문가입니다.

| 에이전트 | 전문 분야 | 기능 설명 |
|----------|----------|----------|
| **cyberstrike** | 범용 | 전체 권한 기본 에이전트 — 정찰, 익스플로잇, 보고서 |
| **web-application** | 웹 | OWASP Top 10, WSTG 방법론, API 보안, 세션 테스트 |
| **mobile-application** | 모바일 | Android/iOS, Frida/Objection, MASTG/MASVS 준수 |
| **cloud-security** | 클라우드 | AWS, Azure, GCP — IAM 설정 오류, CIS 벤치마크, 노출된 리소스 |
| **internal-network** | 네트워크 | Active Directory, Kerberos 공격, 횡적 이동, 피봇팅 |

추가로 특정 취약점 클래스를 대상으로 트래픽을 가로채고 조작하는 **8개의 전문 프록시 테스터**가 있습니다:

`IDOR` · `인가 우회` · `대량 할당` · `인젝션` · `인증` · `비즈니스 로직` · `SSRF` · `파일 공격`

---

### MCP 생태계

CyberStrike는 전문 MCP 서버에 연결하여 기능을 확장합니다:

| 서버 | 도구 수 | 확장 기능 |
|------|--------|----------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | 브라우저 기반 보안 테스트 — XSS, CSRF, DOM 조작, 쿠키 탈취 |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | 클라우드 보안 감사 — AWS, Azure, GCP 전반 60+ 검사 |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | GitHub 보안 태세 — 저장소, 조직, Actions, 시크릿, 공급망 |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | CVE 인텔리전스 — NVD, EPSS, CISA KEV, GitHub Advisory, OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | OSINT 정찰 — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS |

모두 오픈 소스. 모두 `npx`로 설치 가능. CyberStrike에 연결하거나 모든 MCP 클라이언트에서 독립적으로 사용 가능합니다.

---

### 설치

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

**데스크톱 앱** (macOS, Windows, Linux) — [릴리스 페이지](https://github.com/CyberStrikeus/CyberStrike/releases)에서 다운로드하거나:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### 내장 도구

CyberStrike 에이전트는 30+ 도구에 직접 접근할 수 있습니다:

| 카테고리 | 도구 |
|----------|------|
| **실행** | Shell (bash), 파일 읽기/쓰기/편집, 디렉토리 목록 |
| **탐색** | 웹 페치, 웹 검색, 코드 검색, glob, grep |
| **보안** | 취약점 보고 (HackerOne 형식), 증거 수집 |
| **프록시** | HTTP/HTTPS 가로채기, 요청 재생, 트래픽 분석 |
| **통합** | MCP 서버, Bolt 원격 도구, 커스텀 플러그인 |

추가로 **플러그인 SDK** — 자체 에이전트와 도구를 만들고, 런타임에 등록합니다.

---

### 누구를 위한 것인가

- **침투 테스터** — 반복적인 작업을 자동화합니다. 에이전트가 정찰과 초기 테스트를 처리하는 동안, 인간의 직감이 필요한 창의적인 공격 체인에 집중하세요.
- **버그 바운티 헌터** — 더 빠른 정찰, 더 넓은 범위, 프로그램 간 일관된 방법론. CyberStrike는 새벽 3시에도 지치지 않습니다.
- **보안 팀** — 재현 가능한 방법론으로 구조화된 OWASP 평가를 실행합니다. 컴플라이언스 팀이 이해하는 표준에 매핑된 보고서를 받으세요.
- **보안 연구자** — 커스텀 에이전트와 MCP 서버로 CyberStrike를 확장하세요. 플러그인 시스템과 MCP 프로토콜이 단순한 도구가 아닌 플랫폼으로 만들어 줍니다.

---

### 기여하기

CyberStrike는 보안 커뮤니티가 만들고, 보안 커뮤니티를 위해 존재합니다. 다음 영역의 기여를 환영합니다:

- **보안 에이전트 및 스킬** — 새로운 공격 방법론, 테스트 패턴, 취약점 탐지
- **MCP 서버** — 새로운 보안 도구 및 데이터 소스 연결
- **지식 베이스** — WSTG, MASTG, PTES, CIS 방법론 가이드
- **코어 개선** — 성능, UX, 제공자 통합, 버그 수정

PR을 제출하기 전에 [기여 가이드](./CONTRIBUTING.md)를 읽어주세요. 모든 기여는 프로젝트의 [윤리적 사용 정책](./CODE_OF_CONDUCT.md)을 따라야 합니다 — CyberStrike는 승인된 보안 테스트 전용입니다.

---

### 라이선스

[AGPL-3.0-only](./LICENSE) — 개인 및 오픈 소스 사용 무료. 상용 라이선스는 [contact@cyberstrike.io](mailto:contact@cyberstrike.io)로 문의하세요.

---

<p align="center">
  <a href="https://discord.gg/cyberstrike"><b>Discord</b></a> · <a href="https://x.com/cyberstrike"><b>X.com</b></a> · <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a>
</p>
<p align="center">
  <sub>터미널 사이에서 복사 붙여넣기에 지친 해커들이 만들었습니다.</sub>
</p>
