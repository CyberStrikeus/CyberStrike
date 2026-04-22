---
name: "T1572_protocol-tunneling"
description: "Adversaries may tunnel network communications to and from a victim system within a separate protocol to avoid detection/network filtering and/or enable access to otherwise unreachable systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1572
  - command-and-control
  - esxi
  - linux
  - macos
  - windows
technique_id: "T1572"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1572"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-300
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1572 Protocol Tunneling

## High-Level Description

Adversaries may tunnel network communications to and from a victim system within a separate protocol to avoid detection/network filtering and/or enable access to otherwise unreachable systems. Tunneling involves explicitly encapsulating a protocol within another. This behavior may conceal malicious traffic by blending in with existing traffic and/or provide an outer layer of encryption (similar to a VPN). Tunneling could also enable routing of network packets that would otherwise not reach their intended destination, such as SMB, RDP, or other traffic that would be filtered by network appliances or not routed over the Internet. 

There are various means to encapsulate a protocol within another protocol. For example, adversaries may perform SSH tunneling (also known as SSH port forwarding), which involves forwarding arbitrary data over an encrypted SSH tunnel. 

Protocol Tunneling may also be abused by adversaries during Dynamic Resolution. Known as DNS over HTTPS (DoH), queries to resolve C2 infrastructure may be encapsulated within encrypted HTTPS packets. 

Adversaries may also leverage Protocol Tunneling in conjunction with Proxy and/or Protocol or Service Impersonation to further conceal C2 communications and infrastructure.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Protocol Tunneling technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Protocol Tunneling
- [ ] Check Linux systems for indicators of Protocol Tunneling
- [ ] Check macOS systems for indicators of Protocol Tunneling
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: DNS over HTTPS Large Query Volume

This test simulates an infected host sending a large volume of DoH queries to a command and control server.
The intent of this test is to trigger threshold based detection on the number of DoH queries either from a single source system or to a single targe domain.
A custom domain and sub-domain will need to be passed as input parameters for this test to work. Upon execution, DNS information about the domain will be displayed for each callout in a JSON format.

**Supported Platforms:** windows

```powershell
for($i=0; $i -le #{query_volume}; $i++) { (Invoke-WebRequest "#{doh_server}?name=#{subdomain}.$(Get-Random -Minimum 1 -Maximum 999999).#{domain}&type=#{query_type}" -UseBasicParsing).Content }
```

### Atomic Test 2: DNS over HTTPS Regular Beaconing

This test simulates an infected host beaconing via DoH queries to a command and control server at regular intervals over time.
This behaviour is typical of implants either in an idle state waiting for instructions or configured to use a low query volume over time to evade threshold based detection.
A custom domain and sub-domain will need to be passed as input parameters for this test to work. Upon execution, DNS information about the domain will be displayed for each callout in a JSON format.

**Supported Platforms:** windows

```powershell
Set-Location "PathToAtomicsFolder"
.\T1572\src\T1572-doh-beacon.ps1 -DohServer #{doh_server} -Domain #{domain} -Subdomain #{subdomain} -QueryType #{query_type} -C2Interval #{c2_interval} -C2Jitter #{c2_jitter} -RunTime #{runtime}
```

### Atomic Test 3: DNS over HTTPS Long Domain Query

This test simulates an infected host returning data to a command and control server using long domain names.
The simulation involves sending DoH queries that gradually increase in length until reaching the maximum length. The intent is to test the effectiveness of detection of DoH queries for long domain names over a set threshold.
 Upon execution, DNS information about the domain will be displayed for each callout in a JSON format.

**Supported Platforms:** windows

```powershell
Set-Location "PathToAtomicsFolder"
.\T1572\src\T1572-doh-domain-length.ps1 -DohServer #{doh_server} -Domain #{domain} -Subdomain #{subdomain} -QueryType #{query_type}
```

### Atomic Test 4: run ngrok

Download and run ngrok. Create tunnel to chosen port.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
C:\Users\Public\ngrok\ngrok.exe config add-authtoken #{api_token} | Out-Null
Start-Job -ScriptBlock { C:\Users\Public\ngrok\ngrok.exe tcp #{port_num} } | Out-Null
Start-Sleep -s 5 
Stop-Job -Name Job1 | Out-Null
```

**Dependencies:**
- Download ngrok

### Atomic Test 5: Microsoft Dev tunnels (Linux/macOS)

Dev Tunnels enables insiders as well as threat actors to expose local ports over the internet via Microsoft dev tunnels.

This atomic will generate a dev tunnel binding it to the local service running on the provided port. Can be used to expose local services, web applications and local files etc.
Reference:
- [Microsoft Docs](https://learn.microsoft.com/en-us/tunnels/dev-tunnels-overview)
- [LOT Tunnels](https://lottunnels.github.io/lottunnels/Binaries/devtunnels/)

**Supported Platforms:** linux, macos

```bash
#{binary_path} host -p #{port} &
```

**Dependencies:**
- Download devtunnel
- Login to Microsoft Dev tunnels


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Protocol Tunneling by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1572 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1037 Filter Network Traffic
Consider filtering network traffic to untrusted or known bad domains and resources.

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.


## Detection

### Detection Strategy for Protocol Tunneling accross OS platforms.


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Protocol Tunneling technique applicable | Medium | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [Sygnia Abyss Locker 2025](https://www.sygnia.co/blog/abyss-locker-ransomware-attack-analysis/)
- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [BleepingComp Godlua JUL19](https://www.bleepingcomputer.com/news/security/new-godlua-malware-evades-traffic-monitoring-via-dns-over-https/)
- [SSH Tunneling](https://www.ssh.com/ssh/tunneling)
- [Atomic Red Team - T1572](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1572)
- [MITRE ATT&CK - T1572](https://attack.mitre.org/techniques/T1572)
