---
name: "T1505.003_web-shell"
description: "Adversaries may backdoor web servers with web shells to establish persistent access to systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1505.003
  - persistence
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1505.003"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1505/003"
tech_stack:
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1505
  - T1505.001
  - T1505.002
  - T1505.004
  - T1505.005
  - T1505.006
prerequisites:
  - T1505
severity_boost:
  T1505: "Chain with T1505 for deeper attack path"
  T1505.001: "Chain with T1505.001 for deeper attack path"
  T1505.002: "Chain with T1505.002 for deeper attack path"
---

# T1505.003 Web Shell

> **Sub-technique of:** T1505

## High-Level Description

Adversaries may backdoor web servers with web shells to establish persistent access to systems. A Web shell is a Web script that is placed on an openly accessible Web server to allow an adversary to access the Web server as a gateway into a network. A Web shell may provide a set of functions to execute or a command-line interface on the system that hosts the Web server.

In addition to a server-side script, a Web shell may have a client interface program that is used to talk to the Web server (e.g. China Chopper Web shell client).

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Web Shell technique is applicable to target environment
- [ ] Check Linux systems for indicators of Web Shell
- [ ] Check macOS systems for indicators of Web Shell
- [ ] Check Network Devices systems for indicators of Web Shell
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Web Shell Written to Disk

This test simulates an adversary leveraging Web Shells by simulating the file modification to disk.
Idea from APTSimulator.
cmd.aspx source - https://github.com/tennc/webshell/blob/master/fuzzdb-webshell/asp/cmd.aspx

**Supported Platforms:** windows

```cmd
xcopy /I /Y "#{web_shells}" #{web_shell_path}
```

**Dependencies:**
- Web shell must exist on disk at specified location (#{web_shells})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Web Shell by examining the target platforms (Linux, macOS, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1505.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program
Consider disabling functions from web technologies such as PHP’s `evaI()` that may be abused for web shells.

### M1018 User Account Management
Enforce the principle of least privilege by limiting privileges of user accounts so only authorized accounts can modify the web directory.


## Detection

### Web Shell Detection via Server Behavior and File Execution Chains


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Web Shell technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [NSA Cyber Mitigating Web Shells](https://github.com/nsacyber/Mitigating-Web-Shells)
- [volexity_0day_sophos_FW](https://www.volexity.com/blog/2022/06/15/driftingcloud-zero-day-sophos-firewall-exploitation-and-an-insidious-breach/)
- [Lee 2013](https://www.fireeye.com/blog/threat-research/2013/08/breaking-down-the-china-chopper-web-shell-part-i.html)
- [US-CERT Alert TA15-314A Web Shells](https://www.us-cert.gov/ncas/alerts/TA15-314A)
- [Atomic Red Team - T1505.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1505.003)
- [MITRE ATT&CK - T1505.003](https://attack.mitre.org/techniques/T1505/003)
