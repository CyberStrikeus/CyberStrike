<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · **Français** · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA : rétro-ingénierie de tout

### Un seul MCP pour la rétro-ingénierie des binaires, des applications et du comportement à l'exécution.

**Repérez une fonctionnalité qui vous plaît. Comprenez son fonctionnement, jusqu'au niveau du binaire.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Site web](https://rea.tools/fr/) · [Guides](https://rea.tools/fr/guides/) · [Études de cas](https://rea.tools/fr/showcase/)**

[Démarrage rapide](#démarrage-rapide) · [Comment fonctionne REA](#comment-fonctionne-rea) · [Ce que vous pouvez analyser](#ce-que-vous-pouvez-analyser) · [Études de cas](#études-de-cas) · [Créer des environnements RL](#build-rl-environments) · [Questions fréquentes](#questions-fréquentes) · [Documentation](#documentation)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> Sources officielles de REA : [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> Utilisez les liens d’installation et de publication de ces sources officielles. Un nom de dépôt similaire ou un README copié ne prouve pas qu’un téléchargement est officiel.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA lance son pont d'analyse dans Hopper pendant l'inspection d'un binaire natif" width="1200" />

<br /><br />

<table aria-label="REA community">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Rejoignez la communauté de rétro-ingénierie</strong>
  </a><br />
  <sub>Discord · Questions et réponses · Partage de projets</sub>
</td>
</tr>
</table>

<br />

</div>

---

Vous avez repéré dans une application une fonctionnalité que vous aimeriez avoir dans votre propre produit ? Demandez à votre agent de l'étudier avec REA. Il peut inspecter l'application sans son code source, expliquer le fonctionnement de la fonctionnalité, présenter les preuves et en construire une version pour votre projet.

REA connecte votre agent à des outils d'inspection de binaires natifs, d'applications JavaScript et Electron, d'assemblys .NET et de sites web. Les mêmes outils sont aussi disponibles depuis votre terminal. L'analyse s'exécute localement, et chaque conclusion s'accompagne des preuves et des limites sur lesquelles elle repose.

Setup enregistre REA auprès de votre agent et installe les instructions de workflow correspondantes. L'analyse native peut utiliser une installation existante de Hopper, de Ghidra, d'IDA ou de Kuna ; Setup peut aussi installer Hopper après votre accord. L'analyse statique JavaScript ne nécessite aucun moteur d'analyse natif.

> **[Visitez le site web de REA](https://rea.tools/fr/)** pour les instructions d'installation, des guides illustrés et des études de cas réelles.

## Démarrage rapide

Sous Linux, les lancements de Ghidra, JADX et des outils de firmware, ainsi que l’analyse statique JavaScript/Electron, nécessitent un `ps` compatible procps dans le `PATH` de REA pour vérifier la propriété des processus. Voir le prérequis Linux.

### Configurer votre agent

Une fois Node.js et npm installés, exécutez :

```bash
npx rea-agents setup
```

Choisissez vos agents, vérifiez les modifications proposées et approuvez-les. Setup ajoute le serveur MCP de REA et les instructions de workflow correspondantes, et sauvegarde la configuration existante. Redémarrez ensuite votre agent.

Setup prend en charge Claude Code, Codex, Cursor, Gemini CLI, Grok Build et [d'autres agents](../installation.md#supported-agents). Consultez [Installation et configuration](../installation.md) pour la configuration des fournisseurs et l'enregistrement MCP manuel.

MCP utilise par défaut des schémas d’entrée compacts. Pour les descriptions complètes des champs et de la validation imbriquée, définissez `REA_MCP_INPUT_SCHEMA_PROFILE=full` dans l’enregistrement MCP. Les deux profils conservent tous les outils et la même validation canonique du serveur ; voir le guide des contrats MCP.

### Interroger votre agent

```text
Comprends comment fonctionne la recherche dans l'app Notes, montre-moi les preuves
et construis une fonctionnalité similaire pour mon projet.
```

Remplacez Notes par votre application cible et la fonctionnalité que vous voulez comprendre.

### Utiliser le terminal

Inspectez le répertoire extrait ou l'archive ASAR d'une application JavaScript/Electron :

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Le résultat comprend les modules, les imports, les frontières Electron et les preuves associées. Remplacez le chemin par votre cible, par exemple `"D:/apps/example"` sous Windows.

Pour installer la commande `rea` pour un usage régulier :

```bash
npm install --global rea-agents
rea --help
```

Pour l'analyse native, configurez d'abord un fournisseur. Consultez le [guide CLI et Evidence](../cli.md) pour les commandes natives, le choix du fournisseur, les snapshots et l'utilisation dans des scripts.

### Mettre à jour REA

REA évolue rapidement, et les nouvelles versions apportent fréquemment des corrections de bugs. Maintenez votre installation à jour.

Pour une CLI installée avec `npm install --global` ou `bun add --global` :

```bash
rea update
```

`rea --update` est un alias de `rea update` avec les mêmes options globales de sortie. Les commandes de mise à jour conservent au plus 4 MiB de stdout/stderr au total. Les réponses de métadonnées trop grandes sont refusées à la fin ; les installations détaillées gardent des diagnostics bornés. La progression respecte la contre-pression du terminal et attend la fin des écritures soumises.

Les mises à jour globales avec Bun nécessitent Bun 1.2.17 ou une version ultérieure. Avec une version plus ancienne de Bun, mettez à jour Bun manuellement avant d'exécuter `rea update`.

Pour actualiser les enregistrements de vos agents et le skill, exécutez la commande setup affichée par la mise à jour.

Si vous utilisez `npx`, mettez à jour la configuration de votre agent avec :

```bash
npx rea-agents@latest setup
```

Vérifiez les modifications proposées par Setup et redémarrez votre agent. Pour des commandes CLI ponctuelles, utilisez `npx rea-agents@latest` suivi de la commande. Avec Bun, utilisez `bunx rea-agents@latest` à la place de `npx rea-agents@latest`.

## Comment fonctionne REA

Votre agent appelle REA via MCP pour inspecter la cible et suivre le code pertinent. REA renvoie ses constatations avec les preuves correspondantes. L'agent s'en sert pour poser des questions complémentaires, expliquer le comportement, ou écrire et tester une implémentation. Les commandes CLI utilisent les mêmes workflows.

![Flux d'investigation de REA : votre agent pose une question sur une cible locale, REA l'inspecte et la trace avec des outils d'analyse, et l'agent utilise le code, les références et les inconnues renvoyés pour expliquer, implémenter et tester.](../../website/public/assets/figures/rea-investigation-flow.svg)

[Ouvrir la figure en taille réelle](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## Ce que vous pouvez analyser

REA nécessite Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) ou 26+ (>=26.12.1), ainsi que npm. Les outils supplémentaires et les hôtes pris en charge dépendent de la cible :

| Cible                        | Ce que REA renvoie                                                                                          | Prérequis et guide                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Binaires natifs              | Pseudo-code, assembleur, chaînes, symboles, appels et références                                            | Hopper, Ghidra, IDA ou Kuna ; [analyse native](../native-investigation.md)                                                                |
| Structure ELF hors ligne     | Sections, segments, symboles et relocations d'origine, et protections statiques candidates                  | pwntools fourni par l'utilisateur sous Linux x64 ; [diagnostics binaires](../binary-diagnostics.md)                                       |
| PE certificates              | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                                | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                                   |
| PE imports                   | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                                  | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                             |
| Artefact WASM                | Validation, sections, formes WAT exactes d'import/export et WAT décodé                                      | WABT 1.0.42 fourni par l'utilisateur ; `inspect_wasm_artifact`                                                                            |
| Bytecode EVM                 | Sélecteurs de dispatch, offsets en octets, arguments inférés et mutabilité                                  | Fichier local brut ou hexadécimal sous Linux x64 ; [guide EVM hors ligne](../evm-bytecode.md)                                             |
| Rust binaries                | Embedded cargo-auditable dependency list                                                                    | [Rust binaries](../rust-binaries.md)                                                                                                      |
| ELF notes                    | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                                             | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                              |
| Linux kernel modules         | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                                 | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                                    |
| Erlang BEAM                  | IFF chunks, atoms, exports, and tables                                                                      | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                         |
| Apple IPS crashes            | .ips metadata, threads, images, registers and crash classes                                                 | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                             |
| Crashs Linux enregistrés     | Notes brutes, registres et signaux de chaque thread enregistré, et correspondances de mappings facultatives | pwntools fourni par l'utilisateur sous Linux x64 ; GDB/pwndbg en option ; [crashs enregistrés](../recorded-crashes.md)                    |
| Installations de bureau      | Environnements candidats, fichiers justificatifs, composants et étapes suivantes                            | Inspection bornée des répertoires et en-têtes；[Applications de bureau](../desktop-applications.md)                                       |
| JavaScript / Electron        | Modules, imports, source maps, routes, IPC et relations avec les modules natifs                             | Node.js et npm ; [analyse d'applications](../javascript-application-workflows.md); Linux: procps `ps`                                     |
| Sites web                    | Structure des pages, scripts, observations réseau et captures d'écran demandées                             | Un navigateur de la famille Chrome ; [analyse du navigateur](../browser-observation.md)                                                   |
| Captures réseau enregistrées | Requêtes, réponses, payloads exposés et emplacements dans le code source                                    | HAR / Fiddler Everywhere SAZ ; mitmdump sous Linux pour les captures mitmproxy natives ; [guide des captures](../web-network-captures.md) |
| Captures de paquets          | Points de terminaison, DNS, TLS SNI, distribution des protocoles et requêtes HTTP                           | tshark et capinfos fournis par l'appelant ; [guide pcap](../pcap-analysis.md)                                                             |
| Assemblys .NET               | Métadonnées, instructions CIL, dépendances natives déclarées et comparaisons de builds                      | Inspection statique ; [guide du code managé](../managed-code-analysis.md)                                                                 |
| PyInstaller                  | CArchive, PYZ, Python bytecode                                                                              | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                                     |
| APK Android                  | Déclarations du manifeste, classes, méthodes décompilées et références                                      | JADX headless et un JDK complet sous Linux/macOS/Windows x64 ; [guide Android](../android-analysis.md)                                    |
| Appareils Android            | Appareils, paquets, processus, journaux, dumps, captures d'écran et transferts d'APK/fichiers               | adb fourni par l'appelant (émulateur ou appareil) ; [guide ADB](../adb-device-analysis.md)                                                |
| Projets JEB                  | Unités de projet fournies par le moteur, condensés d'artefacts et pseudo-code de types/méthodes             | Un client JEB démarré par l'appelant servant MCP, sélectionné via REA_JEB_MCP_URL ; [guide JEB](../jeb-analysis.md)                       |
| Ressources Android           | Manifeste décodé, tables de chaînes, langues et faits de version                                            | Lanceur Apktool fourni par l'appelant ; [guide des ressources](../apktool-resource-analysis.md)                                           |
| Applications Flutter         | Empreinte de snapshot Dart, condensés de bibliothèques par ABI et provenance de build du moteur             | Aucune (analyse APK statique) ; [guide Flutter](../flutter-analysis.md)                                                                   |
| Firmware                     | Régions, résultats d'extraction et passage de relais vers l'analyse native                                  | Binwalk / Unblob sous Linux ; [guide firmware](../firmware-analysis.md)                                                                   |
| Paquets enregistrés          | Champs sélectionnés, valeurs répétées, filtres et règles de décodage                                        | Linux: TShark 4.x + prlimit; [guide des captures](../packet-captures.md)                                                                  |
| Signaux logiques enregistrés | Annotations du décodeur, plages d’échantillons et diagnostics                                               | Linux: sigrok-cli 0.7.2 + prlimit; [guide des signaux](../signal-recordings.md)                                                           |
| Paquets et ressources        | Inventaires de fichiers, empreintes, plists, anatomie des bundles Apple et ressources extraites             | [Guide artefacts et JavaScript](../javascript-artifact-reconstruction.md), [applications Apple](../apple-application-analysis.md)         |
| Comportement des processus   | Sortie du terminal, interactions, code de sortie, observations du système de fichiers et comparaisons       | Linux/macOS avec un PTY natif ; [capture de processus](../process-capture.md)                                                             |
| Binaires Go                  | Version du compilateur embarquée, modules, remplacements et paramètres de compilation                       | Inspection statique intégrée ELF/PE/thin Mach-O; Aucune installation de Go nécessaire                                                     |
| Bases SQLite                 | Tables, colonnes, index, vues, déclencheurs et lignes sélectionnées de tables ordinaires                    | Instantané local base/WAL ; Node.js 24.x >=24.15 ou 26+ avec limites SQLite natives                                                       |
| Objets de code GPU           | Cibles CUDA/HIP, paramètres et ressources de noyaux sélectionnés, texte PTX conservé                        | Inspection statique intégrée ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                       |
| Fichiers de modèles          | Métadonnées GGUF / safetensors, déclarations de tenseurs et totaux dérivés                                  | Lecture des en-têtes ; empreinte complète facultative; [GGUF / safetensors](../model-artifacts.md)                                        |
| Métadonnées IL2CPP           | Images d’assemblages Unity global-metadata.dat, noms de types/méthodes et plages d’index                    | Décodage statique des versions 24, 27, 29, 31, 39 ; sans Unity                                                                            |
| Godot PCK                    | Inventaire et extraction d’archive, en-têtes/répertoires originaux et identités des contenus sélectionnés   | Formats statiques 2, 3, 4 ; sans Godot                                                                                                    |
| Signatures APK               | Signataires v1/v2/v3/v3.1, empreintes de certificats, rotation des clés et cohérence interne des condensats | Inspection statique intégrée; `inspect_apk_signature`                                                                                     |

L'inspection statique JavaScript et .NET lit les fichiers fournis sans exécuter l'application. La capture à l'exécution lance la cible choisie ou interagit avec elle avec vos permissions utilisateur ; chaque guide d'exécution décrit ses effets.

Pour inspecter les binaires natifs hors ligne, REA prend aussi en charge GNU objdump et Rizin, que vous devez fournir vous-même. Le [guide des outils de rétro-ingénierie](../reverse-engineering-tools.md) décrit la configuration des fournisseurs, les commandes CLI et les limites des Evidence. REA n’installe ni ne met à jour ces deux fournisseurs.

<a id="choosing-a-deep-analysis-provider"></a>

Les formats natifs et les hôtes pris en charge varient selon le fournisseur. Consultez [la configuration de Hopper et Ghidra](../installation.md#hopper), le [guide IDA](../ida-provider.md), [Kuna](../kuna-provider.md) et [la prise en charge expérimentale de Ghidra sous Windows](../windows-ghidra-p0.md). Ghidra prend aussi en charge [l'analyse DOS 16 bits](../ghidra-dos.md). Pour les gros binaires, augmentez son délai de démarrage avec `REA_GHIDRA_STARTUP_TIMEOUT_MS` / `REA_HOPPER_STARTUP_TIMEOUT_MS`. Pour le choix du fournisseur, consultez le [guide CLI](../cli.md#choose-a-provider). Vérifiez la [disponibilité dans les versions publiées](../installation.md#released-package-and-main) pour les fonctionnalités ajoutées depuis la dernière version npm.

## Études de cas

<a href="https://rea.tools/fr/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="Illustrations des études sur la spatialisation sonore de DX-Ball, le pont du presse-papiers de Notion et le cercle de projectiles de TH04" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball : reconstruire un calcul de panoramique sonore

Suivez un appel sonore jusqu'à la fonction qui convertit une position en panoramique, inspectez ses instructions et transformez un pseudo-code incomplet en C. La reconstruction réussit 3 205 cas issus du x86 d'origine et reproduit à l'identique les 63 octets de la fonction compilée.

[Lire l'étude de cas](https://rea.tools/fr/showcase/dx-ball/) · [Dépôt de la reconstruction](https://github.com/N0zoM1z0/dx-ball)

### Notion : suivre le pont du presse-papiers d'Electron

Trouvez l'API de presse-papiers du renderer, suivez-la à travers le preload et l'IPC jusqu'au processus principal, puis inspectez le format de presse-papiers enrichi.

[Lire l'étude de cas](https://rea.tools/fr/showcase/notion/)

### TH04 : retrouver un calcul d'anneau de projectiles sous DOS

Inspectez les instructions 16 bits du jeu PC-98 d'origine, retrouvez les calculs d'angles fixes et visés, et comparez le C++ reconstruit avec la sortie du compilateur d'époque.

[Lire l'étude de cas](https://rea.tools/fr/showcase/th04/) · [Dépôt de la reconstruction](https://github.com/N0zoM1z0/th04)

### Créer des environnements RL avec REA

Enregistrez une session d’application web, transformez son API en outils et exportez un environnement utilisable par un agent IA. Exécutez-le avec AgentEnv, puis ajoutez des tâches et des vérifications de récompense pour l’entraînement RL ou l’évaluation.

[Guide de création d’un environnement](https://rea.tools/guides/rl-environments/) ·
[Voir la démo sur X](https://x.com/reatools/status/2112574822584918075?s=20)

Si vous avez utilisé REA sur un projet intéressant, nous serions ravis de le découvrir. Partagez votre cas dans une [issue](https://github.com/morluto/rea/issues) ou une [pull request](https://github.com/morluto/rea/pulls), en précisant la cible, votre question, la manière dont REA vous a aidé et ce que vous avez découvert.

<a id="build-rl-environments"></a>

## Créer des environnements RL

Créez un environnement local où un agent IA peut s’exercer à des tâches comme trouver un ticket ou créer un dossier, sans exécuter l’application d’origine. Utilisez-le pour l’apprentissage par renforcement (RL) ou pour tester la capacité d’un agent à accomplir des tâches.

REA transforme les requêtes et réponses API enregistrées en outils que l’agent peut appeler. L’environnement utilise les données enregistrées et ne prend en charge des modifications que si l’enregistrement confirme leurs effets.

Configurez REA dans votre agent, puis adaptez l’URL et les tâches sur les dossiers à votre application :

```text
Utilise REA pour créer un environnement RL à partir de mon application web de test à
http://127.0.0.1:3000.
Couvre la liste, la création, le renommage et la suppression de dossiers.
Tu peux créer et supprimer des dossiers de test. Ne modifie pas les données existantes.
Enregistre-le dans un dossier nommé my-env, vérifie les opérations disponibles et explique-moi comment le lancer.
```

<details>
<summary>Utiliser la ligne de commande</summary>

Utilisez ces commandes si vous disposez déjà d’un fichier contenant les requêtes et réponses de l’application enregistrées dans le navigateur. L’exécution du résultat nécessite aussi AgentEnv et Docker.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA exporte un environnement exécutable avec un test de base qui vérifie qu’il démarre et répond. Utilisez-le avec votre framework RL pour définir les objectifs, ajouter les vérifications de récompense et lancer l’entraînement.

[Guide de création d’un environnement](https://rea.tools/guides/rl-environments/) ·
[Référence des environnements](../agent-environments.md) ·
[Voir la démo sur X](https://x.com/reatools/status/2112574822584918075?s=20)

## Questions fréquentes

<details>
<summary><strong>Quels agents peuvent utiliser REA ?</strong></summary>

Tout agent compatible avec les serveurs MCP locaux. Setup configure les [agents pris en charge](../installation.md#supported-agents) ; les autres clients peuvent utiliser [l'enregistrement MCP manuel](../installation.md#mcp-registry).

</details>

<details>
<summary><strong>Ai-je besoin de Hopper, Ghidra, IDA ou Kuna ?</strong></summary>

L'analyse native approfondie utilise l'un d'eux. L'inspection statique JavaScript et .NET fonctionne sans moteur d'analyse native. Setup peut installer Hopper après votre accord ; Ghidra, IDA et Kuna utilisent vos installations existantes. Consultez [la configuration des fournisseurs](../installation.md#hopper).

</details>

<details>
<summary><strong>Dois-je lancer Hopper au préalable ?</strong></summary>

REA lance Hopper lorsqu'une opération en a besoin. Sous macOS, une boîte de dialogue de premier lancement peut vous demander de choisir le mode démo ou d'activer votre licence. Consultez [Démarrage et dépannage de Hopper](../installation.md#launcher-paths-and-troubleshooting).

</details>

<details>
<summary><strong>Que fait l'installation du skill depuis skills.sh ?</strong></summary>

Le skill fournit des instructions d'investigation à votre agent. Utilisez `npx rea-agents setup` pour enregistrer le serveur MCP de REA et installer les instructions correspondantes, puis redémarrez votre agent. Consultez [l'installation du skill seul](../installation.md#skill-only-installation).

</details>

<details>
<summary><strong>Quel code REA renvoie-t-il ?</strong></summary>

L'analyse native renvoie du pseudo-code et de l'assembleur. L'analyse JavaScript/Electron récupère les modules et leurs relations. Votre agent s'appuie sur ces résultats pour écrire et tester une implémentation ; les [études de cas](#études-de-cas) en donnent des exemples concrets.

</details>

<details>
<summary><strong>REA envoie-t-il mon application en ligne ?</strong></summary>

REA analyse les cibles localement. Votre agent reçoit les résultats des outils, et son fournisseur de modèle applique sa propre politique de données.

</details>

<details>
<summary><strong>Que faire si je rencontre un bug ?</strong></summary>

Commencez par mettre à jour ; une version récente l'a peut-être déjà corrigé.

Pour une CLI installée avec `npm install --global` ou `bun add --global` :

```bash
rea update
```

Pour une configuration d'agent via `npx` :

```bash
npx rea-agents@latest setup
```

Si vous utilisez un agent, terminez l'[actualisation de la configuration](#mettre-à-jour-rea) et redémarrez-le. Relancez la même tâche. Si le problème persiste, [ouvrez une issue](https://github.com/morluto/rea/issues) en indiquant votre version de REA, le type de cible, les étapes pour reproduire le problème et la sortie d'erreur.

</details>

## Documentation

Commencez par les [guides pas à pas](https://rea.tools/fr/guides/) du site web. Pour les options exactes, les prérequis et les contrats de résultats :

- [Installation et configuration](../installation.md) : enregistrement des agents, configuration des fournisseurs, mises à jour et désinstallation.
- [Vérification et dépannage](../installation.md#check-readiness-for-your-task) : diagnostiquer un agent ou un moteur d'analyse donné.
- [CLI et Evidence](../cli.md) : commandes, choix du fournisseur, snapshots, import/export et codes de sortie.
- [Contrats MCP](../mcp-contracts.md) et [prompts pour agents](../mcp-prompts.md) : résultats des outils, sessions et investigations guidées.
- [Catalogue des outils](../mcp-contracts.md#generated-catalog) : inventaire des outils, fournisseurs et commandes CLI, généré lors du build.
- [Feuille de route](../roadmap.md) : travaux prévus et suivi des capacités.

Signalez les vulnérabilités via [SECURITY.md](../../SECURITY.md).

## Historique des étoiles

🎉 **400 000 étoiles GitHub — merci !**

Merci à toutes les personnes qui utilisent REA, signalent des bugs, proposent des fonctionnalités, testent les builds et contribuent des correctifs.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="Historique des étoiles GitHub de REA" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Avertissement

Consultez [DISCLAIMER.md](../../DISCLAIMER.md) pour les consignes d'utilisation responsable.

REA est destiné à la recherche, à l’éducation, à l’interopérabilité, à la préservation logicielle et à l’analyse de logiciels que vous possédez ou êtes autorisé à examiner, dans le respect de la loi.

The project's position on illegal or unauthorized use covers all REA
versions, distribution channels, and platforms; each copy retains its
applicable licenses.

## Contribuer

Votre aide sur REA est la bienvenue ! [Ouvrez une issue](https://github.com/morluto/rea/issues) pour signaler un bug ou proposer une fonctionnalité, ou [envoyez une pull request](https://github.com/morluto/rea/pulls) pour améliorer le code ou la documentation.

Consultez [CONTRIBUTING.md](../../CONTRIBUTING.md) pour l'environnement de développement et les vérifications, la page [tests](../testing.md) pour les procédures de vérification, et la [carte de l'architecture](../architecture.mermaid) pour la structure du projet.

## Licence

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
