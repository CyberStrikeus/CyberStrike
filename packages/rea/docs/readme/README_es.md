<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · **Español** · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md)
· [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

# REA: Ingeniería inversa de cualquier cosa

### Un solo MCP para la ingeniería inversa de binarios, aplicaciones y comportamiento en ejecución.

**¿Ves una función que te gusta? Entiende cómo funciona, hasta el nivel binario.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](../mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#current-status)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](../../LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Sitio web](https://rea.tools/es/) · [Guías](https://rea.tools/es/guides/) · [Casos prácticos](https://rea.tools/es/showcase/)**

[Inicio rápido](#inicio-rápido) · [Cómo funciona REA](#cómo-funciona-rea) · [Qué puedes analizar](#qué-puedes-analizar) · [Casos prácticos](#casos-prácticos) · [Crear entornos de RL](#build-rl-environments) · [Preguntas frecuentes](#preguntas-frecuentes) · [Documentación](#documentación)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> Fuentes oficiales de REA: [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/), [rea-agents](https://www.npmjs.com/package/rea-agents) (npm).
> Usa los enlaces de instalación y de versiones publicados en estas fuentes oficiales. Un nombre de repositorio parecido o un README copiado no demuestra que una descarga sea oficial.

<div align="center">

<br />

<img src="../assets/rea-hopper-analysis.png" alt="REA inicia su puente de análisis dentro de Hopper mientras inspecciona un binario nativo" width="1200" />

<br /><br />

<table aria-label="Comunidad REA">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="../assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Únete a la comunidad de ingeniería inversa</strong>
  </a><br />
  <sub>Discord · Preguntas y respuestas · Comparte tus resultados</sub>
</td>
</tr>
</table>

<br />

</div>

---

¿Has visto una función en una aplicación que quieres incorporar a tu producto? Pide a tu agente que la investigue con REA. Puede inspeccionar la aplicación sin su código fuente, explicar cómo funciona la función, mostrar las pruebas y crear una versión para tu proyecto.

REA conecta tu agente con herramientas para inspeccionar binarios nativos, aplicaciones JavaScript y Electron, ensamblados .NET y sitios web. También puedes usar las mismas herramientas desde la terminal. El análisis se ejecuta localmente y los resultados incluyen las pruebas y limitaciones que sustentan cada conclusión.

La configuración registra REA con tu agente e instala las instrucciones de trabajo correspondientes. El análisis nativo puede usar Hopper, Ghidra, IDA o Kuna ya instalados; la configuración puede instalar Hopper con tu aprobación. El análisis estático de JavaScript no requiere un motor de análisis nativo.

> **[Visita el sitio web de REA](https://rea.tools/es/)** para encontrar instrucciones de configuración, guías ilustradas y casos reales.

## Inicio rápido

En Linux, iniciar Ghidra, JADX y herramientas de firmware, y analizar JavaScript/Electron estáticamente, requiere un `ps` compatible con procps en el `PATH` de REA para comprobar la propiedad de los procesos. Consulta el requisito de Linux.

### Configura tu agente

Con Node.js y npm instalados, ejecuta:

```bash
npx rea-agents setup
```

Elige tus agentes, revisa los cambios propuestos y apruébalos. La configuración añade el servidor MCP de REA y las instrucciones de trabajo correspondientes, con copias de seguridad de la configuración existente. Reinicia tu agente al terminar.

La configuración admite Claude Code, Codex, Cursor, Gemini CLI, Grok Build y [otros agentes](../installation.md#supported-agents). Consulta [instalación y configuración](../installation.md) para configurar proveedores y registrar MCP manualmente.

MCP usa esquemas de entrada compactos por defecto. Para ver todas las instrucciones de campos y la validación anidada, establece `REA_MCP_INPUT_SCHEMA_PROFILE=full` en el registro MCP. Ambos perfiles conservan todas las herramientas y la misma validación canónica del servidor; consulta la guía de contratos MCP.

### Pregunta a tu agente

```text
Investiga cómo funciona la búsqueda en la aplicación Notes, muéstrame las pruebas y crea una función similar para mi proyecto.
```

Sustituye Notes por la aplicación objetivo y especifica la función que quieres entender.

### Usa la terminal

Inspecciona un directorio extraído de una aplicación JavaScript/Electron o un archivo ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

El resultado incluye módulos, importaciones, límites de Electron y sus pruebas. Sustituye la ruta por la de tu objetivo, por ejemplo `"D:/apps/example"` en Windows.

Para instalar el comando `rea` y usarlo habitualmente:

```bash
npm install --global rea-agents
rea --help
```

Para el análisis nativo, configura primero un proveedor. Consulta la [guía de CLI y Evidence](../cli.md) para los comandos nativos, la selección de proveedores, las instantáneas y el uso en scripts.

### Actualiza REA

REA cambia rápidamente y las nuevas versiones incluyen correcciones frecuentes. Mantén tu instalación actualizada.

Para una CLI instalada mediante `npm install --global` / `bun add --global`:

```bash
rea update
```

`rea --update` es un alias de `rea update` con las mismas opciones globales de salida. Los comandos de actualización conservan como máximo 4 MiB de stdout/stderr combinados. Los metadatos demasiado grandes se rechazan al terminar; las instalaciones detalladas conservan diagnósticos acotados. El progreso respeta la contrapresión del terminal y espera las escrituras enviadas.

Las actualizaciones globales con Bun requieren Bun 1.2.17 o posterior. Actualiza manualmente las versiones anteriores antes de ejecutar `rea update`.

Para actualizar los registros de tus agentes y la skill, ejecuta el comando de configuración que muestra la actualización.

Si usas `npx`, actualiza la configuración de tu agente con:

```bash
npx rea-agents@latest setup
```

Revisa los cambios de configuración y reinicia tu agente. Para ejecutar comandos de CLI puntuales, usa `npx rea-agents@latest` seguido del comando.

Con Bun, usa `bunx rea-agents@latest` en lugar de `npx rea-agents@latest`.

## Cómo funciona REA

Tu agente llama a REA mediante MCP para inspeccionar el objetivo y seguir el código relevante. REA devuelve los hallazgos junto con sus pruebas. El agente los utiliza para hacer preguntas de seguimiento, explicar el comportamiento o escribir y probar una implementación. Los comandos de CLI usan los mismos flujos de trabajo.

![Flujo de investigación de REA: tu agente pregunta sobre un objetivo local, REA lo inspecciona y rastrea con herramientas de análisis, y el agente utiliza el código, las referencias y los aspectos desconocidos devueltos para explicar, implementar y probar.](../../website/public/assets/figures/rea-investigation-flow.svg)

[Abre la figura a tamaño completo](../../website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## Qué puedes analizar

REA requiere Node.js 22.x (>=22.23.4), 24.x (>=24.22.1) o 26+ (>=26.12.1), además de npm. Las herramientas adicionales y los sistemas anfitriones compatibles dependen del objetivo:

| Objetivo                    | Qué devuelve REA                                                                                                               | Requisitos y guía                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Binarios nativos            | Pseudocódigo, ensamblador, cadenas, símbolos, llamadas y referencias                                                           | Hopper, Ghidra, IDA o Kuna; [análisis nativo](../native-investigation.md)                                                                    |
| Estructura ELF sin ejecutar | Secciones, segmentos, símbolos/reubicaciones originales y posibles medidas de mitigación detectadas mediante análisis estático | pwntools proporcionado por quien llama, en Linux x64; [diagnóstico de binarios](../binary-diagnostics.md)                                    |
| PE certificates             | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                                                   | Built-in static PE inspection; [PE certificates](../pe-certificates.md)                                                                      |
| PE imports                  | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                                                     | Built-in static PE inspection; [PE imports](../pe-imports.md)                                                                                |
| Bytecode EVM                | Selectores de despacho, desplazamientos en bytes, argumentos inferidos y mutabilidad                                           | Entrada local con bytes sin procesar o representación hexadecimal, en Linux x64; [guía de EVM sin ejecutar](../evm-bytecode.md)              |
| Rust binaries               | Embedded cargo-auditable dependency list                                                                                       | [Rust binaries](../rust-binaries.md)                                                                                                         |
| ELF notes                   | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                                                                | Built-in static ELF inspection; [ELF notes](../elf-notes.md)                                                                                 |
| Linux kernel modules        | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                                                    | Built-in static ELF inspection; [kernel modules](../kernel-modules.md)                                                                       |
| Erlang BEAM                 | IFF chunks, atoms, exports, and tables                                                                                         | Built-in static BEAM inspection; [Erlang BEAM](../erlang-beam.md)                                                                            |
| Apple IPS crashes           | .ips metadata, threads, images, registers and crash classes                                                                    | Built-in static JSON inspection; [Apple IPS](../apple-ips.md)                                                                                |
| Fallos de Linux registrados | Registros note sin procesar, registros/señales de cada hilo registrado y posibles correspondencias de memoria opcionales       | pwntools proporcionado por quien llama, en Linux x64; GDB/pwndbg opcionales; [fallos registrados](../recorded-crashes.md)                    |
| Instalaciones de escritorio | Posibles entornos de ejecución, archivos de evidencia, componentes y siguientes pasos                                          | Inspección acotada de directorios y cabeceras；[Aplicaciones de escritorio](../desktop-applications.md)                                      |
| JavaScript / Electron       | Módulos, importaciones, mapas de código fuente, rutas, IPC y relaciones con complementos nativos                               | Node.js y npm; [análisis de aplicaciones](../javascript-application-workflows.md); Linux: procps `ps`                                        |
| Sitios web                  | Estructura de la página, scripts, observaciones de red y capturas de pantalla solicitadas                                      | Un navegador de la familia Chrome; [análisis del navegador](../browser-observation.md)                                                       |
| Capturas de red guardadas   | Solicitudes, respuestas, contenido accesible de las cargas útiles y ubicaciones de origen                                      | HAR / Fiddler Everywhere SAZ; mitmdump en Linux para capturas en formato nativo de mitmproxy; [guía de capturas](../web-network-captures.md) |
| Capturas de paquetes        | Endpoints, DNS, TLS SNI, distribución de protocolos y solicitudes HTTP                                                         | tshark y capinfos suministrados por el autor de la llamada; [guía pcap](../pcap-analysis.md)                                                 |
| Ensamblados .NET            | Metadatos, instrucciones CIL, dependencias nativas declaradas y comparaciones de compilaciones                                 | Inspección estática; [guía de código administrado](../managed-code-analysis.md)                                                              |
| PyInstaller                 | CArchive, PYZ, Python bytecode                                                                                                 | Static inspection; [Python packaged applications](../python-packaged-applications.md)                                                        |
| APK de Android              | Declaraciones del manifiesto, clases, métodos descompilados y referencias                                                      | JADX sin interfaz gráfica y un JDK completo en Linux/macOS/Windows x64; [guía de Android](../android-analysis.md)                            |
| Dispositivos Android        | Dispositivos, paquetes, procesos, registros, volcados, capturas de pantalla y transferencias de APK/archivos                   | adb suministrado por el autor de la llamada (emulador o dispositivo); [guía de ADB](../adb-device-analysis.md)                               |
| Proyectos JEB               | Unidades de proyecto del motor, resúmenes de artefactos y pseudocódigo de tipos/métodos                                        | Un cliente JEB iniciado por el autor de la llamada que sirve MCP, seleccionado con REA_JEB_MCP_URL; [guía de JEB](../jeb-analysis.md)        |
| Recursos de Android         | Manifiesto decodificado, tablas de cadenas, idiomas y datos de versión                                                         | Lanzador de Apktool suministrado por el autor de la llamada; [guía de recursos](../apktool-resource-analysis.md)                             |
| Aplicaciones Flutter        | Hash de snapshot de Dart, resúmenes de bibliotecas por ABI y procedencia de compilación del motor                              | Ninguna (análisis APK estático); [guía de Flutter](../flutter-analysis.md)                                                                   |
| Firmware                    | Regiones, resultados de extracción y derivaciones al análisis nativo                                                           | Binwalk / Unblob en Linux; [guía de firmware](../firmware-analysis.md)                                                                       |
| Paquetes grabados           | Campos seleccionados, valores repetidos, filtros y reglas de decodificación                                                    | Linux: TShark 4.x + prlimit; [guía de capturas](../packet-captures.md)                                                                       |
| Señales lógicas grabadas    | Anotaciones del decodificador, rangos de muestras y diagnósticos                                                               | Linux: sigrok-cli 0.7.2 + prlimit; [guía de señales](../signal-recordings.md)                                                                |
| Paquetes y recursos         | Inventarios de archivos, resúmenes criptográficos, plists, estructura de paquetes de Apple y recursos extraídos                | [Guía de artefactos y JavaScript](../javascript-artifact-reconstruction.md), [aplicaciones de Apple](../apple-application-analysis.md)       |
| Comportamiento de procesos  | Salida de la terminal, interacciones, observaciones de salida y del sistema de archivos, y comparaciones entre ejecuciones     | Linux/macOS con una PTY nativa; [captura de procesos](../process-capture.md)                                                                 |
| Binarios Go                 | Versión del compilador integrada, módulos, reemplazos y ajustes de compilación                                                 | Inspección estática integrada ELF/PE/thin Mach-O; No requiere instalar Go                                                                    |
| Bases de datos SQLite       | Tablas, columnas, índices, vistas, disparadores y filas seleccionadas de tablas ordinarias                                     | Instantánea local de base/WAL; Node.js 24.x >=24.15 o 26+ con límites nativos de SQLite                                                      |
| Objetos de código GPU       | Destinos CUDA/HIP, parámetros y recursos de kernels seleccionados, texto PTX conservado                                        | Inspección estática integrada ELF/PE/fatbin/CUBIN/PTX; [GPU](../gpu-code-objects.md)                                                         |
| Archivos de modelos         | Metadatos GGUF / safetensors, declaraciones de tensores y totales derivados                                                    | Inspección de cabeceras; hash completo opcional; [GGUF / safetensors](../model-artifacts.md)                                                 |
| Metadatos IL2CPP            | Imágenes de ensamblado Unity global-metadata.dat, nombres de tipos/métodos y rangos de índices                                 | Decodificación estática de versiones 24, 27, 29, 31, 39; sin Unity                                                                           |
| Godot PCK                   | Inventario y extracción, cabeceras/directorios originales e identidad del contenido seleccionado                               | Formatos estáticos 2, 3, 4; sin Godot                                                                                                        |
| Artefactos WASM             | Validación, secciones, formas WAT exactas de importación/exportación y WAT decodificado                                        | Aportado por quien llama WABT 1.0.42; `inspect_wasm_artifact`                                                                                |
| Firmas APK                  | Firmantes v1/v2/v3/v3.1, huellas de certificados, rotación de claves y coherencia interna de resúmenes                         | Inspección estática integrada; `inspect_apk_signature`                                                                                       |

La inspección estática de JavaScript y .NET lee los archivos suministrados sin ejecutar la aplicación. La captura en ejecución inicia el objetivo seleccionado o interactúa con él con los permisos de tu usuario; cada guía describe sus efectos.

Para inspeccionar binarios nativos sin conexión, REA también admite GNU objdump y Rizin, que debes proporcionar por tu cuenta. La [guía de herramientas de ingeniería inversa](../reverse-engineering-tools.md) explica la configuración de los proveedores, los comandos de la CLI y las limitaciones de Evidence. REA no instala ni actualiza ninguno de estos proveedores.

<a id="choosing-a-deep-analysis-provider"></a>

Para binarios grandes, aumenta el plazo de inicio mediante `REA_GHIDRA_STARTUP_TIMEOUT_MS` o `REA_HOPPER_STARTUP_TIMEOUT_MS`.

Los formatos nativos y los sistemas anfitriones compatibles varían según el proveedor. Consulta [configuración de Hopper y Ghidra](../installation.md#hopper), la [guía de IDA](../ida-provider.md), [Kuna](../kuna-provider.md) y la [compatibilidad experimental de Ghidra en Windows](../windows-ghidra-p0.md). Ghidra también admite [análisis de DOS de 16 bits](../ghidra-dos.md). Para elegir un proveedor, consulta la [guía de CLI](../cli.md#choose-a-provider). Comprueba la [disponibilidad por versión](../installation.md#released-package-and-main) de las funciones añadidas después de la última versión publicada en npm.

## Casos prácticos

<a href="https://rea.tools/es/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/rea-showcases-dark.svg" />
    <img alt="Ilustraciones de los casos de panoramización de sonido de DX-Ball, el puente del portapapeles de Notion y el anillo de proyectiles de TH04" src="../assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: reconstruir un cálculo de panoramización de sonido

Sigue una llamada de sonido hasta la función auxiliar que convierte la posición en panoramización, inspecciona las instrucciones y transforma el pseudocódigo incompleto en C. La reconstrucción supera 3.205 casos con el x86 original y reproduce los 63 bytes de la función compilada.

[Lee el caso práctico](https://rea.tools/es/showcase/dx-ball/) · [Repositorio de reconstrucción](https://github.com/N0zoM1z0/dx-ball)

### Notion: seguir el puente del portapapeles de Electron

Encuentra la API del portapapeles del proceso de renderizado, síguela a través de preload e IPC hasta el proceso principal e inspecciona el formato enriquecido del portapapeles.

[Lee el caso práctico](https://rea.tools/es/showcase/notion/)

### TH04: recuperar el cálculo de un anillo de proyectiles en DOS

Inspecciona las instrucciones de 16 bits del juego original para PC-98, recupera los cálculos de ángulos fijos y dirigidos, y compara el C++ reconstruido con la salida del compilador de la época.

[Lee el caso práctico](https://rea.tools/es/showcase/th04/) · [Repositorio de reconstrucción](https://github.com/N0zoM1z0/th04)

### Crear entornos de RL con REA

Graba una sesión de una aplicación web, convierte su API en herramientas y exporta un entorno que un agente de IA pueda usar. Ejecútalo con AgentEnv y añade tareas y comprobaciones de recompensa para entrenamiento RL o evaluación.

[Guía para crear un entorno](https://rea.tools/guides/rl-environments/) ·
[Ver la demo en X](https://x.com/reatools/status/2112574822584918075?s=20)

Si has usado REA para investigar algo interesante, nos gustaría verlo. Comparte tu caso en una [issue](https://github.com/morluto/rea/issues) o una [pull request](https://github.com/morluto/rea/pulls), incluyendo el objetivo, tu pregunta, cómo te ayudó REA y qué encontraste.

<a id="build-rl-environments"></a>

## Crear entornos de RL

Crea un entorno local donde un agente de IA pueda practicar tareas como buscar un issue o crear una carpeta, sin ejecutar la aplicación original. Úsalo para aprendizaje por refuerzo (RL) o para comprobar cómo completa las tareas un agente.

REA convierte las solicitudes y respuestas de API grabadas en herramientas que el agente puede llamar. El entorno usa los datos grabados y solo admite cambios cuyos efectos confirma la grabación.

Configura REA en tu agente y sustituye la URL y las tareas de carpetas del ejemplo por las tuyas:

```text
Usa REA para crear un entorno de RL a partir de mi aplicación web de prueba en
http://127.0.0.1:3000.
Incluye listar, crear, renombrar y borrar carpetas. Puedes crear y borrar
carpetas de prueba, pero no modifiques los datos existentes.
Guárdalo en una carpeta llamada my-env, comprueba qué operaciones funcionan y dime cómo ejecutarlo.
```

<details>
<summary>Usar la línea de comandos</summary>

Usa estos comandos si ya tienes un archivo con las solicitudes y respuestas de la aplicación grabadas en el navegador. Para ejecutar el resultado también necesitas AgentEnv y Docker.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA exporta un entorno ejecutable con una prueba básica que comprueba que arranca y responde. Úsalo con tu framework de RL para definir objetivos, añadir comprobaciones de recompensa y ejecutar el entrenamiento.

[Guía para crear un entorno](https://rea.tools/guides/rl-environments/) ·
[Referencia de entornos](../agent-environments.md) ·
[Ver la demo en X](https://x.com/reatools/status/2112574822584918075?s=20)

## Preguntas frecuentes

<details>
<summary><strong>¿Qué agentes pueden usar REA?</strong></summary>

Cualquier agente que admita servidores MCP locales. La configuración prepara los [agentes compatibles](../installation.md#supported-agents); otros clientes pueden usar el [registro manual de MCP](../installation.md#mcp-registry).

</details>

<details>
<summary><strong>¿Necesito Hopper, Ghidra, IDA o Kuna?</strong></summary>

El análisis nativo en profundidad utiliza uno de ellos. La inspección estática de JavaScript y .NET funciona sin un motor de análisis nativo. La configuración puede instalar Hopper después de tu aprobación; Ghidra, IDA y Kuna usan las instalaciones que ya tienes. Consulta [configuración de proveedores](../installation.md#hopper).

</details>

<details>
<summary><strong>¿Tengo que iniciar Hopper primero?</strong></summary>

REA inicia Hopper cuando una operación lo necesita. En macOS, puede aparecer un diálogo al iniciarlo por primera vez para elegir el modo de demostración o activar tu licencia. Consulta [inicio de Hopper y resolución de problemas](../installation.md#launcher-paths-and-troubleshooting).

</details>

<details>
<summary><strong>¿Qué hace la instalación de la skill desde skills.sh?</strong></summary>

La skill proporciona instrucciones de investigación a tu agente. Usa `npx rea-agents setup` para registrar el servidor MCP de REA e instalar las instrucciones correspondientes; después reinicia tu agente. Consulta [instalación solo de la skill](../installation.md#skill-only-installation).

</details>

<details>
<summary><strong>¿Qué código devuelve REA?</strong></summary>

El análisis nativo devuelve pseudocódigo y ensamblador. El análisis de JavaScript/Electron recupera módulos y sus relaciones. Tu agente utiliza estos hallazgos para escribir y probar una implementación; los [casos prácticos](#casos-prácticos) ofrecen ejemplos completos.

</details>

<details>
<summary><strong>¿REA sube mi aplicación?</strong></summary>

REA analiza los objetivos localmente. Tu agente recibe los resultados de las herramientas, y su proveedor de modelos tiene su propia política de datos.

</details>

<details>
<summary><strong>¿Qué debo hacer si encuentro un error?</strong></summary>

Actualiza primero; una versión reciente puede haber solucionado el problema.

Para una CLI instalada mediante npm:

```bash
rea update
```

Para configurar el agente mediante `npx`:

```bash
npx rea-agents@latest setup
```

Si usas un agente, completa la [actualización de la configuración](#actualiza-rea) y reinícialo. Repite la misma tarea. Si el problema continúa, [abre una issue](https://github.com/morluto/rea/issues) con tu versión de REA, el tipo de objetivo, los pasos para reproducirlo y la salida del error.

</details>

## Documentación

Empieza con las [guías prácticas](https://rea.tools/es/guides/) del sitio web. Para opciones exactas, requisitos y contratos de resultados:

- [Instalación y configuración](../installation.md): registro de agentes, configuración de proveedores, actualizaciones y desinstalación.
- [Preparación y resolución de problemas](../installation.md#check-readiness-for-your-task): diagnóstico de un agente o motor de análisis concreto.
- [CLI y Evidence](../cli.md): comandos, selección de proveedores, instantáneas, importación/exportación y estados de salida.
- [Contratos de MCP](../mcp-contracts.md) y [prompts para agentes](../mcp-prompts.md): resultados de herramientas, sesiones e investigaciones guiadas.
- [Catálogo de herramientas](../mcp-contracts.md#generated-catalog): inventario de herramientas, proveedores y comandos de CLI generado durante la compilación.
- [Hoja de ruta](../roadmap.md): trabajo previsto y seguimiento de capacidades.

Informa de vulnerabilidades siguiendo [SECURITY.md](../../SECURITY.md).

## Historial de estrellas

🎉 **400.000 estrellas en GitHub: ¡gracias!**

Gracias a quienes usan REA, informan de errores, solicitan funciones, prueban compilaciones y contribuyen con correcciones.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="Historial de estrellas de REA en GitHub" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Aviso legal

Consulta [DISCLAIMER.md](../../DISCLAIMER.md) para obtener orientación sobre el uso responsable.

REA está destinado a la investigación, la educación, la interoperabilidad, la preservación de software y el análisis de software propio o autorizado, dentro de la ley.

The project's position on illegal or unauthorized use covers all REA
versions, distribution channels, and platforms; each copy retains its
applicable licenses.

## Contribuir

¡Nos encantaría que ayudaras con REA! [Abre una issue](https://github.com/morluto/rea/issues) para comunicar un error o proponer una función, o [envía una pull request](https://github.com/morluto/rea/pulls) para mejorar el código o la documentación.

Consulta [CONTRIBUTING.md](../../CONTRIBUTING.md) para preparar el entorno de desarrollo y las comprobaciones, la [guía de pruebas](../testing.md) para los procesos de verificación y el [mapa de arquitectura](../architecture.mermaid) para la estructura del proyecto.

## Licencia

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
