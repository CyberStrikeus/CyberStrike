---
layout: home

hero:
  name: REA
  text: Reverse Engineer Anything
  tagline: Understand binaries, applications, and runtime behavior with one CLI and MCP server.
  actions:
    - theme: brand
      text: Get started
      link: /installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/morluto/rea

features:
  - title: Investigate with your agent
    details: Connect REA to your coding agent, describe the app or feature you want to understand, and follow the evidence.
    link: /mcp-prompts
  - title: Inspect across formats
    details: Explore native binaries, JavaScript and Electron apps, .NET assemblies, Android packages, firmware, and websites.
    link: /installation
  - title: Keep the evidence
    details: Analysis runs locally and returns observations, limitations, and unknowns through the CLI and MCP.
    link: /mcp-contracts
---

## Start with one command

```bash
npx rea-agents setup
```

Choose your agent, review the planned changes, and approve setup. Native binary
analysis can use an existing Hopper, Ghidra, or IDA installation; static
JavaScript analysis needs no native analysis engine.

For a first result from an extracted JavaScript application or ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

See [installation and setup](./installation.md) for requirements and configuration.

For runtime instrumentation, see the [Frida guide](./frida-instrumentation.md).

## Choose a guide

| Task                                                | Guides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identify a desktop installation                     | [Runtime candidates, evidence and follow-up files](desktop-applications.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Inspect native functions, references, or types      | [Native binaries](native-investigation.md), [Go metadata](go-binaries.md), [Rust dependencies](rust-binaries.md), [CPython pyc files](python-pyc.md), [PE certificates](pe-certificates.md), [PE imports](pe-imports.md), [PE TLS/load config](pe-load-config.md), [ELF notes](elf-notes.md), [Linux kernel modules](kernel-modules.md), [Apple IPS](apple-ips.md), [Erlang BEAM](erlang-beam.md), [offline ELF layout](binary-diagnostics.md), [recorded crashes](recorded-crashes.md)                                                                               |
| Inspect native functions, references, or types      | [Native binaries](native-investigation.md), [Go metadata](go-binaries.md), [Rust dependencies](rust-binaries.md), [CPython pyc files](python-pyc.md), [PE certificates](pe-certificates.md), [PE imports](pe-imports.md), [PE TLS/load config](pe-load-config.md), [ELF notes](elf-notes.md), [Apple IPS](apple-ips.md), [Erlang BEAM](erlang-beam.md), [offline ELF layout](binary-diagnostics.md), [recorded crashes](recorded-crashes.md)                                                                                                                          |
| Select a native provider or import format           | [Ghidra semantics](ghidra-provider.md), [Windows](windows-ghidra-p0.md), [DOS](ghidra-dos.md), [raw bytes](raw-binary.md), [GameCube DOL](ghidra-dol.md), [MIPS](ghidra-mips.md), [PSP](ghidra-psp.md), [NativeAOT](ghidra-nativeaot.md), [IDA](ida-provider.md), [Kuna](kuna-provider.md), [JEB](jeb-analysis.md)                                                                                                                                                                                                                                                    |
| Analyze JavaScript or Electron artifacts            | [Static analysis](javascript-artifact-reconstruction.md), [tracing and comparisons](javascript-application-workflows.md), [application graph](javascript-application-graph.md), [source recovery](javascript-recovery.md)                                                                                                                                                                                                                                                                                                                                             |
| Compare static JavaScript with runtime observations | [Runtime attribution](javascript-runtime-observation.md), [reconciliation](javascript-runtime-reconciliation.md), [Electron observation](electron-observation.md), [Electron fuses](electron-fuses.md)                                                                                                                                                                                                                                                                                                                                                                |
| Inspect assemblies, packages, or firmware           | [Godot PCK](godot-pck.md), [UnityFS](unityfs.md), [U-Boot uImage](uimage.md), [.NET](managed-code-analysis.md), [Python packages](python-packaged-applications.md), [Android](android-analysis.md), [APK signatures](apk-signature.md), [Apktool resources](apktool-resource-analysis.md), [ADB acquisition](adb-device-analysis.md), [Apple](apple-application-analysis.md), [Harmony](harmony-analysis.md), [firmware](firmware-analysis.md), [ESP images](esp-image.md), [ESP flash images](esp-flash-image.md), [WASM](wasm-artifacts.md), [EVM](evm-bytecode.md) |
| Observe or compare a browser scenario               | [CDP observation](browser-observation.md), [scenarios](browser-scenario-contract.md), [runtime evidence](web-runtime.md), [historical captures](web-network-captures.md)                                                                                                                                                                                                                                                                                                                                                                                              |
| Serve recorded behavior as an agent environment     | [Agent environments](agent-environments.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Trace captured website source                       | [Source locations](web-source-location.md), [module traces](website-module-trace.md), [script export](website-script-export.md)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Capture and compare a command                       | [Process capture](process-capture.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Use CLI/MCP and retain evidence                     | [CLI](cli.md), [MCP contracts](mcp-contracts.md), [agent prompts](mcp-prompts.md), [obligation ledgers](reconstruction-obligation-ledgers.md)                                                                                                                                                                                                                                                                                                                                                                                                                         |

For development, use [testing](testing.md), [client verification](client-verification.md),
[tool design](tool-design.md), [admission limits and recovery](design/limits-and-recovery.md),
and [releasing](releasing.md).
[Reconstruction readiness](reconstruction-readiness.md) describes a development
conformance verifier. [The 6.2 migration](migration-6.2.md) records that release's
compatibility changes; [the roadmap](roadmap.md) tracks future work.

![REA inspecting a native binary in Hopper](./assets/rea-hopper-analysis.png)
