---
name: "T1614_system-location-discovery"
description: "Adversaries may gather information in an attempt to calculate the geographical location of a victim host."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1614
  - discovery
  - iaas
  - linux
  - macos
  - windows
technique_id: "T1614"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - IaaS
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1614"
tech_stack:
  - cloud
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1614.001
prerequisites:
  []
severity_boost:
  T1614.001: "Chain with T1614.001 for deeper attack path"
---

# T1614 System Location Discovery

## High-Level Description

Adversaries may gather information in an attempt to calculate the geographical location of a victim host. Adversaries may use the information from System Location Discovery during automated discovery to shape follow-on behaviors, including whether or not the adversary fully infects the target and/or attempts specific actions.

Adversaries may attempt to infer the location of a system using various system checks, such as time zone, keyboard layout, and/or language settings. Windows API functions such as <code>GetLocaleInfoW</code> can also be used to determine the locale of the host. In cloud environments, an instance's availability zone may also be discovered by accessing the instance metadata service from the instance.

Adversaries may also attempt to infer the location of a victim host using IP addressing, such as via online geolocation IP-lookup services.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** IaaS, Linux, macOS, Windows

## What to Check

- [ ] Identify if System Location Discovery technique is applicable to target environment
- [ ] Check IaaS systems for indicators of System Location Discovery
- [ ] Check Linux systems for indicators of System Location Discovery
- [ ] Check macOS systems for indicators of System Location Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Get geolocation info through IP-Lookup services using curl Windows

Get geolocation info through IP-Lookup services using curl Windows. The default URL of the IP-Lookup service is https://ipinfo.io/. References: https://securelist.com/transparent-tribe-part-1/98127/ and https://news.sophos.com/en-us/2016/05/03/location-based-ransomware-threat-research/

**Supported Platforms:** windows

```cmd
#{curl_path} -k #{ip_lookup_url}
```

**Dependencies:**
- Curl must be installed on system.

### Atomic Test 2: Get geolocation info through IP-Lookup services using curl freebsd, linux or macos

Get geolocation info through IP-Lookup services using curl Windows. The default URL of the IP-Lookup service is https://ipinfo.io/. References: https://securelist.com/transparent-tribe-part-1/98127/ and https://news.sophos.com/en-us/2016/05/03/location-based-ransomware-threat-research/

**Supported Platforms:** macos, linux

```bash
curl -k #{ip_lookup_url}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to System Location Discovery by examining the target platforms (IaaS, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1614 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for System Location Discovery


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Location Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Bleepingcomputer RAT malware 2020](https://www.bleepingcomputer.com/news/security/new-rat-malware-gets-commands-via-discord-has-ransomware-feature/)
- [AWS Instance Identity Documents](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-identity-documents.html)
- [Securelist Trasparent Tribe 2020](https://securelist.com/transparent-tribe-part-1/98127/)
- [FBI Ragnar Locker 2020](https://s3.documentcloud.org/documents/20413525/fbi-flash-indicators-of-compromise-ragnar-locker-ransomware-11192020-bc.pdf)
- [Microsoft Azure Instance Metadata 2021](https://docs.microsoft.com/en-us/azure/virtual-machines/windows/instance-metadata-service?tabs=windows)
- [Sophos Geolocation 2016](https://news.sophos.com/en-us/2016/05/03/location-based-ransomware-threat-research/)
- [Atomic Red Team - T1614](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1614)
- [MITRE ATT&CK - T1614](https://attack.mitre.org/techniques/T1614)
