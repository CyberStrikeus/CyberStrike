---
name: "T1556.008_network-provider-dll"
description: "Adversaries may register malicious network provider dynamic link libraries (DLLs) to capture cleartext user credentials during the authentication process."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1556.008
  - credential-access
  - defense-evasion
  - persistence
  - windows
  - sub-technique
technique_id: "T1556.008"
tactic: "credential-access"
all_tactics:
  - credential-access
  - defense-evasion
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1556/008"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1556
  - T1556.001
  - T1556.002
  - T1556.003
  - T1556.004
  - T1556.005
  - T1556.006
  - T1556.007
  - T1556.009
prerequisites:
  - T1556
severity_boost:
  T1556: "Chain with T1556 for deeper attack path"
  T1556.001: "Chain with T1556.001 for deeper attack path"
  T1556.002: "Chain with T1556.002 for deeper attack path"
---

# T1556.008 Network Provider DLL

> **Sub-technique of:** T1556

## High-Level Description

Adversaries may register malicious network provider dynamic link libraries (DLLs) to capture cleartext user credentials during the authentication process. Network provider DLLs allow Windows to interface with specific network protocols and can also support add-on credential management functions. During the logon process, Winlogon (the interactive logon module) sends credentials to the local `mpnotify.exe` process via RPC. The `mpnotify.exe` process then shares the credentials in cleartext with registered credential managers when notifying that a logon event is happening.

Adversaries can configure a malicious network provider DLL to receive credentials from `mpnotify.exe`. Once installed as a credential manager (via the Registry), a malicious DLL can receive and save credentials each time a user logs onto a Windows workstation or domain via the `NPLogonNotify()` function.

Adversaries may target planting malicious network provider DLLs on systems known to have increased logon activity and/or administrator logon activity, such as servers and domain controllers.

## Kill Chain Phase

- Credential Access (TA0006)
- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Network Provider DLL technique is applicable to target environment
- [ ] Check Windows systems for indicators of Network Provider DLL
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Provider DLL by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1556.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1024 Restrict Registry Permissions

Restrict Registry permissions to disallow the modification of sensitive Registry keys such as `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\NetworkProvider\Order`.

### M1047 Audit

Periodically review for new and unknown network provider DLLs within the Registry (`HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\<NetworkProviderName>\NetworkProvider\ProviderPath`).

Ensure only valid network provider DLLs are registered. The name of these can be found in the Registry key at `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\NetworkProvider\Order`, and have corresponding service subkey pointing to a DLL at `HKEY_LOCAL_MACHINE\SYSTEM\CurrentC ontrolSet\Services\<NetworkProviderName>\NetworkProvider`.

### M1028 Operating System Configuration

Starting in Windows 11 22H2, the `EnableMPRNotifications` policy can be disabled through Group Policy or through a configuration service provider to prevent Winlogon from sending credentials to network providers.

## Detection

### Detect Network Provider DLL Registration and Credential Capture

## Risk Assessment

| Finding                                   | Severity | Impact            |
| ----------------------------------------- | -------- | ----------------- |
| Network Provider DLL technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [NPPSPY - Huntress](https://www.huntress.com/blog/cleartext-shenanigans-gifting-user-passwords-to-adversaries-with-nppspy)
- [NPPSPY Video](https://www.youtube.com/watch?v=ggY3srD9dYs)
- [NPPSPY](https://github.com/gtworek/PSBits/tree/master/PasswordStealing/NPPSpy)
- [Network Provider API](https://learn.microsoft.com/en-us/windows/win32/secauthn/network-provider-api)
- [NPLogonNotify](https://learn.microsoft.com/en-us/windows/win32/api/npapi/nf-npapi-nplogonnotify)
- [Atomic Red Team - T1556.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1556.008)
- [MITRE ATT&CK - T1556.008](https://attack.mitre.org/techniques/T1556/008)
