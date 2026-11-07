<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · **Italiano**
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: Reverse Engineer Anything

### Un unico MCP per l'ingegneria inversa su binari, applicazioni e comportamento a runtime.

**Vedi una funzionalità che ti piace. Capisci come funziona, fino al livello binario.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#cosa-puoi-analizzare)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Sito web](https://rea.tools/it/) · [Guide](https://rea.tools/it/guides/) · [Showcase](https://rea.tools/it/showcase/)**

[Avvio rapido](#avvio-rapido) · [Come funziona REA](#come-funziona-rea) · [Cosa puoi analizzare](#cosa-puoi-analizzare) · [Showcase](#showcase) · [Creare ambienti RL](#build-rl-environments) · [FAQ](#faq) · [Documentazione](#documentazione)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> Fonti ufficiali di REA: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> Segui i link di installazione e delle versioni pubblicate da queste fonti ufficiali. Un nome di repository simile o un README copiato non dimostra che un download sia ufficiale.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA che avvia il suo bridge di analisi dentro Hopper mentre ispeziona un binario nativo" width="1200" />

<br /><br />

<table aria-label="Community REA">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Unisciti alla community di ingegneria inversa</strong>
  </a><br />
  <sub>Discord · Domande e risposte · Show and Tell</sub>
</td>
</tr>
</table>

<br />

</div>

---

Hai visto una funzionalità in un'app che vorresti nel tuo prodotto? Chiedi al tuo agente di analizzarla con REA. Può ispezionare l'app senza il suo codice sorgente, spiegare come funziona la funzionalità, mostrare le prove e realizzare una versione per il tuo progetto.

REA collega il tuo agente a strumenti per ispezionare binari nativi, app JavaScript ed Electron, assembly .NET e siti web. Puoi usare gli stessi strumenti anche dal terminale. L'analisi viene eseguita localmente e i risultati includono le prove e i limiti dietro ogni conclusione.

La configurazione registra REA con il tuo agente e installa le istruzioni di workflow corrispondenti. L'analisi nativa può usare un'installazione esistente di Hopper, Ghidra, IDA o Kuna; la configurazione può installare opzionalmente Hopper previa approvazione. L'analisi statica JavaScript non richiede alcun motore di analisi nativo.

> **[Visita il sito web di REA](https://rea.tools/it/)** per istruzioni di configurazione, guide illustrate e veri casi studio.

## Avvio rapido

Su Linux, l’avvio di Ghidra, JADX e strumenti firmware e l’analisi statica JavaScript/Electron richiedono un `ps` compatibile con procps nel `PATH` di REA per verificare la proprietà dei processi. Vedi il prerequisito Linux.

### Configura il tuo agente

Con Node.js e npm installati, esegui:

```bash
npx rea-agents setup
```

Scegli i tuoi agenti, rivedi le modifiche proposte e approvale. La configurazione aggiunge il server MCP di REA e le istruzioni di workflow corrispondenti, con backup della configurazione esistente. Riavvia quindi il tuo agente.

La configurazione supporta Claude Code, Codex, Cursor, Gemini CLI, Grok Build e [altri agenti](../installation.md#supported-agents). Vedi [installazione e configurazione](../installation.md) per la configurazione dei provider e la registrazione manuale MCP.

MCP usa schemi di input compatti per impostazione predefinita. Per tutte le indicazioni sui campi e la validazione annidata, imposta `REA_MCP_INPUT_SCHEMA_PROFILE=full` nella registrazione MCP. Entrambi i profili mantengono tutti gli strumenti e la stessa validazione canonica del server; vedi la guida ai contratti MCP.

### Chiedi al tuo agente

```text
Spiega come funziona la ricerca nell'app Note, mostrami le prove e realizza
una funzionalità simile per il mio progetto.
```

Sostituisci Note con la tua app di destinazione e la funzionalità che vuoi capire.

### Usa il terminale

Ispeziona una directory di app JavaScript/Electron estratta o un ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Il risultato include moduli, import, confini Electron e le relative prove. Sostituisci il percorso con il tuo bersaglio, ad esempio `"D:/apps/example"` su Windows.

Per installare il comando `rea` per un uso regolare:

```bash
npm install --global rea-agents
rea --help
```

Per l'analisi nativa, configura prima un provider. Vedi la [guida CLI ed Evidence](../cli.md) per i comandi nativi, la selezione del provider, gli snapshot e lo scripting.

### Aggiorna REA

REA cambia rapidamente e le nuove versioni includono correzioni di bug frequenti. Tieni aggiornata la tua installazione.

Per una CLI installata con `npm install --global` o `bun add --global`:

```bash
rea update
```

`rea --update` è un alias di `rea update` con le stesse opzioni globali di output. I comandi di aggiornamento conservano al massimo 4 MiB complessivi di stdout/stderr. I metadati troppo grandi sono rifiutati dopo l’uscita; le installazioni verbose mantengono diagnostica limitata. L’avanzamento rispetta la contropressione del terminale e attende le scritture inviate.

Gli aggiornamenti globali con Bun richiedono Bun 1.2.17 o versioni successive. Con una versione precedente di Bun, aggiorna Bun manualmente prima di eseguire `rea update`.

Per aggiornare le registrazioni del tuo agente e lo skill, esegui il comando di configurazione mostrato dall'aggiornamento.

Se usi `npx`, aggiorna la configurazione del tuo agente con:

```bash
npx rea-agents@latest setup
```

Rivedi le modifiche di configurazione e riavvia il tuo agente. Per comandi CLI singoli, usa `npx rea-agents@latest` seguito dal comando. Con Bun, usa `bunx rea-agents@latest` al posto di `npx rea-agents@latest`.

## Come funziona REA

Il tuo agente chiama REA tramite MCP per ispezionare il bersaglio e tracciare il codice rilevante. REA restituisce i risultati con le relative prove. L'agente li usa per fare domande di approfondimento, spiegare il comportamento o scrivere e testare un'implementazione. Anche i comandi CLI usano gli stessi workflow.

![Flusso di indagine REA: il tuo agente pone domande su un bersaglio locale, REA lo ispeziona e ne traccia il codice usando strumenti di analisi, e l'agente usa il codice, i riferimenti e gli elementi sconosciuti restituiti per spiegare, implementare e testare.](../../website/public/assets/figures/rea-investigation-flow.svg)

[Apri la figura a dimensione intera](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## Cosa puoi analizzare

REA richiede Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) o 26+ (>=26.12.1), oltre a npm. Strumenti aggiuntivi e supporto host dipendono dal bersaglio:

| Obiettivo                    | Cosa restituisce REA                                                                                    | Requisiti e guida                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Binari nativi                | Pseudocodice, assembly, stringhe, simboli, chiamate e riferimenti                                       | Hopper, Ghidra, IDA o Kuna; [analisi nativa](../native-investigation.md)                                                                 |
| Layout ELF offline           | Sezioni, segmenti, simboli/relocazioni originali e candidati mitigazioni statiche                       | pwntools fornito dal chiamante su Linux x64; [diagnostica binaria](../binary-diagnostics.md)                                             |
| PE certificates              | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                            | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                                  |
| PE imports                   | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                              | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                            |
| Artefatto WASM               | Convalida, sezioni, forme WAT di import/export esatte e WAT decodificato                                | WABT 1.0.42 fornito dal chiamante; `inspect_wasm_artifact`                                                                               |
| Bytecode EVM                 | Selettori di dispatch, offset dei byte, argomenti inferiti e mutabilità                                 | Carrier raw/hex locale su Linux x64; [guida EVM offline](../evm-bytecode.md)                                                             |
| Rust binaries                | Embedded cargo-auditable dependency list                                                                | [Rust binaries](../rust-binaries.md)                                                                                                     |
| ELF notes                    | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                                         | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                             |
| Linux kernel modules         | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                             | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                                   |
| Erlang BEAM                  | IFF chunks, atoms, exports, and tables                                                                  | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                        |
| Apple IPS crashes            | .ips metadata, threads, images, registers and crash classes                                             | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                            |
| Crash Linux registrati       | Note grezze, registri/segnai di ogni thread registrato e candidati mapping opzionali                    | pwntools fornito dal chiamante su Linux x64; GDB/pwndbg opzionale; [crash registrati](../recorded-crashes.md)                            |
| Installazioni desktop        | Runtime candidati, file di supporto, componenti e passi successivi                                      | Ispezione limitata di directory e intestazioni；[Applicazioni desktop](../desktop-applications.md)                                       |
| JavaScript / Electron        | Moduli, import, source map, route, IPC e relazioni con add-on nativi                                    | Node.js e npm; [analisi delle applicazioni](../javascript-application-workflows.md); Linux: procps `ps`                                  |
| Siti web                     | Struttura della pagina, script, osservazioni di rete e screenshot richiesti                             | Un browser della famiglia Chrome; [analisi browser](../browser-observation.md)                                                           |
| Acquisizioni di rete salvate | Richieste, risposte, payload esposti e posizioni sorgente                                               | HAR / Fiddler Everywhere SAZ; mitmdump su Linux per acquisizioni mitmproxy native; [guida alle acquisizioni](../web-network-captures.md) |
| Captured di pacchetti        | Endpoint, DNS, TLS SNI, distribuzione dei protocolli e richieste HTTP                                   | tshark e capinfos forniti dal chiamante; [guida pcap](../pcap-analysis.md)                                                               |
| Assembly .NET                | Metadati, istruzioni CIL, dipendenze native dichiarate e confronti di build                             | Nessuno (solo statico); [guida managed-code](../managed-code-analysis.md)                                                                |
| PyInstaller                  | CArchive, PYZ, Python bytecode                                                                          | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                                    |
| APK Android                  | Dichiarazioni manifest, classi, metodi decompilati e riferimenti                                        | JADX headless e un JDK completo su Linux/macOS/Windows x64; [guida Android](../android-analysis.md)                                      |
| Dispositivi Android          | Dispositivi, pacchetti, processi, log, dump, screenshot e trasferimenti APK/file                        | adb fornito dal chiamante (emulatore o hardware); [guida ADB](../adb-device-analysis.md)                                                 |
| Progetti JEB                 | Unità di progetto dal motore, digest degli artifact e pseudocodice di tipi/metodi                       | Client JEB avviato dal chiamante via MCP, selezionato con REA_JEB_MCP_URL; [guida JEB](../jeb-analysis.md)                               |
| Risorse Android              | Manifest decodificato, tabelle stringhe, lingue e dati di versione                                      | Launcher Apktool fornito dal chiamante; [guida alle risorse](../apktool-resource-analysis.md)                                            |
| App Flutter                  | Hash dello snapshot Dart, digest delle librerie per ABI e provenienza della build del motore            | Nessuno (analisi APK statica); [guida Flutter](../flutter-analysis.md)                                                                   |
| Firmware                     | Regioni, risultati di estrazione e passaggi all'analisi nativa                                          | Binwalk / Unblob su Linux; [guida firmware](../firmware-analysis.md)                                                                     |
| Pacchetti registrati         | Campi selezionati, valori ripetuti, filtri e regole di decodifica                                       | Linux: TShark 4.x + prlimit; [guida alle catture](../packet-captures.md)                                                                 |
| Segnali logici registrati    | Annotazioni del decoder, intervalli di campioni e diagnostica                                           | Linux: sigrok-cli 0.7.2 + prlimit; [guida ai segnali](../signal-recordings.md)                                                           |
| Pacchetti e risorse          | Inventari file, digest, plist, anatomia dei bundle Apple e risorse estratte                             | [Guida artifact e JavaScript](../javascript-artifact-reconstruction.md), [Applicazioni Apple](../apple-application-analysis.md)          |
| Comportamento dei processi   | Output del terminale, interazioni, osservazioni su uscita e filesystem ed confronti di esecuzione       | Linux/macOS con un PTY nativo; [cattura dei processi](../process-capture.md)                                                             |
| Binari Go                    | Versione del compilatore incorporata, moduli, sostituzioni e impostazioni di compilazione               | Ispezione statica integrata ELF/PE/thin Mach-O; Nessuna installazione di Go richiesta                                                    |
| Database SQLite              | Tabelle, colonne, indici, viste, trigger e righe selezionate di tabelle ordinarie                       | Snapshot locale database/WAL; Node.js 24.x >=24.15 o 26+ con limiti SQLite nativi                                                        |
| Oggetti codice GPU           | Target CUDA/HIP, parametri e risorse dei kernel selezionati, testo PTX conservato                       | Ispezione statica integrata ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                       |
| File di modelli              | Metadati GGUF / safetensors, dichiarazioni dei tensori e totali derivati                                | Ispezione degli header; hash completo facoltativo; [GGUF / safetensors](../model-artifacts.md)                                           |
| Metadati IL2CPP              | Immagini assembly Unity global-metadata.dat, nomi di tipi/metodi e intervalli di indici                 | Decodifica statica delle versioni 24, 27, 29, 31, 39; senza Unity                                                                        |
| Godot PCK                    | Inventario ed estrazione, header/directory originali e identità dei contenuti selezionati               | Formati statici 2, 3, 4; senza Godot                                                                                                     |
| Firme APK                    | Firmatari v1/v2/v3/v3.1, impronte dei certificati, rotazione delle chiavi e coerenza interna dei digest | Ispezione statica integrata; `inspect_apk_signature`                                                                                     |

L'ispezione statica di JavaScript e .NET legge i file forniti senza eseguire l'applicazione. La cattura a runtime esegue o interagisce con il bersaglio selezionato usando i tuoi permessi utente; ogni guida runtime descrive i suoi effetti.

Per ispezionare offline i binari nativi, REA supporta anche GNU objdump e Rizin, che devi fornire autonomamente. La [guida agli strumenti di reverse engineering](../reverse-engineering-tools.md) descrive la configurazione dei provider, i comandi CLI e i limiti di Evidence. REA non installa né aggiorna questi due provider.

<a id="choosing-a-deep-analysis-provider"></a>

I formati nativi e il supporto host variano in base al provider. Vedi la [configurazione di Hopper e Ghidra](../installation.md#hopper), la [guida IDA](../ida-provider.md), [Kuna](../kuna-provider.md) e il [supporto sperimentale Windows Ghidra](../windows-ghidra-p0.md). Ghidra supporta anche l'[analisi DOS a 16 bit](../ghidra-dos.md). Per binari di grandi dimensioni, aumenta il timeout di avvio con `REA_GHIDRA_STARTUP_TIMEOUT_MS` / `REA_HOPPER_STARTUP_TIMEOUT_MS`. Per la selezione del provider, vedi la [guida CLI](../cli.md#choose-a-provider). Controlla la [disponibilità delle release](../installation.md#released-package-and-main) per le funzionalità aggiunte dall'ultima release npm.

## Showcase

<a href="https://rea.tools/it/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="Illustrazioni degli showcase del sound-pan di DX-Ball, del clipboard-bridge di Notion e dell'anello di proiettili di TH04" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: ricostruisci un calcolo sound-pan

Segui una chiamata sonora fino al suo helper posizione-to-pan, ispeziona le istruzioni e trasforma il pseudocodice incompleto in C. La ricostruzione supera 3.205 casi x86 originali e riproduce tutti i 63 byte di funzione compilati.

[Leggi il case study](https://rea.tools/it/showcase/dx-ball/) · [Repository di ricostruzione](https://github.com/N0zoM1z0/dx-ball)

### Notion: traccia il clipboard bridge di Electron

Trova l'API clipboard del renderer, seguila attraverso preload e IPC fino al processo principale e ispeziona il formato rich clipboard.

[Leggi il case study](https://rea.tools/it/showcase/notion/)

### TH04: recupera un calcolo dell'anello di proiettili DOS

Ispeziona le istruzioni a 16 bit del gioco PC-98 originale, recupera i calcoli dell'angolo fisso e mirato e confronta il C++ ricostruito con l'output del compilatore storico.

[Leggi il case study](https://rea.tools/it/showcase/th04/) · [Repository di ricostruzione](https://github.com/N0zoM1z0/th04)

### Creare ambienti RL con REA

Registra una sessione di un’app web, trasforma la sua API in strumenti ed esporta un ambiente utilizzabile da un agente IA. Eseguilo con AgentEnv, poi aggiungi attività e controlli sulle ricompense per l’addestramento RL o la valutazione.

[Guida alla creazione di un ambiente](https://rea.tools/guides/rl-environments/) ·
[Guarda la demo su X](https://x.com/reatools/status/2112574822584918075?s=20)

Se hai usato REA su qualcosa di interessante, ci piacerebbe vederlo. Condividi il tuo caso in una [issue](https://github.com/morluto/rea/issues) o in una [pull request](https://github.com/morluto/rea/pulls), includendo il bersaglio, la tua domanda, come REA ti ha aiutato e cosa hai scoperto.

<a id="build-rl-environments"></a>

## Creare ambienti RL

Crea un ambiente locale in cui un agente IA possa esercitarsi in attività come cercare una issue o creare una cartella, senza eseguire l’app originale. Usalo per l’apprendimento per rinforzo (RL) o per verificare come l’agente completa le attività.

REA trasforma le richieste e le risposte API registrate in strumenti che l’agente può chiamare. L’ambiente usa i dati registrati e supporta modifiche solo quando la registrazione ne conferma gli effetti.

Configura REA nel tuo agente, poi sostituisci l’URL e le attività sulle cartelle dell’esempio con i tuoi:

```text
Usa REA per creare un ambiente RL dalla mia app web di prova su
http://127.0.0.1:3000.
Includi elenco, creazione, rinomina ed eliminazione delle cartelle. Puoi creare
e rimuovere cartelle di prova, ma non modificare i dati esistenti.
Salvalo in una cartella chiamata my-env, verifica le operazioni disponibili e spiegami come eseguirlo.
```

<details>
<summary>Usare la riga di comando</summary>

Usa questi comandi se hai già un file con le richieste e le risposte dell’app registrate nel browser. Per eseguire il risultato servono anche AgentEnv e Docker.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA esporta un ambiente eseguibile con un test di base che ne verifica l’avvio e le risposte. Usalo con il tuo framework RL per definire gli obiettivi, aggiungere controlli sulle ricompense ed eseguire l’addestramento.

[Guida alla creazione di un ambiente](https://rea.tools/guides/rl-environments/) ·
[Riferimento degli ambienti](../agent-environments.md) ·
[Guarda la demo su X](https://x.com/reatools/status/2112574822584918075?s=20)

## FAQ

<details>
<summary><strong>Quali agenti possono usare REA?</strong></summary>

Qualsiasi agente che supporti server MCP locali. La configurazione configura gli [agenti supportati](../installation.md#supported-agents); altri client possono usare la [registrazione MCP manuale](../installation.md#mcp-registry).

</details>

<details>
<summary><strong>Ho bisogno di Hopper, Ghidra, IDA o Kuna?</strong></summary>

L'analisi nativa profonda ne usa uno. L'ispezione statica di JavaScript e .NET funziona senza un motore di analisi nativo. La configurazione può installare Hopper previa approvazione; Ghidra, IDA e Kuna usano le tue installazioni esistenti. Vedi [configurazione provider](../installation.md#hopper).

</details>

<details>
<summary><strong>Devo avviare Hopper per primo?</strong></summary>

REA avvia Hopper quando un'operazione ne ha bisogno. Su macOS, una finestra di dialogo al primo avvio potrebbe chiederti di scegliere la modalità demo o di attivare la licenza. Vedi [avvio di Hopper e risoluzione dei problemi](../installation.md#launcher-paths-and-troubleshooting).

</details>

<details>
<summary><strong>Cosa fa l'installazione dello skill da skills.sh?</strong></summary>

Lo skill fornisce istruzioni di indagine per il tuo agente. Usa `npx rea-agents setup` per registrare il server MCP di REA e installare le istruzioni corrispondenti, quindi riavvia il tuo agente. Vedi [installazione solo skill](../installation.md#skill-only-installation).

</details>

<details>
<summary><strong>Quale codice restituisce REA?</strong></summary>

L'analisi nativa restituisce pseudocodice e assembly. L'analisi JavaScript/Electron recupera moduli e le loro relazioni. Il tuo agente usa questi risultati per scrivere e testare un'implementazione; gli [showcase](#showcase) offrono esempi concreti.

</details>

<details>
<summary><strong>REA carica la mia app da qualche parte?</strong></summary>

REA analizza i bersagli localmente. Il tuo agente riceve i risultati degli strumenti e il suo provider di modello ha la propria politica sui dati.

</details>

<details>
<summary><strong>Cosa devo fare se trovo un bug?</strong></summary>

Aggiorna prima; una release recente potrebbe averlo già risolto.

Per una CLI installata con `npm install --global` o `bun add --global`:

```bash
rea update
```

Per la configurazione dell'agente tramite `npx`:

```bash
npx rea-agents@latest setup
```

Se stai usando un agente, completa l'[aggiornamento della configurazione](#aggiorna-rea) e riavvialo. Riprova lo stesso task. Se il problema persiste, [apri un issue](https://github.com/morluto/rea/issues) con la tua versione di REA, il tipo di bersaglio, i passaggi per riprodurlo e l'output di errore.

</details>

## Documentazione

Inizia dalle [guide pratiche](https://rea.tools/it/guides/) del sito web. Per opzioni esatte, prerequisiti e contratti dei risultati:

- [Installazione e configurazione](../installation.md): registrazione agente, configurazione provider, aggiornamenti e disinstallazione.
- [Pronto all'uso e risoluzione dei problemi](../installation.md#check-readiness-for-your-task): diagnostica un agente o un motore di analisi.
- [CLI ed Evidence](../cli.md): comandi, selezione provider, snapshot, import/export e stati di uscita.
- [Contratti MCP](../mcp-contracts.md) e [prompt agente](../mcp-prompts.md): risultati degli strumenti, sessioni e indagini guidate.
- [Catalogo strumenti](../mcp-contracts.md#generated-catalog): inventario generato di strumenti, provider e comandi CLI.
- [Roadmap](../roadmap.md): lavoro pianificato e tracker delle capacità.

Segnala vulnerabilità tramite [SECURITY.md](../../SECURITY.md).

## Cronologia delle stelle

🎉 **400.000 stelle su GitHub — grazie!**

Grazie a tutti coloro che usano REA, segnalano bug, propongono funzionalità, testano le build e contribuiscono con correzioni.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="Cronologia stelle GitHub di REA" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Disclaimer

Consulta [DISCLAIMER.md](../../DISCLAIMER.md) per le indicazioni sull'uso responsabile.

REA è destinato alla ricerca, alla formazione, all’interoperabilità, alla conservazione del software e all’analisi di software di tua proprietà o che sei autorizzato a esaminare, nel rispetto della legge.

The project's position on illegal or unauthorized use covers all REA
versions, distribution channels, and platforms; each copy retains its
applicable licenses.

## Contributing

Apprezzeremmo il tuo aiuto con REA! [Apri un issue](https://github.com/morluto/rea/issues) per segnalare un bug o suggerire una funzionalità, oppure [invia una pull request](https://github.com/morluto/rea/pulls) per migliorare il codice o la documentazione.

Vedi [CONTRIBUTING.md](../../CONTRIBUTING.md) per la configurazione di sviluppo e i controlli, [testing](../testing.md) per le lane di verifica e la [mappa dell'architettura](../architecture.mermaid) per la struttura del progetto.

## License

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
