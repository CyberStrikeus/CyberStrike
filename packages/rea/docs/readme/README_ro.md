<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · **Română**

# REA: Reverse Engineer Anything

### Un singur server MCP pentru inginerie inversă: fișiere binare, aplicații și comportament în timpul execuției.

**Ai găsit o funcționalitate care îți place? Înțelege cum funcționează, până la nivel de cod binar.**

[![Versiunea npm](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![Catalogul uneltelor MCP](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Cerințe Node.js](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#ce-poți-analiza)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![Licența MIT](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Site web](https://rea.tools/) · [Ghiduri](https://rea.tools/guides/) · [Studii de caz](https://rea.tools/showcase/)**

[Pornire rapidă](#pornire-rapidă) · [Cum funcționează REA](#cum-funcționează-rea) · [Ce poți analiza](#ce-poți-analiza) · [Studii de caz](#studii-de-caz) · [Construiește medii RL](#build-rl-environments) · [Întrebări frecvente](#întrebări-frecvente) · [Documentație](#documentație)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> Descarcă REA din [morluto/rea](https://github.com/morluto/rea),
> de pe [rea.tools](https://rea.tools/) sau prin [pachetul npm rea-agents](https://www.npmjs.com/package/rea-agents).
> Urmează linkurile de instalare și către versiunile publicate oferite de aceste surse oficiale.
> Un nume de repository asemănător sau un README copiat nu dovedește că descărcarea provine dintr-o sursă oficială.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA pornește componenta de legătură pentru analiză în Hopper în timp ce inspectează un fișier binar nativ" width="1200" />

<br /><br />

<table aria-label="Comunitatea REA">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Alătură-te comunității de inginerie inversă</strong>
  </a><br />
  <sub>Discord · Întrebări și răspunsuri · Prezentări și demonstrații</sub>
</td>
</tr>
</table>

<br />

</div>

---

Ai văzut într-o aplicație o funcționalitate pe care ai vrea să o incluzi în propriul produs? Cere-i agentului tău să o investigheze cu REA. Poate inspecta aplicația fără codul ei sursă, poate explica modul în care funcționează acea funcționalitate, poate prezenta dovezile și poate construi o variantă pentru proiectul tău.

REA conectează agentul tău la unelte pentru inspectarea fișierelor binare native, a aplicațiilor JavaScript și Electron, a ansamblurilor .NET și a site-urilor web. Poți folosi aceleași unelte și din terminal. Analiza rulează local, iar rezultatele includ dovezile și limitările care stau la baza fiecărei concluzii.

Programul de configurare înregistrează REA în agentul tău și instalează instrucțiunile corespunzătoare pentru fluxul de lucru. Analiza nativă poate folosi o instalare existentă de Hopper, Ghidra, IDA sau Kuna; programul de configurare poate instala opțional Hopper, cu aprobarea ta. Analiza statică JavaScript nu necesită un motor de analiză nativă.

> **[Vizitează site-ul REA](https://rea.tools/)** pentru instrucțiuni de configurare, ghiduri ilustrate și studii de caz reale.

## Pornire rapidă

Pe Linux, pornirea Ghidra, JADX și a uneltelor pentru firmware, precum și analiza
statică JavaScript/Electron necesită un `ps` compatibil cu procps în `PATH`-ul REA,
pentru a verifica dacă procesele îi aparțin. Pașii de remediere sunt în
`docs/installation.md`, la secțiunea „Linux owned-process prerequisite”.

### Configurează agentul

Cu Node.js și npm instalate, rulează:

```bash
npx rea-agents setup
```

Alege agenții, verifică modificările propuse și aprobă-le. Configurarea adaugă
serverul MCP REA și instrucțiunile corespunzătoare pentru fluxul de lucru,
creând copii de siguranță ale configurației existente. Repornește apoi agentul.

Programul de configurare acceptă Claude Code, Codex, Cursor, Gemini CLI, Grok Build și
[alți agenți](../installation.md#supported-agents). Consultă
[instalarea și configurarea](../installation.md) pentru configurarea motoarelor
de analiză și înregistrarea manuală a serverului MCP.

MCP folosește implicit scheme de intrare compacte, pentru a reduce spațiul ocupat
în context. Setează `REA_MCP_INPUT_SCHEMA_PROFILE=full` în înregistrarea MCP când
ai nevoie de îndrumările complete pentru câmpurile expuse și de detaliile
validării structurilor imbricate. Ambele profiluri păstrează toate uneltele și
validarea canonică a serverului. Consultă secțiunea „Compact input schema profile”
din ghidul contractelor MCP.

### Cere-i agentului

```text
Înțelege cum funcționează căutarea în aplicația Notes, arată-mi dovezile și
construiește o funcționalitate similară pentru proiectul meu.
```

Înlocuiește Notes cu aplicația vizată și precizează funcționalitatea pe care vrei să o înțelegi.

### Folosește terminalul

Inspectează directorul extras al unei aplicații JavaScript/Electron sau o arhivă ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Rezultatul include modulele, importurile, delimitările dintre componentele Electron
și dovezile aferente. Înlocuiește calea cu cea a aplicației vizate, de exemplu
`"D:/apps/example"` pe Windows.

Pentru a instala comanda `rea` și a o folosi în mod curent:

```bash
npm install --global rea-agents
rea --help
```

Pentru analiza nativă, configurează mai întâi un motor de analiză. Consultă
[ghidul CLI și Evidence](../cli.md) pentru comenzile de analiză nativă,
selectarea motorului, instantanee și utilizarea în scripturi.

### Actualizează REA

REA evoluează rapid, iar versiunile noi includ frecvent corecții de erori.
Menține instalarea la zi.

Pentru o interfață CLI instalată cu `npm install --global` sau `bun add --global`:

```bash
rea update
```

`rea --update` este un alias pentru acest flux de actualizare verificat și acceptă
aceleași opțiuni globale de ieșire. Folosește `rea update` când îl combini cu alte
opțiuni de control al comenzii.

Comenzile de actualizare păstrează cel mult 4 MiB în total din stdout și stderr.
Răspunsurile cu metadate prea mari sunt respinse după încheierea comenzii;
instalările cu ieșire detaliată continuă cu un volum limitat de date de diagnostic.
Afișarea progresului în terminal ține cont de ritmul în care acesta poate primi
date și așteaptă finalizarea operațiilor de scriere deja trimise.

Actualizările instalărilor globale cu Bun necesită Bun 1.2.17 sau o versiune mai nouă.
Dacă ai o versiune mai veche, actualizează Bun manual înainte de a rula `rea update`.

Pentru a actualiza înregistrările agenților și skill-ul, rulează comanda de
configurare afișată de programul de actualizare.

Dacă folosești `npx`, actualizează configurarea agentului cu:

```bash
npx rea-agents@latest setup
```

Verifică modificările de configurare și repornește agentul. Pentru comenzi CLI
ocazionale, folosește `npx rea-agents@latest` urmat de comandă. Cu Bun, folosește
`bunx rea-agents@latest` în loc de `npx rea-agents@latest`.

## Cum funcționează REA

Agentul tău apelează REA prin MCP pentru a inspecta ținta și a urmări codul relevant.
REA returnează constatările împreună cu dovezile aferente. Agentul le folosește
pentru a pune întrebări suplimentare, a explica comportamentul sau a scrie și
testa o implementare. Comenzile CLI folosesc aceleași fluxuri de lucru.

![Fluxul unei investigații REA: agentul întreabă despre o țintă locală, REA o inspectează și îi urmărește comportamentul cu ajutorul uneltelor de analiză, iar agentul folosește codul, referințele și necunoscutele returnate pentru a explica, implementa și testa.](../../website/public/assets/figures/rea-investigation-flow.svg)

[Deschide figura la dimensiunea originală](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## Ce poți analiza

REA necesită Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) sau 26.12.1+, plus npm.
Uneltele suplimentare și platformele acceptate depind de ținta analizată:

| Țintă                               | Ce returnează REA                                                                                                             | Cerințe și ghid                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Aplicații desktop instalate         | Componente de execuție candidate, fișiere auxiliare, indicii despre componente și următoarele verificări                      | Inspectare integrată a directoarelor și antetelor, cu limite de resurse; [aplicații desktop](../desktop-applications.md)               |
| Fișiere binare native               | Pseudocod, cod de asamblare, șiruri de caractere, simboluri, apeluri și referințe                                             | Hopper, Ghidra, IDA sau Kuna; [analiză nativă](../native-investigation.md)                                                             |
| Structura ELF, offline              | Secțiuni, segmente, simboluri și relocări originale, precum și indicii statice despre mecanismele de protecție                | pwntools furnizat de utilizator, pe Linux x64; [diagnosticarea binarelor](../binary-diagnostics.md)                                    |
| Fișiere binare Go                   | Versiunea compilatorului încorporată în fișier, modulele, înlocuirile și setările de compilare                                | Inspectare statică integrată a fișierelor ELF/PE/Mach-O cu o singură arhitectură; nu necesită instalarea Go                            |
| Obiecte de cod GPU                  | Ținte CUDA/HIP, parametri și resurse selectate ale kernelurilor GPU, textul PTX păstrat                                       | Inspectare statică integrată a fișierelor ELF/PE/fatbin/CUBIN/PTX; [obiecte de cod GPU](../gpu-code-objects.md)                        |
| Fișiere de model                    | Metadate GGUF / safetensors, declarații de tensori și totaluri calculate din acestea                                          | Inspectare integrată a antetelor; opțional, hash al întregului fișier; [fișiere de model](../model-artifacts.md)                       |
| Metadate IL2CPP                     | Imagini de ansambluri din global-metadata.dat al Unity, nume de tipuri și metode și intervale de indici                       | Decodare statică integrată a versiunilor 24, 27, 29, 31 și 39; nu necesită Unity                                                       |
| Godot PCK                           | Inventarul și extragerea arhivei, informații originale din antet și director și identificatori ai conținutului selectat       | Suport static integrat pentru formatele 2, 3 și 4; nu necesită Godot                                                                   |
| Fișiere binare Rust                 | Nume, versiuni, surse și relații de dependență ale pachetelor crate încorporate prin cargo-auditable                          | Inspectare statică integrată a fișierelor ELF/PE/Mach-O cu o singură arhitectură; [binare Rust](../rust-binaries.md)                   |
| Certificate PE                      | Intrări Authenticode WIN_CERTIFICATE și câmpuri de identitate ale semnatarilor PKCS#7 și certificatelor X.509                 | Inspectare statică integrată a fișierelor PE; [certificate PE](../pe-certificates.md)                                                  |
| Importuri PE                        | Numele DLL-urilor importate și încărcate întârziat, ordinale, RVA-uri ale IAT și hash-ul importurilor calculat de pefile      | Inspectare statică integrată a fișierelor PE; [importuri PE](../pe-imports.md)                                                         |
| Note ELF                            | Proprietari și tipuri PT_NOTE/SHT_NOTE, câmpuri GNU build-id și ABI-tag                                                       | Inspectare statică integrată a fișierelor ELF; [note ELF](../elf-notes.md)                                                             |
| Rapoarte Apple IPS de eroare fatală | Metadate .ips, fire de execuție, imagini binare, registre și clase documentate de erori fatale                                | Inspectare statică integrată a datelor JSON; [Apple IPS](../apple-ips.md)                                                              |
| Module de kernel Linux              | Chei .modinfo, CRC-uri din __versions, prezența this_module și structura semnăturii de la sfârșitul fișierului                | Inspectare statică integrată a fișierelor ELF; [module de kernel](../kernel-modules.md)                                                |
| Erlang BEAM                         | Blocuri IFF, atomi, exporturi, importuri, funcții lambda și antetul Code                                                      | Inspectare statică integrată a fișierelor BEAM; [Erlang BEAM](../erlang-beam.md)                                                       |
| Fișiere WASM                        | Validare, secțiuni, forme WAT exacte ale importurilor și exporturilor și cod WAT decodat                                      | WABT 1.0.42 furnizat de utilizator; `inspect_wasm_artifact`                                                                            |
| Bytecode EVM                        | Selectori de apel, poziții în octeți, argumente și mutabilitate deduse                                                        | Fișier local în format brut sau hexazecimal, pe Linux x64; [ghid EVM offline](../evm-bytecode.md)                                      |
| Baze de date SQLite                 | Tabele, coloane, indecși, vizualizări, declanșatoare și rânduri selectate din tabele obișnuite                                | Instantaneu local al bazei de date/WAL; Node.js 24.x >=24.15 sau 26+, cu limite SQLite native                                          |
| Erori fatale Linux înregistrate     | Note brute, registrele și semnalele fiecărui fir înregistrat și, opțional, corespondențe candidate pentru mapările de memorie | pwntools furnizat de utilizator, pe Linux x64; opțional GDB/pwndbg; [erori fatale înregistrate](../recorded-crashes.md)                |
| JavaScript / Electron               | Module, importuri, hărți de cod sursă, rute, IPC și relații cu extensiile native                                              | Node.js și npm; pe Linux: `ps` compatibil cu procps; [analiza aplicațiilor](../javascript-application-workflows.md)                    |
| Site-uri web                        | Structura paginilor, scripturi, observații de rețea și capturi de ecran solicitate                                            | Un browser din familia Chrome; [analiză în browser](../browser-observation.md)                                                         |
| Capturi de rețea salvate            | Cereri, răspunsuri, conținuturi expuse ale mesajelor și pozițiile lor în sursă                                                | HAR sau SAZ din Fiddler Everywhere; mitmdump pe Linux pentru formatul nativ mitmproxy; [ghidul capturilor](../web-network-captures.md) |
| Ansambluri .NET                     | Metadate, instrucțiuni CIL, dependențe native declarate și comparații între compilări                                         | Fără cerințe suplimentare (doar analiză statică); [ghidul codului gestionat](../managed-code-analysis.md)                              |
| APK-uri Android                     | Declarații din manifest, clase, metode decompilate și referințe                                                               | JADX fără interfață grafică și un JDK complet, pe Linux/macOS/Windows x64; [ghidul Android](../android-analysis.md)                    |
| Semnături APK                       | Semnatari v1/v2/v3/v3.1, amprente ale certificatelor, rotația cheilor și consistența internă a hash-urilor                    | Fără cerințe suplimentare (doar analiză statică); `inspect_apk_signature`                                                              |
| Dispozitive Android                 | Dispozitive, pachete, procese, jurnale, dumpuri, capturi de ecran și transferuri de APK-uri și fișiere                        | adb furnizat de utilizator (emulator sau dispozitiv fizic); [ghidul ADB](../adb-device-analysis.md)                                    |
| Proiecte JEB                        | Unități de proiect analizate prin motor, hash-uri ale artefactelor și pseudocod pentru tipuri și metode                       | Un client JEB pornit de utilizator, care oferă un server MCP și este selectat prin REA_JEB_MCP_URL; [ghidul JEB](../jeb-analysis.md)   |
| Resurse Android                     | Manifest decodat, tabele de șiruri de caractere, localizări și informații despre versiune                                     | Program de lansare Apktool furnizat de utilizator; [ghidul resurselor](../apktool-resource-analysis.md)                                |
| Aplicații Flutter                   | Hash-ul instantaneului Dart, hash-uri ale bibliotecilor pentru fiecare ABI și proveniența compilării motorului                | Fără cerințe suplimentare (parsare statică a APK-ului); [ghidul Flutter](../flutter-analysis.md)                                       |
| Firmware                            | Regiuni, rezultate ale extragerii și transferul către analiza nativă                                                          | Binwalk / Unblob pe Linux; [ghidul firmware](../firmware-analysis.md)                                                                  |
| Pachete de rețea înregistrate       | Câmpuri selectate, valori repetate, filtre și reguli decode-as                                                                | Linux: TShark 4.x + prlimit; [ghidul capturilor](../packet-captures.md)                                                                |
| Rezumate ale traficului de rețea    | Puncte terminale, DNS, TLS SNI, distribuția protocoalelor și cereri HTTP                                                      | tshark și capinfos furnizate de utilizator (verificate pe Linux); [ghidul pcap](../pcap-analysis.md)                                   |
| Semnale logice înregistrate         | Adnotări ale decodorului, intervale de eșantioane și date de diagnostic                                                       | Linux: sigrok-cli 0.7.2 + prlimit; [înregistrări de semnale](../signal-recordings.md)                                                  |
| Pachete și resurse                  | Inventare de fișiere, hash-uri, fișiere plist, structura pachetelor de aplicație Apple și resurse extrase                     | [Ghidul artefactelor și JavaScript](../javascript-artifact-reconstruction.md), [aplicații Apple](../apple-application-analysis.md)     |
| Comportamentul proceselor           | Ieșirea în terminal, interacțiuni, observații despre terminarea proceselor și sistemul de fișiere și comparații între rulări  | Linux/macOS cu un PTY nativ; [capturarea proceselor](../process-capture.md)                                                            |
| Executabile PyInstaller             | Membri CArchive, versiunea Python, scripturi de intrare și bytecode extras                                                    | Fără cerințe suplimentare (doar analiză statică); [aplicații Python împachetate](../python-packaged-applications.md)                   |

Inspectarea statică JavaScript și .NET citește fișierele furnizate fără a rula
aplicația. Capturarea în timpul execuției rulează ținta selectată sau interacționează
cu aceasta folosind permisiunile contului tău; fiecare ghid de capturare descrie
efectele acestor operații.

Pentru inspectarea offline a binarelor native, REA acceptă și GNU objdump și Rizin,
furnizate de utilizator. Consultă [ghidul uneltelor de inginerie inversă](../reverse-engineering-tools.md)
pentru configurare, comenzi CLI și limitările obiectelor Evidence. REA nu
instalează și nu actualizează niciunul dintre aceste două instrumente.

<a id="choosing-a-deep-analysis-provider"></a>

Formatele native și platformele acceptate diferă în funcție de motorul de analiză.
Consultă [configurarea Hopper și Ghidra](../installation.md#hopper),
[ghidul IDA](../ida-provider.md) (inclusiv o componentă opțională de legătură MCP nativă),
[ghidul decompilatorului Kuna](../kuna-provider.md) și
[suportul experimental Ghidra pe Windows](../windows-ghidra-p0.md).
Ghidra acceptă și [analiza DOS pe 16 biți](../ghidra-dos.md).
Pentru binare mari, mărește timpul maxim de pornire al motorului cu
`REA_GHIDRA_STARTUP_TIMEOUT_MS` sau `REA_HOPPER_STARTUP_TIMEOUT_MS`.
Pentru selectarea motorului, consultă [ghidul CLI](../cli.md#choose-a-provider).
Verifică [disponibilitatea în versiunile publicate](../installation.md#released-package-and-main)
pentru funcționalitățile adăugate după cea mai recentă versiune npm.

## Studii de caz

<a href="https://rea.tools/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="Ilustrații pentru studiile de caz despre panoramarea sunetului în DX-Ball, legătura cu clipboardul în Notion și inelele de proiectile din TH04" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: reconstruiește calculul panoramării sunetului

Urmărește un apel audio până la funcția auxiliară care transformă poziția în
panoramare stereo, inspectează instrucțiunile și transformă pseudocodul incomplet
în C. Reconstrucția trece 3.205 cazuri de test comparate cu originalul x86 și
reproduce toți cei 63 de octeți ai funcției compilate.

[Citește studiul de caz](https://rea.tools/showcase/dx-ball/) ·
[Repository-ul reconstrucției](https://github.com/N0zoM1z0/dx-ball)

### Notion: urmărește legătura Electron cu clipboardul

Găsește API-ul pentru clipboard din procesul de randare, urmărește-l prin preload
și IPC până în procesul principal și inspectează formatul datelor cu formatare din clipboard.

[Citește studiul de caz](https://rea.tools/showcase/notion/)

### TH04: recuperează calculul unui inel de proiectile DOS

Inspectează instrucțiunile pe 16 biți ale jocului original pentru PC-98,
recuperează calculele unghiurilor fixe și ale celor orientate spre țintă și
compară codul C++ reconstruit cu rezultatul compilatorului folosit la acea vreme.

[Citește studiul de caz](https://rea.tools/showcase/th04/) ·
[Repository-ul reconstrucției](https://github.com/N0zoM1z0/th04)

### Construiește medii RL cu REA

Înregistrează o sesiune de aplicație web, transformă API-ul în instrumente și exportă un mediu pe care un agent AI îl poate folosi. Rulează cu AgentEnv, apoi adaugă sarcini și verificări de recompensă pentru antrenare RL sau evaluare.

[Ghid pentru construirea unui mediu](https://rea.tools/guides/rl-environments/) ·
[Vezi demonstrația pe X](https://x.com/reatools/status/2112574822584918075?s=20)

Dacă ai folosit REA pentru ceva interesant, ne-ar plăcea să vedem rezultatul.
Prezintă cazul într-un [issue](https://github.com/morluto/rea/issues) sau într-un
[pull request](https://github.com/morluto/rea/pulls), menționând ținta analizată,
întrebarea ta, cum te-a ajutat REA și ce ai descoperit.

<a id="build-rl-environments"></a>

## Construiește medii RL

Creează un mediu local în care un agent AI să exerseze sarcini precum găsirea unui issue sau crearea unui dosar, fără a rula aplicația originală. Folosește-l pentru învățare prin recompensă (RL) sau pentru a testa cât de bine îndeplinește agentul sarcinile.

REA transformă cererile și răspunsurile API înregistrate în instrumente pe care agentul le poate apela. Mediul folosește datele înregistrate și permite modificări doar când înregistrarea le confirmă efectele.

După ce configurezi REA în agent, înlocuiește URL-ul și sarcinile pentru dosare din exemplu cu ale tale:

```text
Folosește REA pentru a crea un mediu RL din aplicația mea web de test de la
http://127.0.0.1:3000.
Include listarea, crearea, redenumirea și ștergerea dosarelor. Poți crea și elimina
dosare de test, dar nu modifica datele existente.
Salvează într-un dosar numit my-env, verifică operațiile disponibile și spune-mi cum îl rulez.
```

<details>
<summary>Folosește linia de comandă</summary>

Folosește aceste comenzi dacă ai deja un fișier cu cererile și răspunsurile aplicației înregistrate în browser. Pentru a rula rezultatul ai nevoie și de AgentEnv și Docker.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA exportă un mediu executabil cu un test de bază care verifică pornirea și răspunsurile. Conectează-l la frameworkul RL pentru a defini obiectivele, a adăuga verificări de recompensă și a rula antrenarea.

[Ghid pentru construirea unui mediu](https://rea.tools/guides/rl-environments/) ·
[Referință pentru medii](../agent-environments.md) ·
[Vezi demonstrația pe X](https://x.com/reatools/status/2112574822584918075?s=20)

## Întrebări frecvente

<details>
<summary><strong>Ce agenți pot folosi REA?</strong></summary>

Orice agent care acceptă servere MCP locale. Programul de configurare pregătește
[agenții acceptați](../installation.md#supported-agents); pentru ceilalți clienți
poți folosi [înregistrarea manuală MCP](../installation.md#mcp-registry).

</details>

<details>
<summary><strong>Am nevoie de Hopper, Ghidra, IDA sau Kuna?</strong></summary>

Analiza nativă aprofundată folosește unul dintre aceste instrumente. Inspectarea
statică JavaScript și .NET funcționează fără un motor de analiză nativă.
Programul de configurare poate instala Hopper după aprobare; pentru Ghidra, IDA și Kuna
folosește instalările existente. Consultă [configurarea motoarelor de analiză](../installation.md#hopper).

</details>

<details>
<summary><strong>Trebuie să pornesc mai întâi Hopper?</strong></summary>

REA pornește Hopper când o operație are nevoie de el. Pe macOS, un dialog afișat
la prima pornire îți poate cere să alegi modul demonstrativ sau să activezi licența.
Finalizează acel pas în aceeași sesiune de utilizator înainte de prima operație
CLI/MCP sau de prima sarcină nesupravegheată. Deschide Hopper manual dacă este nevoie.
Consultă [pornirea Hopper și depanarea](../installation.md#launcher-paths-and-troubleshooting).

</details>

<details>
<summary><strong>Ce face instalarea skill-ului de pe skills.sh?</strong></summary>

Skill-ul oferă agentului instrucțiuni de investigare. Folosește `npx rea-agents setup`
pentru a înregistra serverul MCP REA și a instala instrucțiunile corespunzătoare,
apoi repornește agentul. Consultă [instalarea doar a skill-ului](../installation.md#skill-only-installation).

</details>

<details>
<summary><strong>Ce cod returnează REA?</strong></summary>

Analiza nativă returnează pseudocod și cod de asamblare. Analiza JavaScript/Electron
recuperează modulele și relațiile dintre ele. Agentul tău folosește aceste
constatări pentru a scrie și testa o implementare;
[studiile de caz](#studii-de-caz) oferă exemple detaliate.

</details>

<details>
<summary><strong>REA îmi încarcă aplicația pe un server?</strong></summary>

REA analizează țintele local. Agentul tău primește rezultatele uneltelor, iar
furnizorul modelului său are propria politică privind datele.

</details>

<details>
<summary><strong>Ce fac dacă întâlnesc o eroare?</strong></summary>

Actualizează mai întâi; o versiune recentă ar putea să o fi remediat deja.

Pentru o interfață CLI instalată cu `npm install --global` sau `bun add --global`:

```bash
rea update
```

Pentru configurarea agentului prin `npx`:

```bash
npx rea-agents@latest setup
```

Dacă folosești un agent, finalizează [actualizarea configurării](#actualizează-rea)
și repornește-l. Reîncearcă aceeași sarcină. Dacă problema persistă,
[deschide un issue](https://github.com/morluto/rea/issues) și include versiunea REA,
tipul țintei analizate, pașii de reproducere și mesajele de eroare.

</details>

## Documentație

Începe cu [ghidurile practice](https://rea.tools/guides/) de pe site.
Pentru opțiunile exacte, cerințele preliminare și contractele rezultatelor:

- [Instalare și configurare](../installation.md): înregistrarea agenților, configurarea motoarelor de analiză, actualizări și dezinstalare.
- [Verificarea pregătirii și depanare](../installation.md#check-readiness-for-your-task): diagnosticarea unui agent sau motor de analiză.
- [CLI și Evidence](../cli.md): comenzi, selectarea motorului, instantanee, import/export și coduri de ieșire.
- [Contracte MCP](../mcp-contracts.md) și [prompturi pentru agenți](../mcp-prompts.md): rezultatele uneltelor, sesiuni și investigații ghidate.
- [Catalogul uneltelor](../mcp-contracts.md#generated-catalog): inventarul generat al uneltelor, motoarelor de analiză și comenzilor CLI.
- [Plan de dezvoltare](../roadmap.md): lucrări planificate și urmărirea progresului funcționalităților.

Raportează vulnerabilitățile conform [SECURITY.md](../../SECURITY.md).

## Istoricul stelelor

🎉 **400.000 de stele pe GitHub — vă mulțumim!**

Mulțumim tuturor celor care folosesc REA, raportează erori, propun funcționalități,
testează versiuni și contribuie cu remedieri.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="Istoricul stelelor REA pe GitHub" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Precizări privind utilizarea

Consultă [DISCLAIMER.md](../../DISCLAIMER.md) pentru îndrumări privind utilizarea responsabilă.

Poziția proiectului față de utilizarea ilegală sau neautorizată se aplică tuturor
versiunilor REA, canalelor de distribuție și platformelor; fiecare copie își
păstrează licențele aplicabile.

REA este destinat cercetării legale, educației, interoperabilității, conservării
software-ului și analizei programelor pe care le deții sau pe care ai autorizarea
să le examinezi.

## Contribuții

Ne-ar bucura să contribui la REA! [Deschide un issue](https://github.com/morluto/rea/issues)
pentru a raporta o eroare sau a propune o funcționalitate ori
[trimite un pull request](https://github.com/morluto/rea/pulls) pentru a îmbunătăți
codul sau documentația.

Consultă [CONTRIBUTING.md](../../CONTRIBUTING.md) pentru pregătirea mediului de dezvoltare
și verificări, [ghidul de testare](../testing.md) pentru categoriile de verificări
și [diagrama arhitecturii](../architecture.mermaid) pentru anumite straturi și
relații de dependență.

## Licență

[MIT](../../LICENSE)

Codul scris în cadrul REA este licențiat sub MIT. Materialele terților își păstrează
propriile licențe și mențiuni privind drepturile de autor; consultă
[mențiunile privind terții](../../THIRD_PARTY_NOTICES.md) pentru inventarul
dependențelor, textele licențelor păstrate și condițiile aplicabile uneltelor externe.

**Trebuie să obții legal uneltele comerciale și să ai dreptul să le folosești**,
inclusiv decompilatoarele IDA Pro / Hex-Rays, Hopper și JEB, în condițiile
licențelor aplicabile. REA nu îți acordă nicio licență, cheie sau drept de activare
pentru aceste unelte. Versiunile de evaluare și demonstrative rămân supuse
condițiilor furnizorilor, inclusiv restricțiilor privind utilizatorii,
funcționalitățile, automatizarea și partajarea rezultatelor. Nu sunt autorizate
copiile piratate, cheile furate, partajarea neautorizată a cheilor sau ocolirea
restricțiilor de licențiere. Aceste îndrumări nu modifică licența MIT sau licențele terților.
