<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · **한국어** · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: 무엇이든 리버스 엔지니어링

### 하나의 MCP로 바이너리, 애플리케이션, 런타임 동작을 리버스 엔지니어링합니다.

**마음에 드는 기능을 발견했다면, 바이너리 수준까지 작동 원리를 이해하세요.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[웹사이트](https://rea.tools/ko/) · [가이드](https://rea.tools/ko/guides/) · [사례](https://rea.tools/ko/showcase/)**

[빠른 시작](#빠른-시작) · [REA의 작동 방식](#rea의-작동-방식) · [분석할 수 있는 대상](#분석할-수-있는-대상) · [사례](#사례) · [RL 환경 만들기](#build-rl-environments) · [자주 묻는 질문](#자주-묻는-질문) · [문서](#문서)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> REA 공식 배포처: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> 이 공식 배포처에서 제공하는 설치 및 릴리스 링크를 이용하세요. 비슷한 저장소 이름이나 복사된 README만으로는 공식 배포 파일인지 확인할 수 없습니다.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA가 Hopper 안에서 분석 브리지를 실행해 네이티브 바이너리를 검사하는 모습" width="1200" />

<br /><br />

<table aria-label="REA 커뮤니티">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>리버스 엔지니어링 커뮤니티에 참여하세요</strong>
  </a><br />
  <sub>Discord · 질문과 답변 · 결과 공유</sub>
</td>
</tr>
</table>

<br />

</div>

---

앱에서 내 제품에도 넣고 싶은 기능을 발견했나요? 에이전트에게 REA로 조사해 달라고 요청하세요. 소스 코드가 없어도 앱을 검사하고, 기능의 작동 원리를 설명하고, 근거를 보여 주고, 프로젝트에 맞는 기능을 구현할 수 있습니다.

REA는 에이전트를 분석 도구에 연결해 네이티브 바이너리, JavaScript와 Electron 앱, .NET 어셈블리, 웹사이트를 검사할 수 있게 합니다. 터미널에서도 같은 도구를 사용할 수 있습니다. 분석은 로컬에서 실행되며, 결과에는 각 결론의 근거와 한계가 포함됩니다.

설정 과정은 에이전트에 REA를 등록하고 해당 버전에 맞는 워크플로 지침을 설치합니다. 네이티브 분석에는 기존 Hopper, Ghidra, IDA 또는 Kuna 설치를 사용할 수 있습니다. 승인하면 설정 과정에서 Hopper를 설치할 수도 있습니다. 정적 JavaScript 분석에는 네이티브 분석 엔진이 필요하지 않습니다.

> <strong>[REA 웹사이트](https://rea.tools/ko/)</strong>에서 설정 방법, 그림으로 설명한 가이드, 실제 사례를 확인하세요.

## 빠른 시작

Linux에서 Ghidra, JADX, 펌웨어 도구를 실행하거나 정적 JavaScript/Electron 분석을 하려면, 프로세스 소유권 확인을 위해 REA의 `PATH`에 procps 호환 `ps`가 있어야 합니다. 해결 방법은 `docs/installation.md`의 "Linux owned-process prerequisite" 항목에 있습니다.

### 에이전트 설정

Node.js와 npm이 설치된 환경에서 다음 명령을 실행하세요.

```bash
npx rea-agents setup
```

에이전트를 선택하고, 예정된 변경 사항을 검토한 뒤 승인하세요. 설정 과정은 기존 설정을 백업하고 REA의 MCP 서버와 버전에 맞는 워크플로 지침을 추가합니다. 완료 후 에이전트를 다시 시작하세요.

설정은 Claude Code, Codex, Cursor, Gemini CLI, Grok Build 및 [다른 에이전트](../installation.md#supported-agents)를 지원합니다. 제공자 설정과 수동 MCP 등록은 [설치 및 설정](../installation.md)을 참고하세요.

MCP는 기본적으로 간결한 입력 스키마를 사용합니다. 전체 필드 안내와 중첩 검증 정보가 필요하면 MCP 등록에서 `REA_MCP_INPUT_SCHEMA_PROFILE=full`을 설정하세요. 두 프로필 모두 전체 도구와 동일한 정규 서버 검증을 유지합니다. MCP 계약 가이드를 참고하세요.

### 에이전트에게 요청

```text
Notes 앱의 검색 기능이 어떻게 작동하는지 조사하고, 근거를 보여 준 다음, 내 프로젝트에 비슷한 기능을 구현해 줘.
```

Notes를 대상 앱으로 바꾸고 이해하고 싶은 기능을 지정하세요.

### 터미널 사용

압축을 푼 JavaScript/Electron 앱 디렉터리 또는 ASAR를 검사합니다.

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

결과에는 모듈, 임포트, Electron 경계와 관련 근거가 포함됩니다. 경로를 분석할 대상으로 바꾸세요. Windows에서는 `"D:/apps/example"` 같은 경로를 사용할 수 있습니다.

자주 사용할 경우 `rea` 명령을 설치하세요.

```bash
npm install --global rea-agents
rea --help
```

네이티브 분석에는 먼저 제공자를 설정해야 합니다. 네이티브 명령, 제공자 선택, 스냅샷, 스크립트 사용은 [CLI 및 Evidence 가이드](../cli.md)를 참고하세요.

### REA 업데이트

REA는 빠르게 바뀌며 새 릴리스에는 버그 수정이 자주 포함됩니다. 설치된 버전을 최신으로 유지하세요.

`npm install --global` 또는 `bun add --global`로 설치한 CLI에서는 다음 명령을 사용합니다.

```bash
rea update
```

`rea --update`는 이 검증된 업데이트 절차의 별칭이며 같은 전역 출력 플래그를 사용할 수 있습니다. 다른 명령 제어 옵션과 함께 사용할 때는 `rea update`를 사용하세요.

업데이트 명령은 stdout과 stderr를 합쳐 최대 4 MiB까지만 보관합니다. 한도를 넘긴 메타데이터 응답은 명령이 종료된 뒤 거부됩니다. 상세 출력을 사용하는 설치에서는 진단 정보를 한도 내에서만 보관하고 설치를 계속 진행합니다. 사람이 읽는 진행 출력은 터미널이 받아들이는 속도에 맞춰 전달되며, 이미 제출한 쓰기가 끝날 때까지 기다립니다.

Bun 전역 업데이트에는 Bun 1.2.17 이상이 필요합니다. 이전 버전의 Bun을 사용한다면 `rea update`를 실행하기 전에 Bun을 직접 업그레이드하세요.

에이전트 등록과 스킬을 갱신하려면 업데이트 과정에서 출력된 설정 명령을 실행하세요.

`npx`를 사용한다면 다음 명령으로 에이전트 설정을 갱신하세요.

```bash
npx rea-agents@latest setup
```

설정 변경 사항을 검토하고 에이전트를 다시 시작하세요. 일회성 CLI 작업에는 `npx rea-agents@latest` 뒤에 필요한 명령을 붙여 실행하세요. Bun을 사용한다면 위 명령의 `npx rea-agents@latest`를 `bunx rea-agents@latest`로 바꿔 실행하세요.

## REA의 작동 방식

에이전트는 MCP를 통해 REA를 호출하여 대상을 검사하고 관련 코드를 추적합니다. REA는 조사 결과와 근거를 반환합니다. 에이전트는 이를 바탕으로 추가 질문을 하고, 동작을 설명하거나, 구현을 작성하고 테스트합니다. CLI 명령도 같은 워크플로를 사용합니다.

![REA 조사 흐름: 에이전트가 로컬 대상에 대해 질문하면 REA가 분석 도구로 대상을 검사하고 추적합니다. 에이전트는 반환된 코드, 참조, 확인되지 않은 사항을 이용해 설명하고 구현하고 테스트합니다.](../../website/public/assets/figures/rea-investigation-flow.svg)

[원본 크기의 그림 열기](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## 분석할 수 있는 대상

REA에는 Node.js 22.x(>=22.23.4), 24.x(>=24.22.1) 또는 26+ (>=26.12.1)와 npm이 필요합니다. 추가 도구와 호스트 지원은 대상에 따라 다릅니다.

| 대상                   | REA가 반환하는 내용                                                           | 요구 사항 및 가이드                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 네이티브 바이너리      | 의사 코드, 어셈블리, 문자열, 심볼, 호출, 참조                                 | Hopper, Ghidra, IDA 또는 Kuna; [네이티브 분석](../native-investigation.md)                                                        |
| 오프라인 ELF 레이아웃  | 섹션, 세그먼트, 원본 심볼/재배치 정보, 정적 분석으로 얻은 보안 완화 기법 후보 | Linux x64에서 호출자가 제공하는 pwntools; [바이너리 진단](../binary-diagnostics.md)                                               |
| Go 바이너리            | 내장된 컴파일러 버전, 모듈, `replace` 지시어, 빌드 설정                       | REA 내장 ELF/PE/thin Mach-O 정적 검사; Go 설치 불필요                                                                             |
| Rust 바이너리          | cargo-auditable이 내장한 크레이트 이름, 버전, 소스, 의존성 관계               | REA 내장 ELF/PE/thin Mach-O 정적 검사; [Rust 바이너리](../rust-binaries.md)                                                       |
| PE certificates        | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields  | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                           |
| PE imports             | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash    | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                     |
| ELF notes              | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields               | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                      |
| Apple IPS crashes      | .ips metadata, threads, images, registers and crash classes                   | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                     |
| Linux kernel modules   | .modinfo keys, __versions CRCs, this_module presence, and signature trailer   | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                            |
| Erlang BEAM            | IFF chunks, atoms, exports, and tables                                        | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                 |
| WASM 아티팩트          | 유효성 검사, 섹션, import/export의 정확한 WAT 형식, 디코딩된 WAT              | 호출자 제공 WABT 1.0.42; `inspect_wasm_artifact`                                                                                  |
| EVM 바이트코드         | 디스패치 선택자, 바이트 오프셋, 추론한 인자와 상태 변경 가능 여부             | Linux x64의 로컬 원시 바이트/16진수 입력 파일; [오프라인 EVM 가이드](../evm-bytecode.md)                                          |
| SQLite 데이터베이스    | 테이블, 열, 인덱스, 뷰, 트리거, 선택한 일반 테이블의 행                       | 로컬 데이터베이스/WAL 스냅샷; Node.js 24.15 이상의 24.x 또는 26 이상(네이티브 SQLite 한도 적용)                                   |
| 기록된 Linux 크래시    | 원시 note 레코드, 기록된 모든 스레드의 레지스터/시그널, 선택적 매핑 후보      | Linux x64에서 호출자가 제공하는 pwntools; GDB/pwndbg는 선택 사항; [기록된 크래시](../recorded-crashes.md)                         |
| 데스크톱 설치 디렉터리 | 런타임 후보, 근거 파일, 구성 요소 표시와 다음 조사 단계                       | 범위가 제한된 디렉터리 및 헤더 검사；[데스크톱 애플리케이션](../desktop-applications.md)                                          |
| JavaScript / Electron  | 모듈, 임포트, 소스 맵, 라우트, IPC, 네이티브 애드온 관계                      | Node.js와 npm; Linux: procps 호환 `ps`; [애플리케이션 분석](../javascript-application-workflows.md)                               |
| 웹사이트               | 페이지 구조, 스크립트, 네트워크 관찰 결과, 요청한 스크린샷                    | Chrome 계열 브라우저; [브라우저 분석](../browser-observation.md)                                                                  |
| 저장된 네트워크 캡처   | 요청, 응답, 접근 가능한 페이로드, 소스 위치                                   | HAR 또는 Fiddler Everywhere SAZ; mitmproxy 네이티브 캡처에는 Linux의 mitmdump; [캡처 가이드](../web-network-captures.md)          |
| .NET 어셈블리          | 메타데이터, CIL 명령, 선언된 네이티브 의존성, 빌드 비교                       | 별도 도구 불필요(정적 검사만); [관리 코드 가이드](../managed-code-analysis.md)                                                    |
| Android APK            | 매니페스트 선언, 클래스, 디컴파일된 메서드, 참조                              | Linux/macOS/Windows x64의 헤드리스 JADX와 전체 JDK; [Android 가이드](../android-analysis.md)                                      |
| Android 기기           | 기기, 패키지, 프로세스, 로그, 덤프, 화면 캡처, APK/파일 전송                  | 호출자 제공 adb(에뮬레이터 또는 실제 기기); [ADB 가이드](../adb-device-analysis.md)                                               |
| JEB 프로젝트           | 엔진 기반 프로젝트 유닛, 아티팩트 해시, 타입/메서드 의사코드                  | 호출자가 시작하고 MCP를 제공하는 JEB 클라이언트(REA_JEB_MCP_URL로 선택); [JEB 가이드](../jeb-analysis.md)                         |
| Android 리소스         | 디코딩된 매니페스트, 문자열 테이블, 로캘, 버전 정보                           | 호출자 제공 Apktool 런처; [리소스 가이드](../apktool-resource-analysis.md)                                                        |
| Flutter 앱             | Dart 스냅샷 해시, ABI별 라이브러리 해시, 엔진 빌드 출처                       | 없음 (정적 APK 파싱); [Flutter 가이드](../flutter-analysis.md)                                                                    |
| 펌웨어                 | 영역, 추출 결과, 네이티브 분석으로 전달할 정보                                | Linux의 Binwalk / Unblob; [펌웨어 가이드](../firmware-analysis.md)                                                                |
| 기록된 패킷            | 선택 필드, 반복 값, 필터 및 디코딩 규칙                                       | Linux: TShark 4.x + prlimit; [캡처 가이드](../packet-captures.md)                                                                 |
| 패킷 요약              | 엔드포인트, DNS, TLS SNI, 프로토콜 분포, HTTP 요청                            | 호출자 제공 tshark 및 capinfos(Linux에서 검증됨); [pcap 가이드](../pcap-analysis.md)                                              |
| 기록된 논리 신호       | 디코더 주석, 샘플 범위, 진단 정보                                             | Linux: sigrok-cli 0.7.2 + prlimit; [신호 기록 가이드](../signal-recordings.md)                                                    |
| 패키지 및 리소스       | 파일 목록, 다이제스트, plist, Apple 번들 구조, 추출한 리소스                  | [아티팩트 및 JavaScript 가이드](../javascript-artifact-reconstruction.md), [Apple 애플리케이션](../apple-application-analysis.md) |
| 프로세스 동작          | 터미널 출력, 상호작용, 종료 및 파일 시스템 관찰 결과, 실행 비교               | 네이티브 PTY를 지원하는 Linux/macOS; [프로세스 캡처](../process-capture.md)                                                       |
| PyInstaller            | CArchive, PYZ, Python bytecode                                                | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                             |
| GPU 코드 객체          | CUDA/HIP 대상, 선택한 커널 매개변수와 자원, 보존된 PTX 텍스트                 | 내장 정적 검사 ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                             |
| 모델 파일              | GGUF / safetensors 메타데이터, 텐서 선언과 계산한 합계                        | 헤더 검사; 전체 파일 해시는 선택 사항; [GGUF / safetensors](../model-artifacts.md)                                                |
| IL2CPP 메타데이터      | Unity global-metadata.dat 어셈블리 이미지, 형식·메서드 이름과 인덱스 범위     | 버전 24, 27, 29, 31, 39 정적 디코딩; Unity 불필요                                                                                 |
| Godot PCK              | 아카이브 목록과 추출, 원본 헤더·디렉터리 정보, 선택한 내용 식별 정보          | 정적 형식 2, 3, 4; Godot 불필요                                                                                                   |
| APK 서명               | v1/v2/v3/v3.1 서명자, 인증서 지문, 키 교체와 다이제스트 자체 일관성           | 내장 정적 검사; `inspect_apk_signature`                                                                                           |

정적 JavaScript 및 .NET 검사는 제공된 파일을 읽으며 애플리케이션을 실행하지 않습니다. 런타임 캡처는 사용자의 권한으로 선택한 대상을 실행하거나 대상과 상호작용합니다. 각 런타임 가이드에서 그 영향을 설명합니다.

오프라인 네이티브 바이너리 검사에는 호출자가 제공하는 GNU objdump와 Rizin도 사용할 수 있습니다. 제공자 설정, CLI 명령, Evidence의 한계는 [리버스 엔지니어링 도구 가이드](../reverse-engineering-tools.md)를 참고하세요. REA는 objdump와 Rizin을 설치하거나 업데이트하지 않습니다.

<a id="choosing-a-deep-analysis-provider"></a>

지원하는 네이티브 형식과 호스트는 제공자마다 다릅니다. [Hopper 및 Ghidra 설정](../installation.md#hopper), [IDA 가이드](../ida-provider.md)(선택 사항인 네이티브 MCP 브리지 포함), [Kuna](../kuna-provider.md), [실험적 Windows Ghidra 지원](../windows-ghidra-p0.md)을 참고하세요. Ghidra는 [16비트 DOS 분석](../ghidra-dos.md)도 지원합니다. 큰 바이너리를 분석할 때는 `REA_GHIDRA_STARTUP_TIMEOUT_MS` 또는 `REA_HOPPER_STARTUP_TIMEOUT_MS`로 제공자의 시작 제한 시간을 늘리세요. 제공자 선택은 [CLI 가이드](../cli.md#choose-a-provider)를 참고하세요. 최신 npm 릴리스 이후 추가된 기능은 [릴리스에서의 사용 가능 여부](../installation.md#released-package-and-main)를 확인하세요.

## 사례

<a href="https://rea.tools/ko/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="DX-Ball 사운드 패닝, Notion 클립보드 브리지, TH04 탄환 고리 사례를 보여 주는 그림" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: 사운드 패닝 계산 재구현

사운드 호출에서 위치를 패닝 값으로 변환하는 보조 함수까지 추적하고, 명령을 검사하여 불완전한 의사 코드를 C로 옮깁니다. 재구현한 코드는 원본 x86에 대한 3,205개 테스트 케이스를 통과했으며, 컴파일된 함수의 63바이트 전체를 재현합니다.

[사례 읽기](https://rea.tools/ko/showcase/dx-ball/) ·
[재구현 저장소](https://github.com/N0zoM1z0/dx-ball)

### Notion: Electron 클립보드 브리지 추적

렌더러의 클립보드 API를 찾고, preload와 IPC를 거쳐 메인 프로세스까지 추적한 뒤, 서식 있는 클립보드 형식을 검사합니다.

[사례 읽기](https://rea.tools/ko/showcase/notion/)

### TH04: DOS 원형 탄막 계산 복원

원본 PC-98 게임의 16비트 명령을 검사하고 고정 각도와 조준 각도의 계산을 복원합니다. 재구현한 C++를 당시 컴파일러의 출력과 비교합니다.

[사례 읽기](https://rea.tools/ko/showcase/th04/) ·
[재구현 저장소](https://github.com/N0zoM1z0/th04)

### REA로 RL 환경 만들기

웹 앱 세션을 기록하고 API를 도구로 바꿔 AI 에이전트가 사용할 수 있는 환경을 내보냅니다. AgentEnv로 실행한 뒤 작업과 보상 검사를 추가해 RL 학습이나 평가에 사용하세요.

[환경 만들기 가이드](https://rea.tools/guides/rl-environments/) ·
[X에서 데모 보기](https://x.com/reatools/status/2112574822584918075?s=20)

REA로 흥미로운 대상을 분석했다면 알려 주세요. [issue](https://github.com/morluto/rea/issues) 또는 [pull request](https://github.com/morluto/rea/pulls)에 대상, 조사하려던 질문, REA가 어떻게 도움이 되었는지, 무엇을 알아냈는지를 담아 공유하세요.

<a id="build-rl-environments"></a>

## RL 환경 만들기

원래 앱을 실행하지 않고도 AI 에이전트가 이슈 찾기나 폴더 만들기 같은 작업을 연습할 수 있는 로컬 환경을 만듭니다. 강화 학습(RL)이나 에이전트의 작업 수행 능력 평가에 사용할 수 있습니다.

REA는 기록한 API 요청과 응답을 에이전트가 호출할 수 있는 도구로 바꿉니다. 환경은 기록된 데이터를 사용하며, 기록에서 효과가 확인된 변경만 지원합니다.

에이전트에 REA를 설정한 뒤 아래 예시 URL과 폴더 작업을 자신의 환경에 맞게 바꾸세요.

```text
REA를 사용해 다음 테스트 웹 앱에서 RL 환경을 만들어 주세요.
http://127.0.0.1:3000
폴더 목록 조회, 생성, 이름 변경, 삭제를 포함해 주세요.
테스트 폴더를 만들고 삭제해도 됩니다. 기존 데이터는 변경하지 마세요.
my-env라는 폴더에 저장하고, 사용 가능한 작업을 확인한 뒤 실행 방법을 알려 주세요.
```

<details>
<summary>명령줄을 사용하는 경우</summary>

앱의 브라우저 요청과 응답을 기록한 파일이 이미 있으면 이 명령을 사용할 수 있습니다. 생성된 환경을 실행하려면 AgentEnv와 Docker도 필요합니다.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA는 실행 가능한 환경과 시작 및 응답 여부를 확인하는 기본 테스트를 내보냅니다. RL 프레임워크에 연결해 작업 목표와 보상 검사를 정의하고 학습을 실행할 수 있습니다.

[환경 만들기 가이드](https://rea.tools/guides/rl-environments/) ·
[환경 참조 문서](../agent-environments.md) ·
[X에서 데모 보기](https://x.com/reatools/status/2112574822584918075?s=20)

## 자주 묻는 질문

<details>
<summary><strong>어떤 에이전트에서 REA를 사용할 수 있나요?</strong></summary>

로컬 MCP 서버를 지원하는 에이전트라면 사용할 수 있습니다. 설정 과정은 [지원하는 에이전트](../installation.md#supported-agents)를 구성합니다. 다른 클라이언트는 [수동 MCP 등록](../installation.md#mcp-registry)을 이용할 수 있습니다.

</details>

<details>
<summary><strong>Hopper, Ghidra, IDA 또는 Kuna가 필요한가요?</strong></summary>

심층 네이티브 분석에는 이 중 하나를 사용합니다. 정적 JavaScript 및 .NET 검사에는 네이티브 분석 엔진이 필요하지 않습니다. 설정 과정에서 승인 후 Hopper를 설치할 수 있으며, Ghidra, IDA, Kuna는 기존 설치를 사용합니다. [제공자 설정](../installation.md#hopper)을 참고하세요.

</details>

<details>
<summary><strong>Hopper를 먼저 실행해야 하나요?</strong></summary>

REA는 작업에 필요할 때 Hopper를 실행합니다. macOS에서는 처음 실행할 때 데모 모드를 선택하거나 라이선스를 활성화하라는 대화 상자가 나타날 수 있습니다. 첫 CLI/MCP 작업이나 무인 작업을 실행하기 전에 같은 사용자 세션에서 이 대화 상자를 완료하세요. 필요하면 Hopper를 직접 여세요. [Hopper 실행 및 문제 해결](../installation.md#launcher-paths-and-troubleshooting)을 참고하세요.

</details>

<details>
<summary><strong>skills.sh에서 설치하는 스킬은 어떤 역할을 하나요?</strong></summary>

스킬은 에이전트에게 조사 지침을 제공합니다. `npx rea-agents setup`으로 REA의 MCP 서버를 등록하고 버전에 맞는 지침을 설치한 뒤 에이전트를 다시 시작하세요. [스킬만 설치하기](../installation.md#skill-only-installation)를 참고하세요.

</details>

<details>
<summary><strong>REA는 어떤 코드를 반환하나요?</strong></summary>

네이티브 분석은 의사 코드와 어셈블리를 반환합니다. JavaScript/Electron 분석은 모듈과 그 관계를 복원합니다. 에이전트는 이 결과를 사용해 구현을 작성하고 테스트합니다. [사례](#사례)에서 구체적인 예를 볼 수 있습니다.

</details>

<details>
<summary><strong>REA가 내 앱을 업로드하나요?</strong></summary>

REA는 대상을 로컬에서 분석합니다. 에이전트는 도구 결과를 받으며, 에이전트의 모델 제공자에는 별도의 데이터 정책이 있습니다.

</details>

<details>
<summary><strong>버그가 발생하면 어떻게 해야 하나요?</strong></summary>

먼저 업데이트하세요. 최근 릴리스에서 이미 수정되었을 수 있습니다.

`npm install --global` 또는 `bun add --global`로 설치한 CLI에서는 다음 명령을 사용합니다.

```bash
rea update
```

`npx`로 에이전트를 설정했다면 다음 명령을 사용합니다.

```bash
npx rea-agents@latest setup
```

에이전트를 사용 중이라면 [설정 갱신](#rea-업데이트)을 완료하고 다시 시작하세요. 같은 작업을 다시 시도하세요. 문제가 계속되면 REA 버전, 대상 유형, 재현 단계, 오류 출력을 포함해 [issue를 등록](https://github.com/morluto/rea/issues)하세요.

</details>

## 문서

웹사이트의 [실습 가이드](https://rea.tools/ko/guides/)부터 읽어 보세요. 정확한 옵션, 사전 요구 사항, 결과 계약은 다음 문서를 참고하세요.

- [설치 및 설정](../installation.md): 에이전트 등록, 제공자 설정, 업데이트, 제거.
- [준비 상태 확인 및 문제 해결](../installation.md#check-readiness-for-your-task): 특정 에이전트 또는 분석 엔진 진단.
- [CLI 및 Evidence](../cli.md): 명령, 제공자 선택, 스냅샷, 가져오기/내보내기, 종료 상태.
- [MCP 계약](../mcp-contracts.md) 및 [에이전트 프롬프트](../mcp-prompts.md): 도구 결과, 세션, 안내에 따른 조사.
- [도구 카탈로그](../mcp-contracts.md#generated-catalog): 빌드 시 생성되는 도구, 제공자, CLI 명령 목록.
- [로드맵](../roadmap.md): 계획된 작업과 기능 진행 상황.

취약점은 [SECURITY.md](../../SECURITY.md)에 따라 보고하세요.

## 스타 기록

🎉 **GitHub 스타 400,000개, 감사합니다!**

REA를 사용하고, 버그를 보고하고, 기능을 요청하고, 빌드를 테스트하고, 수정에 기여해 주신 모든 분께 감사드립니다.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="REA GitHub 스타 기록" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## 면책 조항

책임 있는 사용에 관한 안내는 [DISCLAIMER.md](../../DISCLAIMER.md)를 참고하세요.

불법적이거나 허가되지 않은 사용에 대한 프로젝트의 입장은 모든 REA 버전, 배포 채널, 플랫폼에 적용되며, 각 사본에는 해당 라이선스가 그대로 유지됩니다.

REA는 법을 준수하는 연구, 교육, 상호운용성 확보, 소프트웨어 보존, 그리고 본인이 소유하거나 조사 권한을 가진 소프트웨어의 분석을 위한 도구입니다.

## 기여

REA에 도움을 보태 주세요! [issue를 등록](https://github.com/morluto/rea/issues)해 버그나 기능을 제안하거나, [pull request를 보내](https://github.com/morluto/rea/pulls) 코드와 문서를 개선할 수 있습니다.

개발 환경과 검사 항목은 [CONTRIBUTING.md](../../CONTRIBUTING.md), 검증 절차는 [테스트 가이드](../testing.md), 프로젝트 구조는 [아키텍처 지도](../architecture.mermaid)를 참고하세요.

한국어 번역도 개선할 수 있습니다. 이 README를 수정할 때는 [영문 README](../../README.md)의 명령어, 요구 사항, 분석 범위와 일치하는지 확인하세요. 웹사이트 번역은 `website/locales/ko/messages.po`의 `msgstr` 값을 수정하세요.

웹사이트 번역의 수정 방법, 검사 명령, 로컬 미리보기는 `website/locales/README.md`를 따르세요. 위 기여 문서의 **Translation corrections** 절에서 이 가이드로 이동할 수 있습니다. 명령어, 경로, 자리표시자, 기록된 근거는 그대로 보존하세요. `website/_site/`의 한국어 HTML은 자동 생성되므로 직접 수정하지 마세요.

## 라이선스

[MIT](../../LICENSE)

REA가 작성한 코드는 MIT 라이선스를 따릅니다. 제3자 자료에는 각자의 라이선스와 저작권 고지가 그대로 유지됩니다. 의존성 목록, 보존된 라이선스 원문, 외부 도구 약관은 [제3자 고지](../../THIRD_PARTY_NOTICES.md)를 참고하세요.

IDA Pro / Hex-Rays 디컴파일러, Hopper, JEB 등 상용 도구는 해당 라이선스에 따라 **합법적으로 취득하고 사용 권한을 갖춰야 합니다.** REA는 어떤 도구의 라이선스, 키, 활성화 권한도 부여하지 않습니다. 체험판과 데모는 사용자, 기능, 자동화, 출력 공유 제한을 포함한 공급업체 약관을 따릅니다. 크랙 버전, 도난 키, 무단 키 공유, 라이선스 제한 우회는 허용되지 않습니다. 이 안내는 MIT 라이선스나 제3자 라이선스를 변경하지 않습니다.
