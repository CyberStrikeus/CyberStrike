---
name: "T1016.002_wi-fi-discovery"
description: "Adversaries may search for information about Wi-Fi networks, such as network names and passwords, on compromised systems."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1016.002
  - discovery
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1016.002"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1016/002"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-200
chains_with:
  - T1016
  - T1016.001
prerequisites:
  - T1016
severity_boost:
  T1016: "Chain with T1016 for deeper attack path"
  T1016.001: "Chain with T1016.001 for deeper attack path"
---

# T1016.002 Wi-Fi Discovery

> **Sub-technique of:** T1016

## High-Level Description

Adversaries may search for information about Wi-Fi networks, such as network names and passwords, on compromised systems. Adversaries may use Wi-Fi information as part of Account Discovery, Remote System Discovery, and other discovery or Credential Access activity to support both ongoing and future campaigns.

Adversaries may collect various types of information about Wi-Fi networks from hosts. For example, on Windows names and passwords of all Wi-Fi networks a device has previously connected to may be available through `netsh wlan show profiles` to enumerate Wi-Fi names and then `netsh wlan show profile “Wi-Fi name” key=clear` to show a Wi-Fi network’s corresponding password. Additionally, names and other details of locally reachable Wi-Fi networks can be discovered using calls to `wlanAPI.dll` Native API functions.

On Linux, names and passwords of all Wi-Fi-networks a device has previously connected to may be available in files under ` /etc/NetworkManager/system-connections/`. On macOS, the password of a known Wi-Fi may be identified with ` security find-generic-password -wa wifiname` (requires admin username/password).

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if Wi-Fi Discovery technique is applicable to target environment
- [ ] Check Linux systems for indicators of Wi-Fi Discovery
- [ ] Check Windows systems for indicators of Wi-Fi Discovery
- [ ] Check macOS systems for indicators of Wi-Fi Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Enumerate Stored Wi-Fi Profiles And Passwords via netsh

Upon successful execution, information about previously connected Wi-Fi networks will be displayed with their corresponding key (if present).

**Supported Platforms:** windows

```cmd
netsh wlan show profile * key=clear
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Wi-Fi Discovery by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1016.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavioral Detection of Wi-Fi Discovery Activity

## Risk Assessment

| Finding                              | Severity | Impact    |
| ------------------------------------ | -------- | --------- |
| Wi-Fi Discovery technique applicable | High     | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Binary Defense Emotes Wi-Fi Spreader](https://www.binarydefense.com/resources/blog/emotet-evolves-with-new-wi-fi-spreader/)
- [Check Point APT35 CharmPower January 2022](https://research.checkpoint.com/2022/apt35-exploits-log4j-vulnerability-to-distribute-new-modular-powershell-toolkit/)
- [Wi-Fi Password of All Connected Networks in Windows/Linux](https://www.geeksforgeeks.org/wi-fi-password-connected-networks-windowslinux/)
- [Malware Bytes New AgentTesla variant steals WiFi credentials](https://www.malwarebytes.com/blog/news/2020/04/new-agenttesla-variant-steals-wifi-credentials)
- [Find Wi-Fi Password on Mac](https://mackeeper.com/blog/find-wi-fi-password-on-mac/)
- [BleepingComputer Agent Tesla steal wifi passwords](https://www.bleepingcomputer.com/news/security/hackers-steal-wifi-passwords-using-upgraded-agent-tesla-malware/)
- [Atomic Red Team - T1016.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1016.002)
- [MITRE ATT&CK - T1016.002](https://attack.mitre.org/techniques/T1016/002)
