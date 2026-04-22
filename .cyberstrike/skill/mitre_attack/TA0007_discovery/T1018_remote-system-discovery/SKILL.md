---
name: "T1018_remote-system-discovery"
description: "Adversaries may attempt to get a listing of other systems by IP address, hostname, or other logical identifier on a network that may be used for Lateral Movement from the current system."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1018
  - discovery
  - esxi
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1018"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1018"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1018 Remote System Discovery

## High-Level Description

Adversaries may attempt to get a listing of other systems by IP address, hostname, or other logical identifier on a network that may be used for Lateral Movement from the current system. Functionality could exist within remote access tools to enable this, but utilities available on the operating system could also be used such as Ping, <code>net view</code> using Net, or, on ESXi servers, `esxcli network diag ping`.

Adversaries may also analyze data from local host files (ex: <code>C:\Windows\System32\Drivers\etc\hosts</code> or <code>/etc/hosts</code>) or other passive means (such as local Arp cache entries) in order to discover the presence of remote systems in an environment.

Adversaries may also target discovery of network infrastructure as well as leverage Network Device CLI commands on network devices to gather detailed information about systems within a network (e.g. <code>show cdp neighbors</code>, <code>show arp</code>).

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Remote System Discovery technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Remote System Discovery
- [ ] Check Linux systems for indicators of Remote System Discovery
- [ ] Check macOS systems for indicators of Remote System Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Remote System Discovery - net

Identify remote systems with net.exe.

Upon successful execution, cmd.exe will execute `net.exe view` and display results of local systems on the network that have file and print sharing enabled.

**Supported Platforms:** windows

```cmd
net view /domain
net view
```

### Atomic Test 2: Remote System Discovery - net group Domain Computers

Identify remote systems with net.exe querying the Active Directory Domain Computers group.

Upon successful execution, cmd.exe will execute cmd.exe against Active Directory to list the "Domain Computers" group. Output will be via stdout.

**Supported Platforms:** windows

```cmd
net group "Domain Computers" /domain
```

### Atomic Test 3: Remote System Discovery - nltest

Identify domain controllers for specified domain.

Upon successful execution, cmd.exe will execute nltest.exe against a target domain to retrieve a list of domain controllers. Output will be via stdout.

**Supported Platforms:** windows

```cmd
nltest.exe /dclist:#{target_domain}
```

### Atomic Test 4: Remote System Discovery - ping sweep

Identify remote systems via ping sweep.

Upon successful execution, cmd.exe will perform a for loop against the 192.168.1.1/24 network. Output will be via stdout.

**Supported Platforms:** windows

```cmd
for /l %i in (#{start_host},1,#{stop_host}) do ping -n 1 -w 100 #{subnet}.%i
```

### Atomic Test 5: Remote System Discovery - arp

Identify remote systems via arp. 

Upon successful execution, cmd.exe will execute arp to list out the arp cache. Output will be via stdout.

**Supported Platforms:** windows

```cmd
arp -a
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Remote System Discovery by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1018 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Remote System Enumeration Behavior


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Remote System Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [CISA AR21-126A FIVEHANDS May 2021](https://us-cert.cisa.gov/ncas/analysis-reports/ar21-126a)
- [Elastic - Koadiac Detection with EQL](https://www.elastic.co/security-labs/embracing-offensive-tooling-building-detections-against-koadic-using-eql)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Atomic Red Team - T1018](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1018)
- [MITRE ATT&CK - T1018](https://attack.mitre.org/techniques/T1018)
