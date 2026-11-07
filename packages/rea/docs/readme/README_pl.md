<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · **Polski** · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: Reverse Engineer Anything

### Jeden serwer MCP do inżynierii wstecznej plików binarnych, aplikacji i zachowania w czasie wykonywania.

**Widzisz funkcję, która Ci się podoba? Dowiedz się, jak działa, aż do poziomu kodu binarnego.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Strona internetowa](https://rea.tools/pl/) · [Przewodniki](https://rea.tools/pl/guides/) · [Przykłady zastosowań](https://rea.tools/pl/showcase/)**

[Szybki start](#szybki-start) · [Jak działa REA](#jak-działa-rea) · [Co możesz analizować](#co-możesz-analizować) · [Przykłady zastosowań](#przykłady-zastosowań) · [Tworzenie środowisk RL](#build-rl-environments) · [FAQ](#faq) · [Dokumentacja](#dokumentacja)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> Oficjalne źródła REA: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> Korzystaj z odnośników do instalacji i wydań w tych oficjalnych źródłach. Podobna nazwa repozytorium lub skopiowany README nie potwierdzają, że pobierany plik jest oficjalny.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA uruchamia most analityczny w Hopperze podczas analizy natywnego pliku binarnego" width="1200" />

<br /><br />

<table aria-label="Społeczność REA">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Dołącz do społeczności inżynierii wstecznej</strong>
  </a><br />
  <sub>Discord · Pytania i odpowiedzi · Pokaż swój projekt</sub>
</td>
</tr>
</table>

<br />

</div>

---

Widzisz w aplikacji funkcję, którą chcesz mieć we własnym produkcie? Poproś swojego agenta, aby zbadał ją za pomocą REA. Może przeanalizować aplikację bez jej kodu źródłowego, wyjaśnić działanie funkcji, pokazać dowody i stworzyć jej wersję dla Twojego projektu.

REA łączy Twojego agenta z narzędziami do analizy natywnych plików binarnych, aplikacji JavaScript i Electron, zestawów .NET oraz stron internetowych. Z tych samych narzędzi możesz korzystać w terminalu. Analiza odbywa się lokalnie, a wyniki zawierają dowody i ograniczenia stojące za każdym wnioskiem.

Konfigurator rejestruje REA w Twoim agencie i instaluje pasujące instrukcje pracy. Analiza kodu natywnego może korzystać z istniejącej instalacji Hoppera, Ghidry, IDA lub Kuna; konfigurator może też zainstalować Hoppera po uzyskaniu zgody. Statyczna analiza JavaScript nie wymaga żadnego z tych silników.

> **[Odwiedź stronę REA](https://rea.tools/pl/)**, aby znaleźć instrukcje konfiguracji, ilustrowane przewodniki i rzeczywiste studia przypadków.

## Szybki start

W Linuksie uruchamianie Ghidra, JADX i narzędzi firmware oraz statyczna analiza JavaScript/Electron wymagają `ps` zgodnego z procps w `PATH` REA do sprawdzania własności procesów. Zobacz wymaganie dla Linuksa.

### Skonfiguruj agenta

Po zainstalowaniu Node.js i npm uruchom:

```bash
npx rea-agents setup
```

Wybierz swoich agentów, sprawdź proponowane zmiany i zatwierdź je. Konfigurator dodaje serwer MCP REA i pasujące instrukcje pracy, tworząc kopie zapasowe istniejącej konfiguracji. Następnie uruchom agenta ponownie.

Konfigurator obsługuje Claude Code, Codex, Cursor, Gemini CLI, Grok Build i [innych agentów](../installation.md#supported-agents). Konfigurację dostawców analizy i ręczną rejestrację MCP opisuje przewodnik [instalacji i konfiguracji](../installation.md).

MCP domyślnie używa zwartych schematów wejściowych. Pełne opisy pól i zagnieżdżonej walidacji włącza `REA_MCP_INPUT_SCHEMA_PROFILE=full` w rejestracji MCP. Oba profile zachowują wszystkie narzędzia i tę samą kanoniczną walidację serwera; zobacz przewodnik kontraktów MCP.

### Zapytaj agenta

```text
Sprawdź, jak działa wyszukiwanie w aplikacji Notes, pokaż mi dowody i stwórz podobną funkcję dla mojego projektu.
```

Zastąp Notes wybraną aplikacją i wskaż funkcję, którą chcesz zrozumieć.

### Korzystaj z terminala

Przeanalizuj rozpakowany katalog aplikacji JavaScript/Electron lub archiwum ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Wynik obejmuje moduły, importy, granice komponentów Electron oraz dowody. Zastąp ścieżkę ścieżką do swojego celu, na przykład `"D:/apps/example"` w systemie Windows.

Aby zainstalować polecenie `rea` do regularnego użytku:

```bash
npm install --global rea-agents
rea --help
```

Przed analizą kodu natywnego skonfiguruj dostawcę analizy. Polecenia analizy natywnej, wybór dostawcy, migawki i użycie w skryptach opisuje [przewodnik CLI i Evidence](../cli.md).

### Zaktualizuj REA

REA szybko się rozwija, a nowe wydania często zawierają poprawki błędów. Dbaj o aktualność swojej instalacji.

Dla CLI zainstalowanego przez `npm install --global` / `bun add --global`:

```bash
rea update
```

`rea --update` jest aliasem `rea update` z tymi samymi globalnymi opcjami wyjścia. Aktualizator zachowuje łącznie najwyżej 4 MiB stdout/stderr. Zbyt duże metadane są odrzucane po zakończeniu; szczegółowe instalacje zachowują ograniczoną diagnostykę. Postęp uwzględnia przeciwciśnienie terminala i czeka na zakończenie przekazanych zapisów.

Aktualizacje globalne Bun wymagają Bun 1.2.17 lub nowszego. Przed `rea update` ręcznie zaktualizuj starszą wersję Bun.

Aby odświeżyć rejestracje agentów i umiejętność, uruchom polecenie konfiguracji wyświetlone po aktualizacji.

Jeśli używasz `npx`, zaktualizuj konfigurację agenta poleceniem:

```bash
npx rea-agents@latest setup
```

Sprawdź zmiany konfiguracji i uruchom agenta ponownie. Do jednorazowych poleceń CLI używaj `npx rea-agents@latest`, a następnie nazwy polecenia.

Z Bun użyj `bunx rea-agents@latest` zamiast `npx rea-agents@latest`.

## Jak działa REA

Twój agent wywołuje REA przez MCP, aby analizować cel i śledzić istotny kod. REA zwraca ustalenia wraz z dowodami. Agent wykorzystuje je do zadawania dalszych pytań, wyjaśniania zachowania lub pisania i testowania implementacji. Polecenia CLI korzystają z tych samych procedur.

![Przebieg badania z REA: agent pyta o lokalny cel, REA analizuje go i śledzi za pomocą narzędzi analitycznych, a agent korzysta ze zwróconego kodu, odwołań i niewiadomych, aby wyjaśnić działanie, stworzyć implementację i ją przetestować.](../../website/public/assets/figures/rea-investigation-flow.svg)

[Otwórz ilustrację w pełnym rozmiarze](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## Co możesz analizować

REA wymaga Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) lub 26+ (>=26.12.1) oraz npm. Dodatkowe narzędzia i obsługiwane platformy zależą od celu analizy:

| Cel                                     | Co zwraca REA                                                                                                         | Wymagania i przewodnik                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Natywne pliki binarne                   | Pseudokod, kod asemblera, ciągi znaków, symbole, wywołania i odwołania                                                | Hopper, Ghidra, IDA lub Kuna; [analiza kodu natywnego](../native-investigation.md)                                                                    |
| Układ pliku ELF w trybie offline        | Sekcje, segmenty, oryginalne symbole/relokacje i potencjalne mechanizmy zabezpieczeń wskazane przez analizę statyczną | pwntools dostarczone przez użytkownika w systemie Linux x64; [diagnostyka plików binarnych](../binary-diagnostics.md)                                 |
| PE certificates                         | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                                          | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                                               |
| PE imports                              | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                                            | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                                         |
| Kod bajtowy EVM                         | Selektory wywołań, przesunięcia bajtowe, wywnioskowane argumenty i mutowalność                                        | Lokalny plik z surowymi bajtami lub zapisem szesnastkowym w systemie Linux x64; [przewodnik EVM offline](../evm-bytecode.md)                          |
| Rust binaries                           | Embedded cargo-auditable dependency list                                                                              | [Rust binaries](../rust-binaries.md)                                                                                                                  |
| ELF notes                               | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                                                       | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                                          |
| Linux kernel modules                    | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                                           | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                                                |
| Erlang BEAM                             | IFF chunks, atoms, exports, and tables                                                                                | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                                     |
| Apple IPS crashes                       | .ips metadata, threads, images, registers and crash classes                                                           | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                                         |
| Zarejestrowane awarie systemu Linux     | Surowe rekordy note, rejestry/sygnały każdego zarejestrowanego wątku i opcjonalni kandydaci na mapowania              | pwntools dostarczone przez użytkownika w systemie Linux x64; opcjonalnie GDB/pwndbg; [zarejestrowane awarie](../recorded-crashes.md)                  |
| Instalacje desktopowe                   | Kandydaci środowisk uruchomieniowych, pliki źródłowe dowodów, komponenty i dalsze kroki                               | Ograniczona inspekcja katalogów i nagłówków；[Aplikacje desktopowe](../desktop-applications.md)                                                       |
| JavaScript / Electron                   | Moduły, importy, mapy źródeł, trasy, IPC i powiązania z natywnymi dodatkami                                           | Node.js i npm; [analiza aplikacji](../javascript-application-workflows.md); Linux: procps `ps`                                                        |
| Strony internetowe                      | Struktura strony, skrypty, obserwacje sieciowe i zamówione zrzuty ekranu                                              | Przeglądarka z rodziny Chrome; [analiza w przeglądarce](../browser-observation.md)                                                                    |
| Zapisane przechwycenia ruchu sieciowego | Żądania, odpowiedzi, dostępne dane przesyłane i lokalizacje źródłowe                                                  | HAR / Fiddler Everywhere SAZ; mitmdump w systemie Linux dla natywnych przechwyceń mitmproxy; [przewodnik przechwytywania](../web-network-captures.md) |
| Przechwytywanie pakietów                | Punkty końcowe, DNS, TLS SNI, dystrybucja protokołów i żądania HTTP                                                   | Dostarczone przez wywołującego tshark i capinfos; [przewodnik pcap](../pcap-analysis.md)                                                              |
| Zestawy .NET                            | Metadane, instrukcje CIL, zadeklarowane zależności natywne i porównania kompilacji                                    | Analiza statyczna; [przewodnik kodu zarządzanego](../managed-code-analysis.md)                                                                        |
| PyInstaller                             | CArchive, PYZ, Python bytecode                                                                                        | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                                                 |
| Pakiety APK dla Androida                | Deklaracje manifestu, klasy, zdekompilowane metody i odwołania                                                        | JADX bez interfejsu graficznego i pełny JDK w systemach Linux/macOS/Windows x64; [przewodnik Androida](../android-analysis.md)                        |
| Urządzenia z Androidem                  | Urządzenia, pakiety, procesy, logi, zrzuty, zrzuty ekranu oraz transfery APK/plików                                   | adb dostarczony przez wywołującego (emulator lub urządzenie); [przewodnik ADB](../adb-device-analysis.md)                                             |
| Projekty JEB                            | Jednostki projektu obsługiwane przez silnik, skróty artefaktów i pseudokod typów/metod                                | Uruchomiony przez wywołującego klient JEB udostępniający MCP, wybrany przez REA_JEB_MCP_URL; [przewodnik JEB](../jeb-analysis.md)                     |
| Zasoby Androida                         | Zdekodowany manifest, tablice ciągów, języki i informacje o wersji                                                    | Należący do wywołującego launcher Apktool; [przewodnik zasobów](../apktool-resource-analysis.md)                                                      |
| Aplikacje Flutter                       | Hash migawki Dart, sumy bibliotek per ABI i pochodzenie kompilacji silnika                                            | Brak (statyczna analiza APK); [przewodnik Flutter](../flutter-analysis.md)                                                                            |
| Oprogramowanie układowe                 | Regiony, wyniki wyodrębniania i przekazanie do analizy kodu natywnego                                                 | Binwalk / Unblob w systemie Linux; [przewodnik oprogramowania układowego](../firmware-analysis.md)                                                    |
| Zapisane pakiety                        | Wybrane pola, powtarzane wartości, filtry i reguły dekodowania                                                        | Linux: TShark 4.x + prlimit; [przewodnik po przechwyconych pakietach](../packet-captures.md)                                                          |
| Zapisane sygnały logiczne               | Adnotacje dekodera, zakresy próbek i diagnostyka                                                                      | Linux: sigrok-cli 0.7.2 + prlimit; [przewodnik po sygnałach](../signal-recordings.md)                                                                 |
| Pakiety i zasoby                        | Spisy plików, skróty, pliki plist, struktura pakietów Apple i wyodrębnione zasoby                                     | [Przewodnik artefaktów i JavaScript](../javascript-artifact-reconstruction.md), [aplikacje Apple](../apple-application-analysis.md)                   |
| Zachowanie procesów                     | Wyjście terminala, interakcje, obserwacje zakończenia i systemu plików oraz porównania uruchomień                     | Linux/macOS z natywnym PTY; [przechwytywanie procesów](../process-capture.md)                                                                         |
| Pliki binarne Go                        | Wbudowana wersja kompilatora, moduły, zamienniki i ustawienia kompilacji                                              | Wbudowana analiza statyczna ELF/PE/thin Mach-O; Instalacja Go nie jest wymagana                                                                       |
| Bazy SQLite                             | Tabele, kolumny, indeksy, widoki, wyzwalacze i wybrane wiersze zwykłych tabel                                         | Lokalna migawka bazy/WAL; Node.js 24.x >=24.15 lub 26+ z natywnymi limitami SQLite                                                                    |
| Obiekty kodu GPU                        | Cele CUDA/HIP, parametry i zasoby wybranych kerneli, zachowany tekst PTX                                              | Wbudowana analiza statyczna ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                                    |
| Pliki modeli                            | Metadane GGUF / safetensors, deklaracje tensorów i wyliczone sumy                                                     | Odczyt nagłówków; opcjonalny hash całego pliku; [GGUF / safetensors](../model-artifacts.md)                                                           |
| Metadane IL2CPP                         | Obrazy zestawów Unity global-metadata.dat, nazwy typów/metod i zakresy indeksów                                       | Statyczne dekodowanie wersji 24, 27, 29, 31, 39; bez Unity                                                                                            |
| Godot PCK                               | Spis i rozpakowanie archiwum, oryginalne nagłówki/katalogi i tożsamość wybranej zawartości                            | Formaty statyczne 2, 3, 4; bez Godot                                                                                                                  |
| Artefakty WASM                          | Walidacja, sekcje, dokładne formy WAT importów/eksportów i zdekodowany WAT                                            | Dostarczone przez użytkownika WABT 1.0.42; `inspect_wasm_artifact`                                                                                    |
| Podpisy APK                             | Sygnatariusze v1/v2/v3/v3.1, odciski certyfikatów, rotacja kluczy i wewnętrzna spójność skrótów                       | Wbudowana analiza statyczna; `inspect_apk_signature`                                                                                                  |

Statyczna analiza JavaScript i .NET odczytuje dostarczone pliki bez uruchamiania aplikacji. Przechwytywanie w czasie wykonywania uruchamia wybrany cel lub wchodzi z nim w interakcje z uprawnieniami Twojego użytkownika; skutki opisano w odpowiednich przewodnikach.

Do analizy offline natywnych plików binarnych REA obsługuje również GNU objdump i Rizin, które musisz dostarczyć samodzielnie. [Przewodnik po narzędziach inżynierii wstecznej](../reverse-engineering-tools.md) opisuje konfigurację dostawców, polecenia CLI i ograniczenia Evidence. REA nie instaluje ani nie aktualizuje żadnego z tych dostawców.

<a id="choosing-a-deep-analysis-provider"></a>

Dla dużych plików zwiększ czas uruchomienia przez `REA_GHIDRA_STARTUP_TIMEOUT_MS` lub `REA_HOPPER_STARTUP_TIMEOUT_MS`.

Obsługiwane formaty natywne i platformy zależą od dostawcy analizy. Zobacz [konfigurację Hoppera i Ghidry](../installation.md#hopper), [przewodnik IDA](../ida-provider.md), [Kuna](../kuna-provider.md) oraz [eksperymentalną obsługę Ghidry w systemie Windows](../windows-ghidra-p0.md). Ghidra obsługuje też [analizę 16-bitowego DOS-a](../ghidra-dos.md). Wybór dostawcy opisuje [przewodnik CLI](../cli.md#choose-a-provider). Sprawdź [dostępność w wydaniach](../installation.md#released-package-and-main) dla funkcji dodanych po najnowszym wydaniu npm.

## Przykłady zastosowań

<a href="https://rea.tools/pl/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="Ilustracje studiów przypadku panoramowania dźwięku w DX-Ball, mostka schowka w Notion i pierścienia pocisków w TH04" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: odtworzenie obliczania panoramy dźwięku

Prześledź wywołanie dźwięku do funkcji pomocniczej przeliczającej pozycję na panoramę, sprawdź instrukcje i przekształć niepełny pseudokod w C. Odtworzona implementacja przechodzi 3 205 przypadków dla oryginalnego x86 i odtwarza wszystkie 63 bajty skompilowanej funkcji.

[Przeczytaj studium przypadku](https://rea.tools/pl/showcase/dx-ball/) · [Repozytorium odtworzonej implementacji](https://github.com/N0zoM1z0/dx-ball)

### Notion: śledzenie mostu schowka w Electron

Znajdź API schowka w procesie renderującym, prześledź je przez preload i IPC do procesu głównego, a następnie sprawdź format schowka wraz z danymi formatowania.

[Przeczytaj studium przypadku](https://rea.tools/pl/showcase/notion/)

### TH04: odtworzenie obliczania pierścienia pocisków w DOS-ie

Sprawdź 16-bitowe instrukcje oryginalnej gry na PC-98, odtwórz obliczenia kątów stałych i skierowanych na cel oraz porównaj odtworzony C++ z wynikiem historycznego kompilatora.

[Przeczytaj studium przypadku](https://rea.tools/pl/showcase/th04/) · [Repozytorium odtworzonej implementacji](https://github.com/N0zoM1z0/th04)

### Twórz środowiska RL z REA

Nagraj sesję aplikacji internetowej, zamień jej API w narzędzia i wyeksportuj środowisko dla agenta AI. Uruchom je za pomocą AgentEnv, a następnie dodaj zadania i sprawdzanie nagród do treningu RL lub oceny.

[Przewodnik tworzenia środowiska](https://rea.tools/guides/rl-environments/) ·
[Obejrzyj demo w X](https://x.com/reatools/status/2112574822584918075?s=20)

Jeśli użyłeś REA do czegoś ciekawego, chętnie to zobaczymy. Opisz swój przypadek w [zgłoszeniu](https://github.com/morluto/rea/issues) lub [pull requeście](https://github.com/morluto/rea/pulls), podając cel analizy, pytanie, sposób, w jaki REA pomogło, i swoje ustalenia.

<a id="build-rl-environments"></a>

## Tworzenie środowisk RL

Stwórz lokalne środowisko, w którym agent AI może ćwiczyć zadania, takie jak wyszukiwanie zgłoszenia lub tworzenie folderu, bez uruchamiania oryginalnej aplikacji. Użyj go do uczenia ze wzmocnieniem (RL) lub sprawdzania, jak agent wykonuje zadania.

REA zamienia nagrane żądania i odpowiedzi API w narzędzia, które agent może wywoływać. Środowisko używa nagranych danych i obsługuje zmiany tylko wtedy, gdy nagranie potwierdza ich efekty.

Skonfiguruj REA w agencie, a następnie zastąp przykładowy URL i zadania dotyczące folderów własnymi:

```text
Za pomocą REA zbuduj środowisko RL z mojej testowej aplikacji internetowej:
http://127.0.0.1:3000
Uwzględnij wyświetlanie listy folderów, tworzenie, zmianę nazwy i usuwanie.
Możesz tworzyć i usuwać foldery testowe. Nie zmieniaj istniejących danych.
Zapisz w folderze my-env, sprawdź dostępne operacje i powiedz mi, jak uruchomić środowisko.
```

<details>
<summary>Użyj wiersza poleceń</summary>

Użyj tych poleceń, jeśli masz już plik z nagranymi żądaniami i odpowiedziami aplikacji w przeglądarce. Do uruchomienia wyniku potrzebujesz też AgentEnv i Dockera.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA eksportuje gotowe do uruchomienia środowisko z podstawowym testem uruchamiania i odpowiedzi. Połącz je ze swoim frameworkiem RL, aby określić cele zadań, dodać sprawdzanie nagród i uruchomić trening.

[Przewodnik tworzenia środowiska](https://rea.tools/guides/rl-environments/) ·
[Dokumentacja środowisk](../agent-environments.md) ·
[Obejrzyj demo w X](https://x.com/reatools/status/2112574822584918075?s=20)

## FAQ

<details>
<summary><strong>Którzy agenci mogą korzystać z REA?</strong></summary>

Każdy agent obsługujący lokalne serwery MCP. Konfigurator konfiguruje [obsługiwanych agentów](../installation.md#supported-agents); inne klienty mogą użyć [ręcznej rejestracji MCP](../installation.md#mcp-registry).

</details>

<details>
<summary><strong>Czy potrzebuję Hoppera, Ghidry, IDA lub Kuna?</strong></summary>

Dogłębna analiza kodu natywnego używa jednego z nich. Statyczna analiza JavaScript i .NET działa bez silnika analizy natywnej. Konfigurator może zainstalować Hoppera po uzyskaniu zgody; Ghidra, IDA i Kuna korzystają z istniejących instalacji. Zobacz [konfigurację dostawców analizy](../installation.md#hopper).

</details>

<details>
<summary><strong>Czy muszę najpierw uruchomić Hoppera?</strong></summary>

REA uruchamia Hoppera, gdy wymaga tego operacja. W systemie macOS przy pierwszym uruchomieniu okno dialogowe może poprosić o wybór trybu demonstracyjnego lub aktywację licencji. Zobacz [uruchamianie Hoppera i rozwiązywanie problemów](../installation.md#launcher-paths-and-troubleshooting).

</details>

<details>
<summary><strong>Co daje zainstalowanie umiejętności z skills.sh?</strong></summary>

Umiejętność dostarcza agentowi instrukcje prowadzenia analizy. Użyj `npx rea-agents setup`, aby zarejestrować serwer MCP REA i zainstalować pasujące instrukcje, a następnie uruchom agenta ponownie. Zobacz [instalację samej umiejętności](../installation.md#skill-only-installation).

</details>

<details>
<summary><strong>Jaki kod zwraca REA?</strong></summary>

Analiza kodu natywnego zwraca pseudokod i kod asemblera. Analiza JavaScript/Electron odzyskuje moduły i ich powiązania. Agent wykorzystuje te ustalenia do napisania i przetestowania implementacji; [przykłady zastosowań](#przykłady-zastosowań) pokazują ten proces w praktyce.

</details>

<details>
<summary><strong>Czy REA przesyła moją aplikację?</strong></summary>

REA analizuje cele lokalnie. Twój agent otrzymuje wyniki narzędzi, a dostawca jego modelu ma własną politykę dotyczącą danych.

</details>

<details>
<summary><strong>Co zrobić, gdy napotkam błąd?</strong></summary>

Najpierw zaktualizuj REA; najnowsze wydanie mogło już naprawić ten problem.

Dla CLI zainstalowanego przez npm:

```bash
rea update
```

Dla konfiguracji agenta przez `npx`:

```bash
npx rea-agents@latest setup
```

Jeśli używasz agenta, wykonaj [odświeżenie konfiguracji](#zaktualizuj-rea) i uruchom go ponownie. Ponów tę samą operację. Jeśli problem pozostaje, [otwórz zgłoszenie](https://github.com/morluto/rea/issues), podając wersję REA, typ celu analizy, kroki odtworzenia problemu i komunikaty błędu.

</details>

## Dokumentacja

Zacznij od [przewodników z przykładami](https://rea.tools/pl/guides/) na stronie internetowej. Dokładne opcje, wymagania wstępne i kontrakty wyników opisano tutaj:

- [Instalacja i konfiguracja](../installation.md): rejestracja agentów, konfiguracja dostawców analizy, aktualizacje i odinstalowanie.
- [Gotowość i rozwiązywanie problemów](../installation.md#check-readiness-for-your-task): diagnostyka jednego agenta lub silnika analizy.
- [CLI i Evidence](../cli.md): polecenia, wybór dostawcy, migawki, import/eksport i kody zakończenia.
- [Kontrakty MCP](../mcp-contracts.md) i [prompty dla agentów](../mcp-prompts.md): wyniki narzędzi, sesje i prowadzone analizy.
- [Katalog narzędzi](../mcp-contracts.md#generated-catalog): generowany podczas kompilacji wykaz narzędzi, dostawców i poleceń CLI.
- [Plan rozwoju](../roadmap.md): planowane prace i śledzenie funkcjonalności.

Zgłaszaj podatności zgodnie z [SECURITY.md](../../SECURITY.md).

## Historia gwiazdek

🎉 **400 000 gwiazdek na GitHubie — dziękujemy!**

Dziękujemy wszystkim, którzy używają REA, zgłaszają błędy, proponują nowe funkcje, testują kompilacje i przesyłają poprawki.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="Historia gwiazdek REA na GitHubie" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Zastrzeżenie

Wskazówki dotyczące odpowiedzialnego korzystania znajdziesz w [DISCLAIMER.md](../../DISCLAIMER.md).

REA służy zgodnym z prawem badaniom, edukacji, zapewnianiu interoperacyjności, zachowaniu oprogramowania oraz analizie oprogramowania, które posiadasz lub masz prawo badać.

The project's position on illegal or unauthorized use covers all REA
versions, distribution channels, and platforms; each copy retains its
applicable licenses.

## Współtworzenie

Chętnie przyjmiemy Twoją pomoc w rozwoju REA! [Otwórz zgłoszenie](https://github.com/morluto/rea/issues), aby poinformować o błędzie lub zaproponować funkcję, albo [wyślij pull request](https://github.com/morluto/rea/pulls) z ulepszeniami kodu lub dokumentacji.

Zobacz [CONTRIBUTING.md](../../CONTRIBUTING.md), aby poznać konfigurację środowiska programistycznego i kontrole, [testowanie](../testing.md), aby poznać ścieżki weryfikacji, oraz [mapę architektury](../architecture.mermaid), aby poznać strukturę projektu.

## Licencja

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
