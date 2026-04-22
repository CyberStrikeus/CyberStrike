---
name: "T1127_trusted-developer-utilities-proxy-execution"
description: "Adversaries may take advantage of trusted developer utilities to proxy execution of malicious payloads."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1127
  - defense-evasion
  - windows
technique_id: "T1127"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1127"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1127.001
  - T1127.002
  - T1127.003
prerequisites: []
severity_boost:
  T1127.001: "Chain with T1127.001 for deeper attack path"
  T1127.002: "Chain with T1127.002 for deeper attack path"
  T1127.003: "Chain with T1127.003 for deeper attack path"
---

# T1127 Trusted Developer Utilities Proxy Execution

## High-Level Description

Adversaries may take advantage of trusted developer utilities to proxy execution of malicious payloads. There are many utilities used for software development related tasks that can be used to execute code in various forms to assist in development, debugging, and reverse engineering. These utilities may often be signed with legitimate certificates that allow them to execute on a system and proxy execution of malicious code through a trusted process that effectively bypasses application control solutions.

Smart App Control is a feature of Windows that blocks applications it considers potentially malicious from running by verifying unsigned applications against a known safe list from a Microsoft cloud service before executing them. However, adversaries may leverage "reputation hijacking" to abuse an operating system’s trust of safe, signed applications that support the execution of arbitrary code. By leveraging Trusted Developer Utilities Proxy Execution to run their malicious code, adversaries may bypass Smart App Control protections.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Trusted Developer Utilities Proxy Execution technique is applicable to target environment
- [ ] Check Windows systems for indicators of Trusted Developer Utilities Proxy Execution
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Lolbin Jsc.exe compile javascript to exe

Use jsc.exe to compile javascript code stored in scriptfile.js and output scriptfile.exe.
https://lolbas-project.github.io/lolbas/Binaries/Jsc/
https://www.phpied.com/make-your-javascript-a-windows-exe/

**Supported Platforms:** windows

```cmd
copy "#{filename}" %TEMP%\hello.js
#{jscpath}\#{jscname} %TEMP%\hello.js
```

**Dependencies:**

- JavaScript code file must exist on disk at specified location (#{filename})

### Atomic Test 2: Lolbin Jsc.exe compile javascript to dll

Use jsc.exe to compile javascript code stored in Library.js and output Library.dll.
https://lolbas-project.github.io/lolbas/Binaries/Jsc/
https://www.phpied.com/make-your-javascript-a-windows-exe/

**Supported Platforms:** windows

```cmd
copy "#{filename}" %TEMP%\LibHello.js
#{jscpath}\#{jscname} /t:library %TEMP%\LibHello.js
```

**Dependencies:**

- JavaScript code file must exist on disk at specified location (#{filename})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Trusted Developer Utilities Proxy Execution by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1127 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Certain developer utilities should be blocked or restricted if not required.

### M1021 Restrict Web-Based Content

Consider disabling software installation or execution from the internet via developer utilities.

### M1042 Disable or Remove Feature or Program

Specific developer utilities may not be necessary within a given environment and should be removed if not used.

## Detection

### Behavior-chain, platform-aware detection strategy for T1127 Trusted Developer Utilities Proxy Execution (Windows)

## Risk Assessment

| Finding                                                          | Severity | Impact          |
| ---------------------------------------------------------------- | -------- | --------------- |
| Trusted Developer Utilities Proxy Execution technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Exploit Monday WinDbg](https://web.archive.org/web/20160816135945/http://www.exploit-monday.com/2016/08/windbg-cdb-shellcode-runner.html)
- [Elastic Security Labs](https://www.elastic.co/security-labs/dismantling-smart-app-control)
- [LOLBAS Tracker](https://lolbas-project.github.io/lolbas/OtherMSBinaries/Tracker/)
- [Microsoft Smart App Control](https://support.microsoft.com/en-us/windows/smart-app-control-frequently-asked-questions-285ea03d-fa88-4d56-882e-6698afdb7003)
- [engima0x3 RCSI Bypass](https://enigma0x3.net/2016/11/21/bypassing-application-whitelisting-by-using-rcsi-exe/)
- [engima0x3 DNX Bypass](https://enigma0x3.net/2016/11/17/bypassing-application-whitelisting-by-using-dnx-exe/)
- [Atomic Red Team - T1127](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1127)
- [MITRE ATT&CK - T1127](https://attack.mitre.org/techniques/T1127)
