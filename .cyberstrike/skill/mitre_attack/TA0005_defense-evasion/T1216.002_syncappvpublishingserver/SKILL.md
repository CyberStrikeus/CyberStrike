---
name: "T1216.002_syncappvpublishingserver"
description: "Adversaries may abuse SyncAppvPublishingServer.vbs to proxy execution of malicious PowerShell commands."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1216.002
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1216.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1216/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1216
  - T1216.001
prerequisites:
  - T1216
severity_boost:
  T1216: "Chain with T1216 for deeper attack path"
  T1216.001: "Chain with T1216.001 for deeper attack path"
---

# T1216.002 SyncAppvPublishingServer

> **Sub-technique of:** T1216

## High-Level Description

Adversaries may abuse SyncAppvPublishingServer.vbs to proxy execution of malicious PowerShell commands. SyncAppvPublishingServer.vbs is a Visual Basic script associated with how Windows virtualizes applications (Microsoft Application Virtualization, or App-V). For example, Windows may render Win32 applications to users as virtual applications, allowing users to launch and interact with them as if they were installed locally.

The SyncAppvPublishingServer.vbs script is legitimate, may be signed by Microsoft, and is commonly executed from `\System32` through the command line via `wscript.exe`.

Adversaries may abuse SyncAppvPublishingServer.vbs to bypass PowerShell execution restrictions and evade defensive counter measures by "living off the land." Proxying execution may function as a trusted/signed alternative to directly invoking `powershell.exe`.

For example, PowerShell commands may be invoked using:

`SyncAppvPublishingServer.vbs "n; {PowerShell}"`

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if SyncAppvPublishingServer technique is applicable to target environment
- [ ] Check Windows systems for indicators of SyncAppvPublishingServer
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SyncAppvPublishingServer by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1216.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention

Certain signed scripts that can be used to execute other programs may not be necessary within a given environment. Use application control configured to block execution of these scripts if they are not required for a given system or network to prevent potential misuse by adversaries.

## Detection

### Detecting PowerShell Execution via SyncAppvPublishingServer.vbs Proxy Abuse

## Risk Assessment

| Finding                                       | Severity | Impact          |
| --------------------------------------------- | -------- | --------------- |
| SyncAppvPublishingServer technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [4 - appv](https://www.trellix.com/en-ca/about/newsroom/stories/research/suspected-darkhotel-apt-activity-update/)
- [2 - appv](https://learn.microsoft.com/en-us/windows/application-management/app-v/appv-getting-started)
- [5 - appv](https://lolbas-project.github.io/lolbas/Scripts/Syncappvpublishingserver/)
- [7 - appv](https://x.com/monoxgas/status/895045566090010624)
- [3 - appv](https://www.hackingarticles.in/indirect-command-execution-defense-evasion-t1202/)
- [1 - appv](https://securelist.com/bluenoroff-methods-bypass-motw/108383/)
- [6 - appv](https://strontic.github.io/xcyclopedia/library/SyncAppvPublishingServer.exe-3C291419F60CDF9C2E4E19AD89944FA3.html)
- [Atomic Red Team - T1216.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1216.002)
- [MITRE ATT&CK - T1216.002](https://attack.mitre.org/techniques/T1216/002)
