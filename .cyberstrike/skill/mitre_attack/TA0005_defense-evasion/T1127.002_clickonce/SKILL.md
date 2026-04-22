---
name: "T1127.002_clickonce"
description: "Adversaries may use ClickOnce applications (.appref-ms and .application files) to proxy execution of code through a trusted Windows utility."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1127.002
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1127.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1127/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1127
  - T1127.001
  - T1127.003
prerequisites:
  - T1127
severity_boost:
  T1127: "Chain with T1127 for deeper attack path"
  T1127.001: "Chain with T1127.001 for deeper attack path"
  T1127.003: "Chain with T1127.003 for deeper attack path"
---

# T1127.002 ClickOnce

> **Sub-technique of:** T1127

## High-Level Description

Adversaries may use ClickOnce applications (.appref-ms and .application files) to proxy execution of code through a trusted Windows utility. ClickOnce is a deployment that enables a user to create self-updating Windows-based .NET applications (i.e, .XBAP, .EXE, or .DLL) that install and run from a file share or web page with minimal user interaction. The application launches as a child process of DFSVC.EXE, which is responsible for installing, launching, and updating the application.

Because ClickOnce applications receive only limited permissions, they do not require administrative permissions to install. As such, adversaries may abuse ClickOnce to proxy execution of malicious code without needing to escalate privileges.

ClickOnce may be abused in a number of ways. For example, an adversary may rely on User Execution. When a user visits a malicious website, the .NET malware is disguised as legitimate software and a ClickOnce popup is displayed for installation.

Adversaries may also abuse ClickOnce to execute malware via a Rundll32 script using the command `rundll32.exe dfshim.dll,ShOpenVerbApplication1`.

Additionally, an adversary can move the ClickOnce application file to a remote user’s startup folder for continued malicious code deployment (i.e., Registry Run Keys / Startup Folder).

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if ClickOnce technique is applicable to target environment
- [ ] Check Windows systems for indicators of ClickOnce
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to ClickOnce by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1127.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Disable ClickOnce installations from the internet using the following registry key:
`\HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\.NETFramework\Security\TrustManager\PromptingLevel — Internet:Disabled`

ClickOnce may not be necessary within an environment and should be disabled if not being used.

### M1021 Restrict Web-Based Content

Disable ClickOnce installations from the internet using the following registry key:
`\HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\.NETFramework\Security\TrustManager\PromptingLevel — Internet:Disabled`

### M1045 Code Signing

Enforce binary and application integrity with digital signature verification to prevent untrusted code from executing.

## Detection

### Behavior-chain detection strategy for T1127.002 Trusted Developer Utilities Proxy Execution: ClickOnce (Windows)

## Risk Assessment

| Finding                        | Severity | Impact          |
| ------------------------------ | -------- | --------------- |
| ClickOnce technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [LOLBAS /Dfsvc.exe](https://lolbas-project.github.io/lolbas/Binaries/Dfsvc/)
- [Microsoft Learn ClickOnce](https://learn.microsoft.com/en-us/visualstudio/deployment/clickonce-security-and-deployment?view=vs-2022)
- [SpectorOps Medium ClickOnce](https://posts.specterops.io/less-smartscreen-more-caffeine-ab-using-clickonce-for-trusted-code-execution-1446ea8051c5)
- [NetSPI ClickOnce](https://www.netspi.com/blog/technical-blog/adversary-simulation/all-you-need-is-one-a-clickonce-love-story/)
- [Burke/CISA ClickOnce Paper](https://i.blackhat.com/USA-19/Wednesday/us-19-Burke-ClickOnce-And-Youre-In-When-Appref-Ms-Abuse-Is-Operating-As-Intended-wp.pdf?_gl=1*1jv89bf*_gcl_au*NjAyMzkzMjc3LjE3MjQ4MDk4OTQ.*_ga*MTk5OTA3ODkwMC4xNzI0ODA5ODk0*_ga_K4JK67TFYV*MTcyNDgwOTg5NC4xLjEuMTcyNDgwOTk1Ny4wLjAuMA..&_ga=2.256219723.1512103758.1724809895-1999078900.1724809894)
- [Burke/CISA ClickOnce BlackHat](https://i.blackhat.com/USA-19/Wednesday/us-19-Burke-ClickOnce-And-Youre-In-When-Appref-Ms-Abuse-Is-Operating-As-Intended.pdf?_gl=1*16njas6*_gcl_au*NjAyMzkzMjc3LjE3MjQ4MDk4OTQ.*_ga*MTk5OTA3ODkwMC4xNzI0ODA5ODk0*_ga_K4JK67TFYV*MTcyNDgwOTg5NC4xLjEuMTcyNDgwOTk1Ny4wLjAuMA..&_ga=2.253743689.1512103758.1724809895-1999078900.1724809894)
- [Atomic Red Team - T1127.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1127.002)
- [MITRE ATT&CK - T1127.002](https://attack.mitre.org/techniques/T1127/002)
