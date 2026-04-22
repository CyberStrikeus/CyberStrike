---
name: "T1133_external-remote-services"
description: "Adversaries may leverage external-facing remote services to initially access and/or persist within a network."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1133
  - persistence
  - initial-access
  - containers
  - linux
  - macos
  - windows
technique_id: "T1133"
tactic: "persistence"
all_tactics:
  - persistence
  - initial-access
platforms:
  - Containers
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1133"
tech_stack:
  - containers
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-276
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1133 External Remote Services

## High-Level Description

Adversaries may leverage external-facing remote services to initially access and/or persist within a network. Remote services such as VPNs, Citrix, and other access mechanisms allow users to connect to internal enterprise network resources from external locations. There are often remote service gateways that manage connections and credential authentication for these services. Services such as Windows Remote Management and VNC can also be used externally.

Access to Valid Accounts to use the service is often a requirement, which could be obtained through credential pharming or by obtaining the credentials from users after compromising the enterprise network. Access to remote services may be used as a redundant or persistent access mechanism during an operation.

Access may also be gained through an exposed service that doesn’t require authentication. In containerized environments, this may include an exposed Docker API, Kubernetes API server, kubelet, or web application such as the Kubernetes dashboard.

Adversaries may also establish persistence on network by configuring a Tor hidden service on a compromised system. Adversaries may utilize the tool `ShadowLink` to facilitate the installation and configuration of the Tor hidden service. Tor hidden service is then accessible via the Tor network because `ShadowLink` sets up a .onion address on the compromised system. `ShadowLink` may be used to forward any inbound connections to RDP, allowing the adversaries to have remote access. Adversaries may get `ShadowLink` to persist on a system by masquerading it as an MS Defender application.

## Kill Chain Phase

- Persistence (TA0003)
- Initial Access (TA0001)

**Platforms:** Containers, Linux, macOS, Windows

## What to Check

- [ ] Identify if External Remote Services technique is applicable to target environment
- [ ] Check Containers systems for indicators of External Remote Services
- [ ] Check Linux systems for indicators of External Remote Services
- [ ] Check macOS systems for indicators of External Remote Services
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Running Chrome VPN Extensions via the Registry 2 vpn extension

Running Chrome VPN Extensions via the Registry install 2 vpn extension, please see "T1133\src\list of vpn extension.txt" to view complete list

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$extList = #{extension_id}
foreach ($extension in $extList) {
  New-Item -Path HKLM:\Software\Wow6432Node\Google\Chrome\Extensions\$extension -Force
  New-ItemProperty -Path "HKLM:\Software\Wow6432Node\Google\Chrome\Extensions\$extension" -Name "update_url" -Value "https://clients2.google.com/service/update2/crx" -PropertyType "String" -Force}
Start chrome
Start-Sleep -Seconds 30
Stop-Process -Name "chrome"
```

**Dependencies:**

- Chrome must be installed

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to External Remote Services by examining the target platforms (Containers, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1133 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1021 Restrict Web-Based Content

Restrict all traffic to and from public Tor nodes.

### M1030 Network Segmentation

Deny direct remote access to internal systems through the use of network proxies, gateways, and firewalls.

### M1042 Disable or Remove Feature or Program

Disable or block remotely available services that may be unnecessary.

### M1035 Limit Access to Resource Over Network

Limit access to remote services through centrally managed concentrators such as VPNs and other managed remote access systems.

### M1032 Multi-factor Authentication

Use strong two-factor or multi-factor authentication for remote service accounts to mitigate an adversary's ability to leverage stolen credentials, but be aware of Multi-Factor Authentication Interception techniques for some two-factor authentication implementations.

## Detection

### Behavior-chain detection for T1133 External Remote Services across Windows, Linux, macOS, Containers

## Risk Assessment

| Finding                                       | Severity | Impact      |
| --------------------------------------------- | -------- | ----------- |
| External Remote Services technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Volexity Virtual Private Keylogging](https://www.volexity.com/blog/2015/10/07/virtual-private-keylogging-cisco-web-vpns-leveraged-for-access-and-persistence/)
- [MacOS VNC software for Remote Desktop](https://support.apple.com/guide/remote-desktop/set-up-a-computer-running-vnc-software-apdbed09830/mac)
- [Unit 42 Hildegard Malware](https://unit42.paloaltonetworks.com/hildegard-malware-teamtnt/)
- [Russian threat actors dig in, prepare to seize on war fatigue](https://www.microsoft.com/en-us/security/security-insider/intelligence-reports/russian-threat-actors-dig-in-prepare-to-seize-on-war-fatigue)
- [The BadPilot campaign](https://www.microsoft.com/en-us/security/blog/2025/02/12/the-badpilot-campaign-seashell-blizzard-subgroup-conducts-multiyear-global-access-operation/?ref=thestack.technology)
- [Trend Micro Exposed Docker Server](https://www.trendmicro.com/en_us/research/20/f/xorddos-kaiji-botnet-malware-variants-target-exposed-docker-servers.html)
- [Atomic Red Team - T1133](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1133)
- [MITRE ATT&CK - T1133](https://attack.mitre.org/techniques/T1133)
