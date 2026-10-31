<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · **Deutsch** · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: Alles reverse-engineeren

### Ein MCP für das Reverse Engineering von Binärdateien, Anwendungen und Laufzeitverhalten.

**Eine Funktion gefällt dir? Verstehe, wie sie funktioniert – bis hinunter auf die Binärebene.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Website](https://rea.tools/de/) · [Anleitungen](https://rea.tools/de/guides/) · [Fallstudien](https://rea.tools/de/showcase/)**

[Schnellstart](#schnellstart) · [So funktioniert REA](#so-funktioniert-rea) · [Was du analysieren kannst](#was-du-analysieren-kannst) · [Fallstudien](#fallstudien) · [RL-Umgebungen erstellen](#build-rl-environments) · [Häufige Fragen](#häufige-fragen) · [Dokumentation](#dokumentation)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> Offizielle Quellen für REA: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> Folge den Installations- und Release-Links aus diesen offiziellen Quellen. Ein ähnlicher Repository-Name oder eine kopierte README belegt nicht, dass ein Download offiziell ist.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA startet seine Analysebrücke in Hopper und untersucht eine native Binärdatei" width="1200" />

<br /><br />

<table aria-label="REA-Community">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Der Reverse-Engineering-Community beitreten</strong>
  </a><br />
  <sub>Discord · Fragen und Antworten · Ergebnisse teilen</sub>
</td>
</tr>
</table>

<br />

</div>

---

Du hast in einer App eine Funktion entdeckt, die du in dein eigenes Produkt übernehmen möchtest? Lass deinen Agenten sie mit REA untersuchen. Er kann die App ohne ihren Quellcode analysieren, die Funktionsweise erklären, Belege zeigen und eine passende Umsetzung für dein Projekt entwickeln.

REA verbindet deinen Agenten mit Werkzeugen zum Untersuchen nativer Binärdateien, von JavaScript- und Electron-Apps, .NET-Assemblies und Websites. Dieselben Werkzeuge kannst du auch im Terminal nutzen. Die Analyse läuft lokal; die Ergebnisse enthalten die Belege und Einschränkungen hinter jeder Schlussfolgerung.

Die Einrichtung registriert REA bei deinem Agenten und installiert passende Workflow-Anweisungen. Native Analysen nutzen eine vorhandene Installation von Hopper, Ghidra, IDA oder Kuna; nach Zustimmung kann die Einrichtung Hopper installieren. Statische JavaScript-Analysen benötigen keine native Analyse-Engine.

> **[Besuche die REA-Website](https://rea.tools/de/)** für Einrichtungshinweise, bebilderte Anleitungen und echte Fallstudien.

## Schnellstart

Unter Linux benötigen Starts von Ghidra, JADX und Firmware-Werkzeugen sowie statische JavaScript/Electron-Analysen ein procps-kompatibles `ps` in REAs `PATH`, um die Prozesseigentümerschaft zu prüfen. Abhilfe beschreibt die Linux-Voraussetzung.

### Deinen Agenten einrichten

Wenn Node.js und npm installiert sind, führe diesen Befehl aus:

```bash
npx rea-agents setup
```

Wähle deine Agenten aus, prüfe die geplanten Änderungen und bestätige sie. Die Einrichtung fügt den MCP-Server von REA und passende Workflow-Anweisungen hinzu und sichert vorhandene Konfigurationen. Starte deinen Agenten anschließend neu.

Die Einrichtung unterstützt Claude Code, Codex, Cursor, Gemini CLI, Grok Build und [weitere Agenten](../installation.md#supported-agents). Informationen zur Provider-Konfiguration und manuellen MCP-Registrierung findest du unter [Installation und Einrichtung](../installation.md).

MCP verwendet standardmäßig kompakte Eingabeschemas. Für vollständige Feldhinweise und Details zur verschachtelten Validierung setze `REA_MCP_INPUT_SCHEMA_PROFILE=full` in der MCP-Registrierung. Beide Profile behalten alle Tools und dieselbe kanonische Servervalidierung; siehe MCP-Vertragsleitfaden.

### Deinen Agenten fragen

```text
Untersuche, wie die Suche in der Notes-App funktioniert, zeige mir die Belege und entwickle eine ähnliche Funktion für mein Projekt.
```

Ersetze Notes durch deine Ziel-App und benenne die Funktion, die du verstehen möchtest.

### Das Terminal verwenden

Untersuche ein entpacktes JavaScript-/Electron-App-Verzeichnis oder eine ASAR-Datei:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Das Ergebnis enthält Module, Imports, Electron-Grenzen und die zugehörigen Belege. Ersetze den Pfad durch dein Ziel, beispielsweise `"D:/apps/example"` unter Windows.

Für die regelmäßige Nutzung kannst du den Befehl `rea` installieren:

```bash
npm install --global rea-agents
rea --help
```

Konfiguriere für native Analysen zuerst einen Provider. Native Befehle, Provider-Auswahl, Snapshots und Skriptnutzung beschreibt der [CLI- und Evidence-Leitfaden](../cli.md).

### REA aktualisieren

REA entwickelt sich schnell weiter; neue Versionen enthalten häufig Fehlerbehebungen. Halte deine Installation aktuell.

Für eine über `npm install --global` / `bun add --global` installierte CLI:

```bash
rea update
```

`rea --update` ist ein Alias für `rea update` mit denselben globalen Ausgabeoptionen. Update-Befehle behalten insgesamt höchstens 4 MiB stdout/stderr. Zu große Metadatenantworten werden nach Befehlsende abgelehnt; ausführliche Installationen behalten begrenzte Diagnosen. Fortschrittsausgabe berücksichtigt Terminal-Rückstau und wartet auf bereits übergebene Schreibvorgänge.

Globale Bun-Updates erfordern Bun 1.2.17 oder neuer. Aktualisiere ältere Bun-Versionen manuell, bevor du `rea update` ausführst.

Um die Agentenregistrierungen und den Skill zu aktualisieren, führe den Einrichtungsbefehl aus, den das Update ausgibt.

Wenn du `npx` verwendest, aktualisiere die Agenteneinrichtung mit:

```bash
npx rea-agents@latest setup
```

Prüfe die Änderungen und starte deinen Agenten neu. Für einzelne CLI-Aufrufe verwende `npx rea-agents@latest`, gefolgt vom gewünschten Befehl.

Mit Bun verwendest du `bunx rea-agents@latest` statt `npx rea-agents@latest`.

## So funktioniert REA

Dein Agent ruft REA über MCP auf, um das Ziel zu untersuchen und relevanten Code zu verfolgen. REA liefert Ergebnisse mit ihren Belegen zurück. Der Agent nutzt sie für weitere Fragen, Erklärungen oder zum Schreiben und Testen einer Implementierung. CLI-Befehle verwenden dieselben Workflows.

![REA-Untersuchungsablauf: Dein Agent fragt nach einem lokalen Ziel, REA untersucht und verfolgt es mit Analysewerkzeugen, und der Agent nutzt den zurückgegebenen Code, Verweise und offene Fragen zum Erklären, Implementieren und Testen.](../../website/public/assets/figures/rea-investigation-flow.svg)

[Abbildung in voller Größe öffnen](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## Was du analysieren kannst

REA benötigt Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) oder 26+ (>=26.12.1) sowie npm. Zusätzliche Werkzeuge und unterstützte Hostsysteme hängen vom Ziel ab:

| Ziel                                | Was REA zurückgibt                                                                                              | Voraussetzungen und Anleitung                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Binärdateien                 | Pseudocode, Assemblercode, Zeichenketten, Symbole, Aufrufe und Verweise                                         | Hopper, Ghidra, IDA oder Kuna; [native Analyse](../native-investigation.md)                                                                                          |
| Offline-ELF-Struktur                | Sektionen, Segmente, ursprüngliche Symbole/Relokationen und mögliche Schutzmaßnahmen aus statischer Analyse     | Vom Aufrufer bereitgestelltes pwntools unter Linux x64; [Binärdiagnostik](../binary-diagnostics.md)                                                                  |
| PE certificates                     | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                                    | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                                                              |
| PE imports                          | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                                      | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                                                        |
| EVM-Bytecode                        | Dispatch-Selektoren, Byte-Offsets, abgeleitete Argumente und Veränderbarkeit des Zustands                       | Lokale Eingabe mit Rohbytes oder Hexdarstellung unter Linux x64; [Offline-EVM-Leitfaden](../evm-bytecode.md)                                                         |
| Rust binaries                       | Embedded cargo-auditable dependency list                                                                        | [Rust binaries](../rust-binaries.md)                                                                                                                                 |
| ELF notes                           | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                                                 | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                                                         |
| Linux kernel modules                | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                                     | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                                                               |
| Erlang BEAM                         | IFF chunks, atoms, exports, and tables                                                                          | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                                                    |
| Apple IPS crashes                   | .ips metadata, threads, images, registers and crash classes                                                     | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                                                        |
| Aufgezeichnete Linux-Abstürze       | Unverarbeitete Note-Einträge, Register/Signale aller aufgezeichneten Threads und optionale Zuordnungskandidaten | Vom Aufrufer bereitgestelltes pwntools unter Linux x64; optional GDB/pwndbg; [aufgezeichnete Abstürze](../recorded-crashes.md)                                       |
| Desktop-Installationen              | Laufzeitkandidaten, Quelldateien, Komponenten und nächste Schritte                                              | Begrenzte Verzeichnis- und Headerprüfung；[Desktop-Anwendungen](../desktop-applications.md)                                                                          |
| JavaScript / Electron               | Module, Imports, Source Maps, Routen, IPC und Beziehungen zu nativen Add-ons                                    | Node.js und npm; [Anwendungsanalyse](../javascript-application-workflows.md); Linux: procps `ps`                                                                     |
| Websites                            | Seitenstruktur, Skripte, Netzwerkbeobachtungen und angeforderte Screenshots                                     | Ein Browser aus der Chrome-Familie; [Browseranalyse](../browser-observation.md)                                                                                      |
| Gespeicherte Netzwerkaufzeichnungen | Anfragen, Antworten, zugängliche Nutzdaten und Quellpositionen                                                  | HAR / Fiddler Everywhere SAZ; mitmdump unter Linux für Aufzeichnungen im nativen mitmproxy-Format; [Leitfaden zu Netzwerkaufzeichnungen](../web-network-captures.md) |
| Paketerfassungen                    | Endpunkte, DNS, TLS SNI, Protokollverteilung und HTTP-Anfragen                                                  | Vom Aufrufer bereitgestellte tshark- und capinfos-Binaries; [pcap-Leitfaden](../pcap-analysis.md)                                                                    |
| .NET-Assemblies                     | Metadaten, CIL-Anweisungen, deklarierte native Abhängigkeiten und Build-Vergleiche                              | Statische Untersuchung; [Leitfaden für verwalteten Code](../managed-code-analysis.md)                                                                                |
| PyInstaller                         | CArchive, PYZ, Python bytecode                                                                                  | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                                                                |
| Android-APKs                        | Manifest-Deklarationen, Klassen, dekompilierte Methoden und Verweise                                            | JADX ohne grafische Oberfläche und ein vollständiges JDK unter Linux/macOS/Windows x64; [Android-Leitfaden](../android-analysis.md)                                  |
| Android-Geräte                      | Geräte, Pakete, Prozesse, Logs, Dumps, Bildschirmaufnahmen sowie APK- und Dateiübertragungen                    | Vom Aufrufer bereitgestelltes adb (Emulator oder Gerät); [ADB-Leitfaden](../adb-device-analysis.md)                                                                  |
| JEB-Projekte                        | Engine-gestützte Projekteinheiten, Artefakt-Prüfsummen und Pseudokode von Typen/Methoden                        | Ein vom Aufrufer gestarteter JEB-Client mit MCP, ausgewählt über REA_JEB_MCP_URL; [JEB-Leitfaden](../jeb-analysis.md)                                                |
| Android-Ressourcen                  | Dekodiertes Manifest, String-Tabellen, Sprachen und Versionsfakten                                              | Vom Aufrufer bereitgestellter Apktool-Starter; [Ressourcen-Leitfaden](../apktool-resource-analysis.md)                                                               |
| Flutter-Apps                        | Dart-Snapshot-Hash, Per-ABI-Bibliotheksprüfsummen und Engine-Build-Provenienz                                   | Keine (statische APK-Analyse); [Flutter-Leitfaden](../flutter-analysis.md)                                                                                           |
| Firmware                            | Bereiche, Extraktionsergebnisse und Übergaben an die native Analyse                                             | Binwalk / Unblob unter Linux; [Firmware-Leitfaden](../firmware-analysis.md)                                                                                          |
| Aufgezeichnete Pakete               | Ausgewählte Felder, wiederholte Werte, Filter und Decode-as-Regeln                                              | Linux: TShark 4.x + prlimit; [Mitschnitt-Anleitung](../packet-captures.md)                                                                                           |
| Aufgezeichnete Logiksignale         | Decoder-Anmerkungen, Sample-Bereiche und Diagnosen                                                              | Linux: sigrok-cli 0.7.2 + prlimit; [Signalaufzeichnungen](../signal-recordings.md)                                                                                   |
| Pakete und Ressourcen               | Dateiinventare, Hashwerte, plists, Aufbau von Apple-Bundles und extrahierte Ressourcen                          | [Artefakt- und JavaScript-Leitfaden](../javascript-artifact-reconstruction.md), [Apple-Anwendungen](../apple-application-analysis.md)                                |
| Prozessverhalten                    | Terminalausgabe, Interaktionen, Beobachtungen zu Prozessende und Dateisystem sowie Laufvergleiche               | Linux/macOS mit nativer PTY; [Prozessaufzeichnung](../process-capture.md)                                                                                            |
| Go-Binärdateien                     | Eingebettete Compilerversion, Module, Ersetzungen und Build-Einstellungen                                       | Integrierte statische Prüfung ELF/PE/thin Mach-O; Keine Go-Installation nötig                                                                                        |
| SQLite-Datenbanken                  | Tabellen, Spalten, Indizes, Views, Trigger und ausgewählte Zeilen gewöhnlicher Tabellen                         | Lokaler Datenbank/WAL-Snapshot; Node.js 24.x >=24.15 oder 26+ mit nativen SQLite-Grenzen                                                                             |
| GPU-Codeobjekte                     | CUDA/HIP-Ziele, ausgewählte Kernelparameter und Ressourcen, gespeicherter PTX-Text                              | Integrierte statische Prüfung ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                                                 |
| Modelldateien                       | GGUF-/safetensors-Metadaten, Tensordeklarationen und abgeleitete Summen                                         | Headerprüfung; optionaler Hash der gesamten Datei; [GGUF / safetensors](../model-artifacts.md)                                                                       |
| IL2CPP-Metadaten                    | Unity global-metadata.dat: Assembly-Images, Typ-/Methodennamen und Indexbereiche                                | Statische Dekodierung der Versionen 24, 27, 29, 31, 39; kein Unity nötig                                                                                             |
| Godot PCK                           | Archivinventar und Extraktion, originale Header-/Verzeichnisdaten und ausgewählte Inhaltsidentitäten            | Statische Formate 2, 3, 4; kein Godot nötig                                                                                                                          |
| WASM-Artefakte                      | Validierung, Sektionen, exakte Import-/Export-WAT-Formen und dekodiertes WAT                                    | Vom Aufrufer bereitgestellt WABT 1.0.42; `inspect_wasm_artifact`                                                                                                     |
| APK-Signaturen                      | v1/v2/v3/v3.1-Signer, Zertifikatfingerabdrücke, Schlüsselrotation und Digest-Selbstkonsistenz                   | Integrierte statische Prüfung; `inspect_apk_signature`                                                                                                               |

Statische JavaScript- und .NET-Untersuchungen lesen die bereitgestellten Dateien, ohne die Anwendung auszuführen. Laufzeitaufzeichnungen führen das gewählte Ziel mit deinen Benutzerrechten aus oder interagieren damit; die jeweiligen Anleitungen beschreiben die Auswirkungen.

Für die Offline-Untersuchung nativer Binärdateien unterstützt REA auch GNU objdump und Rizin, die du selbst bereitstellst. Der [Leitfaden zu Reverse-Engineering-Tools](../reverse-engineering-tools.md) beschreibt die Einrichtung der Provider, CLI-Befehle und Einschränkungen der Evidence. REA installiert oder aktualisiert keinen der beiden Provider.

<a id="choosing-a-deep-analysis-provider"></a>

Bei großen Binärdateien kannst du die Startfrist mit `REA_GHIDRA_STARTUP_TIMEOUT_MS` oder `REA_HOPPER_STARTUP_TIMEOUT_MS` erhöhen.

Native Formate und unterstützte Hostsysteme unterscheiden sich je nach Provider. Siehe [Hopper- und Ghidra-Einrichtung](../installation.md#hopper), den [IDA-Leitfaden](../ida-provider.md), [Kuna](../kuna-provider.md) und die [experimentelle Ghidra-Unterstützung unter Windows](../windows-ghidra-p0.md). Ghidra unterstützt auch [16-Bit-DOS-Analyse](../ghidra-dos.md). Die Provider-Auswahl beschreibt der [CLI-Leitfaden](../cli.md#choose-a-provider). Prüfe die [Verfügbarkeit in Releases](../installation.md#released-package-and-main) für Funktionen, die seit der neuesten npm-Version hinzugekommen sind.

## Fallstudien

<a href="https://rea.tools/de/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="Illustrationen der Fallstudien zu DX-Balls Klangbalance, Notions Zwischenablage-Brücke und TH04s Geschossring" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: Eine Stereo-Panning-Berechnung rekonstruieren

Verfolge einen Sound-Aufruf zur Hilfsfunktion, die Positionen in Panning-Werte umrechnet, untersuche die Anweisungen und überführe unvollständigen Pseudocode in C. Die Rekonstruktion besteht 3.205 Tests mit dem ursprünglichen x86-Code und reproduziert alle 63 Bytes der kompilierten Funktion.

[Fallstudie lesen](https://rea.tools/de/showcase/dx-ball/) · [Rekonstruktionsrepository](https://github.com/N0zoM1z0/dx-ball)

### Notion: Die Electron-Zwischenablagebrücke verfolgen

Finde die Zwischenablage-API des Renderers, verfolge sie über preload und IPC bis zum Hauptprozess und untersuche das Zwischenablageformat samt Formatierungsdaten.

[Fallstudie lesen](https://rea.tools/de/showcase/notion/)

### TH04: Eine DOS-Geschossring-Berechnung wiederherstellen

Untersuche die 16-Bit-Anweisungen des ursprünglichen PC-98-Spiels, rekonstruiere die festen und zielgerichteten Winkelberechnungen und vergleiche das rekonstruierte C++ mit der Ausgabe des damaligen Compilers.

[Fallstudie lesen](https://rea.tools/de/showcase/th04/) · [Rekonstruktionsrepository](https://github.com/N0zoM1z0/th04)

### RL-Umgebungen mit REA erstellen

Zeichne eine Webanwendungssitzung auf, verwandle ihre API in Werkzeuge und exportiere eine Umgebung für einen KI-Agenten. Starte sie mit AgentEnv und ergänze Aufgaben und Belohnungsprüfungen für RL-Training oder Bewertung.

[Anleitung zum Erstellen einer Umgebung](https://rea.tools/guides/rl-environments/) ·
[Demo auf X ansehen](https://x.com/reatools/status/2112574822584918075?s=20)

Wenn du mit REA etwas Interessantes untersucht hast, würden wir es gern sehen. Teile deine Fallstudie in einem [Issue](https://github.com/morluto/rea/issues) oder [Pull Request](https://github.com/morluto/rea/pulls) und beschreibe das Ziel, deine Frage, wie REA geholfen hat und was du herausgefunden hast.

<a id="build-rl-environments"></a>

## RL-Umgebungen erstellen

Erstelle eine lokale Umgebung, in der ein KI-Agent Aufgaben wie das Finden eines Issues oder das Anlegen eines Ordners üben kann, ohne die ursprüngliche App auszuführen. Nutze sie für Reinforcement Learning (RL) oder um zu testen, wie gut ein Agent Aufgaben erledigt.

REA wandelt aufgezeichnete API-Anfragen und Antworten in Werkzeuge um, die der Agent aufrufen kann. Die Umgebung nutzt die aufgezeichneten Daten und unterstützt Änderungen nur, wenn die Aufzeichnung deren Wirkung bestätigt.

Richte REA in deinem Agenten ein und ersetze die Beispiel-URL und die Ordneraufgaben durch deine eigenen:

```text
Erstelle mit REA eine RL-Umgebung aus meiner Test-Web-App unter
http://127.0.0.1:3000.
Decke das Auflisten, Erstellen, Umbenennen und Löschen von Ordnern ab.
Du darfst Testordner anlegen und entfernen. Lass bestehende Daten unverändert.
Speichere sie in einem Ordner namens my-env, prüfe die verfügbaren Operationen und erkläre mir den Start.
```

<details>
<summary>Stattdessen die Befehlszeile verwenden</summary>

Nutze diese Befehle, wenn du bereits eine Datei mit aufgezeichneten Browseranfragen und Antworten der App hast. Zum Ausführen des Ergebnisses brauchst du außerdem AgentEnv und Docker.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA exportiert eine lauffähige Umgebung mit einem einfachen Test, der prüft, ob sie startet und antwortet. Nutze sie mit deinem RL-Framework, um Aufgabenziele und Belohnungsprüfungen festzulegen und das Training auszuführen.

[Anleitung zum Erstellen einer Umgebung](https://rea.tools/guides/rl-environments/) ·
[Umgebungsreferenz](../agent-environments.md) ·
[Demo auf X ansehen](https://x.com/reatools/status/2112574822584918075?s=20)

## Häufige Fragen

<details>
<summary><strong>Welche Agenten können REA verwenden?</strong></summary>

Jeder Agent, der lokale MCP-Server unterstützt. Die Einrichtung konfiguriert die [unterstützten Agenten](../installation.md#supported-agents); andere Clients können die [manuelle MCP-Registrierung](../installation.md#mcp-registry) nutzen.

</details>

<details>
<summary><strong>Brauche ich Hopper, Ghidra, IDA oder Kuna?</strong></summary>

Für tiefgehende native Analysen wird eines dieser Programme verwendet. Statische JavaScript- und .NET-Untersuchungen funktionieren ohne native Analyse-Engine. Die Einrichtung kann Hopper nach Zustimmung installieren; Ghidra, IDA und Kuna nutzen deine vorhandenen Installationen. Siehe [Provider-Einrichtung](../installation.md#hopper).

</details>

<details>
<summary><strong>Muss ich Hopper vorher starten?</strong></summary>

REA startet Hopper, wenn eine Operation es benötigt. Unter macOS kann beim ersten Start ein Dialog erscheinen, in dem du den Demomodus auswählst oder deine Lizenz aktivierst. Siehe [Hopper-Start und Fehlerbehebung](../installation.md#launcher-paths-and-troubleshooting).

</details>

<details>
<summary><strong>Was bewirkt die Installation des Skills über skills.sh?</strong></summary>

Der Skill stellt Untersuchungsanweisungen für deinen Agenten bereit. Verwende `npx rea-agents setup`, um den MCP-Server von REA zu registrieren und passende Anweisungen zu installieren. Starte deinen Agenten anschließend neu. Siehe [Installation nur des Skills](../installation.md#skill-only-installation).

</details>

<details>
<summary><strong>Welchen Code liefert REA zurück?</strong></summary>

Native Analysen liefern Pseudocode und Assemblercode. JavaScript-/Electron-Analysen rekonstruieren Module und ihre Beziehungen. Dein Agent nutzt diese Ergebnisse zum Schreiben und Testen einer Implementierung; die [Fallstudien](#fallstudien) zeigen konkrete Beispiele.

</details>

<details>
<summary><strong>Lädt REA meine App hoch?</strong></summary>

REA analysiert Ziele lokal. Dein Agent erhält die Werkzeugergebnisse; sein Modellanbieter hat eine eigene Datenrichtlinie.

</details>

<details>
<summary><strong>Was soll ich tun, wenn ich einen Fehler finde?</strong></summary>

Aktualisiere zuerst; eine neuere Version könnte den Fehler bereits behoben haben.

Für eine über npm installierte CLI:

```bash
rea update
```

Für die Agenteneinrichtung über `npx`:

```bash
npx rea-agents@latest setup
```

Wenn du einen Agenten verwendest, schließe die [Aktualisierung der Einrichtung](#rea-aktualisieren) ab und starte ihn neu. Wiederhole dieselbe Aufgabe. Besteht das Problem weiterhin, [öffne ein Issue](https://github.com/morluto/rea/issues) mit deiner REA-Version, dem Zieltyp, den Reproduktionsschritten und der Fehlerausgabe.

</details>

## Dokumentation

Beginne mit den [praxisnahen Anleitungen](https://rea.tools/de/guides/) auf der Website. Genaue Optionen, Voraussetzungen und Ergebniskontrakte findest du hier:

- [Installation und Einrichtung](../installation.md): Agentenregistrierung, Provider-Konfiguration, Updates und Deinstallation.
- [Bereitschaft und Fehlerbehebung](../installation.md#check-readiness-for-your-task): Diagnose eines bestimmten Agenten oder einer Analyse-Engine.
- [CLI und Evidence](../cli.md): Befehle, Provider-Auswahl, Snapshots, Import/Export und Exit-Status.
- [MCP-Kontrakte](../mcp-contracts.md) und [Agenten-Prompts](../mcp-prompts.md): Werkzeugergebnisse, Sitzungen und geführte Untersuchungen.
- [Werkzeugkatalog](../mcp-contracts.md#generated-catalog): Beim Build erzeugtes Inventar von Werkzeugen, Providern und CLI-Befehlen.
- [Roadmap](../roadmap.md): Geplante Arbeiten und Fortschrittsübersichten zu Fähigkeiten.

Melde Sicherheitslücken gemäß [SECURITY.md](../../SECURITY.md).

## Sternverlauf

🎉 **400.000 GitHub-Sterne – vielen Dank!**

Danke an alle, die REA nutzen, Fehler melden, Funktionswünsche äußern, Builds testen und Fehlerbehebungen beitragen.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="GitHub-Sternverlauf von REA" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Haftungsausschluss

Hinweise zur verantwortungsvollen Nutzung findest du in [DISCLAIMER.md](../../DISCLAIMER.md).

REA dient der rechtmäßigen Forschung, Bildung, Interoperabilität, Softwareerhaltung und Analyse von Software, die dir gehört oder die du mit entsprechender Genehmigung untersuchen darfst.

The project's position on illegal or unauthorized use covers all REA
versions, distribution channels, and platforms; each copy retains its
applicable licenses.

## Mitwirken

Wir freuen uns über deine Hilfe bei REA! [Öffne ein Issue](https://github.com/morluto/rea/issues), um einen Fehler zu melden oder eine Funktion vorzuschlagen, oder [sende einen Pull Request](https://github.com/morluto/rea/pulls), um Code oder Dokumentation zu verbessern.

Die Entwicklungsumgebung und Prüfungen beschreibt [CONTRIBUTING.md](../../CONTRIBUTING.md), die Verifikationspfade der [Testleitfaden](../testing.md) und die Projektstruktur die [Architekturübersicht](../architecture.mermaid).

## Lizenz

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
